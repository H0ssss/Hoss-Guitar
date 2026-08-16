const $ = id => document.getElementById(id);

const file = $("file");
const drop = $("drop");
const info = $("info");
const tracks = $("tracks");
const track = $("track");
const convert = $("convert");
const result = $("result");
const output = $("output");
const copy = $("copy");
const status = $("status");

/*
    =========================
    GUITAR PROFILES
    =========================

    MDMAG Sustain Pick is the current available guitar.

    Future guitars can be added here without
    changing the MIDI conversion system.
*/

const guitars = [
    {
        id: "mdmag",
        name: "MDMAG",
        type: "Acoustic Guitar",
        low: midiNumber("E1"),
        high: midiNumber("C5"),

        /*
            These are the ACTUAL samples uploaded to the
            Second Life guitar.

            Do not assume every note between low/high exists.
            The converter uses this list when fitting notes.
        */
        availableNotes: [
            "E1",
            "F1", "F#1", "G1", "G#1", "A1", "A#1", "B1",
            "C2", "C#2", "D2", "D#2", "E2", "F2", "F#2", "G2", "G#2", "A2", "A#2", "B2",
            "C3", "C#3", "D3", "D#3", "E3", "F3", "F#3", "G3", "G#3", "A3", "A#3", "B3",
            "C4", "C#4", "D4", "D#4", "E4", "F4", "F#4", "G4", "G#4", "A4", "A#4", "B4",
            "C5"
        ].map(midiNumber),

        available: true
    },

    {
        id: "coming-soon-1",
        name: "Coming Soon",
        type: "New Guitar",
        available: false
    },

    {
        id: "coming-soon-2",
        name: "Coming Soon",
        type: "New Guitar",
        available: false
    }
];

let currentGuitar = guitars[0];

/*
    Pitch shift in semitones.
    Negative values make the guitar deeper.
    Example: -2 = two semitones lower.
*/
let pitchShift = 0;

/*
    Pitch handling modes:
    - octave: existing behavior, unchanged.
    - exact: never changes a MIDI note's octave; notes outside
      the selected guitar range are skipped and reported.
*/
let pitchHandling = "octave";

let midi = null;
let filename = "";


/* =========================
   GUITAR PICKER
========================= */

