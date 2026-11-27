import React, { useMemo, useState } from 'react';
import { Camera, FileDown, Printer, ScanBarcode, Search, Trash2 } from 'lucide-react';
import { OrderStatus, PressingOrder } from '../types/pressing';
import { formatDateFR, formatFCFA, formatWeightKg, STATUS_META } from '../utils/formatters';

interface OrdersViewProps {
  orders: PressingOrder[];
  onSelectOrder: (order: PressingOrder) => void;
  onExportPdf?: (order: PressingOrder) => void;
  onOpenScanner?: () => void;
  onAdvanceStatus: (orderId: string) => Promise<void>;
  onDeleteOrder: (orderId: string) => Promise<void>;
}

type FilterTab = 'tous' | OrderStatus | 'impayes';

export const OrdersView: React.FC<OrdersViewProps> = ({
  orders,
  onSelectOrder,
  onExportPdf,
  onOpenScanner,
  onAdvanceStatus,
  onDeleteOrder,
}) => {
  const [filter, setFilter] = useState<FilterTab>('tous');
  const [search, setSearch] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter === 'impayes') {
        if (o.totalFCFA <= o.paidFCFA) return false;
      } else if (filter !== 'tous' && o.status !== filter) {
        return false;
      }

      if (!q) return true;
      return (
        o.ticketNumber.toLowerCase().includes(q) ||
        o.clientName.toLowerCase().includes(q) ||
        o.clientPhone.toLowerCase().includes(q) ||
        o.rackSlot.toLowerCase().includes(q)
      );
    });
  }, [orders, filter, search]);

  const filterButtons: { key: FilterTab; label: string; count: number }[] = [
    { key: 'tous', label: 'Tous', count: orders.length },
    { key: 'recu', label: 'Reçus', count: orders.filter((o) => o.status === 'recu').length },
    { key: 'lavage', label: 'Lavage', count: orders.filter((o) => o.status === 'lavage').length },
    {
      key: 'repassage',
      label: 'Repassage',
      count: orders.filter((o) => o.status === 'repassage').length,
    },
    { key: 'pret', label: 'Prêts', count: orders.filter((o) => o.status === 'pret').length },
    { key: 'livre', label: 'Livrés', count: orders.filter((o) => o.status === 'livre').length },
    {
      key: 'impayes',
      label: 'Soldes dus',
      count: orders.filter((o) => o.totalFCFA > o.paidFCFA).length,
    },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {filterButtons.map((fb) => (
            <button
              key={fb.key}
              type="button"
              onClick={() => setFilter(fb.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filter === fb.key
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              {fb.label}{' '}
              <span className="ml-1 font-mono opacity-75 tabular-nums">{fb.count}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="N° ticket, nom client, tél..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-2 text-xs focus:bg-white focus:border-teal-600 focus:outline-none"
            />
          </div>
          {onOpenScanner && (
            <button
              type="button"
              onClick={onOpenScanner}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ScanBarcode className="h-3.5 w-3.5 text-teal-700" />
              <span>Scanner ticket</span>
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="p-12 text-center text-xs text-slate-500">
          Aucun ticket ne correspond à ce filtre.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500">
                <th className="py-3 px-4 font-medium">Ticket & Casier</th>
                <th className="py-3 px-3 font-medium">Client</th>
                <th className="py-3 px-3 font-medium">Détail articles</th>
                <th className="py-3 px-3 font-medium">Dépôt / Retrait</th>
                <th className="py-3 px-3 font-medium">Statut</th>
                <th className="py-3 px-3 font-medium text-right">Total</th>
                <th className="py-3 px-3 font-medium text-right">Reste dû</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((order) => {
                const meta = STATUS_META[order.status];
                const remaining = Math.max(0, order.totalFCFA - order.paidFCFA);
                const expressCount = order.items.filter((i) => i.isExpress).length;
                const expressSummary =
                  expressCount > 0 && expressCount < order.items.length
                    ? `Express (${expressCount}/${order.items.length} art.)`
                    : order.isExpress
                    ? 'Express'
                    : '';
                return (
                  <tr key={order.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onSelectOrder(order)}
                          className="font-mono font-semibold text-slate-900 hover:text-teal-700 cursor-pointer tabular-nums"
                        >
                          {order.ticketNumber}
                        </button>
                        {order.claimPhotos && order.claimPhotos.length > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] font-mono text-slate-600"
                            title={`${order.claimPhotos.length} photo(s) de réserve à la réception`}
                          >
                            <Camera className="h-3 w-3 text-teal-700" />
                            <span>{order.claimPhotos.length}</span>
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Casier {order.rackSlot || '—'}
                        {expressSummary ? ` · ${expressSummary}` : ''}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-slate-900">{order.clientName}</div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {order.clientPhone}
                      </div>
                    </td>
                    <td className="py-3 px-3 max-w-xs">
                      <div className="truncate text-slate-700">
                        {order.items
                          .map((i) => {
                            if (i.activityType === 'blanchisserie') {
                              return `${i.quantity}x ${i.name} (${i.quantity * (i.piecesPerUnit || 1)} pcs)`;
                            }
                            if (i.unit === 'kg' && i.weightKg) {
                              return `${formatWeightKg(i.quantity * i.weightKg)} ${i.name}${i.isExpress ? ' (Express)' : ''}`;
                            }
                            return `${i.quantity}x ${i.name}${i.isExpress ? ' (Express)' : ''}`;
                          })
                          .join(', ')}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {order.items.some((i) => i.activityType === 'blanchisserie') &&
                        order.items.some((i) => i.activityType !== 'blanchisserie')
                          ? 'Pressing · Blanchisserie'
                          : order.items.some((i) => i.activityType === 'blanchisserie')
                          ? 'Blanchisserie'
                          : 'Pressing'}{' '}
                        · {order.commune}
                      </div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px] text-slate-600 tabular-nums">
                      <div>Déposé : {formatDateFR(order.dropOffDate)}</div>
                      <div className="text-slate-900 font-medium">
                        Prévu : {formatDateFR(order.dueDate)}
                      </div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span
                        className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.bgClass} ${meta.textClass} ${meta.borderClass}`}
                      >
                        {meta.shortLabel}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap">
                      {formatFCFA(order.totalFCFA)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {remaining > 0 ? (
                        <span className="font-semibold text-amber-800">
                          {formatFCFA(remaining)}
                        </span>
                      ) : (
                        <span className="text-emerald-700">Soldé</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {meta.nextStatus && (
                          <button
                            type="button"
                            onClick={() => onAdvanceStatus(order.id)}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            {meta.nextActionLabel}
                          </button>
                        )}
                        {onExportPdf && (
                          <button
                            type="button"
                            onClick={() => onExportPdf(order)}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-teal-700 cursor-pointer"
                            title="Exporter le reçu en PDF"
                            aria-label="Exporter le reçu en PDF"
                          >
                            <FileDown className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onSelectOrder(order)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                          title="Ticket / Encaisser"
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </button>
                        {confirmDeleteId === order.id ? (
                          <button
                            type="button"
                            onClick={async () => {
                              await onDeleteOrder(order.id);
                              setConfirmDeleteId(null);
                            }}
                            className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700 cursor-pointer"
                          >
                            Confirmer
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(order.id)}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                            title="Supprimer ce ticket"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
