/**
 * Modules API par domaine (Prompt 08 §2) — sources des DTO :
 * docs/migration/openapi.yaml + backend/internal/domain/pressing/types.go.
 * Aucune interface dupliquée : les entités réutilisent src/types/pressing.ts.
 */
import { apiRequest, LONG_TIMEOUT_MS } from './http';

export { ApiError, OfflineError, isApiError, isOfflineError, API_BASE_URL } from './http';

import type {
  CatalogItem,
  Client,
  ClientWalletEntry,
  DatabaseBackup,
  DeliveryZone,
  ExpenseRecord,
  InventoryItem,
  InventoryMovement,
  InventoryMovementType,
  LogisticsStatus,
  LogisticsTask,
  PaymentMethod,
  PaymentRecord,
  PressingOrder,
  PressingSettings,
} from '../../types/pressing';

// ---------- Auth ----------
export type AuthState = 'virgin' | 'legacy' | 'argon2id';

export interface AuthStatusPayload {
  state: AuthState;
}

export interface SessionPayload {
  authenticated: boolean;
  sessionExpiresAt?: string;
}

export const authApi = {
  /** État du secret opérateur (public) : virgin | legacy | argon2id. */
  status: () => apiRequest<AuthStatusPayload>('/auth/status'),
  /** Déverrouillage (cookie de session httpOnly). 401 = mauvais PIN, 423 = verrouillé. */
  login: (pinOrPassword: string) =>
    apiRequest<SessionPayload>('/auth/login', {
      method: 'POST',
      body: { pinOrPassword },
    }),
  /** Première configuration du secret (204). 409 si déjà configuré. */
  setup: (secret: string) =>
    apiRequest<void>('/auth/setup', { method: 'POST', body: { secret } }),
  /** Changement de PIN (session requise). */
  changePin: (currentSecret: string, newSecret: string) =>
    apiRequest<void>('/auth/change-pin', {
      method: 'POST',
      body: { currentSecret, newSecret },
    }),
  logout: () => apiRequest<void>('/auth/logout', { method: 'POST' }),
  me: () => apiRequest<SessionPayload>('/auth/me'),
};

// ---------- Bootstrap ----------
export interface BootstrapPayload {
  settings: PressingSettings;
  catalog: CatalogItem[];
  clients: ServerClient[];
  orders: ServerOrder[];
  payments: ServerPayment[];
  expenses: ExpenseRecord[];
  zones: DeliveryZone[];
  logistics: LogisticsTask[];
  inventory: InventoryItem[];
  inventoryMovements: InventoryMovement[];
  sync: { cursor: number; serverTime: string };
}

export const bootstrapApi = {
  get: (windowDays?: number) =>
    apiRequest<BootstrapPayload>(
      `/api/v1/bootstrap${windowDays ? `?windowDays=${windowDays}` : ''}`
    ),
};

// ---------- Settings ----------
export const settingsApi = {
  get: () => apiRequest<PressingSettings>('/api/v1/settings'),
  update: (settings: PressingSettings) =>
    apiRequest<PressingSettings>('/api/v1/settings', { method: 'PUT', body: settings }),
};

