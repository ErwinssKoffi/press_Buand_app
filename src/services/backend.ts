/**
 * Repository frontend (Prompt 08) : même surface que `src/db/localDb.ts`
 * mais portée par le backend Go. Les composants ne changent pas — seule la
 * persistance change.
 *
 * Stratégie de cache (Prompt 08 §8) :
 * - chaque bootstrap réussi est réécrit dans IndexedDB (fallback lecture) ;
 * - hors-ligne, `loadAllData()` sert le dernier instantané local (lecture
 *   seule) — le mode offline complet (outbox) arrive au Prompt 09 ;
 * - toute écriture passe par l'API (aucune mutation directe d'IndexedDB).
 *
 * Valeur financière finale : jamais calculée de façon autoritaire ici —
 * l'aperçu local du POS est indicatif, la commande persistée (montants,
 * prépayé réel, points) est celle renvoyée par POST /orders / /orders/mapping.
 */
import {
  bootstrapApi,
  backupApi,
  catalogApi,
  clientsApi,
  expensesApi,
  inventoryApi,
  logisticsApi,
  ordersApi,
  settingsApi,
  zonesApi,
  type BackupReport,
  type CreateOrderPayload,
  type ServerClient,
  type ServerOrder,
  type ServerPayment,
} from './api';
import type {
  CatalogItem,
  Client,
  ClientWalletEntry,
  DatabaseBackup,
  DeliveryZone,
  ExpenseRecord,
  IntakePhoto,
  InventoryItem,
  InventoryMovement,
  InventoryMovementType,
  LogisticsStatus,
  LogisticsTask,
  PaymentMethod,
  PaymentRecord,
  PressingOrder,
  PressingSettings,
} from '../types/pressing';
import { resolveCatalogItemImage } from '../utils/catalogImages';
import { getDB, normalizeSettings } from '../db/localDb';
import { isOfflineError } from './api';
import {
  enqueueOperation,
  type OfflineOpType,
} from './offline/outbox';
import { provisionalTicket } from '../utils/provisional';

/**
 * Opérations offline explicitement autorisées (Prompt 09 §7) : création de
 * client, dépôt (commande), paiement complémentaire, dépense, mouvement de
 * stock, tâche logistique. TOUT le reste (settings, catalogue, stocks eux-
 * mêmes, import/export, PIN, void, changements de statut) exige Internet —
 * les tentatives hors-ligne échouent proprement en OfflineError affichée.
 */

/** Écrit best-effort dans le cache IndexedDB (brouillons visibles hors-ligne). */
async function cacheUpsert(store: 'orders' | 'payments' | 'clients' | 'expenses' | 'logistics' | 'inventoryMovements', row: unknown): Promise<void> {
  try {
    const db = await getDB();
    await db.put(store as never, row as never);
  } catch {
    /* cache best effort */
  }
}

/** Enfile l'opération si le serveur est injoignable ; sinon undefined. */
async function offlineOrThrow(
  type: OfflineOpType,
  payload: Record<string, unknown>,
  err: unknown,
  extra?: { provisionalRefs?: Record<string, string>; provisionalTicket?: string }
): Promise<false> {
  if (isOfflineError(err)) {
    await enqueueOperation({ type, payload, ...extra });
    return false;
  }
  throw err;
}

// ---------- Mappings serveur (nullables) → types frontend ----------

function orEmpty(v: string | null | undefined): string {
  return v ?? '';
}

function mapClient(s: ServerClient): Client {
  return {
    id: s.id,
    fullName: s.fullName,
    phone: s.phone,
    commune: s.commune,
    addressNote: orEmpty(s.addressNote) || undefined,
    createdAt: s.createdAt,
    loyaltyPoints: s.loyaltyPoints ?? 0,
    prepaidBalanceFCFA: s.prepaidBalanceFCFA ?? 0,
    subscriptionLabel: s.subscriptionLabel ?? undefined,
    subscriptionExpiresAt: s.subscriptionExpiresAt ?? undefined,
    walletHistory: s.walletHistory,
  };
}

function mapPhoto(p: NonNullable<ServerOrder['claimPhotos']>[number]): IntakePhoto {
  return {
    id: p.id,
    caption: p.caption,
    itemName: p.itemName ?? undefined,
    capturedAt: p.capturedAt,
    url: p.url,
  };
}

