import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  BlanchisserieConfig,
  BlanchisseriePack,
  CatalogItem,
  Client,
  ClientWalletEntry,
  DatabaseBackup,
  DeliveryZone,
  ExpenseRecord,
  InventoryItem,
  InventoryMovement,
  InventoryMovementType,
  LogisticsStatus,
  LogisticsTask,
  LoyaltyConfig,
  OrderStatus,
  PaymentMethod,
  PaymentRecord,
  PressingConfig,
  PressingOrder,
  PressingSettings,
} from '../types/pressing';
import { addDaysISO, getTodayISO } from '../utils/formatters';
import { resolveCatalogItemImage } from '../utils/catalogImages';

interface PressingDBSchema extends DBSchema {
  settings: {
    key: string;
    value: PressingSettings;
  };
  catalog: {
    key: string;
    value: CatalogItem;
  };
  clients: {
    key: string;
    value: Client;
  };
  orders: {
    key: string;
    value: PressingOrder;
    indexes: { 'by-createdAt': string; 'by-status': OrderStatus };
  };
  payments: {
    key: string;
    value: PaymentRecord;
    indexes: { 'by-paidAt': string; 'by-orderId': string };
  };
  expenses: {
    key: string;
    value: ExpenseRecord;
    indexes: { 'by-date': string };
  };
  zones: {
    key: string;
    value: DeliveryZone;
  };
  logistics: {
    key: string;
    value: LogisticsTask;
    indexes: { 'by-date': string; 'by-status': LogisticsStatus };
  };
  inventory: {
    key: string;
    value: InventoryItem;
  };
  inventoryMovements: {
    key: string;
    value: InventoryMovement;
    indexes: { 'by-createdAt': string; 'by-itemId': string };
  };
}

const DB_NAME = 'eclat_pressing_ci_v1';
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<PressingDBSchema>> | null = null;

export async function getDB(): Promise<IDBPDatabase<PressingDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<PressingDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('catalog')) {
          db.createObjectStore('catalog', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('clients')) {
          db.createObjectStore('clients', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('orders')) {
          const orderStore = db.createObjectStore('orders', { keyPath: 'id' });
          orderStore.createIndex('by-createdAt', 'createdAt');
          orderStore.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('payments')) {
          const paymentStore = db.createObjectStore('payments', { keyPath: 'id' });
          paymentStore.createIndex('by-paidAt', 'paidAt');
          paymentStore.createIndex('by-orderId', 'orderId');
        }
        if (!db.objectStoreNames.contains('expenses')) {
          const expenseStore = db.createObjectStore('expenses', { keyPath: 'id' });
          expenseStore.createIndex('by-date', 'date');
        }
        if (!db.objectStoreNames.contains('zones')) {
          db.createObjectStore('zones', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('logistics')) {
          const logStore = db.createObjectStore('logistics', { keyPath: 'id' });
          logStore.createIndex('by-date', 'scheduledDate');
          logStore.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('inventory')) {
          db.createObjectStore('inventory', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('inventoryMovements')) {
          const movStore = db.createObjectStore('inventoryMovements', { keyPath: 'id' });
          movStore.createIndex('by-createdAt', 'createdAt');
          movStore.createIndex('by-itemId', 'itemId');
        }
      },
    });
  }
  return dbPromise;
}

export const DEFAULT_BLANCHISSERIE_CONFIG: BlanchisserieConfig = {
  enabledServices: {
    lavage_simple: true,
    lavage_repassage: true,
    repassage_seul: true,
  },
  enableUnit: true,
  unitPricesFCFA: {
    lavage_simple: 500,
    lavage_repassage: 800,
    repassage_seul: 400,
  },
  packs: [
    {
      id: 'pack-10',
      garmentCount: 10,
      active: true,
      pricesFCFA: {
        lavage_simple: 1500,
        lavage_repassage: 2000,
        repassage_seul: 1200,
      },
    },
    {
      id: 'pack-20',
      garmentCount: 20,
      active: true,
      pricesFCFA: {
        lavage_simple: 2800,
        lavage_repassage: 3800,
        repassage_seul: 2200,
      },
    },
  ],
};

export const DEFAULT_PRESSING_CONFIG: PressingConfig = {
  weightEnabled: true,
  pricePerKgByMode: {
    nettoyage_sec: 4000,
    lavage_simple: 2500,
    lavage_repassage: 3500,
    repassage_seul: 2000,
    blanchisserie: 2500,
  },
  weightOffers: [
    {
      id: 'wo-1',
      label: 'Forfait 1,5 kg (Lavage + Repassage)',
      weightKg: 1.5,
      mode: 'lavage_repassage',
      priceFCFA: 5000,
      active: true,
    },
    {
      id: 'wo-2',
      label: 'Forfait 3 kg (Lavage + Repassage)',
      weightKg: 3,
      mode: 'lavage_repassage',
      priceFCFA: 9000,
      active: true,
    },
    {
      id: 'wo-3',
      label: 'Forfait 2 kg (Nettoyage à sec)',
      weightKg: 2,
      mode: 'nettoyage_sec',
      priceFCFA: 7500,
      active: true,
    },
  ],
  expressPricingMode: 'fixed_per_piece',
  expressFixedAmountFCFA: 1500,
  expressPercent: 50,
};

export const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = {
  enabled: true,
  fcfaPerPoint: 1000,
  rewardThresholdPoints: 50,
  rewardDiscountFCFA: 2000,
};

export const DEFAULT_SETTINGS: PressingSettings = {
  id: 'default',
  shopName: 'Éclat Pressing Abidjan',
  tagline: 'Soin du linge · Nettoyage à sec · Blanchisserie',
  commune: 'Cocody — Angré 8e Tranche',
  address: 'Boulevard Latrille, Immeuble Les Orchidées',
  phone: '+225 07 48 22 19 04',
  whatsappPhone: '+225 07 48 22 19 04',
  rccm: 'CI-ABJ-03-2024-B12-04821',
  expressPercent: 50,
  ticketFooterNote:
    'Tout article non retiré après 60 jours ne saurait engager la responsabilité du pressing. Merci pour votre fidélité.',
  nextTicketSequence: 48,
  activityScope: 'both',
  blanchisserieConfig: DEFAULT_BLANCHISSERIE_CONFIG,
  pressingConfig: DEFAULT_PRESSING_CONFIG,
  loyaltyConfig: DEFAULT_LOYALTY_CONFIG,
};

