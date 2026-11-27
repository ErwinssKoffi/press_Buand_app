package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/erwinsskoffi/press_backend/internal/domain/pressing"
	"github.com/erwinsskoffi/press_backend/internal/platform/dbtx"
	"github.com/erwinsskoffi/press_backend/internal/platform/ids"
)

// SettingsRepo lit/écrit les paramètres (singleton).
type SettingsRepo struct{}

func (SettingsRepo) Get(ctx context.Context, q dbtx.Querier) (*pressing.PressingSettings, error) {
	row := q.QueryRow(ctx, `
		SELECT shop_name, tagline, commune, address, phone, whatsapp_phone, rccm,
		       ticket_footer_note, next_ticket_sequence, activity_scope,
		       blanchisserie_config, pressing_config, loyalty_config, onboarding_completed
		FROM shop_settings WHERE id = 1`)
	s := &pressing.PressingSettings{}
	var bc, pc, lc []byte
	if err := row.Scan(&s.ShopName, &s.Tagline, &s.Commune, &s.Address, &s.Phone, &s.WhatsappPhone,
		&s.Rccm, &s.TicketFooterNote, &s.NextTicketSequence, &s.ActivityScope,
		&bc, &pc, &lc, &s.OnboardingCompleted); err != nil {
		return nil, err
	}
	s.ID = "default"
	if err := json.Unmarshal(bc, &s.BlanchisserieConfig); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(pc, &s.PressingConfig); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(lc, &s.LoyaltyConfig); err != nil {
		return nil, err
	}
	return s, nil
}

func (SettingsRepo) Update(ctx context.Context, q dbtx.Querier, s *pressing.PressingSettings) error {
	bc, err := json.Marshal(s.BlanchisserieConfig)
	if err != nil {
		return err
	}
	pc, err := json.Marshal(s.PressingConfig)
	if err != nil {
		return err
	}
	lc, err := json.Marshal(s.LoyaltyConfig)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `
		UPDATE shop_settings SET
		  shop_name=$1, tagline=$2, commune=$3, address=$4, phone=$5, whatsapp_phone=$6, rccm=$7,
		  ticket_footer_note=$8, activity_scope=$9,
		  blanchisserie_config=$10, pressing_config=$11, loyalty_config=$12,
		  onboarding_completed=$13, revision=nextval('change_seq'), updated_at=now()
		WHERE id=1`,
		s.ShopName, s.Tagline, s.Commune, s.Address, s.Phone, s.WhatsappPhone, s.Rccm,
		s.TicketFooterNote, s.ActivityScope, bc, pc, lc, s.OnboardingCompleted)
	return err
}

func (r SettingsRepo) SyncTicketSequence(ctx context.Context, q dbtx.Querier, seq int64) error {
	_, err := q.Exec(ctx, `UPDATE shop_settings SET next_ticket_sequence=$1 WHERE id=1`, seq)
	return err
}

// CatalogRepo.
type CatalogRepo struct{}

const catalogCols = `id, name, category, default_mode, price_fcfa, unit, active, image_url, turnaround_days, care_note, created_at, updated_at`