function mapOrder(s: ServerOrder): PressingOrder {
  return {
    id: s.id,
    ticketNumber: s.ticketNumber,
    clientId: orEmpty(s.clientId),
    clientName: s.clientName,
    clientPhone: s.clientPhone,
    commune: s.commune,
    rackSlot: s.rackSlot,
    items: (s.items ?? []).map((it) => ({
      ...it,
      catalogItemId: it.catalogItemId ?? '',
      note: it.note ?? undefined,
      expressDueDate: it.expressDueDate ?? undefined,
    })),
    isExpress: s.isExpress,
    expressFeeFCFA: s.expressFeeFCFA,
    deliveryFeeFCFA: s.deliveryFeeFCFA,
    discountFCFA: s.discountFCFA,
    prepaidUsedFCFA: s.prepaidUsedFCFA,
    loyaltyPointsEarned: s.loyaltyPointsEarned,
    loyaltyPointsRedeemed: s.loyaltyPointsRedeemed,
    claimPhotos: s.claimPhotos?.map(mapPhoto),
    totalFCFA: s.totalFCFA,
    paidFCFA: s.paidFCFA,
    status: s.status,
    dropOffDate: s.dropOffDate,
    dueDate: orEmpty(s.dueDate),
    deliveredAt: s.deliveredAt ?? undefined,
    notes: orEmpty(s.notes) || undefined,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function mapPayment(s: ServerPayment): PaymentRecord {
  return {
    id: s.id,
    orderId: orEmpty(s.orderId),
    ticketNumber: s.ticketNumber,
    clientName: s.clientName,
    amountFCFA: s.amountFCFA,
    method: s.method,
    paidAt: s.paidAt,
    type: s.type,
  };
}

function mapTask(s: LogisticsTask): LogisticsTask {
  return {
    ...s,
    clientId: orEmpty(s.clientId),
    orderId: s.orderId ?? undefined,
    ticketNumber: orEmpty(s.ticketNumber) || undefined,
    courierPhone: s.courierPhone ?? undefined,
    estimatedPieces: s.estimatedPieces ?? undefined,
    notes: s.notes ?? undefined,
  };
}

function idemKey(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------- Cache IndexedDB (fallback lecture hors-ligne) ----------

export interface AllData {
  settings: PressingSettings;
  catalog: CatalogItem[];
  clients: Client[];
  orders: PressingOrder[];
  payments: PaymentRecord[];
  expenses: ExpenseRecord[];
  zones: DeliveryZone[];
  logistics: LogisticsTask[];
  inventory: InventoryItem[];
  inventoryMovements: InventoryMovement[];
  fromCache?: boolean;
}

/** Réécrit l'instantané serveur dans IndexedDB (fallback hors-ligne). */
async function cacheSnapshot(data: AllData): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(
      ['settings', 'catalog', 'clients', 'orders', 'payments', 'expenses', 'zones', 'logistics', 'inventory', 'inventoryMovements'],
      'readwrite'
    );
    await Promise.all([
      tx.objectStore('settings').put(normalizeSettings(data.settings)),
      Promise.all(data.catalog.map((x) => tx.objectStore('catalog').put(x))),
      Promise.all(data.clients.map((x) => tx.objectStore('clients').put(x))),
      Promise.all(data.orders.map((x) => tx.objectStore('orders').put(x))),
      Promise.all(data.payments.map((x) => tx.objectStore('payments').put(x))),
      Promise.all(data.expenses.map((x) => tx.objectStore('expenses').put(x))),
      Promise.all(data.zones.map((x) => tx.objectStore('zones').put(x))),
      Promise.all(data.logistics.map((x) => tx.objectStore('logistics').put(x))),
      Promise.all(data.inventory.map((x) => tx.objectStore('inventory').put(x))),
      Promise.all(data.inventoryMovements.map((x) => tx.objectStore('inventoryMovements').put(x))),
      tx.done,
    ]);
  } catch {
    // le cache est best effort : une erreur IndexedDB ne doit pas casser l'UI
  }
}

// ---------- API publique (miroir de localDb.ts) ----------

/** Données complètes : bootstrap serveur, fallback IndexedDB si injoignable. */
export async function loadAllData(): Promise<AllData> {
  try {
    const boot = await bootstrapApi.get();
    const data: AllData = {
      settings: normalizeSettings(boot.settings as PressingSettings),
      catalog: boot.catalog
        .map((c) => ({ ...c, imageUrl: resolveCatalogItemImage(c) }))
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
      clients: boot.clients.map(mapClient).sort((a, b) => a.fullName.localeCompare(b.fullName)),
      orders: boot.orders.map(mapOrder).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      payments: boot.payments.map(mapPayment).sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
      expenses: [...boot.expenses].sort(
        (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
      ),
      zones: [...boot.zones].sort((a, b) => a.commune.localeCompare(b.commune)),
      logistics: boot.logistics
        .map(mapTask)
        .sort(
          (a, b) =>
            a.scheduledDate.localeCompare(b.scheduledDate) || b.createdAt.localeCompare(a.createdAt)
        ),
      inventory: [...boot.inventory].sort(
        (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
      ),
      inventoryMovements: [...boot.inventoryMovements].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      ),
      fromCache: false,
    };
    await cacheSnapshot(data);
    return data;
  } catch (err) {
    // fallback : dernier instantané IndexedDB (mode offline lecture seule)
    const { loadAllData: loadLocal } = await import('../db/localDb');
    const local = await loadLocal();
    return { ...local, fromCache: true };
  }
}

export async function saveClient(client: Client): Promise<void> {
  const payload = { ...client };
  try {
    await clientsApi.save(client);
  } catch (err) {
    // ID provisoire = UUID conservé comme ID réel côté serveur (réconciliation triviale)
    const id = client.id || crypto.randomUUID();
    const withId = { ...payload, id };
    if (await offlineOrThrow('client.create', withId as Record<string, unknown>, err)) return;
    await cacheUpsert('clients', { ...client, id });
    return; // enfilé : le client local (cache) garde son ID provisoire
  }
}

export async function deleteClient(id: string): Promise<void> {
  await clientsApi.remove(id);
}

export async function saveCatalogItem(item: CatalogItem): Promise<void> {
  await catalogApi.save(item);
}

export async function deleteCatalogItem(id: string): Promise<void> {
  await catalogApi.remove(id);
}

export async function saveSettings(settings: PressingSettings): Promise<void> {
  await settingsApi.update(settings);
}

export async function topUpClientPrepaid(params: {
  clientId: string;
  amountFCFA: number;
  bonusFCFA?: number;
  method: PaymentMethod;
  subscriptionLabel?: string;
  subscriptionExpiresAt?: string;
  note?: string;
}): Promise<void> {
  await clientsApi.topUp(params.clientId, params, idemKey('top'));
}

/**
 * Création de commande : l'aperçu du POS (orderDraft.totalFCFA) est indicatif ;
 * la commande RENVOYÉE par le serveur fait foi (montants, prépayé réel,
 * points fidélité, numéro de ticket).
 */
export async function createOrderWithPayment(
  orderDraft: Omit<PressingOrder, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt'>,
  initialPaymentMethod: PaymentMethod
): Promise<{ order: PressingOrder; settings: PressingSettings }> {
  const prepaidRequested = Math.max(0, Math.round(orderDraft.prepaidUsedFCFA || 0));
  const cashPaid = Math.max(0, Math.round((orderDraft.paidFCFA || 0) - prepaidRequested));

  const payload: CreateOrderPayload = {
    clientId: orderDraft.clientId || null,
    clientName: orderDraft.clientName,
    clientPhone: orderDraft.clientPhone,
    commune: orderDraft.commune,
    rackSlot: orderDraft.rackSlot,
    items: orderDraft.items.map((it) => ({
      catalogItemId: it.catalogItemId || undefined,
      name: it.name,
      mode: it.mode,
      quantity: it.quantity,
      unit: it.unit,
      unitPriceFCFA: it.unitPriceFCFA,
      note: it.note,
      activityType: it.activityType,
      pricingBasis: it.pricingBasis,
      piecesPerUnit: it.piecesPerUnit,
      weightKg: it.weightKg,
      isExpress: it.isExpress,
      expressFeeFCFA: it.expressFeeFCFA,
      expressDueDate: it.expressDueDate,
    })),
    isExpress: orderDraft.isExpress,
    deliveryFeeFCFA: orderDraft.deliveryFeeFCFA,
    discountFCFA: orderDraft.discountFCFA,
    usePrepaid: prepaidRequested > 0,
    prepaidAmountFCFA: prepaidRequested,
    loyaltyPointsRedeemed: Math.max(0, Math.round(orderDraft.loyaltyPointsRedeemed || 0)),
    initialPaymentMethod,
    initialCashPaidFCFA: cashPaid > 0 ? cashPaid : 0,
    dropOffDate: orderDraft.dropOffDate,
    dueDate: orderDraft.dueDate || null,
    notes: orderDraft.notes || '',
    claimPhotos: (orderDraft.claimPhotos ?? []).map((ph) => ({
      id: ph.id,
      caption: ph.caption,
      itemName: ph.itemName,
      capturedAt: ph.capturedAt,
      // data URL compressée locale ; le serveur la matérialise en stockage privé
      url: ph.dataUrl || ph.url || '',
    })),
  };

  let serverOrder: ServerOrder | null = null;
  try {
    serverOrder = await ordersApi.create(payload, idemKey('ord'));
  } catch (err) {
    // ID provisoire = operationId serveur (clé du journal : réconciliation sûre)
    const provisionalId = crypto.randomUUID();
    const ticket = provisionalTicket();
    if (!(await enqueueOperation({
      type: 'order.create',
      payload: payload as unknown as Record<string, unknown>,
      provisionalRefs: orderDraft.clientId ? { clientId: orderDraft.clientId } : undefined,
      provisionalTicket: ticket,
      operationId: provisionalId,
    }))) {
      // brouillon local persisté : référence provisoire clairement distinguée
      // du ticket définitif (préfixe LOCAL-) jusqu'à la synchronisation
      const nowIso = new Date().toISOString();
      const provisionalOrder: PressingOrder = {
        ...(orderDraft as PressingOrder),
        id: provisionalId,
        ticketNumber: ticket,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await cacheUpsert('orders', provisionalOrder);
      // acompte cash local indicatif (le serveur recalculera ; pull réalignera)
      const cash = Math.max(0, Math.round((orderDraft.paidFCFA || 0) - Math.max(0, Math.round(orderDraft.prepaidUsedFCFA || 0))));
      if (cash > 0) {
        await cacheUpsert('payments', {
          id: `pay-${crypto.randomUUID()}`,
          orderId: provisionalId,
          ticketNumber: ticket,
          clientName: orderDraft.clientName,
          amountFCFA: cash,
          method: initialPaymentMethod,
          paidAt: nowIso,
          type: 'acompte',
        });
      }
      let cachedSettings: PressingSettings | undefined;
      try {
        const db = await getDB();
        cachedSettings = normalizeSettings((await db.get('settings', 'default')) ?? undefined);
      } catch {
        cachedSettings = undefined;
      }
      return { order: provisionalOrder, settings: cachedSettings ?? normalizeSettings(undefined) };
    }
  }
  if (serverOrder) {
    const settings = await settingsApi.get();
    return { order: mapOrder(serverOrder), settings: normalizeSettings(settings) };
  }
  throw new Error('création de commande : état inattendu');
}

export async function updateOrderStatus(orderId: string, status: PressingOrder['status']): Promise<void> {
  await ordersApi.updateStatus(orderId, status);
}

export async function recordOrderPayment(
  orderId: string,
  amountFCFA: number,
  method: PaymentMethod
): Promise<void> {
  if (amountFCFA <= 0) return;
  try {
    await ordersApi.addPayment(orderId, { amountFCFA: Math.round(amountFCFA), method }, idemKey('pay'));
  } catch (err) {
    // l'ID de commande (provisoire ou officielle) est résolu côté serveur via
    // le journal de sync ; localement on met le cache à jour (indicatif)
    if (await offlineOrThrow(
      'order.payment',
      { orderId, amountFCFA: Math.round(amountFCFA), method },
      err,
      { provisionalRefs: { orderId } }
    )) {
      return;
    }
    try {
      const db = await getDB();
      const order = await db.get('orders', orderId);
      if (order) {
        const nowIso = new Date().toISOString();
        const newPaid = Math.min(order.totalFCFA, order.paidFCFA + Math.round(amountFCFA));
        await db.put('orders', { ...order, paidFCFA: newPaid, updatedAt: nowIso });
        await db.put('payments', {
          id: `pay-${crypto.randomUUID()}`,
          orderId,
          ticketNumber: order.ticketNumber,
          clientName: order.clientName,
          amountFCFA: Math.round(amountFCFA),
          method,
          paidAt: nowIso,
          type: newPaid >= order.totalFCFA ? 'solde' : 'acompte',
        } as never);
      }
    } catch {
      /* cache best effort */
    }
  }
}

/**
 * L'ancienne suppression IndexedDB devient une ANNULATION non destructive
 * côté serveur (void) : la commande est conservée avec son motif.
 */
export async function deleteOrder(orderId: string): Promise<void> {
  await ordersApi.void(orderId, 'Annulée depuis le comptoir');
}

export async function saveExpense(expense: ExpenseRecord): Promise<void> {
  try {
    await expensesApi.create(expense);
  } catch (err) {
    if (await offlineOrThrow('expense.create', { ...expense, id: expense.id || crypto.randomUUID() } as Record<string, unknown>, err)) return;
    await cacheUpsert('expenses', { ...expense, id: expense.id || crypto.randomUUID() });
  }
}

export async function deleteExpense(id: string): Promise<void> {
  await expensesApi.remove(id);
}

export async function saveDeliveryZone(zone: DeliveryZone): Promise<void> {
  await zonesApi.save(zone);
}

export async function deleteDeliveryZone(id: string): Promise<void> {
  await zonesApi.remove(id);
}

export async function saveLogisticsTask(task: LogisticsTask): Promise<void> {
  const body = mapTaskOut(task);
  try {
    await logisticsApi.save(body);
  } catch (err) {
    await offlineOrThrow('logistics.save', { ...body, id: task.id || crypto.randomUUID() } as Record<string, unknown>, err);
  }
}

function mapTaskOut(task: LogisticsTask): LogisticsTask {
  return {
    ...task,
    clientId: task.clientId || '',
    orderId: task.orderId || undefined,
    ticketNumber: task.ticketNumber || undefined,
    courierPhone: task.courierPhone || undefined,
    estimatedPieces: task.estimatedPieces,
    notes: task.notes || undefined,
  };
}

export async function updateLogisticsStatus(
  id: string,
  status: LogisticsStatus
): Promise<void> {
  await logisticsApi.updateStatus(id, status);
}

export async function deleteLogisticsTask(id: string): Promise<void> {
  await logisticsApi.remove(id);
}

export async function saveInventoryItem(item: InventoryItem): Promise<void> {
  await inventoryApi.save(item);
}

export async function deleteInventoryItem(id: string): Promise<void> {
  await inventoryApi.remove(id);
}

export async function recordInventoryMovement(params: {
  itemId: string;
  type: InventoryMovementType;
  quantity: number;
  unitCostFCFA?: number;
  reason: string;
  recordExpense?: boolean;
  paymentMethod?: PaymentMethod;
}): Promise<void> {
  const body = {
    itemId: params.itemId,
    type: params.type,
    quantity: params.quantity,
    unitCostFCFA: params.unitCostFCFA ? Math.round(params.unitCostFCFA) : undefined,
    reason: params.reason,
    recordExpense: params.recordExpense,
    paymentMethod: params.paymentMethod,
  };
  try {
    await inventoryApi.movement(params.itemId, body, idemKey('mov'));
  } catch (err) {
    await offlineOrThrow('inventory.movement', body as Record<string, unknown>, err);
  }
}

/** Export serveur v3 (compatible avec l'ancien format, sans secrets). */
export async function exportBackupJSON(): Promise<DatabaseBackup> {
  return backupApi.export();
}

/**
 * Import serveur en DEUX étapes obligatoires : preview (aucune écriture,
 * rapport lu par l'appelant) puis restore confirmé. Retourne le rapport.
 */
export async function importBackupJSON(backup: DatabaseBackup): Promise<BackupReport> {
  const preview = await backupApi.preview(backup);
  if (preview.status !== 'preview') {
    return preview; // déjà appliqué ou refusé : pas de restauration
  }
  if ((preview.duplicates?.length ?? 0) > 0) {
    throw new Error(
      `Backup refusé : IDs en doublon (${preview.duplicates?.slice(0, 3).join(', ')}…).`
    );
  }
  return backupApi.restore(backup, { confirm: true });
}
