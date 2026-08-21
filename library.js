(() => {
  const $ = id => document.getElementById(id);
  const alphabet = ["ALL", "#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

  let supabaseClient = null;
  let songs = [];
  let activeLetter = "ALL";

  const MAX_BYTES = 500 * 1024;

  function showError(message) {
    const el = $("error");
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function clearError() {
    $("error").classList.add("hidden");
    $("error").textContent = "";
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Validates the REAL HOSS format used by your Studio.
  // Example:
  // # SONG NAME
  // # BPM=64.000
  // # GUITAR=Serenelle
  // # FORMAT: time_ms|notes
  // 0|A3+A4
  function isValidHossText(text) {
    const clean = text.replace(/\r/g, "").trim();
    if (!clean) return false;

    const lines = clean.split("\n").map(x => x.trim()).filter(Boolean);

    const hasFormat = lines.some(x =>
      /^#[\s]*FORMAT[\s]*:[\s]*time_ms[\s]*\|[\s]*notes/i.test(x)
    );

    const hasNote = lines.some(x => {
      if (x.startsWith("#")) return false;

      const separator = x.indexOf("|");
      if (separator <= 0) return false;

      const time = Number(x.slice(0, separator).trim());
      const notes = x.slice(separator + 1).trim();

      return Number.isFinite(time) && time >= 0 && notes.length > 0;
    });

    return hasFormat && hasNote;
  }

  function titleFromFilename(name) {
    return name.replace(/\.txt$/i, "").trim();
  }

  function voteKey(songId) {
    return `hoss-library-vote:${songId}`;
  }

  function getVote(songId) {
    try { return localStorage.getItem(voteKey(songId)) || ""; }
    catch { return ""; }
  }

  function setVote(songId, value) {
    try { localStorage.setItem(voteKey(songId), value); }
    catch {}
  }

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        year: "numeric", month: "short", day: "numeric"
      }).format(new Date(value));
    } catch {
      return "";
    }
  }

  function filteredSongs() {
    const query = $("search").value.trim().toLowerCase();
    const sort = $("sort").value;

    let result = songs.filter(song => {
      const title = String(song.title || "");
      const matchesSearch = !query || title.toLowerCase().includes(query);

      const first = title.trim().charAt(0).toUpperCase();
      const matchesLetter =
        activeLetter === "ALL" ||
        (activeLetter === "#" ? !/[A-Z]/.test(first) : first === activeLetter);

      return matchesSearch && matchesLetter;
    });

    result.sort((a, b) => {
      if (sort === "az") return a.title.localeCompare(b.title, undefined, {sensitivity:"base"});
      if (sort === "za") return b.title.localeCompare(a.title, undefined, {sensitivity:"base"});
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      return sort === "oldest" ? da - db : db - da;
    });

    return result;
  }

  function renderLetters() {
    $("letters").innerHTML = alphabet.map(letter => `
      <button class="letter ${letter === activeLetter ? "active" : ""}" data-letter="${escapeHtml(letter)}">
        ${escapeHtml(letter)}
      </button>
    `).join("");

    $("letters").querySelectorAll(".letter").forEach(btn => {
      btn.addEventListener("click", () => {
        activeLetter = btn.dataset.letter;
        renderLetters();
        renderSongs();
      });
    });
  }

  function renderSongs() {
    const list = filteredSongs();
    const library = $("library");

    if (!list.length) {
      library.innerHTML = "";
      $("empty").classList.remove("hidden");
      return;
    }

    $("empty").classList.add("hidden");

    library.innerHTML = list.map(song => {
      const vote = getVote(song.id);
      return `
        <article class="song">
          <div>
            <div class="song-title">🎵 ${escapeHtml(song.title)}</div>
            <div class="song-date">Added ${escapeHtml(formatDate(song.created_at))}</div>
          </div>
          <div class="song-actions">
            <button class="secondary ${vote === "like" ? "voted" : ""}" data-action="like" data-id="${song.id}">
              ❤️ <span class="vote-count">${song.likes}</span>
            </button>
            <button class="secondary ${vote === "dislike" ? "voted" : ""}" data-action="dislike" data-id="${song.id}">
              👎 <span class="vote-count">${song.dislikes}</span>
            </button>
            <button class="secondary" data-action="open" data-id="${song.id}">🎹 Open in Studio</button>
            <button data-action="download" data-id="${song.id}">📥 Download</button>
          </div>
        </article>
      `;
    }).join("");

    library.querySelectorAll("button[data-action]").forEach(btn => {
      btn.addEventListener("click", () => handleSongAction(btn.dataset.action, btn.dataset.id));
    });
  }

  async function loadSongs() {
    clearError();

    const { data, error } = await supabaseClient
      .from("hoss_songs")
      .select("id,title,content,likes,dislikes,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      showError(`Could not load the Library: ${error.message}`);
      return;
    }

    songs = data || [];
    renderSongs();
  }

  async function uploadSong(file) {
    clearError();
    const status = $("uploadStatus");

    if (!file) return;

    if (!/\.txt$/i.test(file.name)) {
      status.textContent = "Please choose a TXT file only.";
      status.classList.add("error");
      return;
    }

    if (file.size > MAX_BYTES) {
      status.textContent = "This TXT file is too large. Maximum size is 500 KB.";
      status.classList.add("error");
      return;
    }

    status.classList.remove("error");
    status.textContent = "Checking song…";

    const text = await file.text();

    if (!isValidHossText(text)) {
      status.textContent = "This does not look like a valid HOSS Guitar song.";
      status.classList.add("error");
      return;
    }

    const title = titleFromFilename(file.name);
    if (!title) {
      status.textContent = "The TXT filename must contain a song title.";
      status.classList.add("error");
      return;
    }

    status.textContent = "Uploading…";

    const { error } = await supabaseClient
      .from("hoss_songs")
      .insert({
        title,
        content: text,
        likes: 0,
        dislikes: 0
      });

    if (error) {
      status.textContent = `Upload failed: ${error.message}`;
      status.classList.add("error");
      return;
    }

    status.textContent = `🎵 "${title}" added to the Library.`;
    $("songFile").value = "";
    await loadSongs();
  }

  async function vote(songId, type) {
    // One vote per song per browser.
    if (getVote(songId)) return;

    const fn = type === "like" ? "hoss_like_song" : "hoss_dislike_song";

    const { data, error } = await supabaseClient.rpc(fn, { song_id: songId });

    if (error) {
      showError(`Vote failed: ${error.message}`);
      return;
    }

    const song = songs.find(s => s.id === songId);
    if (!song) return;

    if (type === "like") song.likes = Number(data);
    else song.dislikes = Number(data);

    setVote(songId, type);
    renderSongs();
  }

  function openInStudio(songId) {
    const song = songs.find(s => s.id === songId);
    if (!song) return;

    localStorage.setItem("hoss-guitar-library-import", JSON.stringify({
      title: song.title,
      text: song.content
    }));

    location.href = "studio.html";
  }

  function downloadSong(songId) {
    const song = songs.find(s => s.id === songId);
    if (!song) return;

    const blob = new Blob([song.content], {type: "text/plain;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${song.title}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleSongAction(action, id) {
    if (action === "like" || action === "dislike") {
      await vote(id, action);
    } else if (action === "open") {
      openInStudio(id);
    } else if (action === "download") {
      downloadSong(id);
    }
  }

  function init() {
    if (
      !window.HOSS_SUPABASE_URL ||
      !window.HOSS_SUPABASE_ANON_KEY ||
      window.HOSS_SUPABASE_URL === "YOUR_SUPABASE_URL" ||
      window.HOSS_SUPABASE_ANON_KEY === "YOUR_SUPABASE_ANON_KEY"
    ) {
      showError("Supabase is not configured yet.");
      renderLetters();
      renderSongs();
      return;
    }

    supabaseClient = window.supabase.createClient(
      window.HOSS_SUPABASE_URL,
      window.HOSS_SUPABASE_ANON_KEY
    );

    renderLetters();
    $("search").addEventListener("input", renderSongs);
    $("sort").addEventListener("change", renderSongs);
    $("songFile").addEventListener("change", e => uploadSong(e.target.files[0]));

    loadSongs();
  }

  init();
})();
