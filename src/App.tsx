import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { MusicCreator } from './components/MusicCreator';
import { DawEditor } from './components/DawEditor';
import { ProjectHistory } from './components/ProjectHistory';
import { SongProject } from './types';
import { storageService } from './services/storage';
import { WifiOff, CheckCircle2, Sliders } from 'lucide-react';

export default function App() {
  const [currentTab, setCurrentTab] = useState<'criar' | 'estudio' | 'biblioteca'>('criar');
  const [projects, setProjects] = useState<SongProject[]>([]);
  const [activeProject, setActiveProject] = useState<SongProject | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  const refreshProjects = async () => {
    try {
      const list = await storageService.getAllProjects();
      setProjects(list);
      if (!activeProject && list.length > 0) {
        setActiveProject(list[0]);
      } else if (activeProject) {
        const found = list.find((p) => p.id === activeProject.id);
        if (found) setActiveProject(found);
      }
    } catch (e) {
      console.error('Error loading projects:', e);
    }
  };

  useEffect(() => {
    refreshProjects();
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  };

  // Called when Flow generates new songs (2 variations)
  const handleSongsGenerated = async (newSongs: SongProject[]) => {
    for (const s of newSongs) await storageService.saveProject(s);
    await refreshProjects();
    showToast(`${newSongs.length} músicas criadas e salvas na Biblioteca!`);
  };

  const handleOpenInStudio = (project: SongProject) => {
    setActiveProject(project);
    setCurrentTab('estudio');
  };

  const handleUpdateProject = async (updated: SongProject) => {
    setActiveProject(updated);
    await storageService.saveProject(updated);
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const handleToggleFavorite = async (id: string) => {
    const proj = projects.find((p) => p.id === id);
    if (!proj) return;
    const updated = { ...proj, isFavorite: !proj.isFavorite };
    await storageService.saveProject(updated);
    setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
    if (activeProject?.id === id) setActiveProject(updated);
    showToast(updated.isFavorite ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
  };

  const handleDuplicateProject = async (source: SongProject) => {
    const clone: SongProject = {
      ...source,
      id: `song_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: `${source.title} (Cópia)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await storageService.saveProject(clone);
    await refreshProjects();
    showToast(`Duplicada como "${clone.title}"`);
  };

  const handleDeleteProject = async (id: string) => {
    if (!window.confirm('Excluir esta música?')) return;
    await storageService.deleteProject(id);
    const updatedList = projects.filter((p) => p.id !== id);
    setProjects(updatedList);
    if (activeProject?.id === id) setActiveProject(updatedList[0] || null);
    showToast('Música excluída');
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#0b0c13] text-slate-100 font-sans">
      <Header currentTab={currentTab} setCurrentTab={setCurrentTab} projectCount={projects.length} />

      <main className="flex-1 pb-16">
        {currentTab === 'criar' && (
          <MusicCreator onSongsGenerated={handleSongsGenerated} onOpenInStudio={handleOpenInStudio} />
        )}

        {currentTab === 'estudio' && (
          activeProject ? (
            <DawEditor project={activeProject} onUpdateProject={handleUpdateProject} />
          ) : (
            <div className="mx-auto max-w-xl p-12 text-center text-slate-400">
              <Sliders className="mx-auto h-12 w-12 text-purple-500/40" />
              <h2 className="mt-4 text-lg font-bold text-white">Nenhum projeto selecionado</h2>
              <p className="mt-1 text-xs text-slate-400">Crie uma música ou escolha uma na Biblioteca.</p>
              <button
                onClick={() => setCurrentTab('criar')}
                className="mt-5 rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white hover:bg-purple-500"
              >
                Criar música
              </button>
            </div>
          )
        )}

        {currentTab === 'biblioteca' && (
          <ProjectHistory
            projects={projects}
            onSelectProjectForDaw={handleOpenInStudio}
            onToggleFavorite={handleToggleFavorite}
            onDuplicateProject={handleDuplicateProject}
            onDeleteProject={handleDeleteProject}
            onNewMusicClick={() => setCurrentTab('criar')}
          />
        )}
      </main>

      {!isOnline && (
        <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600/95 px-3.5 py-2 text-xs font-semibold text-white shadow-xl animate-pulse">
          <WifiOff className="h-4 w-4" />
          <span>Offline — músicas salvas neste aparelho.</span>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2.5 rounded-2xl border border-slate-700/80 bg-[#161726]/95 px-4 py-2.5 text-xs font-bold text-white shadow-2xl">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