export function normalizeSettings(raw?: Partial<PressingSettings> | null): PressingSettings {
  const bc = raw?.blanchisserieConfig;
  const pc = raw?.pressingConfig;

  let packs: BlanchisseriePack[];
  if (Array.isArray(bc?.packs) && bc.packs.length > 0) {
    packs = bc.packs.map((pk, idx) => ({
      id: pk.id || `pack-${idx + 1}`,
      garmentCount: Math.max(2, Math.round(Number(pk.garmentCount) || 10)),
      active: pk.active ?? true,
      pricesFCFA: {
        lavage_simple: Math.max(0, Math.round(Number(pk.pricesFCFA?.lavage_simple) || 0)),
        lavage_repassage: Math.max(0, Math.round(Number(pk.pricesFCFA?.lavage_repassage) || 0)),
        repassage_seul: Math.max(0, Math.round(Number(pk.pricesFCFA?.repassage_seul) || 0)),
      },
    }));
  } else if (bc?.pricesFCFA) {
    // Migrate legacy lot_10 / lot_20 settings cleanly
    packs = [
      {
        id: 'pack-10',
        garmentCount: 10,
        active: bc.enabledBases?.lot_10 ?? true,
        pricesFCFA: {
          lavage_simple: bc.pricesFCFA.lavage_simple?.lot_10 ?? 1500,
          lavage_repassage: bc.pricesFCFA.lavage_repassage?.lot_10 ?? 2000,
          repassage_seul: bc.pricesFCFA.repassage_seul?.lot_10 ?? 1200,
        },
      },
      {
        id: 'pack-20',
        garmentCount: 20,
        active: bc.enabledBases?.lot_20 ?? true,
        pricesFCFA: {
          lavage_simple: bc.pricesFCFA.lavage_simple?.lot_20 ?? 2800,
          lavage_repassage: bc.pricesFCFA.lavage_repassage?.lot_20 ?? 3800,
          repassage_seul: bc.pricesFCFA.repassage_seul?.lot_20 ?? 2200,
        },
      },
    ];
  } else {
    packs = DEFAULT_BLANCHISSERIE_CONFIG.packs;
  }

  const unitPricesFCFA = bc?.unitPricesFCFA
    ? {
        lavage_simple: bc.unitPricesFCFA.lavage_simple ?? DEFAULT_BLANCHISSERIE_CONFIG.unitPricesFCFA.lavage_simple,
        lavage_repassage: bc.unitPricesFCFA.lavage_repassage ?? DEFAULT_BLANCHISSERIE_CONFIG.unitPricesFCFA.lavage_repassage,
        repassage_seul: bc.unitPricesFCFA.repassage_seul ?? DEFAULT_BLANCHISSERIE_CONFIG.unitPricesFCFA.repassage_seul,
      }
    : bc?.pricesFCFA
    ? {
        lavage_simple: bc.pricesFCFA.lavage_simple?.unite ?? DEFAULT_BLANCHISSERIE_CONFIG.unitPricesFCFA.lavage_simple,
        lavage_repassage: bc.pricesFCFA.lavage_repassage?.unite ?? DEFAULT_BLANCHISSERIE_CONFIG.unitPricesFCFA.lavage_repassage,
        repassage_seul: bc.pricesFCFA.repassage_seul?.unite ?? DEFAULT_BLANCHISSERIE_CONFIG.unitPricesFCFA.repassage_seul,
      }
    : DEFAULT_BLANCHISSERIE_CONFIG.unitPricesFCFA;

  const expressPct = pc?.expressPercent ?? raw?.expressPercent ?? DEFAULT_SETTINGS.expressPercent;

  return {
    ...DEFAULT_SETTINGS,
    ...(raw || {}),
    id: 'default',
    expressPercent: expressPct,
    activityScope: raw?.activityScope ?? DEFAULT_SETTINGS.activityScope,
    blanchisserieConfig: {
      enabledServices: {
        ...DEFAULT_BLANCHISSERIE_CONFIG.enabledServices,
        ...(bc?.enabledServices || {}),
      },
      enableUnit: bc?.enableUnit ?? bc?.enabledBases?.unite ?? DEFAULT_BLANCHISSERIE_CONFIG.enableUnit,
      unitPricesFCFA,
      packs,
    },
    pressingConfig: {
      weightEnabled: pc?.weightEnabled ?? DEFAULT_PRESSING_CONFIG.weightEnabled,
      pricePerKgByMode: {
        ...DEFAULT_PRESSING_CONFIG.pricePerKgByMode,
        ...(pc?.pricePerKgByMode || {}),
      },
      weightOffers:
        Array.isArray(pc?.weightOffers) && pc.weightOffers.length > 0
          ? pc.weightOffers
          : DEFAULT_PRESSING_CONFIG.weightOffers,
      expressPricingMode: pc?.expressPricingMode ?? DEFAULT_PRESSING_CONFIG.expressPricingMode,
      expressFixedAmountFCFA:
        pc?.expressFixedAmountFCFA ?? DEFAULT_PRESSING_CONFIG.expressFixedAmountFCFA,
      expressPercent: expressPct,
    },
    loyaltyConfig: {
      enabled: raw?.loyaltyConfig?.enabled ?? DEFAULT_LOYALTY_CONFIG.enabled,
      fcfaPerPoint: Math.max(
        100,
        Math.round(Number(raw?.loyaltyConfig?.fcfaPerPoint) || DEFAULT_LOYALTY_CONFIG.fcfaPerPoint)
      ),
      rewardThresholdPoints: Math.max(
        5,
        Math.round(
          Number(raw?.loyaltyConfig?.rewardThresholdPoints) ||
            DEFAULT_LOYALTY_CONFIG.rewardThresholdPoints
        )
      ),
      rewardDiscountFCFA: Math.max(
        100,
        Math.round(
          Number(raw?.loyaltyConfig?.rewardDiscountFCFA) ||
            DEFAULT_LOYALTY_CONFIG.rewardDiscountFCFA
        )
      ),
    },
  };
}

