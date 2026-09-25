import React, { useState } from 'react';
import {
  Sparkles,
  Music2,
  Wand2,
  Sliders,
  Image as ImageIcon,
  Clock,
  Volume2,
  Play,
  RotateCw,
  Flame,
  Check,
  Disc,
} from 'lucide-react';
import { SongProject, InstrumentType } from '../types';

interface MusicCreatorProps {
  onSongGenerated: (song: SongProject) => void;
}

const STYLES = [
  { id: 'Lo-Fi', label: 'Lo-Fi Chillhop', icon: '☕', desc: 'Batidas relaxantes e nostálgicas' },
  { id: 'Synthwave', label: 'Synthwave 80s', icon: '🌆', desc: 'Retrofuturismo e sintetizadores neon' },
  { id: 'Pop', label: 'Pop Moderno', icon: '✨', desc: 'Melodias marcantes e envolventes' },
  { id: 'Samba/Bossa Nova', label: 'Samba & Bossa Nova', icon: '🌴', desc: 'Harmonias brasileiras e violão suave' },
  { id: 'EDM', label: 'Eletrônica / EDM', icon: '⚡', desc: 'Drops enérgicos e sintetizadores pesados' },
  { id: 'Rock', label: 'Rock & Indie', icon: '🎸', desc: 'Guitarras enérgicas e bateria pulsante' },
  { id: 'Jazz', label: 'Jazz & Soul', icon: '🎷', desc: 'Harmonias ricas e improvisos sofisticados' },
  { id: 'Hip-Hop', label: 'Hip-Hop / Trap', icon: '🎤', desc: 'Graves 808 pesados e ritmo cadenciado' },
  { id: 'Classical', label: 'Clássica / Orquestral', icon: '🎻', desc: 'Cordas grandiosas e piano emotivo' },
  { id: 'Ambient', label: 'Ambient & Meditação', icon: '🌌', desc: 'Camadas sonoras etéreas e calmas' },
  { id: 'Cinematic', label: 'Cinematográfica', icon: '🎬', desc: 'Trilhas épicas e atmosféricas para cinema' },
];

const MOODS = [
  'Relaxante',
  'Energético',
  'Melancólico',
  'Alegre',
  'Épico',
  'Futurista',
  'Romântico',
  'Sombrio',
];

const KEYS = [
  'C Major',
  'G Major',
  'D Major',
  'A Minor',
  'E Minor',
  'F Major',
  'D Minor',
  'Bb Major',
  'B Minor',
  'Eb Major',
];

const AVAILABLE_INSTRUMENTS: { id: InstrumentType; label: string; icon: string }[] = [
  { id: 'acoustic_grand_piano', label: 'Piano de Cauda', icon: '🎹' },
  { id: 'electric_piano', label: 'Piano Elétrico Rhodes', icon: '🎹' },
  { id: 'acoustic_guitar', label: 'Violão Acústico', icon: '🎸' },
  { id: 'electric_guitar', label: 'Guitarra Elétrica', icon: '🎸' },
  { id: 'synth_lead', label: 'Lead Sintetizador', icon: '🎛️' },
  { id: 'synth_pad', label: 'Pad Atmosférico', icon: '✨' },
  { id: 'electric_bass', label: 'Baixo Groove', icon: '🎸' },
  { id: 'sub_bass_808', label: 'Sub-Bass 808', icon: '🔊' },
  { id: 'drum_kit', label: 'Bateria & Percussão', icon: '🥁' },
  { id: 'strings_ensemble', label: 'Ensemble de Cordas', icon: '🎻' },
  { id: 'brass_section', label: 'Metais / Brass', icon: '🎺' },
  { id: 'flute_sax', label: 'Flauta & Saxofone', icon: '🎷' },
];

