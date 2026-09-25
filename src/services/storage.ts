/**
 * Offline IndexedDB Storage & Automatic Backup Service for Harmonix AI
 * Provides full offline persistence for projects, audio buffers, and rolling backup snapshots.
 */

import { SongProject, BackupSnapshot } from '../types';

const DB_NAME = 'HarmonixAI_DB';
const DB_VERSION = 1;
const PROJECTS_STORE = 'projects';
const BACKUPS_STORE = 'backups';
const SETTINGS_KEY = 'harmonix_settings';

export interface StorageSettings {
  syncCode: string;
  autoBackup: boolean;
  backupIntervalMinutes: number;
  lastBackupAt: number;
  lastSyncedAt?: number;
  userName?: string;
}

const DEFAULT_SETTINGS: StorageSettings = {
  syncCode: '',
  autoBackup: true,
  backupIntervalMinutes: 5,
  lastBackupAt: Date.now(),
};

function generateSyncCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const nums = '23456789';
  let code = 'HMX-';
  for (let i = 0; i < 4; i++) code += nums[Math.floor(Math.random() * nums.length)];
  code += '-';
  for (let i = 0; i < 3; i++) code += letters[Math.floor(Math.random() * letters.length)];
  return code;
}

class StorageService {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private backupTimer: number | null = null;

  constructor() {
    this.initDB();
    this.initAutoBackupScheduler();
  }