export const INITIAL_CATALOG: CatalogItem[] = [
  {
    id: 'cat-bazin',
    name: 'Ensemble Bazin / Boubou brodé',
    category: 'Tenues traditionnelles',
    defaultMode: 'nettoyage_sec',
    priceFCFA: 3500,
    unit: 'pièce',
    active: true,
  },
  {
    id: 'cat-kita',
    name: 'Pagne Kita / Baoulé',
    category: 'Tenues traditionnelles',
    defaultMode: 'nettoyage_sec',
    priceFCFA: 2500,
    unit: 'pièce',
    active: true,
  },
  {
    id: 'cat-wax',
    name: 'Ensemble Pagne Wax (2 pièces)',
    category: 'Tenues traditionnelles',
    defaultMode: 'lavage_repassage',
    priceFCFA: 1800,
    unit: 'pièce',
    active: true,
  },
  {
    id: 'cat-costume2',
    name: 'Costume 2 pièces',
    category: 'Costumes & Bureau',
    defaultMode: 'nettoyage_sec',
    priceFCFA: 3000,
    unit: 'pièce',
    active: true,
  },
  {
    id: 'cat-costume3',
    name: 'Costume 3 pièces',
    category: 'Costumes & Bureau',
    defaultMode: 'nettoyage_sec',
    priceFCFA: 4000,
    unit: 'pièce',
    active: true,
  },
  {
    id: 'cat-veste',
    name: 'Veste / Blazer',
    category: 'Costumes & Bureau',
    defaultMode: 'nettoyage_sec',
    priceFCFA: 2000,
    unit: 'pièce',
    active: true,
  },
  {
    id: 'cat-chemise',
    name: 'Chemise sur cintre',
    category: 'Costumes & Bureau',
    defaultMode: 'lavage_repassage',
    priceFCFA: 1000,
    unit: 'pièce',
    active: true,
  },
  {
    id: 'cat-pantalon',
    name: 'Pantalon classique',
    category: 'Costumes & Bureau',
    defaultMode: 'lavage_repassage',
    priceFCFA: 1000,
    unit: 'pièce',
    active: true,
  },
  {
    id: 'cat-robe-soiree',
    name: 'Robe de soirée / Cérémonie',
    category: 'Costumes & Bureau',
    defaultMode: 'nettoyage_sec',
    priceFCFA: 3500,
    unit: 'pièce',
    active: true,
  },
  {
    id: 'cat-polo',
    name: 'Polo / T-shirt',
    category: 'Quotidien',
    defaultMode: 'lavage_repassage',
    priceFCFA: 700,
    unit: 'pièce',
    active: true,
  },
  {
    id: 'cat-jean',
    name: 'Pantalon Jean',
    category: 'Quotidien',
    defaultMode: 'lavage_repassage',
    priceFCFA: 1000,
    unit: 'pièce',
    active: true,
  },
  {
    id: 'cat-repassage-chemise',
    name: 'Repassage simple (Chemise / Pantalon)',
    category: 'Quotidien',
    defaultMode: 'repassage_seul',
    priceFCFA: 500,
    unit: 'pièce',
    active: true,
  },
  {
    id: 'cat-linge-kg',
    name: 'Linge courant au kilo (Lavage + Pliage)',
    category: 'Maison & Linge',
    defaultMode: 'blanchisserie',
    priceFCFA: 1000,
    unit: 'kg',
    active: true,
  },
  {
    id: 'cat-couette',
    name: 'Couette / Édredon 2 places',
    category: 'Maison & Linge',
    defaultMode: 'blanchisserie',
    priceFCFA: 4500,
    unit: 'pièce',
    active: true,
  },
  {
    id: 'cat-drap',
    name: 'Parure Drap + Taies',
    category: 'Maison & Linge',
    defaultMode: 'blanchisserie',
    priceFCFA: 2000,
    unit: 'pièce',
    active: true,
  },
  {
    id: 'cat-rideaux',
    name: 'Rideaux (la paire)',
    category: 'Maison & Linge',
    defaultMode: 'blanchisserie',
    priceFCFA: 3000,
    unit: 'paire',
    active: true,
  },
];

