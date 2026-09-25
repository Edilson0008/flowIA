import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { MusicCreator } from './components/MusicCreator';
import { DawEditor } from './components/DawEditor';
import { ProjectHistory } from './components/ProjectHistory';
import { CloudSyncModal } from './components/CloudSyncModal';
import { BackupManagerModal } from './components/BackupManagerModal';
import { SocialShareModal } from './components/SocialShareModal';
import { SongProject } from './types';
import { storageService } from './services/storage';
import { cloudSyncService } from './services/cloudSync';
import { WifiOff, CheckCircle2, Sliders, Sparkles, FolderHeart } from 'lucide-react';

export default function App() {
  const [currentTab, setCurrentTab] = useState<'creator' | 'daw' | 'history'>('creator');
  const [projects, setProjects] = useState<SongProject[]>([]);
  const [activeProject, setActiveProject] = useState<SongProject | null>(null);
  const [shareModalProject, setShareModalProject] = useState<SongProject | null>(null);

  // Modals
  const [isCloudSyncOpen, setIsCloudSyncOpen] = useState(false);
  const [isBackupManagerOpen, setIsBackupManagerOpen] = useState(false);

  // Toast notifications
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  // Load initial projects from IndexedDB
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
  }, []);

  const showToast = (message: string, type: 'success' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Called when AI generates a new song
  const handleSongGenerated = async (newSong: SongProject) => {
    await storageService.saveProject(newSong);
    await refreshProjects();
    setActiveProject(newSong);
    setCurrentTab('daw');
    showToast(`Música "${newSong.title}" gerada com sucesso! Aberta no DAW.`);

    // Automatically trigger cloud sync in background if online
    if (navigator.onLine) {
      cloudSyncService.syncToCloud().catch(console.error);
    }
  };

  // Called when tracks, instruments, notes or parameters are edited in DAW
  const handleUpdateProject = async (updated: SongProject) => {
    setActiveProject(updated);
    await storageService.saveProject(updated);
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  // Toggle favorite
  const handleToggleFavorite = async (id: string) => {
    const proj = projects.find((p) => p.id === id);
    if (!proj) return;
    const updated = { ...proj, isFavorite: !proj.isFavorite };
    await storageService.saveProject(updated);
    setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
    if (activeProject?.id === id) setActiveProject(updated);
    showToast(updated.isFavorite ? 'Adicionado aos favoritos' : 'Removido dos favoritos', 'info');
  };

  // Duplicate project
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
    showToast(`Projeto duplicado como "${clone.title}"`);
  };

  // Delete project
  const handleDeleteProject = async (id: string) => {
    const confirm = window.confirm('Tem certeza que deseja excluir esta música?');
    if (!confirm) return;
    await storageService.deleteProject(id);
    const updatedList = projects.filter((p) => p.id !== id);
    setProjects(updatedList);
    if (activeProject?.id === id) {
      setActiveProject(updatedList[0] || null);
    }
    showToast('Música excluída com sucesso', 'info');
  };

  // Open in DAW
  const handleSelectProjectForDaw = (project: SongProject) => {
    setActiveProject(project);
    setCurrentTab('daw');
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#0b0c13] text-slate-100 font-sans">
      {/* Top Application Header */}
      <Header
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        onOpenCloudSync={() => setIsCloudSyncOpen(true)}
        onOpenBackupManager={() => setIsBackupManagerOpen(true)}
        projectCount={projects.length}
      />

      {/* Main Content Area */}
      <main className="flex-1 pb-16">
        {currentTab === 'creator' && (
          <MusicCreator onSongGenerated={handleSongGenerated} />
        )}

        {currentTab === 'daw' && (
          activeProject ? (
            <DawEditor
              project={activeProject}
              onUpdateProject={handleUpdateProject}
              onOpenShareModal={(p) => setShareModalProject(p)}
            />
          ) : (
            <div className="mx-auto max-w-xl p-12 text-center text-slate-400">
              <Sliders className="mx-auto h-12 w-12 text-purple-500/40" />
              <h2 className="mt-4 text-lg font-bold text-white">Nenhum projeto selecionado</h2>
              <p className="mt-1 text-xs text-slate-400">
                Gere uma nova música no criador ou selecione uma faixa existente no seu histórico.
              </p>
              <button
                onClick={() => setCurrentTab('creator')}
                className="mt-5 rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white hover:bg-purple-500"
              >
                Ir para o Criador IA
              </button>
            </div>
          )
        )}

        {currentTab === 'history' && (
          <ProjectHistory
            projects={projects}
            onSelectProjectForDaw={handleSelectProjectForDaw}
            onOpenShareModal={(p) => setShareModalProject(p)}
            onToggleFavorite={handleToggleFavorite}
            onDuplicateProject={handleDuplicateProject}
            onDeleteProject={handleDeleteProject}
            onNewMusicClick={() => setCurrentTab('creator')}
          />
        )}
      </main>

      {/* Offline Toast Banner */}
      {!isOnline && (
        <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600/95 px-3.5 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur-sm animate-pulse">
          <WifiOff className="h-4 w-4" />
          <span>Modo Offline — Suas músicas estão salvas localmente no aparelho.</span>
        </div>
      )}

      {/* Global Success / Info Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2.5 rounded-2xl border border-slate-700/80 bg-[#161726]/95 px-4 py-2.5 text-xs font-bold text-white shadow-2xl backdrop-blur-md">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{toast.message}</span>
        </div>
      )}

      {/* Cloud Sync Modal */}
      {isCloudSyncOpen && (
        <CloudSyncModal
          onClose={() => setIsCloudSyncOpen(false)}
          onRefreshProjects={refreshProjects}
        />
      )}

      {/* Backup Manager Modal */}
      {isBackupManagerOpen && (
        <BackupManagerModal
          onClose={() => setIsBackupManagerOpen(false)}
          onProjectsRestored={refreshProjects}
        />
      )}

      {/* Social Share Modal */}
      {shareModalProject && (
        <SocialShareModal
          song={shareModalProject}
          onClose={() => setShareModalProject(null)}
        />
      )}
    </div>
  );
}