  private initDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB not supported'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
          const projectStore = db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
          projectStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          projectStore.createIndex('isFavorite', 'isFavorite', { unique: false });
        }
        if (!db.objectStoreNames.contains(BACKUPS_STORE)) {
          const backupStore = db.createObjectStore(BACKUPS_STORE, { keyPath: 'id' });
          backupStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        console.error('IndexedDB open error:', request.error);
        reject(request.error);
      };
    });

    return this.dbPromise;
  }

  // --- SETTINGS ---
  public getSettings(): StorageSettings {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (!parsed.syncCode) parsed.syncCode = generateSyncCode();
        return parsed;
      }
    } catch {
      // Ignore
    }
    const fresh: StorageSettings = {
      ...DEFAULT_SETTINGS,
      syncCode: generateSyncCode(),
    };
    this.saveSettings(fresh);
    return fresh;
  }

  public saveSettings(settings: Partial<StorageSettings>) {
    try {
      const current = this.getSettings();
      const updated = { ...current, ...settings };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }

  // --- PROJECTS CRUD ---
  public async getAllProjects(): Promise<SongProject[]> {
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(PROJECTS_STORE, 'readonly');
        const store = tx.objectStore(PROJECTS_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const results = req.result as SongProject[];
          // Sort by updatedAt descending
          results.sort((a, b) => b.updatedAt - a.updatedAt);
          if (results.length === 0) {
            // Seed initial demo tracks
            const demos = this.getInitialDemoProjects();
            demos.forEach((d) => this.saveProject(d));
            resolve(demos);
          } else {
            resolve(results);
          }
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      // LocalStorage fallback
      return this.getInitialDemoProjects();
    }
  }

  public async getProjectById(id: string): Promise<SongProject | null> {
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(PROJECTS_STORE, 'readonly');
        const store = tx.objectStore(PROJECTS_STORE);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  public async saveProject(project: SongProject): Promise<void> {
    try {
      const db = await this.initDB();
      project.updatedAt = Date.now();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(PROJECTS_STORE, 'readwrite');
        const store = tx.objectStore(PROJECTS_STORE);
        const req = store.put(project);
        req.onsuccess = () => {
          this.triggerAutoBackupIfDue();
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error('Failed to save project to IndexedDB:', err);
    }
  }

  public async deleteProject(id: string): Promise<void> {
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(PROJECTS_STORE, 'readwrite');
        const store = tx.objectStore(PROJECTS_STORE);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  }

  // --- AUTOMATIC BACKUP SYSTEM ---
  public async createBackupSnapshot(label?: string): Promise<BackupSnapshot> {
    const projects = await this.getAllProjects();
    const snapshot: BackupSnapshot = {
      id: `backup_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      label: label || `Backup Automático (${projects.length} faixas)`,
      projectCount: projects.length,
      projects,
    };

    try {
      const db = await this.initDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(BACKUPS_STORE, 'readwrite');
        const store = tx.objectStore(BACKUPS_STORE);
        const req = store.put(snapshot);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      // Keep only latest 25 backups to save space
      const allBackups = await this.getAllBackups();
      if (allBackups.length > 25) {
        allBackups.sort((a, b) => a.timestamp - b.timestamp);
        const toDelete = allBackups.slice(0, allBackups.length - 25);
        for (const b of toDelete) {
          await this.deleteBackup(b.id);
        }
      }

      this.saveSettings({ lastBackupAt: Date.now() });
    } catch (e) {
      console.error('Error saving backup snapshot:', e);
    }

    return snapshot;
  }

  public async getAllBackups(): Promise<BackupSnapshot[]> {
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(BACKUPS_STORE, 'readonly');
        const store = tx.objectStore(BACKUPS_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const list = req.result as BackupSnapshot[];
          list.sort((a, b) => b.timestamp - a.timestamp);
          resolve(list);
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  public async restoreBackup(snapshotId: string): Promise<SongProject[]> {
    const db = await this.initDB();
    const snapshot: BackupSnapshot = await new Promise((resolve, reject) => {
      const tx = db.transaction(BACKUPS_STORE, 'readonly');
      const store = tx.objectStore(BACKUPS_STORE);
      const req = store.get(snapshotId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (!snapshot || !snapshot.projects) {
      throw new Error('Snapshot não encontrado ou inválido');
    }

    // Replace or merge projects
    for (const proj of snapshot.projects) {
      await this.saveProject(proj);
    }

    return snapshot.projects;
  }

  public async deleteBackup(id: string): Promise<void> {
    try {
      const db = await this.initDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(BACKUPS_STORE, 'readwrite');
        const store = tx.objectStore(BACKUPS_STORE);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.error('Error deleting backup:', e);
    }
  }

  private initAutoBackupScheduler() {
    if (typeof window === 'undefined') return;
    if (this.backupTimer) clearInterval(this.backupTimer);

    // Check backup condition every minute
    this.backupTimer = window.setInterval(() => {
      this.triggerAutoBackupIfDue();
    }, 60000);
  }

  private async triggerAutoBackupIfDue() {
    const settings = this.getSettings();
    if (!settings.autoBackup) return;

    const intervalMs = (settings.backupIntervalMinutes || 5) * 60 * 1000;
    const now = Date.now();
    if (now - (settings.lastBackupAt || 0) >= intervalMs) {
      await this.createBackupSnapshot();
    }
  }

  // Initial High-Quality Demo Projects
  private getInitialDemoProjects(): SongProject[] {
    const now = Date.now();
    return [
      {
        id: 'demo-lofi-1',
        title: 'Café & Chuva Noturna',
        prompt: 'Lo-fi chillhop nostálgico com piano elétrico suave, batida lenta e linhas de baixo relaxantes para estudos e concentração.',
        style: 'Lo-Fi Chillhop',
        mood: 'Relaxante',
        bpm: 84,
        key: 'F Major',
        timeSignature: '4/4',
        createdAt: now - 3600000 * 2,
        updatedAt: now - 3600000 * 2,
        durationSeconds: 32,
        generationModel: 'gemini-3.8-flash',
        isFavorite: true,
        tags: ['lofi', 'relax', 'piano', 'estudo'],
        coverArtGradient: 'from-amber-600 to-purple-800',
        lyrics: [
          { section: 'Intro', text: '[Som suave de chuva lá fora e café borbulhando]' },
          { section: 'Verso 1', text: 'Gotas na janela, ritmo devagar / Ideias que flutuam sem pressa de pousar' },
          { section: 'Refrão', text: 'Tudo fica calmo no compasso do som / Uma melodia em tom de bom' },
        ],
        tracks: [
          {
            id: 't-piano',
            name: 'Rhodes Piano',
            instrument: 'electric_piano',
            channel: 0,
            volume: 0.85,
            pan: -0.15,
            muted: false,
            solo: false,
            color: '#a855f7',
            notes: [
              { id: 'n1', pitch: 'F4', midi: 65, startBeat: 0, duration: 1.5, velocity: 85 },
              { id: 'n2', pitch: 'A4', midi: 69, startBeat: 0, duration: 1.5, velocity: 80 },
              { id: 'n3', pitch: 'C5', midi: 72, startBeat: 0, duration: 1.5, velocity: 82 },
              { id: 'n4', pitch: 'E5', midi: 76, startBeat: 1.5, duration: 1.0, velocity: 78 },
              { id: 'n5', pitch: 'D4', midi: 62, startBeat: 3, duration: 1.5, velocity: 80 },
              { id: 'n6', pitch: 'F4', midi: 65, startBeat: 3, duration: 1.5, velocity: 75 },
              { id: 'n7', pitch: 'A4', midi: 69, startBeat: 3, duration: 1.5, velocity: 78 },
              { id: 'n8', pitch: 'C5', midi: 72, startBeat: 4.5, duration: 1.0, velocity: 84 },
              { id: 'n9', pitch: 'Bb3', midi: 58, startBeat: 6, duration: 2.0, velocity: 82 },
              { id: 'n10', pitch: 'D4', midi: 62, startBeat: 6, duration: 2.0, velocity: 76 },
              { id: 'n11', pitch: 'F4', midi: 65, startBeat: 6, duration: 2.0, velocity: 79 },
              { id: 'n12', pitch: 'C4', midi: 60, startBeat: 9, duration: 2.0, velocity: 85 },
              { id: 'n13', pitch: 'E4', midi: 64, startBeat: 9, duration: 2.0, velocity: 80 },
              { id: 'n14', pitch: 'G4', midi: 67, startBeat: 9, duration: 2.0, velocity: 83 },
            ],
          },
          {
            id: 't-bass',
            name: 'Bass Lo-fi',
            instrument: 'electric_bass',
            channel: 1,
            volume: 0.9,
            pan: 0,
            muted: false,
            solo: false,
            color: '#3b82f6',
            notes: [
              { id: 'b1', pitch: 'F2', midi: 41, startBeat: 0, duration: 2.5, velocity: 95 },
              { id: 'b2', pitch: 'D2', midi: 38, startBeat: 3, duration: 2.5, velocity: 92 },
              { id: 'b3', pitch: 'Bb1', midi: 34, startBeat: 6, duration: 2.5, velocity: 96 },
              { id: 'b4', pitch: 'C2', midi: 36, startBeat: 9, duration: 2.5, velocity: 90 },
            ],
          },
          {
            id: 't-drums',
            name: 'Boom-Bap Beats',
            instrument: 'drum_kit',
            channel: 9,
            volume: 0.8,
            pan: 0,
            muted: false,
            solo: false,
            color: '#ec4899',
            notes: [
              // Kick: 36, Snare: 38, Closed HH: 42
              { id: 'd1', pitch: 'C1', midi: 36, startBeat: 0, duration: 0.5, velocity: 100 },
              { id: 'd2', pitch: 'F#1', midi: 42, startBeat: 0, duration: 0.5, velocity: 70 },
              { id: 'd3', pitch: 'F#1', midi: 42, startBeat: 0.5, duration: 0.5, velocity: 60 },
              { id: 'd4', pitch: 'D1', midi: 38, startBeat: 1, duration: 0.5, velocity: 90 },
              { id: 'd5', pitch: 'F#1', midi: 42, startBeat: 1, duration: 0.5, velocity: 70 },
              { id: 'd6', pitch: 'F#1', midi: 42, startBeat: 1.5, duration: 0.5, velocity: 65 },
              { id: 'd7', pitch: 'C1', midi: 36, startBeat: 2, duration: 0.5, velocity: 95 },
              { id: 'd8', pitch: 'C1', midi: 36, startBeat: 2.5, duration: 0.5, velocity: 85 },
              { id: 'd9', pitch: 'D1', midi: 38, startBeat: 3, duration: 0.5, velocity: 92 },
              { id: 'd10', pitch: 'F#1', midi: 42, startBeat: 3, duration: 0.5, velocity: 75 },
              { id: 'd11', pitch: 'C1', midi: 36, startBeat: 4, duration: 0.5, velocity: 100 },
              { id: 'd12', pitch: 'D1', midi: 38, startBeat: 5, duration: 0.5, velocity: 90 },
              { id: 'd13', pitch: 'C1', midi: 36, startBeat: 6, duration: 0.5, velocity: 95 },
              { id: 'd14', pitch: 'D1', midi: 38, startBeat: 7, duration: 0.5, velocity: 92 },
            ],
          },
        ],
      },
      {
        id: 'demo-synthwave-2',
        title: 'Neon Horizon 1984',
        prompt: 'Synthwave anos 80 acelerado, arpejador analógico retrô, baterias eletrônicas gated reverb e clima de viagem futurista à meia-noite.',
        style: 'Synthwave',
        mood: 'Futurista',
        bpm: 118,
        key: 'A Minor',
        timeSignature: '4/4',
        createdAt: now - 3600000 * 5,
        updatedAt: now - 3600000 * 5,
        durationSeconds: 28,
        generationModel: 'gemini-3.8-flash',
        isFavorite: true,
        tags: ['synthwave', 'retrowave', '80s', 'eletronica'],
        coverArtGradient: 'from-pink-600 via-purple-700 to-indigo-950',
        lyrics: [
          { section: 'Intro', text: '[Arpejador acelerado ecoando pela autoestrada de neon]' },
          { section: 'Refrão', text: 'Luzes correm pela pista em neon / O horizonte chama pelo som' },
        ],
        tracks: [
          {
            id: 't-lead',
            name: 'Analog Lead',
            instrument: 'synth_lead',
            channel: 0,
            volume: 0.85,
            pan: 0,
            muted: false,
            solo: false,
            color: '#06b6d4',
            notes: [
              { id: 'l1', pitch: 'A4', midi: 69, startBeat: 0, duration: 0.5, velocity: 90 },
              { id: 'l2', pitch: 'C5', midi: 72, startBeat: 0.5, duration: 0.5, velocity: 92 },
              { id: 'l3', pitch: 'E5', midi: 76, startBeat: 1, duration: 1.0, velocity: 95 },
              { id: 'l4', pitch: 'D5', midi: 74, startBeat: 2, duration: 0.5, velocity: 88 },
              { id: 'l5', pitch: 'C5', midi: 72, startBeat: 2.5, duration: 0.5, velocity: 90 },
              { id: 'l6', pitch: 'B4', midi: 71, startBeat: 3, duration: 1.0, velocity: 85 },
              { id: 'l7', pitch: 'G4', midi: 67, startBeat: 4, duration: 0.5, velocity: 88 },
              { id: 'l8', pitch: 'A4', midi: 69, startBeat: 4.5, duration: 1.5, velocity: 96 },
            ],
          },
          {
            id: 't-pad',
            name: 'Warm Poly Synth',
            instrument: 'synth_pad',
            channel: 1,
            volume: 0.75,
            pan: 0.2,
            muted: false,
            solo: false,
            color: '#f59e0b',
            notes: [
              { id: 'p1', pitch: 'A3', midi: 57, startBeat: 0, duration: 3.5, velocity: 75 },
              { id: 'p2', pitch: 'C4', midi: 60, startBeat: 0, duration: 3.5, velocity: 75 },
              { id: 'p3', pitch: 'E4', midi: 64, startBeat: 0, duration: 3.5, velocity: 75 },
              { id: 'p4', pitch: 'F3', midi: 53, startBeat: 4, duration: 3.5, velocity: 78 },
              { id: 'p5', pitch: 'A3', midi: 57, startBeat: 4, duration: 3.5, velocity: 78 },
              { id: 'p6', pitch: 'C4', midi: 60, startBeat: 4, duration: 3.5, velocity: 78 },
            ],
          },
          {
            id: 't-bass808',
            name: 'Sub Drive 808',
            instrument: 'sub_bass_808',
            channel: 2,
            volume: 0.9,
            pan: 0,
            muted: false,
            solo: false,
            color: '#ef4444',
            notes: [
              { id: 'sb1', pitch: 'A1', midi: 33, startBeat: 0, duration: 0.75, velocity: 100 },
              { id: 'sb2', pitch: 'A1', midi: 33, startBeat: 1, duration: 0.75, velocity: 95 },
              { id: 'sb3', pitch: 'A1', midi: 33, startBeat: 2, duration: 0.75, velocity: 100 },
              { id: 'sb4', pitch: 'C2', midi: 36, startBeat: 3, duration: 0.75, velocity: 95 },
              { id: 'sb5', pitch: 'F1', midi: 29, startBeat: 4, duration: 0.75, velocity: 100 },
              { id: 'sb6', pitch: 'F1', midi: 29, startBeat: 5, duration: 0.75, velocity: 95 },
            ],
          },
          {
            id: 't-drums80',
            name: 'Retro Beats',
            instrument: 'drum_kit',
            channel: 9,
            volume: 0.85,
            pan: 0,
            muted: false,
            solo: false,
            color: '#8b5cf6',
            notes: [
              { id: 'dr1', pitch: 'C1', midi: 36, startBeat: 0, duration: 0.5, velocity: 105 },
              { id: 'dr2', pitch: 'D1', midi: 38, startBeat: 1, duration: 0.5, velocity: 98 },
              { id: 'dr3', pitch: 'C1', midi: 36, startBeat: 2, duration: 0.5, velocity: 100 },
              { id: 'dr4', pitch: 'D1', midi: 38, startBeat: 3, duration: 0.5, velocity: 98 },
              { id: 'dr5', pitch: 'C1', midi: 36, startBeat: 4, duration: 0.5, velocity: 105 },
              { id: 'dr6', pitch: 'D1', midi: 38, startBeat: 5, duration: 0.5, velocity: 98 },
            ],
          },
        ],
      },
    ];
  }
}

export const storageService = new StorageService();
