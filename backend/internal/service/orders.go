package service

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/erwinsskoffi/press_backend/internal/domain/pressing"
	"github.com/erwinsskoffi/press_backend/internal/platform/dbtx"
	"github.com/erwinsskoffi/press_backend/internal/platform/ids"
)

// Repos requis par OrderService (interfaces fines, testables par fakes).
type OrderStore interface {
	Create(ctx context.Context, q dbtx.Querier, o *pressing.Order) error
	SetClaimPhotos(ctx context.Context, q dbtx.Querier, orderID string, photos []pressing.OrderClaimPhoto) error
	Get(ctx context.Context, q dbtx.Querier, id string) (*pressing.Order, error)
	List(ctx context.Context, q dbtx.Querier, f pressing.OrderFilter) ([]*pressing.Order, int, error)
	UpdateStatus(ctx context.Context, q dbtx.Querier, id string, status pressing.OrderStatus, markDelivered bool) error
	AddPaid(ctx context.Context, q dbtx.Querier, id string, amount int64) error
	Void(ctx context.Context, q dbtx.Querier, id, reason string) error
	ListPhotos(ctx context.Context, q dbtx.Querier, orderID string) ([]pressing.OrderClaimPhoto, error)
}

type PaymentStore interface {
	Create(ctx context.Context, q dbtx.Querier, p *pressing.PaymentRecord, idemKey string) error
	ListByOrder(ctx context.Context, q dbtx.Querier, orderID string) ([]*pressing.PaymentRecord, error)
	FindIdempotent(ctx context.Context, q dbtx.Querier, scope, key string) (bool, error)
	SaveIdempotency(ctx context.Context, q dbtx.Querier, scope, key string) error
}

type SettingsStore interface {
	Get(ctx context.Context, q dbtx.Querier) (*pressing.PressingSettings, error)
	Update(ctx context.Context, q dbtx.Querier, s *pressing.PressingSettings) error
	SyncTicketSequence(ctx context.Context, q dbtx.Querier, seq int64) error
}

type CatalogStore interface {
	List(ctx context.Context, q dbtx.Querier, activeOnly bool) ([]*pressing.CatalogItem, error)
	Get(ctx context.Context, q dbtx.Querier, id string) (*pressing.CatalogItem, error)
	Upsert(ctx context.Context, q dbtx.Querier, c *pressing.CatalogItem) error
	Deactivate(ctx context.Context, q dbtx.Querier, id string) error
}

type ClientStore interface {
	List(ctx context.Context, q dbtx.Querier, search string, limit, offset int) ([]*pressing.Client, int, error)
	Get(ctx context.Context, q dbtx.Querier, id string) (*pressing.Client, error)
	WalletHistory(ctx context.Context, q dbtx.Querier, clientID string, limit int) ([]pressing.ClientWalletEntry, error)
	Upsert(ctx context.Context, q dbtx.Querier, c *pressing.Client) error
	Archive(ctx context.Context, q dbtx.Querier, id string) error
	ApplyWalletDelta(ctx context.Context, q dbtx.Querier, clientID string, pointsDelta, prepaidDelta int64) error
	DebitPrepaid(ctx context.Context, q dbtx.Querier, clientID string, amount int64) error
	AddWalletEntry(ctx context.Context, q dbtx.Querier, clientID string, entry *pressing.ClientWalletEntry) error
}

type TicketStore interface {
	NextTicket(ctx context.Context, q dbtx.Querier, year int) (int64, string, error)
}

type ZoneStore interface {
	List(ctx context.Context, q dbtx.Querier) ([]*pressing.DeliveryZone, error)
	Get(ctx context.Context, q dbtx.Querier, id string) (*pressing.DeliveryZone, error)
	Upsert(ctx context.Context, q dbtx.Querier, z *pressing.DeliveryZone) error
	Delete(ctx context.Context, q dbtx.Querier, id string) error
}

type LogisticsStore interface {
	List(ctx context.Context, q dbtx.Querier, status, typ, date string) ([]*pressing.LogisticsTask, error)
	Get(ctx context.Context, q dbtx.Querier, id string) (*pressing.LogisticsTask, error)
	Upsert(ctx context.Context, q dbtx.Querier, t *pressing.LogisticsTask) error
	UpdateStatus(ctx context.Context, q dbtx.Querier, id string, status pressing.LogisticsStatus) (*pressing.LogisticsTask, error)
	Delete(ctx context.Context, q dbtx.Querier, id string) error
}