function createGuitarPicker()
{
    if (document.getElementById("guitar-picker"))
    {
        return;
    }

    const wrapper =
        document.createElement("div");

    wrapper.id =
        "guitar-picker";

    wrapper.innerHTML = `
                <div style="
                    margin-top: 16px;
                ">
                    <div style="
                        font-size: 12px;
                        font-weight: 700;
                        letter-spacing: 1.2px;
                        text-transform: uppercase;
                        opacity: .65;
                        margin-bottom: 10px;
                    ">
                        Pitch handling
                    </div>

                    <select id="pitch-handling" style="
                        width: 100%;
                        max-width: 320px;
                        border: 1px solid rgba(255,255,255,.14);
                        border-radius: 12px;
                        padding: 11px 13px;
                        background: rgba(255,255,255,.05);
                        color: inherit;
                        font: inherit;
                        cursor: pointer;
                    ">
                        <option value="octave" selected>Octave fit (current)</option>
                        <option value="exact">Exact range (skip outside)</option>
                    </select>

                    <div style="
                        margin-top: 7px;
                        font-size: 12px;
                        opacity: .55;
                    ">
                        Exact range keeps the original MIDI pitch and skips notes not present in the MDMAG sample set.
                    </div>
                </div>


        <div style="
            margin: 0 0 18px 0;
        ">
            <div style="
                font-size: 12px;
                font-weight: 700;
                letter-spacing: 1.2px;
                text-transform: uppercase;
                opacity: .65;
                margin-bottom: 10px;
            ">
                Choose your guitar
            </div>

            <div id="guitar-options" style="
                display: flex;
                gap: 10px;
                flex-wrap: wrap;
            "></div>

            <div id="guitar-description" style="
                margin-top: 9px;
                font-size: 12px;
                opacity: .65;
            "></div>

            <div style="
                margin-top: 16px;
            ">
                <div style="
                    font-size: 12px;
                    font-weight: 700;
                    letter-spacing: 1.2px;
                    text-transform: uppercase;
                    opacity: .65;
                    margin-bottom: 10px;
                ">
                    Pitch shift
                </div>

                <select id="pitch-shift" style="
                    width: 100%;
                    max-width: 320px;
                    border: 1px solid rgba(255,255,255,.14);
                    border-radius: 12px;
                    padding: 11px 13px;
                    background: rgba(255,255,255,.05);
                    color: inherit;
                    font: inherit;
                    cursor: pointer;
                ">
                    <option value="-6">-6 semitones</option>
                    <option value="-5">-5 semitones</option>
                    <option value="-4">-4 semitones</option>
                    <option value="-3">-3 semitones</option>
                    <option value="-2">-2 semitones</option>
                    <option value="-1">-1 semitone</option>
                    <option value="0" selected>Original pitch</option>
                    <option value="1">+1 semitone</option>
                    <option value="2">+2 semitones</option>
                    <option value="3">+3 semitones</option>
                    <option value="4">+4 semitones</option>
                    <option value="5">+5 semitones</option>
                    <option value="6">+6 semitones</option>
                </select>

                <div style="
                    margin-top: 7px;
                    font-size: 12px;
                    opacity: .55;
                ">
                    Negative values make the guitar deeper.
                </div>
            </div>
        </div>
    `;

    /*
        Put the picker above the MIDI track selector.
    */

    tracks.parentNode.insertBefore(
        wrapper,
        tracks
    );

    const options =
        document.getElementById(
            "guitar-options"
        );

    guitars.forEach(guitar =>
    {
        const button =
            document.createElement("button");

        button.type =
            "button";

        button.dataset.guitar =
            guitar.id;

        button.style.cssText = `
            position: relative;
            border: 1px solid rgba(255,255,255,.14);
            border-radius: 12px;
            padding: 11px 15px;
            background: rgba(255,255,255,.05);
            color: inherit;
            font: inherit;
            cursor: pointer;
            transition: .18s ease;
        `;

        if (guitar.available)
        {
            button.innerHTML =
                `🎸 <strong>${guitar.name}</strong>`;

            button.title =
                guitar.type;

            button.onclick = () =>
            {
                selectGuitar(
                    guitar.id
                );
            };
        }
        else
        {
            button.innerHTML =
                `<strong>${guitar.name}</strong>`;

            button.disabled =
                true;

            button.style.opacity =
                ".42";

            button.style.cursor =
                "not-allowed";

            button.title =
                "This guitar is coming soon";
        }

        options.appendChild(
            button
        );
    });

    selectGuitar(
        currentGuitar.id
    );
}


function selectGuitar(id)
{
    const guitar =
        guitars.find(
            item =>
                item.id === id &&
                item.available
        );

    if (!guitar)
    {
        return;
    }

    currentGuitar =
        guitar;

    const buttons =
        document.querySelectorAll(
            "#guitar-options button"
        );

    buttons.forEach(button =>
    {
        const active =
            button.dataset.guitar ===
            guitar.id;

        button.style.background =
            active
                ? "rgba(255,255,255,.14)"
                : "rgba(255,255,255,.05)";

        button.style.borderColor =
            active
                ? "rgba(255,255,255,.38)"
                : "rgba(255,255,255,.14)";

        button.style.transform =
            active
                ? "translateY(-1px)"
                : "none";
    });

    const description =
        document.getElementById(
            "guitar-description"
        );

    if (description)
    {
        description.textContent =
            `${guitar.name} • ${guitar.type}`;
    }
}


createGuitarPicker();


/* =========================
   PITCH SHIFT
========================= */

const pitchHandlingControl =
    document.getElementById(
        "pitch-handling"
    );