function buildInitialSeed() {
  const today = getTodayISO();
  const yesterday = addDaysISO(-1);
  const twoDaysAgo = addDaysISO(-2);
  const tomorrow = addDaysISO(1);
  const inTwoDays = addDaysISO(2);
  const nowIso = new Date().toISOString();

  const clients: Client[] = [
    {
      id: 'cli-1',
      fullName: 'Kouassi Jean-Marc',
      phone: '+225 07 09 44 12 80',
      commune: 'Cocody — Angré / 2 Plateaux',
      addressNote: 'Carrefour Nelson Mandela',
      createdAt: twoDaysAgo,
    },
    {
      id: 'cli-2',
      fullName: 'Touré Aminata',
      phone: '+225 05 44 81 03 19',
      commune: 'Marcory / Zone 4',
      addressNote: 'Rue Paul Langevin',
      createdAt: twoDaysAgo,
    },
    {
      id: 'cli-3',
      fullName: 'Koné Seydou',
      phone: '+225 01 40 77 52 11',
      commune: 'Plateau',
      addressNote: 'Immeuble Alpha 2000',
      createdAt: yesterday,
    },
    {
      id: 'cli-4',
      fullName: 'Bamba Fatoumata',
      phone: '+225 07 88 15 64 22',
      commune: 'Cocody — Riviera',
      addressNote: 'Riviera Palmeraie',
      createdAt: yesterday,
    },
    {
      id: 'cli-5',
      fullName: 'Yao Adjoua Clarisse',
      phone: '+225 05 66 29 90 45',
      commune: 'Yopougon',
      addressNote: 'Maroc Carrefour Oasis',
      createdAt: today,
    },
  ];

  const orders: PressingOrder[] = [
    {
      id: 'ord-44',
      ticketNumber: 'EP-2026-0044',
      clientId: 'cli-1',
      clientName: 'Kouassi Jean-Marc',
      clientPhone: '+225 07 09 44 12 80',
      commune: 'Cocody — Angré / 2 Plateaux',
      rackSlot: 'A-12',
      items: [
        {
          id: 'li-1',
          catalogItemId: 'cat-costume2',
          name: 'Costume 2 pièces',
          mode: 'nettoyage_sec',
          quantity: 2,
          unit: 'pièce',
          unitPriceFCFA: 3000,
        },
        {
          id: 'li-2',
          catalogItemId: 'cat-chemise',
          name: 'Chemise sur cintre',
          mode: 'lavage_repassage',
          quantity: 4,
          unit: 'pièce',
          unitPriceFCFA: 1000,
        },
      ],
      isExpress: false,
      expressFeeFCFA: 0,
      deliveryFeeFCFA: 0,
      discountFCFA: 0,
      totalFCFA: 10000,
      paidFCFA: 10000,
      status: 'pret',
      dropOffDate: twoDaysAgo,
      dueDate: today,
      notes: 'Cintres individuels demandés',
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      updatedAt: nowIso,
    },
    {
      id: 'ord-45',
      ticketNumber: 'EP-2026-0045',
      clientId: 'cli-2',
      clientName: 'Touré Aminata',
      clientPhone: '+225 05 44 81 03 19',
      commune: 'Marcory / Zone 4',
      rackSlot: 'B-04',
      items: [
        {
          id: 'li-3',
          catalogItemId: 'cat-bazin',
          name: 'Ensemble Bazin / Boubou brodé',
          mode: 'nettoyage_sec',
          quantity: 1,
          unit: 'pièce',
          unitPriceFCFA: 3500,
          note: 'Broderie dorée fragile',
        },
        {
          id: 'li-4',
          catalogItemId: 'cat-robe-soiree',
          name: 'Robe de soirée / Cérémonie',
          mode: 'nettoyage_sec',
          quantity: 1,
          unit: 'pièce',
          unitPriceFCFA: 3500,
        },
      ],
      isExpress: true,
      expressFeeFCFA: 3500,
      deliveryFeeFCFA: 1500,
      discountFCFA: 0,
      totalFCFA: 12000,
      paidFCFA: 6000,
      status: 'repassage',
      dropOffDate: yesterday,
      dueDate: today,
      notes: 'Livraison Zone 4 à 17h',
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: nowIso,
    },
    {
      id: 'ord-46',
      ticketNumber: 'EP-2026-0046',
      clientId: 'cli-3',
      clientName: 'Koné Seydou',
      clientPhone: '+225 01 40 77 52 11',
      commune: 'Plateau',
      rackSlot: 'C-08',
      items: [
        {
          id: 'li-5',
          catalogItemId: 'cat-couette',
          name: 'Couette / Édredon 2 places',
          mode: 'blanchisserie',
          quantity: 1,
          unit: 'pièce',
          unitPriceFCFA: 4500,
        },
        {
          id: 'li-6',
          catalogItemId: 'cat-linge-kg',
          name: 'Linge courant au kilo (Lavage + Pliage)',
          mode: 'blanchisserie',
          quantity: 6,
          unit: 'kg',
          unitPriceFCFA: 1000,
        },
      ],
      isExpress: false,
      expressFeeFCFA: 0,
      deliveryFeeFCFA: 0,
      discountFCFA: 500,
      totalFCFA: 10000,
      paidFCFA: 5000,
      status: 'lavage',
      dropOffDate: today,
      dueDate: inTwoDays,
      createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
      updatedAt: nowIso,
    },
    {
      id: 'ord-47',
      ticketNumber: 'EP-2026-0047',
      clientId: 'cli-4',
      clientName: 'Bamba Fatoumata',
      clientPhone: '+225 07 88 15 64 22',
      commune: 'Cocody — Riviera',
      rackSlot: 'A-19',
      items: [
        {
          id: 'li-7',
          catalogItemId: 'cat-kita',
          name: 'Pagne Kita / Baoulé',
          mode: 'nettoyage_sec',
          quantity: 2,
          unit: 'pièce',
          unitPriceFCFA: 2500,
          note: 'Ne pas repasser à haute température',
        },
      ],
      isExpress: false,
      expressFeeFCFA: 0,
      deliveryFeeFCFA: 0,
      discountFCFA: 0,
      totalFCFA: 5000,
      paidFCFA: 0,
      status: 'recu',
      dropOffDate: today,
      dueDate: tomorrow,
      createdAt: new Date(Date.now() - 3600000 * 1.5).toISOString(),
      updatedAt: nowIso,
    },
    {
      id: 'ord-43',
      ticketNumber: 'EP-2026-0043',
      clientId: 'cli-5',
      clientName: 'Yao Adjoua Clarisse',
      clientPhone: '+225 05 66 29 90 45',
      commune: 'Yopougon',
      rackSlot: 'Remis',
      items: [
        {
          id: 'li-8',
          catalogItemId: 'cat-wax',
          name: 'Ensemble Pagne Wax (2 pièces)',
          mode: 'lavage_repassage',
          quantity: 3,
          unit: 'pièce',
          unitPriceFCFA: 1800,
        },
      ],
      isExpress: false,
      expressFeeFCFA: 0,
      deliveryFeeFCFA: 0,
      discountFCFA: 0,
      totalFCFA: 5400,
      paidFCFA: 5400,
      status: 'livre',
      dropOffDate: twoDaysAgo,
      dueDate: yesterday,
      deliveredAt: nowIso,
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      updatedAt: nowIso,
    },
  ];

  const payments: PaymentRecord[] = [
    {
      id: 'pay-1',
      orderId: 'ord-44',
      ticketNumber: 'EP-2026-0044',
      clientName: 'Kouassi Jean-Marc',
      amountFCFA: 10000,
      method: 'wave',
      paidAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      type: 'integral',
    },
    {
      id: 'pay-2',
      orderId: 'ord-45',
      ticketNumber: 'EP-2026-0045',
      clientName: 'Touré Aminata',
      amountFCFA: 6000,
      method: 'orange_money',
      paidAt: new Date(Date.now() - 86400000).toISOString(),
      type: 'acompte',
    },
    {
      id: 'pay-3',
      orderId: 'ord-46',
      ticketNumber: 'EP-2026-0046',
      clientName: 'Koné Seydou',
      amountFCFA: 5000,
      method: 'especes',
      paidAt: new Date(Date.now() - 3600000 * 4).toISOString(),
      type: 'acompte',
    },
    {
      id: 'pay-4',
      orderId: 'ord-43',
      ticketNumber: 'EP-2026-0043',
      clientName: 'Yao Adjoua Clarisse',
      amountFCFA: 5400,
      method: 'mtn_momo',
      paidAt: nowIso,
      type: 'integral',
    },
  ];

  const expenses: ExpenseRecord[] = [
    {
      id: 'exp-1',
      label: 'Bidons détachant & assouplissant 20L',
      category: 'Produits & Lessive',
      amountFCFA: 18500,
      method: 'especes',
      date: yesterday,
      note: 'Fournisseur Adjamé',
      createdAt: new Date(Date.now() - 86400000).toISOString(),
    },
    {
      id: 'exp-2',
      label: 'Carburant livreur (Livraisons Cocody / Marcory)',
      category: 'Carburant & Livraison',
      amountFCFA: 5000,
      method: 'wave',
      date: today,
      createdAt: nowIso,
    },
  ];

  const zones: DeliveryZone[] = [
    { id: 'zone-angre', commune: 'Cocody — Angré / 2 Plateaux', feeFCFA: 1000, pickupFeeFCFA: 500, active: true },
    { id: 'zone-riviera', commune: 'Cocody — Riviera', feeFCFA: 1500, pickupFeeFCFA: 1000, active: true },
    { id: 'zone-plateau', commune: 'Plateau', feeFCFA: 1500, pickupFeeFCFA: 1000, active: true },
    { id: 'zone-marcory', commune: 'Marcory / Zone 4', feeFCFA: 1500, pickupFeeFCFA: 1000, active: true },
    { id: 'zone-treichville', commune: 'Treichville', feeFCFA: 1500, pickupFeeFCFA: 1000, active: true },
    { id: 'zone-koumassi', commune: 'Koumassi', feeFCFA: 2000, pickupFeeFCFA: 1500, active: true },
    { id: 'zone-yopougon', commune: 'Yopougon', feeFCFA: 2000, pickupFeeFCFA: 1500, active: true },
    { id: 'zone-abobo', commune: 'Abobo', feeFCFA: 2000, pickupFeeFCFA: 1500, active: true },
    { id: 'zone-bingerville', commune: 'Bingerville', feeFCFA: 2500, pickupFeeFCFA: 1500, active: true },
    { id: 'zone-portbouet', commune: 'Port-Bouët', feeFCFA: 2500, pickupFeeFCFA: 1500, active: true },
  ];

  const logistics: LogisticsTask[] = [
    {
      id: 'log-1',
      type: 'livraison',
      status: 'planifie',
      clientId: 'cli-2',
      clientName: 'Touré Aminata',
      clientPhone: '+225 05 44 81 03 19',
      commune: 'Marcory / Zone 4',
      addressDetail: 'Rue Paul Langevin, Résidence Les Palmiers Appt 4B',
      orderId: 'ord-45',
      ticketNumber: 'EP-2026-0045',
      scheduledDate: today,
      timeSlot: '17h00 - 20h00',
      courierName: 'Koné Moussa',
      courierPhone: '+225 07 12 33 45 60',
      feeFCFA: 1500,
      notes: 'Encaisser le solde de 6 000 FCFA à la remise (Wave ou Espèces)',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'log-2',
      type: 'enlevement',
      status: 'en_cours',
      clientId: 'cli-4',
      clientName: 'Bamba Fatoumata',
      clientPhone: '+225 07 88 15 64 22',
      commune: 'Cocody — Riviera',
      addressDetail: 'Riviera Palmeraie, derrière pharmacie Saint-Viateur',
      scheduledDate: today,
      timeSlot: '14h00 - 17h00',
      courierName: 'Bamba Issa',
      courierPhone: '+225 05 71 08 99 12',
      estimatedPieces: 8,
      feeFCFA: 1000,
      notes: 'Lot de costumes et 2 robes de cérémonie à récupérer',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'log-3',
      type: 'enlevement',
      status: 'planifie',
      clientId: 'cli-1',
      clientName: 'Kouassi Jean-Marc',
      clientPhone: '+225 07 09 44 12 80',
      commune: 'Cocody — Angré / 2 Plateaux',
      addressDetail: 'Carrefour Nelson Mandela, Villa 18',
      scheduledDate: tomorrow,
      timeSlot: '08h00 - 11h00',
      courierName: 'Koné Moussa',
      courierPhone: '+225 07 12 33 45 60',
      estimatedPieces: 5,
      feeFCFA: 500,
      notes: 'Ramassage hebdomadaire chemises',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];

  const inventory: InventoryItem[] = [
    {
      id: 'inv-lessive-20',
      name: 'Lessive liquide concentrée 20L',
      sku: 'LES-20L',
      category: 'Lessives & Détachants',
      activityScope: 'blanchisserie',
      unit: 'bidon',
      quantity: 6,
      minThreshold: 3,
      unitCostFCFA: 14500,
      supplier: 'Adjamé Pro Chimie',
      notes: 'Pour machines 15kg et 25kg',
      updatedAt: nowIso,
    },
    {
      id: 'inv-assouplissant-20',
      name: 'Assouplissant parfumé 20L',
      sku: 'ASS-20L',
      category: 'Lessives & Détachants',
      activityScope: 'blanchisserie',
      unit: 'bidon',
      quantity: 2,
      minThreshold: 3,
      unitCostFCFA: 11000,
      supplier: 'Adjamé Pro Chimie',
      notes: 'Stock bas : commander cette semaine',
      updatedAt: nowIso,
    },
    {
      id: 'inv-detachant-5',
      name: 'Détachant pré-lavage & cols 5L',
      sku: 'DET-05L',
      category: 'Lessives & Détachants',
      activityScope: 'both',
      unit: 'bidon',
      quantity: 4,
      minThreshold: 2,
      unitCostFCFA: 7500,
      supplier: 'CleanTech Abidjan',
      updatedAt: nowIso,
    },
    {
      id: 'inv-solvant-sec',
      name: 'Solvant nettoyage à sec (Hydrocarbure)',
      sku: 'SOL-25L',
      category: 'Solvants & Nettoyage à sec',
      activityScope: 'pressing',
      unit: 'bidon',
      quantity: 3,
      minThreshold: 2,
      unitCostFCFA: 32000,
      supplier: 'CleanTech Abidjan',
      notes: 'Costumes, Bazin et robes délicates',
      updatedAt: nowIso,
    },
    {
      id: 'inv-cintres',
      name: 'Cintres métalliques pressing (lot de 100)',
      sku: 'CIN-100',
      category: 'Emballages & Cintres',
      activityScope: 'pressing',
      unit: 'carton',
      quantity: 5,
      minThreshold: 2,
      unitCostFCFA: 8500,
      supplier: 'Société Ivoirienne Emballage',
      updatedAt: nowIso,
    },
    {
      id: 'inv-housses',
      name: 'Housses plastique costumes & robes (rouleau)',
      sku: 'HOU-RLX',
      category: 'Emballages & Cintres',
      activityScope: 'pressing',
      unit: 'rouleau',
      quantity: 1,
      minThreshold: 2,
      unitCostFCFA: 12000,
      supplier: 'Société Ivoirienne Emballage',
      notes: 'À réapprovisionner rapidement',
      updatedAt: nowIso,
    },
    {
      id: 'inv-sachets-lots',
      name: 'Sacs de conditionnement linge plié (Lots 10/20)',
      sku: 'SAC-100',
      category: 'Emballages & Cintres',
      activityScope: 'blanchisserie',
      unit: 'paquet',
      quantity: 8,
      minThreshold: 3,
      unitCostFCFA: 3500,
      supplier: 'Société Ivoirienne Emballage',
      updatedAt: nowIso,
    },
    {
      id: 'inv-appret',
      name: 'Amidon & Apprêt repassage 5L',
      sku: 'APP-05L',
      category: 'Repassage & Entretien',
      activityScope: 'both',
      unit: 'bidon',
      quantity: 5,
      minThreshold: 2,
      unitCostFCFA: 6000,
      supplier: 'Zone 4 Équipements',
      updatedAt: nowIso,
    },
    {
      id: 'inv-bobines-80mm',
      name: 'Bobines papier thermique 80mm (lot de 10)',
      sku: 'TKT-80M',
      category: 'Étiquetage & Comptoir',
      activityScope: 'both',
      unit: 'paquet',
      quantity: 4,
      minThreshold: 2,
      unitCostFCFA: 5500,
      supplier: 'Plateau Bureautique',
      updatedAt: nowIso,
    },
  ];

  const inventoryMovements: InventoryMovement[] = [
    {
      id: 'mov-1',
      itemId: 'inv-lessive-20',
      itemName: 'Lessive liquide concentrée 20L',
      type: 'entree',
      quantityDelta: 4,
      previousQty: 2,
      newQty: 6,
      unit: 'bidon',
      unitCostFCFA: 14500,
      totalCostFCFA: 58000,
      reason: 'Réapprovisionnement Adjamé Pro Chimie',
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
      id: 'mov-2',
      itemId: 'inv-assouplissant-20',
      itemName: 'Assouplissant parfumé 20L',
      type: 'sortie',
      quantityDelta: -1,
      previousQty: 3,
      newQty: 2,
      unit: 'bidon',
      reason: 'Mise en service machine blanchisserie',
      createdAt: new Date(Date.now() - 86400000).toISOString(),
    },
    {
      id: 'mov-3',
      itemId: 'inv-housses',
      itemName: 'Housses plastique costumes & robes (rouleau)',
      type: 'sortie',
      quantityDelta: -1,
      previousQty: 2,
      newQty: 1,
      unit: 'rouleau',
      reason: 'Consommation poste finition & cintrage',
      createdAt: nowIso,
    },
  ];

  return {
    clients,
    orders,
    payments,
    expenses,
    zones,
    logistics,
    inventory,
    inventoryMovements,
  };
}

export async function ensureSeededDatabase(): Promise<void> {
  const db = await getDB();
  const existingSettings = await db.get('settings', 'default');
  const existingZones = await db.getAll('zones');
  const existingInventory = await db.getAll('inventory');

  if (existingSettings) {
    // Ensure v2/v3 stores are populated when upgrading an existing local database
    if (existingZones.length === 0 || existingInventory.length === 0) {
      const seed = buildInitialSeed();
      const txUpgrade = db.transaction(
        ['zones', 'logistics', 'inventory', 'inventoryMovements'],
        'readwrite'
      );
      if (existingZones.length === 0) {
        for (const z of seed.zones) await txUpgrade.objectStore('zones').put(z);
        for (const l of seed.logistics) await txUpgrade.objectStore('logistics').put(l);
      }
      if (existingInventory.length === 0) {
        for (const inv of seed.inventory) await txUpgrade.objectStore('inventory').put(inv);
        for (const mov of seed.inventoryMovements)
          await txUpgrade.objectStore('inventoryMovements').put(mov);
      }
      await txUpgrade.done;
    }
    return;
  }

  // Request persistent storage on desktop browsers (Mac/Windows)
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

  const seed = buildInitialSeed();
  const tx = db.transaction(
    [
      'settings',
      'catalog',
      'clients',
      'orders',
      'payments',
      'expenses',
      'zones',
      'logistics',
      'inventory',
      'inventoryMovements',
    ],
    'readwrite'
  );

  await tx.objectStore('settings').put(DEFAULT_SETTINGS);
  for (const item of INITIAL_CATALOG) {
    await tx.objectStore('catalog').put({
      ...item,
      imageUrl: resolveCatalogItemImage(item),
    });
  }
  for (const client of seed.clients) {
    await tx.objectStore('clients').put(client);
  }
  for (const order of seed.orders) {
    await tx.objectStore('orders').put(order);
  }
  for (const payment of seed.payments) {
    await tx.objectStore('payments').put(payment);
  }
  for (const expense of seed.expenses) {
    await tx.objectStore('expenses').put(expense);
  }
  for (const zone of seed.zones) {
    await tx.objectStore('zones').put(zone);
  }
  for (const task of seed.logistics) {
    await tx.objectStore('logistics').put(task);
  }
  for (const inv of seed.inventory) {
    await tx.objectStore('inventory').put(inv);
  }
  for (const mov of seed.inventoryMovements) {
    await tx.objectStore('inventoryMovements').put(mov);
  }
  await tx.done;
}

export async function loadAllData() {
  await ensureSeededDatabase();
  const db = await getDB();
  const [
    settings,
    catalog,
    clients,
    orders,
    payments,
    expenses,
    zones,
    logistics,
    inventory,
    inventoryMovements,
  ] = await Promise.all([
    db.get('settings', 'default'),
    db.getAll('catalog'),
    db.getAll('clients'),
    db.getAll('orders'),
    db.getAll('payments'),
    db.getAll('expenses'),
    db.getAll('zones'),
    db.getAll('logistics'),
    db.getAll('inventory'),
    db.getAll('inventoryMovements'),
  ]);

  const enrichedCatalog = catalog.map((item) => ({
    ...item,
    imageUrl: resolveCatalogItemImage(item),
  }));

  return {
    settings: normalizeSettings(settings),
    catalog: enrichedCatalog.sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
    ),
    clients: clients.sort((a, b) => a.fullName.localeCompare(b.fullName)),
    orders: orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    payments: payments.sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
    expenses: expenses.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    zones: zones.sort((a, b) => a.commune.localeCompare(b.commune)),
    logistics: logistics.sort(
      (a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || b.createdAt.localeCompare(a.createdAt)
    ),
    inventory: inventory.sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
    ),
    inventoryMovements: inventoryMovements.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    ),
  };
}