type InventoryStore interface {
	List(ctx context.Context, q dbtx.Querier) ([]*pressing.InventoryItem, error)
	Get(ctx context.Context, q dbtx.Querier, id string) (*pressing.InventoryItem, error)
	Upsert(ctx context.Context, q dbtx.Querier, i *pressing.InventoryItem) error
	Archive(ctx context.Context, q dbtx.Querier, id string) error
	LockForUpdate(ctx context.Context, q dbtx.Querier, id string) (*pressing.InventoryItem, error)
	SetQuantity(ctx context.Context, q dbtx.Querier, id string, qty float64, unitCost *int64) error
	AddMovement(ctx context.Context, q dbtx.Querier, m *pressing.InventoryMovement) error
	ListMovements(ctx context.Context, q dbtx.Querier, itemID string, limit int) ([]*pressing.InventoryMovement, error)
}

type ExpenseStore interface {
	List(ctx context.Context, q dbtx.Querier, from, to string, limit, offset int) ([]*pressing.ExpenseRecord, int, error)
	Get(ctx context.Context, q dbtx.Querier, id string) (*pressing.ExpenseRecord, error)
	Create(ctx context.Context, q dbtx.Querier, e *pressing.ExpenseRecord) error
	SoftDelete(ctx context.Context, q dbtx.Querier, id string) error
}

type ReportStore interface {
	ListPayments(ctx context.Context, q dbtx.Querier, from, to string, limit int) ([]*pressing.PaymentRecord, error)
}

// BusinessErrors : mapper d'erreurs métier → réponses.
func IsBusinessError(err error) bool {
	for _, target := range []error{
		ErrOverpayment, ErrInsufficientStock, ErrInsufficientPrepaid, ErrLoyaltyNotEligible,
		ErrInvalidTransition, ErrVoidedOrder, ErrCatalogItemMissing, ErrWeightOfferMissing,
		ErrBlanchPackMissing, ErrZoneMissing, ErrInvalidAmount, ErrInvalidQuantity,
	} {
		if errors.Is(err, target) {
			return true
		}
	}
	return false
}

// Clock injectable pour les tests.
type Clock func() time.Time

// OrderService : création transactionnelle, statuts, paiements, annulation.
type OrderService struct {
	orders     OrderStore
	catalog    CatalogStore
	payments   PaymentStore
	settings   SettingsStore
	clients    ClientStore
	tickets    TicketStore
	zones      ZoneStore
	txm        TxRunner
	audit      AuditLogger
	now        Clock
	storageDir string
}

type TxRunner interface {
	WithTx(ctx context.Context, fn func(ctx context.Context, q dbtx.Querier) error) error
}

func NewOrderService(orders OrderStore, catalog CatalogStore, payments PaymentStore, settings SettingsStore,
	clients ClientStore, tickets TicketStore, zones ZoneStore, txm TxRunner, audit AuditLogger) *OrderService {
	return &OrderService{
		orders: orders, catalog: catalog, payments: payments, settings: settings, clients: clients,
		tickets: tickets, zones: zones, txm: txm, audit: audit, now: time.Now,
	}
}

// SetStorageDir : racine du stockage privé des photos (stratégie Prompt 08 —
// jamais de data URL en base, fichiers hors racine HTTP).
func (s *OrderService) SetStorageDir(dir string) { s.storageDir = dir }

// photoDataRE : data URL image/jpeg|png|webp.
var photoDataRE = regexp.MustCompile(`^data:image/(jpeg|png|webp);base64,`)

// materializePhotos : décode les data URLs en fichiers privés, renvoie les
// photos avec URL = chemin de stockage (le repo écrit storage_path tel quel).
func (s *OrderService) materializePhotos(orderID string, photos []pressing.OrderClaimPhoto) ([]pressing.OrderClaimPhoto, error) {
	if len(photos) == 0 || s.storageDir == "" {
		return photos, nil
	}
	out := make([]pressing.OrderClaimPhoto, 0, len(photos))
	for _, p := range photos {
		if m := photoDataRE.FindStringSubmatch(p.URL); m != nil {
			raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(p.URL, m[0]))
			if err != nil {
				return nil, fmt.Errorf("photo %s: base64 invalide: %w", p.ID, err)
			}
			if len(raw) == 0 {
				return nil, fmt.Errorf("photo %s: vide", p.ID)
			}
			if len(raw) > 5<<20 {
				return nil, fmt.Errorf("photo %s: trop volumineuse (> 5 Mo)", p.ID)
			}
			rel := filepath.Join("photos", orderID, p.ID+"."+m[1])
			abs := filepath.Join(s.storageDir, rel)
			if err := os.MkdirAll(filepath.Dir(abs), 0o750); err != nil {
				return nil, fmt.Errorf("photo %s: %w", p.ID, err)
			}
			if err := os.WriteFile(abs, raw, 0o640); err != nil {
				return nil, fmt.Errorf("photo %s: %w", p.ID, err)
			}
			p.URL = "/" + rel
		}
		out = append(out, p)
	}
	return out, nil
}

