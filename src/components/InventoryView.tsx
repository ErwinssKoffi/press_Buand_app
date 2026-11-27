import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Download,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {
  InventoryCategory,
  InventoryItem,
  InventoryMovement,
  InventoryMovementType,
  PaymentMethod,
  ShopActivityScope,
} from '../types/pressing';
import {
  formatDateTimeFR,
  formatFCFA,
  getTodayISO,
  INVENTORY_ACTIVITY_LABELS,
  INVENTORY_CATEGORIES,
  INVENTORY_MOVEMENT_LABELS,
  INVENTORY_UNITS,
  PAYMENT_METHOD_LABELS,
} from '../utils/formatters';

interface InventoryViewProps {
  items: InventoryItem[];
  movements: InventoryMovement[];
  onSaveItem: (item: InventoryItem) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
  onRecordMovement: (params: {
    itemId: string;
    type: InventoryMovementType;
    quantity: number;
    unitCostFCFA?: number;
    reason: string;
    recordExpense?: boolean;
    paymentMethod?: PaymentMethod;
  }) => Promise<void>;
}

type CategoryFilter = 'Tout' | 'alertes' | InventoryCategory;
type ActivityFilter = 'all' | ShopActivityScope;

function getStockStatus(item: InventoryItem) {
  if (item.quantity <= 0) {
    return {
      key: 'out' as const,
      label: 'Rupture',
      className: 'border-red-200 bg-red-50 text-red-700',
    };
  }
  if (item.quantity <= item.minThreshold) {
    return {
      key: 'low' as const,
      label: 'Stock bas',
      className: 'border-amber-200 bg-amber-50 text-amber-800',
    };
  }
  return {
    key: 'ok' as const,
    label: 'Disponible',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  };
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  items,
  movements,
  onSaveItem,
  onDeleteItem,
  onRecordMovement,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('Tout');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [search, setSearch] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Create / Edit Modal
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [isNewItem, setIsNewItem] = useState(false);

  // Stock Movement Modal
  const [movementTarget, setMovementTarget] = useState<InventoryItem | null>(null);
  const [movType, setMovType] = useState<InventoryMovementType>('entree');
  const [movQuantity, setMovQuantity] = useState<string>('1');
  const [movUnitCost, setMovUnitCost] = useState<string>('0');
  const [movReason, setMovReason] = useState<string>('');
  const [movRecordExpense, setMovRecordExpense] = useState<boolean>(true);
  const [movPaymentMethod, setMovPaymentMethod] = useState<PaymentMethod>('especes');
  const [savingMov, setSavingMov] = useState(false);

  const stats = useMemo(() => {
    const outOfStock = items.filter((i) => i.quantity <= 0).length;
    const lowStock = items.filter((i) => i.quantity > 0 && i.quantity <= i.minThreshold).length;
    const totalValue = items.reduce((s, i) => s + i.quantity * i.unitCostFCFA, 0);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const recentMovements = movements.filter((m) => m.createdAt >= sevenDaysAgo);
    const recentEntries = recentMovements.filter((m) => m.type === 'entree').length;
    const recentExits = recentMovements.filter((m) => m.type === 'sortie').length;

    return {
      totalItems: items.length,
      alertsCount: outOfStock + lowStock,
      outOfStock,
      lowStock,
      totalValue,
      recentEntries,
      recentExits,
    };
  }, [items, movements]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (categoryFilter === 'alertes') {
        if (item.quantity > item.minThreshold) return false;
      } else if (categoryFilter !== 'Tout' && item.category !== categoryFilter) {
        return false;
      }

      if (activityFilter !== 'all' && item.activityScope !== activityFilter) {
        return false;
      }

      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        (item.sku || '').toLowerCase().includes(q) ||
        (item.supplier || '').toLowerCase().includes(q)
      );
    });
  }, [items, categoryFilter, activityFilter, search]);

  const openNewItemModal = () => {
    setIsNewItem(true);
    setEditingItem({
      id: `inv-${Date.now()}`,
      name: '',
      sku: '',
      category: 'Lessives & Détachants',
      activityScope: 'both',
      unit: 'bidon',
      quantity: 0,
      minThreshold: 2,
      unitCostFCFA: 5000,
      supplier: '',
      notes: '',
      updatedAt: new Date().toISOString(),
    });
  };

  const openEditItemModal = (item: InventoryItem) => {
    setIsNewItem(false);
    setEditingItem({ ...item });
  };

  const openMovementModal = (item: InventoryItem, type: InventoryMovementType) => {
    setMovementTarget(item);
    setMovType(type);
    setMovQuantity(type === 'ajustement' ? String(item.quantity) : '1');
    setMovUnitCost(String(item.unitCostFCFA));
    setMovReason(
      type === 'entree'
        ? item.supplier
          ? `Réapprovisionnement ${item.supplier}`
          : 'Réapprovisionnement fournisseur'
        : type === 'sortie'
        ? 'Consommation atelier'
        : 'Inventaire physique'
    );
    setMovRecordExpense(type === 'entree');
    setMovPaymentMethod('especes');
  };

  const handleSaveItemForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editingItem.name.trim()) return;
    await onSaveItem({
      ...editingItem,
      name: editingItem.name.trim(),
      sku: editingItem.sku?.trim() || undefined,
      supplier: editingItem.supplier?.trim() || undefined,
      notes: editingItem.notes?.trim() || undefined,
      quantity: Math.max(0, Number(editingItem.quantity) || 0),
      minThreshold: Math.max(0, Number(editingItem.minThreshold) || 0),
      unitCostFCFA: Math.max(0, Math.round(Number(editingItem.unitCostFCFA) || 0)),
    });
    setEditingItem(null);
  };

  const handleSubmitMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!movementTarget) return;
    const qtyNum = Math.max(0, Number(movQuantity) || 0);
    if (movType !== 'ajustement' && qtyNum <= 0) return;

    setSavingMov(true);
    try {
      await onRecordMovement({
        itemId: movementTarget.id,
        type: movType,
        quantity: qtyNum,
        unitCostFCFA: movType === 'entree' ? Math.max(0, Number(movUnitCost) || 0) : undefined,
        reason: movReason,
        recordExpense: movType === 'entree' ? movRecordExpense : false,
        paymentMethod: movPaymentMethod,
      });
      setMovementTarget(null);
    } finally {
      setSavingMov(false);
    }
  };

  const handleExportCSV = () => {
    const rows = [
      [
        'Référence',
        'Produit',
        'Catégorie',
        'Activité',
        'Quantité',
        'Unité',
        'Seuil alerte',
        'Coût unitaire (FCFA)',
        'Valeur stock (FCFA)',
        'Fournisseur',
      ],
      ...items.map((i) => [
        i.sku || '',
        i.name,
        i.category,
        INVENTORY_ACTIVITY_LABELS[i.activityScope],
        String(i.quantity),
        i.unit,
        String(i.minThreshold),
        String(i.unitCostFCFA),
        String(i.quantity * i.unitCostFCFA),
        i.supplier || '',
      ]),
    ];

    const csv = rows
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stocks-pressing-${getTodayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const movQtyNumeric = Math.max(0, Number(movQuantity) || 0);
  const movCostNumeric = Math.max(0, Math.round(Number(movUnitCost) || 0));
  const movTotalPurchaseCost =
    movType === 'entree' ? Math.round(movQtyNumeric * movCostNumeric) : 0;

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <section aria-label="Indicateurs de stock">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Références suivies</div>
            <div className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {stats.totalItems}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {items.filter((i) => i.activityScope === 'pressing').length} pressing ·{' '}
              {items.filter((i) => i.activityScope === 'blanchisserie').length} blanchisserie ·{' '}
              {items.filter((i) => i.activityScope === 'both').length} communs
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Alertes réapprovisionnement</div>
            <div
              className={`mt-2 font-mono text-2xl font-bold tabular-nums ${
                stats.alertsCount > 0 ? 'text-amber-800' : 'text-emerald-700'
              }`}
            >
              {stats.alertsCount}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {stats.outOfStock} en rupture · {stats.lowStock} sous le seuil min
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Valorisation du stock</div>
            <div className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {formatFCFA(stats.totalValue)}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Basée sur le dernier coût d&apos;achat unitaire
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Mouvements (7 derniers jours)</div>
            <div className="mt-2 font-mono text-2xl font-bold text-teal-800 tabular-nums">
              {stats.recentEntries + stats.recentExits}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {stats.recentEntries} entrée{stats.recentEntries > 1 ? 's' : ''} ·{' '}
              {stats.recentExits} sortie{stats.recentExits > 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </section>

      {/* Main Inventory Table */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Stock des produits & consommables
            </h2>
            <p className="text-xs text-slate-500">
              Lessives, détachants, solvants à sec, cintres, housses et consommables comptoir
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Exporter CSV</span>
            </button>
            <button
              type="button"
              onClick={openNewItemModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Nouveau produit</span>
            </button>
          </div>
        </div>

        {/* Filters & Search */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5 bg-slate-50/50">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCategoryFilter('Tout')}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                categoryFilter === 'Tout'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              Tout <span className="ml-1 font-mono opacity-75 tabular-nums">{items.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('alertes')}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                categoryFilter === 'alertes'
                  ? 'bg-amber-700 text-white'
                  : 'bg-white border border-slate-200 text-amber-800 hover:bg-amber-50'
              }`}
            >
              Alertes{' '}
              <span className="ml-1 font-mono opacity-80 tabular-nums">{stats.alertsCount}</span>
            </button>
            {INVENTORY_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  categoryFilter === cat
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            <select
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value as ActivityFilter)}
              aria-label="Filtrer par activité"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-teal-600 focus:outline-none"
            >
              <option value="all">Toutes activités</option>
              <option value="pressing">Pressing uniquement</option>
              <option value="blanchisserie">Blanchisserie uniquement</option>
              <option value="both">Pressing & Blanchisserie</option>
            </select>

            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Produit, SKU, fournisseur..."
                className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        {filteredItems.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-700">
              Aucun produit ou consommable trouvé.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Modifiez vos filtres ou ajoutez une nouvelle référence de stock.
            </p>
            <button
              type="button"
              onClick={openNewItemModal}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Ajouter un produit</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500">
                  <th className="py-3 px-4 font-medium">Produit & Fournisseur</th>
                  <th className="py-3 px-3 font-medium">Catégorie & Activité</th>
                  <th className="py-3 px-3 font-medium text-right">Stock actuel</th>
                  <th className="py-3 px-3 font-medium">État</th>
                  <th className="py-3 px-3 font-medium text-right">Coût U. / Valeur</th>
                  <th className="py-3 px-4 font-medium text-right">Mouvements & Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.map((item) => {
                  const status = getStockStatus(item);
                  const rowValue = item.quantity * item.unitCostFCFA;
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{item.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {item.sku ? <span className="font-mono">{item.sku}</span> : null}
                          {item.sku && item.supplier ? ' · ' : ''}
                          {item.supplier || (!item.sku ? 'Fournisseur non renseigné' : '')}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="text-slate-700">{item.category}</div>
                        <div className="text-[11px] text-slate-500">
                          {INVENTORY_ACTIVITY_LABELS[item.activityScope]}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div className="font-mono font-bold text-slate-900 tabular-nums">
                          {item.quantity} {item.unit}
                          {item.quantity > 1 && item.unit !== 'L' && item.unit !== 'kg' ? 's' : ''}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                          Seuil min : {item.minThreshold}
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-right whitespace-nowrap font-mono tabular-nums">
                        <div className="text-slate-900 font-semibold">{formatFCFA(rowValue)}</div>
                        <div className="text-[11px] text-slate-500">
                          {formatFCFA(item.unitCostFCFA)} / {item.unit}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openMovementModal(item, 'entree')}
                            className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-800 hover:bg-teal-100 cursor-pointer"
                            title="Enregistrer une entrée en stock"
                          >
                            <ArrowUpRight className="h-3 w-3" />
                            <span>Entrée</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openMovementModal(item, 'sortie')}
                            disabled={item.quantity <= 0}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                            title="Enregistrer une sortie atelier"
                          >
                            <ArrowDownRight className="h-3 w-3" />
                            <span>Sortie</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openMovementModal(item, 'ajustement')}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                            title="Ajuster le stock réel (inventaire)"
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditItemModal(item)}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                            title="Modifier la fiche produit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {confirmDeleteId === item.id ? (
                            <button
                              type="button"
                              onClick={async () => {
                                await onDeleteItem(item.id);
                                setConfirmDeleteId(null);
                              }}
                              className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700 cursor-pointer"
                            >
                              Confirmer
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(item.id)}
                              className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                              title="Supprimer ce produit"
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
      </section>

      {/* Stock Movements Journal */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">
            Journal des mouvements de stock
          </h3>
          <p className="text-xs text-slate-500">
            Historique chronologique des réapprovisionnements, consommations atelier et inventaires
          </p>
        </div>

        {movements.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Aucun mouvement enregistré pour le moment.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500">
                  <th className="py-2.5 px-4 font-medium">Date</th>
                  <th className="py-2.5 px-3 font-medium">Produit</th>
                  <th className="py-2.5 px-3 font-medium">Opération</th>
                  <th className="py-2.5 px-3 font-medium text-right">Variation</th>
                  <th className="py-2.5 px-3 font-medium text-right">Stock avant / après</th>
                  <th className="py-2.5 px-3 font-medium">Motif</th>
                  <th className="py-2.5 px-4 font-medium text-right">Coût d&apos;achat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.slice(0, 25).map((mov) => (
                  <tr key={mov.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                      {formatDateTimeFR(mov.createdAt)}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-900">{mov.itemName}</td>
                    <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                      {INVENTORY_MOVEMENT_LABELS[mov.type]}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                        mov.quantityDelta > 0
                          ? 'text-emerald-700'
                          : mov.quantityDelta < 0
                          ? 'text-amber-800'
                          : 'text-slate-600'
                      }`}
                    >
                      {mov.quantityDelta > 0 ? `+${mov.quantityDelta}` : mov.quantityDelta}{' '}
                      {mov.unit}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600 tabular-nums whitespace-nowrap">
                      {mov.previousQty} → <strong className="text-slate-900">{mov.newQty}</strong>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate">{mov.reason}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                      {mov.totalCostFCFA ? formatFCFA(mov.totalCostFCFA) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal: Create / Edit Product */}
      {editingItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl my-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                {isNewItem ? 'Nouveau produit / article en stock' : 'Modifier la fiche produit'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveItemForm} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Désignation du produit
                  </label>
                  <input
                    type="text"
                    required
                    value={editingItem.name}
                    onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                    placeholder="Ex: Lessive liquide 20L, Cintres..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Référence / SKU
                  </label>
                  <input
                    type="text"
                    value={editingItem.sku || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, sku: e.target.value })}
                    placeholder="Ex: LES-20L"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Catégorie
                  </label>
                  <select
                    value={editingItem.category}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        category: e.target.value as InventoryCategory,
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  >
                    {INVENTORY_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Activité liée
                  </label>
                  <select
                    value={editingItem.activityScope}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        activityScope: e.target.value as ShopActivityScope,
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  >
                    <option value="both">Pressing & Blanchisserie</option>
                    <option value="pressing">Pressing uniquement</option>
                    <option value="blanchisserie">Blanchisserie uniquement</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Unité
                  </label>
                  <select
                    value={editingItem.unit}
                    onChange={(e) => setEditingItem({ ...editingItem, unit: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  >
                    {INVENTORY_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {isNewItem ? 'Stock initial' : 'Stock actuel'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={editingItem.quantity}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        quantity: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums focus:border-teal-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Seuil d&apos;alerte
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={editingItem.minThreshold}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        minThreshold: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums focus:border-teal-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Coût U. (FCFA)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={editingItem.unitCostFCFA}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        unitCostFCFA: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Fournisseur habituel
                  </label>
                  <input
                    type="text"
                    value={editingItem.supplier || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, supplier: e.target.value })}
                    placeholder="Ex: Adjamé Pro Chimie"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Note / Emplacement
                  </label>
                  <input
                    type="text"
                    value={editingItem.notes || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, notes: e.target.value })}
                    placeholder="Ex: Réserve atelier B"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer"
                >
                  {isNewItem ? 'Créer le produit' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Record Stock Movement */}
      {movementTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl my-auto">
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Mouvement de stock
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {movementTarget.name} · Actuel :{' '}
                  <strong className="font-mono text-slate-800 tabular-nums">
                    {movementTarget.quantity} {movementTarget.unit}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMovementTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitMovement} className="mt-4 space-y-4">
              <div
                className="grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5"
                role="group"
                aria-label="Type de mouvement"
              >
                {(['entree', 'sortie', 'ajustement'] as InventoryMovementType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setMovType(t);
                      setMovQuantity(t === 'ajustement' ? String(movementTarget.quantity) : '1');
                      setMovReason(
                        t === 'entree'
                          ? 'Réapprovisionnement fournisseur'
                          : t === 'sortie'
                          ? 'Consommation atelier'
                          : 'Inventaire physique'
                      );
                      setMovRecordExpense(t === 'entree');
                    }}
                    className={`rounded-md py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                      movType === t
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {t === 'entree' ? '+ Entrée' : t === 'sortie' ? '- Sortie' : 'Inventaire'}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {movType === 'ajustement'
                      ? `Nouveau stock réel (${movementTarget.unit})`
                      : `Quantité (${movementTarget.unit})`}
                  </label>
                  <input
                    type="number"
                    min={movType === 'ajustement' ? 0 : 1}
                    max={movType === 'sortie' ? movementTarget.quantity : undefined}
                    step={1}
                    required
                    value={movQuantity}
                    onChange={(e) => setMovQuantity(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums focus:border-teal-600 focus:outline-none"
                  />
                </div>

                {movType === 'entree' ? (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Coût unitaire (FCFA)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={movUnitCost}
                      onChange={(e) => setMovUnitCost(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums focus:border-teal-600 focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col justify-end">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 font-mono tabular-nums">
                      Nouveau stock :{' '}
                      <strong className="text-slate-900">
                        {movType === 'sortie'
                          ? Math.max(0, movementTarget.quantity - movQtyNumeric)
                          : movQtyNumeric}{' '}
                        {movementTarget.unit}
                      </strong>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Motif / Observation
                </label>
                <input
                  type="text"
                  required
                  value={movReason}
                  onChange={(e) => setMovReason(e.target.value)}
                  placeholder="Ex: Réapprovisionnement, utilisation blanchisserie..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>

              {movType === 'entree' && movTotalPurchaseCost > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">Montant total de l&apos;achat :</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      {formatFCFA(movTotalPurchaseCost)}
                    </span>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={movRecordExpense}
                      onChange={(e) => setMovRecordExpense(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <span>Enregistrer automatiquement en dépense de caisse</span>
                  </label>

                  {movRecordExpense && (
                    <select
                      value={movPaymentMethod}
                      onChange={(e) => setMovPaymentMethod(e.target.value as PaymentMethod)}
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                    >
                      {Object.entries(PAYMENT_METHOD_LABELS).map(([k, lbl]) => (
                        <option key={k} value={k}>
                          {lbl}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setMovementTarget(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingMov}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
                >
                  {savingMov ? 'Enregistrement...' : 'Valider le mouvement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
