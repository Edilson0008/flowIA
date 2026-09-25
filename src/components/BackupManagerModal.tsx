import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  Clock,
  RotateCcw,
  Trash2,
  Plus,
  Check,
  AlertTriangle,
  HardDrive,
} from 'lucide-react';
import { storageService, StorageSettings } from '../services/storage';
import { BackupSnapshot } from '../types';

interface BackupManagerModalProps {
  onClose: () => void;
  onProjectsRestored: () => void;
}

export const BackupManagerModal: React.FC<BackupManagerModalProps> = ({
  onClose,
  onProjectsRestored,
}) => {
  const [settings, setSettings] = useState<StorageSettings>(storageService.getSettings());
  const [backups, setBackups] = useState<BackupSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const loadBackups = async () => {
    const list = await storageService.getAllBackups();
    setBackups(list);
  };

  useEffect(() => {
    loadBackups();
  }, []);

  const handleToggleAutoBackup = (enabled: boolean) => {
    storageService.saveSettings({ autoBackup: enabled });
    setSettings(storageService.getSettings());
  };

  const handleIntervalChange = (minutes: number) => {
    storageService.saveSettings({ backupIntervalMinutes: minutes });
    setSettings(storageService.getSettings());
  };

  const handleCreateSnapshot = async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      await storageService.createBackupSnapshot('Backup Manual do Usuário');
      await loadBackups();
      setMessage({ text: 'Ponto de restauração criado com sucesso!', type: 'success' });
    } catch {
      setMessage({ text: 'Erro ao criar backup manual.', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestore = async (snapshotId: string) => {
    const confirm = window.confirm('Deseja restaurar as faixas deste backup? Elas serão mescladas aos seus projetos atuais.');
    if (!confirm) return;

    setIsLoading(true);
    setMessage(null);
    try {
      await storageService.restoreBackup(snapshotId);
      setMessage({ text: 'Backup restaurado com sucesso!', type: 'success' });
      onProjectsRestored();
    } catch {
      setMessage({ text: 'Falha ao restaurar backup.', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (snapshotId: string) => {
    await storageService.deleteBackup(snapshotId);
    await loadBackups();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-xl max-h-[90vh] flex flex-col rounded-3xl border border-slate-800 bg-[#121320] p-6 shadow-2xl text-slate-100">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 rounded-xl bg-slate-800 p-2 text-slate-400 hover:bg-slate-700 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-emerald-500/20 p-2.5 text-emerald-400">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Sistema de Backup Automático</h2>
            <p className="text-xs text-slate-400">
              Salvamento contínuo em segundo plano e pontos de restauração do seu estúdio
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

        {/* Auto Backup Configuration Card */}
        <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-white">Backup Automático Ativo</span>
              <p className="text-[11px] text-slate-400">Cria cópias de segurança periódicas sem interromper seu trabalho</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoBackup}
                onChange={(e) => handleToggleAutoBackup(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          {/* Interval selector */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs">
            <span className="text-slate-300">Frequência do Backup:</span>
            <div className="flex items-center gap-1.5">
              {[1, 5, 15, 30].map((min) => (
                <button
                  key={min}
                  onClick={() => handleIntervalChange(min)}
                  className={`rounded-lg px-2.5 py-1 font-mono transition ${
                    settings.backupIntervalMinutes === min
                      ? 'bg-purple-600 text-white font-bold'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {min} min
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Snapshot Creation Button */}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Pontos de Restauração ({backups.length}):
          </span>

          <button
            onClick={handleCreateSnapshot}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-xl bg-purple-600/20 px-3 py-1.5 text-xs font-bold text-purple-300 transition hover:bg-purple-600 hover:text-white disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Criar Ponto Agora</span>
          </button>
        </div>

        {/* Rolling Backups List */}
        <div className="mt-3 flex-1 overflow-y-auto space-y-2 pr-1">
          {backups.length === 0 ? (
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-8 text-center text-slate-500 text-xs">
              Nenhum backup gerado ainda. O sistema salvará automaticamente conforme você edita suas músicas.
            </div>
          ) : (
            backups.map((snap) => (
              <div
                key={snap.id}
                className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/60 p-3 text-xs transition hover:border-slate-700"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-400">
                    <Clock className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-bold text-white">{snap.label}</p>
                    <p className="text-[11px] text-slate-400">
                      {new Date(snap.timestamp).toLocaleString('pt-BR')} • {snap.projectCount} músicas salvas
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleRestore(snap.id)}
                    className="flex items-center gap-1 rounded-xl bg-emerald-600/20 px-2.5 py-1.5 font-bold text-emerald-300 transition hover:bg-emerald-600 hover:text-white"
                    title="Restaurar projetos deste ponto"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Restaurar</span>
                  </button>

                  <button
                    onClick={() => handleDelete(snap.id)}
                    className="rounded-xl p-1.5 text-slate-400 hover:bg-red-500/20 hover:text-red-400 transition"
                    title="Excluir este ponto de backup"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
