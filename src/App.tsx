import React, { useCallback, useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import {
  BookOpen,
  ClipboardList,
  LayoutDashboard,
  Menu,
  Package,
  PlusCircle,
  ScanBarcode,
  Settings,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  AppTab,
  CatalogItem,
  Client,
  DatabaseBackup,
  DeliveryZone,
  ExpenseRecord,
  InventoryItem,
  InventoryMovement,
  InventoryMovementType,
  LogisticsStatus,
  LogisticsTask,
  PaymentMethod,
  PaymentRecord,
  PressingOrder,
  PressingSettings,
} from './types/pressing';
import {
  clearAllBusinessData,
  createOrderWithPayment,
  DEFAULT_SETTINGS,
  deleteCatalogItem,
  deleteClient,
  deleteDeliveryZone,
  deleteExpense,
  deleteInventoryItem,
  deleteLogisticsTask,
  deleteOrder,
  importBackupJSON,
  loadAllData,
  recordInventoryMovement,
  recordOrderPayment,
  resetDemoData,
  saveCatalogItem,
  saveClient,
  saveDeliveryZone,
  saveExpense,
  saveInventoryItem,
  saveLogisticsTask,
  saveSettings,
  topUpClientPrepaid,
  updateLogisticsStatus,
  updateOrderStatus,
} from './db/localDb';
import { getTodayISO, STATUS_META } from './utils/formatters';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineBanner } from './components/OfflineBanner';
import { BarcodeScannerModal } from './components/BarcodeScannerModal';
import { exportReceiptPdf } from './utils/receiptPdf';
import { TicketPrintModal } from './components/TicketPrintModal';
import { DashboardView } from './components/DashboardView';
import { PosDepositView } from './components/PosDepositView';
import { OrdersView } from './components/OrdersView';
import { LogisticsView } from './components/LogisticsView';
import { ClientsView } from './components/ClientsView';
import { CatalogView } from './components/CatalogView';
import { InventoryView } from './components/InventoryView';
import { CashbookView } from './components/CashbookView';
import { SettingsView } from './components/SettingsView';

