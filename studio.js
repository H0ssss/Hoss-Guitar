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

function midiToName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[midi % 12] + octave;
}

function fileForNote(noteName) {
  // Filenames are expected to be exactly A#1.ogg, C4.ogg, etc.
  return `${currentGuitar.folder}/${encodeURIComponent(noteName)}.ogg`;
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

function parseHossText(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  let importedBpm = bpm;
  let importedGuitar = null;
  const events = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Metadata
    if (line.startsWith("#")) {
      const meta = line.substring(1).trim();

      const bpmMatch = meta.match(/^BPM\s*=\s*(\d+(?:\.\d+)?)/i);
      if (bpmMatch) {
        importedBpm = Math.max(30, Math.min(300, Number(bpmMatch[1]) || bpm));
      }

      const guitarMatch = meta.match(/^GUITAR\s*=\s*(.+)$/i);
      if (guitarMatch) {
        importedGuitar = guitarMatch[1].trim();
      }

      continue;
    }

    const parts = line.split("|");
    if (parts.length < 2) continue;

    const time = Number(parts[0].trim());
    const noteText = parts.slice(1).join("|").trim();

    if (!Number.isFinite(time) || time < 0 || !noteText) continue;

    const noteNames = noteText
      .split(/[+,;\s]+/)
      .map(n => n.trim())
      .filter(Boolean);

    if (!noteNames.length) continue;

    const validNotes = [];
    for (const noteName of noteNames) {
      const match = noteName.match(/^([A-Ga-g])(#)?(-?\d+)$/);
      if (!match) continue;

      const letter = match[1].toUpperCase();
      const sharp = match[2] ? "#" : "";
      const octave = Number(match[3]);
      const normalized = `${letter}${sharp}${octave}`;

      const pitchClass = NOTE_NAMES.indexOf(`${letter}${sharp}`);
      if (pitchClass < 0) continue;

      const midi = (octave + 1) * 12 + pitchClass;

      // Only cells that have a real sample on the selected guitar.
      if (midi >= currentGuitar.low && midi <= currentGuitar.high) {
        validNotes.push(midi);
      }
    }

    if (validNotes.length) {
      events.push({
        time,
        pitches: [...new Set(validNotes)]
      });
    }
  }

  return { importedBpm, importedGuitar, events };
}

function importHossText() {
  const text = $("hossTextInput").value.trim();

  if (!text) {
    saveStateEl.textContent = "Paste Hoss text first";
    return;
  }

  try {
    const parsed = parseHossText(text);

    if (!parsed.events.length) {
      throw new Error("No valid guitar notes were found.");
    }

    // Use the BPM from the converter output.
    bpm = parsed.importedBpm;
    bpmEl.value = bpm;

    // Convert milliseconds into the editor's 16th-note grid.
    const stepMs = 60000 / bpm / 4;

    notes.clear();

    let maxStep = 0;
    for (const event of parsed.events) {
      const step = Math.max(0, Math.round(event.time / stepMs));

      for (const pitch of event.pitches) {
        notes.set(`${step}:${pitch}`, 100);
      }

      if (step > maxStep) maxStep = step;
    }

    // Give the imported song enough horizontal space.
    // Keep the grid in 16-step blocks.
    steps = Math.max(16, Math.ceil((maxStep + 1) / 16) * 16);

    // Allow long songs while keeping the normal zoom controls useful.
    steps = Math.min(256, steps);

    buildRoll();
    autoSave();

    $("hossPastePanel").classList.add("hidden");
    saveStateEl.textContent =
      `Imported ${notes.size} notes from Hoss text ✓`;
  } catch (err) {
    console.error(err);
    saveStateEl.textContent = `Import error: ${err.message}`;
  }
}

function openHossPaste() {
  $("hossPastePanel").classList.remove("hidden");
  $("hossTextInput").focus();
}

function closeHossPaste() {
  $("hossPastePanel").classList.add("hidden");
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
$("pasteHoss").onclick = openHossPaste;
$("importHoss").onclick = importHossText;
$("cancelHoss").onclick = closeHossPaste;
$("downloadHoss").onclick = downloadHossText;

bpmEl.onchange = () => {
  bpm = Math.max(30, Math.min(300, Number(bpmEl.value) || 120));
  bpmEl.value = bpm;
  autoSave();
};

$("zoomIn").onclick = () => {
  if (steps < 256) steps += 16;
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
