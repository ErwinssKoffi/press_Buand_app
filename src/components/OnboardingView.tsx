import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Gift,
  Layers,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  BlanchisserieService,
  ExpressPricingMode,
  PressingSettings,
  ShopActivityScope,
} from '../types/pressing';
import { DEFAULT_LOYALTY_CONFIG, normalizeSettings } from '../db/localDb';
import {
  BLANCHISSERIE_SERVICES,
  BLANCHISSERIE_SERVICE_LABELS,
  formatFCFA,
  SHOP_ACTIVITY_LABELS,
} from '../utils/formatters';

interface OnboardingViewProps {
  settings: PressingSettings;
  ordersCount: number;
  onCompleteOnboarding: (
    nextSettings: PressingSettings,
    options: { startFresh: boolean }
  ) => Promise<void>;
  onSkipOnboarding: () => Promise<void>;
}

const STEPS = [
  { id: 1, label: 'Établissement', icon: Building2 },
  { id: 2, label: 'Activités & Tarifs', icon: Layers },
  { id: 3, label: 'Fidélité & Démarrage', icon: Gift },
  { id: 4, label: 'Validation', icon: ShieldCheck },
] as const;

const ACTIVITY_CHOICES: {
  value: ShopActivityScope;
  title: string;
  desc: string;
}[] = [
  {
    value: 'both',
    title: SHOP_ACTIVITY_LABELS.both,
    desc: 'Pressing (pièce, kilo, express par article) + Blanchisserie (forfaits par nombre de vêtements).',
  },
  {
    value: 'pressing',
    title: SHOP_ACTIVITY_LABELS.pressing,
    desc: 'Nettoyage à sec, repassage, pesée au kilo et majoration express par vêtement.',
  },
  {
    value: 'blanchisserie',
    title: SHOP_ACTIVITY_LABELS.blanchisserie,
    desc: 'Lavage simple, lavage + repassage ou repassage seul par nombre de vêtements.',
  },
];

