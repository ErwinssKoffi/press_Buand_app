/**
 * Tests de l'outbox offline (Prompt 09) — fake-indexeddb + API sync mockée.
 * Exécution : bun test tests/
 */
import { describe, expect, it, beforeEach, mock } from 'bun:test';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import {
  enqueueOperation,
  ensureDeviceId,
  flushOutbox,
  getLastSyncAt,
  getReconciliation,
  getSyncCursor,
  listConflicts,
  pendingOperations,
  retryConflict,
  saveSyncCursor,
  type SyncResultApi,
} from '../src/services/offline/outbox';
import type { OutboxOperation } from '../src/services/offline/types';

// IndexedDB est réinitialisé entre les tests par fake-indexeddb/auto + bun
// (module registry partagé) : chaque test utilise des operationIds uniques.

function makeApi(impl: (op: OutboxOperation) => Promise<{
  operationId: string;
  status: 'accepted' | 'duplicate' | 'conflict' | 'rejected';
  entity?: Record<string, unknown>;
  errorCode?: string;
  message?: string;
  officialTicket?: string;
}>): SyncResultApi & { calls: OutboxOperation[] } {
  const calls: OutboxOperation[] = [];
  return {
    calls,
    async push(_deviceId, operations) {
      calls.push(...operations);
      const res = await impl(operations[0]);
      return [res];
    },
    async pull() {
      return { changes: [], cursor: 0, hasMore: false };
    },
  };
}

const CLIENT_ID = 'c1eeeeee-0000-4000-8000-000000000001';
const ORDER_ID = 'o2eeeeee-0000-4000-8000-000000000002';
const PAY_OP = 'p3eeeeee-0000-4000-8000-000000000003';

beforeEach(async () => {
  mock.restore();
  // base IndexedDB neuve par test : fermer la connexion mise en cache d'abord
  const { closeDB } = await import('../src/db/localDb');
  await closeDB();
  globalThis.indexedDB = new IDBFactory() as typeof indexedDB;
});

