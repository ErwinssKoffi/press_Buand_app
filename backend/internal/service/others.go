package service

import (
	"context"
	"fmt"
	"time"

	"github.com/erwinsskoffi/press_backend/internal/domain/pressing"
	"github.com/erwinsskoffi/press_backend/internal/platform/dbtx"
	"github.com/erwinsskoffi/press_backend/internal/platform/ids"
)

// --- Settings ---

type SettingsService struct {
	store SettingsStore
	txm   TxRunner
	audit AuditLogger
}

func NewSettingsService(store SettingsStore, txm TxRunner, audit AuditLogger) *SettingsService {
	return &SettingsService{store: store, txm: txm, audit: audit}
}

// Get : normalisation bornée (portage partiel de normalizeSettings).
func (s *SettingsService) Get(ctx context.Context) (*pressing.PressingSettings, error) {
	var out *pressing.PressingSettings
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		var err error
		out, err = s.store.Get(ctx, q)
		if err != nil || out == nil {
			return err
		}
		normalizeSettings(out)
		return nil
	})
	return out, err
}

// Update : valide et borne les paramètres métier (jamais de secret ici).
func (s *SettingsService) Update(ctx context.Context, next *pressing.PressingSettings) (*pressing.PressingSettings, error) {
	normalizeSettings(next)
	if next.ShopName == "" {
		return nil, fmt.Errorf("%w: shopName obligatoire", ErrValidation)
	}
	switch next.ActivityScope {
	case pressing.ScopeBoth, pressing.ScopePressing, pressing.ScopeBlanchisserie:
	default:
		return nil, fmt.Errorf("%w: activityScope invalide", ErrValidation)
	}
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		if err := s.store.Update(ctx, q, next); err != nil {
			return err
		}
		var err error
		next, err = s.store.Get(ctx, q)
		return err
	})
	if err == nil {
		_ = s.audit.Log(ctx, "operator", "settings.update", "shop_settings", "1", nil)
	}
	return next, err
}

func normalizeSettings(s *pressing.PressingSettings) {
	s.ID = "default"
	if s.ExpressPercent < 0 || s.ExpressPercent > 200 {
		s.ExpressPercent = 50
	}
	if s.PressingConfig.ExpressPercent < 0 || s.PressingConfig.ExpressPercent > 200 {
		s.PressingConfig.ExpressPercent = s.ExpressPercent
	}
	if s.PressingConfig.ExpressFixedAmountFCFA < 0 {
		s.PressingConfig.ExpressFixedAmountFCFA = 0
	}
	if s.PressingConfig.PricePerKgByMode == nil {
		s.PressingConfig.PricePerKgByMode = map[string]int64{}
	}
	for k, v := range s.PressingConfig.PricePerKgByMode {
		if v < 0 {
			s.PressingConfig.PricePerKgByMode[k] = 0
		}
	}
	if s.BlanchisserieConfig.UnitPricesFCFA == nil {
		s.BlanchisserieConfig.UnitPricesFCFA = map[string]int64{}
	}
	for k, v := range s.BlanchisserieConfig.UnitPricesFCFA {
		if v < 0 {
			s.BlanchisserieConfig.UnitPricesFCFA[k] = 0
		}
	}
	for i := range s.BlanchisserieConfig.Packs {
		p := &s.BlanchisserieConfig.Packs[i]
		if p.GarmentCount < 2 {
			p.GarmentCount = 10
		}
		if p.PricesFCFA == nil {
			p.PricesFCFA = map[string]int64{}
		}
		for k, v := range p.PricesFCFA {
			if v < 0 {
				p.PricesFCFA[k] = 0
			}
		}
	}
	lc := &s.LoyaltyConfig
	if lc.FcfaPerPoint < 100 {
		lc.FcfaPerPoint = 1000
	}
	if lc.RewardThresholdPoints < 5 {
		lc.RewardThresholdPoints = 50
	}
	if lc.RewardDiscountFCFA < 100 {
		lc.RewardDiscountFCFA = 2000
	}
	if s.NextTicketSequence < 1 {
		s.NextTicketSequence = 1
	}
}

// --- Catalog ---

type CatalogService struct {
	store CatalogStore
	txm   TxRunner
	audit AuditLogger
}

func NewCatalogService(store CatalogStore, txm TxRunner, audit AuditLogger) *CatalogService {
	return &CatalogService{store: store, txm: txm, audit: audit}
}

