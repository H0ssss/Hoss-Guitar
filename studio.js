const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const GUITARS = {
  mdmag: {
    name: "MDMAG Acoustic Guitar",
    low: 28,   // E1
    high: 72,  // C5
    folder: "assets/guitars/mdmag"
  }
};

let currentGuitar = GUITARS.mdmag;
let steps = 16;
let bpm = 120;
let notes = new Map(); // key: "step:pitch", value: velocity
let audioContext = null;
const bufferCache = new Map();
const bufferPromises = new Map();
let playTimer = null;
let playing = false;
let playStart = 0;
const activeSources = new Set();

const $ = id => document.getElementById(id);
const guitarEl = $("guitar");
const bpmEl = $("bpm");
const rollEl = $("roll");
const keysEl = $("keys");
const noteCountEl = $("noteCount");
const saveStateEl = $("saveState");
const midiFileEl = $("midiFile");
const midiTrackEl = $("midiTrack");
const midiTrackInfoEl = $("midiTrackInfo");
let importedMidiTracks = [];

function midiToName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[midi % 12] + octave;
}

function fileForNote(noteName) {
  // Filenames are expected to be exactly A#1.ogg, C4.ogg, etc.
  return `${currentGuitar.folder}/${encodeURIComponent(noteName)}.ogg`;
}


function readU16(data, pos) {
  return { value: (data[pos] << 8) | data[pos + 1], pos: pos + 2 };
}

function readU32(data, pos) {
  return { value: ((data[pos] * 0x1000000) + (data[pos+1] << 16) + (data[pos+2] << 8) + data[pos+3]), pos: pos + 4 };
}

function readVLQ(data, pos) {
  let value = 0, count = 0, b;
  do {
    if (pos >= data.length || count++ > 4) throw new Error("Invalid MIDI variable-length value");
    b = data[pos++];
    value = (value << 7) | (b & 0x7f);
  } while (b & 0x80);
  return { value, pos };
}

function ascii(data, pos, length) {
  return String.fromCharCode(...data.slice(pos, pos + length));
}

function parseMidi(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  if (ascii(data, 0, 4) !== "MThd") throw new Error("This is not a valid MIDI file");

  let r = readU32(data, 4);
  const headerLength = r.value;
  let pos = r.pos;
  const fmt = readU16(data, pos); pos = fmt.pos;
  const tracksCount = readU16(data, pos); pos = tracksCount.pos;
  const div = readU16(data, pos); pos = div.pos;

  if (div.value & 0x8000) throw new Error("SMPTE MIDI timing is not supported yet");
  const ticksPerBeat = div.value;
  pos = 8 + headerLength;

  const tracks = [];
  const tempoChanges = [{ tick: 0, micros: 500000 }];

  for (let trackIndex = 0; trackIndex < tracksCount; trackIndex++) {
    if (ascii(data, pos, 4) !== "MTrk") throw new Error("Invalid MIDI track chunk");
    const len = readU32(data, pos + 4).value;
    let p = pos + 8;
    const end = p + len;
    let tick = 0;
    let runningStatus = null;
    const active = new Map();
    const trackNotes = [];
    let trackName = `Track ${trackIndex + 1}`;

    while (p < end) {
      const dt = readVLQ(data, p); tick += dt.value; p = dt.pos;
      let status = data[p];
      if (status < 0x80) {
        if (runningStatus === null) throw new Error("Invalid MIDI running status");
        status = runningStatus;
      } else {
        p++;
        if (status < 0xF0) runningStatus = status;
      }

      if (status === 0xFF) {
        const type = data[p++];
        const l = readVLQ(data, p); p = l.pos;
        const bytes = data.slice(p, p + l.value);
        if (type === 0x03 && bytes.length) trackName = new TextDecoder().decode(bytes);
        if (type === 0x51 && bytes.length === 3) {
          const micros = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
          tempoChanges.push({ tick, micros });
        }
        p += l.value;
        if (type === 0x2F) break;
        continue;
      }

      if (status === 0xF0 || status === 0xF7) {
        const l = readVLQ(data, p); p = l.pos + l.value;
        runningStatus = null;
        continue;
      }

      const type = status & 0xF0;
      if (type === 0xC0 || type === 0xD0) {
        p += 1;
        continue;
      }
      if (p + 1 >= end) break;
      const note = data[p++];
      const value = data[p++];

      if (type === 0x90 && value > 0) {
        const key = note;
        if (!active.has(key)) active.set(key, []);
        active.get(key).push({ tick, velocity: value });
      } else if (type === 0x80 || (type === 0x90 && value === 0)) {
        const list = active.get(note);
        if (list && list.length) {
          const start = list.shift();
          trackNotes.push({ tick: start.tick, note, velocity: start.velocity, durationTicks: Math.max(1, tick - start.tick) });
        }
      }
    }

    tracks.push({ index: trackIndex, name: trackName || `Track ${trackIndex + 1}`, notes: trackNotes });
    pos = end;
  }

  tempoChanges.sort((a,b) => a.tick - b.tick);
  return { format: fmt.value, ticksPerBeat, tracks, tempoChanges };
}

