package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/erwinsskoffi/press_backend/internal/domain/pressing"
	"github.com/erwinsskoffi/press_backend/internal/platform/ids"
)

// ---------- Contrat sync (openapi.yaml) ----------

type SyncOperation struct {
	OperationID    string          `json:"operationId"`
	Type           string          `json:"type"`
	Payload        json.RawMessage `json:"payload"`
	DependsOn      string          `json:"dependsOn,omitempty"`
	LocalCreatedAt string          `json:"localCreatedAt,omitempty"`
}

type SyncPushIn struct {
	DeviceID   string          `json:"deviceId"`
	Operations []SyncOperation `json:"operations"`
}

type SyncOpResult struct {
	OperationID    string         `json:"operationId"`
	Status         string         `json:"status"` // accepted | duplicate | conflict | rejected
	Entity         map[string]any `json:"entity,omitempty"`
	ErrorCode      string         `json:"errorCode,omitempty"`
	Message        string         `json:"message,omitempty"`
	OfficialTicket string         `json:"officialTicket,omitempty"`
}

// ---------- Types de payload (miroirs des DTO en ligne — mêmes tags JSON) ----------

// syncOrderPayload : mêmes champs que le POST /orders en ligne + extras offline.
type syncOrderPayload struct {
	IdempotencyKey        string                   `json:"idempotencyKey,omitempty"`
	ClientID              *string                  `json:"clientId"`
	NewClient             *pressing.Client         `json:"newClient"`
	ClientName            string                   `json:"clientName"`
	ClientPhone           string                   `json:"clientPhone"`
	Commune               string                   `json:"commune"`
	RackSlot              string                   `json:"rackSlot"`
	Items                 []pressing.OrderLineItem `json:"items"`
	IsExpress             bool                     `json:"isExpress"`
	DeliveryZoneID        *string                  `json:"deliveryZoneId"`
	DeliveryFeeFCFA       int64                    `json:"deliveryFeeFCFA"`
	DiscountFCFA          int64                    `json:"discountFCFA"`
	UsePrepaid            bool                     `json:"usePrepaid"`
	PrepaidAmountFCFA     int64                    `json:"prepaidAmountFCFA"`
	LoyaltyPointsRedeemed int64                    `json:"loyaltyPointsRedeemed"`
	InitialPaymentMethod  pressing.PaymentMethod   `json:"initialPaymentMethod"`
	InitialCashPaidFCFA   *int64                   `json:"initialCashPaidFCFA"`
	DropOffDate           string                   `json:"dropOffDate"`
	DueDate               *string                  `json:"dueDate"`
	Notes                 string                   `json:"notes"`
	// Extras offline :
	AcceptPricing     bool   `json:"acceptPricing,omitempty"`
	ProvisionalTicket string `json:"provisionalTicket,omitempty"`
	SeenTotalFCFA     int64  `json:"seenTotalFCFA,omitempty"`
}

type syncPaymentPayload struct {
	OrderID    string                 `json:"orderId"`
	AmountFCFA int64                  `json:"amountFCFA"`
	Method     pressing.PaymentMethod `json:"method"`
}

// ---------- Service ----------

// SyncService : push/pull/status hors ligne. RÈGLE : chaque opération est
// appliquée par les MÊMES services métier que les endpoints en ligne (aucune
// règle dupliquée) ; les montants ne sont jamais acceptés sans recalcul.
type SyncService struct {
	pool       *pgxpool.Pool
	orders     *OrderService
	settings   *SettingsService
	catalogSvc *CatalogService
	clients    *ClientService
	logistics  *LogisticsService
	inventory  *InventoryService
	cashbook   *CashbookService
	expenses   ExpenseStore
	maxPending int
}

func NewSyncService(pool *pgxpool.Pool, orders *OrderService, settings *SettingsService,
	catalogSvc *CatalogService, clients *ClientService, logistics *LogisticsService,
	inventory *InventoryService, cashbook *CashbookService, expenses ExpenseStore) *SyncService {
	return &SyncService{pool: pool, orders: orders, settings: settings, catalogSvc: catalogSvc,
		clients: clients, logistics: logistics, inventory: inventory, cashbook: cashbook,
		expenses: expenses, maxPending: 200}
}

