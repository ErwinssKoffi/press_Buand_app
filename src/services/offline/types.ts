/**
 * Types de la file d'attente offline (Prompt 09). Stockés dans IndexedDB
 * (store `outbox`, `conflicts`, `reconciliations`) — survit au rechargement.
 */

export type OutboxStatus = 'pending' | 'sending' | 'conflict' | 'failed' | 'synced';

export type OfflineOpType =
  | 'client.create'
  | 'order.create'
  | 'order.payment'
  | 'expense.create'
  | 'inventory.movement'
  | 'logistics.save';

/** Opération hors ligne : persistée AVANT toute tentative d'envoi. */
export interface OutboxOperation {
  /** UUID v4 distinct par opération (= operationId serveur, clé d'idempotence). */
  operationId: string;
  type: OfflineOpType;
  payload: Record<string, unknown>;
  /** Références provisoires embarquées : rôle → ID provisoire (ex. orderId). */
  provisionalRefs?: Record<string, string>;
  /** Référence provisoire affichée (ticket local) pour les commandes. */
  provisionalTicket?: string;
  /** OperationId dont cette opération dépend (client avant commande…). */
  dependsOn?: string;
  localCreatedAt: string;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  /** Conflit pricing_changed confirmé par l'opérateur (reprise manuelle). */
  acceptPricing?: boolean;
}

export interface ConflictRecord {
  operationId: string;
  type: OfflineOpType;
  errorCode: string;
  message: string;
  /** Proposition serveur (ex. recalcul des tarifs). */
  entity?: Record<string, unknown>;
  occurredAt: string;
}

/** Réconciliation ID provisoire → officiel après sync acceptée. */
export interface Reconciliation {
  /** ID provisoire de la commande (= operationId order.create). */
  provisionalId: string;
  officialId: string;
  officialTicket: string;
  reconciledAt: string;
}
