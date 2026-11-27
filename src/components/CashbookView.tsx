import React, { useMemo, useState } from 'react';
import { CalendarCheck, Download, FileDown, Plus, Trash2, X } from 'lucide-react';
import {
  ExpenseCategory,
  ExpenseRecord,
  PaymentMethod,
  PaymentRecord,
  PressingOrder,
  PressingSettings,
} from '../types/pressing';
import {
  EXPENSE_CATEGORIES,
  formatDateFR,
  formatDateTimeFR,
  formatFCFA,
  getTodayISO,
  PAYMENT_METHOD_LABELS,
} from '../utils/formatters';
import { exportDailyZReportPdf, exportMonthlyReportPdf } from '../utils/cashReportPdf';

interface CashbookViewProps {
  orders: PressingOrder[];
  payments: PaymentRecord[];
  expenses: ExpenseRecord[];
  settings: PressingSettings;
  onSaveExpense: (expense: ExpenseRecord) => Promise<void>;
  onDeleteExpense: (id: string) => Promise<void>;
}

export const CashbookView: React.FC<CashbookViewProps> = ({
  orders,
  payments,
  expenses,
  settings,
  onSaveExpense,
  onDeleteExpense,
}) => {
  const [zDate, setZDate] = useState(getTodayISO());
  const [monthISO, setMonthISO] = useState(getTodayISO().slice(0, 7));

  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('Produits & Lessive');
  const [amount, setAmount] = useState('5000');
  const [method, setMethod] = useState<PaymentMethod>('especes');
  const [date, setDate] = useState(getTodayISO());
  const [note, setNote] = useState('');

  const zSummary = useMemo(() => {
    const dayPayments = payments.filter((p) => p.paidAt.slice(0, 10) === zDate);
    const dayExpenses = expenses.filter((e) => e.date === zDate);
    const cashIn = dayPayments
      .filter((p) => p.method === 'especes')
      .reduce((s, p) => s + p.amountFCFA, 0);
    const cashOut = dayExpenses
      .filter((e) => e.method === 'especes')
      .reduce((s, e) => s + e.amountFCFA, 0);
    const mobileIn = dayPayments
      .filter((p) => p.method !== 'especes')
      .reduce((s, p) => s + p.amountFCFA, 0);
    const mobileOut = dayExpenses
      .filter((e) => e.method !== 'especes')
      .reduce((s, e) => s + e.amountFCFA, 0);
    const totalInDay = cashIn + mobileIn;
    const totalOutDay = cashOut + mobileOut;
    return {
      totalInDay,
      totalOutDay,
      netDay: totalInDay - totalOutDay,
      cashNet: cashIn - cashOut,
      mobileNet: mobileIn - mobileOut,
    };
  }, [payments, expenses, zDate]);

  const monthSummary = useMemo(() => {
    const mIn = payments
      .filter((p) => p.paidAt.slice(0, 7) === monthISO)
      .reduce((s, p) => s + p.amountFCFA, 0);
    const mOut = expenses
      .filter((e) => e.date.slice(0, 7) === monthISO)
      .reduce((s, e) => s + e.amountFCFA, 0);
    return { mIn, mOut, mNet: mIn - mOut };
  }, [payments, expenses, monthISO]);

  const totalIn = useMemo(
    () => payments.reduce((sum, p) => sum + p.amountFCFA, 0),
    [payments]
  );
  const totalOut = useMemo(
    () => expenses.reduce((sum, e) => sum + e.amountFCFA, 0),
    [expenses]
  );
  const netBalance = totalIn - totalOut;

  const byMethod = useMemo(() => {
    return (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => {
      const inflow = payments
        .filter((p) => p.method === m)
        .reduce((s, p) => s + p.amountFCFA, 0);
      const outflow = expenses
        .filter((e) => e.method === m)
        .reduce((s, e) => s + e.amountFCFA, 0);
      return {
        method: m,
        label: PAYMENT_METHOD_LABELS[m],
        inflow,
        outflow,
        net: inflow - outflow,
      };
    });
  }, [payments, expenses]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const numeric = Math.round(Number(amount) || 0);
    if (!label.trim() || numeric <= 0) return;

    await onSaveExpense({
      id: `exp-${Date.now()}`,
      label: label.trim(),
      category,
      amountFCFA: numeric,
      method,
      date,
      note: note.trim() || undefined,
      createdAt: new Date().toISOString(),
    });
    setShowExpenseModal(false);
    setLabel('');
    setAmount('5000');
    setNote('');
  };

  const handleExportCSV = () => {
    const rows = [
      ['Type', 'Date', 'Libellé / Ticket', 'Catégorie / Client', 'Mode', 'Montant (FCFA)'],
      ...payments.map((p) => [
        'Recette',
        p.paidAt.slice(0, 10),
        p.ticketNumber,
        p.clientName,
        PAYMENT_METHOD_LABELS[p.method],
        String(p.amountFCFA),
      ]),
      ...expenses.map((ex) => [
        'Dépense',
        ex.date,
        ex.label,
        ex.category,
        PAYMENT_METHOD_LABELS[ex.method],
        String(-ex.amountFCFA),
      ]),
    ];

    const csv = rows
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `caisse-pressing-${getTodayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportMonthCSV = () => {
    const mPayments = payments.filter((p) => p.paidAt.slice(0, 7) === monthISO);
    const mExpenses = expenses.filter((e) => e.date.slice(0, 7) === monthISO);
    const rows = [
      ['Type', 'Date', 'Libellé / Ticket', 'Catégorie / Client', 'Mode', 'Montant (FCFA)'],
      ...mPayments.map((p) => [
        'Recette',
        p.paidAt.slice(0, 10),
        p.ticketNumber,
        p.clientName,
        PAYMENT_METHOD_LABELS[p.method],
        String(p.amountFCFA),
      ]),
      ...mExpenses.map((ex) => [
        'Dépense',
        ex.date,
        ex.label,
        ex.category,
        PAYMENT_METHOD_LABELS[ex.method],
        String(-ex.amountFCFA),
      ]),
    ];

    const csv = rows
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bilan-caisse-${monthISO}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Daily Z-Report & Monthly Financial Export */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-4 w-4 text-teal-700" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Clôture de caisse journalière (Z de caisse)
                </h2>
                <p className="text-[11px] text-slate-500">
                  Contrôle du tiroir espèces et Mobile Money pour la journée
                </p>
              </div>
            </div>
            <input
              type="date"
              value={zDate}
              onChange={(e) => setZDate(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs focus:border-teal-600 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[10px] text-slate-500">Recettes jour</div>
              <div className="mt-0.5 font-mono font-bold text-emerald-700 tabular-nums">
                {formatFCFA(zSummary.totalInDay)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[10px] text-slate-500">Dépenses jour</div>
              <div className="mt-0.5 font-mono font-bold text-red-700 tabular-nums">
                {formatFCFA(zSummary.totalOutDay)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[10px] text-slate-500">Espèces net</div>
              <div className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums">
                {formatFCFA(zSummary.cashNet)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[10px] text-slate-500">Mobile Money net</div>
              <div className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums">
                {formatFCFA(zSummary.mobileNet)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-xs text-slate-600">
              Solde net du {formatDateFR(zDate)} :{' '}
              <strong className="font-mono text-slate-900 tabular-nums">
                {formatFCFA(zSummary.netDay)}
              </strong>
            </span>
            <button
              type="button"
              onClick={() =>
                exportDailyZReportPdf({
                  dateISO: zDate,
                  orders,
                  payments,
                  expenses,
                  settings,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer"
            >
              <FileDown className="h-3.5 w-3.5" />
              <span>Exporter Z de caisse (PDF)</span>
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Bilan mensuel exportable (PDF &amp; CSV)
              </h2>
              <p className="text-[11px] text-slate-500">
                Synthèse comptable par canal, poste de dépense et jour par jour
              </p>
            </div>
            <input
              type="month"
              value={monthISO}
              onChange={(e) => setMonthISO(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs focus:border-teal-600 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-2.5 text-xs">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[10px] text-slate-500">Recettes mois</div>
              <div className="mt-0.5 font-mono font-bold text-emerald-700 tabular-nums">
                {formatFCFA(monthSummary.mIn)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[10px] text-slate-500">Dépenses mois</div>
              <div className="mt-0.5 font-mono font-bold text-red-700 tabular-nums">
                {formatFCFA(monthSummary.mOut)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[10px] text-slate-500">Résultat net</div>
              <div className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums">
                {formatFCFA(monthSummary.mNet)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleExportMonthCSV}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>CSV du mois</span>
            </button>
            <button
              type="button"
              onClick={() =>
                exportMonthlyReportPdf({
                  monthISO,
                  orders,
                  payments,
                  expenses,
                  settings,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 cursor-pointer"
            >
              <FileDown className="h-3.5 w-3.5" />
              <span>Bilan mensuel (PDF)</span>
            </button>
          </div>
        </section>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Total Recettes Encaissées</div>
          <div className="mt-2 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
            {formatFCFA(totalIn)}
          </div>
          <div className="mt-1 text-xs text-slate-500">{payments.length} opérations</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Total Dépenses & Charges</div>
          <div className="mt-2 font-mono text-2xl font-bold text-red-700 tabular-nums">
            {formatFCFA(totalOut)}
          </div>
          <div className="mt-1 text-xs text-slate-500">{expenses.length} sorties enregistrées</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Solde Net de Caisse</div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {formatFCFA(netBalance)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Espèces + Mobile Money cumulés</div>
        </div>
      </div>

      {/* Reconciliation per channel */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Rapprochement par canal de paiement
            </h2>
            <p className="text-xs text-slate-500">
              Vérifiez vos soldes Espèces, Wave, Orange Money, MTN MoMo et Moov Money
            </p>
          </div>
          <div className="flex items-center gap-2">
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
              onClick={() => setShowExpenseModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 cursor-pointer whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Enregistrer une dépense</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 font-medium">Canal</th>
                <th className="py-2 font-medium text-right">Entrées</th>
                <th className="py-2 font-medium text-right">Sorties</th>
                <th className="py-2 font-medium text-right">Solde net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byMethod.map((row) => (
                <tr key={row.method}>
                  <td className="py-2.5 font-medium text-slate-900">{row.label}</td>
                  <td className="py-2.5 text-right font-mono text-emerald-700 tabular-nums">
                    {formatFCFA(row.inflow)}
                  </td>
                  <td className="py-2.5 text-right font-mono text-red-700 tabular-nums">
                    {formatFCFA(row.outflow)}
                  </td>
                  <td className="py-2.5 text-right font-mono font-semibold text-slate-900 tabular-nums">
                    {formatFCFA(row.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Two tables: Recent Payments & Expenses */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-3.5">
            <h3 className="text-sm font-semibold text-slate-900">Derniers encaissements</h3>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <tbody className="divide-y divide-slate-100">
                {payments.length === 0 ? (
                  <tr>
                    <td className="p-6 text-center text-slate-500">Aucun encaissement.</td>
                  </tr>
                ) : (
                  payments.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4">
                        <div className="font-mono font-semibold text-slate-900">
                          {p.ticketNumber}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {p.clientName} · {formatDateTimeFR(p.paidAt)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {PAYMENT_METHOD_LABELS[p.method]}
                        <div className="text-[11px] text-slate-400 capitalize">{p.type}</div>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                        +{formatFCFA(p.amountFCFA)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-3.5">
            <h3 className="text-sm font-semibold text-slate-900">Dépenses de fonctionnement</h3>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <tbody className="divide-y divide-slate-100">
                {expenses.length === 0 ? (
                  <tr>
                    <td className="p-6 text-center text-slate-500">Aucune dépense enregistrée.</td>
                  </tr>
                ) : (
                  expenses.map((ex) => (
                    <tr key={ex.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">{ex.label}</div>
                        <div className="text-[11px] text-slate-500">
                          {ex.category} · {formatDateFR(ex.date)} ·{' '}
                          {PAYMENT_METHOD_LABELS[ex.method]}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-red-700 tabular-nums whitespace-nowrap">
                        -{formatFCFA(ex.amountFCFA)}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => onDeleteExpense(ex.id)}
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                          title="Supprimer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Add Expense Modal */}
      {showExpenseModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                Nouvelle dépense pressing
              </h3>
              <button
                type="button"
                onClick={() => setShowExpenseModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddExpense} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Motif / Libellé
                </label>
                <input
                  type="text"
                  required
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Ex: Facture CIE, Bidon lessive, Carburant..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Catégorie
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Montant (FCFA)
                  </label>
                  <input
                    type="number"
                    min={100}
                    step={50}
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Payé via
                  </label>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  >
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([k, lbl]) => (
                      <option key={k} value={k}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note optionnelle"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
              />

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 cursor-pointer"
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
