/**
 * Tests du client API (Prompt 08 — « tests du client API et des erreurs HTTP »).
 * Exécution : bun test tests/
 * fetch est mocké : aucune requête réseau réelle.
 */
import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import { ApiError, apiRequest, isApiError, isOfflineError } from '../src/services/api/http';

const realFetch = globalThis.fetch;

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = impl as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  mock.restore();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('apiRequest', () => {
  it('parse le JSON d’une réponse 200', async () => {
    mockFetch(() => Promise.resolve(jsonResponse(200, { items: [1, 2], total: 2 })));
    const out = await apiRequest<{ items: number[]; total: number }>('/api/v1/orders');
    expect(out.total).toBe(2);
    expect(out.items).toEqual([1, 2]);
  });

  it('retourne undefined sur 204 (setup, logout)', async () => {
    mockFetch(() => Promise.resolve(new Response(null, { status: 204 })));
    const out = await apiRequest<void>('/auth/logout', { method: 'POST' });
    expect(out).toBeUndefined();
  });

  it('normalise les erreurs contrat {error:{code,message}} en ApiError', async () => {
    mockFetch(() =>
      Promise.resolve(
        jsonResponse(422, {
          error: { code: 'business_rule', message: 'backup invalide (contenu): version 2 attendue 3' },
        })
      )
    );
    try {
      await apiRequest('/api/v1/backup/preview', { method: 'POST', body: { version: 2 } });
      expect.unreachable();
    } catch (err) {
      expect(isApiError(err)).toBe(true);
      const e = err as ApiError;
      expect(e.status).toBe(422);
      expect(e.code).toBe('business_rule');
      expect(e.message).toContain('version 2');
    }
  });

  it('expose un code générique si le corps d’erreur est illisible', async () => {
    mockFetch(() => Promise.resolve(new Response('<html>gateway</html>', { status: 502 })));
    try {
      await apiRequest('/api/v1/orders');
      expect.unreachable();
    } catch (err) {
      expect(isApiError(err)).toBe(true);
      expect((err as ApiError).status).toBe(502);
      expect((err as ApiError).code).toBe('http_error');
    }
  });

  it('convertit une erreur réseau en OfflineError', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    try {
      await apiRequest('/api/v1/bootstrap');
      expect.unreachable();
    } catch (err) {
      expect(isOfflineError(err)).toBe(true);
      expect(isApiError(err)).toBe(false);
    }
  });

  it('convertit un timeout (AbortError) en OfflineError', async () => {
    mockFetch((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          reject(e);
        });
      })
    );
    try {
      await apiRequest('/api/v1/orders', { timeoutMs: 10 });
      expect.unreachable();
    } catch (err) {
      expect(isOfflineError(err)).toBe(true);
    }
  });

  it('envoie Idempotency-Key, Content-Type et credentials include', async () => {
    let captured: RequestInit | undefined;
    mockFetch((_input, init) => {
      captured = init;
      return Promise.resolve(jsonResponse(201, { id: 'ord-1' }));
    });
    await apiRequest('/api/v1/orders', {
      method: 'POST',
      body: { items: [] },
      idempotencyKey: 'ord-test-123',
    });
    const headers = captured?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('ord-test-123');
    expect(headers['Content-Type']).toBe('application/json');
    expect((captured?.credentials as string) ?? 'same-origin').toBe('include');
    expect(captured?.body).toContain('"items":[]');
  });

  it('transmet les en-têtes additionnels (X-Backup-Confirm) et le corps brut du backup', async () => {
    let captured: RequestInit | undefined;
    mockFetch((_input, init) => {
      captured = init;
      return Promise.resolve(jsonResponse(200, { status: 'restauré' }));
    });
    const backup = { version: 3, settings: { shopName: 'X' } };
    await apiRequest('/api/v1/backup/restore', {
      method: 'POST',
      body: backup,
      headers: { 'X-Backup-Confirm': 'true' },
    });
    const headers = captured?.headers as Record<string, string>;
    expect(headers['X-Backup-Confirm']).toBe('true');
    expect((captured?.body as string)).toContain('"version":3');
  });

  it('préfixe la base API configurée (VITE_API_BASE_URL)', async () => {
    let capturedPath = '';
    mockFetch((input) => {
      capturedPath = String(input);
      return Promise.resolve(jsonResponse(200, {}));
    });
    await apiRequest('/api/v1/settings');
    expect(capturedPath).toBe('/api/v1/settings'); // base '' par défaut (same-origin)
  });
});
