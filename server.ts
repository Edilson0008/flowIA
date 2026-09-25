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
// Real AI music with vocals via Replicate (needs REPLICATE_API_TOKEN).
// Default model: minimax/music-01 (full songs with singing).
// Without a token, the Flow local composer is used (no vocals, synth only).
// ---------------------------------------------------------------------------
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || '';
const REPLICATE_MUSIC_MODEL = process.env.REPLICATE_MUSIC_MODEL || 'minimax/music-01';

interface ReplicateSong {
  audioUrl: string;
  lyricsText?: string;
}

async function replicateGenerate(promptText: string, lyricsHint: string, durationHint: number): Promise<ReplicateSong | null> {
  if (!REPLICATE_API_TOKEN) return null;
  try {
    const createRes = await fetch(`https://api.replicate.com/v1/models/${REPLICATE_MUSIC_MODEL}/predictions`, {
      method: 'POST',
      headers: { Authorization: `Token ${REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json', Prefer: 'wait' },
      body: JSON.stringify({ input: { prompt: promptText, lyrics: lyricsHint } }),
    });
    if (!createRes.ok) {
      console.warn('Replicate create failed:', createRes.status, await createRes.text().then((t) => t.slice(0, 300)));
      return null;
    }
    let pred = (await createRes.json()) as { id: string; status: string; output?: unknown; urls?: { get: string } };
    const deadline = Date.now() + 4.5 * 60 * 1000;
    while (pred.status !== 'succeeded' && pred.status !== 'failed' && pred.status !== 'canceled') {
      if (Date.now() > deadline) {
        console.warn('Replicate prediction timed out:', pred.id);
        return null;
      }
      await new Promise((r) => setTimeout(r, 5000));
      const poll = await fetch(pred.urls?.get || `https://api.replicate.com/v1/predictions/${pred.id}`, {
        headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` },
      });
      if (!poll.ok) return null;
      pred = (await poll.json()) as typeof pred;
    }
    if (pred.status !== 'succeeded') {
      console.warn('Replicate prediction failed:', pred.status);
      return null;
    }
    const out = pred.output;
    let audioUrl = '';
    let lyricsText: string | undefined;
    if (typeof out === 'string') audioUrl = out;
    else if (Array.isArray(out)) {
      const first = out[0];
      audioUrl = typeof first === 'string' ? first : (first as { audio?: string })?.audio || '';
    } else if (out && typeof out === 'object') {
      const o = out as Record<string, unknown>;
      const a = o.audio || o.audio_url || o.song || o.music;
      audioUrl = typeof a === 'string' ? a : '';
      const l = o.lyrics || o.lyric;
      if (typeof l === 'string') lyricsText = l;
    }
    void durationHint;
    if (!audioUrl) return null;
    return { audioUrl, lyricsText };
  } catch (err) {
    console.warn('Replicate error:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// ACE-Step PUBLIC demo (FREE vocals, zero-config).
// Calls the official public Space via its Gradio API, downloads the sung mp3s
// into public/vocals/ and parses real LRC timestamps for karaoke.
// Disable with HF_SPACE_DISABLED=1. Falls back silently on any failure.
// ---------------------------------------------------------------------------
const HF_SPACE_URL = (process.env.HF_SPACE_URL || 'https://ace-step-ace-step-v1-5.hf.space').replace(/\/$/, '');
const HF_SPACE_ENABLED = process.env.HF_SPACE_DISABLED !== '1';
// Optional free HF account token: raises ZeroGPU quota (signup free at huggingface.co)
const HF_TOKEN = process.env.HF_TOKEN || '';
const hfHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
if (HF_TOKEN) hfHeaders.Authorization = `Bearer ${HF_TOKEN}`;

interface HfVocalSong {
  localPath: string;
  lrcText?: string;
}

function parseLrc(lrc: string, bpm: number): { section: string; text: string; startBeat: number; timestamp: number }[] {
  const secondsPerBeat = 60 / bpm;
  const lines = lrc.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: { section: string; text: string; startBeat: number; timestamp: number }[] = [];
  for (const line of lines) {
    const m = line.match(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)/);
    if (!m) continue;
    const sec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) / 1000 : 0);
    const text = (m[4] || '').trim();
    if (!text) continue;
    const beat = Math.round((sec / secondsPerBeat) * 100) / 100;
    out.push({ section: text.match(/^\[(.+?)\]/)?.[1] || 'Voz', text: text.replace(/^\[.+?\]\s*/, ''), startBeat: beat, timestamp: Math.round(sec * 10) / 10 });
  }
  return out;
}

async function hfSpaceGenerate(
  songPrompt: string,
  lyricsHint: string,
  bpm: number,
  key: string,
  durationSeconds: number,
): Promise<HfVocalSong[] | null> {
  if (!HF_SPACE_ENABLED) return null;
  try {
    const data = [
      'acestep-v15-turbo', 'custom', '', 'unknown',
      songPrompt.slice(0, 400), lyricsHint.slice(0, 1500),
      bpm, key, '4', 'pt',
      8, 7.0, true, '-1', null,
      Math.max(15, Math.min(120, durationSeconds)), 2, null, '', 0.0, -1,
      'Fill the audio semantic mask based on the given conditions:', 1.0, 'text2music', false, 0.0, 1.0,
      3.0, 'ode', '', 'mp3',
      0.85, false, 2.0, 0, 0.9, 'NO USER INPUT',
      true, true, true, false, true, false, false, true,
      0.5, 8, null, [], false,
    ];
    const callRes = await fetch(`${HF_SPACE_URL}/gradio_api/call/generation_wrapper`, {
      method: 'POST',
      headers: hfHeaders,
      body: JSON.stringify({ data }),
    });
    if (!callRes.ok) return null;
    const { event_id } = (await callRes.json()) as { event_id?: string };
    if (!event_id) return null;

    const stream = await fetch(`${HF_SPACE_URL}/gradio_api/call/generation_wrapper/${event_id}`, {
      headers: { Accept: 'text/event-stream', ...(HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {}) },
    });
    if (!stream.ok || !stream.body) return null;

    const deadline = Date.now() + 6 * 60 * 1000;
    let buf = '';
    let finalData: unknown[] | null = null;
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    outer: while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const msg = JSON.parse(payload) as { msg?: string; output?: { data?: unknown[] } };
          if (msg.msg === 'process_completed' && msg.output?.data) {
            finalData = msg.output.data;
            break outer;
          }
          if (msg.msg === 'process_failed' || msg.msg === 'error') return null;
        } catch { /* partial chunk */ }
      }
    }
    try { await reader.cancel(); } catch { /* ignore */ }
    if (!finalData) return null;

    const vocalsDir = path.resolve(__dirname, 'public', 'vocals');
    fs.mkdirSync(vocalsDir, { recursive: true });
    const saved: HfVocalSong[] = [];
    // outputs[0..7] = audio files (we asked batch_size 2 → first two)
    for (let i = 0; i < 2; i++) {
      const audio = finalData[i] as { url?: string } | null;
      const url = audio?.url;
      if (!url) continue;
      const abs = url.startsWith('http') ? url : `${HF_SPACE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
      const dl = await fetch(abs);
      if (!dl.ok) continue;
      const bufAudio = Buffer.from(await dl.arrayBuffer());
      if (bufAudio.length < 10 * 1024) continue; // ignore stubs
      const name = `hf_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 7)}.mp3`;
      fs.writeFileSync(path.join(vocalsDir, name), bufAudio);
      // LRC outputs start after 8 audios + file + markdown + status + seed + 8 scores + 8 codes = index 28+i
      const lrcRaw = finalData[28 + i];
      saved.push({ localPath: `/vocals/${name}`, lrcText: typeof lrcRaw === 'string' ? lrcRaw : undefined });
    }
    return saved.length > 0 ? saved : null;
  } catch (err) {
    console.warn('HF Space vocals error:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// ACE-Step local API (FREE vocals — e.g. Colab/Kaggle free GPU notebook).
// Set ACESTEP_API_URL to the API server address (http://localhost:8001 or an
// ngrok public URL). Flow downloads the generated mp3 into public/vocals/.
// ---------------------------------------------------------------------------
const ACESTEP_API_URL = (process.env.ACESTEP_API_URL || '').replace(/\/$/, '');

interface AcestepSong {
  localPath: string; // served as /vocals/xxx.mp3
}

async function acestepGenerate(
  songPrompt: string,
  lyricsHint: string,
  bpm: number,
  key: string,
  durationSeconds: number,
): Promise<AcestepSong[] | null> {
  if (!ACESTEP_API_URL) return null;
  try {
    const headers = { 'Content-Type': 'application/json' };
    const health = await fetch(`${ACESTEP_API_URL}/health`).then((r) => r.ok).catch(() => false);
    if (!health) {
      console.warn('ACE-Step API unreachable:', ACESTEP_API_URL);
      return null;
    }
    const rel = await fetch(`${ACESTEP_API_URL}/release_task`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: songPrompt,
        lyrics: lyricsHint,
        vocal_language: 'pt',
        audio_format: 'mp3',
        audio_duration: Math.max(15, Math.min(180, durationSeconds)),
        bpm,
        key_scale: key,
        batch_size: 2,
        use_random_seed: true,
      }),
    });
    if (!rel.ok) {
      console.warn('ACE-Step release_task failed:', rel.status);
      return null;
    }
    const relData = (await rel.json()) as { data?: { task_id?: string } };
    const taskId = relData.data?.task_id;
    if (!taskId) return null;

    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 6000));
      const q = await fetch(`${ACESTEP_API_URL}/query_result`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ task_id_list: [taskId] }),
      });
      if (!q.ok) continue;
      const qd = (await q.json()) as { data?: { status?: number; result?: string }[] };
      const job = qd.data?.[0];
      if (!job) continue;
      if (job.status === 2) {
        console.warn('ACE-Step task failed');
        return null;
      }
      if (job.status === 1 && job.result) {
        const items = JSON.parse(job.result) as { file?: string }[];
        const saved: AcestepSong[] = [];
        const vocalsDir = path.resolve(__dirname, 'public', 'vocals');
        fs.mkdirSync(vocalsDir, { recursive: true });
        for (let i = 0; i < items.slice(0, 2).length; i++) {
          const fileUrl = items[i].file;
          if (!fileUrl) continue;
          const dl = await fetch(`${ACESTEP_API_URL}${fileUrl}`);
          if (!dl.ok) continue;
          const buf = Buffer.from(await dl.arrayBuffer());
          const name = `song_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 7)}.mp3`;
          fs.writeFileSync(path.join(vocalsDir, name), buf);
          saved.push({ localPath: `/vocals/${name}` });
        }
        return saved.length > 0 ? saved : null;
      }
    }
    console.warn('ACE-Step task timed out');
    return null;
  } catch (err) {
    console.warn('ACE-Step error:', err instanceof Error ? err.message : err);
    return null;
  }
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
  const choirNotes: LocalNote[] = [];
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
          const beat = b0 + (s * 4) / steps + (swing && s % 2 === 1 ? 0.08 : 0) + (rand() - 0.5) * 0.05;
          const note: LocalNote = {
            id: nid('m'), pitch: midiToPitch(m2), midi: m2,
            startBeat: Math.round(beat * 100) / 100,
            duration: steps >= 8 ? 0.45 : 0.8,
            velocity: Math.round(80 + sec.intensity * 16 + rand() * 8),
          };
          melodyNotes.push(note);
          // Choir doubles the melody in choruses (vocal feel)
          if (sec.intensity >= 0.85) {
            choirNotes.push({ ...note, id: nid('c'), velocity: Math.max(40, note.velocity - 18) });
          }
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
  if (choirNotes.length) tracks.push({ id: 't-coro', name: 'Voz (Coro)', instrument: 'vocal_choir', channel: channel++, volume: 0.5, pan: 0, muted: false, solo: false, color: '#f472b6', notes: choirNotes });
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
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    geminiEnabled: Boolean(GEMINI_API_KEY),
    vocalsEnabled: Boolean(REPLICATE_API_TOKEN || ACESTEP_API_URL || HF_SPACE_ENABLED),
  });
});