// touchDevice enregistre l'appareil (deviceId stable par installation).
func (s *SyncService) touchDevice(ctx context.Context, deviceID, label string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO devices (device_id, label, created_at, last_seen_at)
		VALUES ($1, NULLIF($2,''), now(), now())
		ON CONFLICT (device_id) DO UPDATE SET last_seen_at=now()`, deviceID, label)
	return err
}

func syncIdemKey(deviceID, operationID string) string {
	return "sync:" + deviceID + ":" + operationID
}

// Push : applique les opérations hors ligne dans l'ordre du lot (le client
// tri par dépendances). Résultat stable par opération ; dédouicatement
// persistant (device_id, operation_id).
func (s *SyncService) Push(ctx context.Context, in SyncPushIn) ([]SyncOpResult, int64, error) {
	if strings.TrimSpace(in.DeviceID) == "" {
		return nil, 0, fmt.Errorf("%w: deviceId obligatoire", ErrValidation)
	}
	if len(in.Operations) > s.maxPending {
		return nil, 0, fmt.Errorf("%w: trop d'opérations par lot (max %d)", ErrValidation, s.maxPending)
	}
	if err := s.touchDevice(ctx, in.DeviceID, "sync"); err != nil {
		return nil, 0, err
	}
	start := time.Now()
	results := make([]SyncOpResult, 0, len(in.Operations))
	for _, op := range in.Operations {
		res := s.applyOne(ctx, in.DeviceID, op)
		results = append(results, res)
	}
	var cursor int64
	if err := s.pool.QueryRow(ctx, `SELECT last_value FROM change_seq`).Scan(&cursor); err != nil {
		return results, 0, err
	}
	counts := map[string]int{}
	for _, r := range results {
		counts[r.Status]++
	}
	slog.Info("sync push", "device", in.DeviceID, "ops", len(results),
		"accepted", counts["accepted"], "duplicate", counts["duplicate"],
		"conflict", counts["conflict"], "rejected", counts["rejected"],
		"duration_ms", time.Since(start).Milliseconds())
	return results, cursor, nil
}

// journalLookup : résultat conservé pour (device, operation) — idempotence.
// accepted → duplicate ; conflict rejouable si le payload porte acceptPricing.
func (s *SyncService) journalLookup(ctx context.Context, deviceID string, op SyncOperation, payload *syncOrderPayload) (*SyncOpResult, bool, error) {
	var status string
	var result []byte
	err := s.pool.QueryRow(ctx, `SELECT status, COALESCE(result,'{}'::jsonb) FROM sync_operations
		WHERE device_id=$1 AND operation_id=$2`, deviceID, op.OperationID).Scan(&status, &result)
	if err != nil {
		return nil, false, nil // pas d'entrée : première soumission
	}
	var stored SyncOpResult
	_ = json.Unmarshal(result, &stored)
	stored.OperationID = op.OperationID
	if status == "accepted" {
		stored.Status = "duplicate"
		stored.Message = "Opération déjà appliquée (aucun doublon créé)."
		return &stored, true, nil
	}
	if status == "conflict" && payload != nil && payload.AcceptPricing {
		// l'opérateur a confirmé les nouveaux tarifs : rejouable
		if _, err := s.pool.Exec(ctx, `DELETE FROM sync_operations
			WHERE device_id=$1 AND operation_id=$2 AND status='conflict'`, deviceID, op.OperationID); err != nil {
			return nil, false, err
		}
		return nil, false, nil
	}
	// rejected/conflict conservés tels quels (reprise manuelle côté terminal)
	return &stored, true, nil
}

func (s *SyncService) journalSave(ctx context.Context, deviceID string, op SyncOperation, res SyncOpResult, payload json.RawMessage) {
	raw, _ := json.Marshal(res)
	status := res.Status
	if status == "duplicate" {
		status = "accepted" // première application réussie (la réponse dit duplicate)
	}
	_, err := s.pool.Exec(ctx, `INSERT INTO sync_operations (id, device_id, operation_id, op_type, status, payload, result, error_code, received_at, applied_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),now(),CASE WHEN $5 IN ('accepted','duplicate') THEN now() ELSE NULL END)
		ON CONFLICT (device_id, operation_id) DO UPDATE SET status=EXCLUDED.status, result=EXCLUDED.result,
		  error_code=EXCLUDED.error_code, applied_at=EXCLUDED.applied_at`,
		ids.NewUUID(), deviceID, op.OperationID, op.Type, status, payload, raw, res.ErrorCode)
	if err != nil {
		slog.Error("sync journal", "error", err, "op", op.OperationID)
	}
}

// applyOne : aiguillage par type, résultat JAMAIS lancé (toujours un verdict).
func (s *SyncService) applyOne(ctx context.Context, deviceID string, op SyncOperation) SyncOpResult {
	res := SyncOpResult{OperationID: op.OperationID, Status: "rejected"}
	if op.OperationID == "" || op.Type == "" {
		res.ErrorCode = "invalid_operation"
		res.Message = "operationId et type obligatoires."
		return res
	}

	var orderPayload syncOrderPayload
	if op.Type == "order.create" {
		_ = json.Unmarshal(op.Payload, &orderPayload)
	}

	if stored, found, err := s.journalLookup(ctx, deviceID, op, &orderPayload); err != nil {
		res.ErrorCode = "internal"
		res.Message = err.Error()
		return res
	} else if found {
		return *stored
	}

	switch op.Type {
	case "client.create":
		res = s.applyClientCreate(ctx, op)
	case "order.create":
		res = s.applyOrderCreate(ctx, deviceID, op, orderPayload)
	case "order.payment":
		res = s.applyOrderPayment(ctx, deviceID, op)
	case "expense.create":
		res = s.applyExpenseCreate(ctx, op)
	case "inventory.movement":
		res = s.applyInventoryMovement(ctx, deviceID, op)
	case "logistics.save":
		res = s.applyLogisticsSave(ctx, op)
	default:
		res.ErrorCode = "unsupported_type"
		res.Message = fmt.Sprintf("Type %q non autorisé hors ligne (connexion requise).", op.Type)
	}

	if res.Status == "accepted" || res.Status == "duplicate" || res.Status == "conflict" || res.Status == "rejected" {
		// le conflit et le rejet sont journalisés aussi : verdict stable au retry
		s.journalSave(ctx, deviceID, op, res, op.Payload)
	}
	return res
}

// --- client.create : fusion sûre par téléphone si le client existe déjà ---

func (s *SyncService) applyClientCreate(ctx context.Context, op SyncOperation) SyncOpResult {
	res := SyncOpResult{OperationID: op.OperationID, Status: "rejected"}
	var c pressing.Client
	if err := json.Unmarshal(op.Payload, &c); err != nil {
		res.ErrorCode = "invalid_payload"
		res.Message = "payload client illisible."
		return res
	}
	if c.ID == "" {
		c.ID = op.OperationID // ID provisoire = UUID réel côté serveur
	}
	// fusion idempotente : même téléphone non archivé → client existant conservé
	var existingID string
	err := s.pool.QueryRow(ctx, `SELECT id FROM clients WHERE phone=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1`, c.Phone).Scan(&existingID)
	if err == nil && existingID != c.ID {
		full, err := s.clients.Get(ctx, existingID)
		if err == nil && full != nil {
			return SyncOpResult{OperationID: op.OperationID, Status: "duplicate",
				Entity:    map[string]any{"client": full},
				Message:   "Client déjà existant (même téléphone) — fusion idempotente.",
				ErrorCode: "client_merged"}
		}
	}
	saved, err := s.clients.Save(ctx, &c)
	if err != nil {
		res.ErrorCode = businessCode(err)
		res.Message = err.Error()
		return res
	}
	return SyncOpResult{OperationID: op.OperationID, Status: "accepted",
		Entity: map[string]any{"client": saved}}
}

// --- order.create : recalcul serveur + conflit de tarif explicite ---

func (s *SyncService) applyOrderCreate(ctx context.Context, deviceID string, op SyncOperation, p syncOrderPayload) SyncOpResult {
	res := SyncOpResult{OperationID: op.OperationID, Status: "rejected"}

	// conflit de configuration tarifaire : le serveur recalcule et compare
	// avec ce que l'opérateur a vu hors ligne (jamais de recalcul silencieux).
	settings, err := s.settings.Get(ctx)
	if err != nil {
		res.ErrorCode = "internal"
		res.Message = err.Error()
		return res
	}
	in := s.pricingInputOf(p)
	mapping, merr := s.previewMapping(ctx, in, settings)
	if merr != nil {
		res.ErrorCode = businessCode(merr)
		res.Message = merr.Error()
		return res
	}
	if !p.AcceptPricing && pricingDrift(p, mapping) {
		return SyncOpResult{OperationID: op.OperationID, Status: "conflict",
			ErrorCode: "pricing_changed",
			Entity:    map[string]any{"recomputed": mapping},
			Message:   "Les tarifs ont changé depuis le dépôt hors ligne : vérifiez puis confirmez (acceptPricing).",
		}
	}

	created, err := s.orders.Create(ctx, in, nil, syncIdemKey(deviceID, op.OperationID))
	if err != nil {
		if isIdempotentReplay(err) {
			// écrit puis crash avant journal : déjà appliqué, pas de doublon
			return SyncOpResult{OperationID: op.OperationID, Status: "duplicate",
				Message: "Opération déjà appliquée (aucun doublon créé)."}
		}
		res.ErrorCode = businessCode(err)
		res.Message = err.Error()
		return res
	}
	return SyncOpResult{OperationID: op.OperationID, Status: "accepted",
		Entity:         map[string]any{"order": created},
		OfficialTicket: created.TicketNumber}
}

func (s *SyncService) previewMapping(ctx context.Context, in PricingInput, settings *pressing.PressingSettings) (*PricingResult, error) {
	var client *pressing.Client
	if in.NewClient != nil {
		client = in.NewClient
	} else if in.ClientID != nil && *in.ClientID != "" {
		if c, err := s.clients.Get(ctx, *in.ClientID); err == nil && c != nil && !c.Archived {
			client = c
		}
	}
	var zone *pressing.DeliveryZone
	if in.DeliveryZoneID != nil && *in.DeliveryZoneID != "" {
		zones, err := s.logistics.Zones(ctx)
		if err == nil {
			for _, z := range zones {
				if z.ID == *in.DeliveryZoneID {
					zone = z
				}
			}
		}
	}
	catalog, err := s.catalogSvc.List(ctx, false)
	if err != nil {
		return nil, err
	}
	lookup := func(id string) *pressing.CatalogItem {
		for _, c := range catalog {
			if c.ID == id {
				return c
			}
		}
		return nil
	}
	return RecalculateOrder(in, settings, client, zone, lookup)
}

// pricingDrift : vrai si un prix catalogue ou le total vu hors ligne diffère
// du recalcul serveur (déclenche un conflit exploitable, jamais un recalcul
// silencieux).
func pricingDrift(p syncOrderPayload, res *PricingResult) bool {
	for i, it := range res.Order.Items {
		if i >= len(p.Items) {
			break
		}
		if p.Items[i].CatalogItemID != nil && p.Items[i].UnitPriceFCFA != 0 &&
			p.Items[i].UnitPriceFCFA != it.UnitPriceFCFA {
			return true
		}
	}
	if p.SeenTotalFCFA != 0 && p.SeenTotalFCFA != res.Order.TotalFCFA {
		return true
	}
	return false
}

func (s *SyncService) pricingInputOf(p syncOrderPayload) PricingInput {
	var notes *string
	if p.Notes != "" {
		notes = &p.Notes
	}
	return PricingInput{
		ClientID:              p.ClientID,
		NewClient:             p.NewClient,
		ClientName:            p.ClientName,
		ClientPhone:           p.ClientPhone,
		Commune:               p.Commune,
		RackSlot:              p.RackSlot,
		Items:                 p.Items,
		DeliveryZoneID:        p.DeliveryZoneID,
		DiscountFCFA:          p.DiscountFCFA,
		UsePrepaid:            p.UsePrepaid,
		PrepaidAmountFCFA:     p.PrepaidAmountFCFA,
		LoyaltyPointsRedeemed: p.LoyaltyPointsRedeemed,
		InitialPaymentMethod:  p.InitialPaymentMethod,
		InitialCashPaidFCFA:   p.InitialCashPaidFCFA,
		DropOffDate:           p.DropOffDate,
		DueDate:               p.DueDate,
		Notes:                 notes,
	}
}

// --- order.payment : dédoublonné par clé d'idempotence sync + overpay rejeté ---

func (s *SyncService) applyOrderPayment(ctx context.Context, deviceID string, op SyncOperation) SyncOpResult {
	res := SyncOpResult{OperationID: op.OperationID, Status: "rejected"}
	var p syncPaymentPayload
	if err := json.Unmarshal(op.Payload, &p); err != nil {
		res.ErrorCode = "invalid_payload"
		res.Message = "payload paiement illisible."
		return res
	}
	orderID := s.resolveRef(ctx, deviceID, p.OrderID)
	updated, err := s.orders.AddPayment(ctx, orderID, p.AmountFCFA, p.Method, syncIdemKey(deviceID, op.OperationID))
	if err != nil {
		if isIdempotentReplay(err) {
			return SyncOpResult{OperationID: op.OperationID, Status: "duplicate",
				Message: "Paiement déjà encaissé (aucun double encaissement)."}
		}
		res.ErrorCode = businessCode(err)
		res.Message = err.Error()
		return res
	}
	return SyncOpResult{OperationID: op.OperationID, Status: "accepted",
		Entity: map[string]any{"order": updated}}
}

// resolveRef : ID provisoire → ID officiel via le journal de sync.
func (s *SyncService) resolveRef(ctx context.Context, deviceID, ref string) string {
	if ref == "" {
		return ref
	}
	var official string
	err := s.pool.QueryRow(ctx, `SELECT result->'entity'->'order'->>'id' FROM sync_operations
		WHERE device_id=$1 AND operation_id=$2 AND status='accepted'`, deviceID, ref).Scan(&official)
	if err == nil && official != "" {
		return official
	}
	return ref // déjà un ID officiel (ou référence directe)
}

// --- expense.create : ID provisoire conservé comme ID réel ---

func (s *SyncService) applyExpenseCreate(ctx context.Context, op SyncOperation) SyncOpResult {
	res := SyncOpResult{OperationID: op.OperationID, Status: "rejected"}
	var e pressing.ExpenseRecord
	if err := json.Unmarshal(op.Payload, &e); err != nil {
		res.ErrorCode = "invalid_payload"
		res.Message = "payload dépense illisible."
		return res
	}
	if e.ID == "" {
		e.ID = op.OperationID
	}
	created, err := s.cashbook.CreateExpense(ctx, &e)
	if err != nil {
		res.ErrorCode = businessCode(err)
		res.Message = err.Error()
		return res
	}
	return SyncOpResult{OperationID: op.OperationID, Status: "accepted",
		Entity: map[string]any{"expense": created}}
}

// --- inventory.movement : mêmes validations que l'en ligne (stock, dépense auto) ---

func (s *SyncService) applyInventoryMovement(ctx context.Context, deviceID string, op SyncOperation) SyncOpResult {
	res := SyncOpResult{OperationID: op.OperationID, Status: "rejected"}
	var in struct {
		ItemID        string                         `json:"itemId"`
		Type          pressing.InventoryMovementType `json:"type"`
		Quantity      float64                        `json:"quantity"`
		UnitCostFCFA  *int64                         `json:"unitCostFCFA"`
		Reason        string                         `json:"reason"`
		RecordExpense bool                           `json:"recordExpense"`
		PaymentMethod pressing.PaymentMethod         `json:"paymentMethod"`
	}
	if err := json.Unmarshal(op.Payload, &in); err != nil {
		res.ErrorCode = "invalid_payload"
		res.Message = "payload mouvement illisible."
		return res
	}
	mIn := MovementIn{Type: in.Type, Quantity: in.Quantity, UnitCostFCFA: in.UnitCostFCFA,
		Reason: in.Reason, RecordExpense: in.RecordExpense, PaymentMethod: in.PaymentMethod,
		IdempotencyKey: syncIdemKey(deviceID, op.OperationID)}
	item, err := s.inventory.Movement(ctx, in.ItemID, mIn, s.expenses)
	if err != nil {
		if isIdempotentReplay(err) {
			return SyncOpResult{OperationID: op.OperationID, Status: "duplicate",
				Message: "Mouvement déjà appliqué."}
		}
		res.ErrorCode = businessCode(err)
		res.Message = err.Error()
		return res
	}
	return SyncOpResult{OperationID: op.OperationID, Status: "accepted",
		Entity: map[string]any{"item": item}}
}

// --- logistics.save : références provisoires résolues via le journal ---

func (s *SyncService) applyLogisticsSave(ctx context.Context, op SyncOperation) SyncOpResult {
	res := SyncOpResult{OperationID: op.OperationID, Status: "rejected"}
	var t pressing.LogisticsTask
	if err := json.Unmarshal(op.Payload, &t); err != nil {
		res.ErrorCode = "invalid_payload"
		res.Message = "payload logistique illisible."
		return res
	}
	if t.ID == "" {
		t.ID = op.OperationID
	}
	saved, err := s.logistics.Save(ctx, &t)
	if err != nil {
		res.ErrorCode = businessCode(err)
		res.Message = err.Error()
		return res
	}
	return SyncOpResult{OperationID: op.OperationID, Status: "accepted",
		Entity: map[string]any{"task": saved}}
}

func isIdempotentReplay(err error) bool { return err == ErrIdempotentReplay }

// businessCode : catégorie d'erreur → code stable côté terminal.
func businessCode(err error) string {
	switch {
	case err == ErrInvalidAmount, err == ErrInvalidQuantity:
		return "invalid_amount"
	case err == ErrOverpayment:
		return "overpayment"
	case err == ErrValidation:
		return "validation"
	case IsBusinessError(err):
		return "business_rule"
	default:
		if strings.Contains(err.Error(), "introuvable") {
			return "not_found"
		}
		return "internal"
	}
}

// ---------- Pull ----------

type SyncChange struct {
	Entity   string         `json:"entity"`
	EntityID string         `json:"entity_id"`
	Op       string         `json:"op"`
	Data     map[string]any `json:"data"`
	Revision int64          `json:"revision"`
}

type SyncPullOut struct {
	SinceRevision int64        `json:"sinceRevision"`
	Cursor        int64        `json:"cursor"`
	HasMore       bool         `json:"hasMore"`
	Changes       []SyncChange `json:"changes"`
}

// Pull : changements incrémentaux par révision (change_seq), camelCase,
// pagination stricte — jamais de snapshot complet.
func (s *SyncService) Pull(ctx context.Context, deviceID string, since int64, limit int) (*SyncPullOut, error) {
	if limit <= 0 || limit > 2000 {
		limit = 500
	}
	const q = `
	SELECT revision, entity, entity_id, data FROM (
	  SELECT revision, 'settings' AS entity, id::text AS entity_id, to_jsonb(t) AS data FROM (
	    SELECT id, shop_name AS "shopName", tagline, commune, address, phone,
	      whatsapp_phone AS "whatsappPhone", rccm,
	      ticket_footer_note AS "ticketFooterNote", next_ticket_sequence AS "nextTicketSequence",
	      activity_scope AS "activityScope", blanchisserie_config AS "blanchisserieConfig",
	      pressing_config AS "pressingConfig", loyalty_config AS "loyaltyConfig",
	      onboarding_completed AS "onboardingCompleted", revision
	    FROM shop_settings WHERE revision > $1) t
	  UNION ALL
	  SELECT revision, 'catalog', id::text, to_jsonb(t) FROM (
	    SELECT id, name, category, default_mode AS "defaultMode", price_fcfa AS "priceFCFA", unit,
	      active, image_url AS "imageUrl", turnaround_days AS "turnaroundDays",
	      care_note AS "careNote", revision FROM catalog_items WHERE revision > $1) t
	  UNION ALL
	  SELECT revision, 'clients', id::text, to_jsonb(t) FROM (
	    SELECT c.id, c.full_name AS "fullName", c.phone, c.commune,
	      c.address_note AS "addressNote", c.created_at AS "createdAt",
	      c.loyalty_points AS "loyaltyPoints", c.prepaid_balance_fcfa AS "prepaidBalanceFCFA",
	      c.subscription_label AS "subscriptionLabel", c.subscription_expires_at AS "subscriptionExpiresAt",
	      (c.archived_at IS NOT NULL) AS "archived", c.revision,
	      COALESCE((SELECT json_agg(x ORDER BY x."date" DESC)
	        FROM (SELECT id, entry_date AS "date", type, amount_fcfa AS "amountFCFA", method, note
	          FROM client_wallet_entries w WHERE w.client_id = c.id) x), '[]'::json) AS "walletHistory"
	    FROM clients c WHERE c.revision > $1) t
	  UNION ALL
	  SELECT revision, 'orders', id::text, to_jsonb(t) FROM (
	    SELECT o.id, o.ticket_number AS "ticketNumber", o.client_id AS "clientId",
	      o.client_name AS "clientName", o.client_phone AS "clientPhone", o.commune,
	      o.rack_slot AS "rackSlot", o.subtotal_fcfa AS "subtotalFCFA",
	      o.express_fee_fcfa AS "expressFeeFCFA", o.delivery_fee_fcfa AS "deliveryFeeFCFA",
	      o.discount_fcfa AS "discountFCFA", o.prepaid_used_fcfa AS "prepaidUsedFCFA",
	      o.loyalty_points_earned AS "loyaltyPointsEarned", o.loyalty_points_redeemed AS "loyaltyPointsRedeemed",
	      o.total_fcfa AS "totalFCFA", o.paid_fcfa AS "paidFCFA", o.status,
	      o.drop_off_date AS "dropOffDate", o.due_date AS "dueDate", o.delivered_at AS "deliveredAt",
	      o.notes, o.voided_at AS "voidedAt", o.void_reason AS "voidReason",
	      o.is_express AS "isExpress", o.created_at AS "createdAt", o.updated_at AS "updatedAt", o.revision,
	      COALESCE((SELECT json_agg(x ORDER BY x.id)
	        FROM (SELECT id, catalog_item_id AS "catalogItemId", name, mode, quantity, unit,
	          unit_price_fcfa AS "unitPriceFCFA", line_total_fcfa AS "lineTotalFCFA", note,
	          activity_type AS "activityType", pricing_basis AS "pricingBasis",
	          pieces_per_unit AS "piecesPerUnit", weight_kg AS "weightKg", is_express AS "isExpress",
	          express_fee_fcfa AS "expressFeeFCFA", express_due_date AS "expressDueDate"
	          FROM order_items i WHERE i.order_id = o.id ORDER BY id) x), '[]'::json) AS "items",
	      COALESCE((SELECT json_agg(y ORDER BY y."capturedAt")
	        FROM (SELECT id, caption, item_name AS "itemName", captured_at AS "capturedAt",
	          '/api/v1/orders/' || o.id || '/photos/' || id AS "url"
	          FROM order_claim_photos p WHERE p.order_id = o.id) y), '[]'::json) AS "claimPhotos"
	    FROM orders o WHERE o.revision > $1) t
	  UNION ALL
	  SELECT revision, 'payments', id::text, to_jsonb(t) FROM (
	    SELECT id, order_id AS "orderId", ticket_number AS "ticketNumber", client_name AS "clientName",
	      amount_fcfa AS "amountFCFA", method, paid_at AS "paidAt", type, kind, revision
	    FROM payments WHERE revision > $1) t
	  UNION ALL
	  SELECT revision, 'expenses', id::text, to_jsonb(t) FROM (
	    SELECT id, label, category, amount_fcfa AS "amountFCFA", method, expense_date AS "date", note,
	      created_at AS "createdAt", revision FROM expenses WHERE revision > $1 AND deleted_at IS NULL) t
	  UNION ALL
	  SELECT revision, 'zones', id::text, to_jsonb(t) FROM (
	    SELECT id, commune, fee_fcfa AS "feeFCFA", pickup_fee_fcfa AS "pickupFeeFCFA", active, revision
	    FROM delivery_zones WHERE revision > $1) t
	  UNION ALL
	  SELECT revision, 'logistics', id::text, to_jsonb(t) FROM (
	    SELECT id, type, status, client_id AS "clientId", client_name AS "clientName",
	      client_phone AS "clientPhone", commune, address_detail AS "addressDetail",
	      order_id AS "orderId", ticket_number AS "ticketNumber", scheduled_date AS "scheduledDate",
	      time_slot AS "timeSlot", courier_name AS "courierName", courier_phone AS "courierPhone",
	      estimated_pieces AS "estimatedPieces", fee_fcfa AS "feeFCFA", notes,
	      created_at AS "createdAt", updated_at AS "updatedAt", revision
	    FROM logistics_tasks WHERE revision > $1) t
	  UNION ALL
	  SELECT revision, 'inventory', id::text, to_jsonb(t) FROM (
	    SELECT id, name, sku, category, activity_scope AS "activityScope", unit, quantity,
	      min_threshold AS "minThreshold", unit_cost_fcfa AS "unitCostFCFA", supplier, notes,
	      (archived_at IS NOT NULL) AS "archived", updated_at AS "updatedAt", revision
	    FROM inventory_items WHERE revision > $1) t
	  UNION ALL
	  SELECT revision, 'inventoryMovements', id::text, to_jsonb(t) FROM (
	    SELECT id, item_id AS "itemId", item_name AS "itemName", type, quantity_delta AS "quantityDelta",
	      previous_qty AS "previousQty", new_qty AS "newQty", unit, unit_cost_fcfa AS "unitCostFCFA",
	      total_cost_fcfa AS "totalCostFCFA", reason, created_at AS "createdAt", revision
	    FROM inventory_movements WHERE revision > $1) t
	) u
	WHERE data IS NOT NULL
	ORDER BY revision
	LIMIT $2`
	rows, err := s.pool.Query(ctx, q, since, limit+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &SyncPullOut{SinceRevision: since, Changes: []SyncChange{}}
	for rows.Next() {
		var c SyncChange
		if err := rows.Scan(&c.Revision, &c.Entity, &c.EntityID, &c.Data); err != nil {
			return nil, err
		}
		c.Op = "upsert"
		out.Changes = append(out.Changes, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out.Changes) > limit {
		out.HasMore = true
		out.Changes = out.Changes[:limit]
		out.Cursor = out.Changes[len(out.Changes)-1].Revision
	} else {
		if err := s.pool.QueryRow(ctx, `SELECT last_value FROM change_seq`).Scan(&out.Cursor); err != nil {
			return nil, err
		}
	}
	if deviceID != "" {
		_, _ = s.pool.Exec(ctx, `UPDATE devices SET last_pull_revision=$2, last_seen_at=now() WHERE device_id=$1`, deviceID, out.Cursor)
	}
	return out, nil
}

// Status : état de synchronisation (curseur serveur + appareil).
func (s *SyncService) Status(ctx context.Context, deviceID string) (map[string]any, error) {
	var cursor int64
	if err := s.pool.QueryRow(ctx, `SELECT last_value FROM change_seq`).Scan(&cursor); err != nil {
		return nil, err
	}
	out := map[string]any{
		"serverTime": time.Now().UTC().Format(time.RFC3339),
		"cursor":     cursor,
	}
	if deviceID != "" {
		var lastSeen *time.Time
		var lastPull int64
		err := s.pool.QueryRow(ctx, `SELECT last_seen_at, last_pull_revision FROM devices WHERE device_id=$1`, deviceID).Scan(&lastSeen, &lastPull)
		if err == nil {
			dev := map[string]any{"deviceId": deviceID, "lastPullRevision": lastPull}
			if lastSeen != nil {
				dev["lastSeenAt"] = lastSeen.UTC().Format(time.RFC3339)
			}
			out["device"] = dev
		}
	}
	return out, nil
}
