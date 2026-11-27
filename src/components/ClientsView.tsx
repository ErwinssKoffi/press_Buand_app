import React, { useMemo, useState } from 'react';
import { Award, Plus, Search, Trash2, Wallet, X } from 'lucide-react';
import {
  Client,
  LoyaltyConfig,
  PaymentMethod,
  PressingOrder,
} from '../types/pressing';
import {
  ABIDJAN_COMMUNES,
  formatDateFR,
  formatDateTimeFR,
  formatFCFA,
  getTodayISO,
  PAYMENT_METHOD_LABELS,
} from '../utils/formatters';

interface ClientsViewProps {
  clients: Client[];
  orders: PressingOrder[];
  loyaltyConfig?: LoyaltyConfig;
  onSaveClient: (client: Client) => Promise<void>;
  onDeleteClient: (id: string) => Promise<void>;
  onTopUpPrepaid?: (params: {
    clientId: string;
    amountFCFA: number;
    bonusFCFA?: number;
    method: PaymentMethod;
    subscriptionLabel?: string;
    subscriptionExpiresAt?: string;
    note?: string;
  }) => Promise<void>;
  onNewDepositForClient: (clientId: string) => void;
}

const SUBSCRIPTION_PRESETS = [
  { label: 'Recharge libre', amount: 10000, bonus: 0, plan: '' },
  { label: 'Pack Essentiel 25 000 (+2 500)', amount: 25000, bonus: 2500, plan: 'Pack Essentiel' },
  { label: 'Abonnement VIP 50 000 (+7 500)', amount: 50000, bonus: 7500, plan: 'Abonnement Mensuel VIP' },
];

