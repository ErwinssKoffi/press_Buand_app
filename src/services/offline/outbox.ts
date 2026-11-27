/**
 * Outbox offline-first (Prompt 09).
 *
 * Invariants :
 * - l'opération est persistée (status pending) AVANT toute tentative d'envoi ;
 * - une opération pending n'est JAMAIS supprimée avant confirmation serveur
 *   (accepted/duplicate) ;
 * - navigator.onLine n'est jamais considéré comme preuve de joignabilité :
 *   seule la réponse (ou l'erreur réseau) du POST /sync/push fait foi ;
 * - aucun recalcul métier local : le payload décrit l'intention, le serveur
 *   recalcule montants et tickets (conflit pricing_changed sinon).
 */
import { getDB } from '../../db/localDb';
import type { ConflictRecord, OutboxOperation, OfflineOpType, Reconciliation } from './types';

export type { OutboxOperation, ConflictRecord, Reconciliation, OfflineOpType, OutboxStatus } from './types';
import type { OutboxStatus } from './types';

const SYNC_META_KEY_DEVICE = 'deviceId';

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-4${Math.random().toString(16).slice(2, 10)}-4${Math.random().toString(16).slice(2, 10)}`;
}

// ---------- deviceId stable par installation ----------

export async function ensureDeviceId(): Promise<string> {
  const db = await getDB();
  const row = await db.get('syncMeta', SYNC_META_KEY_DEVICE);
  if (row && typeof row.value === 'string' && row.value) {
    return row.value as string;
  }
  const id = uuid();
  await db.put('syncMeta', { key: SYNC_META_KEY_DEVICE, value: id });
  return id;
}

// ---------- écritures outbox ----------

export async function enqueueOperation(params: {
  type: OfflineOpType;
  payload: Record<string, unknown>;
  provisionalRefs?: Record<string, string>;
  provisionalTicket?: string;
  dependsOn?: string;
  /** ID provisoire imposé (ex. commande : l'ID local = operationId serveur). */
  operationId?: string;
}): Promise<OutboxOperation> {
  const db = await getDB();
  const op: OutboxOperation = {
    operationId: params.operationId || uuid(),
    type: params.type,
    payload: params.payload,
    provisionalRefs: params.provisionalRefs,
    provisionalTicket: params.provisionalTicket,
    dependsOn: params.dependsOn,
    localCreatedAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
  };
  await db.put('outbox', op);
  notifyChange();
  return op;
}

/** Marque sending de manière persistante (interruption navigateur → rechargement). */
async function markSending(op: OutboxOperation): Promise<void> {
  const db = await getDB();
  await db.put('outbox', { ...op, status: 'sending', attempts: op.attempts + 1 });
}

async function markStatus(operationId: string, status: OutboxStatus, lastError?: string): Promise<void> {
  const db = await getDB();
  const op = await db.get('outbox', operationId);
  if (!op) return;
  await db.put('outbox', { ...op, status, lastError });
  notifyChange();
}

async function removeOperation(operationId: string): Promise<void> {
  const db = await getDB();
  await db.delete('outbox', operationId);
  notifyChange();
}

// ---------- lecture / tri par dépendances ----------

/** Extrait les références provisoires client d'un payload de commande. */
function clientRefOf(op: OutboxOperation): string | undefined {
  if (op.type === 'order.create') {
    const cid = op.payload['clientId'];
    return typeof cid === 'string' && cid ? cid : undefined;
  }
  return undefined;
}

/**
 * Opérations à envoyer, triées : dépendances d'abord (client.create avant
 * order.create qui référence son ID provisoire, order.create avant
 * order.payment sur ce provisoire), puis par date locale. Les enregistrements
 * corrompus (operationId/type manquants) sont isolés en `failed` sans bloquer
 * la file et SANS perdre le payload original.
 */
export async function pendingOperations(): Promise<OutboxOperation[]> {
  const db = await getDB();
  let all: OutboxOperation[];
  try {
    all = await db.getAll('outbox');
  } catch {
    return [];
  }
  const clean: OutboxOperation[] = [];
  for (const raw of all) {
    const op = raw as OutboxOperation;
    if (!op || typeof op.operationId !== 'string' || !op.operationId || typeof op.type !== 'string') {
      if (raw && typeof raw === 'object') {
        const broken = raw as Partial<OutboxOperation>;
        if (broken.operationId) {
          await db.put('outbox', {
            ...(broken as OutboxOperation),
            status: 'failed',
            lastError: 'Enregistrement corrompu ou version obsolète — reprise manuelle requise.',
          });
        }
      }
      continue;
    }
    if (op.status === 'pending' || op.status === 'sending') {
      // `sending` = interruption pendant l'envoi : redevient pending (retry sûr,
      // l'operationId garantit aucun doublon côté serveur)
      if (op.status === 'sending') {
        await db.put('outbox', { ...op, status: 'pending' });
      }
      clean.push({ ...op, status: 'pending' });
    }
  }
  // tri topologique simple par niveaux de dépendances
  const byId = new Map(clean.map((o) => [o.operationId, o]));
  const ordered: OutboxOperation[] = [];
  const visited = new Set<string>();
  const visit = (op: OutboxOperation, chain: Set<string>) => {
    if (visited.has(op.operationId) || chain.has(op.operationId)) return;
    chain.add(op.operationId);
    const clientRef = clientRefOf(op);
    if (clientRef) {
      const clientOp = [...byId.values()].find(
        (o) => o.type === 'client.create' && (o.payload['id'] === clientRef || o.operationId === clientRef)
      );
      if (clientOp) visit(clientOp, chain);
    }
    if (op.dependsOn) {
      const dep = byId.get(op.dependsOn);
      if (dep) visit(dep, chain);
    }
    if (op.type === 'order.payment') {
      const orderRef = op.provisionalRefs?.['orderId'];
      if (orderRef) {
        const orderOp = byId.get(orderRef);
        if (orderOp) visit(orderOp, chain);
      }
    }
    chain.delete(op.operationId);
    visited.add(op.operationId);
    ordered.push(op);
  };
  [...clean]
    .sort((a, b) => a.localCreatedAt.localeCompare(b.localCreatedAt))
    .forEach((o) => visit(o, new Set()));
  return ordered;
}

export async function outboxCounts(): Promise<{ pending: number; conflicts: number; failed: number }> {
  try {
    const db = await getDB();
    const all = await db.getAll('outbox');
    const conflicts = await db.count('conflicts');
    return {
      pending: all.filter((o) => o.status === 'pending' || o.status === 'sending').length,
      conflicts,
      failed: all.filter((o) => o.status === 'failed').length,
    };
  } catch {
    return { pending: 0, conflicts: 0, failed: 0 };
  }
}

export async function listConflicts(): Promise<ConflictRecord[]> {
  try {
    const db = await getDB();
    return await db.getAll('conflicts');
  } catch {
    return [];
  }
}

/** Réprise manuelle après conflit : pending (le payload original est conservé). */
export async function retryConflict(operationId: string, acceptPricing?: boolean): Promise<void> {
  const db = await getDB();
  const op = await db.get('outbox', operationId);
  if (!op) return;
  await db.put('outbox', { ...op, status: 'pending', acceptPricing: acceptPricing || op.acceptPricing });
  await db.delete('conflicts', operationId);
  notifyChange();
}

/** Suppression explicite d'une opération refusée définitivement (payload conservé en conflit/erreur). */
export async function discardOperation(operationId: string): Promise<void> {
  const db = await getDB();
  await db.delete('outbox', operationId);
  await db.delete('conflicts', operationId);
  notifyChange();
}

// ---------- réconciliation ----------

export async function saveReconciliation(rec: Reconciliation): Promise<void> {
  const db = await getDB();
  await db.put('reconciliations', rec);
}

export async function getReconciliation(provisionalId: string): Promise<Reconciliation | undefined> {
  try {
    const db = await getDB();
    return await db.get('reconciliations', provisionalId);
  } catch {
    return undefined;
  }
}

/**
 * Réécrit les références provisoires des opérations en attente qui pointent
 * vers une entité réconciliée (ex. paiement hors ligne sur commande provisoire).
 */
async function reconcilePendingRefs(provisionalId: string, officialId: string): Promise<void> {
  const db = await getDB();
  const all = await db.getAll('outbox');
  for (const raw of all) {
    const op = raw as OutboxOperation;
    if (op.status !== 'pending' && op.status !== 'sending') continue;
    let changed = false;
    if (op.provisionalRefs?.['orderId'] === provisionalId) {
      op.provisionalRefs = { ...op.provisionalRefs, orderId: officialId };
      const payloadOrderId = op.payload['orderId'];
      if (payloadOrderId === provisionalId) op.payload = { ...op.payload, orderId: officialId };
      changed = true;
    }
    if (op.dependsOn === provisionalId) {
      op.dependsOn = officialId;
      changed = true;
    }
    if (op.type === 'order.create') {
      const cid = op.payload['clientId'];
      if (typeof cid === 'string' && cid === provisionalId) {
        op.payload = { ...op.payload, clientId: officialId };
        changed = true;
      }
    }
    if (changed) await db.put('outbox', op);
  }
}

// ---------- curseur / dernière synchro ----------

export async function getSyncCursor(): Promise<number> {
  try {
    const db = await getDB();
    const row = await db.get('syncMeta', 'cursor');
    return row && typeof row.value === 'number' ? (row.value as number) : 0;
  } catch {
    return 0;
  }
}

export async function saveSyncCursor(cursor: number): Promise<void> {
  const db = await getDB();
  await db.put('syncMeta', { key: 'cursor', value: cursor });
}

export async function getLastSyncAt(): Promise<string | undefined> {
  try {
    const db = await getDB();
    const row = await db.get('syncMeta', 'lastSyncAt');
    return row && typeof row.value === 'string' ? (row.value as string) : undefined;
  } catch {
    return undefined;
  }
}

export async function saveLastSyncAt(iso: string): Promise<void> {
  const db = await getDB();
  await db.put('syncMeta', { key: 'lastSyncAt', value: iso });
}

// ---------- application des changements serveur au cache ----------

/**
 * Applique un lot de changements du pull aux stores de cache (upsert only —
 * jamais de suppression automatique de données récentes).
 */
export async function applyServerChanges(
  changes: Array<{ entity: string; entity_id: string; data: Record<string, unknown> }>
): Promise<void> {
  if (changes.length === 0) return;
  const db = await getDB();
  const storeByEntity: Record<string, string> = {
    settings: 'settings',
    catalog: 'catalog',
    clients: 'clients',
    orders: 'orders',
    payments: 'payments',
    expenses: 'expenses',
    zones: 'zones',
    logistics: 'logistics',
    inventory: 'inventory',
    inventoryMovements: 'inventoryMovements',
  };
  for (const ch of changes) {
    const store = storeByEntity[ch.entity];
    if (!store || !ch.data) continue;
    if (ch.entity === 'settings') {
      await db.put('settings', { id: 'default', ...(ch.data as Record<string, unknown>) } as never);
      continue;
    }
    const row = ch.data as Record<string, unknown>;
    // champs nullables → undefined pour coller aux types frontend
    for (const k of Object.keys(row)) {
      if (row[k] === null) delete row[k];
    }
    await db.put(store as never, row as never);
  }
}

// ---------- notification de changement (UI réactive sans timer) ----------

type Listener = () => void;
const listeners = new Set<Listener>();

export function onOutboxChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyChange(): void {
  listeners.forEach((l) => l());
}

// ---------- flush ----------

export interface SyncResultApi {
  push(deviceId: string, operations: OutboxOperation[]): Promise<
    Array<{
      operationId: string;
      status: 'accepted' | 'duplicate' | 'conflict' | 'rejected';
      entity?: Record<string, unknown>;
      errorCode?: string;
      message?: string;
      officialTicket?: string;
    }>
  >;
  pull(deviceId: string, since: number): Promise<{
    changes: Array<{ entity: string; entity_id: string; data: Record<string, unknown> }>;
    cursor: number;
    hasMore: boolean;
  }>;
}

export interface FlushSummary {
  synced: number;
  conflicts: number;
  failed: number;
  remaining: number;
  /** vrai si l'envoi s'est arrêté faute de serveur joignable (rien de perdu). */
  offline: boolean;
}

let flushing = false;

/** Envoie les opérations en attente (une par lot, ordre de dépendances). */
export async function flushOutbox(api: SyncResultApi): Promise<FlushSummary> {
  if (flushing) return { synced: 0, conflicts: 0, failed: 0, remaining: -1, offline: false };
  flushing = true;
  const summary: FlushSummary = { synced: 0, conflicts: 0, failed: 0, remaining: 0, offline: false };
  try {
    const deviceId = await ensureDeviceId();
    // une opération à la fois, file re-lue à chaque itération : les
    // réconciliations (ID provisoire → officiel) débloquent immédiatement
    // les dépendances ; conflits/rejets sortent de la file `pending`.
    for (let guard = 0; guard < 200; guard++) {
      const queue = await pendingOperations();
      if (queue.length === 0) break;
      const op = queue[0];
      await markSending(op);
      try {
        const wire = op.acceptPricing
          ? { ...op, payload: { ...op.payload, acceptPricing: true } }
          : op;
        const results = await api.push(deviceId, [wire as OutboxOperation]);
        const res = results[0];
        if (!res) {
          await markStatus(op.operationId, 'failed', 'Réponse sync vide.');
          summary.failed++;
          continue;
        }
        if (res.status === 'accepted' || res.status === 'duplicate') {
          await handleAccepted(op, res);
          await removeOperation(op.operationId);
          summary.synced++;
        } else if (res.status === 'conflict') {
          await markStatus(op.operationId, 'conflict', res.message);
          const db = await getDB();
          await db.put('conflicts', {
            operationId: op.operationId,
            type: op.type,
            errorCode: res.errorCode ?? 'conflict',
            message: res.message ?? 'Conflit de synchronisation.',
            entity: res.entity,
            occurredAt: new Date().toISOString(),
          });
          summary.conflicts++;
        } else {
          await markStatus(op.operationId, 'failed', res.message);
          summary.failed++;
        }
      } catch (err) {
        // réseau indisponible : l'opération reste pending (rien n'est perdu)
        await markStatus(op.operationId, 'pending', err instanceof Error ? err.message : 'erreur réseau');
        summary.offline = true;
        summary.remaining = (await pendingOperations()).length;
        notifyChange();
        return summary;
      }
    }
    summary.remaining = (await pendingOperations()).length;
    return summary;
  } finally {
    flushing = false;
    notifyChange();
  }
}

/** Opération acceptée : réconciliation provisoire → officiel + cache local. */
async function handleAccepted(
  op: OutboxOperation,
  res: { entity?: Record<string, unknown>; officialTicket?: string }
): Promise<void> {
  if (op.type !== 'order.create') return;
  const order = res.entity?.['order'] as
    | { id?: string; ticketNumber?: string; totalFCFA?: number; paidFCFA?: number; status?: string }
    | undefined;
  if (!order?.id) return;
  const provisionalId = op.operationId;
  await saveReconciliation({
    provisionalId,
    officialId: order.id,
    officialTicket: order.ticketNumber ?? res.officialTicket ?? '',
    reconciledAt: new Date().toISOString(),
  });
  await reconcilePendingRefs(provisionalId, order.id);
  // remplace l'entrée provisoire du cache par la commande officielle
  try {
    const db = await getDB();
    const cached = await db.get('orders', provisionalId);
    if (cached) await db.delete('orders', provisionalId);
    const local = (cached ?? {}) as Record<string, unknown>;
    await db.put('orders', {
      ...local,
      id: order.id,
      ticketNumber: order.ticketNumber ?? cached?.ticketNumber,
      totalFCFA: order.totalFCFA ?? local.totalFCFA,
      paidFCFA: order.paidFCFA ?? local.paidFCFA,
      status: order.status ?? local.status,
    } as never);
  } catch {
    /* cache best effort : la prochaine bootstrap réalignera */
  }
}
