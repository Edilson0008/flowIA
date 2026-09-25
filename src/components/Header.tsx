import React, { useState } from 'react';
import { Music, Sparkles, Sliders, FolderHeart, Download, Info } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface HeaderProps {
  currentTab: 'criar' | 'estudio' | 'biblioteca';
  setCurrentTab: (tab: 'criar' | 'estudio' | 'biblioteca') => void;
  projectCount: number;
}

export const Header: React.FC<HeaderProps> = ({ currentTab, setCurrentTab, projectCount }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  const tabs: { id: 'criar' | 'estudio' | 'biblioteca'; label: string; icon: React.ReactNode }[] = [
    { id: 'criar', label: 'Criar', icon: <Sparkles className="h-3.5 w-3.5" /> },
    { id: 'biblioteca', label: `Biblioteca (${projectCount})`, icon: <FolderHeart className="h-3.5 w-3.5" /> },
    { id: 'estudio', label: 'Estúdio', icon: <Sliders className="h-3.5 w-3.5" /> },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-purple-900/30 bg-[#0d0e17]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-pink-500 shadow-lg shadow-purple-500/20">
              <Music className="h-5 w-5 text-white" />
              <Sparkles className="absolute -top-1 -right-1 h-3.5 w-3.5 text-yellow-300 animate-pulse" />
            </div>
            <div>
              <span className="text-xl font-black tracking-tight text-white">
                Flow <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">AI</span>
              </span>
              <p className="hidden text-xs text-slate-400 sm:block">Crie músicas com IA</p>
            </div>
          </div>

          <nav className="flex items-center gap-1 rounded-xl bg-slate-900/80 p-1 border border-slate-800">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setCurrentTab(t.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  currentTab === t.id ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.icon}
                <span className="hidden sm:inline">{t.label}</span>
                <span className="sm:hidden">{t.id === 'criar' ? 'Criar' : t.id === 'estudio' ? 'Mix' : projectCount}</span>
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {!isInstalled && isInstallable && (
              <button
                onClick={install}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md transition hover:from-purple-500 hover:to-pink-500"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Instalar App</span>
              </button>
            )}
            {!isInstalled && isIOS && (
              <button
                onClick={() => setShowIOSGuide(true)}
                className="flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 px-2.5 py-1.5 text-xs font-medium text-purple-300 hover:bg-purple-500/20"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </header>

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
              1. Toque em <strong>Compartilhar</strong> no Safari.<br />
              2. Escolha <strong>Adicionar à Tela de Início</strong>.
            </p>
            <button
              onClick={() => setShowIOSGuide(false)}
              className="mt-5 w-full rounded-xl bg-purple-600 py-2.5 text-sm font-semibold text-white hover:bg-purple-500"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
};