if (pitchHandlingControl)
{
    pitchHandlingControl.value =
        pitchHandling;

    pitchHandlingControl.onchange = () =>
    {
        pitchHandling =
            pitchHandlingControl.value;
    };
}

const pitchShiftControl =
    document.getElementById(
        "pitch-shift"
    );

if (pitchShiftControl)
{
    pitchShiftControl.value =
        String(pitchShift);

    pitchShiftControl.onchange = () =>
    {
        pitchShift =
            Number(
                pitchShiftControl.value
            );
    };
}


/* =========================
   FILE UPLOAD
========================= */

file.onchange = () =>
{
    if (file.files[0])
    {
        load(file.files[0]);
    }
};


["dragenter", "dragover"].forEach(eventName =>
{
    drop.addEventListener(eventName, event =>
    {
        event.preventDefault();
        drop.classList.add("drag");
    });
});


["dragleave", "drop"].forEach(eventName =>
{
    drop.addEventListener(eventName, event =>
    {
        event.preventDefault();
        drop.classList.remove("drag");
    });
});


drop.ondrop = event =>
{
    if (event.dataTransfer.files[0])
    {
        load(event.dataTransfer.files[0]);
    }
};


/* =========================
   LOAD MIDI
========================= */

async function load(selectedFile)
{
    try
    {
        const bytes =
            new Uint8Array(
                await selectedFile.arrayBuffer()
            );

        midi = parseMidi(bytes);

        filename = selectedFile.name;

        info.textContent =
            `${filename} • ${midi.tracks.length} tracks • ${midi.tpb} ticks/beat`;

        track.innerHTML = "";

        midi.tracks.forEach((t, index) =>
        {
            const option =
                document.createElement("option");

            option.value = index;

            option.textContent =
                `${index + 1}. ${
                    t.name || "Untitled track"
                } (${t.notes.length} notes)`;

            track.appendChild(option);
        });


        /*
            Prefer an actual guitar track.
        */

        let preferred =
            midi.tracks.findIndex(t =>
                /nylon\s*gtr|nylon\s*guitar|guitar|gtr/i
                    .test(t.name)
            );


        /*
            If there is no guitar track,
            look for another musical track.
        */

        if (preferred === -1)
        {
            preferred =
                midi.tracks.findIndex(t =>
                    /piano|strings|violin|melody|flute|lead|voice/i
                        .test(t.name)
                );
        }


        /*
            Last fallback:
            choose the first non-drum track.
        */

        if (preferred === -1)
        {
            preferred =
                midi.tracks.findIndex(t =>
                    !/drum|percussion|perc/i
                        .test(t.name)
                );
        }


        track.value =
            String(
                preferred >= 0
                    ? preferred
                    : 0
            );


        tracks.classList.remove("hidden");

        result.classList.add("hidden");
    }
    catch (error)
    {
        console.error(error);

        info.textContent =
            "Could not read MIDI: " +
            error.message;

        tracks.classList.add("hidden");

        result.classList.add("hidden");
    }
}


/* =========================
   CONVERT
========================= */

convert.onclick = () =>
{
    if (!midi)
    {
        return;
    }


    const selectedTrack =
        midi.tracks[
            Number(track.value)
        ];


    const song =
        build(
            selectedTrack,
            midi.tempo,
            midi.tpb
        );


    $("title").textContent =
        filename.replace(
            /\.(mid|midi)$/i,
            ""
        );


    $("sTrack").textContent =
        selectedTrack.name ||
        "Untitled";


    $("sEvents").textContent =
        song.events.length;


    $("sNotes").textContent =
        song.count;


    $("sTempo").textContent =
        song.bpm.toFixed(1) +
        " BPM";


    $("sDuration").textContent =
        formatDuration(song.length);

    /*
        Show unsupported notes.
    */

    if (song.bad.length > 0)
    {
        const uniqueBad =
            [
                ...new Set(
                    song.bad.map(
                        midiName
                    )
                )
            ];


        $("warning").textContent =
            pitchHandling === "exact"
                ? `${song.bad.length} note(s) have no exact MDMAG sample and were skipped: ${
                    uniqueBad.join(", ")
                }`
                : `${song.bad.length} note(s) could not be fitted to the MDMAG sample set: ${
                    uniqueBad.join(", ")
                }`;


        $("warning")
            .classList
            .remove("hidden");
    }
    else
    {
        $("warning")
            .classList
            .add("hidden");
    }


    output.value =
        createNotecard(
            song,
            filename
        );


    status.textContent = "";

    result.classList.remove("hidden");
};