const NAV_ITEMS: { id: AppTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { id: 'pos', label: 'Nouveau dépôt', icon: PlusCircle },
  { id: 'orders', label: 'Commandes & Suivi', icon: ClipboardList },
  { id: 'logistics', label: 'Enlèvements & Livraisons', icon: Truck },
  { id: 'clients', label: 'Clients', icon: Users },
  { id: 'catalog', label: 'Tarifs & Catalogue', icon: BookOpen },
  { id: 'inventory', label: 'Stocks & Produits', icon: Package },
  { id: 'cashbook', label: 'Caisse & Dépenses', icon: Wallet },
  { id: 'settings', label: 'Paramètres & Sauvegarde', icon: Settings },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [settings, setSettings] = useState<PressingSettings>(DEFAULT_SETTINGS);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [orders, setOrders] = useState<PressingOrder[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [logistics, setLogistics] = useState<LogisticsTask[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([]);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [preselectedClientId, setPreselectedClientId] = useState<string | null>(null);
  const [pickupContext, setPickupContext] = useState<LogisticsTask | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const refreshData = useCallback(async () => {
    const data = await loadAllData();
    setSettings(data.settings);
    setCatalog(data.catalog);
    setClients(data.clients);
    setOrders(data.orders);
    setPayments(data.payments);
    setExpenses(data.expenses);
    setZones(data.zones);
    setLogistics(data.logistics);
    setInventory(data.inventory);
    setInventoryMovements(data.inventoryMovements);
  }, []);

  useEffect(() => {
    registerSW({ immediate: true });
    refreshData().finally(() => setLoading(false));
  }, [refreshData]);

  const selectedOrder = orders.find((o) => o.id === selectedOrderId) || null;

  const handleSubmitOrder = async (
    orderDraft: Omit<PressingOrder, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt'>,
    paymentMethod: PaymentMethod,
    autoDelivery?: { timeSlot: string; courierName: string; addressDetail: string }
  ) => {
    const { order } = await createOrderWithPayment(orderDraft, paymentMethod);

    if (pickupContext) {
      await saveLogisticsTask({
        ...pickupContext,
        status: 'effectue',
        orderId: order.id,
        ticketNumber: order.ticketNumber,
      });
    }

    if (autoDelivery) {
      const remaining = Math.max(0, order.totalFCFA - order.paidFCFA);
      await saveLogisticsTask({
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        type: 'livraison',
        status: 'planifie',
        clientId: order.clientId,
        clientName: order.clientName,
        clientPhone: order.clientPhone,
        commune: order.commune,
        addressDetail: autoDelivery.addressDetail,
        orderId: order.id,
        ticketNumber: order.ticketNumber,
        scheduledDate: order.dueDate || getTodayISO(),
        timeSlot: autoDelivery.timeSlot,
        courierName: autoDelivery.courierName,
        feeFCFA: order.deliveryFeeFCFA,
        notes:
          remaining > 0
            ? `Solde à encaisser à la livraison : ${remaining} FCFA`
            : 'Ticket soldé au dépôt',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    await refreshData();
    setSelectedOrderId(order.id);
    setPreselectedClientId(null);
    setPickupContext(null);
    return order;
  };

  const handleAdvanceStatus = async (orderId: string) => {
    const target = orders.find((o) => o.id === orderId);
    if (!target) return;
    const next = STATUS_META[target.status].nextStatus;
    if (!next) return;
    await updateOrderStatus(orderId, next);
    await refreshData();
  };

  const handleRecordPayment = async (
    orderId: string,
    amountFCFA: number,
    method: PaymentMethod
  ) => {
    await recordOrderPayment(orderId, amountFCFA, method);
    await refreshData();
  };

  const handleDeleteOrder = async (orderId: string) => {
    await deleteOrder(orderId);
    if (selectedOrderId === orderId) setSelectedOrderId(null);
    await refreshData();
  };

  const handleSaveClient = async (client: Client) => {
    await saveClient(client);
    await refreshData();
  };

  const handleDeleteClient = async (id: string) => {
    await deleteClient(id);
    await refreshData();
  };

  const handleSaveCatalogItem = async (item: CatalogItem) => {
    await saveCatalogItem(item);
    await refreshData();
  };

  const handleDeleteCatalogItem = async (id: string) => {
    await deleteCatalogItem(id);
    await refreshData();
  };

  const handleSaveExpense = async (expense: ExpenseRecord) => {
    await saveExpense(expense);
    await refreshData();
  };

  const handleDeleteExpense = async (id: string) => {
    await deleteExpense(id);
    await refreshData();
  };

  const handleSaveSettings = async (next: PressingSettings) => {
    await saveSettings(next);
    await refreshData();
  };

  const handleImportBackup = async (backup: DatabaseBackup) => {
    await importBackupJSON(backup);
    await refreshData();
  };

  const handleClearAllData = async () => {
    await clearAllBusinessData();
    await refreshData();
  };

  const handleResetDemoData = async () => {
    await resetDemoData();
    await refreshData();
  };

  const handleSaveLogisticsTask = async (task: LogisticsTask) => {
    await saveLogisticsTask(task);
    await refreshData();
  };

  const handleUpdateLogisticsStatus = async (id: string, status: LogisticsStatus) => {
    await updateLogisticsStatus(id, status);
    await refreshData();
  };

  const handleDeleteLogisticsTask = async (id: string) => {
    await deleteLogisticsTask(id);
    await refreshData();
  };

  const handleSaveZone = async (zone: DeliveryZone) => {
    await saveDeliveryZone(zone);
    await refreshData();
  };

  const handleDeleteZone = async (id: string) => {
    await deleteDeliveryZone(id);
    await refreshData();
  };

  const handleSaveInventoryItem = async (item: InventoryItem) => {
    await saveInventoryItem(item);
    await refreshData();
  };

  const handleDeleteInventoryItem = async (id: string) => {
    await deleteInventoryItem(id);
    await refreshData();
  };

  const handleRecordInventoryMovement = async (params: {
    itemId: string;
    type: InventoryMovementType;
    quantity: number;
    unitCostFCFA?: number;
    reason: string;
    recordExpense?: boolean;
    paymentMethod?: PaymentMethod;
  }) => {
    await recordInventoryMovement(params);
    await refreshData();
  };

  const handleTopUpPrepaid = async (params: {
    clientId: string;
    amountFCFA: number;
    bonusFCFA?: number;
    method: PaymentMethod;
    subscriptionLabel?: string;
    subscriptionExpiresAt?: string;
    note?: string;
  }) => {
    await topUpClientPrepaid(params);
    await refreshData();
  };

  const activeNav = NAV_ITEMS.find((n) => n.id === activeTab)!;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Sidebar Desktop */}
      <aside className="no-print hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-200 bg-white">
        <div className="flex h-16 items-center px-6 border-b border-slate-200">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            {settings.shopName}
          </span>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto" aria-label="Navigation principale">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4 text-xs text-slate-500 space-y-1">
          <div className="font-medium text-slate-700 truncate">{settings.commune}</div>
          <div>Base locale hors-ligne · FCFA</div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative flex w-72 max-w-full flex-col bg-white border-r border-slate-200">
            <div className="flex h-16 items-center justify-between px-5 border-b border-slate-200">
              <span className="font-display text-base font-bold text-slate-900 truncate">
                {settings.shopName}
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 cursor-pointer"
                aria-label="Fermer le menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-teal-700 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Workspace */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="no-print sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100 cursor-pointer"
              aria-label="Ouvrir le menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="text-base sm:text-lg font-semibold text-slate-900 truncate">
              {activeNav.label}
            </h1>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title="Suivi atelier par lecteur code-barres ou numéro de ticket"
            >
              <ScanBarcode className="h-3.5 w-3.5 text-teal-700" />
              <span className="hidden sm:inline">Scanner ticket</span>
            </button>
            <PWAInstallButton />
            {activeTab !== 'pos' && (
              <button
                type="button"
                onClick={() => setActiveTab('pos')}
                className="rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Nouveau dépôt
              </button>
            )}
          </div>
        </header>

        {/* Content Viewport */}
        <main className="no-print flex-1 p-4 sm:p-8 max-w-[1440px] w-full mx-auto">
          {loading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((k) => (
                  <div
                    key={k}
                    className="h-28 rounded-xl border border-slate-200 bg-white p-5 animate-pulse"
                  />
                ))}
              </div>
              <div className="h-72 rounded-xl border border-slate-200 bg-white animate-pulse" />
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && (
                <DashboardView
                  orders={orders}
                  payments={payments}
                  expenses={expenses}
                  logistics={logistics}
                  onNavigate={setActiveTab}
                  onSelectOrder={(o) => setSelectedOrderId(o.id)}
                  onAdvanceStatus={handleAdvanceStatus}
                />
              )}

              {activeTab === 'pos' && (
                <PosDepositView
                  catalog={catalog}
                  clients={clients}
                  zones={zones}
                  settings={settings}
                  preselectedClientId={preselectedClientId}
                  pickupContext={pickupContext}
                  onClearPickupContext={() => setPickupContext(null)}
                  onCreateClient={handleSaveClient}
                  onSubmitOrder={handleSubmitOrder}
                />
              )}

              {activeTab === 'orders' && (
                <OrdersView
                  orders={orders}
                  onSelectOrder={(o) => setSelectedOrderId(o.id)}
                  onExportPdf={(o) =>
                    exportReceiptPdf(
                      o,
                      payments.filter((p) => p.orderId === o.id),
                      settings,
                      'a5'
                    )
                  }
                  onOpenScanner={() => setScannerOpen(true)}
                  onAdvanceStatus={handleAdvanceStatus}
                  onDeleteOrder={handleDeleteOrder}
                />
              )}

              {activeTab === 'logistics' && (
                <LogisticsView
                  logistics={logistics}
                  zones={zones}
                  clients={clients}
                  orders={orders}
                  onSaveTask={handleSaveLogisticsTask}
                  onUpdateStatus={handleUpdateLogisticsStatus}
                  onDeleteTask={handleDeleteLogisticsTask}
                  onSaveZone={handleSaveZone}
                  onDeleteZone={handleDeleteZone}
                  onCreateDepositFromPickup={(task) => {
                    setPickupContext(task);
                    setActiveTab('pos');
                  }}
                  onOpenOrder={(o) => setSelectedOrderId(o.id)}
                />
              )}

              {activeTab === 'clients' && (
                <ClientsView
                  clients={clients}
                  orders={orders}
                  loyaltyConfig={settings.loyaltyConfig}
                  onSaveClient={handleSaveClient}
                  onDeleteClient={handleDeleteClient}
                  onTopUpPrepaid={handleTopUpPrepaid}
                  onNewDepositForClient={(cid) => {
                    setPreselectedClientId(cid);
                    setActiveTab('pos');
                  }}
                />
              )}

              {activeTab === 'catalog' && (
                <CatalogView
                  catalog={catalog}
                  onSaveItem={handleSaveCatalogItem}
                  onDeleteItem={handleDeleteCatalogItem}
                />
              )}

              {activeTab === 'inventory' && (
                <InventoryView
                  items={inventory}
                  movements={inventoryMovements}
                  onSaveItem={handleSaveInventoryItem}
                  onDeleteItem={handleDeleteInventoryItem}
                  onRecordMovement={handleRecordInventoryMovement}
                />
              )}

              {activeTab === 'cashbook' && (
                <CashbookView
                  orders={orders}
                  payments={payments}
                  expenses={expenses}
                  settings={settings}
                  onSaveExpense={handleSaveExpense}
                  onDeleteExpense={handleDeleteExpense}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsView
                  settings={settings}
                  ordersCount={orders.length}
                  clientsCount={clients.length}
                  onSaveSettings={handleSaveSettings}
                  onImportBackup={handleImportBackup}
                  onClearAllData={handleClearAllData}
                  onResetDemoData={handleResetDemoData}
                />
              )}
            </>
          )}
        </main>

        {/* Barcode / Workshop Scanner Modal */}
        {scannerOpen && (
          <BarcodeScannerModal
            orders={orders}
            onClose={() => setScannerOpen(false)}
            onSelectOrder={(o) => setSelectedOrderId(o.id)}
            onAdvanceStatus={handleAdvanceStatus}
          />
        )}

        {/* Ticket Modal (also serves as print target) */}
        {selectedOrder && (
          <TicketPrintModal
            order={selectedOrder}
            orderPayments={payments.filter((p) => p.orderId === selectedOrder.id)}
            settings={settings}
            onClose={() => setSelectedOrderId(null)}
            onRecordPayment={handleRecordPayment}
            onAdvanceStatus={handleAdvanceStatus}
          />
        )}

        <OfflineBanner />
      </div>
    </div>
  );
}
