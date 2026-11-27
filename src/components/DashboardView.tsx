import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock,
  Plus,
  Printer,
  Truck,
} from 'lucide-react';
import {
  AppTab,
  ExpenseRecord,
  LogisticsTask,
  PaymentMethod,
  PaymentRecord,
  PressingOrder,
} from '../types/pressing';
import {
  formatDateFR,
  formatFCFA,
  formatWeightKg,
  getTodayISO,
  LOGISTICS_STATUS_META,
  LOGISTICS_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  STATUS_META,
} from '../utils/formatters';
import { MonthlyRevenueChart } from './MonthlyRevenueChart';

type AlertFilter = 'all' | 'overdue' | 'today';

interface OrderUrgencyInfo {
  urgency: 'overdue' | 'today' | 'upcoming';
  effectiveDueDate: string;
  daysLate: number;
  isExpressTrigger: boolean;
}

function getOrderUrgency(order: PressingOrder, today: string): OrderUrgencyInfo {
  const expressDates = order.items
    .filter((i) => i.isExpress && i.expressDueDate)
    .map((i) => i.expressDueDate as string);

  let effectiveDueDate = order.dueDate;
  let isExpressTrigger = false;

  for (const expDate of expressDates) {
    if (expDate < effectiveDueDate) {
      effectiveDueDate = expDate;
      isExpressTrigger = true;
    }
  }

  if (effectiveDueDate < today) {
    const msDiff =
      new Date(`${today}T00:00:00`).getTime() -
      new Date(`${effectiveDueDate}T00:00:00`).getTime();
    const daysLate = Math.max(1, Math.round(msDiff / 86400000));
    return { urgency: 'overdue', effectiveDueDate, daysLate, isExpressTrigger };
  }

  if (effectiveDueDate === today) {
    return { urgency: 'today', effectiveDueDate, daysLate: 0, isExpressTrigger };
  }

  return { urgency: 'upcoming', effectiveDueDate, daysLate: 0, isExpressTrigger };
}