export const ClientsView: React.FC<ClientsViewProps> = ({
  clients,
  orders,
  loyaltyConfig,
  onSaveClient,
  onDeleteClient,
  onTopUpPrepaid,
  onNewDepositForClient,
}) => {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Client | null>(null);
  const [isNew, setIsNew] = useState(false);

  // Prepaid / Subscription modal state
  const [walletClientId, setWalletClientId] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState<string>('10000');
  const [topUpBonus, setTopUpBonus] = useState<string>('0');
  const [topUpMethod, setTopUpMethod] = useState<PaymentMethod>('especes');
  const [subLabel, setSubLabel] = useState<string>('');
  const [subExpiry, setSubExpiry] = useState<string>('');
  const [topUpNote, setTopUpNote] = useState<string>('');
  const [savingTopUp, setSavingTopUp] = useState(false);

  const walletClient = useMemo(
    () => clients.find((c) => c.id === walletClientId) || null,
    [clients, walletClientId]
  );

  const clientStats = useMemo(() => {
    const map = new Map<string, { count: number; total: number; unpaid: number }>();
    for (const o of orders) {
      const cur = map.get(o.clientId) || { count: 0, total: 0, unpaid: 0 };
      cur.count += 1;
      cur.total += o.totalFCFA;
      cur.unpaid += Math.max(0, o.totalFCFA - o.paidFCFA);
      map.set(o.clientId, cur);
    }
    return map;
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.commune.toLowerCase().includes(q)
    );
  }, [clients, search]);

  const openCreate = () => {
    setIsNew(true);
    setEditing({
      id: `cli-${Date.now()}`,
      fullName: '',
      phone: '+225 ',
      commune: ABIDJAN_COMMUNES[1],
      addressNote: '',
      createdAt: getTodayISO(),
      loyaltyPoints: 0,
      prepaidBalanceFCFA: 0,
    });
  };

  const openWalletModal = (client: Client) => {
    setWalletClientId(client.id);
    setTopUpAmount('10000');
    setTopUpBonus('0');
    setTopUpMethod('especes');
    setSubLabel(client.subscriptionLabel || '');
    setSubExpiry(client.subscriptionExpiresAt || '');
    setTopUpNote('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !editing.fullName.trim() || !editing.phone.trim()) return;
    await onSaveClient({
      ...editing,
      fullName: editing.fullName.trim(),
      phone: editing.phone.trim(),
      addressNote: editing.addressNote?.trim() || '',
    });
    setEditing(null);
  };

  const handleTopUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletClient || !onTopUpPrepaid) return;
    const amt = Math.max(0, Math.round(Number(topUpAmount) || 0));
    const bonus = Math.max(0, Math.round(Number(topUpBonus) || 0));
    if (amt <= 0 && bonus <= 0) return;

    setSavingTopUp(true);
    try {
      await onTopUpPrepaid({
        clientId: walletClient.id,
        amountFCFA: amt,
        bonusFCFA: bonus,
        method: topUpMethod,
        subscriptionLabel: subLabel.trim() || undefined,
        subscriptionExpiresAt: subExpiry || undefined,
        note: topUpNote.trim() || undefined,
      });
      setTopUpAmount('10000');
      setTopUpBonus('0');
      setTopUpNote('');
    } finally {
      setSavingTopUp(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 p-5">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par nom, téléphone ou commune..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-2 text-xs focus:bg-white focus:border-teal-600 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Ajouter un client</span>
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500">
            Aucun client trouvé.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500">
                  <th className="py-3 px-4 font-medium">Nom du client</th>
                  <th className="py-3 px-3 font-medium">Téléphone</th>
                  <th className="py-3 px-3 font-medium">Commune / Repère</th>
                  <th className="py-3 px-3 font-medium text-right">Dépôts</th>
                  <th className="py-3 px-3 font-medium text-right">CA Client</th>
                  <th className="py-3 px-3 font-medium text-right">Prépayé &amp; Abonnement</th>
                  <th className="py-3 px-3 font-medium text-right">Fidélité</th>
                  <th className="py-3 px-3 font-medium text-right">Impayé</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((client) => {
                  const st = clientStats.get(client.id) || { count: 0, total: 0, unpaid: 0 };
                  const prepaid = client.prepaidBalanceFCFA || 0;
                  const points = client.loyaltyPoints || 0;
                  const canRedeem =
                    loyaltyConfig?.enabled &&
                    points >= (loyaltyConfig.rewardThresholdPoints || 100);
                  return (
                    <tr key={client.id} className="hover:bg-slate-50/80">
                      <td className="py-3 px-4 font-medium text-slate-900">
                        {client.fullName}
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-700">{client.phone}</td>
                      <td className="py-3 px-3 text-slate-600">
                        <div>{client.commune}</div>
                        {client.addressNote && (
                          <div className="text-[11px] text-slate-400">{client.addressNote}</div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                        {st.count}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900">
                        {formatFCFA(st.total)}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div
                          className={`font-mono font-semibold tabular-nums ${
                            prepaid > 0 ? 'text-teal-800' : 'text-slate-400'
                          }`}
                        >
                          {prepaid > 0 ? formatFCFA(prepaid) : '0 FCFA'}
                        </div>
                        {client.subscriptionLabel && (
                          <div className="text-[10px] text-slate-500">
                            {client.subscriptionLabel}
                            {client.subscriptionExpiresAt
                              ? ` · exp. ${formatDateFR(client.subscriptionExpiresAt)}`
                              : ''}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <span
                          className={`font-mono font-semibold tabular-nums ${
                            canRedeem
                              ? 'text-emerald-700'
                              : points > 0
                              ? 'text-slate-800'
                              : 'text-slate-400'
                          }`}
                        >
                          {points} pts
                        </span>
                        {canRedeem && loyaltyConfig && (
                          <div className="text-[10px] text-emerald-700">
                            -{formatFCFA(loyaltyConfig.rewardDiscountFCFA)} dispo
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {st.unpaid > 0 ? (
                          <span className="font-semibold text-amber-800">
                            {formatFCFA(st.unpaid)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onNewDepositForClient(client.id)}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-teal-800 hover:bg-teal-50 cursor-pointer"
                          >
                            Nouveau dépôt
                          </button>
                          {onTopUpPrepaid && (
                            <button
                              type="button"
                              onClick={() => openWalletModal(client)}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100 cursor-pointer"
                              title="Recharger le compte prépayé / abonnement"
                            >
                              <Wallet className="h-3 w-3 text-teal-700" />
                              <span>Prépayé</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setIsNew(false);
                              setEditing(client);
                            }}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            Modifier
                          </button>
                          {st.count === 0 && (
                            <button
                              type="button"
                              onClick={() => onDeleteClient(client.id)}
                              className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                              title="Supprimer client"
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

      {/* Modal Add/Edit Client */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                {isNew ? 'Nouveau client' : 'Modifier la fiche client'}
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nom complet
                </label>
                <input
                  type="text"
                  required
                  value={editing.fullName}
                  onChange={(e) => setEditing({ ...editing, fullName: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Téléphone (WhatsApp)
                </label>
                <input
                  type="tel"
                  required
                  value={editing.phone}
                  onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Commune
                </label>
                <select
                  value={editing.commune}
                  onChange={(e) => setEditing({ ...editing, commune: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                >
                  {ABIDJAN_COMMUNES.map((com) => (
                    <option key={com} value={com}>
                      {com}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Repère / Adresse
                </label>
                <input
                  type="text"
                  value={editing.addressNote || ''}
                  onChange={(e) => setEditing({ ...editing, addressNote: e.target.value })}
                  placeholder="Ex: Carrefour pharmacie, Rue..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
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

      {/* Modal Prepaid Wallet & Subscription */}
      {walletClient && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl my-auto space-y-5">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Compte prépayé &amp; Fidélité · {walletClient.fullName}
                </h3>
                <p className="text-xs text-slate-500 font-mono">{walletClient.phone}</p>
              </div>
              <button
                type="button"
                onClick={() => setWalletClientId(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Balances strip */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                  <Wallet className="h-3.5 w-3.5 text-teal-700" />
                  <span>Solde prépayé disponible</span>
                </div>
                <div className="mt-1 font-mono text-lg font-bold text-teal-800 tabular-nums">
                  {formatFCFA(walletClient.prepaidBalanceFCFA || 0)}
                </div>
                {walletClient.subscriptionLabel && (
                  <div className="mt-0.5 text-[11px] text-slate-600">
                    {walletClient.subscriptionLabel}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                  <Award className="h-3.5 w-3.5 text-emerald-700" />
                  <span>Points fidélité cumulés</span>
                </div>
                <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                  {walletClient.loyaltyPoints || 0} pts
                </div>
                {loyaltyConfig?.enabled && (
                  <div className="mt-0.5 text-[11px] text-slate-600">
                    Seuil récompense : {loyaltyConfig.rewardThresholdPoints} pts (-
                    {formatFCFA(loyaltyConfig.rewardDiscountFCFA)})
                  </div>
                )}
              </div>
            </div>

            {/* Top-Up Form */}
            <form onSubmit={handleTopUpSubmit} className="space-y-3 border-t border-slate-100 pt-4">
              <div className="text-xs font-semibold text-slate-800">
                Recharger le compte / Activer un abonnement
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {SUBSCRIPTION_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setTopUpAmount(String(preset.amount));
                      setTopUpBonus(String(preset.bonus));
                      if (preset.plan) setSubLabel(preset.plan);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-[11px] font-medium text-slate-800 hover:border-teal-600 hover:bg-teal-50/40 cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Montant encaissé (FCFA)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={topUpAmount}
                    onChange={(e) => setTopUpAmount(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Bonus offert (FCFA)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={topUpBonus}
                    onChange={(e) => setTopUpBonus(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Mode de règlement
                  </label>
                  <select
                    value={topUpMethod}
                    onChange={(e) => setTopUpMethod(e.target.value as PaymentMethod)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  >
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([k, lbl]) => (
                      <option key={k} value={k}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Libellé abonnement (optionnel)
                  </label>
                  <input
                    type="text"
                    value={subLabel}
                    onChange={(e) => setSubLabel(e.target.value)}
                    placeholder="Ex: Forfait Famille / Abonnement VIP"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Date d&apos;expiration (optionnel)
                  </label>
                  <input
                    type="date"
                    value={subExpiry}
                    onChange={(e) => setSubExpiry(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <input
                type="text"
                value={topUpNote}
                onChange={(e) => setTopUpNote(e.target.value)}
                placeholder="Note interne sur la recharge (optionnel)"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:bg-white focus:border-teal-600 focus:outline-none"
              />

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setWalletClientId(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Fermer
                </button>
                <button
                  type="submit"
                  disabled={savingTopUp}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
                >
                  {savingTopUp ? 'Validation...' : 'Créditer le compte & Encaisser'}
                </button>
              </div>
            </form>

            {/* Wallet Ledger History */}
            <div className="border-t border-slate-100 pt-3 space-y-2">
              <div className="text-xs font-semibold text-slate-800">
                Historique du porte-monnaie prépayé
              </div>
              {!walletClient.walletHistory || walletClient.walletHistory.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center text-[11px] text-slate-500">
                  Aucune opération prépayée enregistrée pour ce client.
                </div>
              ) : (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {walletClient.walletHistory.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-[11px]"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-800 truncate">
                          {entry.note || entry.type}
                        </div>
                        <div className="text-slate-500 font-mono">
                          {formatDateTimeFR(entry.date)}
                          {entry.method ? ` · ${PAYMENT_METHOD_LABELS[entry.method]}` : ''}
                        </div>
                      </div>
                      <span
                        className={`font-mono font-semibold tabular-nums shrink-0 ${
                          entry.amountFCFA >= 0 ? 'text-emerald-700' : 'text-slate-700'
                        }`}
                      >
                        {entry.amountFCFA >= 0
                          ? `+${formatFCFA(entry.amountFCFA)}`
                          : formatFCFA(entry.amountFCFA)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

