import React, { useEffect, useMemo, useState } from 'react';
import {
  Camera,
  Check,
  Copy,
  CreditCard,
  FileDown,
  FileText,
  Printer,
  Receipt,
  Scissors,
  X,
} from 'lucide-react';
import {
  IntakePhoto,
  PaymentMethod,
  PaymentRecord,
  PressingOrder,
  PressingSettings,
} from '../types/pressing';
import {
  buildWhatsAppMessage,
  formatDateFR,
  formatDateTimeFR,
  formatFCFA,
  formatWeightKg,
  PAYMENT_METHOD_LABELS,
  SERVICE_MODE_LABELS,
  STATUS_META,
} from '../utils/formatters';
import { exportReceiptPdf } from '../utils/receiptPdf';

interface TicketPrintModalProps {
  order: PressingOrder;
  orderPayments: PaymentRecord[];
  settings: PressingSettings;
  onClose: () => void;
  onRecordPayment: (orderId: string, amountFCFA: number, method: PaymentMethod) => Promise<void>;
  onAdvanceStatus: (orderId: string) => Promise<void>;
}

type ReceiptFormat = 'a5' | 'thermal';

const PAYMENT_TYPE_LABELS: Record<PaymentRecord['type'], string> = {
  acompte: 'Acompte',
  solde: 'Solde',
  integral: 'Intégral',
};

/** Deterministic minimalist SVG barcode derived from ticketNumber */
const TicketBarcode: React.FC<{ code: string; compact?: boolean }> = ({ code, compact }) => {
  const bars = useMemo(() => {
    const result: { x: number; w: number }[] = [];
    let x = 2;
    result.push({ x, w: 2 });
    x += 4;
    result.push({ x, w: 1 });
    x += 3;

    for (let i = 0; i < code.length; i++) {
      const ch = code.charCodeAt(i);
      const pattern = [(ch % 3) + 1, ((ch >> 2) % 2) + 1, ((ch >> 4) % 3) + 1];
      for (let j = 0; j < pattern.length; j++) {
        const w = pattern[j];
        if (j % 2 === 0) {
          result.push({ x, w });
        }
        x += w + 1.5;
      }
    }

    result.push({ x, w: 1 });
    x += 3;
    result.push({ x, w: 2 });
    x += 4;
    return { items: result, width: x };
  }, [code]);

  return (
    <div className="inline-flex flex-col items-center">
      <svg
        width={compact ? 120 : 156}
        height={compact ? 24 : 30}
        viewBox={`0 0 ${bars.width} 28`}
        className="text-slate-900"
        aria-hidden="true"
      >
        {bars.items.map((b, idx) => (
          <rect key={idx} x={b.x} y={0} width={b.w} height={28} fill="currentColor" />
        ))}
      </svg>
      <span className="mt-0.5 font-mono text-[10px] tracking-widest text-slate-600 tabular-nums">
        {code}
      </span>
    </div>
  );
};