export async function saveClient(client: Client): Promise<void> {
  const db = await getDB();
  await db.put('clients', client);
}

export async function deleteClient(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('clients', id);
}

export async function saveCatalogItem(item: CatalogItem): Promise<void> {
  const db = await getDB();
  await db.put('catalog', item);
}

export async function deleteCatalogItem(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('catalog', id);
}

export async function saveSettings(settings: PressingSettings): Promise<void> {
  const db = await getDB();
  await db.put('settings', settings);
}

export async function topUpClientPrepaid(params: {
  clientId: string;
  amountFCFA: number;
  bonusFCFA?: number;
  method: PaymentMethod;
  subscriptionLabel?: string;
  subscriptionExpiresAt?: string;
  note?: string;
}): Promise<void> {
  const cleanAmount = Math.max(0, Math.round(params.amountFCFA || 0));
  const cleanBonus = Math.max(0, Math.round(params.bonusFCFA || 0));
  if (cleanAmount <= 0 && cleanBonus <= 0) return;

  const db = await getDB();
  const tx = db.transaction(['clients', 'payments'], 'readwrite');
  const client = await tx.objectStore('clients').get(params.clientId);
  if (!client) {
    await tx.done;
    return;
  }

  const nowIso = new Date().toISOString();
  const prevBalance = client.prepaidBalanceFCFA || 0;
  const newBalance = prevBalance + cleanAmount + cleanBonus;

  const newEntries: ClientWalletEntry[] = [];
  if (cleanAmount > 0) {
    newEntries.push({
      id: `wlt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      date: nowIso,
      type: 'recharge',
      amountFCFA: cleanAmount,
      method: params.method,
      note: params.note?.trim() || params.subscriptionLabel?.trim() || 'Recharge compte prépayé',
    });
  }
  if (cleanBonus > 0) {
    newEntries.push({
      id: `wlt-b-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      date: nowIso,
      type: 'bonus',
      amountFCFA: cleanBonus,
      note: 'Bonus abonnement / fidélité',
    });
  }

  await tx.objectStore('clients').put({
    ...client,
    prepaidBalanceFCFA: newBalance,
    subscriptionLabel:
      params.subscriptionLabel !== undefined
        ? params.subscriptionLabel.trim() || undefined
        : client.subscriptionLabel,
    subscriptionExpiresAt:
      params.subscriptionExpiresAt !== undefined
        ? params.subscriptionExpiresAt || undefined
        : client.subscriptionExpiresAt,
    walletHistory: [...newEntries, ...(client.walletHistory || [])].slice(0, 40),
  });

  if (cleanAmount > 0) {
    await tx.objectStore('payments').put({
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      orderId: `prepaid-${client.id}`,
      ticketNumber: `ABON-${nowIso.slice(0, 10).replace(/-/g, '')}`,
      clientName: `${client.fullName} (Prépayé)`,
      amountFCFA: cleanAmount,
      method: params.method,
      paidAt: nowIso,
      type: 'integral',
    });
  }

  await tx.done;
}

