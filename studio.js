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
let playPositionMs = 0;

// Zoom must exist BEFORE buildRoll() because buildRoll() uses it.
let hossZoom = 1;
const HOSS_BASE_CELL_WIDTH = 64;

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

  // buildRoll clears the roll, so recreate the playhead every time.
  const playhead = document.createElement("div");
  playhead.id = "playhead";
  playhead.className = "playhead";
  rollEl.appendChild(playhead);

  rollEl.style.gridTemplateColumns =
    `repeat(${steps}, ${Math.round(HOSS_BASE_CELL_WIDTH * hossZoom)}px)`;

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
  hossApplyZoom();
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

// ============================================================
// VISUAL PLAYBACK INDICATOR ONLY
// The audio engine below is intentionally left unchanged.
// ============================================================
let hossIndicatorFrame = null;
let hossIndicatorStartedAt = 0;
let hossIndicatorStartMs = 0;
let hossIndicatorDuration = 1;

function hossFmt(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function hossEvents() {
  const stepMs = stepDuration() * 1000;
  const map = new Map();

  for (const [id] of notes) {
    const [step, pitch] = id.split(":").map(Number);
    if (!map.has(step)) map.set(step, []);
    map.get(step).push(pitch);
  }

  return [...map.entries()]
    .map(([step, pitches]) => ({
      time: step * stepMs,
      pitches: [...new Set(pitches)]
    }))
    .sort((a, b) => a.time - b.time);
}

function hossIndicatorEnsureLine() {
  const roll = document.getElementById("roll");
  if (!roll) return null;

  let line = document.getElementById("playhead");
  if (!line) {
    line = document.createElement("div");
    line.id = "playhead";
    line.className = "playhead";
    roll.appendChild(line);
  }
  return line;
}


function hossFollowPlayhead(ms) {
  const rollWrap = document.getElementById("rollWrap") || document.querySelector(".roll-wrap");
  const roll = document.getElementById("roll");
  const line = document.getElementById("playhead");
  if (!rollWrap || !roll || !line) return;

  const totalMs = Math.max(1, hossIndicatorDuration);
  const x = (ms / totalMs) * roll.scrollWidth;

  const target = x - rollWrap.clientWidth * 0.55;
  rollWrap.scrollLeft = Math.max(0, Math.min(
    Math.max(0, roll.scrollWidth - rollWrap.clientWidth),
    target
  ));
}


function hossIndicatorPosition(ms) {
  const line = hossIndicatorEnsureLine();
  if (!line) return;

  const pct = Math.max(
    0,
    Math.min(100, (ms / Math.max(1, hossIndicatorDuration)) * 100)
  );
  line.style.left = `${pct}%`;
  hossFollowPlayhead(ms);
}

function hossIndicatorUI(state, ms) {
  const stateEl = document.getElementById("playbackState");
  const timeEl = document.getElementById("playbackTime");
  const dot = document.getElementById("playbackDot");

  if (stateEl) stateEl.textContent = state;
  if (timeEl) {
    timeEl.textContent =
      `${hossFmt(ms)} / ${hossFmt(hossIndicatorDuration)}`;
  }
  if (dot) dot.classList.toggle("playing", state === "Playing");

  const nextEl = document.getElementById("nextNote");
  if (nextEl) {
    const next = hossEvents().find(e => e.time >= ms - 2);
    nextEl.textContent = next
      ? next.pitches.map(p => midiToName(p)).join(" + ")
      : "—";
  }
}

function hossIndicatorTick() {
  if (!playing) return;

  const elapsed = Math.max(0, performance.now() - hossIndicatorStartedAt);
  const current = Math.min(
    hossIndicatorDuration,
    hossIndicatorStartMs + elapsed
  );

  hossIndicatorPosition(current);
  hossIndicatorUI("Playing", current);

  if (current < hossIndicatorDuration && playing) {
    hossIndicatorFrame = requestAnimationFrame(hossIndicatorTick);
  }
}

function hossIndicatorStart(startMs = 0) {
  cancelAnimationFrame(hossIndicatorFrame);

  hossIndicatorDuration =
    Math.max(1, steps * stepDuration() * 1000);

  hossIndicatorStartMs = Math.max(
    0,
    Math.min(hossIndicatorDuration, startMs)
  );
  hossIndicatorStartedAt = performance.now();

  hossIndicatorPosition(hossIndicatorStartMs);
  hossIndicatorUI("Playing", hossIndicatorStartMs);

  hossIndicatorFrame = requestAnimationFrame(hossIndicatorTick);
}

function hossIndicatorStop(state = "Stopped", ms = 0) {
  const pauseBtn = document.getElementById("pause");
  if (pauseBtn) pauseBtn.textContent = "⏸ Pause";
  cancelAnimationFrame(hossIndicatorFrame);
  hossIndicatorFrame = null;

  hossIndicatorDuration =
    Math.max(1, steps * stepDuration() * 1000);

  hossIndicatorPosition(ms);
  hossIndicatorUI(state, ms);
}



function hossPauseResume() {
  const btn = document.getElementById("pause");

  if (playing) {
    // playStart is performance.now(), so calculate the elapsed time using
    // performance.now() too. The previous version mixed it with
    // AudioContext.currentTime, which are different clocks.
    const elapsedMs = playStart
      ? Math.max(0, performance.now() - playStart)
      : 0;

    playPositionMs = Math.max(
      0,
      Math.min(songDurationMs(), elapsedMs)
    );

    playing = false;

    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }

    for (const source of activeSources) {
      try { source.stop(); } catch (e) {}
    }
    activeSources.clear();

    if (btn) btn.textContent = "▶ Resume";

    hossIndicatorStop("Paused", playPositionMs);
    saveStateEl.textContent = "Paused";
    return;
  }

  // Resume from the exact paused position.
  if (btn) btn.textContent = "⏸ Pause";
  playSong(playPositionMs);
}

