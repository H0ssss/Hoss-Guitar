HOSS GUITAR WEBSITE - MUSIC STUDIO

FOLDER FOR MDMAG SOUNDS
=======================

Put ALL of the MDMAG WAV files here:

assets/guitars/mdmag/

The folder should look like:

assets/
  guitars/
    mdmag/
      E1.wav
      F1.wav
      F#1.wav
      G1.wav
      G#1.wav
      A1.wav
      A#1.wav
      B1.wav
      C2.wav
      C#2.wav
      ...
      C5.wav

IMPORTANT:
- Use the exact note names.
- Keep the .wav extension.
- Do not rename # to "sharp".
- The current MDMAG configuration expects E1 through C5 (43 chromatic notes).
- If your actual filenames differ, tell me the naming and I can adjust the configuration.

WHAT IS INCLUDED
================

index.html
  Your existing MIDI Converter, with navigation to the Music Studio.

app.js
  Your existing MIDI conversion logic.

style.css
  Existing converter styling plus navigation.

studio.html
  New browser-based Hoss Guitar Music Studio.

studio.js
  Piano roll, MDMAG sample playback, BPM, autosave, project save/load,
  and standard MIDI export.

studio.css
  Music Studio styling.

SAVING
======

The Studio automatically saves the current project in the user's browser
using localStorage.

A browser refresh does NOT normally erase the project.

Users can also click "Save Project" to download a .hoss project file.
That file can be loaded later with "Load Project".

SAMPLES
=======

The WAV samples remain on your website. Users do not need to download
the individual WAV files manually.

The browser loads a sample when that note is first used and caches it
during the session.

DEPLOYMENT
==========

Upload the whole folder to your web host / Cloudflare Pages project.
Do not upload only the HTML file.

The URL structure will be:

/index.html
/studio.html
/app.js
/style.css
/studio.js
/studio.css
/assets/guitars/mdmag/E1.wav
...

For future guitars, add another folder:

assets/guitars/future-guitar/

and add a new guitar configuration in studio.js.