interface DashboardViewProps {
  orders: PressingOrder[];
  payments: PaymentRecord[];
  expenses: ExpenseRecord[];
  logistics: LogisticsTask[];
  onNavigate: (tab: AppTab) => void;
  onSelectOrder: (order: PressingOrder) => void;
  onAdvanceStatus: (orderId: string) => Promise<void>;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  orders,
  payments,
  expenses,
  logistics,
  onNavigate,
  onSelectOrder,
  onAdvanceStatus,
}) => {
  const today = getTodayISO();
  const [alertFilter, setAlertFilter] = useState<AlertFilter>('all');
  const [showAllAlerts, setShowAllAlerts] = useState(false);

  const todayPayments = payments.filter((p) => p.paidAt.slice(0, 10) === today);
  const todayRevenue = todayPayments.reduce((sum, p) => sum + p.amountFCFA, 0);
  const todayExpenses = expenses
    .filter((e) => e.date === today)
    .reduce((sum, e) => sum + e.amountFCFA, 0);

  const activeOrders = orders.filter((o) => o.status !== 'livre');
  const readyOrders = orders.filter((o) => o.status === 'pret');
  const unpaidTotal = orders
    .filter((o) => o.totalFCFA > o.paidFCFA)
    .reduce((sum, o) => sum + (o.totalFCFA - o.paidFCFA), 0);

  const totalCollectedAllTime = payments.reduce((sum, p) => sum + p.amountFCFA, 0);

  const paymentBreakdown = (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map(
    (method) => {
      const amount = payments
        .filter((p) => p.method === method)
        .reduce((sum, p) => sum + p.amountFCFA, 0);
      return { method, label: PAYMENT_METHOD_LABELS[method], amount };
    }
  );

  const activeDeliveriesByOrderId = useMemo(() => {
    const map = new Map<string, LogisticsTask>();
    for (const task of logistics) {
      if (
        task.orderId &&
        task.type === 'livraison' &&
        (task.status === 'planifie' || task.status === 'en_cours')
      ) {
        map.set(task.orderId, task);
      }
    }
    return map;
  }, [logistics]);

  const urgentAlerts = useMemo(() => {
    return activeOrders
      .map((order) => ({
        order,
        info: getOrderUrgency(order, today),
        deliveryTask: activeDeliveriesByOrderId.get(order.id),
      }))
      .filter((entry) => entry.info.urgency === 'overdue' || entry.info.urgency === 'today')
      .sort((a, b) => a.info.effectiveDueDate.localeCompare(b.info.effectiveDueDate));
  }, [activeOrders, today, activeDeliveriesByOrderId]);

  const overdueCount = useMemo(
    () => urgentAlerts.filter((a) => a.info.urgency === 'overdue').length,
    [urgentAlerts]
  );
  const dueTodayCount = useMemo(
    () => urgentAlerts.filter((a) => a.info.urgency === 'today').length,
    [urgentAlerts]
  );

  const filteredAlerts = useMemo(() => {
    if (alertFilter === 'overdue') {
      return urgentAlerts.filter((a) => a.info.urgency === 'overdue');
    }
    if (alertFilter === 'today') {
      return urgentAlerts.filter((a) => a.info.urgency === 'today');
    }
    return urgentAlerts;
  }, [urgentAlerts, alertFilter]);

  const visibleAlerts = showAllAlerts ? filteredAlerts : filteredAlerts.slice(0, 5);

  const urgentQueue = activeOrders
    .slice()
    .sort((a, b) =>
      getOrderUrgency(a, today).effectiveDueDate.localeCompare(
        getOrderUrgency(b, today).effectiveDueDate
      )
    )
    .slice(0, 7);

  return (
    <div className="space-y-8">
      {/* Visual Deadline Notifications (Overdue or Due Today) */}
      <section aria-label="Notifications d'échéance de livraison">
        {urgentAlerts.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-5 py-3 text-xs text-emerald-900">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
              <span className="font-medium">
                Aucune commande en retard ni à livrer aujourd&apos;hui — tous les dépôts actifs
                sont dans les délais.
              </span>
            </div>
            <span className="font-mono text-[11px] text-emerald-800 tabular-nums">
              {activeOrders.length} ticket{activeOrders.length > 1 ? 's' : ''} actif
              {activeOrders.length > 1 ? 's' : ''}
            </span>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div
              className={`flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 ${
                overdueCount > 0 ? 'bg-red-50/60' : 'bg-amber-50/70'
              }`}
            >
              <div className="flex items-start sm:items-center gap-3">
                {overdueCount > 0 ? (
                  <AlertTriangle className="h-5 w-5 text-red-700 shrink-0 mt-0.5 sm:mt-0" />
                ) : (
                  <BellRing className="h-5 w-5 text-amber-700 shrink-0 mt-0.5 sm:mt-0" />
                )}
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Alertes d&apos;échéance de livraison &amp; retraits
                  </h2>
                  <p className="text-xs text-slate-700">
                    {overdueCount > 0 && (
                      <span className="font-semibold text-red-700">
                        {overdueCount} commande{overdueCount > 1 ? 's' : ''} en retard
                      </span>
                    )}
                    {overdueCount > 0 && dueTodayCount > 0 && ' · '}
                    {dueTodayCount > 0 && (
                      <span className="font-semibold text-amber-800">
                        {dueTodayCount} à livrer / retirer aujourd&apos;hui
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5"
                  role="group"
                  aria-label="Filtrer les alertes d'échéance"
                >
                  <button
                    type="button"
                    onClick={() => setAlertFilter('all')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      alertFilter === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Tout ({urgentAlerts.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAlertFilter('overdue')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      alertFilter === 'overdue'
                        ? 'bg-red-700 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    En retard ({overdueCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAlertFilter('today')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      alertFilter === 'today'
                        ? 'bg-amber-700 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Aujourd&apos;hui ({dueTodayCount})
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate('orders')}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                >
                  <span>Voir tout</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {visibleAlerts.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                Aucune commande dans cette catégorie d&apos;échéance.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500">
                      <th className="py-2.5 px-4 font-medium">Échéance</th>
                      <th className="py-2.5 px-3 font-medium">Ticket / Casier</th>
                      <th className="py-2.5 px-3 font-medium">Client</th>
                      <th className="py-2.5 px-3 font-medium">Statut</th>
                      <th className="py-2.5 px-3 font-medium text-right">Reste dû</th>
                      <th className="py-2.5 px-4 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleAlerts.map(({ order, info, deliveryTask }) => {
                      const meta = STATUS_META[order.status];
                      const remaining = Math.max(0, order.totalFCFA - order.paidFCFA);
                      const isLate = info.urgency === 'overdue';
                      return (
                        <tr
                          key={order.id}
                          className={
                            isLate
                              ? 'bg-red-50/30 hover:bg-red-50/60 transition-colors'
                              : 'bg-amber-50/30 hover:bg-amber-50/60 transition-colors'
                          }
                        >
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <div
                              className={`inline-flex items-center gap-1.5 font-semibold ${
                                isLate ? 'text-red-700' : 'text-amber-800'
                              }`}
                            >
                              {isLate ? (
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                              ) : (
                                <Clock className="h-3.5 w-3.5 shrink-0" />
                              )}
                              <span>
                                {isLate
                                  ? `En retard · ${info.daysLate} j`
                                  : "Aujourd'hui"}
                              </span>
                            </div>
                            <div className="mt-0.5 font-mono text-[11px] text-slate-600 tabular-nums">
                              {formatDateFR(info.effectiveDueDate)}
                              {info.isExpressTrigger ? ' · Express' : ''}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <button
                              type="button"
                              onClick={() => onSelectOrder(order)}
                              className="font-mono font-semibold text-slate-900 hover:text-teal-700 cursor-pointer tabular-nums"
                            >
                              {order.ticketNumber}
                            </button>
                            <div className="text-[11px] text-slate-500">
                              Casier {order.rackSlot || '—'} · {order.commune}
                              {deliveryTask ? ` · Livraison ${deliveryTask.timeSlot}` : ''}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-slate-900">{order.clientName}</div>
                            <div className="font-mono text-[11px] text-slate-500">
                              {order.clientPhone}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span
                              className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.bgClass} ${meta.textClass} ${meta.borderClass}`}
                            >
                              {meta.shortLabel}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            {remaining > 0 ? (
                              <span className="font-semibold text-amber-800">
                                {formatFCFA(remaining)}
                              </span>
                            ) : (
                              <span className="text-emerald-700">Soldé</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
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
                              <button
                                type="button"
                                onClick={() => onSelectOrder(order)}
                                className="rounded-md p-1.5 text-slate-500 hover:bg-white hover:text-slate-900 cursor-pointer"
                                title="Ouvrir le reçu"
                                aria-label="Ouvrir le reçu"
                              >
                                <Printer className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {filteredAlerts.length > 5 && (
              <div className="border-t border-slate-200 bg-slate-50/70 px-5 py-2 text-center">
                <button
                  type="button"
                  onClick={() => setShowAllAlerts((v) => !v)}
                  className="text-xs font-medium text-teal-700 hover:text-teal-800 cursor-pointer"
                >
                  {showAllAlerts
                    ? 'Réduire la liste des alertes'
                    : `Afficher les ${filteredAlerts.length - 5} autre(s) commande(s) urgente(s)`}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* KPI Strip */}
      <section aria-label="Indicateurs clés">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Encaissements du jour</div>
            <div className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {formatFCFA(todayRevenue)}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {todayPayments.length} règlement{todayPayments.length > 1 ? 's' : ''} · Dépenses{' '}
              <span className="font-mono tabular-nums">{formatFCFA(todayExpenses)}</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Tickets en atelier</div>
            <div className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {activeOrders.length}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {orders.filter((o) => o.status === 'recu').length} reçus ·{' '}
              {orders.filter((o) => o.status === 'lavage').length} en lavage ·{' '}
              {orders.filter((o) => o.status === 'repassage').length} repassage
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Prêts pour retrait</div>
            <div className="mt-2 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
              {readyOrders.length}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {readyOrders.reduce(
                (s, o) =>
                  s +
                  o.items.reduce(
                    (q, i) => q + (i.unit === 'kg' ? 0 : i.quantity * (i.piecesPerUnit || 1)),
                    0
                  ),
                0
              )}{' '}
              articles sur cintres prêts
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Soldes clients à encaisser</div>
            <div className="mt-2 font-mono text-2xl font-bold text-amber-800 tabular-nums">
              {formatFCFA(unpaidTotal)}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Sur {orders.filter((o) => o.totalFCFA > o.paidFCFA).length} ticket(s) non soldés
            </div>
          </div>
        </div>
      </section>

      {/* Monthly Revenue Chart (Recharts) */}
      <MonthlyRevenueChart
        payments={payments}
        onCreateDeposit={() => onNavigate('pos')}
      />

      {/* Main Split: Active Queue + Mobile Money Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <section className="lg:col-span-2 rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                File de production et retraits prioritaires
              </h2>
              <p className="text-xs text-slate-500">
                Progression en 1 clic · Reçu → Lavage → Repassage → Prêt → Livré
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigate('orders')}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap"
              >
                <span>Tout voir</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('pos')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Nouveau dépôt</span>
              </button>
            </div>
          </div>

          {urgentQueue.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-medium text-slate-700">
                Aucune commande en cours dans l&apos;atelier.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Enregistrez un premier dépôt client au comptoir pour démarrer.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('pos')}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Créer un dépôt</span>
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-slate-500">
                    <th className="py-2.5 px-4 font-medium">Ticket / Casier</th>
                    <th className="py-2.5 px-3 font-medium">Client</th>
                    <th className="py-2.5 px-3 font-medium">Retrait</th>
                    <th className="py-2.5 px-3 font-medium">Statut</th>
                    <th className="py-2.5 px-3 font-medium text-right">Reste</th>
                    <th className="py-2.5 px-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {urgentQueue.map((order) => {
                    const meta = STATUS_META[order.status];
                    const remaining = Math.max(0, order.totalFCFA - order.paidFCFA);
                    const urgencyInfo = getOrderUrgency(order, today);
                    const isOverdue = urgencyInfo.urgency === 'overdue';
                    const isDueToday = urgencyInfo.urgency === 'today';
                    const pieces = order.items.reduce(
                      (s, i) => s + (i.unit === 'kg' ? 0 : i.quantity * (i.piecesPerUnit || 1)),
                      0
                    );
                    const kgTotal = order.items.reduce(
                      (s, i) =>
                        s +
                        (i.weightKg
                          ? i.quantity * i.weightKg
                          : i.unit === 'kg'
                          ? i.quantity
                          : 0),
                      0
                    );
                    const expressCount = order.items.filter((i) => i.isExpress).length;
                    const expressLabel =
                      expressCount > 0 && expressCount < order.items.length
                        ? `Express (${expressCount}/${order.items.length})`
                        : order.isExpress
                        ? 'Express'
                        : '';
                    return (
                      <tr
                        key={order.id}
                        className={
                          isOverdue
                            ? 'bg-red-50/25 hover:bg-red-50/50 transition-colors'
                            : isDueToday
                            ? 'bg-amber-50/25 hover:bg-amber-50/50 transition-colors'
                            : 'hover:bg-slate-50/80 transition-colors'
                        }
                      >
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => onSelectOrder(order)}
                            className="font-mono font-semibold text-slate-900 hover:text-teal-700 cursor-pointer tabular-nums"
                          >
                            {order.ticketNumber}
                          </button>
                          <div className="text-[11px] text-slate-500">
                            Casier {order.rackSlot || '—'}
                            {pieces > 0 ? ` · ${pieces} art.` : ''}
                            {kgTotal > 0 ? ` · ${formatWeightKg(kgTotal)}` : ''}
                            {expressLabel ? ` · ${expressLabel}` : ''}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-slate-900">{order.clientName}</div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {order.clientPhone}
                          </div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`font-mono tabular-nums ${
                              isOverdue
                                ? 'font-semibold text-red-700'
                                : isDueToday
                                ? 'font-semibold text-amber-800'
                                : 'text-slate-700'
                            }`}
                          >
                            {formatDateFR(urgencyInfo.effectiveDueDate)}
                          </span>
                          {isOverdue && (
                            <div className="text-[11px] font-medium text-red-700">
                              En retard ({urgencyInfo.daysLate} j)
                            </div>
                          )}
                          {isDueToday && (
                            <div className="text-[11px] font-medium text-amber-800">
                              Aujourd&apos;hui
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.bgClass} ${meta.textClass} ${meta.borderClass}`}
                          >
                            {meta.shortLabel}
                          </span>
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
                            <button
                              type="button"
                              onClick={() => onSelectOrder(order)}
                              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                              title="Ouvrir le ticket"
                              aria-label="Ouvrir le ticket"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Payment Channels Summary */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-semibold text-slate-900">
              Répartition des encaissements
            </h2>
            <p className="text-xs text-slate-500">
              Total cumulé en base locale :{' '}
              <span className="font-mono font-semibold text-slate-800 tabular-nums">
                {formatFCFA(totalCollectedAllTime)}
              </span>
            </p>
          </div>

          <div className="space-y-3.5">
            {paymentBreakdown.map((row) => {
              const pct =
                totalCollectedAllTime > 0
                  ? Math.round((row.amount / totalCollectedAllTime) * 100)
                  : 0;
              return (
                <div key={row.method} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">{row.label}</span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {formatFCFA(row.amount)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-sm bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-teal-700 transition-all duration-200"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => onNavigate('cashbook')}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              Ouvrir le journal de caisse & dépenses
            </button>
          </div>
        </section>
      </div>

      {/* Active Home Pickups & Deliveries Strip */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Truck className="h-4 w-4 text-teal-700" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Enlèvements & Livraisons à domicile à suivre
              </h2>
              <p className="text-xs text-slate-500">
                Ramassages chez les clients et tournées de remise en cours
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('logistics')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-800 cursor-pointer whitespace-nowrap"
          >
            <span>Gérer les tournées</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {logistics.filter((l) => l.status === 'planifie' || l.status === 'en_cours').length ===
        0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Aucune course d&apos;enlèvement ou de livraison en attente.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {logistics
              .filter((l) => l.status === 'planifie' || l.status === 'en_cours')
              .slice(0, 4)
              .map((task) => {
                const st = LOGISTICS_STATUS_META[task.status];
                return (
                  <div
                    key={task.id}
                    className="flex flex-wrap items-center justify-between gap-4 px-5 py-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900">
                        {LOGISTICS_TYPE_LABELS[task.type]} · {task.clientName}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {task.commune}
                        {task.addressDetail ? ` — ${task.addressDetail}` : ''} · Livreur :{' '}
                        {task.courierName}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                        {formatDateFR(task.scheduledDate)} · {task.timeSlot}
                      </span>
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${st.bgClass} ${st.textClass} ${st.borderClass}`}
                      >
                        {st.label}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </section>
    </div>
  );
};
