import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Delete,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import atelierHeroImg from '../assets/images/pressing_atelier_hero_1795762948101.jpg';
import { PressingSettings } from '../types/pressing';
import {
  generatePinSaltHex,
  hashFiveDigitPin,
  isValidFiveDigitPin,
  verifyFiveDigitPin,
} from '../utils/pinAuth';

interface LoginViewProps {
  settings: PressingSettings;
  onSetupPin: (pinHash: string, pinSalt: string) => Promise<void>;
  onUnlockSuccess: () => void;
  onResetPin: () => Promise<void>;
}

const PIN_LENGTH = 5;
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15;

const WORKFLOW_STEPS = [
  {
    step: '01',
    title: 'Dépôt & Réserves',
    desc: 'Tarifs Pressing (pièce, kilo, express ciblé) et forfaits Blanchisserie avec photos réserves.',
  },
  {
    step: '02',
    title: 'Suivi Atelier',
    desc: 'Portant, code-barres scannable, alertes de livraison du jour et tickets en retard.',
  },
  {
    step: '03',
    title: 'Caisse & Mobile Money',
    desc: 'Wave, Orange Money, MTN Moov, espèces, comptes prépayés et points fidélité.',
  },
  {
    step: '04',
    title: 'Stocks & Clôture Z',
    desc: 'Suivi lessives/cintres, dépenses atelier et rapports PDF A4 ou thermique 80mm.',
  },
];