// Create : transaction unique (ADR A21, corrige C4/C3/E5).
// Ordre : recalcul → verrou compteur ticket → commande+items → paiement cash →
// prépayé + wallet + fidélité → sync settings.nextTicketSequence → audit.
func (s *OrderService) Create(ctx context.Context, in PricingInput, photos []pressing.OrderClaimPhoto, idemKey string) (*pressing.Order, error) {
	var created *pressing.Order
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		if idemKey != "" {
			exists, err := s.payments.FindIdempotent(ctx, q, "order.create", idemKey)
			if err != nil {
				return err
			}
			if exists {
				return ErrIdempotentReplay
			}
		}
		settings, err := s.settings.Get(ctx, q)
		if err != nil {
			return err
		}

		var client *pressing.Client
		var clientID *string
		if in.ClientID != nil && *in.ClientID != "" {
			client, err = s.clients.Get(ctx, q, *in.ClientID)
			if err != nil {
				return err
			}
			if client == nil || client.Archived {
				return fmt.Errorf("client introuvable")
			}
			clientID = &client.ID
			in.ClientName = client.FullName
			in.ClientPhone = client.Phone
			in.Commune = client.Commune
		} else if in.NewClient != nil {
			nc := *in.NewClient
			if nc.ID == "" {
				nc.ID = ids.NewUUID()
			}
			nc.LoyaltyPoints = 0
			nc.PrepaidBalanceFCFA = 0
			nc.CreatedAt = s.now().UTC().Format(time.RFC3339)
			if err := s.clients.Upsert(ctx, q, &nc); err != nil {
				return err
			}
			client = &nc
			clientID = &nc.ID
		}

		var zone *pressing.DeliveryZone
		if in.DeliveryZoneID != nil && *in.DeliveryZoneID != "" {
			zone, err = s.zones.Get(ctx, q, *in.DeliveryZoneID)
			if err != nil {
				return err
			}
		}

		in.ClientID = clientID
		res, err := RecalculateOrder(in, settings, client, zone, func(id string) *pressing.CatalogItem {
			c, _ := s.catalog.Get(ctx, q, id)
			return c
		})
		if err != nil {
			return err
		}
		o := res.Order

		// date de dépôt : défaut aujourd'hui (parité frontend)
		if res.Order.DropOffDate == "" {
			res.Order.DropOffDate = s.now().Format("2006-01-02")
		}

		// ticket officiel : compteur verrouillé dans la même transaction
		year := s.now().Year()
		seq, ticket, err := s.tickets.NextTicket(ctx, q, year)
		if err != nil {
			return err
		}
		o.TicketSeq = seq
		o.TicketNumber = ticket
		nowISO := s.now().UTC().Format(time.RFC3339)
		o.ID = ids.NewUUID()
		o.CreatedAt = nowISO
		o.UpdatedAt = nowISO

		// 1. commande (paid_fcfa=0, mis à jour après les paiements)
		o.PaidFCFA = 0
		if err := s.orders.Create(ctx, q, o); err != nil {
			return err
		}

		// 2. paiement cash initial : acompte (parité montant payé au dépôt) ou solde complet
		if res.CashPaidFCFA > 0 {
			pType := "acompte"
			if res.ActualPrepaidUsedFCFA+res.CashPaidFCFA >= o.TotalFCFA {
				pType = "integral"
			}
			pay := &pressing.PaymentRecord{
				ID:           ids.NewUUID(),
				OrderID:      &o.ID,
				TicketNumber: o.TicketNumber,
				ClientName:   o.ClientName,
				AmountFCFA:   res.CashPaidFCFA,
				Method:       in.InitialPaymentMethod,
				PaidAt:       nowISO,
				Type:         pType,
				Kind:         "order",
			}
			if err := s.payments.Create(ctx, q, pay, ""); err != nil {
				return err
			}
		}
		if len(photos) > 0 {
			photos, perr := s.materializePhotos(o.ID, photos)
			if perr != nil {
				return perr
			}
			if err := s.orders.SetClaimPhotos(ctx, q, o.ID, photos); err != nil {
				return err
			}
			// URL publique authentifiée (jamais le chemin de stockage privé)
			for i := range photos {
				photos[i].URL = "/api/v1/orders/" + o.ID + "/photos/" + photos[i].ID
			}
			o.ClaimPhotos = photos
		}

		// client : prépayé débité + wallet + points (même transaction)
		if client != nil {
			if res.ActualPrepaidUsedFCFA > 0 {
				if err := s.clients.DebitPrepaid(ctx, q, client.ID, res.ActualPrepaidUsedFCFA); err != nil {
					return err
				}
				entry := &pressing.ClientWalletEntry{
					ID:         ids.NewUUID(),
					Date:       nowISO,
					Type:       "utilisation",
					AmountFCFA: -res.ActualPrepaidUsedFCFA,
					Note:       strPtr("Règlement ticket " + o.TicketNumber),
				}
				if err := s.clients.AddWalletEntry(ctx, q, client.ID, entry); err != nil {
					return err
				}
			}
			pointsDelta := o.LoyaltyPointsEarned - o.LoyaltyPointsRedeemed
			if pointsDelta != 0 {
				if err := s.clients.ApplyWalletDelta(ctx, q, client.ID, pointsDelta, 0); err != nil {
					return err
				}
			}
		}

		// 3. paid_fcfa = prépayé consommé + cash réellement encaissé (clampé par LEAST(total))
		if err := s.orders.AddPaid(ctx, q, o.ID, res.ActualPrepaidUsedFCFA+res.CashPaidFCFA); err != nil {
			return err
		}
		o.PaidFCFA = res.ActualPrepaidUsedFCFA + res.CashPaidFCFA

		if err := s.settings.SyncTicketSequence(ctx, q, seq+1); err != nil {
			return err
		}
		if idemKey != "" {
			if err := s.payments.SaveIdempotency(ctx, q, "order.create", idemKey); err != nil {
				return err
			}
		}
		created = o
		return nil
	})
	if err != nil {
		return nil, err
	}
	_ = s.audit.Log(ctx, "operator", "order.create", "orders", created.ID,
		map[string]any{"ticket": created.TicketNumber, "total": created.TotalFCFA})
	return created, nil
}

