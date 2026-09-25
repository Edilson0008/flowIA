import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config({ path: '.env.local' });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Cloud Sync Store file path
const DATA_DIR = path.resolve(__dirname, '.data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const SYNC_FILE = path.join(DATA_DIR, 'sync-store.json');

// In-memory sync cache
let syncStore: Record<string, unknown> = {};
if (fs.existsSync(SYNC_FILE)) {
  try {
    syncStore = JSON.parse(fs.readFileSync(SYNC_FILE, 'utf-8'));
  } catch (e) {
    console.error('Failed to read sync store:', e);
  }
}

function saveSyncStore() {
  try {
    fs.writeFileSync(SYNC_FILE, JSON.stringify(syncStore, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to persist sync store:', e);
  }
}

// ---------------------------------------------------------------------------
// Gemini client (lazy — never crashes when key is missing)
// ---------------------------------------------------------------------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
// Only models that actually exist in the public Gemini API.
// The old code used 'gemini-3.8-flash' and 'lyria-*-preview' via
// generateContent, which always returned 404 -> "Criar Música" error.
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
  let lastErr: unknown = null;
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
        throw new Error('Gemini returned non-JSON output');
      }
    } catch (err) {
      lastErr = err;
      console.warn(`Gemini model ${model} failed, trying next:`, err instanceof Error ? err.message : err);
    }
  }
  console.warn('All Gemini models failed:', lastErr instanceof Error ? lastErr?.message : lastErr);
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
// Local deterministic composer — ALWAYS works, no API key needed.
// Music-theory based: chord progression in key, pentatonic melody,
// groove bass and style-aware drum patterns. This is the efficient
// replacement for the broken Lyria/gemini-3.8-flash path.
// ---------------------------------------------------------------------------
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

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
  let root = 'C';
  if (m) {
    root = m[1].replace('B', 'b');
    // normalize flats to sharps
    const flatToSharp: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
    const normalized = root.length === 2 ? root[0] + root[1].toLowerCase() : root;
    const withSharp = flatToSharp[normalized] || normalized.toUpperCase().replace('B', '');
    root = withSharp.length === 1 ? withSharp : withSharp[0] + '#';
    if (flatToSharp[normalized]) root = flatToSharp[normalized];
  }
  const base: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  const minor = /MINOR|MENOR|M\b/.test(upper) && !/MAJOR|MAIOR/.test(upper);
  return { rootPc: base[root] ?? 0, minor };
}

interface LocalNote {
  id: string;
  pitch: string;
  midi: number;
  startBeat: number;
  duration: number;
  velocity: number;
}