export async function createOrderWithPayment(
  orderDraft: Omit<PressingOrder, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt'>,
  initialPaymentMethod: PaymentMethod
): Promise<{ order: PressingOrder; settings: PressingSettings }> {
  const db = await getDB();
  const tx = db.transaction(['settings', 'orders', 'payments', 'clients'], 'readwrite');

  const currentSettings = normalizeSettings(await tx.objectStore('settings').get('default'));
  const seq = currentSettings.nextTicketSequence;
  const year = new Date().getFullYear();
  const ticketNumber = `EP-${year}-${String(seq).padStart(4, '0')}`;
  const nowIso = new Date().toISOString();

  const client = await tx.objectStore('clients').get(orderDraft.clientId);
  const availablePrepaid = client?.prepaidBalanceFCFA || 0;
  const requestedPrepaid = Math.max(0, Math.round(orderDraft.prepaidUsedFCFA || 0));
  const actualPrepaidUsed = Math.min(requestedPrepaid, availablePrepaid, orderDraft.totalFCFA);
  const actualCashPaid = Math.max(0, Math.round(orderDraft.paidFCFA - actualPrepaidUsed));
  const totalSettledOnOrder = Math.min(orderDraft.totalFCFA, actualPrepaidUsed + actualCashPaid);

  const loyaltyCfg = currentSettings.loyaltyConfig || DEFAULT_LOYALTY_CONFIG;
  const pointsEarned = loyaltyCfg.enabled
    ? Math.floor(orderDraft.totalFCFA / Math.max(100, loyaltyCfg.fcfaPerPoint))
    : 0;
  const pointsRedeemed = client
    ? Math.min(Math.max(0, orderDraft.loyaltyPointsRedeemed || 0), client.loyaltyPoints || 0)
    : 0;

  const order: PressingOrder = {
    ...orderDraft,
    prepaidUsedFCFA: actualPrepaidUsed,
    loyaltyPointsEarned: pointsEarned,
    loyaltyPointsRedeemed: pointsRedeemed,
    paidFCFA: totalSettledOnOrder,
    id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ticketNumber,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await tx.objectStore('orders').put(order);

  if (client) {
    const nextPoints = Math.max(0, (client.loyaltyPoints || 0) - pointsRedeemed + pointsEarned);
    const nextBalance = Math.max(0, availablePrepaid - actualPrepaidUsed);
    const nextHistory =
      actualPrepaidUsed > 0
        ? [
            {
              id: `wlt-u-${Date.now()}`,
              date: nowIso,
              type: 'utilisation' as const,
              amountFCFA: -actualPrepaidUsed,
              note: `Règlement ticket ${ticketNumber}`,
            },
            ...(client.walletHistory || []),
          ].slice(0, 40)
        : client.walletHistory;

    await tx.objectStore('clients').put({
      ...client,
      loyaltyPoints: nextPoints,
      prepaidBalanceFCFA: nextBalance,
      walletHistory: nextHistory,
    });
  }

  if (actualCashPaid > 0) {
    const payment: PaymentRecord = {
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      orderId: order.id,
      ticketNumber: order.ticketNumber,
      clientName: order.clientName,
      amountFCFA: actualCashPaid,
      method: initialPaymentMethod,
      paidAt: nowIso,
      type: totalSettledOnOrder >= order.totalFCFA ? 'integral' : 'acompte',
    };
    await tx.objectStore('payments').put(payment);
  }

  const updatedSettings: PressingSettings = {
    ...currentSettings,
    nextTicketSequence: seq + 1,
  };
  await tx.objectStore('settings').put(updatedSettings);
  await tx.done;

  return { order, settings: updatedSettings };
}

export async function updateOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
  const db = await getDB();
  const order = await db.get('orders', orderId);
  if (!order) return;
  const nowIso = new Date().toISOString();
  await db.put('orders', {
    ...order,
    status,
    deliveredAt: status === 'livre' ? nowIso : order.deliveredAt,
    updatedAt: nowIso,
  });
}

