import React, { useState } from 'react';
import {
  Search,
  FolderHeart,
  Music,
  Play,
  Pause,
  Sliders,
  Download,
  Trash2,
  Copy,
  Star,
  Clock,
  Sparkles,
  Filter,
} from 'lucide-react';
import { SongProject } from '../types';
import { audioEngine } from '../services/audioEngine';
import { downloadMidi } from '../services/midiEncoder';

interface ProjectHistoryProps {
  projects: SongProject[];
  onSelectProjectForDaw: (project: SongProject) => void;
  onToggleFavorite: (id: string) => void;
  onDuplicateProject: (project: SongProject) => void;
  onDeleteProject: (id: string) => void;
  onNewMusicClick: () => void;
}

export const ProjectHistory: React.FC<ProjectHistoryProps> = ({
  projects,
  onSelectProjectForDaw,
  onToggleFavorite,
  onDuplicateProject,
  onDeleteProject,
  onNewMusicClick,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStyleFilter, setSelectedStyleFilter] = useState<string>('all');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Filter projects
  const filteredProjects = projects.filter((p) => {
    const matchesSearch =
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.style.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.prompt.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStyle = selectedStyleFilter === 'all' || p.style === selectedStyleFilter;
    const matchesFav = !onlyFavorites || p.isFavorite;

    return matchesSearch && matchesStyle && matchesFav;
  });

  const availableStyles = Array.from(new Set(projects.map((p) => p.style)));

  const handleTogglePreviewPlay = (project: SongProject) => {
    if (playingId === project.id) {
      audioEngine.stop();
      setPlayingId(null);
    } else {
      audioEngine.play(project, 0);
      setPlayingId(project.id);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      {/* Header and Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2.5">
            <FolderHeart className="h-6 w-6 text-pink-400" />
            Histórico de Projetos & Gravações
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Todas as suas composições salvas no dispositivo com acesso offline e sincronização em nuvem
          </p>
        </div>

        <button
          onClick={onNewMusicClick}
          className="flex items-center gap-2 self-start rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-purple-600/25 transition hover:from-purple-500 hover:to-pink-500 sm:self-auto"
        >
          <Sparkles className="h-4 w-4" />
          <span>Nova Composição</span>
        </button>
      </div>

      {/* Search and Filters Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-[#12131f] p-4 shadow-xl sm:flex-row sm:items-center">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por título, estilo ou ideias..."
            className="w-full rounded-xl border border-slate-700/80 bg-slate-900/90 py-2 pl-10 pr-4 text-xs text-slate-100 placeholder-slate-500 focus:border-purple-500 focus:outline-none"
          />
        </div>

        {/* Style Filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <select
            value={selectedStyleFilter}
            onChange={(e) => setSelectedStyleFilter(e.target.value)}
            className="rounded-xl border border-slate-700/80 bg-slate-900 px-3 py-2 text-xs text-slate-200 focus:border-purple-500 focus:outline-none"
          >
            <option value="all">Todos os Estilos</option>
            {availableStyles.map((style) => (
              <option key={style} value={style}>
                {style}
              </option>
            ))}
          </select>

          {/* Only Favorites toggle */}
          <button
            onClick={() => setOnlyFavorites(!onlyFavorites)}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
              onlyFavorites
                ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-300'
                : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Star className={`h-3.5 w-3.5 ${onlyFavorites ? 'fill-yellow-400' : ''}`} />
            <span>Favoritos</span>
          </button>
        </div>
      </div>

      {/* Projects Grid */}
      {filteredProjects.length === 0 ? (
        <div className="rounded-3xl border border-slate-800 bg-[#12131f] p-12 text-center text-slate-400">
          <Music className="mx-auto h-12 w-12 text-slate-600" />
          <h3 className="mt-4 text-base font-bold text-white">Nenhuma música encontrada</h3>
          <p className="mt-1 text-xs text-slate-400">
            Tente ajustar os filtros ou crie uma nova faixa com inteligência artificial.
          </p>
          <button
            onClick={onNewMusicClick}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-purple-500"
          >
            <Sparkles className="h-4 w-4" />
            <span>Criar Primeira Música</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => {
            const isPlayingThis = playingId === project.id;
            return (
              <div
                key={project.id}
                className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-slate-800 bg-[#12131f] p-5 shadow-xl transition hover:border-purple-500/40 hover:shadow-2xl"
              >
                <div>
                  {/* Card Top: Gradient Cover & Play Button */}
                  <div className="relative mb-4 overflow-hidden rounded-2xl">
                    <div
                      className={`flex h-36 w-full items-center justify-center bg-gradient-to-tr ${
                        project.coverArtGradient || 'from-purple-600 via-indigo-700 to-pink-600'
                      } shadow-inner`}
                    >
                      {/* Big Play / Pause Circle */}
                      <button
                        onClick={() => handleTogglePreviewPlay(project)}
                        className={`flex h-14 w-14 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition transform group-hover:scale-110 shadow-lg ${
                          isPlayingThis ? 'bg-pink-600 text-white' : 'hover:bg-purple-600'
                        }`}
                        title={isPlayingThis ? 'Pausar áudio' : 'Ouvir prévia'}
                      >
                        {isPlayingThis ? (
                          <Pause className="h-6 w-6 fill-white" />
                        ) : (
                          <Play className="h-6 w-6 fill-white translate-x-0.5" />
                        )}
                      </button>
                    </div>

                    {/* Style and BPM badges */}
                    <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                      <span className="rounded-lg bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
                        {project.style}
                      </span>
                      <span className="rounded-lg bg-black/60 px-2 py-0.5 text-[10px] font-mono text-purple-300 backdrop-blur-sm">
                        {project.bpm} BPM
                      </span>
                    </div>

                    {/* Favorite star */}
                    <button
                      onClick={() => onToggleFavorite(project.id)}
                      className="absolute top-2.5 right-2.5 rounded-lg bg-black/50 p-1.5 text-white backdrop-blur-sm transition hover:bg-black/80"
                      title="Marcar como favorito"
                    >
                      <Star
                        className={`h-4 w-4 ${
                          project.isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-slate-300'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Title & Metadata */}
                  <h3 className="text-base font-bold text-white truncate group-hover:text-purple-300 transition">
                    {project.title}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-400 leading-relaxed">
                    {project.prompt}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-slate-400" />
                      {new Date(project.updatedAt).toLocaleDateString('pt-BR')}
                    </span>
                    <span>•</span>
                    <span>{project.tracks.length} Pistas</span>
                    <span>•</span>
                    <span className="font-mono text-purple-400">{project.key}</span>
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="mt-5 pt-3.5 border-t border-slate-800/80 flex items-center justify-between gap-1.5">
                  {/* Open in DAW */}
                  <button
                    onClick={() => onSelectProjectForDaw(project)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-purple-600/20 py-2 text-xs font-bold text-purple-300 transition hover:bg-purple-600 hover:text-white"
                  >
                    <Sliders className="h-3.5 w-3.5" />
                    <span>Abrir DAW</span>
                  </button>

                  {/* Direct Export WAV */}
                  <button
                    onClick={() => audioEngine.downloadWav(project)}
                    className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-300 transition hover:bg-slate-700 hover:text-white"
                    title="Baixar áudio WAV (44.1kHz)"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>

                  {/* Direct Export MIDI */}
                  <button
                    onClick={() => downloadMidi(project)}
                    className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-300 transition hover:bg-slate-700 hover:text-pink-400"
                    title="Baixar partitura MIDI (.mid)"
                  >
                    <Music className="h-3.5 w-3.5" />
                  </button>

                  {/* Duplicate */}
                  <button
                    onClick={() => onDuplicateProject(project)}
                    className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-300 transition hover:bg-slate-700 hover:text-white"
                    title="Duplicar projeto"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => onDeleteProject(project.id)}
                    className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-400 transition hover:bg-red-500/20 hover:text-red-400"
                    title="Excluir projeto"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
