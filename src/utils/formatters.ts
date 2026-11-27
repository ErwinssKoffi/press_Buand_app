import {
  BlanchisserieBasis,
  BlanchisserieService,
  ExpenseCategory,
  InventoryCategory,
  InventoryMovementType,
  LogisticsStatus,
  LogisticsType,
  OrderLineItem,
  OrderStatus,
  PaymentMethod,
  PressingOrder,
  PressingSettings,
  ServiceMode,
  ShopActivityScope,
} from '../types/pressing';

export const ABIDJAN_COMMUNES = [
  'Sur place (Comptoir)',
  'Cocody — Angré / 2 Plateaux',
  'Cocody — Riviera',
  'Plateau',
  'Marcory / Zone 4',
  'Treichville',
  'Koumassi',
  'Port-Bouët',
  'Yopougon',
  'Adjamé',
  'Abobo',
  'Bingerville',
  'Songon / Anyama',
  'Intérieur (Yamoussoukro / Bouaké / San-Pédro)',
];

export const SERVICE_MODE_LABELS: Record<ServiceMode, string> = {
  nettoyage_sec: 'Nettoyage à sec',
  lavage_simple: 'Lavage simple',
  lavage_repassage: 'Lavage + Repassage',
  repassage_seul: 'Repassage uniquement',
  blanchisserie: 'Blanchisserie',
};

export const SHOP_ACTIVITY_LABELS: Record<ShopActivityScope, string> = {
  both: 'Pressing & Blanchisserie',
  pressing: 'Pressing uniquement',
  blanchisserie: 'Blanchisserie uniquement',
};

export const BLANCHISSERIE_SERVICES: BlanchisserieService[] = [
  'lavage_simple',
  'lavage_repassage',
  'repassage_seul',
];

export const PRESSING_WEIGHT_MODES: ServiceMode[] = [
  'lavage_repassage',
  'nettoyage_sec',
  'lavage_simple',
  'repassage_seul',
];

export const BLANCHISSERIE_BASES: BlanchisserieBasis[] = ['unite', 'lot_10', 'lot_20'];

export const BLANCHISSERIE_SERVICE_LABELS: Record<BlanchisserieService, string> = {
  lavage_simple: 'Lavage simple',
  lavage_repassage: 'Lavage + Repassage',
  repassage_seul: 'Repassage uniquement',
};

export const BLANCHISSERIE_BASIS_LABELS: Record<BlanchisserieBasis, string> = {
  unite: "À l'unité",
  lot_10: 'Lot de 10 vêtements',
  lot_20: 'Lot de 20 vêtements',
};

export const BLANCHISSERIE_BASIS_SHORT: Record<BlanchisserieBasis, string> = {
  unite: "À l'unité",
  lot_10: 'Lot de 10',
  lot_20: 'Lot de 20',
};

export const BLANCHISSERIE_BASIS_PIECES: Record<BlanchisserieBasis, number> = {
  unite: 1,
  lot_10: 10,
  lot_20: 20,
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  especes: 'Espèces (FCFA)',
  wave: 'Wave',
  orange_money: 'Orange Money',
  mtn_momo: 'MTN MoMo',
  moov_money: 'Moov Money',
};

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Produits & Lessive',
  'Eau & Électricité (CIE/SODECI)',
  'Carburant & Livraison',
  'Salaires',
  'Loyer & Divers',
];

export const INVENTORY_CATEGORIES: InventoryCategory[] = [
  'Lessives & Détachants',
  'Solvants & Nettoyage à sec',
  'Emballages & Cintres',
  'Repassage & Entretien',
  'Étiquetage & Comptoir',
];

export const INVENTORY_UNITS = [
  'bidon',
  'L',
  'kg',
  'carton',
  'paquet',
  'rouleau',
  'pièce',
];

export const INVENTORY_MOVEMENT_LABELS: Record<InventoryMovementType, string> = {
  entree: 'Entrée / Réappro',
  sortie: 'Sortie atelier',
  ajustement: 'Ajustement inventaire',
};

export const INVENTORY_ACTIVITY_LABELS: Record<ShopActivityScope, string> = {
  both: 'Pressing & Blanchisserie',
  pressing: 'Pressing',
  blanchisserie: 'Blanchisserie',
};

export const STATUS_META: Record<
  OrderStatus,
  {
    label: string;
    shortLabel: string;
    textClass: string;
    bgClass: string;
    borderClass: string;
    nextStatus?: OrderStatus;
    nextActionLabel?: string;
  }
> = {
  recu: {
    label: 'Reçu / En attente',
    shortLabel: 'Reçu',
    textClass: 'text-slate-700',
    bgClass: 'bg-slate-100',
    borderClass: 'border-slate-300',
    nextStatus: 'lavage',
    nextActionLabel: 'Passer en lavage',
  },
  lavage: {
    label: 'En lavage / Traitement',
    shortLabel: 'En lavage',
    textClass: 'text-sky-800',
    bgClass: 'bg-sky-50',
    borderClass: 'border-sky-200',
    nextStatus: 'repassage',
    nextActionLabel: 'Passer au repassage',
  },
  repassage: {
    label: 'Repassage & Finition',
    shortLabel: 'Repassage',
    textClass: 'text-amber-800',
    bgClass: 'bg-amber-50',
    borderClass: 'border-amber-200',
    nextStatus: 'pret',
    nextActionLabel: 'Marquer prêt',
  },
  pret: {
    label: 'Prêt pour retrait',
    shortLabel: 'Prêt',
    textClass: 'text-emerald-800',
    bgClass: 'bg-emerald-50',
    borderClass: 'border-emerald-200',
    nextStatus: 'livre',
    nextActionLabel: 'Remettre au client',
  },
  livre: {
    label: 'Livré / Retiré',
    shortLabel: 'Livré',
    textClass: 'text-slate-500',
    bgClass: 'bg-slate-50',
    borderClass: 'border-slate-200',
  },
};

