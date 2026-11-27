export type OrderStatus = 'recu' | 'lavage' | 'repassage' | 'pret' | 'livre';

export type ServiceMode =
  | 'nettoyage_sec'
  | 'lavage_simple'
  | 'lavage_repassage'
  | 'repassage_seul'
  | 'blanchisserie';

export type ActivityType = 'pressing' | 'blanchisserie';

export type ShopActivityScope = 'both' | 'pressing' | 'blanchisserie';

export type BlanchisserieService =
  | 'lavage_simple'
  | 'lavage_repassage'
  | 'repassage_seul';

export type BlanchisserieBasis = 'unite' | 'lot_10' | 'lot_20';

export interface BlanchisseriePack {
  id: string;
  garmentCount: number;
  active: boolean;
  pricesFCFA: Record<BlanchisserieService, number>;
}

export interface BlanchisserieConfig {
  enabledServices: Record<BlanchisserieService, boolean>;
  enableUnit: boolean;
  unitPricesFCFA: Record<BlanchisserieService, number>;
  packs: BlanchisseriePack[];
  // Legacy compatibility fields
  enabledBases?: Record<BlanchisserieBasis, boolean>;
  pricesFCFA?: Record<BlanchisserieService, Record<BlanchisserieBasis, number>>;
}

export type ExpressPricingMode = 'fixed_per_piece' | 'percent';

export interface PressingWeightOffer {
  id: string;
  label: string;
  weightKg: number;
  mode: ServiceMode;
  priceFCFA: number;
  active: boolean;
}

export interface PressingConfig {
  weightEnabled: boolean;
  pricePerKgByMode: Record<ServiceMode, number>;
  weightOffers: PressingWeightOffer[];
  expressPricingMode: ExpressPricingMode;
  expressFixedAmountFCFA: number;
  expressPercent: number;
}

export type PaymentMethod =
  | 'especes'
  | 'wave'
  | 'orange_money'
  | 'mtn_momo'
  | 'moov_money';

export type GarmentCategory =
  | 'Tenues traditionnelles'
  | 'Costumes & Bureau'
  | 'Quotidien'
  | 'Maison & Linge';

export type ExpenseCategory =
  | 'Produits & Lessive'
  | 'Eau & Électricité (CIE/SODECI)'
  | 'Carburant & Livraison'
  | 'Salaires'
  | 'Loyer & Divers';

export type LogisticsType = 'enlevement' | 'livraison';

export type LogisticsStatus = 'planifie' | 'en_cours' | 'effectue' | 'annule';

export type AppTab =
  | 'dashboard'
  | 'pos'
  | 'orders'
  | 'logistics'
  | 'clients'
  | 'catalog'
  | 'inventory'
  | 'cashbook'
  | 'settings';

export type InventoryCategory =
  | 'Lessives & Détachants'
  | 'Solvants & Nettoyage à sec'
  | 'Emballages & Cintres'
  | 'Repassage & Entretien'
  | 'Étiquetage & Comptoir';

export type InventoryMovementType = 'entree' | 'sortie' | 'ajustement';

export interface InventoryItem {
  id: string;
  name: string;
  sku?: string;
  category: InventoryCategory;
  activityScope: ShopActivityScope;
  unit: string;
  quantity: number;
  minThreshold: number;
  unitCostFCFA: number;
  supplier?: string;
  notes?: string;
  updatedAt: string;
}

export interface InventoryMovement {
  id: string;
  itemId: string;
  itemName: string;
  type: InventoryMovementType;
  quantityDelta: number;
  previousQty: number;
  newQty: number;
  unit: string;
  unitCostFCFA?: number;
  totalCostFCFA?: number;
  reason: string;
  createdAt: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  category: GarmentCategory;
  defaultMode: ServiceMode;
  priceFCFA: number;
  unit: 'pièce' | 'kg' | 'paire';
  active: boolean;
  imageUrl?: string;
  turnaroundDays?: number;
  careNote?: string;
}

