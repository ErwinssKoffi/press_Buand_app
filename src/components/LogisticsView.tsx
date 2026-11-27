import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  MapPin,
  Plus,
  Search,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import {
  Client,
  DeliveryZone,
  LogisticsStatus,
  LogisticsTask,
  LogisticsType,
  PressingOrder,
} from '../types/pressing';
import {
  ABIDJAN_COMMUNES,
  formatDateFR,
  formatFCFA,
  getTodayISO,
  LOGISTICS_STATUS_META,
  LOGISTICS_TYPE_LABELS,
  TIME_SLOTS,
} from '../utils/formatters';

interface LogisticsViewProps {
  logistics: LogisticsTask[];
  zones: DeliveryZone[];
  clients: Client[];
  orders: PressingOrder[];
  onSaveTask: (task: LogisticsTask) => Promise<void>;
  onUpdateStatus: (id: string, status: LogisticsStatus) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  onSaveZone: (zone: DeliveryZone) => Promise<void>;
  onDeleteZone: (id: string) => Promise<void>;
  onCreateDepositFromPickup: (task: LogisticsTask) => void;
  onOpenOrder: (order: PressingOrder) => void;
}

type SubView = 'missions' | 'zones';
type TypeFilter = 'tous' | LogisticsType;

export const LogisticsView: React.FC<LogisticsViewProps> = ({
  logistics,
  zones,
  clients,
  orders,
  onSaveTask,
  onUpdateStatus,
  onDeleteTask,
  onSaveZone,
  onDeleteZone,
  onCreateDepositFromPickup,
  onOpenOrder,
}) => {
  const [subView, setSubView] = useState<SubView>('missions');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('tous');
  const [statusFilter, setStatusFilter] = useState<'actifs' | 'tous' | LogisticsStatus>('actifs');
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Task Modal
  const [editingTask, setEditingTask] = useState<LogisticsTask | null>(null);
  const [isNewTask, setIsNewTask] = useState(false);

  // Zone Modal
  const [editingZone, setEditingZone] = useState<DeliveryZone | null>(null);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logistics.filter((t) => {
      if (typeFilter !== 'tous' && t.type !== typeFilter) return false;
      if (statusFilter === 'actifs') {
        if (t.status === 'effectue' || t.status === 'annule') return false;
      } else if (statusFilter !== 'tous' && t.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        t.clientName.toLowerCase().includes(q) ||
        t.clientPhone.toLowerCase().includes(q) ||
        t.commune.toLowerCase().includes(q) ||
        t.courierName.toLowerCase().includes(q) ||
        (t.ticketNumber || '').toLowerCase().includes(q)
      );
    });
  }, [logistics, typeFilter, statusFilter, search]);

  const stats = useMemo(() => {
    const activePickups = logistics.filter(
      (t) => t.type === 'enlevement' && (t.status === 'planifie' || t.status === 'en_cours')
    ).length;
    const activeDeliveries = logistics.filter(
      (t) => t.type === 'livraison' && (t.status === 'planifie' || t.status === 'en_cours')
    ).length;
    const inRoute = logistics.filter((t) => t.status === 'en_cours').length;
    const completedToday = logistics.filter(
      (t) => t.status === 'effectue' && t.scheduledDate === getTodayISO()
    ).length;
    return { activePickups, activeDeliveries, inRoute, completedToday };
  }, [logistics]);

  const openNewTask = (defaultType: LogisticsType) => {
    const defaultClient = clients[0];
    const commune = defaultClient?.commune || ABIDJAN_COMMUNES[1];
    const matchedZone = zones.find((z) => z.commune === commune);
    const fee =
      defaultType === 'enlevement'
        ? matchedZone?.pickupFeeFCFA ?? 1000
        : matchedZone?.feeFCFA ?? 1500;

    setIsNewTask(true);
    setEditingTask({
      id: `log-${Date.now()}`,
      type: defaultType,
      status: 'planifie',
      clientId: defaultClient?.id || '',
      clientName: defaultClient?.fullName || '',
      clientPhone: defaultClient?.phone || '+225 ',
      commune,
      addressDetail: defaultClient?.addressNote || '',
      scheduledDate: getTodayISO(),
      timeSlot: TIME_SLOTS[1],
      courierName: 'Koné Moussa',
      courierPhone: '+225 07 12 33 45 60',
      estimatedPieces: defaultType === 'enlevement' ? 5 : undefined,
      feeFCFA: fee,
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleSelectClientInTask = (cid: string) => {
    if (!editingTask) return;
    const cli = clients.find((c) => c.id === cid);
    if (!cli) {
      setEditingTask({ ...editingTask, clientId: cid });
      return;
    }
    const zone = zones.find((z) => z.commune === cli.commune);
    const fee =
      editingTask.type === 'enlevement'
        ? zone?.pickupFeeFCFA ?? editingTask.feeFCFA
        : zone?.feeFCFA ?? editingTask.feeFCFA;
    setEditingTask({
      ...editingTask,
      clientId: cli.id,
      clientName: cli.fullName,
      clientPhone: cli.phone,
      commune: cli.commune,
      addressDetail: cli.addressNote || editingTask.addressDetail,
      feeFCFA: fee,
    });
  };

  const handleSelectOrderInTask = (oid: string) => {
    if (!editingTask) return;
    const ord = orders.find((o) => o.id === oid);
    if (!ord) {
      setEditingTask({ ...editingTask, orderId: undefined, ticketNumber: undefined });
      return;
    }
    const cli = clients.find((c) => c.id === ord.clientId);
    const remaining = Math.max(0, ord.totalFCFA - ord.paidFCFA);
    setEditingTask({
      ...editingTask,
      orderId: ord.id,
      ticketNumber: ord.ticketNumber,
      clientId: ord.clientId,
      clientName: ord.clientName,
      clientPhone: ord.clientPhone,
      commune: ord.commune !== ABIDJAN_COMMUNES[0] ? ord.commune : editingTask.commune,
      addressDetail: cli?.addressNote || editingTask.addressDetail,
      notes:
        remaining > 0
          ? `Solde à encaisser à la remise : ${formatFCFA(remaining)}`
          : 'Ticket déjà soldé',
    });
  };

  const handleSaveTaskForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask || !editingTask.clientName.trim()) return;
    await onSaveTask({
      ...editingTask,
      clientName: editingTask.clientName.trim(),
      clientPhone: editingTask.clientPhone.trim(),
      addressDetail: editingTask.addressDetail.trim(),
      courierName: editingTask.courierName.trim() || 'Livreur interne',
      feeFCFA: Math.max(0, Math.round(editingTask.feeFCFA)),
    });
    setEditingTask(null);
  };

  const handleCopyCourierBrief = async (task: LogisticsTask) => {
    const lines = [
      `MISSION ${task.type === 'enlevement' ? 'ENLÈVEMENT' : 'LIVRAISON'}`,
      `Client : ${task.clientName} (${task.clientPhone})`,
      `Zone : ${task.commune}`,
      `Adresse / Repère : ${task.addressDetail || 'Appeler le client'}`,
      `Date & Créneau : ${formatDateFR(task.scheduledDate)} · ${task.timeSlot}`,
      task.ticketNumber ? `Ticket : ${task.ticketNumber}` : '',
      task.estimatedPieces ? `Volume estimé : ${task.estimatedPieces} pièce(s)` : '',
      `Frais course : ${formatFCFA(task.feeFCFA)}`,
      task.notes ? `Consigne : ${task.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await navigator.clipboard.writeText(lines);
      setCopiedId(task.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleSaveZoneForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingZone || !editingZone.commune.trim()) return;
    await onSaveZone({
      ...editingZone,
      commune: editingZone.commune.trim(),
      feeFCFA: Math.max(0, Math.round(editingZone.feeFCFA)),
      pickupFeeFCFA: Math.max(0, Math.round(editingZone.pickupFeeFCFA)),
    });
    setEditingZone(null);
  };

  const readyOrActiveOrders = orders.filter((o) => o.status !== 'livre');

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Enlèvements à effectuer</div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {stats.activePickups}
          </div>
          <div className="mt-1 text-xs text-slate-500">Ramassages chez les clients</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Livraisons à effectuer</div>
          <div className="mt-2 font-mono text-2xl font-bold text-teal-700 tabular-nums">
            {stats.activeDeliveries}
          </div>
          <div className="mt-1 text-xs text-slate-500">Remises à domicile planifiées</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Courses en tournée</div>
          <div className="mt-2 font-mono text-2xl font-bold text-sky-700 tabular-nums">
            {stats.inRoute}
          </div>
          <div className="mt-1 text-xs text-slate-500">Livreurs actuellement sur le terrain</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Clôturées aujourd&apos;hui</div>
          <div className="mt-2 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
            {stats.completedToday}
          </div>
          <div className="mt-1 text-xs text-slate-500">Missions terminées ce jour</div>
        </div>
      </div>

      {/* Main Workspace Card */}
      <div className="rounded-xl border border-slate-200 bg-white">
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 p-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSubView('missions')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors cursor-pointer ${
                subView === 'missions'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Truck className="h-3.5 w-3.5" />
              <span>Planning Enlèvements & Livraisons</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('zones')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors cursor-pointer ${
                subView === 'zones'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <MapPin className="h-3.5 w-3.5" />
              <span>Zones & Tarifs ({zones.length})</span>
            </button>
          </div>

          {subView === 'missions' ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openNewTask('enlevement')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5 text-teal-700" />
                <span>Planifier un enlèvement</span>
              </button>
              <button
                type="button"
                onClick={() => openNewTask('livraison')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Planifier une livraison</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() =>
                setEditingZone({
                  id: `zone-${Date.now()}`,
                  commune: '',
                  feeFCFA: 1500,
                  pickupFeeFCFA: 1000,
                  active: true,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Ajouter une zone</span>
            </button>
          )}
        </div>

        {subView === 'missions' ? (
          <>
            {/* Filters */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5 bg-slate-50/50">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { k: 'tous', l: 'Toutes missions' },
                    { k: 'enlevement', l: 'Enlèvements (Ramassage)' },
                    { k: 'livraison', l: 'Livraisons à domicile' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.k}
                    type="button"
                    onClick={() => setTypeFilter(tab.k)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                      typeFilter === tab.k
                        ? 'bg-slate-900 text-white'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {tab.l}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <select
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as 'actifs' | 'tous' | LogisticsStatus)
                  }
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
                >
                  <option value="actifs">En cours & Planifiées</option>
                  <option value="tous">Tout l&apos;historique</option>
                  <option value="planifie">Planifiées uniquement</option>
                  <option value="en_cours">En tournée uniquement</option>
                  <option value="effectue">Effectuées</option>
                  <option value="annule">Annulées</option>
                </select>

                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Client, quartier, livreur..."
                    className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {filteredTasks.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-500">
                Aucune mission d&apos;enlèvement ou de livraison pour ce filtre.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500">
                      <th className="py-3 px-4 font-medium">Type & Date</th>
                      <th className="py-3 px-3 font-medium">Client & Adresse précise</th>
                      <th className="py-3 px-3 font-medium">Livreur / Référence</th>
                      <th className="py-3 px-3 font-medium">Statut</th>
                      <th className="py-3 px-3 font-medium text-right">Frais course</th>
                      <th className="py-3 px-4 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredTasks.map((task) => {
                      const st = LOGISTICS_STATUS_META[task.status];
                      const linkedOrder = task.orderId
                        ? orders.find((o) => o.id === task.orderId)
                        : undefined;
                      return (
                        <tr key={task.id} className="hover:bg-slate-50/80">
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div
                              className={`font-semibold ${
                                task.type === 'enlevement'
                                  ? 'text-indigo-800'
                                  : 'text-teal-800'
                              }`}
                            >
                              {LOGISTICS_TYPE_LABELS[task.type]}
                            </div>
                            <div className="mt-0.5 font-mono text-[11px] text-slate-600 tabular-nums">
                              {formatDateFR(task.scheduledDate)} · {task.timeSlot}
                            </div>
                          </td>
                          <td className="py-3 px-3 max-w-xs">
                            <div className="font-semibold text-slate-900">
                              {task.clientName}{' '}
                              <span className="font-mono font-normal text-slate-500">
                                {task.clientPhone}
                              </span>
                            </div>
                            <div className="text-slate-700 mt-0.5">
                              {task.commune}
                              {task.addressDetail ? ` — ${task.addressDetail}` : ''}
                            </div>
                            {task.notes && (
                              <div className="text-[11px] text-amber-800 mt-0.5 truncate">
                                {task.notes}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-medium text-slate-900">{task.courierName}</div>
                            <div className="text-[11px] text-slate-500">
                              {linkedOrder ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenOrder(linkedOrder)}
                                  className="font-mono font-semibold text-teal-700 hover:underline cursor-pointer"
                                >
                                  Ticket {linkedOrder.ticketNumber}
                                </button>
                              ) : task.estimatedPieces ? (
                                `~${task.estimatedPieces} pièce(s) à collecter`
                              ) : (
                                'Course libre'
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span
                              className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${st.bgClass} ${st.textClass} ${st.borderClass}`}
                            >
                              {st.label}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                            {formatFCFA(task.feeFCFA)}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {st.nextStatus && (
                                <button
                                  type="button"
                                  onClick={() => onUpdateStatus(task.id, st.nextStatus!)}
                                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                                >
                                  {st.nextActionLabel}
                                </button>
                              )}

                              {task.type === 'enlevement' && !task.orderId && (
                                <button
                                  type="button"
                                  onClick={() => onCreateDepositFromPickup(task)}
                                  className="inline-flex items-center gap-1 rounded-md bg-teal-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-800 cursor-pointer"
                                  title="Créer le ticket de dépôt pour ces vêtements"
                                >
                                  <span>Créer dépôt</span>
                                  <ArrowRight className="h-3 w-3" />
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => handleCopyCourierBrief(task)}
                                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                                title="Copier fiche course pour le livreur (WhatsApp)"
                              >
                                {copiedId === task.id ? (
                                  <Check className="h-3.5 w-3.5 text-emerald-700" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setIsNewTask(false);
                                  setEditingTask(task);
                                }}
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 cursor-pointer"
                              >
                                Modifier
                              </button>

                              {confirmDeleteId === task.id ? (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await onDeleteTask(task.id);
                                    setConfirmDeleteId(null);
                                  }}
                                  className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white cursor-pointer"
                                >
                                  Confirmer
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(task.id)}
                                  className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                                  title="Supprimer"
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
          </>
        ) : (
          /* ======================== ZONES & TARIFS DE LIVRAISON ======================== */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500">
                  <th className="py-3 px-5 font-medium">Commune / Secteur</th>
                  <th className="py-3 px-3 font-medium text-right">Tarif Enlèvement (FCFA)</th>
                  <th className="py-3 px-3 font-medium text-right">Tarif Livraison (FCFA)</th>
                  <th className="py-3 px-3 font-medium">Statut</th>
                  <th className="py-3 px-5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {zones.map((z) => (
                  <tr key={z.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-5 font-medium text-slate-900">{z.commune}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      {formatFCFA(z.pickupFeeFCFA)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold tabular-nums text-slate-900">
                      {formatFCFA(z.feeFCFA)}
                    </td>
                    <td className="py-3 px-3">
                      <button
                        type="button"
                        onClick={() => onSaveZone({ ...z, active: !z.active })}
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium cursor-pointer ${
                          z.active
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-slate-200 bg-slate-100 text-slate-500'
                        }`}
                      >
                        {z.active ? 'Desservie' : 'Suspendue'}
                      </button>
                    </td>
                    <td className="py-3 px-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingZone(z)}
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                        >
                          Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteZone(z.id)}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                          title="Supprimer cette zone"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Add / Edit Mission */}
      {editingTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl my-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                {isNewTask ? 'Planifier une course' : 'Modifier la mission'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingTask(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTaskForm} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Type de mission
                  </label>
                  <select
                    value={editingTask.type}
                    onChange={(e) =>
                      setEditingTask({
                        ...editingTask,
                        type: e.target.value as LogisticsType,
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  >
                    <option value="enlevement">Enlèvement (Ramassage client)</option>
                    <option value="livraison">Livraison à domicile</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Statut
                  </label>
                  <select
                    value={editingTask.status}
                    onChange={(e) =>
                      setEditingTask({
                        ...editingTask,
                        status: e.target.value as LogisticsStatus,
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  >
                    {Object.entries(LOGISTICS_STATUS_META).map(([k, meta]) => (
                      <option key={k} value={k}>
                        {meta.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {editingTask.type === 'livraison' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Associer à un ticket (optionnel)
                  </label>
                  <select
                    value={editingTask.orderId || ''}
                    onChange={(e) => handleSelectOrderInTask(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  >
                    <option value="">— Aucun ticket associé —</option>
                    {readyOrActiveOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.ticketNumber} · {o.clientName} ({formatFCFA(o.totalFCFA)})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Client existant
                  </label>
                  <select
                    value={editingTask.clientId}
                    onChange={(e) => handleSelectClientInTask(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  >
                    <option value="">— Saisie manuelle —</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nom du client
                  </label>
                  <input
                    type="text"
                    required
                    value={editingTask.clientName}
                    onChange={(e) =>
                      setEditingTask({ ...editingTask, clientName: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Téléphone client
                  </label>
                  <input
                    type="tel"
                    required
                    value={editingTask.clientPhone}
                    onChange={(e) =>
                      setEditingTask({ ...editingTask, clientPhone: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono focus:border-teal-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Commune / Zone
                  </label>
                  <select
                    value={editingTask.commune}
                    onChange={(e) => {
                      const com = e.target.value;
                      const z = zones.find((zn) => zn.commune === com);
                      const nextFee = z
                        ? editingTask.type === 'enlevement'
                          ? z.pickupFeeFCFA
                          : z.feeFCFA
                        : editingTask.feeFCFA;
                      setEditingTask({ ...editingTask, commune: com, feeFCFA: nextFee });
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  >
                    {Array.from(
                      new Set([
                        ...zones.filter((z) => z.active).map((z) => z.commune),
                        ...ABIDJAN_COMMUNES.slice(1),
                      ])
                    ).map((com) => (
                      <option key={com} value={com}>
                        {com}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Adresse exacte / Point de repère
                </label>
                <input
                  type="text"
                  required
                  value={editingTask.addressDetail}
                  onChange={(e) =>
                    setEditingTask({ ...editingTask, addressDetail: e.target.value })
                  }
                  placeholder="Ex: Riviera Palmeraie, derrière pharmacie..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={editingTask.scheduledDate}
                    onChange={(e) =>
                      setEditingTask({ ...editingTask, scheduledDate: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Créneau horaire
                  </label>
                  <select
                    value={editingTask.timeSlot}
                    onChange={(e) =>
                      setEditingTask({ ...editingTask, timeSlot: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  >
                    {TIME_SLOTS.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Frais (FCFA)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={250}
                    value={editingTask.feeFCFA}
                    onChange={(e) =>
                      setEditingTask({
                        ...editingTask,
                        feeFCFA: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Livreur assigné
                  </label>
                  <input
                    type="text"
                    value={editingTask.courierName}
                    onChange={(e) =>
                      setEditingTask({ ...editingTask, courierName: e.target.value })
                    }
                    placeholder="Ex: Koné Moussa"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  />
                </div>
                {editingTask.type === 'enlevement' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Nb pièces estimé
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={editingTask.estimatedPieces ?? 5}
                      onChange={(e) =>
                        setEditingTask({
                          ...editingTask,
                          estimatedPieces: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums focus:border-teal-600 focus:outline-none"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Consigne pour le livreur
                </label>
                <input
                  type="text"
                  value={editingTask.notes || ''}
                  onChange={(e) => setEditingTask({ ...editingTask, notes: e.target.value })}
                  placeholder="Ex: Appeler 15 min avant arrivée, solde à encaisser..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingTask(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer"
                >
                  Enregistrer la mission
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Add / Edit Delivery Zone */}
      {editingZone && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                Zone de livraison & ramassage
              </h3>
              <button
                type="button"
                onClick={() => setEditingZone(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveZoneForm} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Commune / Quartier
                </label>
                <input
                  type="text"
                  required
                  value={editingZone.commune}
                  onChange={(e) =>
                    setEditingZone({ ...editingZone, commune: e.target.value })
                  }
                  placeholder="Ex: Cocody — Faya"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tarif enlèvement (FCFA)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={250}
                    required
                    value={editingZone.pickupFeeFCFA}
                    onChange={(e) =>
                      setEditingZone({
                        ...editingZone,
                        pickupFeeFCFA: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tarif livraison (FCFA)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={250}
                    required
                    value={editingZone.feeFCFA}
                    onChange={(e) =>
                      setEditingZone({
                        ...editingZone,
                        feeFCFA: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingZone(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
