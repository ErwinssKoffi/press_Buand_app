import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  HardDrive,
  KeyRound,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  BlanchisseriePack,
  BlanchisserieService,
  DatabaseBackup,
  ExpressPricingMode,
  PressingSettings,
  PressingWeightOffer,
  ServiceMode,
  ShopActivityScope,
} from '../types/pressing';
import { DEFAULT_LOYALTY_CONFIG, exportBackupJSON, normalizeSettings } from '../db/localDb';
import {
  BLANCHISSERIE_SERVICES,
  BLANCHISSERIE_SERVICE_LABELS,
  getTodayISO,
  PRESSING_WEIGHT_MODES,
  SERVICE_MODE_LABELS,
  SHOP_ACTIVITY_LABELS,
} from '../utils/formatters';
import {
  generatePinSaltHex,
  hashFiveDigitPin,
  isValidFiveDigitPin,
  verifyFiveDigitPin,
} from '../utils/pinAuth';

interface SettingsViewProps {
  settings: PressingSettings;
  ordersCount: number;
  clientsCount: number;
  onSaveSettings: (settings: PressingSettings) => Promise<void>;
  onImportBackup: (backup: DatabaseBackup) => Promise<void>;
  onClearAllData: () => Promise<void>;
  onResetDemoData: () => Promise<void>;
  onReopenOnboarding?: () => void;
}