function tickToSeconds(tick, midi) {
  const changes = midi.tempoChanges;
  let seconds = 0;
  let lastTick = 0;
  let micros = changes[0]?.micros || 500000;

  for (let i = 1; i < changes.length; i++) {
    const c = changes[i];
    if (c.tick >= tick) break;
    seconds += (c.tick - lastTick) * micros / 1000000 / midi.ticksPerBeat;
    lastTick = c.tick;
    micros = c.micros;
  }
  seconds += (tick - lastTick) * micros / 1000000 / midi.ticksPerBeat;
  return seconds;
}

function chooseBpmFromMidi(midi) {
  const micros = midi.tempoChanges[0]?.micros || 500000;
  return Math.max(30, Math.min(300, Math.round(60000000 / micros)));
}

function fitNoteToGuitar(midiNote) {
  const available = currentGuitar.availableNotes || [];

  // Same behavior as the main Hoss MIDI Converter:
  // keep the note's pitch class and move it by octaves until the
  // closest real guitar sample is found.
  if (available.includes(midiNote)) {
    return midiNote;
  }

  let best = null;
  let bestDistance = Infinity;

  for (let octave = -8; octave <= 8; octave++) {
    const candidate = midiNote + octave * 12;
    if (!available.includes(candidate)) continue;

    const distance = Math.abs(octave);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

function importMidiNotes(midi, trackSelection) {
  const selected = trackSelection === "all"
    ? midi.tracks
    : [midi.tracks[Number(trackSelection)]];

  const stepSeconds = 60 / bpm / 4;
  const imported = new Map();
  let skipped = 0;
  let shifted = 0;

  // Import exactly like the main converter: remove silence before the
  // first musical event so the editor starts at step 0.
  const sourceEvents = [];

  for (const track of selected) {
    if (!track) continue;
    for (const event of track.notes) {
      const fitted = fitNoteToGuitar(event.note);
      if (fitted === null) {
        skipped++;
        continue;
      }

      if (fitted !== event.note) shifted++;

      sourceEvents.push({
        event,
        fitted,
        seconds: tickToSeconds(event.tick, midi)
      });
    }
  }

  if (!sourceEvents.length) {
    throw new Error("This MIDI contains no playable notes for the selected guitar.");
  }

  const firstSeconds = Math.min(...sourceEvents.map(item => item.seconds));

  for (const item of sourceEvents) {
    const relativeSeconds = Math.max(0, item.seconds - firstSeconds);
    const step = Math.max(0, Math.round(relativeSeconds / stepSeconds));
    const key = `${step}:${item.fitted}`;
    const velocity = Math.max(1, Math.min(127, item.event.velocity || 100));
    imported.set(key, Math.max(imported.get(key) || 0, velocity));
  }

  const maxStep = Math.max(...[...imported.keys()].map(id => Number(id.split(":")[0])));
  while (steps <= maxStep) steps += 16;

  notes = imported;
  buildRoll();
  autoSave();

  return { skipped, shifted };
}

function loadMidiIntoEditor(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const midi = parseMidi(reader.result);
      importedMidiTracks = [{index: "all", name: "All tracks", notes: []}, ...midi.tracks];
      const importedBpm = chooseBpmFromMidi(midi);
      bpm = importedBpm;
      bpmEl.value = bpm;

      midiTrackEl.innerHTML = "";
      importedMidiTracks.forEach((track, i) => {
        const option = document.createElement("option");
        option.value = String(track.index);
        option.textContent = track.index === "all"
          ? `All tracks (${midi.tracks.length})`
          : `${track.index + 1}: ${track.name} — ${track.notes.length} notes`;
        midiTrackEl.appendChild(option);
      });
      midiTrackEl.disabled = false;
      midiTrackEl._midi = midi;
      midiTrackEl._selectedFileName = file.name;
      midiTrackInfoEl.textContent = file.name;

      // Match the main MIDI Converter: prefer guitar/melody tracks instead
      // of immediately merging every track (which often includes drums).
      let preferred = midi.tracks.findIndex(t =>
        /nylon\s*gtr|nylon\s*guitar|guitar|gtr/i.test(t.name)
      );

      if (preferred === -1) {
        preferred = midi.tracks.findIndex(t =>
          /piano|strings|violin|melody|flute|lead|voice/i.test(t.name)
        );
      }

      if (preferred === -1) {
        preferred = midi.tracks.findIndex(t =>
          !/drum|percussion|perc/i.test(t.name)
        );
      }

      const selectedIndex = preferred >= 0 ? String(preferred) : "all";
      midiTrackEl.value = selectedIndex;

      const result = importMidiNotes(midi, selectedIndex);
      const details = [];
      if (result.shifted) details.push(`${result.shifted} octave-fitted`);
      if (result.skipped) details.push(`${result.skipped} skipped`);
      saveStateEl.textContent = `MIDI imported — ${file.name}${details.length ? ` (${details.join(", ")})` : ""}`;
    } catch (err) {
      console.error(err);
      alert(`Could not import MIDI: ${err.message}`);
      saveStateEl.textContent = "MIDI import failed";
    } finally {
      midiFileEl.value = "";
    }
  };
  reader.onerror = () => alert("Could not read the MIDI file.");
  reader.readAsArrayBuffer(file);
}