export async function recordOrderPayment(
  orderId: string,
  amountFCFA: number,
  method: PaymentMethod
): Promise<void> {
  if (amountFCFA <= 0) return;
  const db = await getDB();
  const tx = db.transaction(['orders', 'payments'], 'readwrite');
  const order = await tx.objectStore('orders').get(orderId);
  if (!order) {
    await tx.done;
    return;
  }

  const nowIso = new Date().toISOString();
  const newPaid = Math.min(order.totalFCFA, order.paidFCFA + amountFCFA);
  const actualAdded = newPaid - order.paidFCFA;

  if (actualAdded > 0) {
    await tx.objectStore('orders').put({
      ...order,
      paidFCFA: newPaid,
      updatedAt: nowIso,
    });

    await tx.objectStore('payments').put({
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      orderId: order.id,
      ticketNumber: order.ticketNumber,
      clientName: order.clientName,
      amountFCFA: actualAdded,
      method,
      paidAt: nowIso,
      type: newPaid >= order.totalFCFA ? 'solde' : 'acompte',
    });
  }

  await tx.done;
}

export async function deleteOrder(orderId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['orders', 'payments'], 'readwrite');
  await tx.objectStore('orders').delete(orderId);
  const relatedPayments = await tx.objectStore('payments').index('by-orderId').getAll(orderId);
  for (const p of relatedPayments) {
    await tx.objectStore('payments').delete(p.id);
  }
  await tx.done;
}

export async function saveExpense(expense: ExpenseRecord): Promise<void> {
  const db = await getDB();
  await db.put('expenses', expense);
}

export async function deleteExpense(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('expenses', id);
}

export async function saveDeliveryZone(zone: DeliveryZone): Promise<void> {
  const db = await getDB();
  await db.put('zones', zone);
}

export async function deleteDeliveryZone(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('zones', id);
}

export async function saveLogisticsTask(task: LogisticsTask): Promise<void> {
  const db = await getDB();
  await db.put('logistics', {
    ...task,
    updatedAt: new Date().toISOString(),
  });
}