func (s *CatalogService) List(ctx context.Context, activeOnly bool) ([]*pressing.CatalogItem, error) {
	var out []*pressing.CatalogItem
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		var err error
		out, err = s.store.List(ctx, q, activeOnly)
		return err
	})
	return out, err
}

func (s *CatalogService) Save(ctx context.Context, item *pressing.CatalogItem) (*pressing.CatalogItem, error) {
	if item.Name == "" || item.PriceFCFA < 0 {
		return nil, fmt.Errorf("%w: article invalide", ErrValidation)
	}
	switch item.Unit {
	case "pièce", "kg", "paire":
	default:
		return nil, fmt.Errorf("%w: unité invalide", ErrValidation)
	}
	if !pressing.ValidServiceMode(string(item.DefaultMode)) {
		return nil, fmt.Errorf("%w: mode invalide", ErrValidation)
	}
	if item.ID == "" {
		item.ID = ids.NewUUID()
	}
	item.Active = true
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		return s.store.Upsert(ctx, q, item)
	})
	if err == nil {
		_ = s.audit.Log(ctx, "operator", "catalog.upsert", "catalog_items", item.ID, nil)
	}
	return item, err
}

func (s *CatalogService) Deactivate(ctx context.Context, id string) error {
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		return s.store.Deactivate(ctx, q, id)
	})
	if err == nil {
		_ = s.audit.Log(ctx, "operator", "catalog.delete", "catalog_items", id, nil)
	}
	return err
}

// --- Clients & wallet ---

type ClientService struct {
	store    ClientStore
	payments PaymentStore
	txm      TxRunner
	audit    AuditLogger
	now      Clock
}

func NewClientService(store ClientStore, payments PaymentStore, txm TxRunner, audit AuditLogger) *ClientService {
	return &ClientService{store: store, payments: payments, txm: txm, audit: audit, now: time.Now}
}

func (s *ClientService) List(ctx context.Context, search string, page, pageSize int) ([]*pressing.Client, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 50
	}
	var out []*pressing.Client
	var total int
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		var err error
		out, total, err = s.store.List(ctx, q, search, pageSize, (page-1)*pageSize)
		return err
	})
	return out, total, err
}

func (s *ClientService) Get(ctx context.Context, id string) (*pressing.Client, error) {
	var c *pressing.Client
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		var err error
		c, err = s.store.Get(ctx, q, id)
		if err != nil || c == nil {
			return err
		}
		hist, err := s.store.WalletHistory(ctx, q, id, 40)
		if err != nil {
			return err
		}
		c.WalletHistory = hist
		return nil
	})
	return c, err
}

func (s *ClientService) Save(ctx context.Context, c *pressing.Client) (*pressing.Client, error) {
	if c.FullName == "" || c.Phone == "" {
		return nil, fmt.Errorf("%w: nom et téléphone obligatoires", ErrValidation)
	}
	if c.ID == "" {
		c.ID = ids.NewUUID()
		c.CreatedAt = s.now().UTC().Format(time.RFC3339)
	}
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		return s.store.Upsert(ctx, q, c)
	})
	if err == nil {
		_ = s.audit.Log(ctx, "operator", "client.upsert", "clients", c.ID, nil)
	}
	return c, err
}

func (s *ClientService) Archive(ctx context.Context, id string) error {
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		return s.store.Archive(ctx, q, id)
	})
	if err == nil {
		_ = s.audit.Log(ctx, "operator", "client.archive", "clients", id, nil)
	}
	return err
}

// TopupIn : recharge prépayée (corrige E1/E4 : historique complet + kind encaissement explicite).
type TopupIn struct {
	AmountFCFA            int64                  `json:"amountFCFA"`
	BonusFCFA             int64                  `json:"bonusFCFA"`
	Method                pressing.PaymentMethod `json:"method"`
	SubscriptionLabel     string                 `json:"subscriptionLabel"`
	SubscriptionExpiresAt string                 `json:"subscriptionExpiresAt"`
	Note                  string                 `json:"note"`
	IdempotencyKey        string                 `json:"-"`
}

