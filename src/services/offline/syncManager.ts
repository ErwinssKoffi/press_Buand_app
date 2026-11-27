/**
 * Gestionnaire de synchronisation (Prompt 09 §4) : déclenché au retour online,
 * au démarrage et par action utilisateur — JAMAIS de timer permanent.
 * `navigator.onLine` n'est qu'un indice : la joignabilité réelle est prouvée
 * par la réponse du backend (flushOutbox gère l'échec réseau sans perte).
 */
import { syncApi } from '../api';
import {
  applyServerChanges,
  ensureDeviceId,
  flushOutbox,
  getLastSyncAt,
  getSyncCursor,
  onOutboxChange,
  outboxCounts,
  saveLastSyncAt,
  saveSyncCursor,
  type FlushSummary,
  type SyncResultApi,
} from './outbox';

/** Adaptateur vers les endpoints /sync (client API centralisé). */
export const serverSyncApi: SyncResultApi = {
  async push(deviceId, operations) {
    const out = await syncApi.push({
      deviceId,
      operations: operations.map((op) => ({
        operationId: op.operationId,
        type: op.type,
        payload: op.payload,
        dependsOn: op.dependsOn,
        localCreatedAt: op.localCreatedAt,
      })),
    });
    return out.results;
  },
  async pull(deviceId, since) {
    const out = await syncApi.pull({ deviceId, sinceRevision: since, limit: 500 });
    return { changes: out.changes, cursor: out.cursor, hasMore: out.hasMore };
  },
};

export interface SyncState {
  pending: number;
  conflicts: number;
  failed: number;
  lastSyncAt?: string;
  syncing: boolean;
}

let singleFlight: Promise<FlushSummary> | null = null;
let started = false;
const stateListeners = new Set<(s: SyncState) => void>();

function emitState(syncing: boolean): void {
  Promise.all([outboxCounts(), getLastSyncAt()]).then(([counts, lastSyncAt]) => {
    const state: SyncState = { ...counts, lastSyncAt, syncing };
    stateListeners.forEach((l) => l(state));
  });
}

export function onSyncState(listener: (s: SyncState) => void): () => void {
  stateListeners.add(listener);
  emitState(false);
  return () => stateListeners.delete(listener);
}

/** flush + pull incrémental + horodatage ; single-flight (pas de boucle réseau). */
export async function syncNow(): Promise<FlushSummary> {
  if (singleFlight) return singleFlight;
  emitState(true);
  singleFlight = (async () => {
    try {
      const deviceId = await ensureDeviceId();
      const summary = await flushOutbox(serverSyncApi);
      if (!summary.offline) {
        try {
          const since = await getSyncCursor();
          let cursor = since;
          let hasMore = true;
          let guard = 0;
          while (hasMore && guard++ < 20) {
            const page = await serverSyncApi.pull(deviceId, cursor);
            await applyServerChanges(page.changes);
            cursor = page.cursor;
            hasMore = page.hasMore;
          }
          await saveSyncCursor(cursor);
          await saveLastSyncAt(new Date().toISOString());
        } catch {
          // pull impossible : les opérations restent synchronisées, on reprendra
        }
      }
      return summary;
    } finally {
      singleFlight = null;
      emitState(false);
    }
  })();
  return singleFlight;
}

/** Enregistre les déclencheurs une seule fois par session d'app. */
export function startSyncManager(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  onOutboxChange(() => emitState(false));
  window.addEventListener('online', () => {
    // l'événement online est un INDICE : le flush prouve la joignabilité
    void syncNow();
  });
  window.addEventListener('focus', () => {
    void syncNow();
  });
  // démarrage : reprise des opérations interrompues (statut sending → pending)
  void syncNow();
}