export const OnboardingView: React.FC<OnboardingViewProps> = ({
  settings,
  ordersCount,
  onCompleteOnboarding,
  onSkipOnboarding,
}) => {
  const [step, setStep] = useState<number>(1);
  const [form, setForm] = useState<PressingSettings>(() => normalizeSettings(settings));
  const [startFresh, setStartFresh] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  const pressingActive =
    form.activityScope === 'pressing' || form.activityScope === 'both';
  const blanchisserieActive =
    form.activityScope === 'blanchisserie' || form.activityScope === 'both';

  const primaryPack = form.blanchisserieConfig.packs[0];
  const primaryWeightOffer = form.pressingConfig.weightOffers[0];

  const toggleBlanchisserieService = (svc: BlanchisserieService) => {
    setErrorMsg('');
    const current = form.blanchisserieConfig.enabledServices;
    const next = { ...current, [svc]: !current[svc] };
    if (!Object.values(next).some(Boolean)) {
      setErrorMsg('Au moins une formule de blanchisserie doit rester active.');
      return;
    }
    setForm({
      ...form,
      blanchisserieConfig: {
        ...form.blanchisserieConfig,
        enabledServices: next,
      },
    });
  };

  const updatePrimaryPackCount = (rawCount: string) => {
    if (!primaryPack) return;
    const count = Math.max(2, Math.round(Number(rawCount) || 10));
    setForm({
      ...form,
      blanchisserieConfig: {
        ...form.blanchisserieConfig,
        packs: form.blanchisserieConfig.packs.map((pk, index) =>
          index === 0 ? { ...pk, garmentCount: count, active: true } : pk
        ),
      },
    });
  };

  const updatePrimaryPackPrice = (svc: BlanchisserieService, rawPrice: string) => {
    if (!primaryPack) return;
    const price = Math.max(0, Math.round(Number(rawPrice) || 0));
    setForm({
      ...form,
      blanchisserieConfig: {
        ...form.blanchisserieConfig,
        packs: form.blanchisserieConfig.packs.map((pk, index) =>
          index === 0
            ? {
                ...pk,
                active: true,
                pricesFCFA: { ...pk.pricesFCFA, [svc]: price },
              }
            : pk
        ),
      },
    });
  };

  const updatePrimaryWeightOffer = (patch: { weightKg?: number; priceFCFA?: number }) => {
    if (!primaryWeightOffer) return;
    setForm({
      ...form,
      pressingConfig: {
        ...form.pressingConfig,
        weightOffers: form.pressingConfig.weightOffers.map((wo, idx) =>
          idx === 0
            ? {
                ...wo,
                ...patch,
                label: `${patch.weightKg ?? wo.weightKg} kg · Lavage + Repassage`,
              }
            : wo
        ),
      },
    });
  };

  const handleNext = () => {
    setErrorMsg('');
    if (step === 1 && !form.shopName.trim()) {
      setErrorMsg("Veuillez renseigner le nom commercial de l'établissement.");
      return;
    }
    if (step === 2 && blanchisserieActive) {
      const hasPack = form.blanchisserieConfig.packs.some((p) => p.active);
      if (!form.blanchisserieConfig.enableUnit && !hasPack) {
        setErrorMsg('Activez au moins un forfait de vêtements ou le tarif à l’unité.');
        return;
      }
    }
    setStep((s) => Math.min(4, s + 1));
  };

  const handleFinish = async () => {
    setSaving(true);
    setErrorMsg('');
    try {
      const normalized = normalizeSettings({
        ...form,
        expressPercent: form.pressingConfig.expressPercent,
        onboardingCompleted: true,
      });
      await onCompleteOnboarding(normalized, { startFresh });
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      await onSkipOnboarding();
    } finally {
      setSaving(false);
    }
  };

  const loyalty = form.loyaltyConfig || DEFAULT_LOYALTY_CONFIG;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Bar */}
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="font-display text-base sm:text-lg font-bold text-slate-900 truncate">
              Configuration initiale · {form.shopName || 'Votre Pressing'}
            </div>
            <div className="text-xs text-slate-500">
              Paramétrage rapide avant ouverture du tableau de bord
            </div>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={handleSkip}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            Passer cette étape
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6">
        {/* Progress Stepper */}
        <nav
          aria-label="Étapes de configuration"
          className="grid grid-cols-2 sm:grid-cols-4 gap-3"
        >
          {STEPS.map((item) => {
            const Icon = item.icon;
            const isCurrent = step === item.id;
            const isDone = step > item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id < step) setStep(item.id);
                }}
                disabled={item.id > step}
                className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition-colors ${
                  isCurrent
                    ? 'border-teal-700 bg-white text-slate-900'
                    : isDone
                    ? 'border-teal-200 bg-teal-50/50 text-teal-900 cursor-pointer hover:bg-teal-50'
                    : 'border-slate-200 bg-white text-slate-400 cursor-default'
                }`}
              >
                <div
                  className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                    isCurrent
                      ? 'bg-teal-700 text-white'
                      : isDone
                      ? 'bg-teal-600 text-white'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </div>
                <div className="min-w-0">
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-wider opacity-70">
                    Étape 0{item.id}
                  </div>
                  <div className="text-xs font-semibold truncate">{item.label}</div>
                </div>
              </button>
            );
          })}
        </nav>

        {/* Step Card */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-6">
          {/* STEP 1: Établissement */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="border-b border-slate-100 pb-4">
                <h1 className="font-display text-xl font-bold text-slate-900 text-balance">
                  Identité de votre établissement
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  Ces informations apparaissent sur vos tickets PDF A4 / 80mm et sur les relances
                  WhatsApp clients.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nom commercial *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.shopName}
                    onChange={(e) => setForm({ ...form, shopName: e.target.value })}
                    placeholder="Ex : Éclat Pressing Abidjan"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Slogan / Spécialité
                  </label>
                  <input
                    type="text"
                    value={form.tagline}
                    onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                    placeholder="Ex : Pressing & Blanchisserie Moderne"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Commune / Ville
                  </label>
                  <input
                    type="text"
                    value={form.commune}
                    onChange={(e) => setForm({ ...form, commune: e.target.value })}
                    placeholder="Ex : Cocody · Angré 8e Tranche"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Adresse exacte
                  </label>
                  <input
                    type="text"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="Ex : Carrefour Prière, Immeuble Horizon"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Téléphone comptoir
                  </label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-mono focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    N° WhatsApp
                  </label>
                  <input
                    type="tel"
                    value={form.whatsappPhone}
                    onChange={(e) => setForm({ ...form, whatsappPhone: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-mono focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    RCCM / N° Registre
                  </label>
                  <input
                    type="text"
                    value={form.rccm}
                    onChange={(e) => setForm({ ...form, rccm: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-mono focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Activités & Tarifs */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h1 className="font-display text-xl font-bold text-slate-900 text-balance">
                  Activités &amp; Règles tarifaires du comptoir
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  Choisissez les prestations actives. Vous pourrez ajouter davantage de paliers à
                  tout moment dans Paramètres.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {ACTIVITY_CHOICES.map((opt) => {
                  const selected = form.activityScope === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setErrorMsg('');
                        setForm({ ...form, activityScope: opt.value });
                      }}
                      className={`rounded-xl border p-4 text-left transition-colors cursor-pointer ${
                        selected
                          ? 'border-teal-700 bg-teal-50/70'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900">{opt.title}</span>
                        {selected && <Check className="h-4 w-4 text-teal-700 shrink-0" />}
                      </div>
                      <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>

              {pressingActive && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5 space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Pressing · Express par article &amp; Pesée au kilo
                    </h2>
                    <p className="text-xs text-slate-500">
                      Le service Express s&apos;attribue article par article lors du dépôt (ex :
                      uniquement sur un complet veste).
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Mode Express
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
                        <option value="fixed_per_piece">Montant fixe par article (FCFA)</option>
                        <option value="percent">Majoration (%)</option>
                      </select>
                    </div>

                    {form.pressingConfig.expressPricingMode === 'fixed_per_piece' ? (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Montant Express (FCFA / article)
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
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
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
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none"
                        />
                      </div>
                    )}

                    <div className="flex items-end pb-1">
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
                          className="h-4 w-4 rounded border-slate-300 text-teal-700"
                        />
                        <span>Activer la tarification au kilo</span>
                      </label>
                    </div>
                  </div>

                  {form.pressingConfig.weightEnabled && primaryWeightOffer && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200/80">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Offre poids suggérée au comptoir (kg)
                        </label>
                        <input
                          type="number"
                          min={0.1}
                          step={0.1}
                          value={primaryWeightOffer.weightKg}
                          onChange={(e) =>
                            updatePrimaryWeightOffer({
                              weightKg: Math.max(0.1, Number(e.target.value) || 1.5),
                            })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Prix suggéré pour {primaryWeightOffer.weightKg} kg (FCFA)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step={100}
                          value={primaryWeightOffer.priceFCFA}
                          onChange={(e) =>
                            updatePrimaryWeightOffer({
                              priceFCFA: Math.max(0, Math.round(Number(e.target.value) || 0)),
                            })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {blanchisserieActive && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Blanchisserie · Formules &amp; Forfait vêtements principal
                    </h2>
                    <p className="text-xs text-slate-500">
                      Ex : 10 vêtements tous types confondus pour 2 000 FCFA en lavage + repassage.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-4">
                    {BLANCHISSERIE_SERVICES.map((svc) => (
                      <label
                        key={svc}
                        className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={form.blanchisserieConfig.enabledServices[svc]}
                          onChange={() => toggleBlanchisserieService(svc)}
                          className="h-4 w-4 rounded border-slate-300 text-teal-700"
                        />
                        <span>{BLANCHISSERIE_SERVICE_LABELS[svc]}</span>
                      </label>
                    ))}
                  </div>

                  {primaryPack && (
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Nb vêtements forfait
                        </label>
                        <input
                          type="number"
                          min={2}
                          max={200}
                          value={primaryPack.garmentCount}
                          onChange={(e) => updatePrimaryPackCount(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs font-bold tabular-nums focus:border-teal-600 focus:outline-none"
                        />
                      </div>
                      {BLANCHISSERIE_SERVICES.map((svc) => {
                        const enabled = form.blanchisserieConfig.enabledServices[svc];
                        return (
                          <div key={svc}>
                            <label className="block text-xs font-medium text-slate-700 mb-1 truncate">
                              {BLANCHISSERIE_SERVICE_LABELS[svc]} (FCFA)
                            </label>
                            <input
                              type="number"
                              min={0}
                              step={100}
                              disabled={!enabled}
                              value={primaryPack.pricesFCFA[svc]}
                              onChange={(e) => updatePrimaryPackPrice(svc, e.target.value)}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.blanchisserieConfig.enableUnit}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          blanchisserieConfig: {
                            ...form.blanchisserieConfig,
                            enableUnit: e.target.checked,
                          },
                        })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-teal-700"
                    />
                    <span>Autoriser également la facturation à l&apos;unité en blanchisserie</span>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: Fidélité, Ticket & Démarrage */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h1 className="font-display text-xl font-bold text-slate-900 text-balance">
                  Fidélité client, mentions tickets &amp; démarrage
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  Réglez la récompense fidélité automatique et choisissez si vous démarrez avec les
                  exemples Abidjan ou avec une caisse vierge.
                </p>
              </div>

              {/* Fidélité */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      Points de fidélité automatiques
                    </div>
                    <p className="text-xs text-slate-500">
                      Chaque commande soldée crédite des points convertibles en remise au comptoir.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={loyalty.enabled}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          loyaltyConfig: { ...loyalty, enabled: e.target.checked },
                        })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-teal-700"
                    />
                    <span>Activer</span>
                  </label>
                </div>

                {loyalty.enabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        FCFA pour 1 point
                      </label>
                      <input
                        type="number"
                        min={100}
                        step={100}
                        value={loyalty.fcfaPerPoint}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            loyaltyConfig: {
                              ...loyalty,
                              fcfaPerPoint: Math.max(100, Math.round(Number(e.target.value) || 500)),
                            },
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Seuil de points récompense
                      </label>
                      <input
                        type="number"
                        min={5}
                        step={5}
                        value={loyalty.rewardThresholdPoints}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            loyaltyConfig: {
                              ...loyalty,
                              rewardThresholdPoints: Math.max(
                                5,
                                Math.round(Number(e.target.value) || 100)
                              ),
                            },
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Remise offerte (FCFA)
                      </label>
                      <input
                        type="number"
                        min={100}
                        step={100}
                        value={loyalty.rewardDiscountFCFA}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            loyaltyConfig: {
                              ...loyalty,
                              rewardDiscountFCFA: Math.max(
                                100,
                                Math.round(Number(e.target.value) || 2000)
                              ),
                            },
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs tabular-nums focus:border-teal-600 focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Mention bas de ticket */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Mention légale imprimée en bas de chaque reçu PDF / ticket
                </label>
                <textarea
                  rows={2}
                  value={form.ticketFooterNote}
                  onChange={(e) => setForm({ ...form, ticketFooterNote: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>

              {/* Dataset startup choice */}
              <div className="space-y-2.5">
                <div className="text-xs font-semibold text-slate-800">
                  Données initiales au premier accès
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setStartFresh(false)}
                    className={`rounded-xl border p-4 text-left transition-colors cursor-pointer ${
                      !startFresh
                        ? 'border-teal-700 bg-teal-50/70'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900">
                        Conserver les exemples Abidjan ({ordersCount} tickets)
                      </span>
                      {!startFresh && <Check className="h-4 w-4 text-teal-700" />}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Idéal pour explorer immédiatement les graphiques, le suivi code-barres et les
                      reçus PDF.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStartFresh(true)}
                    className={`rounded-xl border p-4 text-left transition-colors cursor-pointer ${
                      startFresh
                        ? 'border-teal-700 bg-teal-50/70'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900">
                        Démarrer à zéro (0 ticket, catalogue conservé)
                      </span>
                      {startFresh && <Check className="h-4 w-4 text-teal-700" />}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Vide les tickets, clients et paiements de démonstration tout en gardant vos
                      tarifs et votre code PIN.
                    </p>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Validation */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-teal-700">
                  <Sparkles className="h-4 w-4" />
                  <span>Prêt pour ouverture</span>
                </div>
                <h1 className="font-display text-xl font-bold text-slate-900 mt-1 text-balance">
                  Récapitulatif de votre configuration
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  Vérifiez vos paramètres clés avant d&apos;accéder au tableau de bord.
                </p>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs border-collapse">
                  <tbody className="divide-y divide-slate-200">
                    <tr>
                      <th className="py-3 px-4 font-semibold text-slate-600 bg-slate-50 w-48">
                        Établissement
                      </th>
                      <td className="py-3 px-4 text-slate-900 font-medium">
                        {form.shopName} · {form.commune} ({form.phone})
                      </td>
                    </tr>
                    <tr>
                      <th className="py-3 px-4 font-semibold text-slate-600 bg-slate-50">
                        Activités activées
                      </th>
                      <td className="py-3 px-4 text-slate-900 font-medium">
                        {SHOP_ACTIVITY_LABELS[form.activityScope]}
                      </td>
                    </tr>
                    {pressingActive && (
                      <tr>
                        <th className="py-3 px-4 font-semibold text-slate-600 bg-slate-50">
                          Pressing Express &amp; Kilo
                        </th>
                        <td className="py-3 px-4 text-slate-900">
                          {form.pressingConfig.expressPricingMode === 'fixed_per_piece'
                            ? `${formatFCFA(form.pressingConfig.expressFixedAmountFCFA)} par article Express`
                            : `+${form.pressingConfig.expressPercent}% par article Express`}
                          {' · '}
                          {form.pressingConfig.weightEnabled && primaryWeightOffer
                            ? `Pesée au kg active (ex : ${primaryWeightOffer.weightKg} kg à ${formatFCFA(primaryWeightOffer.priceFCFA)})`
                            : 'Pesée au kg désactivée'}
                        </td>
                      </tr>
                    )}
                    {blanchisserieActive && primaryPack && (
                      <tr>
                        <th className="py-3 px-4 font-semibold text-slate-600 bg-slate-50">
                          Blanchisserie forfaitaire
                        </th>
                        <td className="py-3 px-4 text-slate-900">
                          Forfait principal : {primaryPack.garmentCount} vêtements à{' '}
                          {formatFCFA(primaryPack.pricesFCFA.lavage_repassage)} (Lavage + Repassage)
                        </td>
                      </tr>
                    )}
                    <tr>
                      <th className="py-3 px-4 font-semibold text-slate-600 bg-slate-50">
                        Fidélité client
                      </th>
                      <td className="py-3 px-4 text-slate-900">
                        {loyalty.enabled
                          ? `1 pt / ${formatFCFA(loyalty.fcfaPerPoint)} · ${formatFCFA(
                              loyalty.rewardDiscountFCFA
                            )} offerts dès ${loyalty.rewardThresholdPoints} pts`
                          : 'Désactivée'}
                      </td>
                    </tr>
                    <tr>
                      <th className="py-3 px-4 font-semibold text-slate-600 bg-slate-50">
                        Jeu de données
                      </th>
                      <td className="py-3 px-4 text-slate-900 font-medium">
                        {startFresh
                          ? 'Démarrage à zéro (base commandes vidée, tarifs & PIN conservés)'
                          : `Jeu d'essai Abidjan conservé (${ordersCount} tickets prêts)`}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {errorMsg && (
            <p className="text-xs font-medium text-red-700" role="alert">
              {errorMsg}
            </p>
          )}

          {/* Footer Navigation */}
          <div className="flex items-center justify-between gap-3 pt-4 border-t border-slate-100">
            {step > 1 ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setErrorMsg('');
                  setStep((s) => Math.max(1, s - 1));
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Précédent</span>
              </button>
            ) : (
              <span className="text-xs text-slate-400">Étape 1 sur 4</span>
            )}

            {step < 4 ? (
              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-5 py-2.5 text-xs font-semibold text-white hover:bg-teal-800 cursor-pointer"
              >
                <span>Continuer</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={handleFinish}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-5 py-2.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
              >
                <Check className="h-4 w-4" />
                <span>
                  {saving
                    ? 'Enregistrement...'
                    : 'Enregistrer et accéder au tableau de bord'}
                </span>
              </button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};