export const LoginView: React.FC<LoginViewProps> = ({
  settings,
  onSetupPin,
  onUnlockSuccess,
  onResetPin,
}) => {
  const hasExistingPin = Boolean(settings.pinHash && settings.pinSalt);

  const [pinDigits, setPinDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''));
  const [confirmDigits, setConfirmDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''));
  const [activeGroup, setActiveGroup] = useState<'pin' | 'confirm'>('pin');
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const [showDigits, setShowDigits] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const confirmInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  useEffect(() => {
    setPinDigits(Array(PIN_LENGTH).fill(''));
    setConfirmDigits(Array(PIN_LENGTH).fill(''));
    setActiveGroup('pin');
    setActiveIndex(0);
    setErrorMsg('');
    setConfirmResetOpen(false);
  }, [hasExistingPin]);

  const focusBox = (group: 'pin' | 'confirm', idx: number) => {
    const clamped = Math.max(0, Math.min(PIN_LENGTH - 1, idx));
    setActiveGroup(group);
    setActiveIndex(clamped);
    const refList = group === 'pin' ? pinInputRefs.current : confirmInputRefs.current;
    refList[clamped]?.focus();
  };

  const handleCtaFocusPin = () => {
    const firstEmpty = pinDigits.findIndex((d) => !d);
    focusBox('pin', firstEmpty >= 0 ? firstEmpty : 0);
  };

  const updateDigitAt = (
    group: 'pin' | 'confirm',
    idx: number,
    rawVal: string
  ) => {
    if (cooldownSeconds > 0 || submitting) return;
    setErrorMsg('');
    const digitsOnly = rawVal.replace(/\D/g, '');
    const currentArr = group === 'pin' ? [...pinDigits] : [...confirmDigits];
    const setter = group === 'pin' ? setPinDigits : setConfirmDigits;

    if (!digitsOnly) {
      currentArr[idx] = '';
      setter(currentArr);
      return;
    }

    // Handle multi-digit input (paste or quick typing)
    if (digitsOnly.length > 1) {
      for (let i = 0; i < digitsOnly.length && idx + i < PIN_LENGTH; i++) {
        currentArr[idx + i] = digitsOnly[i];
      }
      setter(currentArr);
      const nextEmpty = currentArr.findIndex((d) => !d);
      if (nextEmpty >= 0) {
        focusBox(group, nextEmpty);
      } else if (!hasExistingPin && group === 'pin') {
        focusBox('confirm', 0);
      } else {
        focusBox(group, PIN_LENGTH - 1);
      }
      return;
    }

    currentArr[idx] = digitsOnly;
    setter(currentArr);

    if (idx < PIN_LENGTH - 1) {
      focusBox(group, idx + 1);
    } else if (!hasExistingPin && group === 'pin') {
      focusBox('confirm', 0);
    }
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    group: 'pin' | 'confirm',
    idx: number
  ) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (cooldownSeconds > 0 || submitting) return;
      setErrorMsg('');
      const arr = group === 'pin' ? [...pinDigits] : [...confirmDigits];
      const setter = group === 'pin' ? setPinDigits : setConfirmDigits;
      if (arr[idx]) {
        arr[idx] = '';
        setter(arr);
      } else if (idx > 0) {
        arr[idx - 1] = '';
        setter(arr);
        focusBox(group, idx - 1);
      } else if (!hasExistingPin && group === 'confirm') {
        focusBox('pin', PIN_LENGTH - 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (idx > 0) focusBox(group, idx - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (idx < PIN_LENGTH - 1) focusBox(group, idx + 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handleKeypadDigit = (digit: string) => {
    if (cooldownSeconds > 0 || submitting) return;
    setErrorMsg('');
    const targetArr = activeGroup === 'pin' ? [...pinDigits] : [...confirmDigits];
    const setter = activeGroup === 'pin' ? setPinDigits : setConfirmDigits;

    let writeIdx = activeIndex;
    if (targetArr[writeIdx]) {
      const firstEmpty = targetArr.findIndex((d) => !d);
      if (firstEmpty >= 0) {
        writeIdx = firstEmpty;
      }
    }

    targetArr[writeIdx] = digit;
    setter(targetArr);

    if (writeIdx < PIN_LENGTH - 1) {
      setActiveIndex(writeIdx + 1);
    } else if (!hasExistingPin && activeGroup === 'pin') {
      setActiveGroup('confirm');
      setActiveIndex(0);
    }
  };

  const handleKeypadBackspace = () => {
    if (cooldownSeconds > 0 || submitting) return;
    setErrorMsg('');
    const targetArr = activeGroup === 'pin' ? [...pinDigits] : [...confirmDigits];
    const setter = activeGroup === 'pin' ? setPinDigits : setConfirmDigits;

    let lastFilled = -1;
    for (let i = PIN_LENGTH - 1; i >= 0; i--) {
      if (targetArr[i]) {
        lastFilled = i;
        break;
      }
    }

    if (lastFilled >= 0) {
      targetArr[lastFilled] = '';
      setter(targetArr);
      setActiveIndex(lastFilled);
    } else if (!hasExistingPin && activeGroup === 'confirm') {
      setActiveGroup('pin');
      setActiveIndex(PIN_LENGTH - 1);
    }
  };

  const handleKeypadClearAll = () => {
    if (cooldownSeconds > 0 || submitting) return;
    setErrorMsg('');
    setPinDigits(Array(PIN_LENGTH).fill(''));
    setConfirmDigits(Array(PIN_LENGTH).fill(''));
    focusBox('pin', 0);
  };

  const pinValue = pinDigits.join('');
  const confirmValue = confirmDigits.join('');

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (cooldownSeconds > 0 || submitting) return;

    if (!isValidFiveDigitPin(pinValue)) {
      setErrorMsg('Veuillez saisir les 5 chiffres de votre code PIN.');
      const firstEmpty = pinDigits.findIndex((d) => !d);
      focusBox('pin', firstEmpty >= 0 ? firstEmpty : 0);
      return;
    }

    setSubmitting(true);
    setErrorMsg('');
    try {
      if (!hasExistingPin) {
        if (!isValidFiveDigitPin(confirmValue)) {
          setErrorMsg('Confirmez les 5 chiffres de votre code PIN.');
          const firstEmpty = confirmDigits.findIndex((d) => !d);
          focusBox('confirm', firstEmpty >= 0 ? firstEmpty : 0);
          return;
        }
        if (pinValue !== confirmValue) {
          setErrorMsg('Les deux codes PIN ne correspondent pas.');
          setConfirmDigits(Array(PIN_LENGTH).fill(''));
          focusBox('confirm', 0);
          return;
        }

        const salt = generatePinSaltHex(16);
        const hash = await hashFiveDigitPin(pinValue, salt);
        await onSetupPin(hash, salt);
        onUnlockSuccess();
      } else {
        const ok = await verifyFiveDigitPin(pinValue, settings.pinSalt, settings.pinHash);
        if (!ok) {
          const nextAttempts = failedAttempts + 1;
          setFailedAttempts(nextAttempts);
          setPinDigits(Array(PIN_LENGTH).fill(''));
          focusBox('pin', 0);
          if (nextAttempts >= MAX_ATTEMPTS) {
            setFailedAttempts(0);
            setCooldownSeconds(LOCKOUT_SECONDS);
            setErrorMsg(
              `Trop de tentatives incorrectes. Patienter ${LOCKOUT_SECONDS} secondes.`
            );
          } else {
            const remaining = MAX_ATTEMPTS - nextAttempts;
            setErrorMsg(
              `Code PIN incorrect. ${remaining} tentative${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}.`
            );
          }
          return;
        }

        setFailedAttempts(0);
        onUnlockSuccess();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmReset = async () => {
    setSubmitting(true);
    try {
      await onResetPin();
      setConfirmResetOpen(false);
      setFailedAttempts(0);
      setCooldownSeconds(0);
      setPinDigits(Array(PIN_LENGTH).fill(''));
      setConfirmDigits(Array(PIN_LENGTH).fill(''));
    } finally {
      setSubmitting(false);
    }
  };

  const renderDigitGroup = (
    group: 'pin' | 'confirm',
    digits: string[],
    label: string,
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>
  ) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-slate-700">{label}</label>
        <span className="font-mono text-[11px] tabular-nums text-slate-400">
          {digits.filter(Boolean).length}/{PIN_LENGTH} chiffres
        </span>
      </div>
      <div className="grid grid-cols-5 gap-2.5">
        {digits.map((digit, idx) => {
          const isFocused = activeGroup === group && activeIndex === idx;
          return (
            <input
              key={`${group}-${idx}`}
              ref={(el) => {
                refs.current[idx] = el;
              }}
              type={showDigits ? 'text' : 'password'}
              inputMode="numeric"
              autoComplete="off"
              maxLength={PIN_LENGTH}
              value={digit}
              disabled={cooldownSeconds > 0 || submitting}
              aria-label={`${label} chiffre ${idx + 1}`}
              onFocus={() => {
                setActiveGroup(group);
                setActiveIndex(idx);
              }}
              onChange={(e) => updateDigitAt(group, idx, e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, group, idx)}
              className={`h-13 w-full rounded-xl border text-center font-mono text-xl font-bold tabular-nums transition-colors focus:outline-none disabled:bg-slate-100 disabled:text-slate-400 ${
                digit
                  ? 'border-teal-700 bg-teal-50/40 text-slate-900'
                  : isFocused
                  ? 'border-teal-600 bg-white text-slate-900 ring-2 ring-teal-600/20'
                  : 'border-slate-300 bg-white text-slate-900 hover:border-slate-400'
              }`}
            />
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-8">
      <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* CADRE 1 : Image Atelier + Explication concrète + CTA */}
        <section className="lg:col-span-7 relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-900 min-h-[460px] lg:min-h-[650px] flex flex-col justify-between">
          <img
            src={atelierHeroImg}
            alt="Atelier de pressing et blanchisserie Éclat Pressing"
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/75 to-slate-950/35" />

          {/* Top Bar */}
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 p-6 sm:p-8 border-b border-white/10">
            <div>
              <div className="font-display text-lg font-bold tracking-tight text-white">
                {settings.shopName}
              </div>
              <div className="text-xs text-slate-300">{settings.commune}</div>
            </div>
            <div className="text-xs font-medium text-slate-200">
              Comptoir hors-ligne · FCFA
            </div>
          </div>

          {/* Bottom Editorial Value Proposition & CTA */}
          <div className="relative z-10 p-6 sm:p-8 space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-300">
                Gestion professionnelle de pressing &amp; blanchisserie
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-white leading-tight tracking-tight text-balance">
                Maîtrisez chaque dépôt, chaque encaissement et votre caisse atelier sans internet.
              </h1>
              <p className="text-sm text-slate-200 leading-relaxed max-w-2xl">
                Conçue pour les gérants exigeants, l&apos;application centralise l&apos;accueil
                client au comptoir, le suivi sur portant par code-barres et le pilotage financier
                quotidien sur votre poste.
              </p>
            </div>

            {/* 3 Concrete Operational Benefits */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-1">
              <div className="rounded-xl border border-white/15 bg-slate-950/55 p-3.5 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <CheckCircle2 className="h-4 w-4 text-teal-400 shrink-0" />
                  <span>Comptoir &amp; Tarifs</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">
                  Pressing à la pièce ou au kilo, Express par vêtement, forfaits Blanchisserie,
                  Wave, Orange Money et comptes prépayés.
                </p>
              </div>

              <div className="rounded-xl border border-white/15 bg-slate-950/55 p-3.5 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <CheckCircle2 className="h-4 w-4 text-teal-400 shrink-0" />
                  <span>Zéro litige client</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">
                  Photos des réserves à la réception, étiquetage portant avec code-barres et reçus
                  PDF A4 ou 80mm.
                </p>
              </div>

              <div className="rounded-xl border border-white/15 bg-slate-950/55 p-3.5 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <CheckCircle2 className="h-4 w-4 text-teal-400 shrink-0" />
                  <span>Caisse Z &amp; Stocks</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">
                  Alertes sur les livraisons du jour ou en retard, clôture Z quotidienne et
                  inventaire des lessives &amp; cintres.
                </p>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleCtaFocusPin}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-500 transition-colors cursor-pointer"
              >
                <span>
                  {hasExistingPin
                    ? 'Accéder au comptoir'
                    : 'Définir mon code PIN et configurer'}
                </span>
                <ArrowRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => setShowWorkflow((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/25 bg-slate-950/50 px-4 py-3 text-xs font-semibold text-white hover:bg-slate-900/70 transition-colors cursor-pointer"
              >
                <span>Découvrir le circuit en 4 étapes</span>
                {showWorkflow ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
            </div>

            {showWorkflow && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-white/15">
                {WORKFLOW_STEPS.map((w) => (
                  <div
                    key={w.step}
                    className="rounded-lg bg-slate-950/70 px-3 py-2.5 border border-white/10"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-bold text-teal-300">
                        {w.step}
                      </span>
                      <span className="text-xs font-semibold text-white">{w.title}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-300 leading-snug">{w.desc}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* CADRE 2 : Formulaire PIN 5 chiffres */}
        <section className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 flex flex-col justify-between">
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-5">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-teal-700">
                  {hasExistingPin ? (
                    <Lock className="h-4 w-4 shrink-0" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                  )}
                  <span>
                    {hasExistingPin ? 'Accès sécurisé · PIN 5 chiffres' : 'Première ouverture'}
                  </span>
                </div>
                <h2 className="font-display text-xl font-bold text-slate-900 text-balance">
                  {hasExistingPin
                    ? 'Déverrouiller le comptoir'
                    : 'Créer votre code PIN à 5 chiffres'}
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {hasExistingPin
                    ? settings.onboardingCompleted
                      ? 'Saisissez votre code PIN à 5 chiffres pour ouvrir le tableau de bord.'
                      : "Déverrouillez l'accès pour finaliser la configuration initiale de votre établissement."
                    : 'Définissez votre code PIN personnel à 5 chiffres pour protéger les encaissements et paramètres sur ce poste.'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowDigits((s) => !s)}
                className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700 cursor-pointer shrink-0"
                title={showDigits ? 'Masquer les chiffres' : 'Afficher les chiffres'}
                aria-label={showDigits ? 'Masquer les chiffres' : 'Afficher les chiffres'}
              >
                {showDigits ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {/* PIN Inputs Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {renderDigitGroup(
                'pin',
                pinDigits,
                hasExistingPin ? 'Code PIN (5 chiffres)' : 'Choisir un PIN (5 chiffres)',
                pinInputRefs
              )}

              {!hasExistingPin &&
                renderDigitGroup(
                  'confirm',
                  confirmDigits,
                  'Confirmer le PIN (5 chiffres)',
                  confirmInputRefs
                )}

              {errorMsg && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-medium text-red-800"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
                  <span className="font-mono tabular-nums">
                    {cooldownSeconds > 0
                      ? `Trop de tentatives. Réessayez dans ${cooldownSeconds} s.`
                      : errorMsg}
                  </span>
                </div>
              )}

              {/* Tactile Numeric Keypad */}
              <div className="pt-1">
                <div className="grid grid-cols-3 gap-2">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      disabled={cooldownSeconds > 0 || submitting}
                      onClick={() => handleKeypadDigit(digit)}
                      className="h-12 rounded-xl border border-slate-200 bg-slate-50 font-mono text-base font-bold text-slate-900 hover:bg-slate-100 active:bg-teal-50 disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={cooldownSeconds > 0 || submitting}
                    onClick={handleKeypadClearAll}
                    className="h-12 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors cursor-pointer"
                  >
                    Vider
                  </button>
                  <button
                    type="button"
                    disabled={cooldownSeconds > 0 || submitting}
                    onClick={() => handleKeypadDigit('0')}
                    className="h-12 rounded-xl border border-slate-200 bg-slate-50 font-mono text-base font-bold text-slate-900 hover:bg-slate-100 active:bg-teal-50 disabled:opacity-40 transition-colors cursor-pointer"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    disabled={cooldownSeconds > 0 || submitting}
                    onClick={handleKeypadBackspace}
                    className="h-12 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors cursor-pointer"
                    aria-label="Effacer un chiffre"
                    title="Effacer un chiffre"
                  >
                    <Delete className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={cooldownSeconds > 0 || submitting}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <KeyRound className="h-4 w-4" />
                <span>
                  {submitting
                    ? 'Vérification...'
                    : hasExistingPin
                    ? "Déverrouiller l'application"
                    : 'Enregistrer le PIN et continuer'}
                </span>
              </button>
            </form>
          </div>

          {/* Footer / Guarded Forgotten PIN Reset */}
          <div className="mt-6 border-t border-slate-100 pt-4 space-y-2.5">
            {hasExistingPin ? (
              !confirmResetOpen ? (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400">Stockage chiffré localement</span>
                  <button
                    type="button"
                    onClick={() => setConfirmResetOpen(true)}
                    className="font-medium text-slate-600 hover:text-slate-900 underline underline-offset-2 cursor-pointer"
                  >
                    Code PIN oublié ?
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <p className="text-[11px] leading-relaxed text-amber-950">
                    La réinitialisation efface le code PIN actuel sur ce poste local sans supprimer
                    vos tickets ni vos clients, et vous invite à créer un nouveau PIN à 5 chiffres.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleConfirmReset}
                      className="rounded-lg bg-amber-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-800 cursor-pointer"
                    >
                      Réinitialiser le PIN
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmResetOpen(false)}
                      className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100 cursor-pointer"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )
            ) : (
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Étape suivante : après avoir créé votre code PIN, un assistant en 4 étapes vous
                permettra de configurer vos activités, tarifs et mentions tickets avant d&apos;ouvrir
                le tableau de bord.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