/* =========================
   COPY SONG
========================= */

copy.onclick = async () =>
{
    try
    {
        await navigator.clipboard.writeText(
            output.value
        );
    }
    catch (error)
    {
        output.select();

        document.execCommand("copy");
    }


    status.textContent =
        "✓ Copied. Paste it into a Second Life notecard.";


    copy.textContent =
        "Copied!";


    setTimeout(() =>
    {
        copy.textContent =
            "Copy song";
    }, 1500);
};


/* =========================
   BUILD SONG
========================= */

function build(
    selectedTrack,
    tempoMap,
    ticksPerBeat
)
{
    const good = [];
    const bad = [];


    for (
        const note of selectedTrack.notes
    )
    {
        const start =
            ticksToSeconds(
                note.start,
                tempoMap,
                ticksPerBeat
            );


        const end =
            ticksToSeconds(
                note.end,
                tempoMap,
                ticksPerBeat
            );


        /*
            Apply the user's pitch shift first.
        */

        let fittedNum =
            note.num +
            pitchShift;

        /*
            MDMAG pitch handling:

            The sample library is NOT chromatically complete
            across one simple low/high range, so checking only
            E1–C5 is not enough.

            OCTAVE FIT:
            1. Keep the exact MIDI pitch if that sample exists.
            2. Otherwise move ONLY by octaves.
            3. Choose the closest available octave.
            4. Never change the note's pitch class.

            Examples:
                C5  -> C5
                D5  -> D4
                D1  -> D2
                F#5 -> F#4

            EXACT:
            Keep the exact pitch only. If that exact sample
            does not exist, skip the note.
        */

        const available =
            currentGuitar.availableNotes || [];

        if (pitchHandling === "exact")
        {
            if (!available.includes(fittedNum))
            {
                bad.push(fittedNum);
                continue;
            }
        }
        else
        {
            if (!available.includes(fittedNum))
            {
                let best =
                    null;

                let bestDistance =
                    Infinity;

                /*
                    Search nearby octaves only.
                    ±8 octaves is more than enough for normal MIDI.
                */
                for (
                    let octave = -8;
                    octave <= 8;
                    octave++
                )
                {
                    const candidate =
                        fittedNum +
                        (octave * 12);

                    if (
                        !available.includes(candidate)
                    )
                    {
                        continue;
                    }

                    const distance =
                        Math.abs(octave);

                    if (
                        distance <
                        bestDistance
                    )
                    {
                        best =
                            candidate;

                        bestDistance =
                            distance;
                    }
                }

                if (best === null)
                {
                    bad.push(fittedNum);
                    continue;
                }

                fittedNum =
                    best;
            }
        }

        good.push(
        {
            start:
                start,

            duration:
                end - start,

            num:
                fittedNum
        });
    }


    /*
        Group notes that start together.

        Example:

        C4 + E4 + G4
    */

    const groups =
        new Map();


    for (
        const note of good
    )
    {
        const key =
            Math.round(
                note.start *
                1000000
            );


        if (
            !groups.has(key)
        )
        {
            groups.set(
                key,
                []
            );
        }


        groups
            .get(key)
            .push(note);
    }


    /*
        Convert groups into
        playable events.
    */

    const rawEvents =
        [
            ...groups.values()
        ]
        .sort(
            (a, b) =>
                a[0].start -
                b[0].start
        )
        .map(group =>
        {
            return {
                start:
                    group[0].start,

                duration:
                    Math.max(
                        ...group.map(
                            note =>
                                note.duration
                        )
                    ),

                notes:
                    group
                        .sort(
                            (a, b) =>
                                a.num -
                                b.num
                        )
                        .map(
                            note =>
                                midiName(
                                    note.num
                                )
                        )
            };
        });


    /*
        Remove silence before
        the first musical note.

        First note becomes 0ms.
    */

    const firstTime =
        rawEvents.length
            ? rawEvents[0].start
            : 0;


    const events =
        rawEvents.map(event =>
        {
            return {
                start:
                    event.start -
                    firstTime,

                duration:
                    event.duration,

                notes:
                    event.notes
            };
        });


    return {
        events:
            events,

        count:
            good.length,

        bad:
            bad,

        bpm:
            tempoMap.length
                ? tempoMap[0].bpm
                : 120,

        length:
            events.length
                ? events[
                    events.length - 1
                ].start +
                  events[
                    events.length - 1
                ].duration
                : 0
    };
}