// Topup : recharge + bonus, historique complet, paiement kind=prepaid_topup — même tx.
func (s *ClientService) Topup(ctx context.Context, clientID string, in TopupIn) (*pressing.Client, error) {
	if in.AmountFCFA < 0 || in.BonusFCFA < 0 || (in.AmountFCFA == 0 && in.BonusFCFA == 0) {
		return nil, ErrInvalidAmount
	}
	if in.AmountFCFA > 0 && !pressing.ValidPaymentMethod(string(in.Method)) {
		return nil, ErrInvalidAmount
	}
	var updated *pressing.Client
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		if in.IdempotencyKey != "" {
			var exists bool
			row := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM idempotency_keys WHERE scope='client.topup' AND key=$1)`, in.IdempotencyKey)
			if err := row.Scan(&exists); err != nil {
				return err
			}
			if exists {
				return ErrIdempotentReplay
			}
		}
		client, err := s.store.Get(ctx, q, clientID)
		if err != nil {
			return err
		}
		if client == nil || client.Archived {
			return fmt.Errorf("client introuvable")
		}
		nowISO := s.now().UTC().Format(time.RFC3339)

		if in.AmountFCFA > 0 {
			if err := s.store.ApplyWalletDelta(ctx, q, clientID, 0, in.AmountFCFA); err != nil {
				return err
			}
			entry := &pressing.ClientWalletEntry{
				ID:         ids.NewUUID(),
				Date:       nowISO,
				Type:       "recharge",
				AmountFCFA: in.AmountFCFA,
				Method:     strPtr(string(in.Method)),
				Note:       strPtr(orDefault(in.Note, orDefault(in.SubscriptionLabel, "Recharge compte prépayé"))),
			}
			if err := s.store.AddWalletEntry(ctx, q, clientID, entry); err != nil {
				return err
			}
			pay := &pressing.PaymentRecord{
				ID:           ids.NewUUID(),
				OrderID:      nil,
				TicketNumber: fmt.Sprintf("ABON-%s", s.now().Format("20060102")),
				ClientName:   client.FullName + " (Prépayé)",
				AmountFCFA:   in.AmountFCFA,
				Method:       in.Method,
				PaidAt:       nowISO,
				Type:         "integral",
				Kind:         "prepaid_topup",
			}
			if err := s.payments.Create(ctx, q, pay, ""); err != nil {
				return err
			}
		}
		if in.BonusFCFA > 0 {
			entry := &pressing.ClientWalletEntry{
				ID:         ids.NewUUID(),
				Date:       nowISO,
				Type:       "bonus",
				AmountFCFA: in.BonusFCFA,
				Note:       strPtr("Bonus abonnement / fidélité"),
			}
			if err := s.store.AddWalletEntry(ctx, q, clientID, entry); err != nil {
				return err
			}
			// le bonus crédite le solde sans encaissement
			if err := s.store.ApplyWalletDelta(ctx, q, clientID, 0, in.BonusFCFA); err != nil {
				return err
			}
		}
		if in.SubscriptionLabel != "" || in.SubscriptionExpiresAt != "" {
			label := in.SubscriptionLabel
			if err := s.store.Upsert(ctx, q, &pressing.Client{
				ID: clientID, FullName: client.FullName, Phone: client.Phone, Commune: client.Commune,
				AddressNote: client.AddressNote, LoyaltyPoints: client.LoyaltyPoints,
				PrepaidBalanceFCFA:    client.PrepaidBalanceFCFA,
				SubscriptionLabel:     &label,
				SubscriptionExpiresAt: nilIfEmpty(in.SubscriptionExpiresAt),
			}); err != nil {
				return err
			}
		}
		if in.IdempotencyKey != "" {
			if _, err := q.Exec(ctx, `INSERT INTO idempotency_keys (scope, key) VALUES ('client.topup', $1) ON CONFLICT DO NOTHING`, in.IdempotencyKey); err != nil {
				return err
			}
		}
		updated, err = s.store.Get(ctx, q, clientID)
		if err != nil || updated == nil {
			return err
		}
		hist, err := s.store.WalletHistory(ctx, q, clientID, 40)
		if err != nil {
			return err
		}
		updated.WalletHistory = hist
		return nil
	})
	if err == nil {
		_ = s.audit.Log(ctx, "operator", "client.topup", "clients", clientID,
			map[string]any{"amount": in.AmountFCFA, "bonus": in.BonusFCFA})
	}
	return updated, err
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// --- Logistics ---

type LogisticsService struct {
	store LogisticsStore
	zones ZoneStore
	txm   TxRunner
	audit AuditLogger
}

func NewLogisticsService(store LogisticsStore, zones ZoneStore, txm TxRunner, audit AuditLogger) *LogisticsService {
	return &LogisticsService{store: store, zones: zones, txm: txm, audit: audit}
}

func (s *LogisticsService) List(ctx context.Context, status, typ, date string) ([]*pressing.LogisticsTask, error) {
	var out []*pressing.LogisticsTask
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		var err error
		out, err = s.store.List(ctx, q, status, typ, date)
		return err
	})
	return out, err
}

func (s *LogisticsService) Save(ctx context.Context, t *pressing.LogisticsTask) (*pressing.LogisticsTask, error) {
	if !pressing.ValidLogisticsType(string(t.Type)) || t.ClientName == "" || t.ScheduledDate == "" {
		return nil, fmt.Errorf("%w: tâche invalide", ErrValidation)
	}
	if t.Status == "" {
		t.Status = pressing.LogisticsPlanifie
	}
	if !pressing.ValidLogisticsStatus(string(t.Status)) {
		return nil, fmt.Errorf("%w: statut invalide", ErrValidation)
	}
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		return s.store.Upsert(ctx, q, t)
	})
	if err == nil {
		_ = s.audit.Log(ctx, "operator", "logistics.upsert", "logistics_tasks", t.ID, nil)
	}
	return t, err
}

// SetStatus : livraison effectuée → commande livrée (même tx, corrige E2).
func (s *LogisticsService) SetStatus(ctx context.Context, id string, status pressing.LogisticsStatus) (*pressing.LogisticsTask, error) {
	if !pressing.ValidLogisticsStatus(string(status)) {
		return nil, fmt.Errorf("%w: statut invalide", ErrValidation)
	}
	var task *pressing.LogisticsTask
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		var err error
		task, err = s.store.UpdateStatus(ctx, q, id, status)
		return err
	})
	if err == nil {
		_ = s.audit.Log(ctx, "operator", "logistics.status", "logistics_tasks", id, map[string]any{"status": status})
	}
	return task, err
}

func (s *LogisticsService) Delete(ctx context.Context, id string) error {
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		return s.store.Delete(ctx, q, id)
	})
	if err == nil {
		_ = s.audit.Log(ctx, "operator", "logistics.delete", "logistics_tasks", id, nil)
	}
	return err
}

func (s *LogisticsService) Zones(ctx context.Context) ([]*pressing.DeliveryZone, error) {
	var out []*pressing.DeliveryZone
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		var err error
		out, err = s.zones.List(ctx, q)
		return err
	})
	return out, err
}

func (s *LogisticsService) SaveZone(ctx context.Context, z *pressing.DeliveryZone) error {
	if z.Commune == "" || z.FeeFCFA < 0 || z.PickupFeeFCFA < 0 {
		return fmt.Errorf("%w: zone invalide", ErrValidation)
	}
	if z.ID == "" {
		z.ID = ids.NewUUID()
	}
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		return s.zones.Upsert(ctx, q, z)
	})
	if err == nil {
		_ = s.audit.Log(ctx, "operator", "zone.upsert", "delivery_zones", z.ID, nil)
	}
	return err
}

func (s *LogisticsService) DeleteZone(ctx context.Context, id string) error {
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		return s.zones.Delete(ctx, q, id)
	})
	if err == nil {
		_ = s.audit.Log(ctx, "operator", "zone.delete", "delivery_zones", id, nil)
	}
	return err
}

// --- Inventory ---

type InventoryService struct {
	store InventoryStore
	txm   TxRunner
	audit AuditLogger
	now   Clock
}

func NewInventoryService(store InventoryStore, txm TxRunner, audit AuditLogger) *InventoryService {
	return &InventoryService{store: store, txm: txm, audit: audit, now: time.Now}
}

func (s *InventoryService) List(ctx context.Context) ([]*pressing.InventoryItem, error) {
	var out []*pressing.InventoryItem
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		var err error
		out, err = s.store.List(ctx, q)
		return err
	})
	return out, err
}

func (s *InventoryService) Movements(ctx context.Context, itemID string, limit int) ([]*pressing.InventoryMovement, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var out []*pressing.InventoryMovement
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		var err error
		out, err = s.store.ListMovements(ctx, q, itemID, limit)
		return err
	})
	return out, err
}

func (s *InventoryService) Save(ctx context.Context, i *pressing.InventoryItem) (*pressing.InventoryItem, error) {
	if i.Name == "" || i.Unit == "" {
		return nil, fmt.Errorf("%w: article invalide", ErrValidation)
	}
	if i.Quantity < 0 || i.MinThreshold < 0 || i.UnitCostFCFA < 0 {
		return nil, fmt.Errorf("%w: valeurs négatives interdites", ErrValidation)
	}
	if i.ID == "" {
		i.ID = ids.NewUUID()
	}
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		return s.store.Upsert(ctx, q, i)
	})
	if err == nil {
		_ = s.audit.Log(ctx, "operator", "inventory.upsert", "inventory_items", i.ID, nil)
	}
	return i, err
}

func (s *InventoryService) Archive(ctx context.Context, id string) error {
	// mouvements conservés (corrige C1)
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		return s.store.Archive(ctx, q, id)
	})
	if err == nil {
		_ = s.audit.Log(ctx, "operator", "inventory.archive", "inventory_items", id, nil)
	}
	return err
}

// MovementIn : entrée/sortie/ajustement (A16 : sortie > dispo rejetée).
type MovementIn struct {
	Type           pressing.InventoryMovementType `json:"type"`
	Quantity       float64                        `json:"quantity"`
	UnitCostFCFA   *int64                         `json:"unitCostFCFA"`
	Reason         string                         `json:"reason"`
	RecordExpense  bool                           `json:"recordExpense"`
	PaymentMethod  pressing.PaymentMethod         `json:"paymentMethod"`
	IdempotencyKey string                         `json:"-"`
}

// Movement : verrou FOR UPDATE, validation stock, mouvement immuable,
// dépense automatique optionnelle — le tout dans la même transaction.
func (s *InventoryService) Movement(ctx context.Context, itemID string, in MovementIn, expenses ExpenseStore) (*pressing.InventoryItem, error) {
	if !pressing.ValidMovementType(string(in.Type)) || in.Quantity < 0 {
		return nil, ErrInvalidQuantity
	}
	if in.Reason == "" {
		in.Reason = map[pressing.InventoryMovementType]string{
			pressing.MovementEntree:     "Réapprovisionnement",
			pressing.MovementSortie:     "Sortie atelier",
			pressing.MovementAjustement: "Ajustement inventaire",
		}[in.Type]
	}
	var updated *pressing.InventoryItem
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		if in.IdempotencyKey != "" {
			var exists bool
			if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM idempotency_keys WHERE scope='inventory.movement' AND key=$1)`, in.IdempotencyKey).Scan(&exists); err != nil {
				return err
			}
			if exists {
				return ErrIdempotentReplay
			}
		}
		item, err := s.store.LockForUpdate(ctx, q, itemID)
		if err != nil {
			return err
		}
		if item == nil {
			return fmt.Errorf("article introuvable")
		}
		prev := item.Quantity
		var delta float64
		var newQty float64
		switch in.Type {
		case pressing.MovementEntree:
			newQty = prev + in.Quantity
			delta = in.Quantity
		case pressing.MovementSortie:
			if in.Quantity > prev {
				return ErrInsufficientStock
			}
			newQty = prev - in.Quantity
			delta = -in.Quantity
		default: // ajustement
			newQty = in.Quantity
			delta = newQty - prev
		}
		unitCost := item.UnitCostFCFA
		if in.UnitCostFCFA != nil && *in.UnitCostFCFA >= 0 && in.Type == pressing.MovementEntree {
			unitCost = *in.UnitCostFCFA
		}
		var totalCost *int64
		if in.Type == pressing.MovementEntree && delta > 0 {
			tc := int64(roundFloat64(float64(unitCost) * delta))
			totalCost = &tc
		}
		if in.Type == pressing.MovementEntree && totalCost != nil {
			if err := s.store.SetQuantity(ctx, q, itemID, newQty, &unitCost); err != nil {
				return err
			}
		} else {
			if err := s.store.SetQuantity(ctx, q, itemID, newQty, nil); err != nil {
				return err
			}
		}
		mov := &pressing.InventoryMovement{
			ID:            ids.NewUUID(),
			ItemID:        itemID,
			ItemName:      item.Name,
			Type:          in.Type,
			QuantityDelta: delta,
			PreviousQty:   prev,
			NewQty:        newQty,
			Unit:          item.Unit,
			Reason:        in.Reason,
			UnitCostFCFA:  nil,
			TotalCostFCFA: totalCost,
		}
		if in.Type == pressing.MovementEntree {
			mov.UnitCostFCFA = &unitCost
		}
		if err := s.store.AddMovement(ctx, q, mov); err != nil {
			return err
		}
		// dépense automatique (même transaction, portage de recordInventoryMovement)
		if in.RecordExpense && in.Type == pressing.MovementEntree && totalCost != nil && *totalCost > 0 {
			if expenses == nil {
				return fmt.Errorf("store dépenses requis pour recordExpense")
			}
			if !pressing.ValidPaymentMethod(string(in.PaymentMethod)) {
				in.PaymentMethod = pressing.MethodEspeces
			}
			note := "Fournisseur : " + deref(item.Supplier)
			exp := &pressing.ExpenseRecord{
				ID:         ids.NewUUID(),
				Label:      fmt.Sprintf("Achat stock : %s (+%s %s)", item.Name, trimFloat(delta), item.Unit),
				Category:   "Produits & Lessive",
				AmountFCFA: *totalCost,
				Method:     in.PaymentMethod,
				Date:       s.now().Format("2006-01-02"),
				Note:       &note,
				CreatedAt:  s.now().UTC().Format(time.RFC3339),
			}
			if err := expenses.Create(ctx, q, exp); err != nil {
				return err
			}
		}
		if in.IdempotencyKey != "" {
			if _, err := q.Exec(ctx, `INSERT INTO idempotency_keys (scope, key) VALUES ('inventory.movement', $1) ON CONFLICT DO NOTHING`, in.IdempotencyKey); err != nil {
				return err
			}
		}
		updated, err = s.store.Get(ctx, q, itemID)
		return err
	})
	if err == nil {
		_ = s.audit.Log(ctx, "operator", "inventory.movement", "inventory_items", itemID,
			map[string]any{"type": in.Type, "quantity": in.Quantity})
	}
	return updated, err
}

