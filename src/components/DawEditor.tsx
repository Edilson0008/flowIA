import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play,
  Pause,
  Square,
  Repeat,
  Download,
  Share2,
  Volume2,
  VolumeX,
  Plus,
  Trash2,
  Music,
  Sliders,
  Disc,
  Activity,
  Layers,
  FileCode,
  FileAudio,
  Sparkles,
  ChevronRight,
  Eye,
} from 'lucide-react';
import { SongProject, Track, Note, InstrumentType } from '../types';
import { audioEngine } from '../services/audioEngine';
import { downloadMidi, midiToNoteName, noteNameToMidi } from '../services/midiEncoder';

interface DawEditorProps {
  project: SongProject;
  onUpdateProject: (updated: SongProject) => void;
  onOpenShareModal: (project: SongProject) => void;
}

const INSTRUMENT_OPTIONS: { id: InstrumentType; label: string }[] = [
  { id: 'acoustic_grand_piano', label: 'Piano de Cauda' },
  { id: 'electric_piano', label: 'Rhodes Electric Piano' },
  { id: 'acoustic_guitar', label: 'Violão Acústico' },
  { id: 'electric_guitar', label: 'Guitarra Elétrica' },
  { id: 'synth_lead', label: 'Lead Sintetizador' },
  { id: 'synth_pad', label: 'Pad Atmosférico' },
  { id: 'electric_bass', label: 'Baixo Elétrico' },
  { id: 'sub_bass_808', label: 'Sub-Bass 808' },
  { id: 'drum_kit', label: 'Bateria & Percussão' },
  { id: 'strings_ensemble', label: 'Cordas / Strings' },
  { id: 'brass_section', label: 'Metais / Brass' },
  { id: 'flute_sax', label: 'Flauta & Sax' },
];