function updateCount() {
  noteCountEl.textContent = notes.size;
}

function buildRoll() {
  keysEl.innerHTML = "";
  rollEl.innerHTML = "";
  rollEl.style.gridTemplateColumns = `repeat(${steps}, 64px)`;

  for (let pitch = currentGuitar.high; pitch >= currentGuitar.low; pitch--) {
    const key = document.createElement("div");
    key.className = "key" + (NOTE_NAMES[pitch % 12].includes("#") ? " black" : "");
    key.textContent = midiToName(pitch);
    keysEl.appendChild(key);

    for (let step = 0; step < steps; step++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      if (step % 4 === 0) cell.classList.add("beat");
      if (step % 16 === 0) cell.classList.add("bar");

      const id = `${step}:${pitch}`;
      if (notes.has(id)) cell.classList.add("active");

      cell.dataset.id = id;
      cell.dataset.pitch = pitch;
      cell.dataset.step = step;

      cell.addEventListener("click", async () => {
        if (notes.has(id)) {
          notes.delete(id);
          cell.classList.remove("active");
        } else {
          notes.set(id, 100);
          cell.classList.add("active");
          await playSample(pitch, 100);
        }
        updateCount();
        autoSave();
      });

      rollEl.appendChild(cell);
    }
  }
  updateCount();
}

async function ensureAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === "suspended") await audioContext.resume();
  return audioContext;
}

async function getBuffer(pitch) {
  const name = midiToName(pitch);
  if (!currentGuitar.availableNotes?.includes(pitch)) return null;
  if (bufferCache.has(name)) return bufferCache.get(name);
  if (bufferPromises.has(name)) return bufferPromises.get(name);

  const promise = (async () => {
    const response = await fetch(fileForNote(name), { cache: "force-cache" });
    if (!response.ok) throw new Error(`Missing sample: ${name}.ogg`);
    const arrayBuffer = await response.arrayBuffer();
    const ctx = await ensureAudio();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    bufferCache.set(name, buffer);
    return buffer;
  })();

  bufferPromises.set(name, promise);
  try {
    return await promise;
  } finally {
    bufferPromises.delete(name);
  }
}

async function playSample(pitch, velocity=100, when=null) {
  try {
    const ctx = await ensureAudio();
    const buffer = await getBuffer(pitch);
    if (!buffer) return;

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();

    source.buffer = buffer;
    gain.gain.value = Math.max(0.05, Math.min(1, velocity / 127));
    source.connect(gain).connect(ctx.destination);

    // Keep a reference so STOP can actually stop every currently-playing note.
    activeSources.add(source);
    source.onended = () => activeSources.delete(source);

    const startAt = when ?? ctx.currentTime;
    source.start(startAt);

    // IMPORTANT:
    // Do NOT call source.stop() here.
    // AudioBufferSourceNode naturally plays the complete decoded sample,
    // which for MDMAG is about 11 seconds.
  } catch (err) {
    console.error(err);
    saveStateEl.textContent = `Sample error: ${err.message}`;
  }
}

function stepDuration() {
  return 60 / bpm / 4; // 16th note
}