// ErrIdempotentReplay : la requête a déjà été traitée (le frontend doit re-lire l'état).
var ErrIdempotentReplay = fmt.Errorf("opération déjà appliquée (idempotence)")

// AdvanceStatus : transition linéaire recu→lavage→repassage→pret→livre.
func (s *OrderService) AdvanceStatus(ctx context.Context, id string, target string) (*pressing.Order, error) {
	var updated *pressing.Order
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		o, err := s.orders.Get(ctx, q, id)
		if err != nil {
			return err
		}
		if o == nil {
			return fmt.Errorf("commande introuvable")
		}
		if o.VoidedAt != nil {
			return ErrVoidedOrder
		}
		// transitions linéaires uniquement (parité frontend) :
		// cible explicite OU implicite doivent valoir NextStatus courant
		next := o.Status.NextStatus()
		if next == nil {
			return ErrInvalidTransition
		}
		targetStatus := *next
		if target != "" {
			if !pressing.ValidStatus(target) || pressing.OrderStatus(target) != targetStatus {
				return ErrInvalidTransition
			}
		}
		markDelivered := targetStatus == pressing.StatusLivre
		if err := s.orders.UpdateStatus(ctx, q, id, targetStatus, markDelivered); err != nil {
			return err
		}
		updated, err = s.orders.Get(ctx, q, id)
		return err
	})
	if err != nil {
		return nil, err
	}
	_ = s.audit.Log(ctx, "operator", "order.status", "orders", id, map[string]any{"status": updated.Status})
	return updated, nil
}

