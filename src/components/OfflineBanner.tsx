import React from 'react';
import { AlertTriangle, CloudOff, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { isApiError, syncApi } from '../services/api';
import { discardOperation, listConflicts, retryConflict } from '../services/offline/outbox';

interface OfflineBannerProps {
  /** État sync (Prompt 09) : file d'attente + conflits + dernière synchro. */
  pending?: number;
  conflicts?: number;
  lastSyncAt?: string;
  syncing?: boolean;
  onSync?: () => void;
}

/**
 * Bannière d'état hors-ligne : données locales en lecture quand le serveur
 * est injoignable + file d'attente, conflits et reprise manuelle.
 */
export const OfflineBanner: React.FC<OfflineBannerProps> = ({
  pending = 0,
  conflicts = 0,
  lastSyncAt,
  syncing = false,
  onSync,
}) => {
  const isOnline = useOnlineStatus();
  const [conflictsOpen, setConflictsOpen] = React.useState(false);
  const [conflictList, setConflictList] = React.useState<
    Array<{ operationId: string; type: string; errorCode: string; message: string }>
  >([]);

  const openConflicts = async () => {
    const list = await listConflicts();
    setConflictList(
      list.map((c) => ({
        operationId: c.operationId,
        type: c.type,
        errorCode: c.errorCode,
        message: c.message,
      }))
    );
    setConflictsOpen(true);
  };

  const resolveConflict = async (operationId: string, errorCode: string) => {
    if (errorCode === 'pricing_changed') {
      // l'opérateur confirme les nouveaux tarifs serveur → reprise
      await retryConflict(operationId, true);
    } else if (errorCode === 'client_merged') {
      await retryConflict(operationId);
    } else {
      const ok = window.confirm(
        'Relancer cette opération en l’état ? (les règles serveur la revalideront)'
      );
      if (ok) await retryConflict(operationId);
      else return;
    }
    setConflictsOpen(false);
    onSync?.();
  };

  if (!isOnline) {
    return (
      <div
        className="no-print fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-900 shadow-sm"
        role="status"
      >
        <WifiOff className="h-3.5 w-3.5 text-amber-700" />
        <span>
          Mode hors connexion{pending > 0 ? ` · ${pending} opération(s) en attente de synchronisation` : ''}
          {lastSyncAt ? ` · dernière synchro ${new Date(lastSyncAt).toLocaleTimeString('fr-FR')}` : ''}
        </span>
      </div>
    );
  }

  if (pending === 0 && conflicts === 0 && !syncing) return null;

  return (
    <>
      <div
        className="no-print fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-teal-300 bg-teal-50 px-3.5 py-2 text-xs font-medium text-teal-900 shadow-sm"
        role="status"
      >
        {syncing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-700" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5 text-teal-700" />
        )}
        <span>
          {syncing
            ? 'Synchronisation…'
            : `${pending} opération(s) en attente${conflicts > 0 ? ` · ${conflicts} conflit(s)` : ''}`}
        </span>
        {conflicts > 0 && (
          <button
            type="button"
            onClick={openConflicts}
            className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 cursor-pointer"
          >
            Résoudre
          </button>
        )}
        {!syncing && onSync && (
          <button
            type="button"
            onClick={onSync}
            className="rounded border border-teal-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-teal-900 hover:bg-teal-100 cursor-pointer"
          >
            Synchroniser
          </button>
        )}
        {lastSyncAt && !syncing && (
          <span className="text-teal-700/80">{new Date(lastSyncAt).toLocaleTimeString('fr-FR')}</span>
        )}
      </div>

      {conflictsOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 space-y-3 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h2 className="text-sm font-semibold text-slate-900">
                Conflits de synchronisation
              </h2>
            </div>
            {conflictList.length === 0 && (
              <p className="text-xs text-slate-500">Aucun conflit en attente.</p>
            )}
            {conflictList.map((c) => (
              <div key={c.operationId} className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="text-xs font-semibold text-slate-900">
                  {c.type === 'order.create'
                    ? 'Dépôt hors ligne'
                    : c.type === 'order.payment'
                      ? 'Paiement'
                      : c.type === 'client.create'
                        ? 'Client'
                        : c.type}{' '}
                  — <span className="font-mono">{c.errorCode}</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{c.message}</p>
                {c.errorCode === 'pricing_changed' && (
                  <p className="text-[11px] text-amber-800">
                    Les tarifs ont changé pendant l&apos;absence de réseau. La création
                    appliquera les tarifs actuels du serveur après confirmation.
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => resolveConflict(c.operationId, c.errorCode)}
                    className="rounded-lg bg-teal-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-teal-800 cursor-pointer"
                  >
                    {c.errorCode === 'pricing_changed' ? 'Accepter les nouveaux tarifs' : 'Relancer'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (window.confirm('Abandonner définitivement cette opération ?')) {
                        await discardOperation(c.operationId);
                        setConflictsOpen(false);
                        onSync?.();
                      }
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Abandonner
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setConflictsOpen(false)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Fermer
            </button>
          </div>
        </div>
      )}
      {/* CloudOff import conservé pour l'icône du statut (tree-shaking) */}
      <span className="hidden"><CloudOff className="h-3 w-3" /></span>
    </>
  );
};

// Vérification joignabilité réelle (au-delà de navigator.onLine) : status sync.
export async function checkServerReachable(): Promise<boolean> {
  try {
    await syncApi.status();
    return true;
  } catch (err) {
    if (isApiError(err) && err.status < 500) return true;
    return false;
  }
}
