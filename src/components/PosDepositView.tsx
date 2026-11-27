import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  Camera,
  Check,
  Minus,
  Plus,
  Scale,
  Search,
  Trash2,
  Truck,
  UserPlus,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import {
  ActivityType,
  BlanchisseriePack,
  BlanchisserieService,
  CatalogItem,
  Client,
  DeliveryZone,
  GarmentCategory,
  IntakePhoto,
  LogisticsTask,
  OrderLineItem,
  PaymentMethod,
  PressingOrder,
  PressingSettings,
  PressingWeightOffer,
  ServiceMode,
} from '../types/pressing';
import {
  ABIDJAN_COMMUNES,
  addDaysISO,
  BLANCHISSERIE_SERVICES,
  BLANCHISSERIE_SERVICE_LABELS,
  computeLineExpressFee,
  formatFCFA,
  formatWeightKg,
  getTodayISO,
  PAYMENT_METHOD_LABELS,
  PRESSING_WEIGHT_MODES,
  SERVICE_MODE_LABELS,
  TIME_SLOTS,
} from '../utils/formatters';
import { resolveCatalogItemImage } from '../utils/catalogImages';
import { compressClaimPhoto } from '../utils/imageCompress';
import { GarmentThumbnail } from './GarmentThumbnail';

interface AutoDeliveryPlan {
  timeSlot: string;
  courierName: string;
  addressDetail: string;
}

interface PosDepositViewProps {
  catalog: CatalogItem[];
  clients: Client[];
  zones: DeliveryZone[];
  settings: PressingSettings;
  preselectedClientId?: string | null;
  pickupContext?: LogisticsTask | null;
  onClearPickupContext?: () => void;
  onCreateClient: (client: Client) => Promise<void>;
  onSubmitOrder: (
    orderDraft: Omit<PressingOrder, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt'>,
    paymentMethod: PaymentMethod,
    autoDelivery?: AutoDeliveryPlan
  ) => Promise<PressingOrder>;
}

const CATEGORIES: ('Tout' | GarmentCategory)[] = [
  'Tout',
  'Tenues traditionnelles',
  'Costumes & Bureau',
  'Quotidien',
  'Maison & Linge',
];

const BLANCHISSERIE_SERVICE_DESC: Record<BlanchisserieService, string> = {
  lavage_simple: 'Lavage machine & essorage uniquement',
  lavage_repassage: 'Lavage complet, séchage et repassage soigné',
  repassage_seul: 'Défroissage & repassage vapeur uniquement',
};

type PressingSubMode = 'piece' | 'kilo';