// --- Cashbook ---

type CashbookService struct {
	expenses ExpenseStore
	txm      TxRunner
	audit    AuditLogger
	now      Clock
}

func NewCashbookService(expenses ExpenseStore, txm TxRunner, audit AuditLogger) *CashbookService {
	return &CashbookService{expenses: expenses, txm: txm, audit: audit, now: time.Now}
}

func (s *CashbookService) Expenses(ctx context.Context, from, to string, page, pageSize int) ([]*pressing.ExpenseRecord, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 50
	}
	var out []*pressing.ExpenseRecord
	var total int
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		var err error
		out, total, err = s.expenses.List(ctx, q, from, to, pageSize, (page-1)*pageSize)
		return err
	})
	return out, total, err
}

func (s *CashbookService) CreateExpense(ctx context.Context, e *pressing.ExpenseRecord) (*pressing.ExpenseRecord, error) {
	if e.Label == "" || e.AmountFCFA <= 0 || e.Date == "" {
		return nil, ErrInvalidAmount
	}
	if !pressing.ValidPaymentMethod(string(e.Method)) {
		return nil, ErrInvalidAmount
	}
	if e.ID == "" {
		e.ID = ids.NewUUID()
	}
	e.CreatedAt = s.now().UTC().Format(time.RFC3339)
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		return s.expenses.Create(ctx, q, e)
	})
	if err == nil {
		_ = s.audit.Log(ctx, "operator", "expense.create", "expenses", e.ID, map[string]any{"amount": e.AmountFCFA})
	}
	return e, err
}

func (s *CashbookService) DeleteExpense(ctx context.Context, id string) error {
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		return s.expenses.SoftDelete(ctx, q, id)
	})
	if err == nil {
		_ = s.audit.Log(ctx, "operator", "expense.delete", "expenses", id, nil)
	}
	return err
}

func roundFloat64(v float64) float64 {
	if v < 0 {
		return -(-v + 0.5)
	}
	return v + 0.5
}

func trimFloat(v float64) string {
	if v == float64(int64(v)) {
		return fmt.Sprintf("%d", int64(v))
	}
	return fmt.Sprintf("%.2f", v)
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