func scanCatalogItem(row pgx.Row) (*pressing.CatalogItem, error) {
	c := &pressing.CatalogItem{}
	var createdAt, updatedAt time.Time
	if err := row.Scan(&c.ID, &c.Name, &c.Category, &c.DefaultMode, &c.PriceFCFA, &c.Unit,
		&c.Active, &c.ImageURL, &c.TurnaroundDays, &c.CareNote, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	c.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	c.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return c, nil
}

func (CatalogRepo) List(ctx context.Context, q dbtx.Querier, activeOnly bool) ([]*pressing.CatalogItem, error) {
	sql := "SELECT " + catalogCols + " FROM catalog_items"
	if activeOnly {
		sql += " WHERE active"
	}
	sql += " ORDER BY category, name"
	rows, err := q.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*pressing.CatalogItem{}
	for rows.Next() {
		c, err := scanCatalogItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r CatalogRepo) Get(ctx context.Context, q dbtx.Querier, id string) (*pressing.CatalogItem, error) {
	return scanCatalogItem(q.QueryRow(ctx, "SELECT "+catalogCols+" FROM catalog_items WHERE id=$1", id))
}

func (r CatalogRepo) Upsert(ctx context.Context, q dbtx.Querier, c *pressing.CatalogItem) error {
	_, err := q.Exec(ctx, `
		INSERT INTO catalog_items (id, name, category, default_mode, price_fcfa, unit, active, image_url, turnaround_days, care_note)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (id) DO UPDATE SET
		  name=EXCLUDED.name, category=EXCLUDED.category, default_mode=EXCLUDED.default_mode,
		  price_fcfa=EXCLUDED.price_fcfa, unit=EXCLUDED.unit, active=EXCLUDED.active,
		  image_url=EXCLUDED.image_url, turnaround_days=EXCLUDED.turnaround_days,
		  care_note=EXCLUDED.care_note, revision=nextval('change_seq'), updated_at=now()`,
		c.ID, c.Name, c.Category, c.DefaultMode, c.PriceFCFA, c.Unit, c.Active,
		c.ImageURL, c.TurnaroundDays, c.CareNote)
	return err
}

func (r CatalogRepo) Deactivate(ctx context.Context, q dbtx.Querier, id string) error {
	_, err := q.Exec(ctx, `UPDATE catalog_items SET active=false, revision=nextval('change_seq'), updated_at=now() WHERE id=$1`, id)
	return err
}

// ClientRepo.
type ClientRepo struct{}

const clientCols = `id, full_name, phone, commune, address_note, loyalty_points, prepaid_balance_fcfa, subscription_label, subscription_expires_at, created_at, archived_at`

func scanClient(row pgx.Row) (*pressing.Client, error) {
	c := &pressing.Client{}
	var createdAt time.Time
	var archivedAt *time.Time
	if err := row.Scan(&c.ID, &c.FullName, &c.Phone, &c.Commune, &c.AddressNote,
		&c.LoyaltyPoints, &c.PrepaidBalanceFCFA, &c.SubscriptionLabel, &c.SubscriptionExpiresAt,
		&createdAt, &archivedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	c.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	c.Archived = archivedAt != nil
	return c, nil
}

func (ClientRepo) List(ctx context.Context, q dbtx.Querier, search string, limit, offset int) ([]*pressing.Client, int, error) {
	where := " WHERE archived_at IS NULL"
	args := []any{}
	if search != "" {
		where += " AND (full_name ILIKE $1 OR phone ILIKE $1)"
		args = append(args, "%"+search+"%")
	}
	var total int
	if err := q.QueryRow(ctx, "SELECT count(*) FROM clients"+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	sql := "SELECT " + clientCols + " FROM clients" + where + fmt.Sprintf(" ORDER BY full_name LIMIT %d OFFSET %d", limit, offset)
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []*pressing.Client{}
	for rows.Next() {
		c, err := scanClient(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, c)
	}
	return out, total, rows.Err()
}

func (r ClientRepo) Get(ctx context.Context, q dbtx.Querier, id string) (*pressing.Client, error) {
	return scanClient(q.QueryRow(ctx, "SELECT "+clientCols+" FROM clients WHERE id=$1", id))
}

func (r ClientRepo) WalletHistory(ctx context.Context, q dbtx.Querier, clientID string, limit int) ([]pressing.ClientWalletEntry, error) {
	rows, err := q.Query(ctx, `
		SELECT id, entry_date, type, amount_fcfa, method, note
		FROM client_wallet_entries WHERE client_id=$1 ORDER BY entry_date DESC LIMIT $2`,
		clientID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []pressing.ClientWalletEntry{}
	for rows.Next() {
		e := pressing.ClientWalletEntry{}
		var d time.Time
		if err := rows.Scan(&e.ID, &d, &e.Type, &e.AmountFCFA, &e.Method, &e.Note); err != nil {
			return nil, err
		}
		e.Date = d.UTC().Format(time.RFC3339)
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r ClientRepo) Upsert(ctx context.Context, q dbtx.Querier, c *pressing.Client) error {
	_, err := q.Exec(ctx, `
		INSERT INTO clients (id, full_name, phone, commune, address_note, loyalty_points, prepaid_balance_fcfa, subscription_label, subscription_expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (id) DO UPDATE SET
		  full_name=EXCLUDED.full_name, phone=EXCLUDED.phone, commune=EXCLUDED.commune,
		  address_note=EXCLUDED.address_note, revision=nextval('change_seq'), updated_at=now()`,
		c.ID, c.FullName, c.Phone, c.Commune, c.AddressNote, c.LoyaltyPoints,
		c.PrepaidBalanceFCFA, c.SubscriptionLabel, c.SubscriptionExpiresAt)
	return err
}

func (r ClientRepo) Archive(ctx context.Context, q dbtx.Querier, id string) error {
	_, err := q.Exec(ctx, `UPDATE clients SET archived_at=now(), revision=nextval('change_seq'), updated_at=now() WHERE id=$1`, id)
	return err
}

func (r ClientRepo) ApplyWalletDelta(ctx context.Context, q dbtx.Querier, clientID string, pointsDelta int64, prepaidDelta int64) error {
	_, err := q.Exec(ctx,
		`UPDATE clients SET
		   loyalty_points = GREATEST(0, loyalty_points + $1),
		   prepaid_balance_fcfa = GREATEST(0, prepaid_balance_fcfa + $2),
		   revision = nextval('change_seq'), updated_at = now()
		 WHERE id=$3`, pointsDelta, prepaidDelta, clientID)
	return err
}

func (r ClientRepo) DebitPrepaid(ctx context.Context, q dbtx.Querier, clientID string, amount int64) error {
	tag, err := q.Exec(ctx,
		`UPDATE clients SET prepaid_balance_fcfa = prepaid_balance_fcfa - $1, revision=nextval('change_seq'), updated_at=now()
		 WHERE id=$2 AND prepaid_balance_fcfa >= $1`, amount, clientID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("solde prépayé insuffisant")
	}
	return nil
}

func (r ClientRepo) AddWalletEntry(ctx context.Context, q dbtx.Querier, clientID string, entry *pressing.ClientWalletEntry) error {
	_, err := q.Exec(ctx, `
		INSERT INTO client_wallet_entries (id, client_id, entry_date, type, amount_fcfa, method, note)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		entry.ID, clientID, entry.Date, entry.Type, entry.AmountFCFA, entry.Method, entry.Note)
	return err
}

// TicketRepo : compteur verrouillé (ADR A21).
type TicketRepo struct{}

func (TicketRepo) NextTicket(ctx context.Context, q dbtx.Querier, year int) (seq int64, ticket string, err error) {
	row := q.QueryRow(ctx, `
		INSERT INTO ticket_counters (year, last_seq) VALUES ($1, 1)
		ON CONFLICT (year) DO UPDATE SET last_seq = ticket_counters.last_seq + 1
		RETURNING last_seq`, year)
	if err = row.Scan(&seq); err != nil {
		return 0, "", err
	}
	return seq, fmt.Sprintf("EP-%d-%04d", year, seq), nil
}

// OrderRepo.
type OrderRepo struct{}

const orderCols = `id, ticket_number, ticket_seq, client_id, client_name, client_phone, commune, rack_slot,
	subtotal_fcfa, express_fee_fcfa, delivery_fee_fcfa, discount_fcfa, prepaid_used_fcfa,
	loyalty_points_earned, loyalty_points_redeemed, total_fcfa, paid_fcfa, status,
	drop_off_date, due_date, delivered_at, notes, is_express, voided_at, void_reason, created_at, updated_at`

func scanOrder(row pgx.Row) (*pressing.Order, error) {
	o := &pressing.Order{}
	var dropOff, due *time.Time
	var deliveredAt, voidedAt, createdAt, updatedAt *time.Time
	if err := row.Scan(&o.ID, &o.TicketNumber, &o.TicketSeq, &o.ClientID, &o.ClientName, &o.ClientPhone,
		&o.Commune, &o.RackSlot, &o.SubtotalFCFA, &o.ExpressFeeFCFA, &o.DeliveryFeeFCFA, &o.DiscountFCFA,
		&o.PrepaidUsedFCFA, &o.LoyaltyPointsEarned, &o.LoyaltyPointsRedeemed, &o.TotalFCFA, &o.PaidFCFA,
		&o.Status, &dropOff, &due, &deliveredAt, &o.Notes, &o.IsExpress,
		&voidedAt, &o.VoidReason, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if dropOff != nil {
		o.DropOffDate = dropOff.Format("2006-01-02")
	}
	if due != nil {
		s := due.Format("2006-01-02")
		o.DueDate = &s
	}
	o.DeliveredAt = formatTimePtr(deliveredAt)
	o.VoidedAt = formatTimePtr(voidedAt)
	o.CreatedAt = formatTime(createdAt)
	o.UpdatedAt = formatTime(updatedAt)
	return o, nil
}

func formatTime(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func formatTimePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := formatTime(t)
	return &s
}

func (r OrderRepo) Create(ctx context.Context, q dbtx.Querier, o *pressing.Order) error {
	_, err := q.Exec(ctx, `
		INSERT INTO orders (id, ticket_number, ticket_seq, client_id, client_name, client_phone, commune, rack_slot,
		  subtotal_fcfa, express_fee_fcfa, delivery_fee_fcfa, discount_fcfa, prepaid_used_fcfa,
		  loyalty_points_earned, loyalty_points_redeemed, total_fcfa, paid_fcfa, status,
		  drop_off_date, due_date, notes, is_express)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
		o.ID, o.TicketNumber, o.TicketSeq, o.ClientID, o.ClientName, o.ClientPhone, o.Commune, o.RackSlot,
		o.SubtotalFCFA, o.ExpressFeeFCFA, o.DeliveryFeeFCFA, o.DiscountFCFA, o.PrepaidUsedFCFA,
		o.LoyaltyPointsEarned, o.LoyaltyPointsRedeemed, o.TotalFCFA, o.PaidFCFA, o.Status,
		o.DropOffDate, o.DueDate, o.Notes, o.IsExpress)
	if err != nil {
		return err
	}
	for _, li := range o.Items {
		if err := r.insertItem(ctx, q, o.ID, &li); err != nil {
			return err
		}
	}
	return nil
}

func (OrderRepo) insertItem(ctx context.Context, q dbtx.Querier, orderID string, li *pressing.OrderLineItem) error {
	_, err := q.Exec(ctx, `
		INSERT INTO order_items (id, order_id, catalog_item_id, name, mode, quantity, unit,
		  unit_price_fcfa, line_total_fcfa, note, activity_type, pricing_basis, pieces_per_unit,
		  weight_kg, is_express, express_fee_fcfa, express_due_date)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
		li.ID, orderID, li.CatalogItemID, li.Name, li.Mode, li.Quantity, li.Unit,
		li.UnitPriceFCFA, li.LineTotalFCFA, li.Note, li.ActivityType, li.PricingBasis,
		li.PiecesPerUnit, li.WeightKg, li.IsExpress, li.ExpressFeeFCFA, li.ExpressDueDate)
	return err
}

// SetClaimPhotos remplace les photos d'une commande.
func (OrderRepo) SetClaimPhotos(ctx context.Context, q dbtx.Querier, orderID string, photos []pressing.OrderClaimPhoto) error {
	_, err := q.Exec(ctx, `DELETE FROM order_claim_photos WHERE order_id=$1`, orderID)
	if err != nil {
		return err
	}
	for _, p := range photos {
		if _, err := q.Exec(ctx, `
			INSERT INTO order_claim_photos (id, order_id, caption, item_name, captured_at, storage_path)
			VALUES ($1,$2,$3,$4,$5,$6)`,
			p.ID, orderID, p.Caption, p.ItemName, p.CapturedAt, p.URL); err != nil {
			return err
		}
	}
	return nil
}

func (OrderRepo) ListPhotos(ctx context.Context, q dbtx.Querier, orderID string) ([]pressing.OrderClaimPhoto, error) {
	rows, err := q.Query(ctx, `
		SELECT id, caption, item_name, captured_at, storage_path FROM order_claim_photos
		WHERE order_id=$1 ORDER BY captured_at`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []pressing.OrderClaimPhoto{}
	for rows.Next() {
		p := pressing.OrderClaimPhoto{}
		var captured time.Time
		var storagePath string
		if err := rows.Scan(&p.ID, &p.Caption, &p.ItemName, &captured, &storagePath); err != nil {
			return nil, err
		}
		p.CapturedAt = captured.UTC().Format(time.RFC3339)
		p.URL = "/api/v1/orders/" + orderID + "/photos/" + p.ID
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r OrderRepo) Get(ctx context.Context, q dbtx.Querier, id string) (*pressing.Order, error) {
	o, err := scanOrder(q.QueryRow(ctx, "SELECT "+orderCols+" FROM orders WHERE id=$1", id))
	if err != nil || o == nil {
		return nil, err
	}
	if o.Items, err = r.listItems(ctx, q, id); err != nil {
		return nil, err
	}
	if o.ClaimPhotos, err = r.ListPhotos(ctx, q, id); err != nil {
		return nil, err
	}
	return o, nil
}

func (r OrderRepo) listItems(ctx context.Context, q dbtx.Querier, orderID string) ([]pressing.OrderLineItem, error) {
	rows, err := q.Query(ctx, `
		SELECT id, catalog_item_id, name, mode, quantity, unit, unit_price_fcfa, line_total_fcfa,
		       note, activity_type, pricing_basis, pieces_per_unit, weight_kg, is_express, express_fee_fcfa, express_due_date
		FROM order_items WHERE order_id=$1 ORDER BY id`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []pressing.OrderLineItem{}
	for rows.Next() {
		li := pressing.OrderLineItem{}
		if err := rows.Scan(&li.ID, &li.CatalogItemID, &li.Name, &li.Mode, &li.Quantity, &li.Unit,
			&li.UnitPriceFCFA, &li.LineTotalFCFA, &li.Note, &li.ActivityType, &li.PricingBasis,
			&li.PiecesPerUnit, &li.WeightKg, &li.IsExpress, &li.ExpressFeeFCFA, &li.ExpressDueDate); err != nil {
			return nil, err
		}
		out = append(out, li)
	}
	return out, rows.Err()
}

func (OrderRepo) List(ctx context.Context, q dbtx.Querier, f pressing.OrderFilter) ([]*pressing.Order, int, error) {
	where := " WHERE TRUE"
	args := []any{}
	where += " AND voided_at IS NULL"
	if f.Status != "" {
		where += fmt.Sprintf(" AND status = $%d", len(args)+1)
		args = append(args, f.Status)
	}
	if f.ClientID != "" {
		where += fmt.Sprintf(" AND client_id = $%d", len(args)+1)
		args = append(args, f.ClientID)
	}
	if f.Search != "" {
		where += fmt.Sprintf(" AND (ticket_number ILIKE $%d OR client_name ILIKE $%d)", len(args)+1, len(args)+1)
		args = append(args, "%"+f.Search+"%")
	}
	var total int
	if err := q.QueryRow(ctx, "SELECT count(*) FROM orders"+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	sql := "SELECT " + orderCols + " FROM orders" + where +
		fmt.Sprintf(" ORDER BY created_at DESC LIMIT %d OFFSET %d", maxInt(f.PageSize, 50), (maxInt(f.Page, 1)-1)*maxInt(f.PageSize, 50))
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []*pressing.Order{}
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, o)
	}
	return out, total, rows.Err()
}

type OrderFilter struct {
	Status        string
	ClientID      string
	Search        string
	IncludeVoided bool
	Limit         int
	Offset        int
}

func (OrderRepo) UpdateStatus(ctx context.Context, q dbtx.Querier, id string, status pressing.OrderStatus, markDelivered bool) error {
	sql := `UPDATE orders SET status=$1, revision=nextval('change_seq'), updated_at=now()`
	if markDelivered {
		sql += `, delivered_at=now()`
	}
	sql += ` WHERE id=$2 AND voided_at IS NULL`
	tag, err := q.Exec(ctx, sql, status, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("commande introuvable ou annulée")
	}
	return nil
}

func (OrderRepo) AddPaid(ctx context.Context, q dbtx.Querier, id string, amount int64) error {
	tag, err := q.Exec(ctx, `
		UPDATE orders SET paid_fcfa = LEAST(total_fcfa, paid_fcfa + $1), revision=nextval('change_seq'), updated_at=now()
		WHERE id=$2 AND voided_at IS NULL`, amount, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("commande introuvable ou annulée")
	}
	return nil
}

func (OrderRepo) Void(ctx context.Context, q dbtx.Querier, id, reason string) error {
	_, err := q.Exec(ctx, `
		UPDATE orders SET voided_at=now(), void_reason=$1, revision=nextval('change_seq'), updated_at=now()
		WHERE id=$2 AND voided_at IS NULL`, reason, id)
	return err
}

// PaymentRepo.
type PaymentRepo struct{}

func (PaymentRepo) Create(ctx context.Context, q dbtx.Querier, p *pressing.PaymentRecord, idemKey string) error {
	_, err := q.Exec(ctx, `
		INSERT INTO payments (id, order_id, ticket_number, client_name, amount_fcfa, method, paid_at, type, kind, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,''))
		ON CONFLICT (idempotency_key) DO NOTHING`,
		p.ID, p.OrderID, p.TicketNumber, p.ClientName, p.AmountFCFA, p.Method, p.PaidAt, p.Type, p.Kind, idemKey)
	return err
}

func (PaymentRepo) ListByOrder(ctx context.Context, q dbtx.Querier, orderID string) ([]*pressing.PaymentRecord, error) {
	rows, err := q.Query(ctx, `
		SELECT id, order_id, ticket_number, client_name, amount_fcfa, method, paid_at, type, kind
		FROM payments WHERE order_id=$1 ORDER BY paid_at`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*pressing.PaymentRecord{}
	for rows.Next() {
		p := &pressing.PaymentRecord{}
		var paidAt time.Time
		if err := rows.Scan(&p.ID, &p.OrderID, &p.TicketNumber, &p.ClientName, &p.AmountFCFA, &p.Method, &paidAt, &p.Type, &p.Kind); err != nil {
			return nil, err
		}
		p.PaidAt = paidAt.UTC().Format(time.RFC3339)
		out = append(out, p)
	}
	return out, rows.Err()
}

func (PaymentRepo) FindIdempotent(ctx context.Context, q dbtx.Querier, scope, key string) (bool, error) {
	var exists bool
	err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM idempotency_keys WHERE scope=$1 AND key=$2)`, scope, key).Scan(&exists)
	return exists, err
}

func (PaymentRepo) SaveIdempotency(ctx context.Context, q dbtx.Querier, scope, key string) error {
	_, err := q.Exec(ctx, `
		INSERT INTO idempotency_keys (scope, key) VALUES ($1,$2)
		ON CONFLICT (scope, key) DO NOTHING`, scope, key)
	return err
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// helpers communs
func newID() string { return ids.NewUUID() }