app.get('/api/engines', (_req: Request, res: Response) => {
  res.json({
    engines: [
      ...(HF_SPACE_ENABLED
        ? [{ id: 'acestep-vocals', label: 'Vocais reais GRÁTIS (demo pública)', recommended: true }]
        : []),
      ...(ACESTEP_API_URL && !HF_SPACE_ENABLED
        ? [{ id: 'acestep-local', label: 'Vocais reais GRÁTIS (seu Colab)', recommended: true }]
        : []),
      ...(REPLICATE_API_TOKEN && !ACESTEP_API_URL
        ? [{ id: 'replicate-music', label: `Música real com vocais (${REPLICATE_MUSIC_MODEL})`, recommended: true }]
        : []),
      { id: 'flow', label: 'Motor Flow (sintetizado local + coro)', recommended: !REPLICATE_API_TOKEN && !ACESTEP_API_URL },
    ],
    geminiEnabled: Boolean(GEMINI_API_KEY),
    vocalsEnabled: Boolean(REPLICATE_API_TOKEN || ACESTEP_API_URL || HF_SPACE_ENABLED),
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
      audioUrl?: string,
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
      audioUrl,
      audioMimeType: audioUrl ? 'audio/mpeg' : undefined,
      durationSeconds: safeDuration,
      generationModel: model,
      isFavorite: false,
      tags: [String(style).toLowerCase(), String(mood).toLowerCase(), `${safeBpm}bpm`],
      coverArtGradient: getRandomGradient(String(style), variant),
      lyriaNote: note,
    });

    // Real AI audio with vocals — FREE path first (ACE-Step), then Replicate.
    // Falls back to local synth when nothing is configured or on any failure.
    let songA = mkSong(dataA, usedModelA, noteA, 'a');
    let songB = mkSong({ title: localB.title, tracks: localB.tracks, lyrics: localB.lyrics }, 'flow-composer', undefined, 'b');

    const lyricsHintA = localA.lyrics.map((l) => `[${l.section}] ${l.text}`).join('\n');
    const lyricsHintB = localB.lyrics.map((l) => `[${l.section}] ${l.text}`).join('\n');
    const fullPrompt = `${style} ${mood} song, ${safeBpm} BPM in ${key}: ${String(prompt).slice(0, 400)}`;

    const applyVocalFiles = (
      files: { localPath: string; lrcText?: string }[],
      tag: string,
      note: string,
    ) => {
      if (files[0]) {
        const lyricsA = files[0].lrcText
          ? parseLrc(files[0].lrcText, safeBpm)
          : (dataA.lyrics as { section: string; text: string; startBeat?: number; timestamp?: number }[]);
        songA = mkSong({ ...dataA, lyrics: lyricsA }, tag, note, 'a', files[0].localPath);
      }
      if (files[1]) {
        const lyricsB = files[1].lrcText
          ? parseLrc(files[1].lrcText, safeBpm)
          : localB.lyrics;
        songB = mkSong({ title: localB.title, tracks: localB.tracks, lyrics: lyricsB }, tag, note, 'b', files[1].localPath);
      }
    };

    // 1) Public demo (grátis, sem configurar nada)
    if (!songA.audioUrl) {
      const hf = await hfSpaceGenerate(fullPrompt, lyricsHintA, safeBpm, String(key), safeDuration);
      if (hf && hf.length > 0) {
        applyVocalFiles(hf, 'acestep-vocals', 'Voz real gerada por IA (ACE-Step, gratuito).');
      }
    }

    if (ACESTEP_API_URL && !songA.audioUrl) {
      const ace = await acestepGenerate(fullPrompt, lyricsHintA, safeBpm, String(key), safeDuration);
      if (ace && ace.length > 0) {
        songA = mkSong({ ...dataA }, 'acestep-vocals', 'Voz real gerada por IA (ACE-Step, gratuito).', 'a', ace[0].localPath);
        if (ace[1]) {
          songB = mkSong(
            { title: localB.title, tracks: localB.tracks, lyrics: localB.lyrics },
            'acestep-vocals',
            'Voz real gerada por IA (ACE-Step, gratuito).',
            'b',
            ace[1].localPath,
          );
        }
      }
    }

    if (!songA.audioUrl && REPLICATE_API_TOKEN) {
      const [repA, repB] = await Promise.all([
        replicateGenerate(`${fullPrompt} (variation 1)`, lyricsHintA, safeDuration),
        replicateGenerate(`${fullPrompt} (variation 2)`, lyricsHintB, safeDuration),
      ]);
      if (repA) {
        songA = mkSong(
          { ...dataA, lyrics: mergeProviderLyrics(repA.lyricsText, localA.lyrics) },
          'replicate-music',
          'Voz e áudio reais gerados por IA (Replicate).',
          'a',
          repA.audioUrl,
        );
      }
      if (repB) {
        songB = mkSong(
          { title: localB.title, tracks: localB.tracks, lyrics: mergeProviderLyrics(repB.lyricsText, localB.lyrics) },
          'replicate-music',
          'Voz e áudio reais gerados por IA (Replicate).',
          'b',
          repB.audioUrl,
        );
      }
    }

    res.json({ success: true, songs: [songA, songB], song: songA });
  } catch (err: unknown) {
    console.error('Generate music error:', err);
    res.status(500).json({ error: 'Erro na geração de música', details: err instanceof Error ? err.message : String(err) });
  }
});

function mergeProviderLyrics(
  text: string | undefined,
  fallback: { section: string; text: string; startBeat: number; timestamp: number }[],
): { section: string; text: string; startBeat: number; timestamp: number }[] {
  if (!text || !text.trim()) return fallback;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 24);
  if (lines.length === 0) return fallback;
  // Distribute provider lyric lines across the local section timeline for karaoke
  return lines.map((line, i) => {
    const anchor = fallback[Math.floor((i / lines.length) * fallback.length)] || fallback[fallback.length - 1];
    const section = line.match(/^\[(.+?)\]/)?.[1] || anchor.section;
    return { section, text: line.replace(/^\[.+?\]\s*/, '').slice(0, 300) || line, startBeat: anchor.startBeat, timestamp: anchor.timestamp };
  });
}

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