// AddPayment : encaissement complémentaire — surpaiement REJETÉE (ADR A15).
func (s *OrderService) AddPayment(ctx context.Context, orderID string, amount int64, method pressing.PaymentMethod, idemKey string) (*pressing.Order, error) {
	if amount <= 0 {
		return nil, ErrInvalidAmount
	}
	if !pressing.ValidPaymentMethod(string(method)) {
		return nil, ErrInvalidAmount
	}
	var updated *pressing.Order
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		if idemKey != "" {
			exists, err := s.payments.FindIdempotent(ctx, q, "order.payment", idemKey)
			if err != nil {
				return err
			}
			if exists {
				return ErrIdempotentReplay
			}
		}
		o, err := s.orders.Get(ctx, q, orderID)
		if err != nil {
			return err
		}
		if o == nil {
			return fmt.Errorf("commande introuvable")
		}
		if o.VoidedAt != nil {
			return ErrVoidedOrder
		}
		remaining := o.TotalFCFA - o.PaidFCFA
		if amount > remaining {
			return ErrOverpayment
		}
		nowISO := s.now().UTC().Format(time.RFC3339)
		newPaid := o.PaidFCFA + amount
		pType := "acompte"
		if newPaid >= o.TotalFCFA {
			pType = "solde"
		}
		pay := &pressing.PaymentRecord{
			ID:           ids.NewUUID(),
			OrderID:      &o.ID,
			TicketNumber: o.TicketNumber,
			ClientName:   o.ClientName,
			AmountFCFA:   amount,
			Method:       method,
			PaidAt:       nowISO,
			Type:         pType,
			Kind:         "order",
		}
		if err := s.payments.Create(ctx, q, pay, idemKey); err != nil {
			return err
		}
		if err := s.orders.AddPaid(ctx, q, orderID, amount); err != nil {
			return err
		}
		if idemKey != "" {
			if err := s.payments.SaveIdempotency(ctx, q, "order.payment", idemKey); err != nil {
				return err
			}
		}
		updated, err = s.orders.Get(ctx, q, orderID)
		return err
	})
	if err != nil {
		return nil, err
	}
	_ = s.audit.Log(ctx, "operator", "order.payment", "orders", orderID, map[string]any{"amount": amount})
	return updated, nil
}

// Void : annulation non destructive (ADR A14).
func (s *OrderService) Void(ctx context.Context, orderID, reason string) (*pressing.Order, error) {
	if reason == "" {
		return nil, ErrInvalidAmount
	}
	var updated *pressing.Order
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		if err := s.orders.Void(ctx, q, orderID, reason); err != nil {
			return err
		}
		var err error
		updated, err = s.orders.Get(ctx, q, orderID)
		return err
	})
	if err != nil {
		return nil, err
	}
	_ = s.audit.Log(ctx, "operator", "order.void", "orders", orderID, map[string]any{"reason": reason})
	return updated, nil
}

// Get / ListWithPayments.
func (s *OrderService) Get(ctx context.Context, id string) (*pressing.Order, error) {
	var o *pressing.Order
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		var err error
		o, err = s.orders.Get(ctx, q, id)
		return err
	})
	return o, err
}

func (s *OrderService) PaymentsOf(ctx context.Context, orderID string) ([]*pressing.PaymentRecord, error) {
	var out []*pressing.PaymentRecord
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		var err error
		out, err = s.payments.ListByOrder(ctx, q, orderID)
		return err
	})
	return out, err
}

func (s *OrderService) List(ctx context.Context, f pressing.OrderFilter) ([]*pressing.Order, int, error) {
	var out []*pressing.Order
	var total int
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		var err error
		out, total, err = s.orders.List(ctx, q, f)
		return err
	})
	return out, total, err
}

// PhotoBytes : contenu binaire d'une photo de réserve (fichier privé, via
// storage_path ; jamais servi depuis la racine HTTP).
func (s *OrderService) PhotoBytes(ctx context.Context, orderID, photoID string) ([]byte, error) {
	var path string
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		return q.QueryRow(ctx, `SELECT storage_path FROM order_claim_photos WHERE id=$1 AND order_id=$2`, photoID, orderID).Scan(&path)
	})
	if err != nil {
		return nil, err
	}
	if s.storageDir == "" {
		return nil, fmt.Errorf("stockage photos non configuré")
	}
	clean := filepath.Clean(strings.TrimPrefix(path, "/"))
	abs := filepath.Join(s.storageDir, clean)
	if !strings.HasPrefix(abs, filepath.Clean(s.storageDir)+string(os.PathSeparator)) {
		return nil, fmt.Errorf("chemin photo invalide")
	}
	return os.ReadFile(abs)
}