/* =========================
   CREATE NOTECARD
========================= */

function createNotecard(
    song,
    filename
)
{
    const name =
        filename.replace(
            /\.(mid|midi)$/i,
            ""
        );


    const lines =
    [
        "# " +
        name.toUpperCase(),

        "# BPM=" +
        song.bpm.toFixed(3),

        "# GUITAR=" +
        currentGuitar.name,

        "# FORMAT: time_ms|notes"
    ];


    for (
        const event of song.events
    )
    {
        const time =
            Math.round(
                event.start *
                1000
            );


        const notes =
            event.notes.join(
                "+"
            );


        lines.push(
            `${time}|${notes}`
        );
    }


    return lines.join(
        "\n"
    );
}

/* =========================
   TICKS → SECONDS
========================= */

function ticksToSeconds(
    tick,
    tempoMap,
    ticksPerBeat
)
{
    if (
        !tempoMap ||
        tempoMap.length === 0
    )
    {
        return (
            tick *
            0.5 /
            ticksPerBeat
        );
    }


    let current =
        tempoMap[0];


    for (
        let i = 1;
        i < tempoMap.length;
        i++
    )
    {
        if (
            tempoMap[i].tick >
            tick
        )
        {
            break;
        }


        current =
            tempoMap[i];
    }


    return (
        current.sec +
        (
            tick -
            current.tick
        ) *
        (
            current.tempo /
            1000000
        ) /
        ticksPerBeat
    );
}


/* =========================
   MIDI PARSER
========================= */

