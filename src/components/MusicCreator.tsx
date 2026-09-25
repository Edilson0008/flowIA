import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Wand2,
  Play,
  Pause,
  RotateCw,
  Flame,
  Sliders,
  FileAudio,
  FileCode,
  Mic2,
} from 'lucide-react';
import { SongProject } from '../types';
import { audioEngine } from '../services/audioEngine';
import { downloadMidi } from '../services/midiEncoder';

interface MusicCreatorProps {
  onSongsGenerated: (songs: SongProject[]) => void;
  onOpenInStudio: (song: SongProject) => void;
}

const STYLES = [
  { id: 'Lo-Fi', label: 'Lo-Fi', icon: '☕' },
  { id: 'Synthwave', label: 'Synthwave', icon: '🌆' },
  { id: 'Pop', label: 'Pop', icon: '✨' },
  { id: 'Samba/Bossa Nova', label: 'Bossa Nova', icon: '🌴' },
  { id: 'EDM', label: 'EDM', icon: '⚡' },
  { id: 'Rock', label: 'Rock', icon: '🎸' },
  { id: 'Jazz', label: 'Jazz', icon: '🎷' },
  { id: 'Hip-Hop', label: 'Hip-Hop', icon: '🎤' },
  { id: 'Classical', label: 'Clássica', icon: '🎻' },
  { id: 'Ambient', label: 'Ambient', icon: '🌌' },
  { id: 'Cinematic', label: 'Cinema', icon: '🎬' },
];

const MOODS = ['Relaxante', 'Energético', 'Melancólico', 'Alegre', 'Épico', 'Futurista', 'Romântico', 'Sombrio'];
const KEYS = ['C Major', 'G Major', 'D Major', 'A Minor', 'E Minor', 'F Major', 'D Minor', 'Bb Major', 'B Minor', 'Eb Major'];

const INSPIRATIONS = [
  { title: 'Café na Chuva', prompt: 'Lo-fi chillhop nostálgico com piano suave e batida lenta para estudar à noite.', style: 'Lo-Fi', mood: 'Relaxante', bpm: 82 },
  { title: 'Viagem Noturna', prompt: 'Synthwave anos 80 acelerado com arpejos de neon e clima futurista.', style: 'Synthwave', mood: 'Futurista', bpm: 120 },
  { title: 'Tarde em Ipanema', prompt: 'Bossa nova aconchegante com violão sincopado e flauta doce.', style: 'Samba/Bossa Nova', mood: 'Alegre', bpm: 96 },
  { title: 'Despertar de Heróis', prompt: 'Trilha épica com cordas crescentes e piano inspirador.', style: 'Cinematic', mood: 'Épico', bpm: 110 },
];

