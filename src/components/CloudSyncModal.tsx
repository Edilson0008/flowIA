import React, { useState, useEffect } from 'react';
import {
  X,
  Cloud,
  CloudUpload,
  CloudDownload,
  Copy,
  Check,
  Smartphone,
  Laptop,
  ArrowRight,
  Download,
  Upload,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { storageService, StorageSettings } from '../services/storage';
import { cloudSyncService, SyncStatus } from '../services/cloudSync';

interface CloudSyncModalProps {
  onClose: () => void;
  onRefreshProjects: () => void;
}

export const CloudSyncModal: React.FC<CloudSyncModalProps> = ({
  onClose,
  onRefreshProjects,
}) => {
  const [settings, setSettings] = useState<StorageSettings>(storageService.getSettings());
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(cloudSyncService.getStatus());
  const [targetCode, setTargetCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    cloudSyncService.onStatusChange((status) => {
      setSyncStatus(status);
    });
  }, []);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(settings.syncCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleSyncNow = async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const ok = await cloudSyncService.syncToCloud();
      if (ok) {
        setMessage({ text: 'Todos os seus projetos foram salvos na nuvem com sucesso!', type: 'success' });
        setSettings(storageService.getSettings());
      } else {
        setMessage({ text: 'Não foi possível sincronizar. Verifique sua conexão.', type: 'error' });
      }
    } catch (e: unknown) {
      setMessage({
        text: e instanceof Error ? e.message : 'Erro na sincronização',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnectOtherDevice = async () => {
    if (!targetCode.trim()) return;
    setIsLoading(true);
    setMessage(null);
    try {
      const res = await cloudSyncService.pullFromCloud(targetCode.trim());
      setMessage({
        text: `Sucesso! ${res.projectsCount} projetos foram sincronizados a partir do outro dispositivo!`,
        type: 'success',
      });
      setSettings(storageService.getSettings());
      onRefreshProjects();
    } catch (e: unknown) {
      setMessage({
        text: e instanceof Error ? e.message : 'Falha ao conectar com o código especificado.',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportBackup = async () => {
    await cloudSyncService.exportBackupFile();
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    setMessage(null);
    try {
      const count = await cloudSyncService.importBackupFile(file);
      setMessage({
        text: `Arquivo restaurado com sucesso! ${count} projetos foram importados.`,
        type: 'success',
      });
      onRefreshProjects();
    } catch (err: unknown) {
      setMessage({
        text: err instanceof Error ? err.message : 'Erro ao importar backup.',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-lg rounded-3xl border border-slate-800 bg-[#121320] p-6 shadow-2xl text-slate-100">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 rounded-xl bg-slate-800 p-2 text-slate-400 hover:bg-slate-700 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-blue-500/20 p-2.5 text-blue-400">
            <Cloud className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Sincronização em Nuvem</h2>
            <p className="text-xs text-slate-400">
              Conecte seus celulares, tablets e computadores para sincronizar todas as músicas
            </p>
          </div>
        </div>

        {/* Alert Feedback */}
        {message && (
          <div
            className={`mt-4 rounded-2xl border p-3 text-xs leading-relaxed ${
              message.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/40 bg-red-500/10 text-red-300'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* This Device's Sync Code Card */}
        <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <Smartphone className="h-4 w-4 text-purple-400" />
              Código de Sincronização deste Dispositivo:
            </span>
            <span className="rounded bg-purple-500/20 px-2 py-0.5 text-[10px] font-mono text-purple-300">
              Ativo
            </span>
          </div>

          <div className="mt-2.5 flex items-center justify-between rounded-xl border border-slate-700 bg-slate-950 p-2.5">
            <span className="font-mono text-base font-black tracking-wider text-purple-300">
              {settings.syncCode}
            </span>
            <button
              onClick={handleCopyCode}
              className="flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300 transition hover:bg-slate-700 hover:text-white"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? 'Copiado!' : 'Copiar'}</span>
            </button>
          </div>

          <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
            <span>
              Última sincronização:{' '}
              {settings.lastSyncedAt
                ? new Date(settings.lastSyncedAt).toLocaleTimeString('pt-BR')
                : 'Ainda não enviado'}
            </span>
            <button
              onClick={handleSyncNow}
              disabled={isLoading}
              className="flex items-center gap-1 font-bold text-purple-400 hover:text-purple-300 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Enviar para Nuvem</span>
            </button>
          </div>
        </div>

        {/* Connect Another Device Section */}
        <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
            <Laptop className="h-4 w-4 text-blue-400" />
            Puxar Músicas de Outro Dispositivo
          </h3>
          <p className="text-[11px] text-slate-400">
            Digite o Código de Sincronização do seu outro aparelho para carregar todas as faixas:
          </p>

          <div className="flex gap-2">
            <input
              type="text"
              value={targetCode}
              onChange={(e) => setTargetCode(e.target.value.toUpperCase())}
              placeholder="Ex: HMX-1234-ABC"
              className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
            />
            <button
              onClick={handleConnectOtherDevice}
              disabled={isLoading || !targetCode.trim()}
              className="flex items-center gap-1.5 rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-purple-500 disabled:opacity-50"
            >
              <span>Conectar</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* File Backup & Restore Actions */}
        <div className="mt-5 pt-4 border-t border-slate-800 flex items-center justify-between gap-3">
          <button
            onClick={handleExportBackup}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
          >
            <Download className="h-3.5 w-3.5 text-blue-400" />
            <span>Baixar Arquivo .JSON</span>
          </button>

          <label className="flex items-center gap-1.5 cursor-pointer rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white">
            <Upload className="h-3.5 w-3.5 text-emerald-400" />
            <span>Importar Arquivo</span>
            <input
              type="file"
              accept=".json"
              onChange={handleImportBackup}
              className="hidden"
            />
          </label>
        </div>
      </div>
    </div>
  );
};