export interface ClientWalletEntry {
  id: string;
  date: string;
  type: 'recharge' | 'utilisation' | 'bonus';
  amountFCFA: number;
  method?: PaymentMethod;
  note?: string;
}

export interface Client {
  id: string;
  fullName: string;
  phone: string;
  commune: string;
  addressNote?: string;
  createdAt: string;
  loyaltyPoints?: number;
  prepaidBalanceFCFA?: number;
  subscriptionLabel?: string;
  subscriptionExpiresAt?: string;
  walletHistory?: ClientWalletEntry[];
}

export interface IntakePhoto {
  id: string;
  dataUrl: string;
  caption: string;
  itemName?: string;
  capturedAt: string;
}

export interface LoyaltyConfig {
  enabled: boolean;
  fcfaPerPoint: number;
  rewardThresholdPoints: number;
  rewardDiscountFCFA: number;
}

export interface OrderLineItem {
  id: string;
  catalogItemId: string;
  name: string;
  mode: ServiceMode;
  quantity: number;
  unit: 'pièce' | 'kg' | 'paire' | 'lot';
  unitPriceFCFA: number;
  note?: string;
  activityType?: ActivityType;
  pricingBasis?: BlanchisserieBasis | string;
  piecesPerUnit?: number;
  weightKg?: number;
  isExpress?: boolean;
  expressFeeFCFA?: number;
  expressDueDate?: string;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  ticketNumber: string;
  clientName: string;
  amountFCFA: number;
  method: PaymentMethod;
  paidAt: string;
  type: 'acompte' | 'solde' | 'integral';
}

export interface PressingOrder {
  id: string;
  ticketNumber: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  commune: string;
  rackSlot: string;
  items: OrderLineItem[];
  isExpress: boolean;
  expressFeeFCFA: number;
  deliveryFeeFCFA: number;
  discountFCFA: number;
  prepaidUsedFCFA?: number;
  loyaltyPointsEarned?: number;
  loyaltyPointsRedeemed?: number;
  claimPhotos?: IntakePhoto[];
  totalFCFA: number;
  paidFCFA: number;
  status: OrderStatus;
  dropOffDate: string;
  dueDate: string;
  deliveredAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryZone {
  id: string;
  commune: string;
  feeFCFA: number;
  pickupFeeFCFA: number;
  active: boolean;
}

export interface LogisticsTask {
  id: string;
  type: LogisticsType;
  status: LogisticsStatus;
  clientId: string;
  clientName: string;
  clientPhone: string;
  commune: string;
  addressDetail: string;
  orderId?: string;
  ticketNumber?: string;
  scheduledDate: string;
  timeSlot: string;
  courierName: string;
  courierPhone?: string;
  estimatedPieces?: number;
  feeFCFA: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseRecord {
  id: string;
  label: string;
  category: ExpenseCategory;
  amountFCFA: number;
  method: PaymentMethod;
  date: string;
  note?: string;
  createdAt: string;
}

export interface PressingSettings {
  id: 'default';
  shopName: string;
  tagline: string;
  commune: string;
  address: string;
  phone: string;
  whatsappPhone: string;
  rccm: string;
  expressPercent: number;
  ticketFooterNote: string;
  nextTicketSequence: number;
  activityScope: ShopActivityScope;
  blanchisserieConfig: BlanchisserieConfig;
  pressingConfig: PressingConfig;
  loyaltyConfig?: LoyaltyConfig;
  pinHash?: string;
  pinSalt?: string;
  onboardingCompleted?: boolean;
}

export interface DatabaseBackup {
  version: number;
  exportedAt: string;
  settings: PressingSettings;
  clients: Client[];
  catalog: CatalogItem[];
  orders: PressingOrder[];
  payments: PaymentRecord[];
  expenses: ExpenseRecord[];
  zones?: DeliveryZone[];
  logistics?: LogisticsTask[];
  inventory?: InventoryItem[];
  inventoryMovements?: InventoryMovement[];
}
