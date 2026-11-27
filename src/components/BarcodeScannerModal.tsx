import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Camera,
  CameraOff,
  CheckCircle2,
  Printer,
  RotateCcw,
  ScanBarcode,
  Search,
  X,
} from 'lucide-react';
import { PressingOrder } from '../types/pressing';
import { formatDateFR, formatFCFA, STATUS_META } from '../utils/formatters';

interface BarcodeScannerModalProps {
  orders: PressingOrder[];
  onClose: () => void;
  onSelectOrder: (order: PressingOrder) => void;
  onAdvanceStatus: (orderId: string) => Promise<void>;
}

interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  orders,
  onClose,
  onSelectOrder,
  onAdvanceStatus,
}) => {
  const [query, setQuery] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [advancing, setAdvancing] = useState(false);
  const [lastAdvancedId, setLastAdvancedId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setCameraError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        "L'accès caméra n'est pas disponible sur ce navigateur. Utilisez une douchette USB ou la saisie directe."
      );
      return;
    }
    if (!('BarcodeDetector' in window) || !window.BarcodeDetector) {
      setCameraError(
        "La détection caméra native (BarcodeDetector) n'est pas supportée par ce navigateur. Branchez une douchette USB ou saisissez le numéro du ticket."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraActive(true);

      const detector = new window.BarcodeDetector({
        formats: ['code_128', 'code_39', 'qr_code', 'ean_13'],
      });

      const scanLoop = async () => {
        if (!videoRef.current || !streamRef.current) return;
        if (videoRef.current.readyState >= 2) {
          try {
            const codes = await detector.detect(videoRef.current);
            const hit = codes.find((c) => c.rawValue && c.rawValue.trim().length > 0);
            if (hit?.rawValue) {
              setQuery(hit.rawValue.trim());
              setLastAdvancedId(null);
              stopCamera();
              return;
            }
          } catch {
            // Continue scanning
          }
        }
        rafRef.current = requestAnimationFrame(scanLoop);
      };

      setTimeout(() => {
        if (videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
          videoRef.current.play().catch(() => {});
          rafRef.current = requestAnimationFrame(scanLoop);
        }
      }, 60);
    } catch {
      setCameraError(
        "Autorisation caméra refusée ou caméra introuvable. Utilisez la douchette USB ou la saisie du N° de ticket."
      );
      stopCamera();
    }
  };

  const matchedOrders = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean) return [];
    const exact = orders.filter((o) => o.ticketNumber.toLowerCase() === clean);
    if (exact.length > 0) return exact;
    return orders.filter(
      (o) =>
        o.ticketNumber.toLowerCase().includes(clean) ||
        o.clientName.toLowerCase().includes(clean) ||
        o.rackSlot.toLowerCase() === clean
    );
  }, [orders, query]);

  const primaryOrder = matchedOrders.length > 0 ? matchedOrders[0] : null;
  const primaryStatus = primaryOrder ? STATUS_META[primaryOrder.status] : null;
  const primaryRemaining = primaryOrder
    ? Math.max(0, primaryOrder.totalFCFA - primaryOrder.paidFCFA)
    : 0;

  const handleAdvance = async (orderId: string) => {
    setAdvancing(true);
    try {
      await onAdvanceStatus(orderId);
      setLastAdvancedId(orderId);
    } finally {
      setAdvancing(false);
    }
  };

  const handleResetScan = () => {
    setQuery('');
    setLastAdvancedId(null);
    inputRef.current?.focus();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scanner-modal-title"
    >
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl my-auto">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <ScanBarcode className="h-5 w-5 text-teal-700" />
            <div>
              <h3 id="scanner-modal-title" className="text-sm font-semibold text-slate-900">
                Suivi atelier · Scanner code-barres / ticket
              </h3>
              <p className="text-xs text-slate-500">
                Douchette USB (saisie directe), caméra ou recherche par les 4 derniers chiffres
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Scanner Input + Camera Toggle */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLastAdvancedId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && primaryOrder && primaryStatus?.nextStatus) {
                    e.preventDefault();
                    handleAdvance(primaryOrder.id);
                  }
                }}
                placeholder="Scannez le code-barres ou tapez 0048, EP-2026-0048..."
                className="w-full rounded-lg border border-slate-300 bg-slate-50 pl-9 pr-9 py-2.5 font-mono text-sm text-slate-900 focus:bg-white focus:border-teal-600 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={handleResetScan}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  title="Effacer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={cameraActive ? stopCamera : startCamera}
              className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                cameraActive
                  ? 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {cameraActive ? (
                <>
                  <CameraOff className="h-4 w-4" />
                  <span>Arrêter caméra</span>
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4 text-teal-700" />
                  <span>Scanner par caméra</span>
                </>
              )}
            </button>
          </div>

          {cameraError && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
              {cameraError}
            </div>
          )}

          {cameraActive && (
            <div className="overflow-hidden rounded-lg border border-slate-300 bg-slate-950 relative">
              <video
                ref={videoRef}
                muted
                playsInline
                className="w-full max-h-56 object-cover"
              />
              <div className="bg-slate-900 px-3 py-1.5 text-[11px] text-slate-300 text-center">
                Placez le code-barres du ticket face à l&apos;objectif...
              </div>
            </div>
          )}

          {/* Result Area */}
          {!query.trim() ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center space-y-2">
              <ScanBarcode className="mx-auto h-7 w-7 text-slate-400" />
              <div className="text-xs font-medium text-slate-700">
                Prêt pour la lecture atelier
              </div>
              <p className="text-[11px] text-slate-500">
                Pointez la douchette sur la souche atelier du cintre pour faire passer instantanément
                le ticket à l&apos;étape suivante (Lavage → Repassage → Prêt → Livré).
              </p>
            </div>
          ) : !primaryOrder ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-600">
              Aucun ticket trouvé pour <span className="font-mono font-semibold">{query}</span>.
            </div>
          ) : (
            <div className="space-y-4">
              {lastAdvancedId === primaryOrder.id && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-medium text-emerald-900">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
                  <span>
                    Statut mis à jour : <strong>{primaryStatus?.shortLabel}</strong>
                  </span>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-base font-bold text-slate-900 tabular-nums">
                        {primaryOrder.ticketNumber}
                      </span>
                      {primaryStatus && (
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${primaryStatus.bgClass} ${primaryStatus.textClass} ${primaryStatus.borderClass}`}
                        >
                          {primaryStatus.shortLabel}
                        </span>
                      )}
                      {primaryOrder.isExpress && (
                        <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                          EXPRESS
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs font-medium text-slate-800">
                      {primaryOrder.clientName} ·{' '}
                      <span className="font-mono text-slate-600">{primaryOrder.clientPhone}</span>
                    </div>
                  </div>

                  <div className="text-right font-mono tabular-nums">
                    <div className="text-[11px] text-slate-500">Casier / Cintre</div>
                    <div className="text-sm font-bold text-slate-900">
                      {primaryOrder.rackSlot || 'Comptoir'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 border-y border-slate-200 py-2.5 text-xs">
                  <div>
                    <div className="text-[11px] text-slate-500">Retrait prévu</div>
                    <div className="font-mono font-semibold text-slate-900 tabular-nums">
                      {formatDateFR(primaryOrder.dueDate)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Total ticket</div>
                    <div className="font-mono font-semibold text-slate-900 tabular-nums">
                      {formatFCFA(primaryOrder.totalFCFA)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Reste à régler</div>
                    <div
                      className={`font-mono font-bold tabular-nums ${
                        primaryRemaining > 0 ? 'text-amber-800' : 'text-emerald-700'
                      }`}
                    >
                      {primaryRemaining > 0 ? formatFCFA(primaryRemaining) : 'Soldé'}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-slate-600">
                  {primaryOrder.items.map((it) => `${it.quantity}× ${it.name}`).join(' · ')}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        stopCamera();
                        onSelectOrder(primaryOrder);
                        onClose();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      <span>Ouvrir le reçu</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleResetScan}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Ticket suivant</span>
                    </button>
                  </div>

                  {primaryStatus?.nextStatus && (
                    <button
                      type="button"
                      disabled={advancing}
                      onClick={() => handleAdvance(primaryOrder.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
                    >
                      <span>{primaryStatus.nextActionLabel}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {matchedOrders.length > 1 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-slate-500">
                    Autres correspondances ({matchedOrders.length - 1}) :
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {matchedOrders.slice(1, 5).map((alt) => (
                      <button
                        key={alt.id}
                        type="button"
                        onClick={() => setQuery(alt.ticketNumber)}
                        className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs hover:border-teal-600 cursor-pointer"
                      >
                        <div>
                          <div className="font-mono font-semibold text-slate-900">
                            {alt.ticketNumber}
                          </div>
                          <div className="text-[11px] text-slate-500">{alt.clientName}</div>
                        </div>
                        <span className="text-[11px] font-medium text-teal-800">
                          {STATUS_META[alt.status].shortLabel}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