export async function updateLogisticsStatus(
  id: string,
  status: LogisticsStatus
): Promise<void> {
  const db = await getDB();
  const task = await db.get('logistics', id);
  if (!task) return;
  const nowIso = new Date().toISOString();
  await db.put('logistics', { ...task, status, updatedAt: nowIso });

  // Business logic: if a home delivery linked to an order is completed, mark order as delivered
  if (status === 'effectue' && task.type === 'livraison' && task.orderId) {
    const order = await db.get('orders', task.orderId);
    if (order && order.status !== 'livre') {
      await db.put('orders', {
        ...order,
        status: 'livre',
        deliveredAt: nowIso,
        updatedAt: nowIso,
      });
    }
  }
}

export async function deleteLogisticsTask(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('logistics', id);
}

export async function saveInventoryItem(item: InventoryItem): Promise<void> {
  const db = await getDB();
  await db.put('inventory', {
    ...item,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteInventoryItem(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['inventory', 'inventoryMovements'], 'readwrite');
  await tx.objectStore('inventory').delete(id);
  const related = await tx.objectStore('inventoryMovements').index('by-itemId').getAll(id);
  for (const m of related) {
    await tx.objectStore('inventoryMovements').delete(m.id);
  }
  await tx.done;
}

export async function recordInventoryMovement(params: {
  itemId: string;
  type: InventoryMovementType;
  quantity: number;
  unitCostFCFA?: number;
  reason: string;
  recordExpense?: boolean;
  paymentMethod?: PaymentMethod;
}): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['inventory', 'inventoryMovements', 'expenses'], 'readwrite');
  const item = await tx.objectStore('inventory').get(params.itemId);
  if (!item) {
    await tx.done;
    return;
  }

  const nowIso = new Date().toISOString();
  const previousQty = item.quantity;
  const cleanQty = Math.max(0, Number(params.quantity) || 0);

  let newQty = previousQty;
  if (params.type === 'entree') {
    newQty = previousQty + cleanQty;
  } else if (params.type === 'sortie') {
    newQty = Math.max(0, previousQty - cleanQty);
  } else {
    newQty = cleanQty;
  }

  const delta = newQty - previousQty;
  const effectiveUnitCost =
    params.unitCostFCFA !== undefined && params.unitCostFCFA >= 0
      ? Math.round(params.unitCostFCFA)
      : item.unitCostFCFA;

  const totalCost =
    params.type === 'entree' && delta > 0 ? Math.round(delta * effectiveUnitCost) : undefined;

  await tx.objectStore('inventory').put({
    ...item,
    quantity: newQty,
    unitCostFCFA: params.type === 'entree' ? effectiveUnitCost : item.unitCostFCFA,
    updatedAt: nowIso,
  });

  await tx.objectStore('inventoryMovements').put({
    id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    itemId: item.id,
    itemName: item.name,
    type: params.type,
    quantityDelta: delta,
    previousQty,
    newQty,
    unit: item.unit,
    unitCostFCFA: params.type === 'entree' ? effectiveUnitCost : undefined,
    totalCostFCFA: totalCost,
    reason: params.reason.trim() || (params.type === 'entree' ? 'Réapprovisionnement' : 'Sortie atelier'),
    createdAt: nowIso,
  });

  if (params.recordExpense && params.type === 'entree' && totalCost && totalCost > 0) {
    await tx.objectStore('expenses').put({
      id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: `Achat stock : ${item.name} (+${delta} ${item.unit})`,
      category: 'Produits & Lessive',
      amountFCFA: totalCost,
      method: params.paymentMethod || 'especes',
      date: getTodayISO(),
      note: item.supplier ? `Fournisseur : ${item.supplier}` : undefined,
      createdAt: nowIso,
    });
  }

  await tx.done;
}

export async function exportBackupJSON(): Promise<DatabaseBackup> {
  const data = await loadAllData();
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    ...data,
  };
}

export async function importBackupJSON(backup: DatabaseBackup): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    [
      'settings',
      'catalog',
      'clients',
      'orders',
      'payments',
      'expenses',
      'zones',
      'logistics',
      'inventory',
      'inventoryMovements',
    ],
    'readwrite'
  );
  await Promise.all([
    tx.objectStore('settings').clear(),
    tx.objectStore('catalog').clear(),
    tx.objectStore('clients').clear(),
    tx.objectStore('orders').clear(),
    tx.objectStore('payments').clear(),
    tx.objectStore('expenses').clear(),
    tx.objectStore('zones').clear(),
    tx.objectStore('logistics').clear(),
    tx.objectStore('inventory').clear(),
    tx.objectStore('inventoryMovements').clear(),
  ]);

  await tx.objectStore('settings').put(normalizeSettings(backup.settings));
  for (const c of backup.catalog || []) await tx.objectStore('catalog').put(c);
  for (const cl of backup.clients || []) await tx.objectStore('clients').put(cl);
  for (const o of backup.orders || []) await tx.objectStore('orders').put(o);
  for (const p of backup.payments || []) await tx.objectStore('payments').put(p);
  for (const e of backup.expenses || []) await tx.objectStore('expenses').put(e);
  for (const z of backup.zones || []) await tx.objectStore('zones').put(z);
  for (const l of backup.logistics || []) await tx.objectStore('logistics').put(l);
  for (const inv of backup.inventory || []) await tx.objectStore('inventory').put(inv);
  for (const mov of backup.inventoryMovements || [])
    await tx.objectStore('inventoryMovements').put(mov);

  await tx.done;
}

export async function clearAllBusinessData(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ['settings', 'catalog', 'clients', 'orders', 'payments', 'expenses', 'logistics', 'inventoryMovements'],
    'readwrite'
  );
  await Promise.all([
    tx.objectStore('clients').clear(),
    tx.objectStore('orders').clear(),
    tx.objectStore('payments').clear(),
    tx.objectStore('expenses').clear(),
    tx.objectStore('logistics').clear(),
    tx.objectStore('inventoryMovements').clear(),
  ]);
  const existingSettings = (await tx.objectStore('settings').get('default')) ?? DEFAULT_SETTINGS;
  await tx.objectStore('settings').put({ ...existingSettings, nextTicketSequence: 1 });
  await tx.done;
}

export async function resetDemoData(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    [
      'settings',
      'catalog',
      'clients',
      'orders',
      'payments',
      'expenses',
      'zones',
      'logistics',
      'inventory',
      'inventoryMovements',
    ],
    'readwrite'
  );
  await Promise.all([
    tx.objectStore('settings').clear(),
    tx.objectStore('catalog').clear(),
    tx.objectStore('clients').clear(),
    tx.objectStore('orders').clear(),
    tx.objectStore('payments').clear(),
    tx.objectStore('expenses').clear(),
    tx.objectStore('zones').clear(),
    tx.objectStore('logistics').clear(),
    tx.objectStore('inventory').clear(),
    tx.objectStore('inventoryMovements').clear(),
  ]);
  await tx.done;
  await ensureSeededDatabase();
}