export const PosDepositView: React.FC<PosDepositViewProps> = ({
  catalog,
  clients,
  zones,
  settings,
  preselectedClientId,
  pickupContext,
  onClearPickupContext,
  onCreateClient,
  onSubmitOrder,
}) => {
  const supportsPressing =
    settings.activityScope === 'pressing' || settings.activityScope === 'both';
  const supportsBlanchisserie =
    settings.activityScope === 'blanchisserie' || settings.activityScope === 'both';

  const [activeActivity, setActiveActivity] = useState<ActivityType>(
    settings.activityScope === 'blanchisserie' ? 'blanchisserie' : 'pressing'
  );
  const [pressingSubMode, setPressingSubMode] = useState<PressingSubMode>('piece');

  useEffect(() => {
    if (settings.activityScope === 'pressing') {
      setActiveActivity('pressing');
    } else if (settings.activityScope === 'blanchisserie') {
      setActiveActivity('blanchisserie');
    }
  }, [settings.activityScope]);

  const pc = settings.pressingConfig;
  const bc = settings.blanchisserieConfig;

  useEffect(() => {
    if (!pc.weightEnabled && pressingSubMode === 'kilo') {
      setPressingSubMode('piece');
    }
  }, [pc.weightEnabled, pressingSubMode]);

  const enabledServices = useMemo(() => {
    const list = BLANCHISSERIE_SERVICES.filter((s) => bc.enabledServices[s]);
    return list.length > 0 ? list : BLANCHISSERIE_SERVICES;
  }, [bc.enabledServices]);

  const activePacks = useMemo(
    () =>
      bc.packs
        .filter((p) => p.active)
        .slice()
        .sort((a, b) => a.garmentCount - b.garmentCount),
    [bc.packs]
  );

  // Build selectable Blanchisserie options (packs + optional unit)
  const blanchisserieOptions = useMemo(() => {
    const options: {
      id: string;
      label: string;
      shortLabel: string;
      garmentCount: number;
      isUnit: boolean;
      pricesFCFA: Record<BlanchisserieService, number>;
    }[] = activePacks.map((pk) => ({
      id: pk.id,
      label: `${pk.garmentCount} vêtements (tous types confondus)`,
      shortLabel: `${pk.garmentCount} vêtements`,
      garmentCount: pk.garmentCount,
      isUnit: false,
      pricesFCFA: pk.pricesFCFA,
    }));

    if (bc.enableUnit || options.length === 0) {
      options.push({
        id: 'unite',
        label: "À l'unité (1 vêtement)",
        shortLabel: "À l'unité",
        garmentCount: 1,
        isUnit: true,
        pricesFCFA: bc.unitPricesFCFA,
      });
    }
    return options;
  }, [activePacks, bc.enableUnit, bc.unitPricesFCFA]);

  const [blService, setBlService] = useState<BlanchisserieService>(enabledServices[0]);
  const [blOptionId, setBlOptionId] = useState<string>(
    blanchisserieOptions[0]?.id || 'unite'
  );
  const [blQty, setBlQty] = useState<number>(1);
  const [blDetails, setBlDetails] = useState<string>('');
  const [blNote, setBlNote] = useState<string>('');

  useEffect(() => {
    if (!enabledServices.includes(blService)) {
      setBlService(enabledServices[0]);
    }
  }, [enabledServices, blService]);

  useEffect(() => {
    if (!blanchisserieOptions.some((o) => o.id === blOptionId)) {
      setBlOptionId(blanchisserieOptions[0]?.id || 'unite');
    }
  }, [blanchisserieOptions, blOptionId]);

  const selectedBlOption =
    blanchisserieOptions.find((o) => o.id === blOptionId) || blanchisserieOptions[0];

  // Pressing by-weight custom calculator state
  const [customKg, setCustomKg] = useState<number>(1.5);
  const [customKgMode, setCustomKgMode] = useState<ServiceMode>('lavage_repassage');
  const [customKgPrice, setCustomKgPrice] = useState<number>(() =>
    Math.round(1.5 * (pc.pricePerKgByMode.lavage_repassage || 3500))
  );
  const [customKgPriceEdited, setCustomKgPriceEdited] = useState<boolean>(false);
  const [customKgNote, setCustomKgNote] = useState<string>('');

  useEffect(() => {
    if (!customKgPriceEdited) {
      const rate = pc.pricePerKgByMode[customKgMode] || 0;
      setCustomKgPrice(Math.max(0, Math.round(customKg * rate)));
    }
  }, [customKg, customKgMode, customKgPriceEdited, pc.pricePerKgByMode]);

  const activeWeightOffers = useMemo(
    () => pc.weightOffers.filter((wo) => wo.active),
    [pc.weightOffers]
  );

  const [selectedCategory, setSelectedCategory] = useState<'Tout' | GarmentCategory>('Tout');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [clientId, setClientId] = useState<string>(
    pickupContext?.clientId || preselectedClientId || (clients[0]?.id ?? '')
  );

  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('+225 ');
  const [newClientCommune, setNewClientCommune] = useState(ABIDJAN_COMMUNES[1]);

  const [cart, setCart] = useState<OrderLineItem[]>([]);
  const [dueDate, setDueDate] = useState<string>(addDaysISO(2));
  const [rackSlot, setRackSlot] = useState<string>('A-01');
  const [commune, setCommune] = useState<string>(
    pickupContext?.commune || ABIDJAN_COMMUNES[0]
  );
  const [deliveryFee, setDeliveryFee] = useState<number>(pickupContext?.feeFCFA || 0);
  const [scheduleHomeDelivery, setScheduleHomeDelivery] = useState<boolean>(!!pickupContext);
  const [deliverySlot, setDeliverySlot] = useState<string>(TIME_SLOTS[2]);
  const [courierName, setCourierName] = useState<string>(
    pickupContext?.courierName || 'Koné Moussa'
  );
  const [deliveryAddress, setDeliveryAddress] = useState<string>(
    pickupContext?.addressDetail || ''
  );
  const [discount, setDiscount] = useState<number>(0);
  const [redeemLoyalty, setRedeemLoyalty] = useState<boolean>(false);
  const [usePrepaid, setUsePrepaid] = useState<boolean>(false);
  const [prepaidAmount, setPrepaidAmount] = useState<number>(0);
  const [claimPhotos, setClaimPhotos] = useState<IntakePhoto[]>([]);
  const [photoCaption, setPhotoCaption] = useState<string>('Tache existante');
  const [photoItemName, setPhotoItemName] = useState<string>('');
  const [uploadingPhoto, setUploadingPhoto] = useState<boolean>(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [paidAmount, setPaidAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('especes');
  const [orderNotes, setOrderNotes] = useState(
    pickupContext ? `Issu de l'enlèvement (${pickupContext.courierName})` : ''
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    setRedeemLoyalty(false);
    setUsePrepaid(false);
    setPrepaidAmount(0);
  }, [clientId]);

  useEffect(() => {
    if (pickupContext) {
      setClientId(pickupContext.clientId);
      setCommune(pickupContext.commune);
      setDeliveryAddress(pickupContext.addressDetail);
      setCourierName(pickupContext.courierName);
      const z = zones.find((zn) => zn.commune === pickupContext.commune);
      setDeliveryFee(z ? z.feeFCFA : pickupContext.feeFCFA);
      setScheduleHomeDelivery(true);
      setOrderNotes(`Suite à enlèvement à domicile (${pickupContext.courierName})`);
    } else if (preselectedClientId) {
      setClientId(preselectedClientId);
    }
  }, [pickupContext, preselectedClientId, zones]);

  const activeCatalog = useMemo(
    () =>
      catalog.filter((item) => {
        if (!item.active) return false;
        if (selectedCategory !== 'Tout' && item.category !== selectedCategory) return false;
        if (
          catalogSearch.trim() &&
          !item.name.toLowerCase().includes(catalogSearch.trim().toLowerCase())
        ) {
          return false;
        }
        return true;
      }),
    [catalog, selectedCategory, catalogSearch]
  );

  const selectedClient = clients.find((c) => c.id === clientId);

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity * item.unitPriceFCFA, 0),
    [cart]
  );

  const expressFee = useMemo(
    () => cart.reduce((sum, item) => sum + (item.isExpress ? item.expressFeeFCFA || 0 : 0), 0),
    [cart]
  );

  const expressLinesCount = useMemo(
    () => cart.filter((item) => item.isExpress).length,
    [cart]
  );

  const hasAnyExpress = expressLinesCount > 0;

  const cartPiecesCount = useMemo(
    () =>
      cart.reduce(
        (sum, item) => sum + (item.unit === 'kg' ? 0 : item.quantity * (item.piecesPerUnit || 1)),
        0
      ),
    [cart]
  );

  const cartWeightKg = useMemo(
    () =>
      cart.reduce(
        (sum, item) =>
          sum + (item.weightKg ? item.quantity * item.weightKg : item.unit === 'kg' ? item.quantity : 0),
        0
      ),
    [cart]
  );

  const loyaltyConfig = settings.loyaltyConfig;
  const clientPoints = selectedClient?.loyaltyPoints || 0;
  const clientPrepaid = selectedClient?.prepaidBalanceFCFA || 0;
  const canRedeemLoyalty =
    Boolean(loyaltyConfig?.enabled) &&
    clientPoints >= (loyaltyConfig?.rewardThresholdPoints || 100);
  const loyaltyDiscountFCFA =
    redeemLoyalty && canRedeemLoyalty && loyaltyConfig
      ? loyaltyConfig.rewardDiscountFCFA
      : 0;
  const loyaltyPointsRedeemed =
    redeemLoyalty && canRedeemLoyalty && loyaltyConfig
      ? loyaltyConfig.rewardThresholdPoints
      : 0;

  const effectiveDiscount = discount + loyaltyDiscountFCFA;
  const totalFCFA = Math.max(0, subtotal + expressFee + deliveryFee - effectiveDiscount);

  const actualPrepaidUsed = useMemo(() => {
    if (!usePrepaid || clientPrepaid <= 0) return 0;
    return Math.min(clientPrepaid, totalFCFA, Math.max(0, Math.round(prepaidAmount)));
  }, [usePrepaid, clientPrepaid, totalFCFA, prepaidAmount]);

  const remainingAfterPrepaid = Math.max(0, totalFCFA - actualPrepaidUsed);

  useEffect(() => {
    if (usePrepaid && clientPrepaid > 0) {
      setPrepaidAmount(Math.min(clientPrepaid, totalFCFA));
    }
  }, [usePrepaid, clientPrepaid, totalFCFA]);

  const addCatalogItem = (item: CatalogItem) => {
    if (item.turnaroundDays && item.turnaroundDays > 2) {
      const suggested = addDaysISO(item.turnaroundDays);
      if (suggested > dueDate) setDueDate(suggested);
    }

    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (li) =>
          li.activityType !== 'blanchisserie' &&
          !li.isExpress &&
          li.unit !== 'kg' &&
          li.catalogItemId === item.id &&
          li.mode === item.defaultMode &&
          (li.note || '') === (item.careNote || '')
      );
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: next[existingIndex].quantity + 1,
        };
        return next;
      }
      return [
        ...prev,
        {
          id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          catalogItemId: item.id,
          name: item.name,
          mode: item.defaultMode,
          quantity: 1,
          unit: item.unit,
          unitPriceFCFA: item.priceFCFA,
          note: item.careNote || undefined,
          activityType: 'pressing',
          piecesPerUnit: 1,
          isExpress: false,
          expressFeeFCFA: 0,
        },
      ];
    });
  };

  const addWeightOfferItem = (offer: PressingWeightOffer) => {
    setCart((prev) => {
      const catalogId = `kg-${offer.id}`;
      const existingIndex = prev.findIndex(
        (li) =>
          li.activityType === 'pressing' &&
          !li.isExpress &&
          li.catalogItemId === catalogId &&
          li.mode === offer.mode &&
          li.unitPriceFCFA === offer.priceFCFA
      );
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: next[existingIndex].quantity + 1,
        };
        return next;
      }
      return [
        ...prev,
        {
          id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          catalogItemId: catalogId,
          name: offer.label,
          mode: offer.mode,
          quantity: 1,
          unit: 'kg',
          unitPriceFCFA: offer.priceFCFA,
          weightKg: offer.weightKg,
          activityType: 'pressing',
          piecesPerUnit: 0,
          isExpress: false,
          expressFeeFCFA: 0,
        },
      ];
    });
  };

  const handleAddCustomWeight = () => {
    const safeKg = Math.max(0.1, Number(customKg) || 0.5);
    const safePrice = Math.max(0, Math.round(Number(customKgPrice) || 0));
    const cleanNote = customKgNote.trim() || undefined;
    setCart((prev) => [
      ...prev,
      {
        id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        catalogItemId: `kg-custom-${customKgMode}`,
        name: `Pressing au kilo · ${formatWeightKg(safeKg)}`,
        mode: customKgMode,
        quantity: 1,
        unit: 'kg',
        unitPriceFCFA: safePrice,
        weightKg: safeKg,
        note: cleanNote,
        activityType: 'pressing',
        piecesPerUnit: 0,
        isExpress: false,
        expressFeeFCFA: 0,
      },
    ]);
    setCustomKgNote('');
    setCustomKgPriceEdited(false);
  };

  const addBlanchisserieItem = (
    service: BlanchisserieService,
    option: {
      id: string;
      garmentCount: number;
      isUnit: boolean;
      pricesFCFA: Record<BlanchisserieService, number>;
    },
    quantity: number,
    detailsText?: string,
    noteText?: string
  ) => {
    const unitPrice = option.pricesFCFA[service];
    const cleanDetails = detailsText?.trim();
    const cleanNote = noteText?.trim();
    const combinedNote = [cleanDetails, cleanNote].filter(Boolean).join(' · ') || undefined;
    const itemName = option.isUnit
      ? 'Blanchisserie · À l’unité'
      : `Blanchisserie · Programme ${option.garmentCount} vêtements`;
    const catalogId = `bl-${service}-${option.id}`;

    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (li) =>
          li.activityType === 'blanchisserie' &&
          !li.isExpress &&
          li.catalogItemId === catalogId &&
          li.mode === service &&
          li.pricingBasis === option.id &&
          (li.note || '') === (combinedNote || '')
      );
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: next[existingIndex].quantity + quantity,
        };
        return next;
      }
      return [
        ...prev,
        {
          id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          catalogItemId: catalogId,
          name: itemName,
          mode: service,
          quantity,
          unit: option.isUnit ? 'pièce' : 'lot',
          unitPriceFCFA: unitPrice,
          note: combinedNote,
          activityType: 'blanchisserie',
          pricingBasis: option.id,
          piecesPerUnit: option.garmentCount,
          isExpress: false,
          expressFeeFCFA: 0,
        },
      ];
    });
  };

  const handleAddConfiguredBlanchisserie = () => {
    if (!selectedBlOption) return;
    addBlanchisserieItem(blService, selectedBlOption, blQty, blDetails, blNote);
    setBlQty(1);
    setBlDetails('');
    setBlNote('');
  };

  const resolveBlanchisseriePrice = (
    basis: string | undefined,
    service: BlanchisserieService,
    fallbackPrice: number
  ): number => {
    if (!basis || basis === 'unite') {
      return bc.unitPricesFCFA[service] ?? fallbackPrice;
    }
    const matchedPack: BlanchisseriePack | undefined =
      bc.packs.find((p) => p.id === basis) ||
      (basis === 'lot_10'
        ? bc.packs.find((p) => p.garmentCount === 10)
        : basis === 'lot_20'
        ? bc.packs.find((p) => p.garmentCount === 20)
        : undefined);
    return matchedPack ? matchedPack.pricesFCFA[service] : fallbackPrice;
  };

  const updateCartItem = (id: string, patch: Partial<OrderLineItem>) => {
    setCart((prev) =>
      prev.map((li) => {
        if (li.id !== id) return li;
        const updated: OrderLineItem = { ...li, ...patch };
        if (updated.isExpress) {
          updated.expressFeeFCFA = computeLineExpressFee(updated, settings);
          if (!updated.expressDueDate) {
            updated.expressDueDate = getTodayISO();
          }
        } else {
          updated.expressFeeFCFA = 0;
          updated.expressDueDate = undefined;
        }
        return updated;
      })
    );
  };

  const toggleLineExpress = (line: OrderLineItem) => {
    const nextExpress = !line.isExpress;
    updateCartItem(line.id, {
      isExpress: nextExpress,
      expressDueDate: nextExpress ? line.expressDueDate || getTodayISO() : undefined,
    });
  };

  const removeCartItem = (id: string) => {
    setCart((prev) => prev.filter((li) => li.id !== id));
  };

  const handleQuickCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName.trim() || !newClientPhone.trim()) return;
    const created: Client = {
      id: `cli-${Date.now()}`,
      fullName: newClientName.trim(),
      phone: newClientPhone.trim(),
      commune: newClientCommune,
      createdAt: getTodayISO(),
    };
    await onCreateClient(created);
    setClientId(created.id);
    setShowNewClientForm(false);
    setNewClientName('');
    setNewClientPhone('+225 ');
  };

  const handlePhotoFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploadingPhoto(true);
    setErrorMsg('');
    try {
      const added: IntakePhoto[] = [];
      for (const f of files.slice(0, 6)) {
        const dataUrl = await compressClaimPhoto(f);
        added.push({
          id: `ph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          dataUrl,
          caption: photoCaption.trim() || 'Réserve réception',
          itemName: photoItemName.trim() || undefined,
          capturedAt: new Date().toISOString(),
        });
      }
      setClaimPhotos((prev) => [...prev, ...added].slice(0, 10));
    } catch {
      setErrorMsg("Impossible de compresser l'image sélectionnée.");
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!selectedClient) {
      setErrorMsg('Veuillez sélectionner ou créer un client.');
      return;
    }
    if (cart.length === 0) {
      setErrorMsg('Ajoutez au moins un article au dépôt.');
      return;
    }

    const numericCashPaid =
      paidAmount.trim() === ''
        ? remainingAfterPrepaid
        : Math.max(0, Math.min(remainingAfterPrepaid, Math.round(Number(paidAmount) || 0)));

    const totalPaidOnOrder = Math.min(totalFCFA, actualPrepaidUsed + numericCashPaid);
    const isHomeDelivery = commune !== ABIDJAN_COMMUNES[0];

    setSubmitting(true);
    try {
      await onSubmitOrder(
        {
          clientId: selectedClient.id,
          clientName: selectedClient.fullName,
          clientPhone: selectedClient.phone,
          commune,
          rackSlot: rackSlot.trim() || 'Comptoir',
          items: cart,
          isExpress: hasAnyExpress,
          expressFeeFCFA: expressFee,
          deliveryFeeFCFA: deliveryFee,
          discountFCFA: effectiveDiscount,
          prepaidUsedFCFA: actualPrepaidUsed,
          loyaltyPointsRedeemed,
          claimPhotos: claimPhotos.length > 0 ? claimPhotos : undefined,
          totalFCFA,
          paidFCFA: totalPaidOnOrder,
          status: 'recu',
          dropOffDate: getTodayISO(),
          dueDate,
          notes: orderNotes.trim() || undefined,
        },
        paymentMethod,
        isHomeDelivery && scheduleHomeDelivery
          ? {
              timeSlot: deliverySlot,
              courierName: courierName.trim() || 'Koné Moussa',
              addressDetail:
                deliveryAddress.trim() || selectedClient.addressNote || commune,
            }
          : undefined
      );
      setCart([]);
      setPaidAmount('');
      setDiscount(0);
      setRedeemLoyalty(false);
      setUsePrepaid(false);
      setPrepaidAmount(0);
      setClaimPhotos([]);
      setDeliveryFee(0);
      setOrderNotes('');
      setDueDate(addDaysISO(2));
      setCommune(ABIDJAN_COMMUNES[0]);
      setScheduleHomeDelivery(false);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedBlPrice = selectedBlOption ? selectedBlOption.pricesFCFA[blService] : 0;
  const selectedBlPieces = blQty * (selectedBlOption?.garmentCount || 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left: Pressing (Pièce / Kilo) OR Blanchisserie Intake */}
      <section className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {activeActivity === 'pressing'
                ? pressingSubMode === 'kilo'
                  ? 'Pressing · Tarification au kilo (kg)'
                  : 'Pressing · Catalogue à la pièce'
                : 'Blanchisserie · Programmes par nombre de vêtements'}
            </h2>
            <p className="text-xs text-slate-500">
              {activeActivity === 'pressing'
                ? pressingSubMode === 'kilo'
                  ? 'Choisissez un forfait poids suggéré ou pesez le linge librement'
                  : 'Cliquez sur un article puis activez Express uniquement sur les pièces demandées'
                : 'Tous types de vêtements confondus à prix fixe selon le programme choisi'}
            </p>
          </div>

          {supportsPressing && supportsBlanchisserie && (
            <div
              className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 shrink-0"
              role="group"
              aria-label="Type d'activité"
            >
              <button
                type="button"
                onClick={() => setActiveActivity('pressing')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  activeActivity === 'pressing'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Pressing
              </button>
              <button
                type="button"
                onClick={() => setActiveActivity('blanchisserie')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  activeActivity === 'blanchisserie'
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Blanchisserie
              </button>
            </div>
          )}
        </div>

        {activeActivity === 'pressing' ? (
          <>
            {/* Sub-mode switcher: À la pièce vs Au kilo */}
            {pc.weightEnabled && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-xs font-medium text-slate-600">Mode d&apos;évaluation :</span>
                <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => setPressingSubMode('piece')}
                    className={`rounded px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                      pressingSubMode === 'piece'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    À la pièce (Catalogue)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPressingSubMode('kilo')}
                    className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                      pressingSubMode === 'kilo'
                        ? 'bg-teal-700 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Scale className="h-3.5 w-3.5" />
                    <span>Au kilo (Poids)</span>
                  </button>
                </div>
              </div>
            )}

            {pressingSubMode === 'piece' ? (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  {/* Category Filter Tabs */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedCategory(cat)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          selectedCategory === cat
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  <div className="relative w-full sm:w-56 shrink-0">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                      placeholder="Rechercher bazin, costume..."
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs focus:bg-white focus:border-teal-600 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Garment Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {activeCatalog.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addCatalogItem(item)}
                      className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-left hover:border-teal-600 hover:bg-teal-50/35 transition-colors cursor-pointer"
                    >
                      <GarmentThumbnail
                        src={resolveCatalogItemImage(item)}
                        alt={item.name}
                        sizeClass="h-14 w-14"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-slate-900 truncate">
                          {item.name}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 truncate">
                          {SERVICE_MODE_LABELS[item.defaultMode]} · par {item.unit}
                        </div>
                        <div className="mt-1 font-mono text-xs font-bold text-teal-800 tabular-nums">
                          {formatFCFA(item.priceFCFA)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              /* ======================== PRESSING AU KILO PANEL ======================== */
              <div className="space-y-5">
                {/* Suggested Weight Offers */}
                {activeWeightOffers.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="text-xs font-semibold text-slate-800">
                      Forfaits poids suggérés (ajout en 1 clic)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {activeWeightOffers.map((offer) => (
                        <button
                          key={offer.id}
                          type="button"
                          onClick={() => addWeightOfferItem(offer)}
                          className="rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-teal-600 hover:bg-teal-50/40 transition-colors cursor-pointer"
                        >
                          <div className="text-xs font-semibold text-slate-900">{offer.label}</div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {formatWeightKg(offer.weightKg)} · {SERVICE_MODE_LABELS[offer.mode]}
                          </div>
                          <div className="mt-2 font-mono text-sm font-bold text-teal-800 tabular-nums">
                            {formatFCFA(offer.priceFCFA)}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Free Weight Calculator */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        Pesée libre au kilo
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Prix suggéré automatiquement selon le tarif/kg, ajustable librement avant
                        validation
                      </p>
                    </div>
                    <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                      Tarif réf. : {formatFCFA(pc.pricePerKgByMode[customKgMode] || 0)}/kg
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        Poids mesuré (kg)
                      </label>
                      <input
                        type="number"
                        min={0.1}
                        step={0.1}
                        value={customKg}
                        onChange={(e) => {
                          setCustomKg(Math.max(0.1, Number(e.target.value) || 0.5));
                          setCustomKgPriceEdited(false);
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs font-semibold tabular-nums focus:border-teal-600 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        Prestation
                      </label>
                      <select
                        value={customKgMode}
                        onChange={(e) => {
                          setCustomKgMode(e.target.value as ServiceMode);
                          setCustomKgPriceEdited(false);
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs focus:border-teal-600 focus:outline-none"
                      >
                        {PRESSING_WEIGHT_MODES.map((m) => (
                          <option key={m} value={m}>
                            {SERVICE_MODE_LABELS[m]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-medium text-slate-700">
                          Prix appliqué (FCFA)
                        </label>
                        {customKgPriceEdited && (
                          <button
                            type="button"
                            onClick={() => setCustomKgPriceEdited(false)}
                            className="text-[10px] font-medium text-teal-700 hover:underline cursor-pointer"
                          >
                            Recalculer
                          </button>
                        )}
                      </div>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={customKgPrice}
                        onChange={(e) => {
                          setCustomKgPriceEdited(true);
                          setCustomKgPrice(Math.max(0, Math.round(Number(e.target.value) || 0)));
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-right font-mono text-xs font-bold tabular-nums focus:border-teal-600 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <input
                      type="text"
                      value={customKgNote}
                      onChange={(e) => setCustomKgNote(e.target.value)}
                      placeholder="Contenu du sac (ex: vestes, pantalons, linge de maison...)"
                      className="flex-1 min-w-[200px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomWeight}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 cursor-pointer shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Ajouter {formatWeightKg(customKg)}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          /* ======================== BLANCHISSERIE INTAKE PANEL ======================== */
          <div className="space-y-5">
            {/* Step 1: Service Formula */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-800">
                1. Formule de traitement
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {enabledServices.map((svc) => {
                  const selected = blService === svc;
                  return (
                    <button
                      key={svc}
                      type="button"
                      onClick={() => setBlService(svc)}
                      className={`rounded-lg border p-3 text-left transition-colors cursor-pointer ${
                        selected
                          ? 'border-teal-700 bg-teal-50/70'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900">
                          {BLANCHISSERIE_SERVICE_LABELS[svc]}
                        </span>
                        {selected && <Check className="h-3.5 w-3.5 text-teal-700 shrink-0" />}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500 leading-snug">
                        {BLANCHISSERIE_SERVICE_DESC[svc]}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2: Configured Garment Count Programs */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-800">
                2. Programme par nombre de vêtements (tous types confondus)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {blanchisserieOptions.map((opt) => {
                  const selected = selectedBlOption?.id === opt.id;
                  const price = opt.pricesFCFA[blService];
                  const unitEquivalent = Math.round(price / Math.max(1, opt.garmentCount));
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setBlOptionId(opt.id)}
                      className={`rounded-lg border p-3 text-left transition-colors cursor-pointer ${
                        selected
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-900 hover:border-teal-600 hover:bg-teal-50/30'
                      }`}
                    >
                      <div className="text-xs font-semibold">{opt.shortLabel}</div>
                      <div
                        className={`mt-1.5 font-mono text-sm font-bold tabular-nums ${
                          selected ? 'text-teal-300' : 'text-teal-800'
                        }`}
                      >
                        {formatFCFA(price)}
                      </div>
                      <div
                        className={`mt-0.5 text-[11px] font-mono tabular-nums ${
                          selected ? 'text-slate-300' : 'text-slate-500'
                        }`}
                      >
                        {opt.isUnit
                          ? '1 vêtement'
                          : `Tous types · ~${formatFCFA(unitEquivalent)}/pce`}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 3: Quantity + Garment Details + Add */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-900">
                    3. Quantité ({selectedBlOption?.isUnit ? "nombre d'articles" : 'nombre de lots'})
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Volume total traité :{' '}
                    <span className="font-mono font-semibold text-slate-800 tabular-nums">
                      {selectedBlPieces} vêtement{selectedBlPieces > 1 ? 's' : ''}
                    </span>{' '}
                    (tous types confondus)
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center rounded-lg border border-slate-300 bg-white">
                    <button
                      type="button"
                      onClick={() => setBlQty((q) => Math.max(1, q - 1))}
                      className="px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 cursor-pointer rounded-l-lg"
                      aria-label="Diminuer la quantité"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={blQty}
                      onChange={(e) => setBlQty(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                      className="w-12 py-1.5 text-center font-mono text-xs font-bold text-slate-900 tabular-nums focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setBlQty((q) => q + 1)}
                      className="px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 cursor-pointer rounded-r-lg"
                      aria-label="Augmenter la quantité"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="hidden sm:flex items-center gap-1">
                    {[1, 2, 3, 5].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setBlQty(preset)}
                        className={`rounded-md border px-2 py-1 font-mono text-[11px] tabular-nums cursor-pointer ${
                          blQty === preset
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="text"
                  value={blDetails}
                  onChange={(e) => setBlDetails(e.target.value)}
                  placeholder="Détail vêtements (ex: 5 t-shirts, 3 pantalons, 2 draps...)"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                />
                <input
                  type="text"
                  value={blNote}
                  onChange={(e) => setBlNote(e.target.value)}
                  placeholder="Consigne atelier (ex: sans javel, pliage séparé)"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="text-xs text-slate-600">
                  Montant ligne :{' '}
                  <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                    {formatFCFA(blQty * selectedBlPrice)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleAddConfiguredBlanchisserie}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Ajouter au ticket</span>
                </button>
              </div>
            </div>

            {/* Quick 1-click Grid for all enabled combinations */}
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <div className="text-[11px] font-medium text-slate-500">
                Ajout rapide en 1 clic (tarifs configurés)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {enabledServices.map((svc) =>
                  blanchisserieOptions.map((opt) => (
                    <button
                      key={`${svc}-${opt.id}`}
                      type="button"
                      onClick={() => addBlanchisserieItem(svc, opt, 1)}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left hover:border-teal-600 hover:bg-teal-50/40 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-slate-900 truncate">
                          {BLANCHISSERIE_SERVICE_LABELS[svc]}
                        </div>
                        <div className="text-[10px] text-slate-500">{opt.shortLabel}</div>
                      </div>
                      <span className="font-mono text-[11px] font-bold text-teal-800 tabular-nums shrink-0">
                        {formatFCFA(opt.pricesFCFA[svc])}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Right: Ticket Summary & Payment */}
      <section className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-5">
        <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Ticket de dépôt</h2>
            <p className="text-xs text-slate-500">
              Service Express configurable article par article dans le panier
            </p>
          </div>
          {cart.length > 0 && (
            <div className="text-right font-mono text-[11px] text-slate-600 tabular-nums">
              {cartPiecesCount > 0 && (
                <div>
                  {cartPiecesCount} vêtement{cartPiecesCount > 1 ? 's' : ''}
                </div>
              )}
              {cartWeightKg > 0 && <div>{formatWeightKg(cartWeightKg)}</div>}
            </div>
          )}
        </div>

        {pickupContext && (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-900">
            <div className="flex items-start gap-2">
              <Truck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-teal-700" />
              <div>
                <div className="font-semibold">Enlèvement à domicile lié</div>
                <div className="text-[11px] text-teal-800">
                  {pickupContext.clientName} · {pickupContext.commune}
                </div>
              </div>
            </div>
            {onClearPickupContext && (
              <button
                type="button"
                onClick={onClearPickupContext}
                className="rounded p-0.5 text-teal-700 hover:bg-teal-100 cursor-pointer"
                title="Détacher cet enlèvement"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Client selector + quick create */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-700">Client</label>
            <button
              type="button"
              onClick={() => setShowNewClientForm((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800 cursor-pointer"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>{showNewClientForm ? 'Annuler' : 'Nouveau client'}</span>
            </button>
          </div>

          {!showNewClientForm ? (
            <>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
              >
                <option value="">— Choisir un client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName} ({c.phone})
                  </option>
                ))}
              </select>
              {selectedClient && (clientPrepaid > 0 || clientPoints > 0 || selectedClient.subscriptionLabel) && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px]">
                  <div className="flex items-center gap-1.5 text-slate-700">
                    <Wallet className="h-3.5 w-3.5 text-teal-700" />
                    <span>Prépayé :</span>
                    <span className="font-mono font-bold text-teal-800 tabular-nums">
                      {formatFCFA(clientPrepaid)}
                    </span>
                    {selectedClient.subscriptionLabel && (
                      <span className="text-slate-500">({selectedClient.subscriptionLabel})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-700">
                    <Award className="h-3.5 w-3.5 text-emerald-700" />
                    <span>Fidélité :</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      {clientPoints} pts
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <form
              onSubmit={handleQuickCreateClient}
              className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2.5"
            >
              <input
                type="text"
                required
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="Nom complet (ex: Konan Yao)"
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              />
              <input
                type="tel"
                required
                value={newClientPhone}
                onChange={(e) => setNewClientPhone(e.target.value)}
                placeholder="+225 07 XX XX XX XX"
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono focus:border-teal-600 focus:outline-none"
              />
              <select
                value={newClientCommune}
                onChange={(e) => setNewClientCommune(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              >
                {ABIDJAN_COMMUNES.map((com) => (
                  <option key={com} value={com}>
                    {com}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="w-full rounded-md bg-slate-900 py-1.5 text-xs font-medium text-white hover:bg-slate-800 cursor-pointer"
              >
                Enregistrer ce client
              </button>
            </form>
          )}
        </div>

        {/* Cart Items with per-line Express control */}
        <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
          {cart.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500">
              Aucun article sélectionné pour le moment.
            </div>
          ) : (
            cart.map((line) => {
              const isBlanchisserieLine = line.activityType === 'blanchisserie';
              const linePieces =
                line.unit === 'kg' ? 0 : line.quantity * (line.piecesPerUnit || 1);
              const lineWeight = line.weightKg
                ? line.quantity * line.weightKg
                : line.unit === 'kg'
                ? line.quantity
                : 0;
              const previewExpressFee = computeLineExpressFee(
                { ...line, isExpress: true },
                settings
              );

              return (
                <div
                  key={line.id}
                  className={`rounded-lg border p-3 space-y-2 transition-colors ${
                    line.isExpress
                      ? 'border-amber-300 bg-amber-50/45'
                      : 'border-slate-200 bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-900">{line.name}</div>
                      {isBlanchisserieLine && linePieces > 0 && (
                        <div className="text-[10px] text-teal-800 font-mono tabular-nums">
                          {linePieces} vêtement{linePieces > 1 ? 's' : ''} au total
                        </div>
                      )}
                      {lineWeight > 0 && (
                        <div className="text-[10px] text-teal-800 font-mono tabular-nums">
                          Poids total : {formatWeightKg(lineWeight)}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeCartItem(line.id)}
                      className="text-slate-400 hover:text-red-600 cursor-pointer"
                      aria-label="Retirer l'article"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {isBlanchisserieLine ? (
                      <select
                        value={line.mode}
                        onChange={(e) => {
                          const nextSvc = e.target.value as BlanchisserieService;
                          updateCartItem(line.id, {
                            mode: nextSvc,
                            unitPriceFCFA: resolveBlanchisseriePrice(
                              line.pricingBasis,
                              nextSvc,
                              line.unitPriceFCFA
                            ),
                          });
                        }}
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                      >
                        {enabledServices.map((svc) => (
                          <option key={svc} value={svc}>
                            {BLANCHISSERIE_SERVICE_LABELS[svc]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select
                        value={line.mode}
                        onChange={(e) =>
                          updateCartItem(line.id, { mode: e.target.value as ServiceMode })
                        }
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                      >
                        {Object.entries(SERVICE_MODE_LABELS).map(([k, lbl]) => (
                          <option key={k} value={k}>
                            {lbl}
                          </option>
                        ))}
                      </select>
                    )}

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          line.quantity > 1
                            ? updateCartItem(line.id, { quantity: line.quantity - 1 })
                            : removeCartItem(line.id)
                        }
                        className="rounded border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-100 cursor-pointer"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-8 text-center font-mono text-xs font-semibold tabular-nums">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateCartItem(line.id, { quantity: line.quantity + 1 })
                        }
                        className="rounded border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-100 cursor-pointer"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <span className="ml-2 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                        {formatFCFA(line.quantity * line.unitPriceFCFA)}
                      </span>
                    </div>
                  </div>

                  {/* Per-item Express Toggle (Pressing) */}
                  {!isBlanchisserieLine && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-2">
                      <button
                        type="button"
                        onClick={() => toggleLineExpress(line)}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                          line.isExpress
                            ? 'border-amber-600 bg-amber-600 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-amber-500 hover:text-amber-800'
                        }`}
                      >
                        <Zap className="h-3 w-3" />
                        <span>
                          {line.isExpress
                            ? `Express activé (+${formatFCFA(line.expressFeeFCFA || 0)})`
                            : `Mettre en Express (+${formatFCFA(previewExpressFee)})`}
                        </span>
                      </button>

                      {line.isExpress && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-medium text-amber-900">
                            Retrait express :
                          </span>
                          <input
                            type="date"
                            value={line.expressDueDate || getTodayISO()}
                            onChange={(e) =>
                              updateCartItem(line.id, { expressDueDate: e.target.value })
                            }
                            className="rounded border border-amber-300 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-800 focus:border-amber-600 focus:outline-none"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  <input
                    type="text"
                    value={line.note || ''}
                    onChange={(e) => updateCartItem(line.id, { note: e.target.value })}
                    placeholder="Observation (tache, bouton, détail du lot...)"
                    className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-[11px] focus:border-teal-600 focus:outline-none"
                  />
                </div>
              );
            })
          )}
        </div>

        {/* Deposit details & Payment form */}
        <form onSubmit={handleSubmit} className="space-y-3 border-t border-slate-200 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Date de retrait standard
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Casier / Cintre
              </label>
              <input
                type="text"
                value={rackSlot}
                onChange={(e) => setRackSlot(e.target.value)}
                placeholder="Ex: A-14"
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono focus:border-teal-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Retrait / Livraison à domicile
              </label>
              <select
                value={commune}
                onChange={(e) => {
                  const val = e.target.value;
                  setCommune(val);
                  if (val === ABIDJAN_COMMUNES[0]) {
                    setDeliveryFee(0);
                    setScheduleHomeDelivery(false);
                  } else {
                    const matched = zones.find((z) => z.commune === val);
                    setDeliveryFee(matched ? matched.feeFCFA : 1500);
                    setScheduleHomeDelivery(true);
                    if (selectedClient?.addressNote && !deliveryAddress) {
                      setDeliveryAddress(selectedClient.addressNote);
                    }
                  }
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              >
                <option value={ABIDJAN_COMMUNES[0]}>{ABIDJAN_COMMUNES[0]}</option>
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
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Frais course (FCFA)
              </label>
              <input
                type="number"
                min={0}
                step={250}
                value={deliveryFee}
                onChange={(e) => setDeliveryFee(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono tabular-nums focus:border-teal-600 focus:outline-none"
              />
            </div>
          </div>

          {commune !== ABIDJAN_COMMUNES[0] && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={scheduleHomeDelivery}
                  onChange={(e) => setScheduleHomeDelivery(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span>Planifier automatiquement la livraison à domicile</span>
              </label>
              {scheduleHomeDelivery && (
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={deliverySlot}
                    onChange={(e) => setDeliverySlot(e.target.value)}
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 text-[11px]"
                  >
                    {TIME_SLOTS.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={courierName}
                    onChange={(e) => setCourierName(e.target.value)}
                    placeholder="Livreur"
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 text-[11px]"
                  />
                  <input
                    type="text"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder="Repère / Adresse précise de livraison"
                    className="col-span-2 rounded border border-slate-300 bg-white px-2 py-1.5 text-[11px]"
                  />
                </div>
              )}
            </div>
          )}

          {/* Intake Claim Photos (Réserves & sinistres à la réception) */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <Camera className="h-3.5 w-3.5 text-teal-700" />
                <span>Photos réserves / état à la réception</span>
              </div>
              <button
                type="button"
                disabled={uploadingPhoto}
                onClick={() => photoInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <Camera className="h-3 w-3 text-teal-700" />
                <span>{uploadingPhoto ? 'Compression...' : 'Prendre / Ajouter photo'}</span>
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={handlePhotoFiles}
                className="hidden"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={photoCaption}
                onChange={(e) => setPhotoCaption(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] focus:border-teal-600 focus:outline-none"
              >
                <option value="Tache existante">Tache existante</option>
                <option value="Accroc / Déchirure">Accroc / Déchirure</option>
                <option value="Bouton manquant / Cassé">Bouton manquant / Cassé</option>
                <option value="Tissu fragile / Décoloration">Tissu fragile / Décoloration</option>
                <option value="État général au dépôt">État général au dépôt</option>
              </select>
              <select
                value={photoItemName}
                onChange={(e) => setPhotoItemName(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] focus:border-teal-600 focus:outline-none"
              >
                <option value="">Article concerné (général)</option>
                {cart.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {claimPhotos.length > 0 && (
              <div className="grid grid-cols-3 gap-2 pt-1">
                {claimPhotos.map((ph) => (
                  <div
                    key={ph.id}
                    className="relative rounded-md border border-slate-200 bg-white p-1"
                  >
                    <img
                      src={ph.dataUrl}
                      alt={ph.caption}
                      className="h-16 w-full rounded object-cover"
                    />
                    <div className="mt-1 truncate text-[10px] font-medium text-slate-700">
                      {ph.caption}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setClaimPhotos((prev) => prev.filter((item) => item.id !== ph.id))
                      }
                      className="absolute right-1.5 top-1.5 rounded bg-slate-900/75 p-0.5 text-white hover:bg-red-600 cursor-pointer"
                      title="Supprimer cette photo"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] text-slate-600">
              {hasAnyExpress ? (
                <span className="font-medium text-amber-800">
                  Express appliqué sur {expressLinesCount} ligne{expressLinesCount > 1 ? 's' : ''}
                </span>
              ) : (
                <span>Express par article disponible dans le panier</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] text-slate-500">Remise :</span>
              <input
                type="number"
                min={0}
                step={100}
                value={discount}
                onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
                className="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-right font-mono text-xs tabular-nums"
              />
            </div>
          </div>

          {/* Loyalty Redemption & Prepaid Deduction */}
          {(canRedeemLoyalty || clientPrepaid > 0) && (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
              {canRedeemLoyalty && loyaltyConfig && (
                <label className="flex items-center justify-between gap-2 text-xs cursor-pointer">
                  <span className="flex items-center gap-2 text-slate-800">
                    <input
                      type="checkbox"
                      checked={redeemLoyalty}
                      onChange={(e) => setRedeemLoyalty(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-teal-700"
                    />
                    <span>
                      Utiliser <strong>{loyaltyConfig.rewardThresholdPoints} pts fidélité</strong>
                    </span>
                  </span>
                  <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                    -{formatFCFA(loyaltyConfig.rewardDiscountFCFA)}
                  </span>
                </label>
              )}

              {clientPrepaid > 0 && (
                <div className="space-y-1.5 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
                  <label className="flex items-center justify-between gap-2 text-xs cursor-pointer">
                    <span className="flex items-center gap-2 text-slate-800">
                      <input
                        type="checkbox"
                        checked={usePrepaid}
                        onChange={(e) => setUsePrepaid(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-teal-700"
                      />
                      <span>Déduire du compte prépayé</span>
                    </span>
                    <span className="font-mono font-semibold text-teal-800 tabular-nums">
                      Dispo : {formatFCFA(clientPrepaid)}
                    </span>
                  </label>
                  {usePrepaid && (
                    <div className="flex items-center justify-between gap-2 pl-6 text-[11px]">
                      <span className="text-slate-600">Montant prépayé appliqué :</span>
                      <input
                        type="number"
                        min={0}
                        max={Math.min(clientPrepaid, totalFCFA)}
                        step={100}
                        value={prepaidAmount}
                        onChange={(e) =>
                          setPrepaidAmount(Math.max(0, Number(e.target.value) || 0))
                        }
                        className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-right font-mono text-xs font-semibold tabular-nums"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="space-y-1 text-xs pt-1">
            <div className="flex justify-between text-slate-600">
              <span>Sous-total articles</span>
              <span className="font-mono tabular-nums">{formatFCFA(subtotal)}</span>
            </div>
            {expressFee > 0 && (
              <div className="flex justify-between text-amber-800">
                <span>
                  Supplément Express ({expressLinesCount} article{expressLinesCount > 1 ? 's' : ''})
                </span>
                <span className="font-mono tabular-nums">+{formatFCFA(expressFee)}</span>
              </div>
            )}
            {deliveryFee > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Livraison / Course</span>
                <span className="font-mono tabular-nums">+{formatFCFA(deliveryFee)}</span>
              </div>
            )}
            {effectiveDiscount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>
                  Remise {loyaltyDiscountFCFA > 0 ? '(dont fidélité)' : ''}
                </span>
                <span className="font-mono tabular-nums">-{formatFCFA(effectiveDiscount)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-slate-900 pt-1 border-t border-slate-100">
              <span>Total net</span>
              <span className="font-mono tabular-nums">{formatFCFA(totalFCFA)}</span>
            </div>
            {actualPrepaidUsed > 0 && (
              <div className="flex justify-between text-teal-800 font-medium">
                <span>Déduit du prépayé</span>
                <span className="font-mono tabular-nums">-{formatFCFA(actualPrepaidUsed)}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                {actualPrepaidUsed > 0
                  ? 'Complément encaissé (FCFA)'
                  : 'Montant encaissé (FCFA)'}
              </label>
              <input
                type="number"
                min={0}
                max={remainingAfterPrepaid}
                step={100}
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                placeholder={`${remainingAfterPrepaid} (Solde)`}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono tabular-nums focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Mode d&apos;encaissement
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              >
                {Object.entries(PAYMENT_METHOD_LABELS).map(([k, lbl]) => (
                  <option key={k} value={k}>
                    {lbl}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <input
            type="text"
            value={orderNotes}
            onChange={(e) => setOrderNotes(e.target.value)}
            placeholder="Note générale sur le dépôt (optionnel)"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs focus:bg-white focus:border-teal-600 focus:outline-none"
          />

          {errorMsg && <p className="text-xs font-medium text-red-700">{errorMsg}</p>}

          <button
            type="submit"
            disabled={submitting || cart.length === 0}
            className="w-full rounded-lg bg-teal-700 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {submitting ? 'Enregistrement...' : 'Valider le dépôt & Ouvrir le ticket'}
          </button>
        </form>
      </section>
    </div>
  );
};