const PROMPT_INSPIRATIONS = [
  {
    title: 'Café na Chuva',
    prompt: 'Lo-fi chillhop nostálgico com piano elétrico suave, batida lenta e linhas de baixo relaxantes para estudos e concentração.',
    style: 'Lo-Fi',
    mood: 'Relaxante',
    bpm: 82,
  },
  {
    title: 'Viagem Noturna 1984',
    prompt: 'Synthwave anos 80 acelerado, arpejador analógico retrô, baterias eletrônicas gated reverb e clima de viagem futurista à meia-noite.',
    style: 'Synthwave',
    mood: 'Futurista',
    bpm: 120,
  },
  {
    title: 'Tarde em Ipanema',
    prompt: 'Bossa nova brasileira aconchegante com violão de nylon sincopado, flauta doce, percussão suave e harmonia sofisticada.',
    style: 'Samba/Bossa Nova',
    mood: 'Alegre',
    bpm: 96,
  },
  {
    title: 'Despertar de Heróis',
    prompt: 'Trilha cinematográfica épica com cordas orquestrais crescentes, percussão marcante e piano solista inspirador.',
    style: 'Cinematic',
    mood: 'Épico',
    bpm: 110,
  },
];

export const MusicCreator: React.FC<MusicCreatorProps> = ({ onSongGenerated }) => {
  const [prompt, setPrompt] = useState('Lo-fi chillhop suave com piano elétrico e batida relaxante');
  const [selectedStyle, setSelectedStyle] = useState('Lo-Fi');
  const [selectedMood, setSelectedMood] = useState('Relaxante');
  const [selectedKey, setSelectedKey] = useState('C Major');
  const [bpm, setBpm] = useState(84);
  const [selectedInstruments, setSelectedInstruments] = useState<InstrumentType[]>([
    'electric_piano',
    'electric_bass',
    'drum_kit',
    'synth_pad',
  ]);
  const [modelType, setModelType] = useState<'lyria-clip' | 'lyria-pro' | 'gemini-flash' | 'local'>('gemini-flash');
  const [durationSeconds, setDurationSeconds] = useState(30);
  const [imageInspiration, setImageInspiration] = useState<{ base64: string; mimeType: string } | null>(null);

  // Status
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [generationStep, setGenerationStep] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const toggleInstrument = (inst: InstrumentType) => {
    setSelectedInstruments((prev) =>
      prev.includes(inst) ? prev.filter((i) => i !== inst) : [...prev, inst]
    );
  };

  const handleEnhancePrompt = async () => {
    if (!prompt.trim() || isEnhancing) return;
    setIsEnhancing(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/enhance-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: prompt,
          style: selectedStyle,
          mood: selectedMood,
          instruments: selectedInstruments,
        }),
      });
      const data = await res.json();
      if (data.enhancedPrompt) {
        setPrompt(data.enhancedPrompt);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      setImageInspiration({ base64, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  };

  const applyInspiration = (item: (typeof PROMPT_INSPIRATIONS)[0]) => {
    setPrompt(item.prompt);
    setSelectedStyle(item.style);
    setSelectedMood(item.mood);
    setBpm(item.bpm);
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setErrorMessage(null);
    setGenerationStep('Iniciando motores de Inteligência Artificial...');

    try {
      setGenerationStep(
        modelType.startsWith('lyria')
          ? 'Processando áudio com Lyria AI e sintetizando arranjo multi-faixas...'
          : 'Compondo partitura multi-faixas com Gemini 3.8 Flash...'
      );

      const res = await fetch('/api/generate-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          style: selectedStyle,
          mood: selectedMood,
          bpm,
          key: selectedKey,
          instruments: selectedInstruments,
          modelType,
          durationSeconds,
          imageBase64: imageInspiration?.base64,
          imageMimeType: imageInspiration?.mimeType,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || `Erro do servidor: ${res.statusText}`);
      }

      setGenerationStep('Finalizando mixagem, faixas MIDI e renderização...');
      const data = await res.json();

      if (data.song) {
        onSongGenerated(data.song);
      } else {
        throw new Error('Nenhuma faixa musical foi retornada.');
      }
    } catch (err: unknown) {
      console.error('Generation error:', err);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Ocorreu um erro durante a criação. Tente novamente.'
      );
    } finally {
      setIsGenerating(false);
      setGenerationStep('');
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-6 lg:p-8">
      {/* Hero Welcome */}
      <div className="relative overflow-hidden rounded-3xl border border-purple-900/40 bg-gradient-to-br from-purple-950/40 via-[#131422] to-[#0c0d15] p-6 sm:p-8 shadow-2xl">
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-purple-600/20 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-pink-600/15 blur-3xl" />

        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-semibold text-purple-300">
            <Sparkles className="h-3.5 w-3.5 text-yellow-400" />
            <span>Geração de Música com IA Generativa</span>
          </div>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-4xl">
            Crie Músicas Inéditas com{' '}
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-300 bg-clip-text text-transparent">
              Lyria & Gemini
            </span>
          </h1>
          <p className="mt-2 text-sm text-slate-300 sm:text-base leading-relaxed">
            Selecione estilos, instrumentos, tempo e emoção. Gere áudio completo ou partituras multi-faixas
            editáveis no DAW, com exportação em <strong>MIDI</strong> e <strong>WAV</strong> de alta fidelidade.
          </p>
        </div>

        {/* Quick Inspiration Pills */}
        <div className="relative z-10 mt-6 pt-4 border-t border-slate-800/80">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Inspirações Rápidas:
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {PROMPT_INSPIRATIONS.map((insp, i) => (
              <button
                key={i}
                type="button"
                onClick={() => applyInspiration(insp)}
                className="flex items-center gap-1.5 rounded-full border border-slate-700/80 bg-slate-800/60 px-3 py-1 text-xs text-slate-300 transition hover:border-purple-500/50 hover:bg-purple-900/20 hover:text-white"
              >
                <span>{insp.title}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Creation Form Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Prompt & Model Configuration */}
        <div className="space-y-6 lg:col-span-7">
          {/* Prompt Box */}
          <div className="rounded-2xl border border-slate-800 bg-[#12131f] p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <Music2 className="h-4 w-4 text-purple-400" />
                Descrição da Música (Prompt)
              </label>
              <button
                type="button"
                onClick={handleEnhancePrompt}
                disabled={isEnhancing || !prompt.trim()}
                className="flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/10 px-2.5 py-1 text-xs font-semibold text-purple-300 transition hover:bg-purple-500/20 disabled:opacity-50"
              >
                <Wand2 className={`h-3.5 w-3.5 ${isEnhancing ? 'animate-spin' : ''}`} />
                <span>{isEnhancing ? 'Melhorando...' : '✨ Melhorar com IA'}</span>
              </button>
            </div>

            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Ex: Uma canção pop energética com sintetizadores anos 80, bateria pulsante e refrão memorável..."
              className="mt-3 w-full rounded-xl border border-slate-700/80 bg-slate-900/90 p-3.5 text-sm text-slate-100 placeholder-slate-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />

            {/* Optional Image Upload for Lyria */}
            <div className="mt-3 flex items-center justify-between pt-3 border-t border-slate-800 text-xs">
              <div className="flex items-center gap-2 text-slate-400">
                <ImageIcon className="h-4 w-4 text-slate-400" />
                <span>Inspiração por Imagem (Opcional)</span>
              </div>
              <label className="cursor-pointer rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-slate-300 transition hover:bg-slate-700">
                {imageInspiration ? '✓ Imagem Carregada' : 'Selecionar Foto'}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Model & Output Engine */}
          <div className="rounded-2xl border border-slate-800 bg-[#12131f] p-5 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Disc className="h-4 w-4 text-pink-400" />
              Motor de Geração de Música
            </h3>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* Lyria Clip */}
              <button
                type="button"
                onClick={() => {
                  setModelType('lyria-clip');
                  setDurationSeconds(30);
                }}
                className={`relative flex flex-col rounded-xl border p-3.5 text-left transition ${
                  modelType === 'lyria-clip'
                    ? 'border-purple-500 bg-purple-950/40 text-white shadow-lg shadow-purple-900/30'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-300">Lyria 3 Clip</span>
                  <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-300">
                    Áudio IA
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-300 font-medium">Clips até 30s</p>
                <p className="mt-0.5 text-[11px] text-slate-400">Geração de áudio direto com o modelo Lyria</p>
              </button>

              {/* Lyria Pro */}
              <button
                type="button"
                onClick={() => {
                  setModelType('lyria-pro');
                  setDurationSeconds(60);
                }}
                className={`relative flex flex-col rounded-xl border p-3.5 text-left transition ${
                  modelType === 'lyria-pro'
                    ? 'border-pink-500 bg-pink-950/40 text-white shadow-lg shadow-pink-900/30'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-pink-300">Lyria 3 Pro</span>
                  <span className="rounded bg-pink-500/20 px-1.5 py-0.5 text-[10px] text-pink-300">
                    Full Track
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-300 font-medium">Faixa Completa</p>
                <p className="mt-0.5 text-[11px] text-slate-400">Áudio estendido com estrutura e letra</p>
              </button>

              {/* Gemini Flash Composer */}
              <button
                type="button"
                onClick={() => {
                  setModelType('gemini-flash');
                  setDurationSeconds(30);
                }}
                className={`relative flex flex-col rounded-xl border p-3.5 text-left transition ${
                  modelType === 'gemini-flash'
                    ? 'border-indigo-500 bg-indigo-950/40 text-white shadow-lg shadow-indigo-900/30'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-300">Gemini 3.8 Flash</span>
                  <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-300">
                    DAW & MIDI
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-300 font-medium">Arranjador Multi-faixas</p>
                <p className="mt-0.5 text-[11px] text-slate-400">Gera notas MIDI completas para edição</p>
              </button>
            </div>
          </div>

          {/* Style Grid */}
          <div className="rounded-2xl border border-slate-800 bg-[#12131f] p-5 shadow-xl space-y-3">
            <h3 className="text-sm font-bold text-slate-200">Estilo Musical</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {STYLES.map((style) => {
                const isSelected = selectedStyle === style.id;
                return (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => setSelectedStyle(style.id)}
                    className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition ${
                      isSelected
                        ? 'border-purple-500 bg-purple-900/30 text-white'
                        : 'border-slate-800/80 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <span className="text-lg">{style.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold truncate">{style.label}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Musical Parameters & Instruments */}
        <div className="space-y-6 lg:col-span-5">
          {/* Instruments Checklist */}
          <div className="rounded-2xl border border-slate-800 bg-[#12131f] p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-200">Instrumentos Desejados</h3>
              <span className="text-xs text-purple-400 font-medium">
                {selectedInstruments.length} selecionados
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {AVAILABLE_INSTRUMENTS.map((inst) => {
                const isSelected = selectedInstruments.includes(inst.id);
                return (
                  <button
                    key={inst.id}
                    type="button"
                    onClick={() => toggleInstrument(inst.id)}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-medium transition ${
                      isSelected
                        ? 'border-purple-500/60 bg-purple-500/10 text-white'
                        : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span>{inst.icon}</span>
                      <span>{inst.label}</span>
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 text-purple-400" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tempo (BPM), Key & Mood Controls */}
          <div className="rounded-2xl border border-slate-800 bg-[#12131f] p-5 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Sliders className="h-4 w-4 text-purple-400" />
              Parâmetros Musicais
            </h3>

            {/* BPM Slider */}
            <div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Andamento (Tempo)</span>
                <span className="font-mono font-bold text-purple-300">{bpm} BPM</span>
              </div>
              <input
                type="range"
                min="60"
                max="180"
                value={bpm}
                onChange={(e) => setBpm(parseInt(e.target.value, 10))}
                className="mt-2 w-full accent-purple-500"
              />
            </div>

            {/* Key and Scale */}
            <div>
              <label className="text-xs text-slate-400">Tonalidade Musical</label>
              <select
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-xs text-slate-200 focus:border-purple-500 focus:outline-none"
              >
                {KEYS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>

            {/* Mood selector */}
            <div>
              <label className="text-xs text-slate-400">Clima & Emoção</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {MOODS.map((m) => {
                  const isSelected = selectedMood === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSelectedMood(m)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                        isSelected
                          ? 'bg-purple-600 text-white shadow-sm'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Action Generate Button */}
          <div className="space-y-3">
            {errorMessage && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 leading-relaxed">
                {errorMessage}
              </div>
            )}

            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              className="relative flex w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-600 py-4 text-base font-extrabold text-white shadow-xl shadow-purple-600/30 transition hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <RotateCw className="h-5 w-5 animate-spin" />
                  <span>Gerando com Inteligência Artificial...</span>
                </>
              ) : (
                <>
                  <Flame className="h-5 w-5 text-yellow-300" />
                  <span>Criar Música Agora</span>
                </>
              )}
            </button>

            {isGenerating && (
              <div className="rounded-xl border border-purple-500/20 bg-purple-950/20 p-3 text-center">
                <p className="text-xs text-purple-300 font-medium animate-pulse">{generationStep}</p>
                <div className="mt-2 flex justify-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-purple-500 animate-ping" />
                  <span className="h-2 w-2 rounded-full bg-pink-500 animate-ping delay-150" />
                  <span className="h-2 w-2 rounded-full bg-indigo-500 animate-ping delay-300" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