async function playSong() {
  if (playing || notes.size === 0) return;

  try {
    playing = true;
    saveStateEl.textContent = "Loading guitar sounds…";

    const ctx = await ensureAudio();

    // IMPORTANT: load/decode every sample BEFORE scheduling playback.
    // Otherwise a slow network request can make source.start() receive a
    // start time that is already in the past, which makes playback unreliable.
    const pitches = [...new Set([...notes.keys()].map(id => Number(id.split(":")[1])))];
    await Promise.all(pitches.map(async pitch => {
      try {
        await getBuffer(pitch);
      } catch (err) {
        console.error(err);
      }
    }));

    if (!playing) return;

    const start = ctx.currentTime + 0.12;
    playStart = performance.now();

    for (const [id, velocity] of notes) {
      const [step, pitch] = id.split(":").map(Number);
      const buffer = bufferCache.get(midiToName(pitch));
      if (!buffer) continue;

      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = Math.max(0.05, Math.min(1, velocity / 127));
      source.connect(gain).connect(ctx.destination);
      activeSources.add(source);
      source.onended = () => activeSources.delete(source);
      source.start(start + step * stepDuration());
    }

    const duration = (steps * stepDuration() + 0.15) * 1000;
    playTimer = setTimeout(() => {
      playing = false;
      playTimer = null;
      saveStateEl.textContent = "Finished — notes may still be ringing";
    }, duration);
    saveStateEl.textContent = "Playing";
  } catch (err) {
    console.error(err);
    playing = false;
    saveStateEl.textContent = `Playback error: ${err.message}`;
  }
}

function stopSong() {
  playing = false;

  if (playTimer) clearTimeout(playTimer);
  playTimer = null;

  // Cancel every note that is currently playing or scheduled.
  for (const source of activeSources) {
    try {
      source.stop();
    } catch (e) {
      // Source may already have ended.
    }
  }
  activeSources.clear();

  saveStateEl.textContent = "Saved";
}

function autoSave() {
  const data = {
    version: 1,
    guitar: currentGuitar.id || "mdmag",
    bpm,
    steps,
    notes: [...notes.entries()]
  };
  localStorage.setItem("hoss-guitar-studio-project", JSON.stringify(data));
  saveStateEl.textContent = "Saved locally";
}

function loadAutoSave() {
  try {
    const raw = localStorage.getItem("hoss-guitar-studio-project");
    if (!raw) return;
    const data = JSON.parse(raw);
    bpm = Number(data.bpm) || 120;
    steps = Number(data.steps) || 16;
    bpmEl.value = bpm;
    notes = new Map(data.notes || []);
    buildRoll();
    saveStateEl.textContent = "Recovered";
  } catch (e) {
    console.warn("Could not recover autosave", e);
  }
}

function exportProject() {
  const data = {
    type: "HOSS_GUITAR_PROJECT",
    version: 1,
    guitar: currentGuitar.id,
    bpm,
    steps,
    notes: [...notes.entries()]
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
  download(blob, "Hoss-Guitar-Project.hoss");
}

function buildHossText() {
  const lines = [
    "# HOSS GUITAR SONG",
    `# GUITAR=${currentGuitar.name}`,
    `# BPM=${bpm}`,
    "# FORMAT: time_ms|notes",
    ""
  ];

  const stepMs = 60000 / bpm / 4;
  const events = [];
  for (const [id] of notes) {
    const [step, pitch] = id.split(":").map(Number);
    events.push({ time: Math.round(step * stepMs), note: midiToName(pitch) });
  }
  events.sort((a,b) => a.time - b.time);

  if (!events.length) {
    lines.push("0|");
    return lines.join("\n");
  }

  const firstTime = events[0].time;
  const grouped = new Map();
  for (const e of events) {
    const time = e.time - firstTime;
    if (!grouped.has(time)) grouped.set(time, []);
    grouped.get(time).push(e.note);
  }
  for (const [time, list] of grouped) lines.push(`${time}|${list.join("+")}`);
  return lines.join("\n");
}

async function copyHossText() {
  const text = buildHossText();
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.focus();
      area.select();
      area.setSelectionRange(0, area.value.length);
      const ok = document.execCommand("copy");
      area.remove();
      if (!ok) throw new Error("Clipboard copy was blocked by the browser");
    }
    saveStateEl.textContent = "Hoss text copied ✓";
  } catch (err) {
    console.error(err);
    saveStateEl.textContent = "Copy blocked — use Get Text File";
  }
}

function downloadHossText() {
  download(new Blob([buildHossText()], {type:"text/plain;charset=utf-8"}), "Hoss-Guitar-Song.txt", "text/plain");
  saveStateEl.textContent = "Text file downloaded ✓";
}

