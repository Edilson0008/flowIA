import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: '.env.local' });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ---------------------------------------------------------------------------
// Gemini client (lazy — never crashes when key is missing)
// ---------------------------------------------------------------------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_TEXT_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash'];

async function getGeminiClient(): Promise<{ ai: import('@google/genai').GoogleGenAI } | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const { GoogleGenAI } = await import('@google/genai');
    return { ai: new GoogleGenAI({ apiKey: GEMINI_API_KEY }) };
  } catch (e) {
    console.warn('Gemini SDK unavailable:', e);
    return null;
  }
}

async function geminiJson(promptText: string): Promise<Record<string, unknown> | null> {
  const client = await getGeminiClient();
  if (!client) return null;
  for (const model of GEMINI_TEXT_MODELS) {
    try {
      const response = await client.ai.models.generateContent({
        model,
        contents: promptText,
        config: { responseMimeType: 'application/json' },
      });
      const text = response.text || '';
      try {
        return JSON.parse(text);
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
      }
    } catch (err) {
      console.warn(`Gemini model ${model} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}

async function geminiText(promptText: string): Promise<string | null> {
  const client = await getGeminiClient();
  if (!client) return null;
  for (const model of GEMINI_TEXT_MODELS) {
    try {
      const response = await client.ai.models.generateContent({ model, contents: promptText });
      const t = response.text?.trim();
      if (t) return t;
    } catch (err) {
      console.warn(`Gemini text model ${model} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Flow AI Composer — deterministic, section-based, Suno-style.
// Intro → Verso → Refrão → Verso → Refrão → Ponte → Refrão Final → Outro,
// with per-section intensity, drum fills, chorus lift and karaoke lyrics.
// Always works, no API key needed.
// ---------------------------------------------------------------------------
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const STYLE_INSTRUMENTS: Record<string, string[]> = {
  'Lo-Fi': ['electric_piano', 'electric_bass', 'drum_kit', 'synth_pad'],
  'Synthwave': ['synth_lead', 'synth_pad', 'sub_bass_808', 'drum_kit'],
  'Pop': ['acoustic_grand_piano', 'electric_bass', 'drum_kit', 'synth_lead'],
  'Samba/Bossa Nova': ['acoustic_guitar', 'electric_bass', 'drum_kit', 'flute_sax'],
  'EDM': ['synth_lead', 'synth_pad', 'sub_bass_808', 'drum_kit'],
  'Rock': ['electric_guitar', 'electric_bass', 'drum_kit', 'synth_pad'],
  'Jazz': ['electric_piano', 'electric_bass', 'drum_kit', 'brass_section'],
  'Hip-Hop': ['synth_lead', 'sub_bass_808', 'drum_kit', 'synth_pad'],
  'Classical': ['strings_ensemble', 'acoustic_grand_piano', 'synth_pad', 'flute_sax'],
  'Ambient': ['synth_pad', 'strings_ensemble', 'acoustic_grand_piano', 'flute_sax'],
  'Cinematic': ['strings_ensemble', 'brass_section', 'acoustic_grand_piano', 'drum_kit'],
};

function midiToPitch(midi: number): string {
  const n = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[n]}${octave}`;
}

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseKey(key: string): { rootPc: number; minor: boolean } {
  const upper = (key || 'C Major').toUpperCase();
  const m = upper.match(/^([A-G][#B]?)/);
  const base: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  let rootPc = 0;
  if (m) {
    let r = m[1].toUpperCase();
    const flatToSharp: Record<string, string> = { DB: 'C#', EB: 'D#', GB: 'F#', AB: 'G#', BB: 'A#' };
    if (flatToSharp[r]) r = flatToSharp[r];
    rootPc = base[r] ?? 0;
  }
  const minor = /MINOR|MENOR/.test(upper) && !/MAJOR|MAIOR/.test(upper);
  return { rootPc, minor };
}

interface LocalNote {
  id: string;
  pitch: string;
  midi: number;
  startBeat: number;
  duration: number;
  velocity: number;
}

interface Section {
  name: string;
  bars: number;
  intensity: number; // 0..1
  drums: 'full' | 'half' | 'break' | 'none';
  lift: boolean; // chorus octave lift
}

// Lyric word banks (PT-BR), themed by mood
const VERSE_BANK_BRIGHT = [
  'Acordo cedo com o sol na janela',
  'O café na mesa e a vida singela',
  'Cada passo conta uma história nova',
  'E o coração bate onde o amor aprova',
  'Na cidade grande o tempo corre ligeiro',
  'Mas eu guardo a calma de um bom parceiro',
  'As luzes da noite desenham o céu',
  'E a melodia escorre como mel',
];
const VERSE_BANK_DARK = [
  'A noite cai e a cidade silencia',
  'Só o eco dos meus passos me guia',
  'Sombras dançam no quarto escuro',
  'E o futuro parece inseguro',
  'Pesado o ar, pesado o coração',
  'Busco saída nessa escuridão',
  'Cada esquina esconde um olhar',
  'Aprendi sozinho a caminhar',
];
const CHORUS_BANK = [
  'Canta comigo, deixa o som te levar',
  'Essa é a nossa hora de brilhar',
  'O refrão ecoa, o mundo vai girar',
  'Nada pode a nossa festa parar',
];
const BRIDGE_BANK = [
  'E quando tudo parecer distante',
  'Lembre que o amor é o bastante',
];

function buildLyrics(keyword: string, mood: string, sections: { name: string; startBeat: number; bars: number }[], secondsPerBeat: number) {
  const kw = keyword || 'o som';
  const dark = /sombrio|melanc/i.test(mood);
  const lyrics: { section: string; text: string; startBeat: number; timestamp: number }[] = [];
  const push = (section: string, text: string, startBeat: number) => {
    lyrics.push({ section, text, startBeat: Math.round(startBeat * 100) / 100, timestamp: Math.round(startBeat * secondsPerBeat * 10) / 10 });
  };
  let verseToggle = false;
  for (const s of sections) {
    const half = Math.max(4, s.bars * 2); // second line halfway through the section
    if (s.name === 'Intro') push('Intro', `[${mood.toLowerCase()}] ${kw} toma conta do ar...`, s.startBeat);
    else if (s.name.startsWith('Verso')) {
      const bank = dark ? VERSE_BANK_DARK : VERSE_BANK_BRIGHT;
      const off = verseToggle ? 4 : 0;
      verseToggle = !verseToggle;
      push(s.name, `${bank[off]} / ${bank[off + 1]}`, s.startBeat);
      push(s.name, `${bank[off + 2]} / ${bank[off + 3]}`, s.startBeat + half);
    } else if (s.name.startsWith('Refrão')) {
      push(s.name, `${CHORUS_BANK[0]} / ${CHORUS_BANK[1]}`, s.startBeat);
      push(s.name, `${CHORUS_BANK[2].replace('a nossa festa', kw)} / ${CHORUS_BANK[3]}`, s.startBeat + half);
    } else if (s.name === 'Ponte') {
      push('Ponte', `${BRIDGE_BANK[0]} / ${BRIDGE_BANK[1]}`, s.startBeat);
    } else if (s.name === 'Outro') {
      push('Outro', `E ${kw} fica ecoando no ar...`, s.startBeat);
    }
  }
  return lyrics;
}

function composeSong(opts: {
  prompt: string;
  style: string;
  mood: string;
  bpm: number;
  key: string;
  seedSalt: number;
  durationSeconds: number;
}): { title: string; tracks: Record<string, unknown>[]; lyrics: { section: string; text: string; startBeat: number; timestamp: number }[] } {
  const { prompt, style, mood, bpm, key, seedSalt, durationSeconds } = opts;
  const rand = mulberry32(hashSeed(`${prompt}|${style}|${mood}|${bpm}|${key}|${seedSalt}`));
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const { rootPc, minor } = parseKey(key);
  const instruments = STYLE_INSTRUMENTS[style] || STYLE_INSTRUMENTS['Pop'];
  const secondsPerBeat = 60 / bpm;

  const totalBeats = Math.max(24, Math.min(128, Math.round((durationSeconds * bpm) / 60 / 4) * 4 || 32));
  const numBars = Math.round(totalBeats / 4);

  // Section template, then fit to numBars
  const template: Section[] = [
    { name: 'Intro', bars: 2, intensity: 0.3, drums: 'none', lift: false },
    { name: 'Verso 1', bars: 4, intensity: 0.55, drums: 'half', lift: false },
    { name: 'Refrão', bars: 4, intensity: 0.9, drums: 'full', lift: true },
    { name: 'Verso 2', bars: 4, intensity: 0.6, drums: 'half', lift: false },
    { name: 'Refrão', bars: 4, intensity: 0.95, drums: 'full', lift: true },
    { name: 'Ponte', bars: 2, intensity: 0.45, drums: 'break', lift: false },
    { name: 'Refrão Final', bars: 4, intensity: 1, drums: 'full', lift: true },
    { name: 'Outro', bars: 2, intensity: 0.3, drums: 'none', lift: false },
  ];
  const sections: Section[] = JSON.parse(JSON.stringify(template));
  const barCount = () => sections.reduce((a, s) => a + s.bars, 0);
  // shrink long verse/chorus sections first
  while (barCount() > numBars) {
    const candidate = sections.filter((s) => s.bars > 2).sort((a, b) => b.bars - a.bars)[0];
    if (!candidate) break;
    candidate.bars -= 2;
  }
  // grow final chorus if too short
  while (barCount() < numBars) {
    const fin = sections.find((s) => s.name === 'Refrão Final') || sections[sections.length - 2];
    fin.bars += 2;
  }
  // drop empty
  for (let i = sections.length - 1; i >= 0; i--) if (sections[i].bars <= 0) sections.splice(i, 1);

  const scaleSteps = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const verseDeg = minor ? [0, 5, 2, 6] : [0, 4, 5, 3];
  const chorusDeg = minor ? [5, 3, 0, 6] : [3, 4, 0, 4];
  const bridgeDeg = minor ? [3, 2, 5, 5] : [1, 5, 3, 4];

  const leadInst = instruments.find((i) => ['synth_lead', 'acoustic_grand_piano', 'electric_piano', 'acoustic_guitar', 'electric_guitar', 'brass_section', 'flute_sax', 'strings_ensemble'].includes(i)) || 'synth_lead';
  const padInst = instruments.find((i) => ['synth_pad', 'strings_ensemble', 'electric_piano'].includes(i)) || 'synth_pad';
  const bassInst = instruments.find((i) => ['electric_bass', 'sub_bass_808'].includes(i)) || 'electric_bass';
  const hasDrums = instruments.includes('drum_kit');
  const arpInst = leadInst === 'synth_lead' ? 'electric_piano' : 'synth_lead';

  const styleLower = style.toLowerCase();
  const fourOnFloor = /edm|eletr|house|techno|dance/.test(styleLower);
  const halfFeel = /hip-hop|hip hop|trap|lo-fi|lofi|ambient/.test(styleLower);
  const swing = /jazz|samba|bossa|lo-fi|lofi/.test(styleLower);

  let noteId = seedSalt * 100000;
  const nid = (p: string) => `${p}${noteId++}`;
  const melodyNotes: LocalNote[] = [];
  const padNotes: LocalNote[] = [];
  const bassNotes: LocalNote[] = [];
  const drumNotes: LocalNote[] = [];
  const arpNotes: LocalNote[] = [];
  const sectionStarts: { name: string; startBeat: number; bars: number }[] = [];

  const penta = minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  const melodyBase = 69; // A4
  let degIdx = 3 + Math.floor(rand() * 3);
  let barCursor = 0;

  const KICK = 36, SNARE = 38, HAT = 42, CRASH = 49;

  sections.forEach((sec) => {
    sectionStarts.push({ name: sec.name, startBeat: barCursor * 4, bars: sec.bars });
    const degSeq = sec.name.startsWith('Refrão') ? chorusDeg : sec.name === 'Ponte' ? bridgeDeg : verseDeg;
    const isLastBarOfSong = false;

    for (let b = 0; b < sec.bars; b++) {
      const bar = barCursor + b;
      const b0 = bar * 4;
      const deg = degSeq[(bar) % degSeq.length];
      const chordPc = (rootPc + scaleSteps[deg % 7]) % 12;
      const baseMidi = 60 + ((chordPc - rootPc + 12) % 12) - (chordPc > rootPc + 6 ? 12 : 0) + rootPc - rootPc;
      // normalize around C4 area then transpose by root
      const root = 48 + rootPc + scaleSteps[deg % 7];
      const thirdOff = deg === 1 || deg === 2 || deg === 5 ? 3 : 4;
      const chordTones = [root + 12, root + 12 + thirdOff, root + 19];

      // Pad — swells in bridge/outro, punchy in chorus
      if (sec.name !== 'Intro' || b >= sec.bars - 1) {
        chordTones.forEach((m, k) => {
          padNotes.push({
            id: nid('p'), pitch: midiToPitch(m), midi: m,
            startBeat: b0, duration: sec.drums === 'break' ? 4 : 3.5,
            velocity: Math.round(62 + sec.intensity * 18) - (k === 0 ? 0 : 6),
          });
        });
      } else if (sec.name === 'Intro') {
        padNotes.push({ id: nid('p'), pitch: midiToPitch(chordTones[0]), midi: chordTones[0], startBeat: b0, duration: 4, velocity: 64 });
      }

      // Bass
      const bassRoot = Math.max(28, Math.min(45, 33 + ((rootPc + scaleSteps[deg % 7]) % 12) - 4));
      if (sec.drums !== 'none') {
        if (fourOnFloor) {
          for (let q = 0; q < 4; q++) bassNotes.push({ id: nid('b'), pitch: midiToPitch(bassRoot), midi: bassRoot, startBeat: b0 + q, duration: 0.5, velocity: 92 });
        } else if (halfFeel) {
          bassNotes.push({ id: nid('b'), pitch: midiToPitch(bassRoot), midi: bassRoot, startBeat: b0, duration: 2.5, velocity: 96 });
          if (rand() > 0.35) bassNotes.push({ id: nid('b'), pitch: midiToPitch(bassRoot), midi: bassRoot, startBeat: b0 + 2.75, duration: 0.5, velocity: 86 });
        } else {
          bassNotes.push({ id: nid('b'), pitch: midiToPitch(bassRoot), midi: bassRoot, startBeat: b0, duration: 1, velocity: 94 });
          bassNotes.push({ id: nid('b'), pitch: midiToPitch(bassRoot + 7 <= 45 ? bassRoot + 7 : bassRoot), midi: bassRoot + 7 <= 45 ? bassRoot + 7 : bassRoot, startBeat: b0 + 2, duration: 1, velocity: 88 });
        }
      }

      // Lead / vocal melody — motif-based walk
      const steps = sec.intensity > 0.8 ? 8 : sec.intensity > 0.5 ? 6 : 4;
      const singProb = 0.35 + sec.intensity * 0.4;
      for (let s = 0; s < steps; s++) {
        if (rand() < singProb) {
          degIdx += pick([-2, -1, -1, 1, 1, 2, 3]);
          degIdx = Math.max(0, Math.min(11, degIdx));
          const oct = Math.floor(degIdx / 5);
          const m2 = Math.max(60, Math.min(86, melodyBase + (rootPc - 9) + penta[degIdx % 5] + oct * 12 + (sec.lift ? 12 : 0) - 12));
          const beat = b0 + (s * 4) / steps + (swing && s % 2 === 1 ? 0.08 : 0);
          melodyNotes.push({
            id: nid('m'), pitch: midiToPitch(m2), midi: m2,
            startBeat: Math.round(beat * 100) / 100,
            duration: steps >= 8 ? 0.45 : 0.8,
            velocity: Math.round(80 + sec.intensity * 16 + rand() * 8),
          });
        }
      }

      // Arp in high-intensity sections
      if (sec.intensity >= 0.85 && sec.drums === 'full') {
        for (let s = 0; s < 16; s++) {
          if (rand() < 0.7) {
            const m = chordTones[s % 3] + 12;
            arpNotes.push({ id: nid('a'), pitch: midiToPitch(m), midi: m, startBeat: b0 + s * 0.25, duration: 0.22, velocity: 66 });
          }
        }
      }

      // Drums
      if (hasDrums && sec.drums !== 'none') {
        const isFillBar = b === sec.bars - 1 && sec.name !== 'Outro';
        if (sec.drums === 'break') {
          drumNotes.push({ id: nid('d'), pitch: 'C1', midi: KICK, startBeat: b0, duration: 0.25, velocity: 90 });
          drumNotes.push({ id: nid('d'), pitch: 'D1', midi: SNARE, startBeat: b0 + 2, duration: 0.25, velocity: 80 });
          for (let h = 0; h < 4; h++) drumNotes.push({ id: nid('d'), pitch: 'F#1', midi: HAT, startBeat: b0 + h, duration: 0.2, velocity: 58 });
        } else if (fourOnFloor) {
          for (let q = 0; q < 4; q++) drumNotes.push({ id: nid('d'), pitch: 'C1', midi: KICK, startBeat: b0 + q, duration: 0.25, velocity: 104 });
          drumNotes.push({ id: nid('d'), pitch: 'D1', midi: SNARE, startBeat: b0 + 1, duration: 0.25, velocity: 96 });
          drumNotes.push({ id: nid('d'), pitch: 'D1', midi: SNARE, startBeat: b0 + 3, duration: 0.25, velocity: 96 });
          for (let h = 0; h < 8; h++) drumNotes.push({ id: nid('d'), pitch: 'F#1', midi: HAT, startBeat: b0 + h * 0.5, duration: 0.2, velocity: h % 2 ? 62 : 74 });
        } else if (halfFeel && sec.drums === 'half') {
          drumNotes.push({ id: nid('d'), pitch: 'C1', midi: KICK, startBeat: b0, duration: 0.25, velocity: 102 });
          if (rand() > 0.3) drumNotes.push({ id: nid('d'), pitch: 'C1', midi: KICK, startBeat: b0 + 2.5, duration: 0.25, velocity: 90 });
          drumNotes.push({ id: nid('d'), pitch: 'D1', midi: SNARE, startBeat: b0 + 2, duration: 0.25, velocity: 94 });
          for (let h = 0; h < 8; h++) drumNotes.push({ id: nid('d'), pitch: 'F#1', midi: HAT, startBeat: b0 + h * 0.5, duration: 0.2, velocity: 58 + Math.floor(rand() * 14) });
        } else {
          drumNotes.push({ id: nid('d'), pitch: 'C1', midi: KICK, startBeat: b0, duration: 0.25, velocity: 102 });
          drumNotes.push({ id: nid('d'), pitch: 'C1', midi: KICK, startBeat: b0 + 2, duration: 0.25, velocity: 100 });
          drumNotes.push({ id: nid('d'), pitch: 'D1', midi: SNARE, startBeat: b0 + 1, duration: 0.25, velocity: 95 });
          drumNotes.push({ id: nid('d'), pitch: 'D1', midi: SNARE, startBeat: b0 + 3, duration: 0.25, velocity: 95 });
          for (let h = 0; h < 8; h++) drumNotes.push({ id: nid('d'), pitch: 'F#1', midi: HAT, startBeat: b0 + h * 0.5, duration: 0.2, velocity: h % 2 ? 64 : 76 });
        }
        if (isFillBar) {
          for (let s = 0; s < 4; s++) drumNotes.push({ id: nid('d'), pitch: 'D1', midi: SNARE, startBeat: b0 + 3 + s * 0.25, duration: 0.2, velocity: 80 + s * 6 });
          if (sec.intensity > 0.7) drumNotes.push({ id: nid('d'), pitch: 'C2', midi: CRASH, startBeat: b0 + 4, duration: 0.5, velocity: 90 });
        }
        if (b === 0 && sec.intensity > 0.8) drumNotes.push({ id: nid('d'), pitch: 'C2', midi: CRASH, startBeat: b0, duration: 0.5, velocity: 88 });
      }
      void isLastBarOfSong;
      void baseMidi;
    }
    barCursor += sec.bars;
  });

  const tracks: Record<string, unknown>[] = [];
  let channel = 0;
  tracks.push({ id: 't-voz', name: 'Voz Guia', instrument: leadInst, channel: channel++, volume: 0.9, pan: 0, muted: false, solo: false, color: '#a855f7', notes: melodyNotes });
  tracks.push({ id: 't-harmonia', name: 'Harmonia', instrument: padInst, channel: channel++, volume: 0.68, pan: 0.1, muted: false, solo: false, color: '#3b82f6', notes: padNotes });
  if (bassNotes.length) tracks.push({ id: 't-baixo', name: 'Baixo', instrument: bassInst, channel: channel++, volume: 0.9, pan: 0, muted: false, solo: false, color: '#22c55e', notes: bassNotes });
  if (arpNotes.length) tracks.push({ id: 't-arpejo', name: 'Arpejo', instrument: arpInst, channel: channel++, volume: 0.6, pan: -0.2, muted: false, solo: false, color: '#f59e0b', notes: arpNotes });
  if (hasDrums && drumNotes.length) tracks.push({ id: 't-bateria', name: 'Bateria', instrument: 'drum_kit', channel: 9, volume: 0.85, pan: 0, muted: false, solo: false, color: '#ec4899', notes: drumNotes });

  const stopWords = new Set(['uma', 'com', 'para', 'que', 'dos', 'das', 'los', 'las', 'the', 'and', 'de', 'do', 'da', 'em', 'no', 'na', 'e']);
  const keyword = prompt.split(/\s+/).map((w) => w.replace(/[^a-zA-Zà-úÀ-Ú]/g, '')).find((w) => w.length > 3 && !stopWords.has(w.toLowerCase())) || style;
  const cap = keyword.charAt(0).toUpperCase() + keyword.slice(1);
  const titlePool = [`${cap}`, `${cap} (${style})`, `No Ritmo de ${cap}`, `${cap} à Meia-Noite`];
  const title = titlePool[Math.floor(rand() * titlePool.length)].slice(0, 80);
  const lyrics = buildLyrics(cap, mood, sectionStarts, secondsPerBeat);

  return { title, tracks, lyrics };
}

function sanitizeSongData(songData: Record<string, unknown>, fallback: ReturnType<typeof composeSong>) {
  const tracksRaw = Array.isArray(songData.tracks) && songData.tracks.length > 0 ? songData.tracks : fallback.tracks;
  const tracks = (tracksRaw as Record<string, unknown>[]).slice(0, 8).map((t, i) => {
    const notes = Array.isArray(t.notes) ? (t.notes as Record<string, unknown>[]).slice(0, 900) : [];
    return {
      id: typeof t.id === 'string' ? t.id : `t${i + 1}`,
      name: typeof t.name === 'string' ? t.name : `Faixa ${i + 1}`,
      instrument: typeof t.instrument === 'string' ? t.instrument : 'synth_lead',
      channel: typeof t.channel === 'number' ? t.channel : i,
      volume: typeof t.volume === 'number' ? Math.max(0, Math.min(1, t.volume)) : 0.8,
      pan: typeof t.pan === 'number' ? Math.max(-1, Math.min(1, t.pan)) : 0,
      muted: t.muted === true,
      solo: t.solo === true,
      color: typeof t.color === 'string' ? t.color : '#a855f7',
      notes: notes.map((n, j) => {
        const midi = typeof n.midi === 'number' ? Math.max(21, Math.min(108, Math.round(n.midi))) : 60;
        return {
          id: typeof n.id === 'string' ? n.id : `n${j}`,
          pitch: typeof n.pitch === 'string' ? n.pitch : midiToPitch(midi),
          midi,
          startBeat: typeof n.startBeat === 'number' && n.startBeat >= 0 ? Math.min(512, n.startBeat) : 0,
          duration: typeof n.duration === 'number' && n.duration > 0 ? Math.min(16, n.duration) : 0.5,
          velocity: typeof n.velocity === 'number' ? Math.max(1, Math.min(127, Math.round(n.velocity))) : 90,
        };
      }),
    };
  });
  const lyrics = Array.isArray(songData.lyrics) && songData.lyrics.length > 0
    ? (songData.lyrics as Record<string, unknown>[]).slice(0, 16).map((l) => ({
        section: typeof l.section === 'string' ? l.section : 'Verso',
        text: typeof l.text === 'string' ? l.text.slice(0, 500) : '',
        startBeat: typeof l.startBeat === 'number' ? l.startBeat : 0,
        timestamp: typeof l.timestamp === 'number' ? l.timestamp : 0,
      }))
    : fallback.lyrics;
  return {
    title: typeof songData.title === 'string' && songData.title.trim() ? songData.title.slice(0, 80) : fallback.title,
    tracks,
    lyrics,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now(), geminiEnabled: Boolean(GEMINI_API_KEY) });
});

app.get('/api/engines', (_req: Request, res: Response) => {
  res.json({
    engines: [{ id: 'flow', label: 'Motor Flow (seções + 2 variações)', recommended: true }],
    geminiEnabled: Boolean(GEMINI_API_KEY),
  });
});

app.post('/api/enhance-prompt', async (req: Request, res: Response) => {
  try {
    const { idea, style, mood } = req.body;
    if (!idea || !String(idea).trim()) {
      return res.status(400).json({ error: 'Descreva sua ideia musical primeiro.' });
    }
    const fallback = `${style || 'Pop'} ${(mood || 'envolvente').toLowerCase()} com estrutura verso-refrão e refrão memorável: ${String(idea).trim()}`;
    const promptText = `Você é um produtor musical. Melhore este prompt de música em 1 parágrafo conciso (40-70 palavras, em português): ideia="${idea}", estilo=${style}, clima=${mood}. Responda APENAS com o texto melhorado.`;
    const enhanced = (await geminiText(promptText)) || fallback;
    res.json({ enhancedPrompt: enhanced });
  } catch (err: unknown) {
    console.error('Enhance prompt error:', err);
    res.status(500).json({ error: 'Falha ao melhorar prompt', details: err instanceof Error ? err.message : String(err) });
  }
});

// Gera 2 variações por pedido, estilo Suno.
app.post('/api/generate-music', async (req: Request, res: Response) => {
  try {
    const {
      prompt,
      style = 'Pop',
      mood = 'Alegre',
      bpm = 120,
      key = 'C Major',
      durationSeconds = 30,
    } = req.body;

    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ error: 'Descreva sua música antes de gerar.', details: 'Prompt vazio.' });
    }

    const safeBpm = Math.max(60, Math.min(180, Number(bpm) || 120));
    const safeDuration = Math.max(15, Math.min(120, Number(durationSeconds) || 30));

    const base = {
      prompt: String(prompt),
      style: String(style),
      mood: String(mood),
      bpm: safeBpm,
      key: String(key),
      durationSeconds: safeDuration,
    };

    const localA = composeSong({ ...base, seedSalt: Date.now() % 100000 });
    const localB = composeSong({ ...base, seedSalt: (Date.now() % 100000) + 7919 });

    // Refinamento via Gemini na variação A (se houver chave)
    let dataA = { title: localA.title, tracks: localA.tracks as Record<string, unknown>[], lyrics: localA.lyrics as { section: string; text: string }[] };
    let usedModelA = 'flow-composer';
    let noteA: string | undefined;
    if (GEMINI_API_KEY) {
      const compositionPrompt = `Você é o motor de composição Flow AI. Gere composição em JSON estrito:
{"title":"Título em português","tracks":[{"id":"t-voz","name":"Voz Guia","instrument":"synth_lead","channel":0,"volume":0.9,"pan":0,"muted":false,"solo":false,"color":"#a855f7","notes":[{"id":"n1","pitch":"C4","midi":60,"startBeat":0,"duration":0.8,"velocity":90}]}],
"lyrics":[{"section":"Refrão","text":"...","startBeat":8,"timestamp":4}]}
Estilo "${style}", clima "${mood}", ${safeBpm} BPM, tom "${key}". Descrição: "${String(prompt).slice(0, 400)}".
Regras: 4-5 faixas (voz principal, harmonia, baixo midi 30-48, bateria drum_kit channel 9, arpejo), estrutura intro/verso/refrão/ponte/outro com 24+ beats, notas na escala de ${key}. Responda SÓ JSON.`.trim();
      const geminiData = await geminiJson(compositionPrompt);
      if (geminiData && Array.isArray((geminiData as { tracks?: unknown }).tracks)) {
        const s = sanitizeSongData(geminiData, { title: localA.title, tracks: localA.tracks, lyrics: localA.lyrics });
        dataA = { title: s.title, tracks: s.tracks, lyrics: s.lyrics as { section: string; text: string }[] };
        usedModelA = 'gemini-2.0-flash + flow';
      } else {
        noteA = 'Arranjo do motor Flow (refino Gemini indisponível no momento).';
      }
    } else {
      noteA = 'Arranjo do motor Flow (adicione GEMINI_API_KEY para refino via Gemini).';
    }

    const mkSong = (
      d: { title: string; tracks: Record<string, unknown>[]; lyrics: { section: string; text: string; startBeat?: number; timestamp?: number }[] },
      model: string,
      note: string | undefined,
      variant: string,
    ) => ({
      id: `song_${Date.now()}_${variant}_${Math.random().toString(36).substring(2, 7)}`,
      title: d.title,
      prompt,
      style,
      mood,
      bpm: safeBpm,
      key,
      timeSignature: '4/4',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tracks: d.tracks,
      lyrics: d.lyrics,
      durationSeconds: safeDuration,
      generationModel: model,
      isFavorite: false,
      tags: [String(style).toLowerCase(), String(mood).toLowerCase(), `${safeBpm}bpm`],
      coverArtGradient: getRandomGradient(String(style), variant),
      lyriaNote: note,
    });

    const songA = mkSong(dataA, usedModelA, noteA, 'a');
    const songB = mkSong({ title: localB.title, tracks: localB.tracks, lyrics: localB.lyrics }, 'flow-composer', undefined, 'b');

    res.json({ success: true, songs: [songA, songB], song: songA });
  } catch (err: unknown) {
    console.error('Generate music error:', err);
    res.status(500).json({ error: 'Erro na geração de música', details: err instanceof Error ? err.message : String(err) });
  }
});

function getRandomGradient(style: string, variant: string): string {
  const gradients: Record<string, string[]> = {
    'Lo-Fi': ['from-amber-600 via-orange-700 to-purple-900', 'from-yellow-700 via-orange-800 to-stone-900'],
    'Synthwave': ['from-pink-600 via-purple-700 to-indigo-950', 'from-fuchsia-600 via-purple-800 to-slate-950'],
    'Pop': ['from-blue-600 via-indigo-600 to-purple-800', 'from-sky-500 via-indigo-600 to-fuchsia-700'],
    'Rock': ['from-red-700 via-rose-800 to-stone-900', 'from-orange-700 via-red-800 to-zinc-900'],
    'Classical': ['from-amber-700 via-yellow-800 to-stone-900', 'from-stone-500 via-amber-700 to-neutral-900'],
    'Samba/Bossa Nova': ['from-emerald-600 via-teal-700 to-sky-900', 'from-green-600 via-emerald-700 to-cyan-900'],
    'EDM': ['from-cyan-500 via-blue-600 to-violet-900', 'from-teal-400 via-cyan-600 to-purple-800'],
    'Jazz': ['from-yellow-700 via-amber-800 to-neutral-900', 'from-amber-600 via-yellow-800 to-black'],
    'Hip-Hop': ['from-orange-600 via-red-800 to-zinc-900', 'from-red-600 via-rose-800 to-neutral-900'],
    'Ambient': ['from-teal-600 via-emerald-800 to-slate-900', 'from-cyan-700 via-slate-800 to-indigo-950'],
    'Cinematic': ['from-slate-700 via-indigo-900 to-black', 'from-indigo-700 via-purple-900 to-black'],
  };
  const list = gradients[style] || ['from-indigo-600 via-purple-700 to-pink-800', 'from-purple-700 via-pink-700 to-rose-800'];
  return list[variant === 'b' ? 1 % list.length : 0];
}

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Flow AI Server running on http://0.0.0.0:${PORT} in ${isProd ? 'production' : 'development'} mode`);
  });
}

startServer().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
