/**
 * Client HTTP centralisé du backend Go (Prompt 08).
 *
 * - Base URL configurable via VITE_API_BASE_URL (défaut '' = same-origin :
 *   proxy Vite en développement, same-origin en production).
 * - Session par cookie httpOnly `eclat_session` (credentials: 'include') —
 *   aucun token en localStorage, aucun secret côté navigateur.
 * - Erreurs normalisées en ApiError {status, code, message, details}
 *   conformes au contrat {error:{code,message,details}}.
 * - Timeout + X-Request-ID sur chaque requête.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Erreur réseau (serveur injoignable / hors-ligne). */
export class OfflineError extends Error {
  constructor(origin = new Error()) {
    super('Backend injoignable — vérifiez la connexion au serveur.');
    this.name = 'OfflineError';
    this.cause = origin;
  }
}

export function isOfflineError(err: unknown): boolean {
  return err instanceof OfflineError;
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export const API_BASE_URL: string = (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? '';

const DEFAULT_TIMEOUT_MS = 15000;
const LONG_TIMEOUT_MS = 120000; // export/import de sauvegarde

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Clé d'idempotence (Idempotency-Key ; ou X-Idempotency-Body selon la route). */
  idempotencyKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** En-têtes additionnels (ex. X-Backup-Confirm). */
  headers?: Record<string, string>;
}

function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Requête API typée : parse JSON, lève ApiError/OfflineError. */
export async function apiRequest<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, idempotencyKey, headers, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onOuterAbort);

  try {
    const h: Record<string, string> = {
      'X-Request-ID': requestId(),
      ...headers,
    };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;

    const resp = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: h,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (resp.status === 204) return undefined as T;

    const text = await resp.text();
    let payload: unknown = undefined;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = undefined;
      }
    }

    if (!resp.ok) {
      const envelope = payload as { error?: { code?: string; message?: string; details?: unknown } } | undefined;
      throw new ApiError(
        resp.status,
        envelope?.error?.code ?? 'http_error',
        envelope?.error?.message ?? `Erreur HTTP ${resp.status}.`,
        envelope?.error?.details
      );
    }
    return payload as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new OfflineError(err);
    }
    throw new OfflineError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}

export { LONG_TIMEOUT_MS };