function composeLocalSong(opts: {
  prompt: string;
  style: string;
  mood: string;
  bpm: number;
  key: string;
  instruments: string[];
  durationSeconds: number;
}): { title: string; tracks: Record<string, unknown>[]; lyrics: { section: string; text: string }[] } {
  const { prompt, style, mood, bpm, key, instruments, durationSeconds } = opts;
  const seed = hashSeed(`${prompt}|${style}|${mood}|${bpm}|${key}|${Date.now() % 100000}`);
  const rand = mulberry32(seed);
  const { rootPc, minor } = parseKey(key);

  const beatsPerBar = 4;
  const totalBeats = Math.max(16, Math.min(64, Math.round((durationSeconds * bpm) / 60 / 4) * 4 || 32));
  const numBars = Math.round(totalBeats / beatsPerBar);

  // Chord progression (scale degrees). I–V–vi–IV major / i–VI–III–VII minor
  const majorProg = [0, 4, 5, 3]; // degrees in major scale steps
  const minorProg = [0, 5, 2, 6];
  const prog = minor ? minorProg : majorProg;
  const scaleSteps = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];

  const chordRoots: number[] = [];
  for (let bar = 0; bar < numBars; bar++) {
    const deg = prog[bar % prog.length];
    chordRoots.push((rootPc + scaleSteps[deg % 7]) % 12);
  }

  const rootMidiBase = 48 + rootPc; // around C3–B3
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

  const hasDrums = instruments.includes('drum_kit');
  const wantBass = instruments.includes('electric_bass') || instruments.includes('sub_bass_808');
  const wantPad = instruments.some((i) => ['synth_pad', 'strings_ensemble', 'electric_piano'].includes(i));
  const wantLead = instruments.some((i) => ['synth_lead', 'acoustic_grand_piano', 'electric_piano', 'acoustic_guitar', 'electric_guitar', 'brass_section', 'flute_sax'].includes(i));

  const leadInst = instruments.find((i) => ['synth_lead', 'acoustic_grand_piano', 'electric_piano', 'acoustic_guitar', 'electric_guitar', 'brass_section', 'flute_sax'].includes(i)) || 'synth_lead';
  const padInst = instruments.find((i) => ['synth_pad', 'strings_ensemble', 'electric_piano'].includes(i)) || 'synth_pad';
  const bassInst = instruments.find((i) => ['electric_bass', 'sub_bass_808'].includes(i)) || 'electric_bass';

  const styleLower = style.toLowerCase();
  const fourOnFloor = /edm|eletr|house|techno|dance/.test(styleLower);
  const halfTime = /hip-hop|hip hop|trap|lo-fi|lofi/.test(styleLower);
  const swing = /jazz|samba|bossa|lo-fi|lofi/.test(styleLower);

  let noteId = 0;
  const nid = (p: string) => `${p}${noteId++}`;

  // --- Harmony / pad: triad per bar ---
  const padNotes: LocalNote[] = [];
  chordRoots.forEach((chordPc, bar) => {
    const baseMidi = 60 + chordPc - (chordPc > rootPc + 6 ? 12 : 0);
    const third = baseMidi + (minor || [1, 2, 5].includes(prog[bar % prog.length]) ? 3 : 4);
    // keep it simple: root + third + fifth
    [baseMidi, third, baseMidi + 7].forEach((m, k) => {
      padNotes.push({
        id: nid('p'),
        pitch: midiToPitch(m),
        midi: m,
        startBeat: bar * beatsPerBar,
        duration: beatsPerBar,
        velocity: 68 + Math.floor(rand() * 10) - (k === 0 ? 0 : 6),
      });
    });
  });

  // --- Bass: roots with groove ---
  const bassNotes: LocalNote[] = [];
  chordRoots.forEach((chordPc, bar) => {
    const root = 36 + ((chordPc - rootPc + 12) % 12) + (rootPc % 12 === 0 ? 0 : 0);
    const bassRoot = 33 + ((rootPc + scaleSteps[prog[bar % prog.length] % 7]) % 12) - 9; // ~E1–G2
    const r = Math.max(28, Math.min(45, bassRoot));
    if (halfTime) {
      bassNotes.push({ id: nid('b'), pitch: midiToPitch(r), midi: r, startBeat: bar * beatsPerBar, duration: 2.5, velocity: 96 });
      if (rand() > 0.4) bassNotes.push({ id: nid('b'), pitch: midiToPitch(r), midi: r, startBeat: bar * beatsPerBar + 2.75, duration: 0.5, velocity: 88 });
    } else if (fourOnFloor) {
      for (let b = 0; b < 4; b++) bassNotes.push({ id: nid('b'), pitch: midiToPitch(r), midi: r, startBeat: bar * beatsPerBar + b, duration: 0.5, velocity: 94 });
    } else {
      bassNotes.push({ id: nid('b'), pitch: midiToPitch(r), midi: r, startBeat: bar * beatsPerBar, duration: 1, velocity: 95 });
      bassNotes.push({ id: nid('b'), pitch: midiToPitch(r + 7 > 45 ? r : r + 7), midi: r + 7 > 45 ? r : r + 7, startBeat: bar * beatsPerBar + 2, duration: 1, velocity: 90 });
    }
  });

  // --- Lead melody: pentatonic walk ---
  const penta = minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  const melodyNotes: LocalNote[] = [];
  let degIdx = 2;
  const melodyBase = 69 + (rootPc - 0); // around A4 transposed
  for (let bar = 0; bar < numBars; bar++) {
    const chordPc = chordRoots[bar];
    const steps = halfTime ? 4 : 8;
    for (let s = 0; s < steps; s++) {
      if (rand() < (halfTime ? 0.45 : 0.62)) {
        degIdx += pick([-2, -1, -1, 1, 1, 2]);
        degIdx = Math.max(0, Math.min(9, degIdx));
        const oct = Math.floor(degIdx / 5);
        const interval = penta[degIdx % 5] + oct * 12;
        const midi = Math.max(60, Math.min(84, melodyBase - rootPc + interval + (rootPc - 9)));
        const beat = bar * beatsPerBar + (s * beatsPerBar) / steps + (swing && s % 2 === 1 ? 0.08 : 0);
        melodyNotes.push({
          id: nid('m'),
          pitch: midiToPitch(midi),
          midi,
          startBeat: Math.round(beat * 100) / 100,
          duration: steps === 4 ? 0.75 : 0.5,
          velocity: 82 + Math.floor(rand() * 14),
        });
      }
    }
    void chordPc;
  }

  // --- Drums ---
  const drumNotes: LocalNote[] = [];
  const KICK = 36, SNARE = 38, HAT = 42, OPEN_HAT = 46;
  for (let bar = 0; bar < numBars; bar++) {
    const b0 = bar * beatsPerBar;
    if (fourOnFloor) {
      for (let b = 0; b < 4; b++) drumNotes.push({ id: nid('d'), pitch: 'C1', midi: KICK, startBeat: b0 + b, duration: 0.25, velocity: 104 });
      drumNotes.push({ id: nid('d'), pitch: 'D1', midi: SNARE, startBeat: b0 + 1, duration: 0.25, velocity: 96 });
      drumNotes.push({ id: nid('d'), pitch: 'D1', midi: SNARE, startBeat: b0 + 3, duration: 0.25, velocity: 96 });
      for (let h = 0; h < 8; h++) drumNotes.push({ id: nid('d'), pitch: 'F#1', midi: HAT, startBeat: b0 + h * 0.5, duration: 0.2, velocity: h % 2 ? 62 : 74 });
    } else if (halfTime) {
      drumNotes.push({ id: nid('d'), pitch: 'C1', midi: KICK, startBeat: b0, duration: 0.25, velocity: 102 });
      if (rand() > 0.3) drumNotes.push({ id: nid('d'), pitch: 'C1', midi: KICK, startBeat: b0 + 2.5, duration: 0.25, velocity: 92 });
      drumNotes.push({ id: nid('d'), pitch: 'D1', midi: SNARE, startBeat: b0 + 2, duration: 0.25, velocity: 95 });
      for (let h = 0; h < 8; h++) drumNotes.push({ id: nid('d'), pitch: 'F#1', midi: HAT, startBeat: b0 + h * 0.5, duration: 0.2, velocity: 60 + Math.floor(rand() * 14) });
    } else {
      drumNotes.push({ id: nid('d'), pitch: 'C1', midi: KICK, startBeat: b0, duration: 0.25, velocity: 102 });
      drumNotes.push({ id: nid('d'), pitch: 'C1', midi: KICK, startBeat: b0 + 2, duration: 0.25, velocity: 100 });
      drumNotes.push({ id: nid('d'), pitch: 'D1', midi: SNARE, startBeat: b0 + 1, duration: 0.25, velocity: 95 });
      drumNotes.push({ id: nid('d'), pitch: 'D1', midi: SNARE, startBeat: b0 + 3, duration: 0.25, velocity: 95 });
      for (let h = 0; h < 8; h++) drumNotes.push({ id: nid('d'), pitch: 'F#1', midi: HAT, startBeat: b0 + h * 0.5, duration: 0.2, velocity: h % 2 ? 64 : 76 });
      if (bar % 4 === 3) drumNotes.push({ id: nid('d'), pitch: 'F#1', midi: OPEN_HAT, startBeat: b0 + 3.5, duration: 0.4, velocity: 80 });
    }
  }

  const tracks: Record<string, unknown>[] = [];
  let channel = 0;
  if (wantLead || melodyNotes.length) {
    tracks.push({ id: 't-lead', name: 'Melodia Principal', instrument: leadInst, channel: channel++, volume: 0.85, pan: 0, muted: false, solo: false, color: '#a855f7', notes: melodyNotes });
  }
  if (wantPad || padNotes.length) {
    tracks.push({ id: 't-harmony', name: 'Harmonia', instrument: padInst, channel: channel++, volume: 0.7, pan: 0.1, muted: false, solo: false, color: '#3b82f6', notes: padNotes });
  }
  if (wantBass || bassNotes.length) {
    tracks.push({ id: 't-bass', name: 'Baixo', instrument: bassInst, channel: channel++, volume: 0.9, pan: 0, muted: false, solo: false, color: '#22c55e', notes: bassNotes });
  }
  if (hasDrums || drumNotes.length) {
    tracks.push({ id: 't-drums', name: 'Bateria', instrument: 'drum_kit', channel: 9, volume: 0.85, pan: 0, muted: false, solo: false, color: '#ec4899', notes: hasDrums ? drumNotes : drumNotes });
  }

  const shortPrompt = prompt.length > 60 ? prompt.slice(0, 60) : prompt;
  const titleWords = shortPrompt.split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
  const title = titleWords ? `${style} — ${titleWords}` : `${style} ${mood} em ${key}`;

  const lyrics = [
    { section: 'Intro', text: `[${mood.toLowerCase()}] ${prompt.slice(0, 90)}` },
    { section: 'Verso 1', text: 'No compasso da noite a cidade acorda / Cada batida conta uma história / E o refrão que vem do coração / Transforma o silêncio em canção' },
    { section: 'Refrão', text: `${mood} como o vento, ${style.toLowerCase()} no ar / Essa melodia veio pra ficar / Canta comigo até o amanhecer / A música é o nosso viver` },
    { section: 'Outro', text: 'E quando o som se despede devagar / Fica a lembrança a ecoar no ar' },
  ];

  return { title: title.slice(0, 80), tracks, lyrics };
}