export const MusicCreator: React.FC<MusicCreatorProps> = ({ onSongsGenerated, onOpenInStudio }) => {
  const [prompt, setPrompt] = useState('Lo-fi chillhop suave com piano elétrico e batida relaxante');
  const [selectedStyle, setSelectedStyle] = useState('Lo-Fi');
  const [selectedMood, setSelectedMood] = useState('Relaxante');
  const [selectedKey, setSelectedKey] = useState('C Major');
  const [bpm, setBpm] = useState(84);
  const [durationSeconds, setDurationSeconds] = useState(30);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [generationStep, setGenerationStep] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [results, setResults] = useState<SongProject[]>([]);
  const [vocalsEnabled, setVocalsEnabled] = useState(false);

  // Player state (singleton engine)
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const playingRef = useRef<SongProject | null>(null);

  useEffect(() => {
    audioEngine.onBeatUpdate((beat) => setCurrentBeat(beat));
    audioEngine.onPlaybackEnd(() => {
      setPlayingId(null);
      playingRef.current = null;
    });
    fetch('/api/engines').then((r) => r.json()).then((d) => setVocalsEnabled(Boolean(d.vocalsEnabled))).catch(() => {});
  }, []);

  const handleEnhancePrompt = async () => {
    if (!prompt.trim() || isEnhancing) return;
    setIsEnhancing(true);
    try {
      const res = await fetch('/api/enhance-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: prompt, style: selectedStyle, mood: selectedMood }),
      });
      const data = await res.json();
      if (data.enhancedPrompt) setPrompt(data.enhancedPrompt);
    } catch (e) {
      console.error(e);
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    stopPlayback();
    setIsGenerating(true);
    setErrorMessage(null);
    setGenerationStep(vocalsEnabled
      ? 'Gerando música real com vocais... pode levar 1 a 3 minutos, não feche.'
      : 'Compondo estrutura, harmonia, melodia e coro...');

    try {
      const res = await fetch('/api/generate-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, style: selectedStyle, mood: selectedMood, bpm, key: selectedKey, durationSeconds }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Erro do servidor: ${res.statusText}`);
      }
      setGenerationStep('Mixando e masterizando as 2 variações...');
      const data = await res.json();
      const songs: SongProject[] = data.songs || (data.song ? [data.song] : []);
      if (songs.length === 0) throw new Error('Nenhuma música foi retornada.');
      setResults(songs);
      onSongsGenerated(songs);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro ao criar. Tente novamente.');
    } finally {
      setIsGenerating(false);
      setGenerationStep('');
    }
  };

  const stopPlayback = () => {
    audioEngine.stop();
    setPlayingId(null);
    playingRef.current = null;
  };

  const togglePlay = (song: SongProject) => {
    if (playingId === song.id) {
      stopPlayback();
    } else {
      audioEngine.play(song);
      playingRef.current = song;
      setPlayingId(song.id);
    }
  };

  const handleDownloadWav = async (song: SongProject) => {
    setExportingId(song.id);
    try {
      await audioEngine.downloadWav(song);
    } finally {
      setExportingId(null);
    }
  };

  const activeLyricIndex = (song: SongProject): number => {
    if (playingId !== song.id || !song.lyrics?.length) return -1;
    let idx = 0;
    song.lyrics.forEach((l, i) => {
      if ((l.startBeat ?? 0) <= currentBeat) idx = i;
    });
    return idx;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Prompt hero */}
      <div className="relative overflow-hidden rounded-3xl border border-purple-900/40 bg-gradient-to-br from-purple-950/40 via-[#131422] to-[#0c0d15] p-6 shadow-2xl">
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-purple-600/20 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-pink-600/15 blur-3xl" />
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-semibold text-purple-300">
            <Sparkles className="h-3.5 w-3.5 text-yellow-400" />
            <span>{vocalsEnabled ? 'Música real com vocais — descreva e receba 2 faixas' : 'Descreva → receba 2 músicas prontas'}</span>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="Descreva a música dos seus sonhos... Ex: um trap sombrio com 808 pesado e melodia de piano misteriosa"
            className="mt-3 w-full resize-none rounded-2xl border border-slate-700/80 bg-slate-900/90 p-4 text-sm text-slate-100 placeholder-slate-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleEnhancePrompt}
              disabled={isEnhancing || !prompt.trim()}
              className="flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-300 transition hover:bg-purple-500/20 disabled:opacity-50"
            >
              <Wand2 className={`h-3.5 w-3.5 ${isEnhancing ? 'animate-spin' : ''}`} />
              <span>{isEnhancing ? 'Melhorando...' : 'Melhorar com IA'}</span>
            </button>
            <span className="text-xs text-slate-500">Inspirações:</span>
            {INSPIRATIONS.map((insp, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { setPrompt(insp.prompt); setSelectedStyle(insp.style); setSelectedMood(insp.mood); setBpm(insp.bpm); }}
                className="rounded-full border border-slate-700/80 bg-slate-800/60 px-3 py-1 text-xs text-slate-300 transition hover:border-purple-500/50 hover:text-white"
              >
                {insp.title}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="rounded-2xl border border-slate-800 bg-[#12131f] p-5 lg:col-span-7">
          <h3 className="text-sm font-bold text-slate-200">Estilo</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedStyle(s.id)}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                  selectedStyle === s.id
                    ? 'border-purple-500 bg-purple-900/40 text-white'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>{s.icon}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
          <h3 className="mt-4 text-sm font-bold text-slate-200">Clima</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MOODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setSelectedMood(m)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  selectedMood === m ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-800 bg-[#12131f] p-5 lg:col-span-5">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <Sliders className="h-4 w-4 text-purple-400" /> Ajustes
          </div>
          <div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Andamento</span>
              <span className="font-mono font-bold text-purple-300">{bpm} BPM</span>
            </div>
            <input type="range" min="60" max="180" value={bpm} onChange={(e) => setBpm(parseInt(e.target.value, 10))} className="mt-2 w-full accent-purple-500" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-400">Tom</label>
              <select value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 p-2 text-xs text-slate-200 focus:border-purple-500 focus:outline-none">
                {KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400">Duração</label>
              <div className="mt-1 flex gap-1">
                {[30, 60].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDurationSeconds(d)}
                    className={`flex-1 rounded-xl border px-2 py-2 text-xs font-bold transition ${
                      durationSeconds === d ? 'border-purple-500 bg-purple-900/40 text-white' : 'border-slate-700 bg-slate-900 text-slate-400'
                    }`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
          </div>
          {errorMessage && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{errorMessage}</div>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-600 py-4 text-base font-extrabold text-white shadow-xl shadow-purple-600/30 transition hover:from-purple-500 hover:to-pink-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isGenerating ? (<><RotateCw className="h-5 w-5 animate-spin" /><span>Criando 2 músicas...</span></>) : (<><Flame className="h-5 w-5 text-yellow-300" /><span>Criar Música</span></>)}
          </button>
          {isGenerating && <p className="animate-pulse text-center text-xs font-medium text-purple-300">{generationStep}</p>}
        </div>
      </div>

      {/* Results — 2 variations */}
      {results.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-black text-white">Suas criações <span className="text-sm font-medium text-slate-400">({results.length} variações — salvas na Biblioteca)</span></h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {results.map((song, vi) => {
              const isPlaying = playingId === song.id;
              const activeIdx = activeLyricIndex(song);
              return (
                <div key={song.id} className="overflow-hidden rounded-3xl border border-slate-800 bg-[#12131f] shadow-xl">
                  <div className={`relative bg-gradient-to-br ${song.coverArtGradient || 'from-indigo-600 via-purple-700 to-pink-800'} p-5`}>
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => togglePlay(song)}
                        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/95 text-slate-900 shadow-lg transition hover:scale-105"
                      >
                        {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="ml-0.5 h-6 w-6" />}
                      </button>
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">Variação {vi + 1}</p>
                        <h3 className="truncate text-lg font-black text-white">{song.title}</h3>
                        <p className="text-xs text-white/80">{song.style} • {song.mood} • {song.bpm} BPM • {song.durationSeconds}s</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5 p-4">
                    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                      <Mic2 className="h-3.5 w-3.5 text-pink-400" /> Letra
                    </p>
                    <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                      {song.lyrics?.map((l, i) => (
                        <div key={i} className={`rounded-xl border px-3 py-2 text-xs leading-relaxed transition ${i === activeIdx ? 'border-purple-500/60 bg-purple-500/15 text-white' : 'border-slate-800/60 bg-slate-900/50 text-slate-400'}`}>
                          <span className={`font-bold ${i === activeIdx ? 'text-purple-300' : 'text-slate-500'}`}>{l.section}: </span>
                          {l.text}
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button type="button" onClick={() => onOpenInStudio(song)} className="flex-1 rounded-xl bg-purple-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-purple-500">
                        Abrir no Estúdio
                      </button>
                      <button type="button" onClick={() => handleDownloadWav(song)} disabled={exportingId === song.id} className="flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-50" title="Baixar WAV">
                        <FileAudio className="h-3.5 w-3.5" /> {exportingId === song.id ? '...' : 'WAV'}
                      </button>
                      <button type="button" onClick={() => downloadMidi(song)} className="flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-slate-700" title="Baixar MIDI">
                        <FileCode className="h-3.5 w-3.5" /> MIDI
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