function parseMidi(bytes)
{
    let position = 0;


    function read8()
    {
        return bytes[
            position++
        ];
    }


    function read16()
    {
        const value =
            bytes[position] * 256 +
            bytes[position + 1];


        position += 2;


        return value;
    }


    function read32()
    {
        const value =
            bytes[position] *
            16777216 +

            bytes[position + 1] *
            65536 +

            bytes[position + 2] *
            256 +

            bytes[position + 3];


        position += 4;


        return value >>> 0;
    }


    function readString(length)
    {
        let value = "";


        for (
            let i = 0;
            i < length;
            i++
        )
        {
            value +=
                String.fromCharCode(
                    bytes[position++]
                );
        }


        return value;
    }


    function readVLQ()
    {
        let value = 0;
        let byte;


        do
        {
            byte =
                read8();


            value =
                (value << 7) |
                (byte & 127);
        }
        while (
            byte & 128
        );


        return value;
    }


    /*
        MIDI header
    */

    if (
        readString(4) !==
        "MThd"
    )
    {
        throw new Error(
            "Not a MIDI file"
        );
    }


    const headerLength =
        read32();


    const format =
        read16();


    const trackCount =
        read16();


    const ticksPerBeat =
        read16();


    position +=
        Math.max(
            0,
            headerLength - 6
        );


    const tracks = [];


    /*
        Tempo events.
        120 BPM is only the fallback.
    */

    const tempoEvents =
        [];


    /* =========================
       READ TRACKS
    ========================= */

    for (
        let trackIndex = 0;
        trackIndex < trackCount;
        trackIndex++
    )
    {
        if (
            readString(4) !==
            "MTrk"
        )
        {
            throw new Error(
                "Invalid MIDI track"
            );
        }


        const trackLength =
            read32();


        const trackEnd =
            position +
            trackLength;


        let absoluteTick = 0;

        let runningStatus = 0;

        let trackName = "";


        const notes = [];

        const activeNotes =
            new Map();


        while (
            position <
            trackEnd
        )
        {
            absoluteTick +=
                readVLQ();


            let status =
                bytes[position];


            /*
                Running status
            */

            if (
                status < 128
            )
            {
                status =
                    runningStatus;
            }
            else
            {
                position++;

                runningStatus =
                    status;
            }


            /* =====================
               META EVENTS
            ===================== */

            if (
                status === 255
            )
            {
                const metaType =
                    read8();


                const length =
                    readVLQ();


                /*
                    Track name
                */

                if (
                    metaType === 3
                )
                {
                    trackName =
                        new TextDecoder()
                            .decode(
                                bytes.slice(
                                    position,
                                    position + length
                                )
                            );
                }


                /*
                    Set Tempo

                    0x51
                */

                if (
                    metaType === 81 &&
                    length === 3
                )
                {
                    const tempo =
                        (
                            bytes[position] <<
                            16
                        ) |
                        (
                            bytes[position + 1] <<
                            8
                        ) |
                        bytes[position + 2];


                    tempoEvents.push(
                    {
                        tick:
                            absoluteTick,

                        tempo:
                            tempo
                    });
                }


                position +=
                    length;


                continue;
            }


            /* =====================
               SYSEX
            ===================== */

            if (
                status === 240 ||
                status === 247
            )
            {
                const length =
                    readVLQ();


                position +=
                    length;


                continue;
            }


            const eventType =
                status & 240;


            const channel =
                status & 15;


            /* =====================
               NOTE ON / OFF
            ===================== */

            if (
                eventType === 128 ||
                eventType === 144
            )
            {
                const noteNumber =
                    read8();


                const velocity =
                    read8();


                const key =
                    channel +
                    ":" +
                    noteNumber;


                /*
                    NOTE ON
                */

                if (
                    eventType === 144 &&
                    velocity > 0
                )
                {
                    activeNotes.set(
                        key,
                        {
                            tick:
                                absoluteTick,

                            velocity:
                                velocity
                        }
                    );
                }


                /*
                    NOTE OFF
                */

                else if (
                    activeNotes.has(
                        key
                    )
                )
                {
                    const note =
                        activeNotes.get(
                            key
                        );


                    notes.push(
                    {
                        start:
                            note.tick,

                        end:
                            Math.max(
                                absoluteTick,
                                note.tick
                            ),

                        num:
                            noteNumber,

                        velocity:
                            note.velocity
                    });


                    activeNotes.delete(
                        key
                    );
                }
            }


            /*
                Polyphonic pressure
                Control change
                Pitch bend
            */

            else if (
                eventType === 160 ||
                eventType === 176 ||
                eventType === 224
            )
            {
                position += 2;
            }


            /*
                Program change
                Channel pressure
            */

            else if (
                eventType === 192 ||
                eventType === 208
            )
            {
                position += 1;
            }


            else
            {
                throw new Error(
                    "Unsupported MIDI event: 0x" +
                    status.toString(16)
                );
            }
        }


        position =
            trackEnd;


        tracks.push(
        {
            name:
                trackName,

            notes:
                notes
        });
    }

    /* =========================
       TEMPO MAP
    ========================= */

    /*
        If there are no tempo events,
        use the standard MIDI tempo:
        120 BPM.
    */

    if (
        tempoEvents.length === 0
    )
    {
        tempoEvents.push(
        {
            tick: 0,

            tempo: 500000
        });
    }


    /*
        Sort tempo events by tick.
    */

    tempoEvents.sort(
        (a, b) =>
            a.tick -
            b.tick
    );


    /*
        If multiple tempo events happen
        at exactly the same tick, the LAST
        one is the actual tempo.
    */

    const effectiveTempos =
        [];


    for (
        const event of tempoEvents
    )
    {
        if (
            effectiveTempos.length > 0 &&
            effectiveTempos[
                effectiveTempos.length - 1
            ].tick === event.tick
        )
        {
            effectiveTempos[
                effectiveTempos.length - 1
            ].tempo =
                event.tempo;
        }
        else
        {
            effectiveTempos.push(
            {
                tick:
                    event.tick,

                tempo:
                    event.tempo
            });
        }
    }


    /*
        If the first tempo event starts
        after tick 0, use 120 BPM until
        that point.
    */

    if (
        effectiveTempos[0].tick > 0
    )
    {
        effectiveTempos.unshift(
        {
            tick: 0,

            tempo: 500000
        });
    }


    /*
        Build the tempo map.

        This is what fixes MIDI files
        such as Shape of My Heart where
        the actual tempo is NOT 120 BPM.
    */

    const tempoMap = [];


    let lastTick =
        effectiveTempos[0].tick;


    let lastSec = 0;


    let lastTempo =
        effectiveTempos[0].tempo;


    /*
        First tempo entry.
    */

    tempoMap.push(
    {
        tick:
            lastTick,

        sec:
            0,

        tempo:
            lastTempo,

        bpm:
            60000000 /
            lastTempo
    });


    /*
        Later tempo changes.
    */

    for (
        let i = 1;
        i < effectiveTempos.length;
        i++
    )
    {
        const event =
            effectiveTempos[i];


        lastSec +=
            (
                event.tick -
                lastTick
            ) *
            (
                lastTempo /
                1000000
            ) /
            ticksPerBeat;


        lastTick =
            event.tick;


        lastTempo =
            event.tempo;


        tempoMap.push(
        {
            tick:
                lastTick,

            sec:
                lastSec,

            tempo:
                lastTempo,

            bpm:
                60000000 /
                lastTempo
        });
    }


    return {
        format:
            format,

        tpb:
            ticksPerBeat,

        tracks:
            tracks,

        tempo:
            tempoMap
    };
}


