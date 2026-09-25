/**
 * Cloud Synchronization Service
 * Handles multi-device cloud pairing, project syncing, and cloud snapshot backups.
 */

import { SongProject, BackupSnapshot, CloudSyncPayload } from '../types';
import { storageService } from './storage';

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
  lastSyncedAt?: number;
  message?: string;
}

class CloudSyncService {
  private syncListeners: ((status: SyncStatus) => void)[] = [];
  private currentStatus: SyncStatus = { state: 'idle' };

  public onStatusChange(cb: (status: SyncStatus) => void) {
    this.syncListeners.push(cb);
  }

  private setStatus(status: SyncStatus) {
    this.currentStatus = status;
    this.syncListeners.forEach((fn) => fn(status));
  }

  public getStatus(): SyncStatus {
    return this.currentStatus;
  }

  /**
   * Pushes current local projects and backups to cloud storage for this device's syncCode
   */
  public async syncToCloud(): Promise<boolean> {
    if (!navigator.onLine) {
      this.setStatus({ state: 'offline', message: 'Sem conexão com a internet' });
      return false;
    }

    const settings = storageService.getSettings();
    if (!settings.syncCode) return false;

    this.setStatus({ state: 'syncing', message: 'Sincronizando com a nuvem...' });

    try {
      const projects = await storageService.getAllProjects();
      const snapshots = await storageService.getAllBackups();

      const payload: CloudSyncPayload = {
        syncCode: settings.syncCode,
        updatedAt: Date.now(),
        projects,
        snapshots: snapshots.slice(0, 10), // latest 10 snapshots in cloud
      };

      const res = await fetch('/api/cloud-sync/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Erro na sincronização: ${res.statusText}`);
      }

      const now = Date.now();
      storageService.saveSettings({ lastSyncedAt: now });
      this.setStatus({ state: 'synced', lastSyncedAt: now, message: 'Nuvem atualizada com sucesso' });
      return true;
    } catch (err: unknown) {
      console.error('Cloud sync error:', err);
      this.setStatus({
        state: 'error',
        message: err instanceof Error ? err.message : 'Falha ao sincronizar com a nuvem',
      });
      return false;
    }
  }

  /**
   * Pulls projects and backups from another device by syncCode
   */
  public async pullFromCloud(targetSyncCode: string): Promise<{ projectsCount: number; snapshotsCount: number }> {
    if (!navigator.onLine) {
      throw new Error('Você está sem conexão com a internet.');
    }

    this.setStatus({ state: 'syncing', message: 'Baixando projetos da nuvem...' });

    try {
      const res = await fetch(`/api/cloud-sync/load/${encodeURIComponent(targetSyncCode.trim())}`);
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Código de sincronização não encontrado na nuvem.');
        }
        throw new Error(`Erro no servidor: ${res.statusText}`);
      }

      const data: CloudSyncPayload = await res.json();
      if (!data || !Array.isArray(data.projects)) {
        throw new Error('Dados de nuvem inválidos.');
      }

      // Save to local IndexedDB
      for (const proj of data.projects) {
        await storageService.saveProject(proj);
      }

      // Update syncCode to match
      storageService.saveSettings({
        syncCode: targetSyncCode.trim(),
        lastSyncedAt: Date.now(),
      });

      this.setStatus({
        state: 'synced',
        lastSyncedAt: Date.now(),
        message: `${data.projects.length} projetos sincronizados!`,
      });

      return {
        projectsCount: data.projects.length,
        snapshotsCount: data.snapshots?.length || 0,
      };
    } catch (err: unknown) {
      this.setStatus({
        state: 'error',
        message: err instanceof Error ? err.message : 'Erro ao puxar dados da nuvem',
      });
      throw err;
    }
  }

  /**
   * Downloads complete offline backup as a JSON file
   */
  public async exportBackupFile(): Promise<void> {
    const projects = await storageService.getAllProjects();
    const backups = await storageService.getAllBackups();
    const settings = storageService.getSettings();

    const exportData = {
      app: 'Harmonix AI Studio',
      exportedAt: new Date().toISOString(),
      syncCode: settings.syncCode,
      projects,
      backups,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `harmonix_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Imports a backup JSON file from the user's computer
   */
  public async importBackupFile(file: File): Promise<number> {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.projects || !Array.isArray(data.projects)) {
      throw new Error('Arquivo de backup inválido.');
    }

    let count = 0;
    for (const proj of data.projects) {
      await storageService.saveProject(proj);
      count++;
    }

    await storageService.createBackupSnapshot(`Restauração de Arquivo: ${file.name}`);
    return count;
  }
}

export const cloudSyncService = new CloudSyncService();