export const DawEditor: React.FC<DawEditorProps> = ({
  project,
  onUpdateProject,
  onOpenShareModal,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [loopMode, setLoopMode] = useState(false);
  const [activeTrackId, setActiveTrackId] = useState<string>(project.tracks[0]?.id || '');
  const [activeTab, setActiveTab] = useState<'timeline' | 'lyrics'>('timeline');
  const [isExportingWav, setIsExportingWav] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Audio Canvas Visualizer
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Calculate total beats across all tracks
  const totalBeats = useMemo(() => {
    let max = 16;
    project.tracks.forEach((t) => {
      t.notes.forEach((n) => {
        const end = n.startBeat + n.duration;
        if (end > max) max = end;
      });
    });
    return Math.max(16, Math.ceil(max));
  }, [project.tracks]);

  // Track playback status & beat updates from audioEngine
  useEffect(() => {
    const handleBeatUpdate = (beat: number) => {
      setCurrentBeat(beat);
    };

    const handlePlaybackEnd = () => {
      if (loopMode) {
        audioEngine.play(project, 0);
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
        setCurrentBeat(0);
      }
    };

    audioEngine.onBeatUpdate(handleBeatUpdate);
    audioEngine.onPlaybackEnd(handlePlaybackEnd);

    return () => {
      audioEngine.stop();
    };
  }, [project, loopMode]);

  // Real-time Canvas Visualizer Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const analyser = audioEngine.getAnalyser();
    const bufferLength = analyser ? analyser.frequencyBinCount : 64;
    const dataArray = new Uint8Array(bufferLength);

    const renderVisualizer = () => {
      animFrameRef.current = requestAnimationFrame(renderVisualizer);

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      if (analyser && isPlaying) {
        analyser.getByteFrequencyData(dataArray);

        // Draw dynamic glowing bars
        const barWidth = (width / bufferLength) * 2.2;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * height * 0.9;

          // Gradient from purple to pink/cyan
          const grad = ctx.createLinearGradient(0, height, 0, 0);
          grad.addColorStop(0, '#7c3aed');
          grad.addColorStop(0.5, '#ec4899');
          grad.addColorStop(1, '#06b6d4');

          ctx.fillStyle = grad;
          ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);

          x += barWidth;
        }
      } else {
        // Idle calm wave
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const sliceWidth = width / 50;
        let x = 0;
        for (let i = 0; i <= 50; i++) {
          const y = height / 2 + Math.sin(i * 0.2 + Date.now() * 0.001) * 3;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.stroke();
      }
    };

    renderVisualizer();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying]);

  // Play / Pause Toggle
  const handleTogglePlay = () => {
    if (isPlaying) {
      audioEngine.pause();
      setIsPlaying(false);
    } else {
      audioEngine.play(project, currentBeat >= totalBeats ? 0 : currentBeat);
      setIsPlaying(true);
    }
  };

  const handleStop = () => {
    audioEngine.stop();
    setIsPlaying(false);
    setCurrentBeat(0);
  };

  const handleSeek = (beat: number) => {
    setCurrentBeat(beat);
    if (isPlaying) {
      audioEngine.play(project, beat);
    }
  };

  // Track Mixer controls
  const handleToggleMute = (trackId: string) => {
    const updatedTracks = project.tracks.map((t) =>
      t.id === trackId ? { ...t, muted: !t.muted } : t
    );
    const updated = { ...project, tracks: updatedTracks };
    onUpdateProject(updated);
    if (isPlaying) audioEngine.play(updated, currentBeat);
  };

  const handleToggleSolo = (trackId: string) => {
    const updatedTracks = project.tracks.map((t) =>
      t.id === trackId ? { ...t, solo: !t.solo } : t
    );
    const updated = { ...project, tracks: updatedTracks };
    onUpdateProject(updated);
    if (isPlaying) audioEngine.play(updated, currentBeat);
  };

  const handleVolumeChange = (trackId: string, vol: number) => {
    const updatedTracks = project.tracks.map((t) =>
      t.id === trackId ? { ...t, volume: vol } : t
    );
    const updated = { ...project, tracks: updatedTracks };
    onUpdateProject(updated);
  };

  const handleInstrumentChange = (trackId: string, inst: InstrumentType) => {
    const updatedTracks = project.tracks.map((t) =>
      t.id === trackId ? { ...t, instrument: inst } : t
    );
    const updated = { ...project, tracks: updatedTracks };
    onUpdateProject(updated);
  };

  const handleBpmChange = (bpm: number) => {
    const updated = { ...project, bpm: Math.max(50, Math.min(220, bpm)) };
    onUpdateProject(updated);
    if (isPlaying) audioEngine.play(updated, currentBeat);
  };

  // Delete note
  const handleDeleteNote = (trackId: string, noteId: string) => {
    const updatedTracks = project.tracks.map((t) => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        notes: t.notes.filter((n) => n.id !== noteId),
      };
    });
    const updated = { ...project, tracks: updatedTracks };
    onUpdateProject(updated);
    if (isPlaying) audioEngine.play(updated, currentBeat);
  };

  // Add sample note to active track
  const handleAddNoteToTrack = (trackId: string) => {
    const track = project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const defaultMidi = track.instrument === 'drum_kit' ? 36 : 60; // C4 or Kick
    const newNote: Note = {
      id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      pitch: midiToNoteName(defaultMidi),
      midi: defaultMidi,
      startBeat: Math.floor(currentBeat),
      duration: 1.0,
      velocity: 90,
    };
    const updatedTracks = project.tracks.map((t) =>
      t.id === trackId ? { ...t, notes: [...t.notes, newNote] } : t
    );
    const updated = { ...project, tracks: updatedTracks };
    onUpdateProject(updated);
    if (isPlaying) audioEngine.play(updated, currentBeat);
  };

  // Export handlers
  const handleExportWav = async () => {
    setIsExportingWav(true);
    try {
      await audioEngine.downloadWav(project);
    } catch (err) {
      console.error(err);
    } finally {
      setIsExportingWav(false);
      setShowExportMenu(false);
    }
  };

  const handleExportMidi = () => {
    downloadMidi(project);
    setShowExportMenu(false);
  };

  const handleExportProjectJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}_project.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setShowExportMenu(false);
  };

  // Beat ruler divisions
  const rulerBeats = Array.from({ length: totalBeats }, (_, i) => i);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      {/* DAW Header Banner */}
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-[#12131f] p-5 shadow-2xl sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr ${project.coverArtGradient || 'from-purple-600 to-indigo-600'} shadow-lg`}>
            <Sliders className="h-7 w-7 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-white">{project.title}</h1>
              <span className="rounded-full bg-purple-500/20 px-2.5 py-0.5 text-xs font-semibold text-purple-300">
                {project.style}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {project.tracks.length} Faixas • {project.key} • {project.bpm} BPM • {project.durationSeconds}s
            </p>
          </div>
        </div>

        {/* Global Transport & Export Action Hub */}
        <div className="flex items-center gap-2.5">
          {/* Share Button */}
          <button
            onClick={() => onOpenShareModal(project)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            <Share2 className="h-3.5 w-3.5 text-pink-400" />
            <span>Compartilhar</span>
          </button>

          {/* Export Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-3.5 py-2 text-xs font-bold text-white shadow-lg shadow-purple-600/20 transition hover:from-purple-500 hover:to-pink-500"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Exportar</span>
            </button>

            {showExportMenu && (
              <div className="absolute right-0 top-11 z-50 w-52 rounded-2xl border border-slate-700 bg-[#161726] p-2 shadow-2xl text-xs space-y-1">
                <button
                  onClick={handleExportWav}
                  disabled={isExportingWav}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-slate-200 transition hover:bg-purple-600/20 hover:text-white"
                >
                  <FileAudio className="h-4 w-4 text-purple-400" />
                  <div>
                    <p className="font-bold">Áudio WAV (.wav)</p>
                    <p className="text-[10px] text-slate-400">Master Studio 44.1kHz Stereo</p>
                  </div>
                </button>

                <button
                  onClick={handleExportMidi}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-slate-200 transition hover:bg-pink-600/20 hover:text-white"
                >
                  <Music className="h-4 w-4 text-pink-400" />
                  <div>
                    <p className="font-bold">Arquivo MIDI (.mid)</p>
                    <p className="text-[10px] text-slate-400">Multi-faixas para FL Studio/DAWs</p>
                  </div>
                </button>

                <button
                  onClick={handleExportProjectJson}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-slate-200 transition hover:bg-indigo-600/20 hover:text-white"
                >
                  <FileCode className="h-4 w-4 text-indigo-400" />
                  <div>
                    <p className="font-bold">Projeto Harmonix (.json)</p>
                    <p className="text-[10px] text-slate-400">Backup e edição posterior</p>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Transport Bar & Live Visualizer */}
      <div className="rounded-2xl border border-slate-800 bg-[#12131f] p-4 shadow-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          {/* Playback Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleTogglePlay}
              className={`flex h-11 w-11 items-center justify-center rounded-xl font-bold text-white shadow-lg transition ${
                isPlaying
                  ? 'bg-amber-600 hover:bg-amber-500'
                  : 'bg-purple-600 hover:bg-purple-500'
              }`}
              title={isPlaying ? 'Pausar' : 'Reproduzir'}
            >
              {isPlaying ? <Pause className="h-5 w-5 fill-white" /> : <Play className="h-5 w-5 fill-white translate-x-0.5" />}
            </button>

            <button
              onClick={handleStop}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300 transition hover:bg-slate-700 hover:text-white"
              title="Parar e voltar ao início"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>

            <button
              onClick={() => setLoopMode(!loopMode)}
              className={`flex h-10 w-10 items-center justify-center rounded-xl border transition ${
                loopMode
                  ? 'border-purple-500 bg-purple-900/40 text-purple-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title="Repetir em loop"
            >
              <Repeat className="h-4 w-4" />
            </button>

            {/* Time / Beat Display */}
            <div className="ml-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 font-mono text-xs">
              <span className="text-slate-400">Tempo: </span>
              <span className="font-bold text-purple-300">{currentBeat.toFixed(1)}</span>
              <span className="text-slate-500"> / {totalBeats}</span>
            </div>
          </div>

          {/* Real-time Spectrum Canvas Visualizer */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Activity className="h-4 w-4 text-purple-400" />
              <span className="hidden sm:inline">Espectro:</span>
            </div>
            <canvas
              ref={canvasRef}
              width={220}
              height={36}
              className="rounded-xl border border-slate-800 bg-slate-950/80"
            />
          </div>

          {/* BPM & Master Tempo slider */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <span className="text-slate-400">BPM:</span>
              <input
                type="number"
                min="50"
                max="220"
                value={project.bpm}
                onChange={(e) => handleBpmChange(parseInt(e.target.value, 10) || 120)}
                className="w-16 rounded-lg border border-slate-700 bg-slate-900 p-1 text-center font-mono font-bold text-purple-300 focus:outline-none"
              />
            </div>

            {/* View Switcher: Timeline vs Lyrics */}
            <div className="flex rounded-xl bg-slate-900 p-1 border border-slate-800 text-xs">
              <button
                onClick={() => setActiveTab('timeline')}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  activeTab === 'timeline' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Pistas
              </button>
              <button
                onClick={() => setActiveTab('lyrics')}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  activeTab === 'lyrics' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Letra
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Multi-Track DAW Arranger */}
      {activeTab === 'timeline' ? (
        <div className="space-y-4 rounded-3xl border border-slate-800 bg-[#12131f] p-4 sm:p-6 shadow-2xl">
          {/* Scrubber / Beat Ruler */}
          <div className="relative flex items-center overflow-x-auto pb-2 border-b border-slate-800">
            <div className="w-56 flex-shrink-0 text-xs font-bold text-slate-400 uppercase tracking-wider">
              Pistas & Instrumentos
            </div>
            <div className="relative flex-1 min-w-[500px]">
              {/* Beat markers */}
              <div className="flex text-[10px] font-mono text-slate-500">
                {rulerBeats.map((b) => (
                  <div
                    key={b}
                    onClick={() => handleSeek(b)}
                    className="flex-1 cursor-pointer border-l border-slate-800/80 px-1 hover:text-purple-400 transition"
                  >
                    {b + 1}
                  </div>
                ))}
              </div>

              {/* Playhead Vertical Line */}
              <div
                className="absolute top-0 bottom-0 z-30 w-0.5 bg-pink-500 shadow-md shadow-pink-500 pointer-events-none transition-all duration-75"
                style={{
                  left: `${(currentBeat / totalBeats) * 100}%`,
                }}
              >
                <div className="absolute -top-1 -left-1.5 h-3 w-3 rounded-full bg-pink-500 border border-white" />
              </div>
            </div>
          </div>

          {/* Track Rows */}
          <div className="space-y-3">
            {project.tracks.map((track) => {
              const isTrackActive = activeTrackId === track.id;
              return (
                <div
                  key={track.id}
                  onClick={() => setActiveTrackId(track.id)}
                  className={`flex flex-col gap-3 rounded-2xl border p-3.5 transition sm:flex-row sm:items-center ${
                    isTrackActive
                      ? 'border-purple-500/50 bg-slate-900/90 shadow-lg'
                      : 'border-slate-800/80 bg-slate-900/40 hover:border-slate-700'
                  }`}
                >
                  {/* Left Track Channel Strip */}
                  <div className="w-full sm:w-56 flex-shrink-0 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: track.color || '#a855f7' }}
                        />
                        <span className="text-xs font-bold text-white truncate">{track.name}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {track.notes.length} notas
                      </span>
                    </div>

                    {/* Instrument Selector */}
                    <select
                      value={track.instrument}
                      onChange={(e) => handleInstrumentChange(track.id, e.target.value as InstrumentType)}
                      className="w-full rounded-lg border border-slate-700/80 bg-slate-950 p-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500"
                    >
                      {INSTRUMENT_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>

                    {/* Mute, Solo, Volume */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleMute(track.id);
                        }}
                        className={`rounded px-2 py-0.5 text-[10px] font-bold transition ${
                          track.muted
                            ? 'bg-red-600 text-white'
                            : 'bg-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        M
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleSolo(track.id);
                        }}
                        className={`rounded px-2 py-0.5 text-[10px] font-bold transition ${
                          track.solo
                            ? 'bg-yellow-500 text-black font-extrabold'
                            : 'bg-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        S
                      </button>

                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={track.volume ?? 0.8}
                        onChange={(e) => handleVolumeChange(track.id, parseFloat(e.target.value))}
                        className="w-20 accent-purple-500"
                        title={`Volume: ${Math.round((track.volume ?? 0.8) * 100)}%`}
                      />

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddNoteToTrack(track.id);
                        }}
                        className="rounded bg-slate-800 p-1 text-slate-400 hover:bg-purple-600 hover:text-white transition"
                        title="Adicionar nota neste tempo"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {/* Right: Piano Roll / Step Grid */}
                  <div className="relative flex-1 min-w-[500px] h-16 rounded-xl border border-slate-800/80 bg-slate-950/60 overflow-hidden">
                    {/* Background grid lines */}
                    <div className="absolute inset-0 flex">
                      {rulerBeats.map((b) => (
                        <div key={b} className="flex-1 border-r border-slate-800/30" />
                      ))}
                    </div>

                    {/* Note Blocks */}
                    {track.notes.map((note) => {
                      const leftPercent = (note.startBeat / totalBeats) * 100;
                      const widthPercent = Math.max(1.5, (note.duration / totalBeats) * 100);
                      // Map pitch vertically inside track container
                      const topOffset = ((127 - (note.midi % 24) * 5) % 40) + 4;

                      return (
                        <div
                          key={note.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteNote(track.id, note.id);
                          }}
                          className="group absolute rounded-md px-1 py-0.5 text-[9px] font-mono font-bold text-white shadow-sm cursor-pointer transition hover:opacity-80 overflow-hidden"
                          style={{
                            left: `${leftPercent}%`,
                            width: `${widthPercent}%`,
                            top: `${topOffset}px`,
                            backgroundColor: track.color || '#a855f7',
                          }}
                          title={`${note.pitch} (${note.midi}) - Duração: ${note.duration}b. Clique para remover.`}
                        >
                          <span className="truncate">{note.pitch}</span>
                        </div>
                      );
                    })}

                    {/* Active Track Highlight indicator */}
                    {isTrackActive && (
                      <div className="pointer-events-none absolute inset-0 border border-purple-500/30 rounded-xl" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Lyrics & Arrangement Structure View */
        <div className="rounded-3xl border border-slate-800 bg-[#12131f] p-6 shadow-2xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Music className="h-4 w-4 text-purple-400" />
              Letra & Estrutura da Canção
            </h3>
            <span className="text-xs text-slate-400 font-medium">Sincronização Poética</span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {project.lyrics && project.lyrics.length > 0 ? (
              project.lyrics.map((lyric, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 transition hover:border-purple-500/40"
                >
                  <span className="inline-block rounded-md bg-purple-500/20 px-2 py-0.5 text-[11px] font-bold text-purple-300">
                    {lyric.section}
                  </span>
                  <p className="mt-2 text-sm text-slate-200 leading-relaxed italic">
                    "{lyric.text}"
                  </p>
                </div>
              ))
            ) : (
              <div className="col-span-2 py-8 text-center text-slate-400 text-xs">
                Faixa instrumental sem letra definida.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