export const TicketPrintModal: React.FC<TicketPrintModalProps> = ({
  order,
  orderPayments,
  settings,
  onClose,
  onRecordPayment,
  onAdvanceStatus,
}) => {
  const remaining = Math.max(0, order.totalFCFA - order.paidFCFA);
  const [format, setFormat] = useState<ReceiptFormat>('a5');
  const [payAmount, setPayAmount] = useState<string>(String(remaining));
  const [payMethod, setPayMethod] = useState<PaymentMethod>('especes');
  const [copiedWA, setCopiedWA] = useState(false);
  const [exportedPdf, setExportedPdf] = useState(false);
  const [savingPay, setSavingPay] = useState(false);
  const [zoomedPhoto, setZoomedPhoto] = useState<IntakePhoto | null>(null);

  useEffect(() => {
    setPayAmount(String(remaining));
  }, [remaining]);

  const statusInfo = STATUS_META[order.status];
  const articlesSubtotal = useMemo(
    () => order.items.reduce((sum, item) => sum + item.quantity * item.unitPriceFCFA, 0),
    [order.items]
  );
  const lineExpressSum = useMemo(
    () =>
      order.items.reduce(
        (sum, item) => sum + (item.isExpress ? item.expressFeeFCFA || 0 : 0),
        0
      ),
    [order.items]
  );
  const totalPieces = useMemo(
    () =>
      order.items.reduce(
        (sum, item) =>
          sum + (item.unit === 'kg' ? 0 : item.quantity * (item.piecesPerUnit || 1)),
        0
      ),
    [order.items]
  );
  const totalKg = useMemo(
    () =>
      order.items.reduce(
        (sum, item) =>
          sum +
          (item.weightKg
            ? item.quantity * item.weightKg
            : item.unit === 'kg'
            ? item.quantity
            : 0),
        0
      ),
    [order.items]
  );
  const expressLinesCount = useMemo(
    () => order.items.filter((i) => i.isExpress).length,
    [order.items]
  );
  const hasPerLineExpress = lineExpressSum > 0 || expressLinesCount > 0;

  const handlePrint = () => {
    window.print();
  };

  const handleExportPdf = () => {
    exportReceiptPdf(order, orderPayments, settings, format);
    setExportedPdf(true);
    setTimeout(() => setExportedPdf(false), 2500);
  };

  const handleCopyWhatsApp = async () => {
    const msg = buildWhatsAppMessage(order, settings);
    try {
      await navigator.clipboard.writeText(msg);
      setCopiedWA(true);
      setTimeout(() => setCopiedWA(false), 2500);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Math.round(Number(payAmount));
    if (!val || val <= 0) return;
    setSavingPay(true);
    try {
      await onRecordPayment(order.id, Math.min(val, remaining), payMethod);
    } finally {
      setSavingPay(false);
    }
  };

  const isPaidFull = remaining === 0;
  const documentTitle = isPaidFull ? 'REÇU SOLDÉ' : 'REÇU DE DÉPÔT';

  const volumeSummary = [
    totalPieces > 0 ? `${totalPieces} pièce${totalPieces > 1 ? 's' : ''}` : '',
    totalKg > 0 ? formatWeightKg(totalKg) : '',
  ]
    .filter(Boolean)
    .join(' + ');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 overflow-y-auto print:static print:bg-white print:p-0 print:overflow-visible"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ticket-modal-title"
    >
      <div
        className={`w-full ${
          format === 'a5' ? 'max-w-4xl' : 'max-w-2xl'
        } rounded-xl border border-slate-200 bg-white shadow-xl my-auto print:shadow-none print:border-0 print:max-w-full`}
      >
        {/* Top Modal Controls (hidden on print) */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-3.5 bg-slate-50/70 rounded-t-xl">
          <div className="flex items-center gap-3">
            <h3 id="ticket-modal-title" className="text-sm font-semibold text-slate-900">
              Aperçu du reçu · <span className="font-mono">{order.ticketNumber}</span>
            </h3>
            <div
              className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5"
              role="group"
              aria-label="Format d'impression"
            >
              <button
                type="button"
                onClick={() => setFormat('a5')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  format === 'a5'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Format A5 / A4</span>
              </button>
              <button
                type="button"
                onClick={() => setFormat('thermal')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  format === 'thermal'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Receipt className="h-3.5 w-3.5" />
                <span>Ticket 80mm</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyWhatsApp}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              {copiedWA ? (
                <Check className="h-3.5 w-3.5 text-emerald-700" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copiedWA ? 'Message copié' : 'Message WhatsApp'}</span>
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              {exportedPdf ? (
                <Check className="h-3.5 w-3.5 text-emerald-700" />
              ) : (
                <FileDown className="h-3.5 w-3.5 text-teal-700" />
              )}
              <span>{exportedPdf ? 'PDF téléchargé' : 'Exporter PDF'}</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer whitespace-nowrap"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Imprimer</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 cursor-pointer"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Printable Document Canvas */}
        <div className="p-6 bg-slate-100/60 print:bg-white print:p-0 flex justify-center">
          {format === 'a5' ? (
            /* ======================== FORMAT A5 / A4 PROFESSIONNEL ======================== */
            <div className="print-sheet w-full bg-white border border-slate-300 rounded-lg p-7 space-y-5 text-slate-900">
              {/* Letterhead */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-5 border-b-2 border-slate-900 pb-4">
                <div className="flex items-start gap-3.5">
                  <div className="h-11 w-11 rounded-lg bg-slate-900 flex items-center justify-center shrink-0">
                    <svg viewBox="0 0 64 64" className="h-7 w-7" fill="none" aria-hidden="true">
                      <path
                        d="M32 14C28.5 14 26 16.5 26 20C26 22.5 27.5 24.5 29.5 25.5C30.8 26.2 32 27 32 28.5V31"
                        stroke="#FFFFFF"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                      />
                      <path
                        d="M32 31L12 45C10.5 46 11.2 48.5 13 48.5H51C52.8 48.5 53.5 46 52 45L32 31Z"
                        stroke="#14B8A6"
                        strokeWidth="3.5"
                        strokeLinejoin="round"
                      />
                      <line
                        x1="20"
                        y1="54"
                        x2="44"
                        y2="54"
                        stroke="#FFFFFF"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-bold tracking-tight text-slate-900 leading-tight">
                      {settings.shopName}
                    </h2>
                    <p className="text-xs font-medium text-teal-800">{settings.tagline}</p>
                    <p className="mt-1.5 text-xs text-slate-600">
                      {settings.address} · {settings.commune}
                    </p>
                    <p className="text-xs text-slate-600">
                      Tél / WhatsApp : <span className="font-mono">{settings.phone}</span>
                      {settings.rccm ? ` · RCCM : ${settings.rccm}` : ''}
                    </p>
                  </div>
                </div>

                <div className="sm:text-right flex flex-col sm:items-end justify-between gap-2">
                  <div className="inline-flex items-center gap-2 border border-slate-900 px-3 py-1 rounded">
                    <span className="text-[11px] font-bold tracking-wider text-slate-900">
                      {documentTitle}
                    </span>
                    {order.isExpress && (
                      <span className="text-[11px] font-bold text-amber-800 border-l border-slate-300 pl-2">
                        {expressLinesCount > 0 && expressLinesCount < order.items.length
                          ? `EXPRESS (${expressLinesCount}/${order.items.length})`
                          : 'EXPRESS'}
                      </span>
                    )}
                  </div>
                  <TicketBarcode code={order.ticketNumber} />
                </div>
              </div>

              {/* Client & Logistics Summary Table */}
              <div className="overflow-x-auto rounded-md border border-slate-300">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-300 bg-slate-100 text-[11px] font-semibold text-slate-700">
                      <th className="py-1.5 px-3 border-r border-slate-200 w-[36%]">
                        Client &amp; Destination
                      </th>
                      <th className="py-1.5 px-3 border-r border-slate-200 w-[38%]">
                        Calendrier &amp; Volume
                      </th>
                      <th className="py-1.5 px-3 w-[26%]">Repère Atelier &amp; Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-white align-top">
                      <td className="py-2.5 px-3 border-r border-slate-200 space-y-0.5">
                        <div className="text-sm font-semibold text-slate-900">
                          {order.clientName}
                        </div>
                        <div className="font-mono text-slate-700">{order.clientPhone}</div>
                        <div className="text-slate-600">{order.commune}</div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-200 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">Déposé le :</span>
                          <span className="font-mono font-medium text-slate-900 tabular-nums">
                            {formatDateTimeFR(order.createdAt)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">Retrait standard :</span>
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">
                            {formatDateFR(order.dueDate)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">Volume total :</span>
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">
                            {volumeSummary || '—'}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 space-y-1">
                        <div className="text-[11px] text-slate-500">Casier / Cintre</div>
                        <div className="font-mono text-base font-bold text-slate-900 tabular-nums">
                          {order.rackSlot || 'Comptoir'}
                        </div>
                        <div className="text-[11px] font-semibold text-teal-800">
                          Statut : {statusInfo.shortLabel}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Itemized Garments & Services Table */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
                  <span>Détail des articles et prestations</span>
                  <span className="font-mono text-slate-500 tabular-nums">
                    {order.items.length} ligne{order.items.length > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="overflow-x-auto rounded-md border border-slate-300">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b-2 border-slate-800 bg-slate-100 text-[11px] font-semibold text-slate-800">
                        <th className="py-2 px-2.5 border-r border-slate-200 w-9 text-center">
                          N°
                        </th>
                        <th className="py-2 px-3 border-r border-slate-200">
                          Désignation &amp; Détails
                        </th>
                        <th className="py-2 px-3 border-r border-slate-200">
                          Prestation &amp; Délai
                        </th>
                        <th className="py-2 px-2.5 border-r border-slate-200 text-right whitespace-nowrap">
                          Qté / Vol.
                        </th>
                        <th className="py-2 px-2.5 border-r border-slate-200 text-right whitespace-nowrap">
                          P.U.
                        </th>
                        <th className="py-2 px-2.5 border-r border-slate-200 text-right whitespace-nowrap">
                          Express
                        </th>
                        <th className="py-2 px-3 text-right whitespace-nowrap">Total ligne</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {order.items.map((item, idx) => {
                        const isBlanchisserie = item.activityType === 'blanchisserie';
                        const lotPieces =
                          item.unit !== 'kg' && item.piecesPerUnit && item.piecesPerUnit > 1
                            ? item.quantity * item.piecesPerUnit
                            : null;
                        const lineWeight = item.weightKg
                          ? item.quantity * item.weightKg
                          : item.unit === 'kg'
                          ? item.quantity
                          : 0;
                        const lineBaseTotal = item.quantity * item.unitPriceFCFA;
                        const lineExpressFee = item.isExpress ? item.expressFeeFCFA || 0 : 0;
                        const lineTotal = lineBaseTotal + lineExpressFee;

                        return (
                          <tr
                            key={item.id}
                            className={idx % 2 === 1 ? 'bg-slate-50/55' : 'bg-white'}
                          >
                            <td className="py-2.5 px-2.5 border-r border-slate-200 text-center font-mono text-[11px] text-slate-500 tabular-nums align-top">
                              {String(idx + 1).padStart(2, '0')}
                            </td>
                            <td className="py-2.5 px-3 border-r border-slate-200 align-top space-y-0.5">
                              <div className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900">
                                <span>{item.name}</span>
                                {item.isExpress && (
                                  <span className="rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                                    EXPRESS
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {isBlanchisserie ? 'Blanchisserie' : 'Pressing'}
                                {lotPieces ? ` · ${lotPieces} vêtements (tous types)` : ''}
                                {lineWeight > 0 ? ` · Pesée ${formatWeightKg(lineWeight)}` : ''}
                              </div>
                              {item.note && (
                                <div className="text-[11px] text-amber-900">
                                  Réserve : {item.note}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 border-r border-slate-200 align-top space-y-0.5">
                              <div className="font-medium text-slate-800">
                                {SERVICE_MODE_LABELS[item.mode]}
                              </div>
                              <div
                                className={`text-[11px] font-mono tabular-nums ${
                                  item.isExpress ? 'font-semibold text-amber-800' : 'text-slate-500'
                                }`}
                              >
                                {item.isExpress
                                  ? `Express · Retrait ${formatDateFR(
                                      item.expressDueDate || order.dueDate
                                    )}`
                                  : `Standard · Retrait ${formatDateFR(order.dueDate)}`}
                              </div>
                            </td>
                            <td className="py-2.5 px-2.5 border-r border-slate-200 text-right font-mono tabular-nums text-slate-900 align-top whitespace-nowrap">
                              {item.unit === 'kg' && item.weightKg ? (
                                item.quantity > 1 ? (
                                  <>
                                    <div>{item.quantity} × {formatWeightKg(item.weightKg)}</div>
                                    <div className="text-[10px] text-slate-500">
                                      ({formatWeightKg(lineWeight)})
                                    </div>
                                  </>
                                ) : (
                                  formatWeightKg(item.weightKg)
                                )
                              ) : (
                                <>
                                  <div>
                                    {item.quantity} {item.unit}
                                    {item.quantity > 1 && item.unit === 'lot' ? 's' : ''}
                                  </div>
                                  {lotPieces && (
                                    <div className="text-[10px] text-slate-500">
                                      {lotPieces} pcs
                                    </div>
                                  )}
                                </>
                              )}
                            </td>
                            <td className="py-2.5 px-2.5 border-r border-slate-200 text-right font-mono tabular-nums text-slate-700 align-top whitespace-nowrap">
                              {formatFCFA(item.unitPriceFCFA)}
                            </td>
                            <td className="py-2.5 px-2.5 border-r border-slate-200 text-right font-mono tabular-nums align-top whitespace-nowrap">
                              {item.isExpress ? (
                                <span className="font-semibold text-amber-800">
                                  +{formatFCFA(lineExpressFee)}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-slate-900 align-top whitespace-nowrap">
                              {formatFCFA(lineTotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 bg-slate-100/80 font-semibold text-slate-900">
                        <td
                          colSpan={3}
                          className="py-2 px-3 border-r border-slate-200 text-[11px] text-slate-700"
                        >
                          Total articles &amp; prestations ({volumeSummary || `${order.items.length} ligne(s)`})
                        </td>
                        <td className="py-2 px-2.5 border-r border-slate-200 text-right font-mono text-[11px] tabular-nums text-slate-700 whitespace-nowrap">
                          {volumeSummary || '—'}
                        </td>
                        <td className="py-2 px-2.5 border-r border-slate-200 text-right font-mono text-[11px] tabular-nums text-slate-700 whitespace-nowrap">
                          {formatFCFA(articlesSubtotal)}
                        </td>
                        <td className="py-2 px-2.5 border-r border-slate-200 text-right font-mono text-[11px] tabular-nums text-amber-800 whitespace-nowrap">
                          {lineExpressSum > 0 ? `+${formatFCFA(lineExpressSum)}` : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-xs font-bold tabular-nums text-slate-900 whitespace-nowrap">
                          {formatFCFA(articlesSubtotal + lineExpressSum)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Financial Reconciliation & Payment History Tables */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 pt-1 items-start">
                {/* Left: Payment History Table + Notes */}
                <div className="sm:col-span-6 space-y-3 text-xs">
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-700">
                      Historique des règlements
                    </div>
                    {orderPayments.length === 0 ? (
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-500 italic">
                        Aucun versement enregistré pour l&apos;instant.
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-md border border-slate-300">
                        <table className="w-full text-left text-[11px] border-collapse">
                          <thead>
                            <tr className="border-b border-slate-300 bg-slate-100 text-slate-700 font-semibold">
                              <th className="py-1.5 px-2.5 border-r border-slate-200">Date</th>
                              <th className="py-1.5 px-2.5 border-r border-slate-200">Mode</th>
                              <th className="py-1.5 px-2 border-r border-slate-200">Type</th>
                              <th className="py-1.5 px-2.5 text-right">Montant</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {orderPayments.map((p) => (
                              <tr key={p.id} className="bg-white">
                                <td className="py-1.5 px-2.5 border-r border-slate-200 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                                  {formatDateTimeFR(p.paidAt)}
                                </td>
                                <td className="py-1.5 px-2.5 border-r border-slate-200 text-slate-800">
                                  {PAYMENT_METHOD_LABELS[p.method]}
                                </td>
                                <td className="py-1.5 px-2 border-r border-slate-200 text-slate-600">
                                  {PAYMENT_TYPE_LABELS[p.type]}
                                </td>
                                <td className="py-1.5 px-2.5 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                                  {formatFCFA(p.amountFCFA)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-slate-300 bg-slate-50 font-semibold text-slate-900">
                              <td colSpan={3} className="py-1.5 px-2.5 border-r border-slate-200">
                                Total encaissé
                              </td>
                              <td className="py-1.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                                {formatFCFA(order.paidFCFA)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>

                  {order.notes && (
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
                      <span className="font-semibold text-slate-900">Note dépôt :</span>{' '}
                      {order.notes}
                    </div>
                  )}
                </div>

                {/* Right: Financial Summary Ledger Table */}
                <div className="sm:col-span-6 space-y-1.5 text-xs">
                  <div className="text-[11px] font-semibold text-slate-700">
                    Récapitulatif financier
                  </div>
                  <div className="overflow-hidden rounded-md border border-slate-300">
                    <table className="w-full text-xs border-collapse">
                      <tbody className="divide-y divide-slate-200">
                        <tr className="bg-white">
                          <td className="py-1.5 px-3 text-slate-600">Sous-total articles</td>
                          <td className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                            {formatFCFA(articlesSubtotal)}
                          </td>
                        </tr>
                        {order.expressFeeFCFA > 0 && (
                          <tr className="bg-amber-50/40">
                            <td className="py-1.5 px-3 text-amber-900">
                              Supplément Express
                              {hasPerLineExpress && expressLinesCount > 0
                                ? ` (${expressLinesCount} article${expressLinesCount > 1 ? 's' : ''})`
                                : ''}
                            </td>
                            <td className="py-1.5 px-3 text-right font-mono font-medium tabular-nums text-amber-900 whitespace-nowrap">
                              +{formatFCFA(order.expressFeeFCFA)}
                            </td>
                          </tr>
                        )}
                        {order.deliveryFeeFCFA > 0 && (
                          <tr className="bg-white">
                            <td className="py-1.5 px-3 text-slate-600">
                              Frais de livraison ({order.commune})
                            </td>
                            <td className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                              +{formatFCFA(order.deliveryFeeFCFA)}
                            </td>
                          </tr>
                        )}
                        {order.discountFCFA > 0 && (
                          <tr className="bg-white">
                            <td className="py-1.5 px-3 text-emerald-700">Remise accordée</td>
                            <td className="py-1.5 px-3 text-right font-mono tabular-nums text-emerald-700 whitespace-nowrap">
                              -{formatFCFA(order.discountFCFA)}
                            </td>
                          </tr>
                        )}
                        <tr className="border-t-2 border-slate-800 bg-slate-100 font-bold text-slate-900">
                          <td className="py-2 px-3 text-sm">TOTAL NET À PAYER</td>
                          <td className="py-2 px-3 text-right font-mono text-sm tabular-nums whitespace-nowrap">
                            {formatFCFA(order.totalFCFA)}
                          </td>
                        </tr>
                        <tr className="bg-white text-slate-700">
                          <td className="py-1.5 px-3">Total réglé</td>
                          <td className="py-1.5 px-3 text-right font-mono font-medium tabular-nums whitespace-nowrap">
                            {formatFCFA(order.paidFCFA)}
                          </td>
                        </tr>
                        {(order.prepaidUsedFCFA || 0) > 0 && (
                          <tr className="bg-white text-teal-800">
                            <td className="py-1 px-3 text-[11px]">Dont compte prépayé</td>
                            <td className="py-1 px-3 text-right font-mono text-[11px] tabular-nums whitespace-nowrap">
                              {formatFCFA(order.prepaidUsedFCFA || 0)}
                            </td>
                          </tr>
                        )}
                        {(order.loyaltyPointsEarned || 0) > 0 && (
                          <tr className="bg-white text-emerald-700">
                            <td className="py-1 px-3 text-[11px]">Points fidélité gagnés</td>
                            <td className="py-1 px-3 text-right font-mono text-[11px] font-semibold tabular-nums whitespace-nowrap">
                              +{order.loyaltyPointsEarned} pts
                            </td>
                          </tr>
                        )}
                        <tr
                          className={`font-bold ${
                            remaining > 0
                              ? 'bg-amber-50 text-amber-900'
                              : 'bg-emerald-50 text-emerald-900'
                          }`}
                        >
                          <td className="py-2 px-3">
                            {remaining > 0 ? 'RESTE À RÉGLER AU RETRAIT' : 'STATUT RÈGLEMENT'}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-sm tabular-nums whitespace-nowrap">
                            {remaining > 0 ? formatFCFA(remaining) : 'SOLDÉ · 0 FCFA'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {order.claimPhotos && order.claimPhotos.length > 0 && (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
                  <span className="font-semibold text-slate-900">
                    Réserves constatées à la réception :
                  </span>{' '}
                  {order.claimPhotos.length} photo{order.claimPhotos.length > 1 ? 's' : ''} archivée
                  {order.claimPhotos.length > 1 ? 's' : ''} au dossier client (
                  {order.claimPhotos.map((p) => p.caption).join(', ')}).
                </div>
              )}

              {/* Legal Notice & Signatures */}
              <div className="border-t border-slate-200 pt-3 flex flex-col sm:flex-row sm:items-end justify-between gap-4 text-[11px] text-slate-500">
                <p className="max-w-md leading-relaxed">{settings.ticketFooterNote}</p>
                <div className="flex items-center gap-6 shrink-0 text-slate-600">
                  <div className="text-center">
                    <div className="h-7 w-24 border-b border-slate-300" />
                    <span className="mt-1 block text-[10px]">Visa Comptoir</span>
                  </div>
                  <div className="text-center">
                    <div className="h-7 w-24 border-b border-slate-300" />
                    <span className="mt-1 block text-[10px]">Signature Client</span>
                  </div>
                </div>
              </div>

              {/* Detachable Workshop Stub */}
              <div className="pt-1">
                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                  <Scissors className="h-3 w-3 shrink-0" />
                  <div className="flex-1 border-t border-dashed border-slate-300" />
                  <span className="uppercase tracking-wider">Souche atelier / Cintre</span>
                  <div className="flex-1 border-t border-dashed border-slate-300" />
                </div>

                <div className="mt-3 overflow-x-auto rounded border border-slate-300">
                  <table className="w-full text-left text-xs border-collapse bg-slate-50/70">
                    <tbody>
                      <tr className="font-mono tabular-nums">
                        <td className="py-2 px-3 font-bold text-slate-900 border-r border-slate-200 whitespace-nowrap">
                          {order.ticketNumber}
                        </td>
                        <td className="py-2 px-3 font-sans font-semibold text-slate-900 border-r border-slate-200">
                          {order.clientName} ·{' '}
                          <span className="font-mono font-normal text-slate-600">
                            {order.clientPhone}
                          </span>
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 whitespace-nowrap">
                          Casier : <strong className="text-slate-900">{order.rackSlot || '—'}</strong>
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 whitespace-nowrap">
                          {volumeSummary || '—'}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 whitespace-nowrap">
                          Retrait : {formatDateFR(order.dueDate)}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-slate-900 whitespace-nowrap">
                          {remaining > 0 ? `Dû : ${formatFCFA(remaining)}` : 'SOLDÉ'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            /* ======================== FORMAT TICKET THERMIQUE 80MM ======================== */
            <div className="print-sheet print-thermal w-[330px] bg-white border border-slate-300 p-4 space-y-3 text-[11px] text-slate-900 font-mono">
              <div className="text-center border-b border-dashed border-slate-400 pb-3 space-y-0.5">
                <div className="text-sm font-bold uppercase tracking-wide">{settings.shopName}</div>
                <div className="text-[10px] text-slate-600 font-sans">{settings.tagline}</div>
                <div className="text-[10px] text-slate-600">{settings.address}</div>
                <div className="text-[10px] text-slate-600">{settings.commune}</div>
                <div className="text-[10px] text-slate-700">Tél : {settings.phone}</div>
                {settings.rccm && (
                  <div className="text-[9px] text-slate-500">RCCM : {settings.rccm}</div>
                )}
              </div>

              <div className="text-center border-b border-dashed border-slate-400 pb-2.5 space-y-1">
                <div className="text-xs font-bold tracking-wider">
                  {documentTitle} {order.isExpress ? '· EXPRESS' : ''}
                </div>
                <TicketBarcode code={order.ticketNumber} compact />
                <div className="flex justify-between text-[10px] pt-1">
                  <span>Dépôt : {formatDateTimeFR(order.createdAt)}</span>
                  <span className="font-bold">Casier: {order.rackSlot || '—'}</span>
                </div>
                <div className="text-[11px] font-bold">
                  Retrait prévu : {formatDateFR(order.dueDate)}
                </div>
              </div>

              <div className="border-b border-dashed border-slate-400 pb-2 space-y-0.5 text-[10px]">
                <div>
                  Client : <span className="font-bold">{order.clientName}</span>
                </div>
                <div>Tél : {order.clientPhone}</div>
                <div>Zone : {order.commune}</div>
              </div>

              {/* Thermal Itemized Table */}
              <div className="border-b border-dashed border-slate-400 pb-2.5">
                <table className="w-full text-left text-[10px] border-collapse">
                  <thead>
                    <tr className="border-y border-slate-400 bg-slate-50 font-bold">
                      <th className="py-1 pr-1.5">ARTICLE</th>
                      <th className="py-1 px-1 text-right">QTÉ</th>
                      <th className="py-1 pl-1.5 text-right">MONTANT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dashed divide-slate-300">
                    {order.items.map((item) => {
                      const lotPieces =
                        item.unit !== 'kg' && item.piecesPerUnit && item.piecesPerUnit > 1
                          ? item.quantity * item.piecesPerUnit
                          : null;
                      const lineWeight = item.weightKg
                        ? item.quantity * item.weightKg
                        : item.unit === 'kg'
                        ? item.quantity
                        : 0;
                      const lineTotal =
                        item.quantity * item.unitPriceFCFA +
                        (item.isExpress ? item.expressFeeFCFA || 0 : 0);
                      return (
                        <tr key={item.id} className="align-top">
                          <td className="py-1.5 pr-1.5">
                            <div className="font-semibold">
                              {item.name}
                              {item.isExpress ? ' [EXPRESS]' : ''}
                            </div>
                            <div className="text-[9px] text-slate-600">
                              {SERVICE_MODE_LABELS[item.mode]} · {formatFCFA(item.unitPriceFCFA)}/
                              {item.unit}
                            </div>
                            {lotPieces && (
                              <div className="text-[9px] text-slate-600">
                                Lot : {lotPieces} pcs
                              </div>
                            )}
                            {item.isExpress && (
                              <div className="text-[9px] text-amber-800 font-semibold">
                                Express : +{formatFCFA(item.expressFeeFCFA || 0)}
                                {item.expressDueDate
                                  ? ` (${formatDateFR(item.expressDueDate)})`
                                  : ''}
                              </div>
                            )}
                            {item.note && (
                              <div className="text-[9px] text-slate-600">Note : {item.note}</div>
                            )}
                          </td>
                          <td className="py-1.5 px-1 text-right tabular-nums whitespace-nowrap">
                            {item.unit === 'kg'
                              ? formatWeightKg(lineWeight)
                              : `${item.quantity}${item.unit === 'lot' ? ' lot' : ''}`}
                          </td>
                          <td className="py-1.5 pl-1.5 text-right font-semibold tabular-nums whitespace-nowrap">
                            {formatFCFA(lineTotal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Thermal Totals Table */}
              <div className="border-b border-dashed border-slate-400 pb-2.5">
                <table className="w-full text-[10px] border-collapse tabular-nums">
                  <tbody>
                    <tr>
                      <td className="py-0.5 text-slate-600">Sous-total articles</td>
                      <td className="py-0.5 text-right">{formatFCFA(articlesSubtotal)}</td>
                    </tr>
                    {order.expressFeeFCFA > 0 && (
                      <tr>
                        <td className="py-0.5 text-amber-800">Supplément Express</td>
                        <td className="py-0.5 text-right text-amber-800">
                          +{formatFCFA(order.expressFeeFCFA)}
                        </td>
                      </tr>
                    )}
                    {order.deliveryFeeFCFA > 0 && (
                      <tr>
                        <td className="py-0.5 text-slate-600">Livraison</td>
                        <td className="py-0.5 text-right">+{formatFCFA(order.deliveryFeeFCFA)}</td>
                      </tr>
                    )}
                    {order.discountFCFA > 0 && (
                      <tr>
                        <td className="py-0.5 text-emerald-700">Remise</td>
                        <td className="py-0.5 text-right text-emerald-700">
                          -{formatFCFA(order.discountFCFA)}
                        </td>
                      </tr>
                    )}
                    <tr className="border-t border-slate-400 text-xs font-bold">
                      <td className="pt-1">TOTAL NET</td>
                      <td className="pt-1 text-right">{formatFCFA(order.totalFCFA)}</td>
                    </tr>
                    <tr>
                      <td className="py-0.5">Réglé</td>
                      <td className="py-0.5 text-right">{formatFCFA(order.paidFCFA)}</td>
                    </tr>
                    {(order.prepaidUsedFCFA || 0) > 0 && (
                      <tr>
                        <td className="py-0.5 text-teal-800">Dont prépayé</td>
                        <td className="py-0.5 text-right text-teal-800">
                          {formatFCFA(order.prepaidUsedFCFA || 0)}
                        </td>
                      </tr>
                    )}
                    {(order.loyaltyPointsEarned || 0) > 0 && (
                      <tr>
                        <td className="py-0.5 text-emerald-700">Fidélité gagnée</td>
                        <td className="py-0.5 text-right text-emerald-700">
                          +{order.loyaltyPointsEarned} pts
                        </td>
                      </tr>
                    )}
                    <tr className="text-xs font-bold">
                      <td className="pt-0.5">{remaining > 0 ? 'RESTE À PAYER' : 'STATUT'}</td>
                      <td className="pt-0.5 text-right">
                        {remaining > 0 ? formatFCFA(remaining) : 'SOLDÉ'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {orderPayments.length > 0 && (
                <div className="border-b border-dashed border-slate-400 pb-2 text-[9px]">
                  <div className="font-bold mb-1">RÈGLEMENTS :</div>
                  <table className="w-full border-collapse tabular-nums">
                    <tbody>
                      {orderPayments.map((p) => (
                        <tr key={p.id}>
                          <td className="py-0.5">
                            {PAYMENT_METHOD_LABELS[p.method]} ({PAYMENT_TYPE_LABELS[p.type]})
                          </td>
                          <td className="py-0.5 text-right">{formatFCFA(p.amountFCFA)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="text-center text-[9px] text-slate-600 leading-snug font-sans pt-1">
                {settings.ticketFooterNote}
              </div>

              <div className="border-t border-dashed border-slate-500 pt-2 text-[10px] space-y-0.5">
                <div className="text-center text-[9px] text-slate-500">--- SOUCHE ATELIER ---</div>
                <div className="flex justify-between font-bold">
                  <span>{order.ticketNumber}</span>
                  <span>Casier {order.rackSlot || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="truncate max-w-[160px]">{order.clientName}</span>
                  <span>{remaining > 0 ? formatFCFA(remaining) : 'SOLDÉ'}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Claim Photos Gallery (non-print inspection) */}
        {order.claimPhotos && order.claimPhotos.length > 0 && (
          <div className="no-print border-t border-slate-200 bg-white px-6 py-4 space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              <Camera className="h-3.5 w-3.5 text-teal-700" />
              <span>
                Photos de réserves à la réception ({order.claimPhotos.length})
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {order.claimPhotos.map((ph) => (
                <button
                  key={ph.id}
                  type="button"
                  onClick={() => setZoomedPhoto(ph)}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-1.5 text-left hover:border-teal-600 cursor-pointer"
                >
                  <img
                    src={ph.dataUrl}
                    alt={ph.caption}
                    className="h-20 w-full rounded object-cover"
                  />
                  <div className="mt-1 truncate text-[11px] font-medium text-slate-800">
                    {ph.caption}
                  </div>
                  {ph.itemName && (
                    <div className="truncate text-[10px] text-slate-500">{ph.itemName}</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Interactive settlement & status footer (hidden on print) */}
        <div className="no-print border-t border-slate-200 bg-slate-50 px-6 py-4 rounded-b-xl space-y-4">
          {remaining > 0 && (
            <form onSubmit={handlePaySubmit} className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[140px]">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Encaisser un règlement (FCFA)
                </label>
                <input
                  type="number"
                  min={100}
                  max={remaining}
                  step={50}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono tabular-nums focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Mode de paiement
                </label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                >
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={savingPay}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                <CreditCard className="h-3.5 w-3.5" />
                <span>{savingPay ? 'Enregistrement...' : 'Valider règlement'}</span>
              </button>
            </form>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              Modification instantanée dans la base locale
            </span>
            {statusInfo.nextStatus && (
              <button
                type="button"
                onClick={() => onAdvanceStatus(order.id)}
                className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer whitespace-nowrap"
              >
                {statusInfo.nextActionLabel}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Photo Lightbox */}
      {zoomedPhoto && (
        <div
          className="no-print fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4"
          onClick={() => setZoomedPhoto(null)}
        >
          <div
            className="max-w-xl w-full rounded-xl bg-white p-4 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-900">
                {zoomedPhoto.caption}
                {zoomedPhoto.itemName ? ` · ${zoomedPhoto.itemName}` : ''}
              </div>
              <button
                type="button"
                onClick={() => setZoomedPhoto(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <img
              src={zoomedPhoto.dataUrl}
              alt={zoomedPhoto.caption}
              className="w-full max-h-[70vh] rounded-lg object-contain bg-slate-100"
            />
          </div>
        </div>
      )}
    </div>
  );
};
