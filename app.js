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

const low = midiNumber("E1");
const high = midiNumber("A#4");

let midi = null;
let filename = "";


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
            Automatically select a useful
            musical track when possible.
        */

        const preferred =
            midi.tracks.findIndex(t =>
                /violin|melody|flute|lead|voice|guitar|piano|strings/i
                    .test(t.name)
            );


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


    if (song.bad.length > 0)
    {
        $("warning").textContent =
            `${song.bad.length} note(s) outside E1–A#4: ${
                [...new Set(
                    song.bad.map(midiName)
                )].join(", ")
            }. They are skipped.`;

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
   COPY
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


    for (const note of selectedTrack.notes)
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


        if (
            note.num < low ||
            note.num > high
        )
        {
            bad.push(note.num);
        }
        else
        {
            good.push(
            {
                start: start,
                duration: end - start,
                num: note.num
            });
        }
    }


    /*
        Group notes which start together.
        This creates chords such as:

        C4+E4+G4
    */

    const groups = new Map();


    for (const note of good)
    {
        const key =
            Math.round(
                note.start * 1000000
            );


        if (!groups.has(key))
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


    const rawEvents =
        [...groups.values()]
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
        Remove silence before the first
        musical note.

        First event becomes 0ms.
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
        events: events,

        count:
            good.length,

        bad: bad,

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

function createNotecard(song, filename)
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

        "# FORMAT: time_ms|notes"
    ];


    for (const event of song.events)
    {
        const time =
            Math.round(
                event.start * 1000
            );


        const notes =
            event.notes.join("+");


        lines.push(
            `${time}|${notes}`
        );
    }


    return lines.join("\n");
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
        return bytes[position++];
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
            byte = read8();


            value =
                (value << 7) |
                (byte & 127);
        }
        while (byte & 128);


        return value;
    }


    /*
        Header
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
        We keep the default 120 BPM
        only as a fallback.
    */

    const tempoEvents = [];


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


            /*
                Meta event
            */

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
                    TEMPO EVENT

                    0x51 = Set Tempo
                    3 bytes = microseconds
                    per quarter note
                */

                if (
                    metaType === 81 &&
                    length === 3
                )
                {
                    const tempo =
                        (
                            bytes[position] << 16
                        ) |
                        (
                            bytes[position + 1] << 8
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


            /*
                SysEx
            */

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


            /*
                NOTE ON / NOTE OFF
            */

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
                    activeNotes.has(key)
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
       TEMPO
    ========================= */

    /*
        If there were no tempo events,
        use MIDI's standard 120 BPM.
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
        Sort by tick.
    */

    tempoEvents.sort(
        (a, b) =>
            a.tick -
            b.tick
    );


    /*
        If multiple tempo events occur
        at the same tick, the LAST one
        is the effective tempo.
    */

    const effectiveTempos = [];


    for (
        const event of tempoEvents
    )
    {
        if (
            effectiveTempos.length &&
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
        If the first actual tempo is after
        tick 0, use 120 BPM until it.
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
        Build absolute tempo map.
    */

    const tempoMap = [];


    let lastTick =
        effectiveTempos[0].tick;


    let lastSec = 0;


    let lastTempo =
        effectiveTempos[0].tempo;


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
   MIDI NOTE NUMBER
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
            Number(match[2]) +
            1
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
        Math.round(seconds);


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