/* =========================
   MIDI NUMBER
========================= */

function midiNumber(note)
{
    const match =
        note.match(
            /^([A-G]#?)(-?\d+)$/
        );


    if (!match)
    {
        throw new Error(
            "Invalid note: " +
            note
        );
    }


    const values =
    {
        C: 0,
        "C#": 1,
        D: 2,
        "D#": 3,
        E: 4,
        F: 5,
        "F#": 6,
        G: 7,
        "G#": 8,
        A: 9,
        "A#": 10,
        B: 11
    };


    return (
        (
            Number(
                match[2]
            ) + 1
        ) *
        12
        +
        values[
            match[1]
        ]
    );
}


/* =========================
   MIDI NUMBER → NOTE
========================= */

function midiName(number)
{
    const names =
    [
        "C",
        "C#",
        "D",
        "D#",
        "E",
        "F",
        "F#",
        "G",
        "G#",
        "A",
        "A#",
        "B"
    ];


    return (
        names[
            number % 12
        ] +
        (
            Math.floor(
                number / 12
            ) - 1
        )
    );
}


/* =========================
   DURATION
========================= */

function formatDuration(seconds)
{
    seconds =
        Math.round(
            seconds
        );


    const minutes =
        Math.floor(
            seconds / 60
        );


    const remaining =
        seconds % 60;


    return (
        minutes +
        ":" +
        String(
            remaining
        ).padStart(
            2,
            "0"
        )
    );
}
