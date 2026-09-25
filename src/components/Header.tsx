import React, { useState, useEffect } from 'react';
import {
  Music,
  Sliders,
  FolderHeart,
  Cloud,
  CloudOff,
  CloudUpload,
  ShieldCheck,
  Download,
  Wifi,
  WifiOff,
  Sparkles,
  Info,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { cloudSyncService, SyncStatus } from '../services/cloudSync';
import { storageService } from '../services/storage';

interface HeaderProps {
  currentTab: 'creator' | 'daw' | 'history';
  setCurrentTab: (tab: 'creator' | 'daw' | 'history') => void;
  onOpenCloudSync: () => void;
  onOpenBackupManager: () => void;
  projectCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  setCurrentTab,
  onOpenCloudSync,
  onOpenBackupManager,
  projectCount,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(cloudSyncService.getStatus());
  const [syncCode, setSyncCode] = useState(storageService.getSettings().syncCode);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    cloudSyncService.onStatusChange((status) => {
      setSyncStatus(status);
      setSyncCode(storageService.getSettings().syncCode);
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-purple-900/30 bg-[#0d0e17]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-pink-500 shadow-lg shadow-purple-500/20">
              <Music className="h-5 w-5 text-white" />
              <Sparkles className="absolute -top-1 -right-1 h-3.5 w-3.5 text-yellow-300 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-black tracking-tight text-white">
                  Flow <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">AI</span>
                </span>
                <span className="rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold text-purple-300 border border-purple-500/20">
                  Lyria & Gemini
                </span>
              </div>
              <p className="hidden text-xs text-slate-400 sm:block">
                Estúdio de Música Inteligente & DAW Multi-faixas
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 rounded-xl bg-slate-900/80 p-1 border border-slate-800">
            <button
              onClick={() => setCurrentTab('creator')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                currentTab === 'creator'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Criar</span>
            </button>

            <button
              onClick={() => setCurrentTab('daw')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                currentTab === 'daw'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="h-3.5 w-3.5" />
              <span>DAW & Mixer</span>
            </button>

            <button
              onClick={() => setCurrentTab('history')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                currentTab === 'history'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FolderHeart className="h-3.5 w-3.5" />
              <span>Projetos ({projectCount})</span>
            </button>
          </nav>

          {/* System Actions & Statuses */}
          <div className="flex items-center gap-2">
            {/* Online / Offline status badge */}
            <div
              title={isOnline ? 'Online - Pronto para gerar com IA' : 'Offline - Usando dados locais em cache'}
              className={`hidden sm:flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium border ${
                isOnline
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-300 border-amber-500/30 animate-pulse'
              }`}
            >
              {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              <span className="hidden md:inline">{isOnline ? 'Online' : 'Offline'}</span>
            </div>

            {/* Cloud Sync Status */}
            <button
              onClick={onOpenCloudSync}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                syncStatus.state === 'syncing'
                  ? 'bg-blue-500/10 text-blue-300 border-blue-500/30 animate-pulse'
                  : syncStatus.state === 'error'
                  ? 'bg-red-500/10 text-red-300 border-red-500/30'
                  : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
              title={`Sincronização em Nuvem: ${syncCode || 'Configurar'}`}
            >
              {syncStatus.state === 'syncing' ? (
                <CloudUpload className="h-3.5 w-3.5 animate-bounce" />
              ) : isOnline ? (
                <Cloud className="h-3.5 w-3.5 text-blue-400" />
              ) : (
                <CloudOff className="h-3.5 w-3.5 text-slate-400" />
              )}
              <span className="hidden lg:inline">Nuvem</span>
            </button>

            {/* Auto Backup Manager */}
            <button
              onClick={onOpenBackupManager}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
              title="Gerenciador de Backup Automático"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span className="hidden lg:inline">Backup</span>
            </button>

            {/* PWA Install Button */}
            {!isInstalled && isInstallable && (
              <button
                onClick={install}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-purple-600/30 transition hover:from-purple-500 hover:to-pink-500"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Instalar App</span>
              </button>
            )}

            {!isInstalled && isIOS && (
              <button
                onClick={() => setShowIOSGuide(true)}
                className="flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 px-2.5 py-1.5 text-xs font-medium text-purple-300 hover:bg-purple-500/20"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Instalar (iOS)</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* iOS Install Guide Modal */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-[#12131d] p-6 shadow-2xl text-slate-200">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-purple-500/20 p-2 text-purple-400">
                <Info className="h-6 w-6" />
              </div>
              <h3 className="text-base font-bold text-white">Instalar no iPhone / iPad</h3>
            </div>
            <p className="mt-3 text-sm text-slate-300 leading-relaxed">
              1. Toque no botão <strong>Compartilhar</strong> (ícone de quadrado com seta) na barra do Safari.<br />
              2. Role para baixo e selecione <strong>Adicionar à Tela de Início</strong>.<br />
              3. O Harmonix AI ficará disponível como aplicativo nativo e funcionará offline!
            </p>
            <button
              onClick={() => setShowIOSGuide(false)}
              className="mt-5 w-full rounded-xl bg-purple-600 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-500"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
};
