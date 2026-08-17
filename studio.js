const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const GUITARS = {
  mdmag: {
    id: "mdmag",
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
let playTimer = null;
let playing = false;
let playStart = 0;

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
  return `${currentGuitar.folder}/${noteName}.ogg`;
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

  const response = await fetch(fileForNote(name));
  if (!response.ok) throw new Error(`Missing sample: ${name}.ogg`);
  const arrayBuffer = await response.arrayBuffer();
  const ctx = await ensureAudio();
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  bufferCache.set(name, buffer);
  return buffer;
}

async function playSample(pitch, velocity=100, when=null, duration=1.8) {
  try {
    const ctx = await ensureAudio();
    const buffer = await getBuffer(pitch);
    if (!buffer) return;

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.max(0.05, Math.min(1, velocity / 127));
    source.connect(gain).connect(ctx.destination);

    const startAt = when ?? ctx.currentTime;
    source.start(startAt);
    // Keep preview playback short so composing doesn't create endless overlap.
    source.stop(Math.min(startAt + duration, startAt + buffer.duration));
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
  playing = true;
  await ensureAudio();

  const ctx = audioContext;
  const start = ctx.currentTime + 0.08;
  playStart = performance.now();

  [...notes.entries()].forEach(([id, velocity]) => {
    const [step, pitch] = id.split(":").map(Number);
    playSample(pitch, velocity, start + step * stepDuration(), stepDuration() * 0.95);
  });

  const duration = (steps * stepDuration() + 0.15) * 1000;
  playTimer = setTimeout(stopSong, duration);
  saveStateEl.textContent = "Playing";
}

function stopSong() {
  playing = false;
  if (playTimer) clearTimeout(playTimer);
  playTimer = null;
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
  const lines = [];
  lines.push("# HOSS GUITAR SONG");
  lines.push(`# GUITAR=${currentGuitar.name}`);
  lines.push(`# BPM=${bpm}`);
  lines.push("# FORMAT: time_ms|notes");
  lines.push("");

  const stepMs = 60000 / bpm / 4;
  const grouped = new Map();

  for (const [id] of notes) {
    const [step, pitch] = id.split(":").map(Number);
    const time = Math.round(step * stepMs);
    const note = midiToName(pitch);

    if (!grouped.has(time)) grouped.set(time, []);
    grouped.get(time).push(note);
  }

  [...grouped.keys()].sort((a, b) => a - b).forEach(time => {
    lines.push(`${time}|${grouped.get(time).join("+")}`);
  });

  return lines.join("\n");
}

async function copyHossText() {
  const text = buildHossText();
  try {
    await navigator.clipboard.writeText(text);
    saveStateEl.textContent = "Hoss text copied";
  } catch (err) {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    saveStateEl.textContent = "Hoss text copied";
  }
}

function downloadHossText() {
  download(
    new Blob([buildHossText()], {type: "text/plain;charset=utf-8"}),
    "Hoss-Guitar-Song.txt"
  );
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