export const TIME_SLOTS = [
  '08h00 - 11h00',
  '11h00 - 14h00',
  '14h00 - 17h00',
  '17h00 - 20h00',
];

export const LOGISTICS_TYPE_LABELS: Record<LogisticsType, string> = {
  enlevement: 'Enlèvement à domicile',
  livraison: 'Livraison à domicile',
};

export const LOGISTICS_STATUS_META: Record<
  LogisticsStatus,
  {
    label: string;
    textClass: string;
    bgClass: string;
    borderClass: string;
    nextStatus?: LogisticsStatus;
    nextActionLabel?: string;
  }
> = {
  planifie: {
    label: 'Planifié',
    textClass: 'text-slate-700',
    bgClass: 'bg-slate-100',
    borderClass: 'border-slate-300',
    nextStatus: 'en_cours',
    nextActionLabel: 'Démarrer la tournée',
  },
  en_cours: {
    label: 'En tournée',
    textClass: 'text-sky-800',
    bgClass: 'bg-sky-50',
    borderClass: 'border-sky-200',
    nextStatus: 'effectue',
    nextActionLabel: 'Marquer effectué',
  },
  effectue: {
    label: 'Effectué',
    textClass: 'text-emerald-800',
    bgClass: 'bg-emerald-50',
    borderClass: 'border-emerald-200',
  },
  annule: {
    label: 'Annulé',
    textClass: 'text-red-700',
    bgClass: 'bg-red-50',
    borderClass: 'border-red-200',
  },
};

export function formatFCFA(amount: number): string {
  const rounded = Math.round(amount || 0);
  const formatted = new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 0,
  }).format(rounded);
  return `${formatted} FCFA`;
}

export function formatShortNumber(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 0,
  }).format(Math.round(amount || 0));
}

export function formatWeightKg(kg: number): string {
  return `${new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: kg % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2,
  }).format(kg)} kg`;
}

export function computeLineExpressFee(
  line: Pick<OrderLineItem, 'isExpress' | 'quantity' | 'unit' | 'unitPriceFCFA'>,
  settings: PressingSettings
): number {
  if (!line.isExpress) return 0;
  const pc = settings.pressingConfig;
  if (pc.expressPricingMode === 'fixed_per_piece') {
    const multiplier = line.unit === 'kg' ? 1 : Math.max(1, line.quantity);
    return Math.max(0, Math.round(pc.expressFixedAmountFCFA * multiplier));
  }
  const pct = pc.expressPercent ?? settings.expressPercent ?? 50;
  return Math.max(0, Math.round((line.quantity * line.unitPriceFCFA * pct) / 100));
}

export function formatDateFR(isoDate: string): string {
  if (!isoDate) return '—';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function formatDateTimeFR(isoDate: string): string {
  if (!isoDate) return '—';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function getTodayISO(): string {
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffset).toISOString().slice(0, 10);
}

export function addDaysISO(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() + days);
  const tzOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffset).toISOString().slice(0, 10);
}

export function buildWhatsAppMessage(
  order: PressingOrder,
  settings: PressingSettings
): string {
  const remaining = Math.max(0, order.totalFCFA - order.paidFCFA);
  const statusText =
    order.status === 'pret'
      ? 'est PRÊT pour retrait'
      : order.status === 'livre'
      ? 'a bien été remis'
      : `est actuellement au stade : ${STATUS_META[order.status].label}`;

  const balanceLine =
    remaining > 0
      ? `Reste à régler : ${formatFCFA(remaining)} (Espèces, Wave, Orange Money ou MTN MoMo).`
      : 'Règlement soldé en totalité.';

  const totalPieces = order.items.reduce(
    (s, i) => s + (i.unit === 'kg' ? 0 : i.quantity * (i.piecesPerUnit || 1)),
    0
  );
  const totalKg = order.items.reduce(
    (s, i) =>
      s + (i.weightKg ? i.quantity * i.weightKg : i.unit === 'kg' ? i.quantity : 0),
    0
  );
  const volumeParts: string[] = [];
  if (totalPieces > 0) {
    volumeParts.push(`${totalPieces} pièce(s)`);
  }
  if (totalKg > 0) {
    volumeParts.push(formatWeightKg(totalKg));
  }
  const volumeLabel = volumeParts.join(' + ') || 'votre dépôt';

  return [
    `Bonjour ${order.clientName},`,
    `Votre ticket *${order.ticketNumber}* (${volumeLabel}) chez *${settings.shopName}* ${statusText}.`,
    `Casier / Cintre : ${order.rackSlot || 'Comptoir'}.`,
    balanceLine,
    `Adresse : ${settings.address}, ${settings.commune}.`,
    `Merci de votre confiance !`,
  ].join('\n');
}