async function playSong(startPositionMs = 0) {
  if (playing || notes.size === 0) return;

  try {
    const resumeFrom = Math.max(
      0,
      Math.min(songDurationMs(), Number(startPositionMs) || 0)
    );

    playing = true;
    saveStateEl.textContent = "Loading guitar sounds…";

    const ctx = await ensureAudio();

    const pitches = [...new Set(
      [...notes.keys()].map(id => Number(id.split(":")[1]))
    )];

    await Promise.all(pitches.map(async pitch => {
      try {
        await getBuffer(pitch);
      } catch (err) {
        console.error(err);
      }
    }));

    if (!playing) return;

    const start = ctx.currentTime + 0.12;

    // Same wall-clock used by pause, so the pause position is accurate.
    playStart = performance.now();

    // Schedule only notes that have not already happened.
    for (const [id, velocity] of notes) {
      const [step, pitch] = id.split(":").map(Number);
      const noteMs = step * stepDuration() * 1000;

      if (noteMs < resumeFrom) continue;

      const buffer = bufferCache.get(midiToName(pitch));
      if (!buffer) continue;

      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = Math.max(0.05, Math.min(1, velocity / 127));
      source.connect(gain).connect(ctx.destination);

      activeSources.add(source);
      source.onended = () => activeSources.delete(source);

      const delaySeconds = Math.max(0, noteMs - resumeFrom) / 1000;
      source.start(start + delaySeconds);
    }

    // Only the remaining editor timeline is timed here.
    const remaining = Math.max(
      0,
      songDurationMs() - resumeFrom
    ) + 150;

    playTimer = setTimeout(() => {
      playing = false;
      playTimer = null;
      playPositionMs = songDurationMs();
      saveStateEl.textContent = "Finished — notes may still be ringing";
      const pauseBtn = document.getElementById("pause");
      if (pauseBtn) pauseBtn.textContent = "⏸ Pause";
    }, remaining);

    saveStateEl.textContent = resumeFrom > 0 ? "Playing from pause position" : "Playing";
    hossIndicatorStart(resumeFrom);
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

  for (const source of activeSources) {
    try { source.stop(); } catch (e) {}
  }
  activeSources.clear();

  playPositionMs = 0;

  const pauseBtn = document.getElementById("pause");
  if (pauseBtn) pauseBtn.textContent = "⏸ Pause";

  hossIndicatorStop("Stopped", 0);
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
    steps = Math.max(16, steps);

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

// Start the visual indicator when the existing audio engine enters Playing.
let hossIndicatorWatcher = null;
let hossLastPlaying = false;

function hossWatchPlayback() {
  if (!playing && hossLastPlaying) {
    // The audio engine stopped externally.
    hossIndicatorStop("Stopped", playPositionMs);
  }
  hossLastPlaying = playing;
  hossIndicatorWatcher = requestAnimationFrame(hossWatchPlayback);
}

requestAnimationFrame(hossWatchPlayback);

$("pause").onclick = hossPauseResume;


function hossApplyZoom() {
  const roll = document.getElementById("roll");
  if (!roll) return;

  const width = Math.round(HOSS_BASE_CELL_WIDTH * hossZoom);
  roll.style.gridTemplateColumns = `repeat(${steps}, ${width}px)`;

  const label = document.getElementById("zoomValue");
  if (label) label.textContent = `${Math.round(hossZoom * 100)}%`;
}

function hossSetZoom(value) {
  hossZoom = Math.max(0.35, Math.min(2.5, value));
  hossApplyZoom();
}

function hossZoomIn() {
  hossSetZoom(hossZoom + 0.15);
}

function hossZoomOut() {
  hossSetZoom(hossZoom - 0.15);
}

const zoomInBtn = document.getElementById("zoomIn");
const zoomOutBtn = document.getElementById("zoomOut");

if (zoomInBtn) zoomInBtn.addEventListener("click", hossZoomIn);
if (zoomOutBtn) zoomOutBtn.addEventListener("click", hossZoomOut);

hossApplyZoom();