function sanitizeSongData(songData: Record<string, unknown>, fallback: ReturnType<typeof composeLocalSong>) {
  const tracksRaw = Array.isArray(songData.tracks) && songData.tracks.length > 0 ? songData.tracks : fallback.tracks;
  const tracks = (tracksRaw as Record<string, unknown>[]).slice(0, 8).map((t, i) => {
    const notes = Array.isArray(t.notes) ? (t.notes as Record<string, unknown>[]).slice(0, 600) : [];
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
          startBeat: typeof n.startBeat === 'number' && n.startBeat >= 0 ? Math.min(256, n.startBeat) : 0,
          duration: typeof n.duration === 'number' && n.duration > 0 ? Math.min(16, n.duration) : 0.5,
          velocity: typeof n.velocity === 'number' ? Math.max(1, Math.min(127, Math.round(n.velocity))) : 90,
        };
      }),
    };
  });
  const lyrics = Array.isArray(songData.lyrics) && songData.lyrics.length > 0
    ? (songData.lyrics as Record<string, unknown>[]).slice(0, 8).map((l) => ({
        section: typeof l.section === 'string' ? l.section : 'Verso',
        text: typeof l.text === 'string' ? l.text.slice(0, 500) : '',
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

// Health Check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now(), geminiEnabled: Boolean(GEMINI_API_KEY) });
});

// Available engines (helps the frontend pick a working motor)
app.get('/api/engines', (_req: Request, res: Response) => {
  res.json({
    engines: [
      { id: 'gemini-flash', label: 'Gemini Flash + Compositor Local', recommended: true, requiresKey: false },
      { id: 'local', label: 'Compositor Local (offline, instantâneo)', requiresKey: false },
    ],
    geminiEnabled: Boolean(GEMINI_API_KEY),
  });
});

// Cloud Sync Save
app.post('/api/cloud-sync/save', (req: Request, res: Response) => {
  const { syncCode, projects, snapshots, updatedAt } = req.body;
  if (!syncCode) {
    return res.status(400).json({ error: 'syncCode is required' });
  }

  syncStore[syncCode] = {
    syncCode,
    projects: projects || [],
    snapshots: snapshots || [],
    updatedAt: updatedAt || Date.now(),
  };

  saveSyncStore();
  return res.json({ success: true, count: projects ? projects.length : 0 });
});

// Cloud Sync Load
app.get('/api/cloud-sync/load/:syncCode', (req: Request, res: Response) => {
  const { syncCode } = req.params;
  const data = syncStore[syncCode];
  if (!data) {
    return res.status(404).json({ error: 'Código de sincronização não encontrado' });
  }
  return res.json(data);
});

// Prompt Enhancer Endpoint (works with or without API key)
app.post('/api/enhance-prompt', async (req: Request, res: Response) => {
  try {
    const { idea, style, mood, instruments } = req.body;
    if (!idea || !String(idea).trim()) {
      return res.status(400).json({ error: 'Descreva sua ideia musical primeiro.' });
    }
    const fallback = `${style || 'Pop'} ${mood?.toLowerCase() || 'envolvente'} a ${120} BPM em estrutura verso-refrão: ${String(idea).trim()} com ${(instruments || []).join(', ') || 'piano, baixo, bateria e sintetizador'}, mixagem equilibrada e refrão memorável.`;
    const promptText = `Você é um produtor musical. Melhore este prompt de produção musical em 1 parágrafo conciso (50-90 palavras, em português): ideia="${idea}", estilo=${style}, humor=${mood}, instrumentos=${(instruments || []).join(', ')}. Responda APENAS com o texto melhorado.`;
    const enhanced = (await geminiText(promptText)) || fallback;
    res.json({ enhancedPrompt: enhanced });
  } catch (err: unknown) {
    console.error('Enhance prompt error:', err);
    res.status(500).json({
      error: 'Falha ao melhorar prompt',
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

// Music Generation Endpoint — NEVER hard-fails: Gemini when possible,
// local composer guaranteed otherwise.
app.post('/api/generate-music', async (req: Request, res: Response) => {
  try {
    const {
      prompt,
      style = 'Pop',
      mood = 'Alegre',
      bpm = 120,
      key = 'C Major',
      instruments = ['acoustic_grand_piano', 'electric_bass', 'drum_kit', 'synth_lead'],
      modelType = 'gemini-flash',
      durationSeconds = 30,
    } = req.body;

    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ error: 'Descreva sua música no prompt antes de gerar.', details: 'Prompt vazio.' });
    }

    const safeBpm = Math.max(60, Math.min(180, Number(bpm) || 120));
    const safeDuration = Math.max(8, Math.min(120, Number(durationSeconds) || 30));
    const safeInstruments = Array.isArray(instruments) && instruments.length > 0
      ? instruments.filter((i): i is string => typeof i === 'string').slice(0, 8)
      : ['acoustic_grand_piano', 'electric_bass', 'drum_kit', 'synth_lead'];

    // 1. Always compose a guaranteed-local arrangement first.
    const local = composeLocalSong({
      prompt: String(prompt),
      style: String(style),
      mood: String(mood),
      bpm: safeBpm,
      key: String(key),
      instruments: safeInstruments,
      durationSeconds: safeDuration,
    });

    // 2. Try to upgrade with Gemini (valid models, JSON output).
    let songData: { title: string; tracks: Record<string, unknown>[]; lyrics: { section: string; text: string }[] } = local;
    let usedModel: string = modelType === 'local' ? 'local-composer' : 'local-composer';
    let lyriaNote: string | undefined = modelType === 'lyria-clip' || modelType === 'lyria-pro'
      ? 'O motor Lyria direto foi substituído pelo compositor de alta fidelidade (mais rápido, offline e editável no DAW).'
      : undefined;

    if (modelType !== 'local' && GEMINI_API_KEY) {
      const compositionPrompt = `Você é o motor de composição Harmonix. Gere composição em JSON estrito:
{"title":"Título em português","bpm":${safeBpm},"key":"${String(key)}","timeSignature":"4/4","durationSeconds":${safeDuration},
"lyrics":[{"section":"Intro","text":"..."},{"section":"Verso 1","text":"..."},{"section":"Refrão","text":"..."},{"section":"Outro","text":"..."}],
"tracks":[{"id":"t1","name":"Melodia Principal","instrument":"synth_lead","channel":0,"volume":0.85,"pan":0,"muted":false,"solo":false,"color":"#a855f7",
"notes":[{"id":"n1","pitch":"C4","midi":60,"startBeat":0,"duration":1.0,"velocity":90}]}]}
Estilo "${style}", humor "${mood}", ${safeBpm} BPM, tom "${key}". Descrição: "${String(prompt).slice(0, 400)}". Instrumentos: ${safeInstruments.join(', ')}.
Regras: 3-4 faixas (lead, harmonia/pad, baixo midi 30-48, bateria drum_kit channel 9 com kick 36 tempos 0/2, snare 38 tempos 1/3, hats 42 em colcheias), 16-32 beats contínuos, notas na escala de ${key}. Responda SÓ JSON.`.trim();
      const geminiData = await geminiJson(compositionPrompt);
      if (geminiData && (Array.isArray((geminiData as { tracks?: unknown }).tracks))) {
        songData = sanitizeSongData(geminiData, local);
        usedModel = 'gemini-2.0-flash';
      } else if (!lyriaNote) {
        lyriaNote = 'Arranjo composto pelo motor local de alta fidelidade (Gemini indisponível no momento).';
      }
    } else if (modelType !== 'local' && !GEMINI_API_KEY && !lyriaNote) {
      lyriaNote = 'Arranjo composto pelo motor local (adicione GEMINI_API_KEY no .env para refinamento via Gemini).';
    }

    const id = `song_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const resultSong = {
      id,
      title: songData.title,
      prompt,
      style,
      mood,
      bpm: safeBpm,
      key,
      timeSignature: '4/4',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tracks: songData.tracks,
      lyrics: songData.lyrics,
      durationSeconds: safeDuration,
      generationModel: usedModel,
      isFavorite: false,
      tags: [String(style).toLowerCase(), String(mood).toLowerCase(), `${safeBpm}bpm`],
      coverArtGradient: getRandomGradient(String(style)),
      lyriaNote,
    };

    res.json({ success: true, song: resultSong });
  } catch (err: unknown) {
    console.error('Generate music error:', err);
    res.status(500).json({
      error: 'Erro na geração de música',
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

function getRandomGradient(style: string): string {
  const gradients: Record<string, string> = {
    'Lo-Fi': 'from-amber-600 via-orange-700 to-purple-900',
    'Synthwave': 'from-pink-600 via-purple-700 to-indigo-950',
    'Pop': 'from-blue-600 via-indigo-600 to-purple-800',
    'Rock': 'from-red-700 via-rose-800 to-stone-900',
    'Classical': 'from-amber-700 via-yellow-800 to-stone-900',
    'Samba/Bossa Nova': 'from-emerald-600 via-teal-700 to-sky-900',
    'EDM': 'from-cyan-500 via-blue-600 to-violet-900',
    'Jazz': 'from-yellow-700 via-amber-800 to-neutral-900',
    'Hip-Hop': 'from-orange-600 via-red-800 to-zinc-900',
    'Ambient': 'from-teal-600 via-emerald-800 to-slate-900',
  };
  return gradients[style] || 'from-indigo-600 via-purple-700 to-pink-800';
}

// Vite mounting in development mode / static serving in production
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
    console.log(`Melodix AI Server running on http://0.0.0.0:${PORT} in ${isProd ? 'production' : 'development'} mode`);
  });
}

startServer().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