const ACTIVITY_OPTIONS: {
  value: ShopActivityScope;
  title: string;
  desc: string;
}[] = [
  {
    value: 'both',
    title: SHOP_ACTIVITY_LABELS.both,
    desc: 'Pressing (pièce, kilo, express ciblé) + Blanchisserie (forfaits par nombre de vêtements).',
  },
  {
    value: 'pressing',
    title: SHOP_ACTIVITY_LABELS.pressing,
    desc: 'Articles à la pièce, tarification au kilo et service express par vêtement.',
  },
  {
    value: 'blanchisserie',
    title: SHOP_ACTIVITY_LABELS.blanchisserie,
    desc: 'Lavage simple, lavage + repassage ou repassage seul par nombre de vêtements.',
  },
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  ordersCount,
  clientsCount,
  onSaveSettings,
  onImportBackup,
  onClearAllData,
  onResetDemoData,
  onReopenOnboarding,
}) => {
  const [form, setForm] = useState<PressingSettings>(() => normalizeSettings(settings));
  const [savedToast, setSavedToast] = useState(false);
  const [configError, setConfigError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<'clear' | 'reset' | null>(null);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinSavedMsg, setPinSavedMsg] = useState('');
  const [savingPin, setSavingPin] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setForm(normalizeSettings(settings));
  }, [settings]);

  const pressingActive =
    form.activityScope === 'pressing' || form.activityScope === 'both';
  const blanchisserieActive =
    form.activityScope === 'blanchisserie' || form.activityScope === 'both';

  // Blanchisserie handlers
  const toggleService = (service: BlanchisserieService) => {
    setConfigError('');
    const current = form.blanchisserieConfig.enabledServices;
    const nextServices = { ...current, [service]: !current[service] };
    if (!Object.values(nextServices).some(Boolean)) {
      setConfigError('Au moins une formule de blanchisserie doit rester active.');
      return;
    }
    setForm({
      ...form,
      blanchisserieConfig: {
        ...form.blanchisserieConfig,
        enabledServices: nextServices,
      },
    });
  };

  const toggleEnableUnit = () => {
    setConfigError('');
    const nextUnit = !form.blanchisserieConfig.enableUnit;
    const hasActivePack = form.blanchisserieConfig.packs.some((p) => p.active);
    if (!nextUnit && !hasActivePack) {
      setConfigError('Gardez au moins le tarif à l’unité ou un forfait de vêtements actif.');
      return;
    }
    setForm({
      ...form,
      blanchisserieConfig: {
        ...form.blanchisserieConfig,
        enableUnit: nextUnit,
      },
    });
  };

  const updateUnitPrice = (service: BlanchisserieService, rawVal: string) => {
    const val = Math.max(0, Math.round(Number(rawVal) || 0));
    setForm({
      ...form,
      blanchisserieConfig: {
        ...form.blanchisserieConfig,
        unitPricesFCFA: {
          ...form.blanchisserieConfig.unitPricesFCFA,
          [service]: val,
        },
      },
    });
  };

  const updatePack = (packId: string, patch: Partial<BlanchisseriePack>) => {
    setConfigError('');
    setForm({
      ...form,
      blanchisserieConfig: {
        ...form.blanchisserieConfig,
        packs: form.blanchisserieConfig.packs.map((pk) =>
          pk.id === packId ? { ...pk, ...patch } : pk
        ),
      },
    });
  };

  const updatePackPrice = (
    packId: string,
    service: BlanchisserieService,
    rawVal: string
  ) => {
    const val = Math.max(0, Math.round(Number(rawVal) || 0));
    setForm({
      ...form,
      blanchisserieConfig: {
        ...form.blanchisserieConfig,
        packs: form.blanchisserieConfig.packs.map((pk) =>
          pk.id === packId
            ? {
                ...pk,
                pricesFCFA: { ...pk.pricesFCFA, [service]: val },
              }
            : pk
        ),
      },
    });
  };

  const addPack = () => {
    const existingMax = form.blanchisserieConfig.packs.reduce(
      (max, p) => Math.max(max, p.garmentCount),
      0
    );
    const nextCount = existingMax > 0 ? existingMax + 5 : 10;
    const newPack: BlanchisseriePack = {
      id: `pack-${Date.now()}`,
      garmentCount: nextCount,
      active: true,
      pricesFCFA: {
        lavage_simple: nextCount * 150,
        lavage_repassage: nextCount * 200,
        repassage_seul: nextCount * 120,
      },
    };
    setForm({
      ...form,
      blanchisserieConfig: {
        ...form.blanchisserieConfig,
        packs: [...form.blanchisserieConfig.packs, newPack],
      },
    });
  };

  const removePack = (packId: string) => {
    const remaining = form.blanchisserieConfig.packs.filter((p) => p.id !== packId);
    if (!form.blanchisserieConfig.enableUnit && !remaining.some((p) => p.active)) {
      setConfigError('Gardez au moins le tarif à l’unité ou un forfait actif.');
      return;
    }
    setForm({
      ...form,
      blanchisserieConfig: {
        ...form.blanchisserieConfig,
        packs: remaining,
      },
    });
  };

  // Pressing advanced handlers
  const updatePressingKgPrice = (mode: ServiceMode, rawVal: string) => {
    const val = Math.max(0, Math.round(Number(rawVal) || 0));
    setForm({
      ...form,
      pressingConfig: {
        ...form.pressingConfig,
        pricePerKgByMode: {
          ...form.pressingConfig.pricePerKgByMode,
          [mode]: val,
        },
      },
    });
  };

  const updateWeightOffer = (id: string, patch: Partial<PressingWeightOffer>) => {
    setForm({
      ...form,
      pressingConfig: {
        ...form.pressingConfig,
        weightOffers: form.pressingConfig.weightOffers.map((wo) =>
          wo.id === id ? { ...wo, ...patch } : wo
        ),
      },
    });
  };

  const addWeightOffer = () => {
    const newOffer: PressingWeightOffer = {
      id: `wo-${Date.now()}`,
      label: 'Nouveau forfait poids',
      weightKg: 1.5,
      mode: 'lavage_repassage',
      priceFCFA: 5000,
      active: true,
    };
    setForm({
      ...form,
      pressingConfig: {
        ...form.pressingConfig,
        weightOffers: [...form.pressingConfig.weightOffers, newOffer],
      },
    });
  };

  const removeWeightOffer = (id: string) => {
    setForm({
      ...form,
      pressingConfig: {
        ...form.pressingConfig,
        weightOffers: form.pressingConfig.weightOffers.filter((wo) => wo.id !== id),
      },
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfigError('');
    if (blanchisserieActive) {
      const hasActivePack = form.blanchisserieConfig.packs.some((p) => p.active);
      if (!form.blanchisserieConfig.enableUnit && !hasActivePack) {
        setConfigError('Activez au moins un forfait de vêtements ou le tarif à l’unité.');
        return;
      }
    }
    const normalized = normalizeSettings({
      ...form,
      expressPercent: form.pressingConfig.expressPercent,
    });
    await onSaveSettings(normalized);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2500);
  };

  const handleExportJSON = async () => {
    const data = await exportBackupJSON();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sauvegarde-pressing-${getTodayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMessage('Sauvegarde JSON téléchargée avec succès.');
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as DatabaseBackup;
      if (!parsed.orders || !parsed.clients || !parsed.catalog) {
        setStatusMessage('Fichier de sauvegarde invalide.');
        return;
      }
      await onImportBackup(parsed);
      setForm(normalizeSettings(parsed.settings || settings));
      setStatusMessage('Base locale restaurée avec succès.');
    } catch {
      setStatusMessage('Impossible de lire ce fichier JSON.');
    } finally {
      e.target.value = '';
    }
  };

  const handleUpdatePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');
    setPinSavedMsg('');
    const cleanNew = newPin.replace(/\D/g, '');
    const cleanConfirm = confirmNewPin.replace(/\D/g, '');

    if (settings.pinHash && settings.pinSalt) {
      const ok = await verifyFiveDigitPin(
        currentPin.replace(/\D/g, ''),
        settings.pinSalt,
        settings.pinHash
      );
      if (!ok) {
        setPinError('Le code PIN actuel est incorrect.');
        return;
      }
    }

    if (!isValidFiveDigitPin(cleanNew)) {
      setPinError('Le nouveau code PIN doit contenir exactement 5 chiffres.');
      return;
    }
    if (cleanNew !== cleanConfirm) {
      setPinError('La confirmation du nouveau code PIN ne correspond pas.');
      return;
    }

    setSavingPin(true);
    try {
      const nextSalt = generatePinSaltHex(16);
      const nextHash = await hashFiveDigitPin(cleanNew, nextSalt);
      const updated = normalizeSettings({
        ...form,
        pinHash: nextHash,
        pinSalt: nextSalt,
      });
      await onSaveSettings(updated);
      setCurrentPin('');
      setNewPin('');
      setConfirmNewPin('');
      setPinSavedMsg('Code PIN à 5 chiffres mis à jour.');
    } finally {
      setSavingPin(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left: Pressing Identity + Advanced Pressing + Blanchisserie Configuration */}
      <section className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6">
        <div className="border-b border-slate-100 pb-4">
          <h2 className="text-base font-semibold text-slate-900">
            Informations &amp; Activités de l&apos;établissement
          </h2>
          <p className="text-xs text-slate-500">
            Ces coordonnées et règles tarifaires configurent vos tickets imprimés et le comptoir
          </p>
        </div>

        <form onSubmit={handleSave} className="mt-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nom commercial
              </label>
              <input
                type="text"
                required
                value={form.shopName}
                onChange={(e) => setForm({ ...form, shopName: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Slogan / Activité
              </label>
              <input
                type="text"
                value={form.tagline}
                onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Commune / Quartier
              </label>
              <input
                type="text"
                value={form.commune}
                onChange={(e) => setForm({ ...form, commune: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Adresse complète
              </label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Téléphone
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                RCCM / N° Compte
              </label>
              <input
                type="text"
                value={form.rccm}
                onChange={(e) => setForm({ ...form, rccm: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono focus:border-teal-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Mention légale en bas du ticket
            </label>
            <textarea
              rows={2}
              value={form.ticketFooterNote}
              onChange={(e) => setForm({ ...form, ticketFooterNote: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
            />
          </div>

          {/* Activity Scope Selector */}
          <div className="border-t border-slate-200 pt-5 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Types d&apos;activités proposées
              </h3>
              <p className="text-xs text-slate-500">
                Sélectionnez Pressing, Blanchisserie ou les deux pour afficher leurs paramètres
                avancés
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {ACTIVITY_OPTIONS.map((opt) => {
                const selected = form.activityScope === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setConfigError('');
                      setForm({ ...form, activityScope: opt.value });
                    }}
                    className={`rounded-lg border p-3 text-left transition-colors cursor-pointer ${
                      selected
                        ? 'border-teal-700 bg-teal-50/70'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900">{opt.title}</span>
                      {selected && <Check className="h-3.5 w-3.5 text-teal-700 shrink-0" />}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500 leading-snug">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conditional Advanced Pressing Parameters */}
          {pressingActive && (
            <div className="border-t border-slate-200 pt-5 space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Paramètres avancés du Pressing (Service Express &amp; Tarifs au Kilo)
                </h3>
                <p className="text-xs text-slate-500">
                  Configurez le montant Express appliqué par vêtement et les tarifs Pressing évalués
                  au kilo
                </p>
              </div>

              {/* Express Pricing Configuration */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                <div>
                  <div className="text-xs font-semibold text-slate-900">
                    Tarification du Service Express (attribué par vêtement au dépôt)
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Lors d&apos;un dépôt, le client peut demander l&apos;Express uniquement sur un
                    complet veste ou une veste tout en laissant ses autres articles au tarif normal.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Mode de calcul Express
                    </label>
                    <select
                      value={form.pressingConfig.expressPricingMode}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          pressingConfig: {
                            ...form.pressingConfig,
                            expressPricingMode: e.target.value as ExpressPricingMode,
                          },
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                    >
                      <option value="fixed_per_piece">
                        Montant fixe par vêtement / lot (FCFA)
                      </option>
                      <option value="percent">Majoration en pourcentage (%)</option>
                    </select>
                  </div>

                  {form.pressingConfig.expressPricingMode === 'fixed_per_piece' ? (
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        Montant Express par article (FCFA)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={form.pressingConfig.expressFixedAmountFCFA}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            pressingConfig: {
                              ...form.pressingConfig,
                              expressFixedAmountFCFA: Math.max(
                                0,
                                Math.round(Number(e.target.value) || 0)
                              ),
                            },
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono tabular-nums focus:border-teal-600 focus:outline-none"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        Majoration Express (%)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={200}
                        value={form.pressingConfig.expressPercent}
                        onChange={(e) => {
                          const pct = Math.max(0, Math.round(Number(e.target.value) || 0));
                          setForm({
                            ...form,
                            expressPercent: pct,
                            pressingConfig: {
                              ...form.pressingConfig,
                              expressPercent: pct,
                            },
                          });
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono tabular-nums focus:border-teal-600 focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Pressing by Weight (kg) Configuration */}
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      Pressing évalué au kilo (kg)
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Définissez vos prix de référence au kg et des forfaits suggérés (ex : 1,5 kg à
                      5 000 FCFA)
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.pressingConfig.weightEnabled}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          pressingConfig: {
                            ...form.pressingConfig,
                            weightEnabled: e.target.checked,
                          },
                        })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <span>Activer au comptoir</span>
                  </label>
                </div>

                {form.pressingConfig.weightEnabled && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {PRESSING_WEIGHT_MODES.map((mode) => (
                        <div key={mode}>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1 truncate">
                            {SERVICE_MODE_LABELS[mode]} (/kg)
                          </label>
                          <input
                            type="number"
                            min={0}
                            step={100}
                            value={form.pressingConfig.pricePerKgByMode[mode]}
                            onChange={(e) => updatePressingKgPrice(mode, e.target.value)}
                            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-right font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-700">
                          Forfaits poids suggérés au comptoir
                        </span>
                        <button
                          type="button"
                          onClick={addWeightOffer}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                        >
                          <Plus className="h-3 w-3" />
                          <span>Ajouter un forfait kg</span>
                        </button>
                      </div>

                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                              <th className="py-2 px-2.5 font-semibold">Libellé</th>
                              <th className="py-2 px-2 font-semibold text-right">Poids (kg)</th>
                              <th className="py-2 px-2 font-semibold">Prestation</th>
                              <th className="py-2 px-2 font-semibold text-right">Prix (FCFA)</th>
                              <th className="py-2 px-2 font-semibold text-center">Actif</th>
                              <th className="py-2 px-2"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {form.pressingConfig.weightOffers.map((wo) => (
                              <tr key={wo.id}>
                                <td className="py-1.5 px-2.5">
                                  <input
                                    type="text"
                                    value={wo.label}
                                    onChange={(e) =>
                                      updateWeightOffer(wo.id, { label: e.target.value })
                                    }
                                    className="w-full min-w-[140px] rounded border border-slate-200 px-2 py-1 text-xs focus:border-teal-600 focus:outline-none"
                                  />
                                </td>
                                <td className="py-1.5 px-2 text-right">
                                  <input
                                    type="number"
                                    min={0.1}
                                    step={0.1}
                                    value={wo.weightKg}
                                    onChange={(e) =>
                                      updateWeightOffer(wo.id, {
                                        weightKg: Math.max(0.1, Number(e.target.value) || 0.5),
                                      })
                                    }
                                    className="w-16 rounded border border-slate-200 px-2 py-1 text-right font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none"
                                  />
                                </td>
                                <td className="py-1.5 px-2">
                                  <select
                                    value={wo.mode}
                                    onChange={(e) =>
                                      updateWeightOffer(wo.id, {
                                        mode: e.target.value as ServiceMode,
                                      })
                                    }
                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] focus:border-teal-600 focus:outline-none"
                                  >
                                    {PRESSING_WEIGHT_MODES.map((m) => (
                                      <option key={m} value={m}>
                                        {SERVICE_MODE_LABELS[m]}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-1.5 px-2 text-right">
                                  <input
                                    type="number"
                                    min={0}
                                    step={100}
                                    value={wo.priceFCFA}
                                    onChange={(e) =>
                                      updateWeightOffer(wo.id, {
                                        priceFCFA: Math.max(
                                          0,
                                          Math.round(Number(e.target.value) || 0)
                                        ),
                                      })
                                    }
                                    className="w-20 rounded border border-slate-200 px-2 py-1 text-right font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none"
                                  />
                                </td>
                                <td className="py-1.5 px-2 text-center">
                                  <input
                                    type="checkbox"
                                    checked={wo.active}
                                    onChange={(e) =>
                                      updateWeightOffer(wo.id, { active: e.target.checked })
                                    }
                                    className="h-4 w-4 rounded border-slate-300 text-teal-700"
                                  />
                                </td>
                                <td className="py-1.5 px-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => removeWeightOffer(wo.id)}
                                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                                    title="Supprimer ce forfait poids"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Conditional Blanchisserie Parameters */}
          {blanchisserieActive ? (
            <div className="border-t border-slate-200 pt-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Paramètres de la Blanchisserie (Nombre de vêtements &amp; Prix fixes)
                </h3>
                <p className="text-xs text-slate-500">
                  Configurez les programmes (ex : 10 vêtements tous types confondus à 2 000 FCFA)
                  et le prix fixe par formule
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 space-y-2.5">
                <div className="text-xs font-semibold text-slate-800">
                  Formules Blanchisserie actives
                </div>
                <div className="flex flex-wrap gap-4">
                  {BLANCHISSERIE_SERVICES.map((svc) => (
                    <label
                      key={svc}
                      className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={form.blanchisserieConfig.enabledServices[svc]}
                        onChange={() => toggleService(svc)}
                        className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                      />
                      <span>{BLANCHISSERIE_SERVICE_LABELS[svc]}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Unit Pricing Option */}
              <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.blanchisserieConfig.enableUnit}
                      onChange={toggleEnableUnit}
                      className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <span>Autoriser aussi la facturation à l&apos;unité (1 vêtement)</span>
                  </label>
                </div>

                {form.blanchisserieConfig.enableUnit && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    {BLANCHISSERIE_SERVICES.map((svc) => {
                      const svcEnabled = form.blanchisserieConfig.enabledServices[svc];
                      return (
                        <div key={svc}>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            {BLANCHISSERIE_SERVICE_LABELS[svc]} (1 pce)
                          </label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={0}
                              step={50}
                              disabled={!svcEnabled}
                              value={form.blanchisserieConfig.unitPricesFCFA[svc]}
                              onChange={(e) => updateUnitPrice(svc, e.target.value)}
                              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-right font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                            />
                            <span className="text-[11px] text-slate-400">F</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Configurable Garment-Count Packs */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800">
                    Programmes par nombre de vêtements (tous types confondus)
                  </span>
                  <button
                    type="button"
                    onClick={addPack}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Ajouter un nombre de vêtements</span>
                  </button>
                </div>

                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                        <th className="py-2.5 px-3 font-semibold">Nb vêtements</th>
                        {BLANCHISSERIE_SERVICES.map((svc) => {
                          const enabled = form.blanchisserieConfig.enabledServices[svc];
                          return (
                            <th
                              key={svc}
                              className={`py-2.5 px-2.5 font-semibold text-right ${
                                enabled ? 'text-slate-700' : 'text-slate-400'
                              }`}
                            >
                              {BLANCHISSERIE_SERVICE_LABELS[svc]}
                            </th>
                          );
                        })}
                        <th className="py-2.5 px-2 font-semibold text-center">Actif</th>
                        <th className="py-2.5 px-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {form.blanchisserieConfig.packs.map((pack) => (
                        <tr key={pack.id} className={pack.active ? 'bg-white' : 'bg-slate-50/70'}>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <input
                                type="number"
                                min={2}
                                max={200}
                                value={pack.garmentCount}
                                onChange={(e) =>
                                  updatePack(pack.id, {
                                    garmentCount: Math.max(
                                      2,
                                      Math.round(Number(e.target.value) || 2)
                                    ),
                                  })
                                }
                                className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-center font-mono text-xs font-bold tabular-nums focus:border-teal-600 focus:outline-none"
                              />
                              <span className="text-[11px] text-slate-500">vêt.</span>
                            </div>
                          </td>

                          {BLANCHISSERIE_SERVICES.map((svc) => {
                            const svcEnabled = form.blanchisserieConfig.enabledServices[svc];
                            const cellEnabled = svcEnabled && pack.active;
                            return (
                              <td key={svc} className="py-2 px-2.5 text-right">
                                <div className="inline-flex items-center gap-1">
                                  <input
                                    type="number"
                                    min={0}
                                    step={100}
                                    disabled={!cellEnabled}
                                    value={pack.pricesFCFA[svc]}
                                    onChange={(e) =>
                                      updatePackPrice(pack.id, svc, e.target.value)
                                    }
                                    className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                                  />
                                  <span className="text-[11px] text-slate-400">F</span>
                                </div>
                              </td>
                            );
                          })}

                          <td className="py-2 px-2 text-center">
                            <input
                              type="checkbox"
                              checked={pack.active}
                              onChange={(e) =>
                                updatePack(pack.id, { active: e.target.checked })
                              }
                              className="h-4 w-4 rounded border-slate-300 text-teal-700"
                            />
                          </td>

                          <td className="py-2 px-2 text-right">
                            <button
                              type="button"
                              onClick={() => removePack(pack.id)}
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                              title="Supprimer ce programme"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="border-t border-slate-100 pt-4 text-xs text-slate-500">
              L&apos;activité Blanchisserie est désactivée. Sélectionnez{' '}
              <strong className="text-slate-700">Pressing &amp; Blanchisserie</strong> ou{' '}
              <strong className="text-slate-700">Blanchisserie uniquement</strong> ci-dessus pour
              configurer les forfaits par nombre de vêtements.
            </div>
          )}

          {/* Programme de fidélité client */}
          <div className="border-t border-slate-200 pt-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Programme de fidélité client
                </h3>
                <p className="text-xs text-slate-500">
                  Attribution automatique de points à chaque dépôt et remise fidélité au comptoir
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(form.loyaltyConfig || DEFAULT_LOYALTY_CONFIG).enabled}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      loyaltyConfig: {
                        ...(form.loyaltyConfig || DEFAULT_LOYALTY_CONFIG),
                        enabled: e.target.checked,
                      },
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-teal-700"
                />
                <span>Activer les points fidélité</span>
              </label>
            </div>

            {(form.loyaltyConfig || DEFAULT_LOYALTY_CONFIG).enabled && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    FCFA dépensés pour 1 point
                  </label>
                  <input
                    type="number"
                    min={100}
                    step={100}
                    value={(form.loyaltyConfig || DEFAULT_LOYALTY_CONFIG).fcfaPerPoint}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        loyaltyConfig: {
                          ...(form.loyaltyConfig || DEFAULT_LOYALTY_CONFIG),
                          fcfaPerPoint: Math.max(100, Math.round(Number(e.target.value) || 500)),
                        },
                      })
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Seuil de points récompense
                  </label>
                  <input
                    type="number"
                    min={5}
                    step={5}
                    value={(form.loyaltyConfig || DEFAULT_LOYALTY_CONFIG).rewardThresholdPoints}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        loyaltyConfig: {
                          ...(form.loyaltyConfig || DEFAULT_LOYALTY_CONFIG),
                          rewardThresholdPoints: Math.max(
                            5,
                            Math.round(Number(e.target.value) || 100)
                          ),
                        },
                      })
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Remise offerte (FCFA)
                  </label>
                  <input
                    type="number"
                    min={100}
                    step={100}
                    value={(form.loyaltyConfig || DEFAULT_LOYALTY_CONFIG).rewardDiscountFCFA}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        loyaltyConfig: {
                          ...(form.loyaltyConfig || DEFAULT_LOYALTY_CONFIG),
                          rewardDiscountFCFA: Math.max(
                            100,
                            Math.round(Number(e.target.value) || 2000)
                          ),
                        },
                      })
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {configError && (
            <p className="text-xs font-medium text-red-700">{configError}</p>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <span className="text-xs text-emerald-700 font-medium">
              {savedToast && (
                <span className="inline-flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" /> Paramètres enregistrés en local
                </span>
              )}
            </span>
            <button
              type="submit"
              className="rounded-lg bg-teal-700 px-5 py-2 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer"
            >
              Enregistrer les paramètres
            </button>
          </div>
        </form>
      </section>

      {/* Right: Local IndexedDB Backup & Reset */}
      <section className="lg:col-span-5 space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
            <HardDrive className="h-5 w-5 text-teal-700 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Base de données locale (Hors-ligne)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Stockage IndexedDB sur cet ordinateur ·{' '}
                <span className="font-mono tabular-nums">{ordersCount}</span> tickets ·{' '}
                <span className="font-mono tabular-nums">{clientsCount}</span> clients
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            Toutes vos données restent enregistrées localement sur votre Mac ou PC Windows, sans
            connexion internet. Exportez régulièrement un fichier de sauvegarde JSON pour le
            conserver sur clé USB ou le transférer sur un autre poste.
          </p>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={handleExportJSON}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-medium text-white hover:bg-slate-800 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Sauvegarder (.json)</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Restaurer (.json)</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportFile}
              className="hidden"
            />
          </div>

          {statusMessage && (
            <p className="text-xs font-medium text-teal-800">{statusMessage}</p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Réinitialisation des données
          </h3>
          <p className="text-xs text-slate-500">
            Videz les exemples de démonstration pour démarrer votre activité réelle à zéro, ou
            restaurez le jeu d&apos;essai Abidjan.
          </p>

          <div className="flex flex-wrap gap-2.5 pt-1">
            {confirmAction === 'clear' ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await onClearAllData();
                    setConfirmAction(null);
                    setStatusMessage('Base vidée : prêt pour vos vrais tickets.');
                  }}
                  className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700 cursor-pointer"
                >
                  Confirmer la suppression
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmAction(null)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 cursor-pointer"
                >
                  Annuler
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmAction('clear')}
                className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-medium text-red-800 hover:bg-red-100 cursor-pointer"
              >
                Démarrer à zéro (Vider les commandes)
              </button>
            )}

            <button
              type="button"
              onClick={async () => {
                await onResetDemoData();
                setStatusMessage('Données de démonstration rechargées.');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Recharger démo Abidjan</span>
            </button>
          </div>
        </div>

        {/* Sécurité PIN 5 chiffres & Relance Onboarding */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
            <KeyRound className="h-5 w-5 text-teal-700 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Sécurité &amp; Assistant de configuration
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Modifiez votre code PIN de connexion à 5 chiffres ou relancez l&apos;assistant initial
              </p>
            </div>
          </div>

          <form onSubmit={handleUpdatePin} className="space-y-3">
            {settings.pinHash && settings.pinSalt && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Code PIN actuel (5 chiffres)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={5}
                  value={currentPin}
                  onChange={(e) => {
                    setPinError('');
                    setPinSavedMsg('');
                    setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 5));
                  }}
                  placeholder="•••••"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tracking-widest focus:border-teal-600 focus:outline-none"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nouveau PIN (5 chiffres)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={5}
                  value={newPin}
                  onChange={(e) => {
                    setPinError('');
                    setPinSavedMsg('');
                    setNewPin(e.target.value.replace(/\D/g, '').slice(0, 5));
                  }}
                  placeholder="•••••"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tracking-widest focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Confirmer le PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={5}
                  value={confirmNewPin}
                  onChange={(e) => {
                    setPinError('');
                    setPinSavedMsg('');
                    setConfirmNewPin(e.target.value.replace(/\D/g, '').slice(0, 5));
                  }}
                  placeholder="•••••"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tracking-widest focus:border-teal-600 focus:outline-none"
                />
              </div>
            </div>

            {pinError && <p className="text-xs font-medium text-red-700">{pinError}</p>}
            {pinSavedMsg && <p className="text-xs font-medium text-emerald-700">{pinSavedMsg}</p>}

            <button
              type="submit"
              disabled={savingPin}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
            >
              {savingPin ? 'Mise à jour...' : 'Mettre à jour le code PIN'}
            </button>
          </form>

          {onReopenOnboarding && (
            <div className="border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={onReopenOnboarding}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-teal-700" />
                <span>Relancer l&apos;assistant de configuration (Onboarding)</span>
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