describe('outbox offline', () => {
  it('deviceId stable par installation', async () => {
    const a = await ensureDeviceId();
    const b = await ensureDeviceId();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });

  it('création offline puis sync : commande réconciliée (ticket officiel, plus de pending)', async () => {
    await enqueueOperation({
      type: 'order.create',
      payload: { clientName: 'Aya', items: [], seenTotalFCFA: 3500 },
      provisionalTicket: 'LOCAL-261127-ABCD',
      operationId: ORDER_ID,
    });
    let queue = await pendingOperations();
    expect(queue.length).toBe(1);
    expect(queue[0].provisionalTicket).toMatch(/^LOCAL-/);

    const api = makeApi((op) =>
      Promise.resolve({
        operationId: op.operationId,
        status: 'accepted',
        officialTicket: 'EP-2026-0042',
        entity: { order: { id: 'official-ord-1', ticketNumber: 'EP-2026-0042', totalFCFA: 3500, paidFCFA: 0 } },
      })
    );
    const summary = await flushOutbox(api);
    expect(summary.synced).toBe(1);
    expect(summary.remaining).toBe(0);

    // réconciliation provisoire → officiel
    const rec = await getReconciliation(ORDER_ID);
    expect(rec?.officialId).toBe('official-ord-1');
    expect(rec?.officialTicket).toBe('EP-2026-0042');

    // opération confirmée : supprimée de la file (jamais avant confirmation)
    queue = await pendingOperations();
    expect(queue.length).toBe(0);
  });

  it('dépendances : client créé offline avant la commande qui le référence', async () => {
    const clientOp = await enqueueOperation({
      type: 'client.create',
      payload: { id: CLIENT_ID, fullName: 'Aya', phone: '07' },
    });
    const orderOp = await enqueueOperation({
      type: 'order.create',
      payload: { clientId: CLIENT_ID, clientName: 'Aya' },
      provisionalRefs: { clientId: CLIENT_ID },
    });
    const queue = await pendingOperations();
    expect(queue.map((o) => o.operationId)).toEqual([clientOp.operationId, orderOp.operationId]);
    expect(queue[0].type).toBe('client.create');

    // le serveur voit les opérations dans cet ordre
    const order: string[] = [];
    const api = makeApi((op) => {
      order.push(op.type);
      return Promise.resolve({ operationId: op.operationId, status: 'accepted' });
    });
    await flushOutbox(api);
    expect(order).toEqual(['client.create', 'order.create']);
  });

  it('timeout après écriture serveur puis retry : duplicate, aucune perte, aucun doublon', async () => {
    const op = await enqueueOperation({
      type: 'expense.create',
      payload: { label: 'Sachets', amountFCFA: 1000, date: '2026-11-27' },
    });
    let failNetwork = true;
    const api = makeApi((o) => {
      if (failNetwork) return Promise.reject(new Error('network dead'));
      return Promise.resolve({ operationId: o.operationId, status: 'accepted' });
    });
    // « timeout » : le flush s'arrête, l'opération reste pending
    const s1 = await flushOutbox(api);
    expect(s1.offline).toBe(true);
    let queue = await pendingOperations();
    expect(queue.length).toBe(1);
    expect(queue[0].status).toBe('pending');

    // retry : le serveur répond déjà appliqué (même operationId) → duplicate
    failNetwork = false;
    const apiDup = makeApi(() =>
      Promise.resolve({ operationId: op.operationId, status: 'duplicate' })
    );
    const s2 = await flushOutbox(apiDup);
    expect(s2.synced).toBe(1);
    queue = await pendingOperations();
    expect(queue.length).toBe(0);
  });

  it('double paiement : la réécriture des refs pointe vers l’ID officiel après réconciliation', async () => {
    await enqueueOperation({
      type: 'order.create',
      payload: { clientName: 'X' },
      operationId: ORDER_ID,
    });
    await enqueueOperation({
      type: 'order.payment',
      payload: { orderId: ORDER_ID, amountFCFA: 2000, method: 'wave' },
      provisionalRefs: { orderId: ORDER_ID },
      dependsOn: ORDER_ID,
    });
    const officialId = 'official-ord-9';
    const seenPayloads: Array<Record<string, unknown>> = [];
    const api = makeApi((op) => {
      if (op.type === 'order.payment') seenPayloads.push(op.payload as Record<string, unknown>);
      if (op.type === 'order.create') {
        return Promise.resolve({
          operationId: op.operationId,
          status: 'accepted',
          entity: { order: { id: officialId, ticketNumber: 'EP-2026-0009' } },
        });
      }
      return Promise.resolve({ operationId: op.operationId, status: 'accepted' });
    });
    await flushOutbox(api);
    // le paiement a été envoyé APRÈS réconciliation : orderId = ID officiel
    expect(seenPayloads.length).toBe(1);
    expect(seenPayloads[0]['orderId']).toBe(officialId);
  });

  it('conflit pricing_changed : payload conservé, reprise manuelle avec acceptPricing', async () => {
    const op = await enqueueOperation({
      type: 'order.create',
      payload: { clientName: 'Y', seenTotalFCFA: 3500 },
      provisionalTicket: 'LOCAL-261127-ZZZZ',
    });
    const apiConflict = makeApi(() =>
      Promise.resolve({
        operationId: op.operationId,
        status: 'conflict',
        errorCode: 'pricing_changed',
        message: 'Les tarifs ont changé.',
        entity: { recomputed: { totalFCFA: 5000 } },
      })
    );
    const s1 = await flushOutbox(apiConflict);
    expect(s1.conflicts).toBe(1);
    const conflicts = await listConflicts();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].errorCode).toBe('pricing_changed');
    // l'opération reste en file (statut conflict) : payload original intact
    let queue = await pendingOperations();
    expect(queue.length).toBe(0); // conflict n'est plus « pending »

    // reprise manuelle → renvoyée avec acceptPricing:true → acceptée
    await retryConflict(op.operationId, true);
    queue = await pendingOperations();
    expect(queue.length).toBe(1);
    expect(queue[0].acceptPricing).toBe(true);

    const seen: Array<Record<string, unknown>> = [];
    const apiAccept = makeApi((o) => {
      seen.push(o.payload as Record<string, unknown>);
      return Promise.resolve({ operationId: o.operationId, status: 'accepted', officialTicket: 'EP-2026-0077' });
    });
    const s2 = await flushOutbox(apiAccept);
    expect(s2.synced).toBe(1);
    expect(seen[0]['acceptPricing']).toBe(true);
  });

  it('corruption/ancienne version de l’outbox : isolée sans bloquer la file', async () => {
    await enqueueOperation({ type: 'expense.create', payload: { label: 'ok' } });
    // enregistrement corrompu (operationId présent, type absent — version obsolète)
    const { getDB } = await import('../src/db/localDb');
    const db = await getDB();
    await db.put('outbox', { operationId: 'broken-1', status: 'pending', attempts: 0 } as never);
    const queue = await pendingOperations();
    expect(queue.length).toBe(1);
    expect(queue[0].type).toBe('expense.create');
    const all = await db.getAll('outbox');
    const broken = all.find((o) => (o as OutboxOperation).operationId === 'broken-1');
    expect((broken as { status?: string }).status).toBe('failed');
  });

  it('interruption du navigateur pendant l’envoi : `sending` redevient `pending` au démarrage', async () => {
    const op = await enqueueOperation({
      type: 'expense.create',
      payload: { label: 'CIE', amountFCFA: 5000, date: '2026-11-27' },
    });
    // simule un crash après markSending (statut persisté, pas d'accusé serveur)
    const { getDB } = await import('../src/db/localDb');
    const db = await getDB();
    const raw = await db.get('outbox', op.operationId);
    await db.put('outbox', { ...raw, status: 'sending', attempts: 1 });
    // reprise : le démarrage remet en pending et renvoie
    const queue = await pendingOperations();
    expect(queue.length).toBe(1);
    expect(queue[0].status).toBe('pending');
    const api = makeApi(() =>
      Promise.resolve({ operationId: op.operationId, status: 'accepted' })
    );
    const s = await flushOutbox(api);
    expect(s.synced).toBe(1);
  });

  it('curseur sync persisté et horodatage', async () => {
    await saveSyncCursor(4242);
    expect(await getSyncCursor()).toBe(4242);
    await import('../src/services/offline/outbox').then((m) => m.saveLastSyncAt('2026-11-27T10:00:00Z'));
    expect(await getLastSyncAt()).toBe('2026-11-27T10:00:00Z');
  });
});