function exportMidi() {
  // Standard format 0 MIDI. One track, 480 ticks/beat.
  const TPB = 480;
  const ticksPerStep = TPB / 4;
  const events = [];

  for (const [id, velocity] of notes) {
    const [step, pitch] = id.split(":").map(Number);
    const tick = step * ticksPerStep;
    events.push({tick, on:true, pitch, velocity});
    events.push({tick: tick + Math.max(30, ticksPerStep - 10), on:false, pitch, velocity:0});
  }

  events.sort((a,b) => a.tick - b.tick || (a.on ? -1 : 1));

  const bytes = [];
  const push = (...v) => bytes.push(...v);
  const u32 = n => push((n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255);
  const u16 = n => push((n>>>8)&255,n&255);

  const vlq = n => {
    let buffer = n & 0x7f;
    const out = [];
    while ((n >>= 7)) {
      buffer <<= 8;
      buffer |= ((n & 0x7f) | 0x80);
    }
    while (true) {
      out.push(buffer & 0xff);
      if (buffer & 0x80) buffer >>= 8;
      else break;
    }
    push(...out.reverse());
  };

  push(...[0x4d,0x54,0x68,0x64]); u32(6); u16(0); u16(1); u16(TPB);
  const trackBytes = [];
  const tp = (...v) => trackBytes.push(...v);
  const tvlq = n => {
    let buffer = n & 0x7f;
    const out = [];
    while ((n >>= 7)) {
      buffer <<= 8;
      buffer |= ((n & 0x7f) | 0x80);
    }
    while (true) {
      out.push(buffer & 0xff);
      if (buffer & 0x80) buffer >>= 8;
      else break;
    }
    trackBytes.push(...out.reverse());
  };

  // Tempo meta event.
  const micros = Math.round(60000000 / bpm);
  tp(0x00,0xff,0x51,0x03,(micros>>16)&255,(micros>>8)&255,micros&255);

  let lastTick = 0;
  for (const e of events) {
    tvlq(Math.max(0, e.tick - lastTick));
    tp(e.on ? 0x90 : 0x80, e.pitch, e.on ? Math.max(1,Math.min(127,e.velocity)) : 0);
    lastTick = e.tick;
  }
  tvlq(0); tp(0xff,0x2f,0x00);

  push(...[0x4d,0x54,0x72,0x6b]);
  u32(trackBytes.length);
  push(...trackBytes);

  download(new Uint8Array(bytes), "Hoss-Guitar-Song.mid", "audio/midi");
}

function download(data, filename, type="application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], {type});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$("play").onclick = playSong;
$("stop").onclick = stopSong;

$("clear").onclick = () => {
  if (!confirm("Clear this project?")) return;
  notes.clear();
  buildRoll();
  autoSave();
};

$("save").onclick = exportProject;
$("load").onclick = () => $("projectFile").click();

$("projectFile").onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  if (data.type !== "HOSS_GUITAR_PROJECT") return alert("Not a Hoss Guitar project.");
  bpm = Number(data.bpm) || 120;
  steps = Number(data.steps) || 16;
  notes = new Map(data.notes || []);
  bpmEl.value = bpm;
  buildRoll();
  autoSave();
};

$("export").onclick = exportMidi;
$("copyHoss").onclick = copyHossText;
$("downloadHoss").onclick = downloadHossText;

$("loadMidi").onclick = () => midiFileEl.click();
midiFileEl.onchange = e => {
  const file = e.target.files[0];
  if (file) loadMidiIntoEditor(file);
};

midiTrackEl.onchange = () => {
  const midi = midiTrackEl._midi;
  if (!midi) return;
  try {
    const result = importMidiNotes(midi, midiTrackEl.value);
    const details = [];
    if (result.shifted) details.push(`${result.shifted} octave-fitted`);
    if (result.skipped) details.push(`${result.skipped} skipped`);
    saveStateEl.textContent = details.length
      ? `Track loaded — ${details.join(", ")}`
      : "Track loaded ✓";
  } catch (err) {
    alert(err.message);
  }
};

bpmEl.onchange = () => {
  bpm = Math.max(30, Math.min(300, Number(bpmEl.value) || 120));
  bpmEl.value = bpm;
  autoSave();
};

$("zoomIn").onclick = () => {
  if (steps < 64) steps += 16;
  buildRoll();
  autoSave();
};
$("zoomOut").onclick = () => {
  if (steps > 16) steps -= 16;
  buildRoll();
  autoSave();
};

guitarEl.onchange = () => {
  currentGuitar = GUITARS[guitarEl.value];
  bufferCache.clear();
  $("guitarInfo").textContent = currentGuitar.name;
  buildRoll();
  autoSave();
};

currentGuitar.availableNotes = [];
for (let p = currentGuitar.low; p <= currentGuitar.high; p++) {
  // MDMAG has every chromatic note E1-C5 except the range starts at E1.
  currentGuitar.availableNotes.push(p);
}

buildRoll();
loadAutoSave();
