/**
 * Standard MIDI File (SMF Format 1) Encoder in pure TypeScript
 * Generates binary .mid files with multi-track event streams, tempo, meta events,
 * and note-on/note-off scheduling.
 */

import { SongProject, Track } from '../types';

// Convert note string like "C4", "F#3" or "Bb5" to MIDI number
export function noteNameToMidi(name: string): number {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const regex = /^([A-G][#b]?)(-?\d+)$/i;
  const match = name.trim().match(regex);
  if (!match) return 60; // Default C4

  let note = match[1].toUpperCase();
  const octave = parseInt(match[2], 10);

  // Normalize flats
  const flatMap: Record<string, string> = {
    'DB': 'C#',
    'EB': 'D#',
    'GB': 'F#',
    'AB': 'G#',
    'BB': 'A#',
  };
  if (flatMap[note]) {
    note = flatMap[note];
  }

  const noteIndex = notes.indexOf(note);
  if (noteIndex === -1) return 60;

  return (octave + 1) * 12 + noteIndex;
}

export function midiToNoteName(midi: number): string {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteIndex = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${notes[noteIndex]}${octave}`;
}

// GM Instrument program map
const GM_INSTRUMENT_MAP: Record<string, number> = {
  acoustic_grand_piano: 0,   // Acoustic Grand Piano
  electric_piano: 4,         // Electric Piano 1 (Rhodes)
  acoustic_guitar: 24,       // Acoustic Guitar (nylon)
  electric_guitar: 29,       // Overdriven Guitar
  synth_lead: 80,            // Lead 1 (square)
  synth_pad: 89,             // Pad 2 (warm)
  electric_bass: 33,         // Electric Bass (finger)
  sub_bass_808: 38,          // Synth Bass 1
  drum_kit: 0,               // Channel 10 is standard drum channel in MIDI
  strings_ensemble: 48,      // String Ensemble 1
  brass_section: 61,         // Brass Section
  flute_sax: 73,             // Flute
};

interface MidiEvent {
  tick: number;
  type: 'note-on' | 'note-off' | 'program-change' | 'track-name';
  channel: number;
  data1: number; // pitch or program or text length
  data2: number; // velocity
  text?: string;
}

function writeVariableLength(value: number): number[] {
  let buffer = value & 0x7f;
  const bytes: number[] = [];

  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }

  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) {
      buffer >>= 8;
    } else {
      break;
    }
  }

  return bytes;
}

function writeString(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i) & 0xff);
  }
  return bytes;
}

function writeUint16(val: number): number[] {
  return [(val >> 8) & 0xff, val & 0xff];
}

function writeUint32(val: number): number[] {
  return [
    (val >> 24) & 0xff,
    (val >> 16) & 0xff,
    (val >> 8) & 0xff,
    val & 0xff,
  ];
}

export function generateMidiFile(project: SongProject): Uint8Array {
  const TICKS_PER_BEAT = 480;
  const bpm = project.bpm || 120;
  const microsecondsPerBeat = Math.round(60000000 / bpm);

  const tracksBytes: number[][] = [];

  // Track 0: Tempo and Time Signature meta track
  const tempoTrackEvents: number[] = [];
  
  // Delta-time 0: Time Signature (4/4 -> 04 02 18 08)
  tempoTrackEvents.push(...writeVariableLength(0));
  tempoTrackEvents.push(0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

  // Delta-time 0: Set Tempo (Microseconds per quarter note)
  tempoTrackEvents.push(...writeVariableLength(0));
  tempoTrackEvents.push(
    0xff,
    0x51,
    0x03,
    (microsecondsPerBeat >> 16) & 0xff,
    (microsecondsPerBeat >> 8) & 0xff,
    microsecondsPerBeat & 0xff
  );

  // Delta-time 0: Track Name "Master Tempo"
  const masterTitle = `${project.title} - Harmonix AI`;
  tempoTrackEvents.push(...writeVariableLength(0));
  tempoTrackEvents.push(0xff, 0x03, masterTitle.length, ...writeString(masterTitle));

  // End of Track meta event
  tempoTrackEvents.push(...writeVariableLength(TICKS_PER_BEAT));
  tempoTrackEvents.push(0xff, 0x2f, 0x00);

  // Wrap Track 0 in MTrk chunk
  const track0Chunk: number[] = [
    0x4d, 0x54, 0x72, 0x6b, // 'MTrk'
    ...writeUint32(tempoTrackEvents.length),
    ...tempoTrackEvents,
  ];
  tracksBytes.push(track0Chunk);

  // Tracks 1..N: Instrument tracks
  project.tracks.forEach((track, index) => {
    const isDrums = track.instrument === 'drum_kit';
    // MIDI Channel 9 (0-indexed, which is channel 10 in 1-indexed MIDI standard) is reserved for percussion
    const channel = isDrums ? 9 : (index >= 9 ? index + 1 : index) % 16;
    const programNumber = GM_INSTRUMENT_MAP[track.instrument] ?? 0;

    const events: MidiEvent[] = [];

    // Track Name Event at tick 0
    events.push({
      tick: 0,
      type: 'track-name',
      channel,
      data1: 0,
      data2: 0,
      text: track.name || `Track ${index + 1}`,
    });

    // Program change event at tick 0
    if (!isDrums) {
      events.push({
        tick: 0,
        type: 'program-change',
        channel,
        data1: programNumber,
        data2: 0,
      });
    }

    // Convert notes into Note-On and Note-Off events
    track.notes.forEach((note) => {
      const startTick = Math.max(0, Math.round(note.startBeat * TICKS_PER_BEAT));
      const durationTicks = Math.max(120, Math.round(note.duration * TICKS_PER_BEAT));
      const endTick = startTick + durationTicks;

      const pitch = note.midi || noteNameToMidi(note.pitch);
      const velocity = Math.min(127, Math.max(20, note.velocity || 90));

      events.push({
        tick: startTick,
        type: 'note-on',
        channel,
        data1: pitch,
        data2: velocity,
      });

      events.push({
        tick: endTick,
        type: 'note-off',
        channel,
        data1: pitch,
        data2: 0,
      });
    });

    // Sort events by tick (note-offs before note-ons if on the same tick)
    events.sort((a, b) => {
      if (a.tick !== b.tick) return a.tick - b.tick;
      if (a.type === 'note-off' && b.type === 'note-on') return -1;
      if (a.type === 'note-on' && b.type === 'note-off') return 1;
      return 0;
    });

    // Encode events with delta-times
    const trackBytes: number[] = [];
    let lastTick = 0;

    events.forEach((ev) => {
      const delta = ev.tick - lastTick;
      trackBytes.push(...writeVariableLength(Math.max(0, delta)));
      lastTick = ev.tick;

      if (ev.type === 'track-name' && ev.text) {
        trackBytes.push(0xff, 0x03, ev.text.length, ...writeString(ev.text));
      } else if (ev.type === 'program-change') {
        trackBytes.push(0xc0 | (ev.channel & 0x0f), ev.data1 & 0x7f);
      } else if (ev.type === 'note-on') {
        trackBytes.push(0x90 | (ev.channel & 0x0f), ev.data1 & 0x7f, ev.data2 & 0x7f);
      } else if (ev.type === 'note-off') {
        trackBytes.push(0x80 | (ev.channel & 0x0f), ev.data1 & 0x7f, 0);
      }
    });

    // End of track meta event
    trackBytes.push(...writeVariableLength(TICKS_PER_BEAT));
    trackBytes.push(0xff, 0x2f, 0x00);

    // MTrk chunk
    const chunk: number[] = [
      0x4d, 0x54, 0x72, 0x6b, // 'MTrk'
      ...writeUint32(trackBytes.length),
      ...trackBytes,
    ];
    tracksBytes.push(chunk);
  });

  // Header chunk: 'MThd', length 6, format 1, numTracks, ticksPerBeat
  const totalTracks = tracksBytes.length;
  const headerBytes: number[] = [
    0x4d, 0x54, 0x68, 0x64, // 'MThd'
    0x00, 0x00, 0x00, 0x06, // Header length = 6
    0x00, 0x01,             // Format 1 (multi-track synchronous)
    ...writeUint16(totalTracks),
    ...writeUint16(TICKS_PER_BEAT),
  ];

  // Concatenate all chunks
  const allBytes: number[] = [...headerBytes];
  tracksBytes.forEach((t) => allBytes.push(...t));

  return new Uint8Array(allBytes);
}

export function downloadMidi(project: SongProject, filename?: string): void {
  const midiBytes = generateMidiFile(project);
  const blob = new Blob([midiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `${project.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.mid`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