// ---------- Catalogue ----------
export const catalogApi = {
  list: () => apiRequest<CatalogItem[]>('/api/v1/catalog'),
  save: (item: CatalogItem) =>
    item.id
      ? apiRequest<CatalogItem>(`/api/v1/catalog/${encodeURIComponent(item.id)}`, {
          method: 'PUT',
          body: item,
        })
      : apiRequest<CatalogItem>('/api/v1/catalog', { method: 'POST', body: item }),
  /** Désactivation (jamais de suppression dure côté serveur). */
  remove: (id: string) =>
    apiRequest<void>(`/api/v1/catalog/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// ---------- Clients ----------
export interface ClientListPayload {
  items: ServerClient[];
  total: number;
  page: number;
  pageSize: number;
}

export const clientsApi = {
  list: (q = '', page = 1, pageSize = 200) =>
    apiRequest<ClientListPayload>(
      `/api/v1/clients?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`
    ),
  get: (id: string) => apiRequest<ServerClient>(`/api/v1/clients/${encodeURIComponent(id)}`),
  save: (client: Client) =>
    client.id
      ? apiRequest<ServerClient>(`/api/v1/clients/${encodeURIComponent(client.id)}`, {
          method: 'PUT',
          body: client,
        })
      : apiRequest<ServerClient>('/api/v1/clients', { method: 'POST', body: client }),
  /** Archivage (soft delete). */
  remove: (id: string) =>
    apiRequest<void>(`/api/v1/clients/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  topUp: (
    id: string,
    params: {
      amountFCFA: number;
      bonusFCFA?: number;
      method: PaymentMethod;
      subscriptionLabel?: string;
      subscriptionExpiresAt?: string;
      note?: string;
    },
    idempotencyKey: string
  ) =>
    apiRequest<ServerClient>(`/api/v1/clients/${encodeURIComponent(id)}/wallet/topups`, {
      method: 'POST',
      body: params,
      idempotencyKey,
    }),
};

// ---------- Commandes ----------
export interface OrderLinePayload {
  catalogItemId?: string;
  name: string;
  mode: string;
  quantity: number;
  unit: string;
  unitPriceFCFA?: number;
  note?: string;
  activityType?: string;
  pricingBasis?: string;
  piecesPerUnit?: number;
  weightKg?: number;
  isExpress?: boolean;
  expressFeeFCFA?: number;
  expressDueDate?: string;
}

export interface CreateOrderPayload {
  clientId?: string | null;
  newClient?: Client | null;
  clientName?: string;
  clientPhone?: string;
  commune?: string;
  rackSlot?: string;
  items: OrderLinePayload[];
  isExpress?: boolean;
  deliveryZoneId?: string | null;
  deliveryFeeFCFA?: number;
  discountFCFA?: number;
  usePrepaid?: boolean;
  prepaidAmountFCFA?: number;
  loyaltyPointsRedeemed?: number;
  initialPaymentMethod: PaymentMethod;
  initialCashPaidFCFA?: number | null;
  dropOffDate?: string;
  dueDate?: string | null;
  notes?: string;
  claimPhotos?: Array<{ id: string; caption: string; itemName?: string; capturedAt: string; url: string }>;
}

export interface OrderListPayload {
  items: ServerOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MappingResult {
  order: ServerOrder;
  actualPrepaidUsedFCFA: number;
  cashDueFCFA: number;
  cashPaidFCFA: number;
  loyaltyDiscountFCFA?: number;
}

export const ordersApi = {
  list: (params: { status?: string; clientId?: string; q?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') search.set(k, String(v));
    });
    return apiRequest<OrderListPayload>(`/api/v1/orders?${search.toString()}`);
  },
  get: (id: string) => apiRequest<ServerOrder>(`/api/v1/orders/${encodeURIComponent(id)}`),
  /** Aperçu de prix AUTORITAIRE (le serveur recalcule tout) — sans écriture. */
  mapping: (payload: CreateOrderPayload) =>
    apiRequest<MappingResult>('/api/v1/orders/mapping', { method: 'POST', body: payload }),
  /** Création idempotente : la commande renvoyée fait foi (montants serveur). */
  create: (payload: CreateOrderPayload, idempotencyKey: string) =>
    apiRequest<ServerOrder>('/api/v1/orders', {
      method: 'POST',
      body: payload,
      idempotencyKey,
      timeoutMs: LONG_TIMEOUT_MS,
    }),
  updateStatus: (id: string, status: string) =>
    apiRequest<ServerOrder>(`/api/v1/orders/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: { status },
    }),
  addPayment: (id: string, params: { amountFCFA: number; method: PaymentMethod }, idempotencyKey: string) =>
    apiRequest<ServerOrder>(`/api/v1/orders/${encodeURIComponent(id)}/payments`, {
      method: 'POST',
      body: params,
      idempotencyKey,
    }),
  /** Annulation non destructive (remplace la suppression locale). */
  void: (id: string, reason: string) =>
    apiRequest<ServerOrder>(`/api/v1/orders/${encodeURIComponent(id)}/void`, {
      method: 'POST',
      body: { reason },
    }),
  payments: (id: string) =>
    apiRequest<ServerPayment[]>(`/api/v1/orders/${encodeURIComponent(id)}/payments`),
};

// ---------- Dépenses ----------
export const expensesApi = {
  list: (from = '', to = '', page = 1, pageSize = 500) =>
    apiRequest<{ items: ExpenseRecord[]; total: number; page: number; pageSize: number }>(
      `/api/v1/expenses?from=${from}&to=${to}&page=${page}&pageSize=${pageSize}`
    ),
  create: (expense: ExpenseRecord) =>
    apiRequest<ExpenseRecord>('/api/v1/expenses', { method: 'POST', body: expense }),
  remove: (id: string) =>
    apiRequest<void>(`/api/v1/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// ---------- Rapports ----------
export const reportsApi = {
  dailyZ: (date?: string) =>
    apiRequest<Record<string, unknown>>(`/api/v1/reports/daily-z${date ? `?date=${date}` : ''}`),
  monthly: (month?: string) =>
    apiRequest<Record<string, unknown>>(`/api/v1/reports/monthly${month ? `?month=${month}` : ''}`),
};

// ---------- Zones ----------
export const zonesApi = {
  list: () => apiRequest<DeliveryZone[]>('/api/v1/delivery-zones'),
  save: (zone: DeliveryZone) =>
    zone.id
      ? apiRequest<DeliveryZone>(`/api/v1/delivery-zones/${encodeURIComponent(zone.id)}`, {
          method: 'PUT',
          body: zone,
        })
      : apiRequest<DeliveryZone>('/api/v1/delivery-zones', { method: 'POST', body: zone }),
  remove: (id: string) =>
    apiRequest<void>(`/api/v1/delivery-zones/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// ---------- Logistique ----------
export const logisticsApi = {
  list: (type = '', status = '', from = '') =>
    apiRequest<LogisticsTask[]>(`/api/v1/logistics?type=${type}&status=${status}&from=${from}`),
  save: (task: LogisticsTask) =>
    apiRequest<LogisticsTask>('/api/v1/logistics', { method: 'POST', body: task }),
  updateStatus: (id: string, status: LogisticsStatus) =>
    apiRequest<LogisticsTask>(`/api/v1/logistics/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: { status },
    }),
  remove: (id: string) =>
    apiRequest<void>(`/api/v1/logistics/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// ---------- Stocks ----------
export const inventoryApi = {
  list: () => apiRequest<InventoryItem[]>('/api/v1/inventory'),
  save: (item: InventoryItem) =>
    item.id
      ? apiRequest<InventoryItem>(`/api/v1/inventory/${encodeURIComponent(item.id)}`, {
          method: 'PUT',
          body: item,
        })
      : apiRequest<InventoryItem>('/api/v1/inventory', { method: 'POST', body: item }),
  remove: (id: string) =>
    apiRequest<void>(`/api/v1/inventory/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  movements: (id: string, limit = 500) =>
    apiRequest<InventoryMovement[]>(
      `/api/v1/inventory/${encodeURIComponent(id)}/movements?limit=${limit}`
    ),
  movement: (
    id: string,
    params: {
      type: InventoryMovementType;
      quantity: number;
      unitCostFCFA?: number;
      reason: string;
      recordExpense?: boolean;
      paymentMethod?: PaymentMethod;
    },
    idempotencyKey: string
  ) =>
    apiRequest<{ item: InventoryItem; movement: InventoryMovement }>(
      `/api/v1/inventory/${encodeURIComponent(id)}/movements`,
      { method: 'POST', body: params, idempotencyKey }
    ),
};

// ---------- Sauvegarde ----------
export const backupApi = {
  /** Export JSON compatible v3 (jamais de secret : pin_hash/pin_salt exclus). */
  export: () =>
    apiRequest<DatabaseBackup>('/api/v1/backup/export', { timeoutMs: LONG_TIMEOUT_MS }),
  /** Validation complète sans aucune écriture. */
  preview: (backup: DatabaseBackup) =>
    apiRequest<BackupReport>('/api/v1/backup/preview', {
      method: 'POST',
      body: backup,
      timeoutMs: LONG_TIMEOUT_MS,
    }),
  /** Restauration atomique : requiert confirm:true (deux étapes). */
  restore: (backup: DatabaseBackup, options: { confirm: boolean; force?: boolean }) =>
    apiRequest<BackupReport>('/api/v1/backup/restore', {
      method: 'POST',
      body: backup,
      timeoutMs: LONG_TIMEOUT_MS,
      headers: {
        'X-Backup-Confirm': options.confirm ? 'true' : 'false',
        ...(options.force ? { 'X-Backup-Force': 'true' } : {}),
      },
    }),
};

export interface BackupReport {
  hash: string;
  status: 'preview' | 'déjà appliqué' | 'restauré' | 'échec';
  exportedAt?: string;
  source?: Record<string, number>;
  created?: Record<string, number>;
  updated?: Record<string, number>;
  duplicates?: string[];
  anomalies?: string[];
  incompatibilities?: string[];
  photosImported?: number;
  photosSkipped?: number;
  pinLegacyImported?: boolean;
  serverBackup?: string;
  errors?: string[];
  startedAt?: string;
  finishedAt?: string;
}

// ---------- Formes serveur brutes (nullables) ----------
/** Entités telles que renvoyées par Go : champs optionnels = null. */
export interface ServerClient {
  id: string;
  fullName: string;
  phone: string;
  commune: string;
  addressNote: string | null;
  createdAt: string;
  loyaltyPoints: number | null;
  prepaidBalanceFCFA: number | null;
  subscriptionLabel: string | null;
  subscriptionExpiresAt: string | null;
  walletHistory?: ClientWalletEntry[];
}

export interface ServerPhotoDTO {
  id: string;
  caption: string;
  itemName: string | null;
  capturedAt: string;
  url: string;
}

export type ServerOrder = Omit<
  PressingOrder,
  'clientId' | 'dueDate' | 'notes' | 'claimPhotos'
> & {
  clientId: string | null;
  dueDate: string | null;
  notes: string | null;
  subtotalFCFA?: number;
  voidedAt?: string | null;
  voidReason?: string | null;
  claimPhotos?: ServerPhotoDTO[];
};

export type ServerPayment = Omit<PaymentRecord, 'orderId'> & {
  orderId: string | null;
  kind: 'order' | 'prepaid_topup';
};
