package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/erwinsskoffi/press_backend/internal/platform/ids"
)

// Service : import/export des sauvegardes legacy v3.
type Service struct {
	pool       *pgxpool.Pool
	storageDir string
}

func NewService(pool *pgxpool.Pool, storageDir string) *Service {
	return &Service{pool: pool, storageDir: storageDir}
}

// StorageDir : racine du stockage privé (photos, sauvegardes pré-restauration).
func (s *Service) StorageDir() string { return s.storageDir }

// Report : rapport de migration (contrat Prompt 07 §12).
type Report struct {
	Hash              string         `json:"hash"`
	Status            string         `json:"status"` // preview | déjà appliqué | restauré | échec
	ExportedAt        string         `json:"exportedAt"`
	Source            map[string]int `json:"source"`  // lignes source par entité
	Created           map[string]int `json:"created"` // lignes créées
	Updated           map[string]int `json:"updated"`
	Ignored           map[string]int `json:"ignored"`
	Duplicates        []string       `json:"duplicates"`
	Anomalies         []string       `json:"anomalies"` // relations cassées, tolérées
	Incompatibilities []string       `json:"incompatibilities"`
	PhotosImported    int            `json:"photosImported"`
	PhotosSkipped     int            `json:"photosSkipped"`
	PinLegacy         bool           `json:"pinLegacyImported"`
	ServerBackup      string         `json:"serverBackup,omitempty"`
	Errors            []string       `json:"errors,omitempty"`
	StartedAt         string         `json:"startedAt"`
	FinishedAt        string         `json:"finishedAt"`
}

func (s *Service) newReport(b *LegacyBackup, hash, status string) *Report {
	return &Report{
		Hash: hash, Status: status, ExportedAt: b.ExportedAt,
		Source: map[string]int{}, Created: map[string]int{}, Updated: map[string]int{}, Ignored: map[string]int{},
		Duplicates: []string{}, Anomalies: []string{}, Incompatibilities: []string{}, Errors: []string{},
		StartedAt: time.Now().UTC().Format(time.RFC3339),
	}
}

// Preview : validation complète sans aucune écriture.
func (s *Service) Preview(ctx context.Context, b *LegacyBackup, hash string) (*Report, error) {
	rep := s.newReport(b, hash, "preview")
	rep.Source = map[string]int{
		"settings": 1, "catalog": len(b.Catalog), "clients": len(b.Clients),
		"orders": len(b.Orders), "payments": len(b.Payments), "expenses": len(b.Expenses),
		"zones": len(b.Zones), "logistics": len(b.Logistics),
		"inventory": len(b.Inventory), "inventoryMovements": len(b.Movements),
	}
	photos := 0
	for _, o := range b.Orders {
		photos += len(o.ClaimPhotos)
	}
	rep.Source["photos"] = photos
	rep.Created = cloneCounts(rep.Source)

	clientIDs := map[string]bool{}
	for _, c := range b.Clients {
		clientIDs[c.ID] = true
	}
	catalogIDs := map[string]bool{}
	for _, c := range b.Catalog {
		catalogIDs[c.ID] = true
	}
	orderIDs := map[string]bool{}
	for _, o := range b.Orders {
		orderIDs[o.ID] = true
	}
	itemIDs := map[string]bool{}
	for _, i := range b.Inventory {
		itemIDs[i.ID] = true
	}

	for _, o := range b.Orders {
		if o.ClientID != "" && !clientIDs[o.ClientID] {
			rep.Anomalies = append(rep.Anomalies,
				fmt.Sprintf("commande %s: clientId %s absent du backup (client de passage conservé)", o.TicketNumber, o.ClientID))
		}
		for _, it := range o.Items {
			if it.CatalogItemID != "" && !catalogIDs[it.CatalogItemID] && !isPseudo(it.CatalogItemID) {
				rep.Anomalies = append(rep.Anomalies,
					fmt.Sprintf("commande %s: article %s absent du catalogue (ligne conservée avec son prix)", o.TicketNumber, it.CatalogItemID))
			}
		}
	}
	for _, p := range b.Payments {
		if strings.HasPrefix(p.OrderID, "prepaid-") {
			continue // recharge prépayée : référence volontairement hors commandes
		}
		if !orderIDs[p.OrderID] {
			rep.Anomalies = append(rep.Anomalies,
				fmt.Sprintf("paiement %s: orderId %s absent du backup (conservé)", p.ID, p.OrderID))
		}
	}
	for _, t := range b.Logistics {
		if t.OrderID != "" && !orderIDs[t.OrderID] {
			rep.Anomalies = append(rep.Anomalies,
				fmt.Sprintf("tâche %s: orderId %s absent du backup (conservée)", t.ID, t.OrderID))
		}
	}
	for _, m := range b.Movements {
		if !itemIDs[m.ItemID] {
			rep.Anomalies = append(rep.Anomalies,
				fmt.Sprintf("mouvement %s: itemId %s absent du stock (conservé)", m.ID, m.ItemID))
		}
	}
	// réelles (serveur) présentes → avertissement écrasement
	var realOrders int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM orders`).Scan(&realOrders); err == nil && realOrders > 0 {
		rep.Incompatibilities = append(rep.Incompatibilities,
			fmt.Sprintf("le serveur contient déjà %d commande(s) : la restauration REMPLACE les données métier (sauvegarde serveur créée avant)", realOrders))
	}
	return rep, nil
}

func isPseudo(id string) bool {
	return strings.HasPrefix(id, "kg-") || strings.HasPrefix(id, "bl-")
}

// Restore : remplacement atomique des données métier par le backup.
// - sauvegarde serveur préalable (fichier JSON) ;
// - UNE transaction : TRUNCATE métier + insertions avec IDs historiques ;
// - photos décodées → fichiers privés + métadonnées ;
// - PIN legacy → auth_credentials (algo legacy_sha256, upgrade au premier login) ;
// - compteur ticket recalculé (max EP-{année}-{seq}) ;
// - hash enregistré → re-import identique = "déjà appliqué" (idempotent).
func (s *Service) Restore(ctx context.Context, b *LegacyBackup, hash, serverBackupPath string) (*Report, error) {
	rep := s.newReport(b, hash, "restauré")
	if serverBackupPath != "" {
		rep.ServerBackup = serverBackupPath
	}

	// 1. sauvegarde serveur préalable (hors transaction, best effort)
	if s.storageDir != "" {
		if err := s.dumpCurrent(ctx, serverBackupPath); err != nil {
			rep.Anomalies = append(rep.Anomalies, "sauvegarde serveur préalable impossible: "+err.Error())
		}
	}

	// 2. préparation des fichiers photos (écrits avant commit, purgés si rollback)
	written := []string{}
	defer func() {
		if rep.Status == "échec" {
			for _, f := range written {
				_ = os.Remove(f)
			}
		}
	}()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		rep.Status = "échec"
		rep.Errors = append(rep.Errors, err.Error())
		return rep, err
	}
	defer tx.Rollback(ctx)

	q := func(sql string, args ...any) error {
		_, err := tx.Exec(ctx, sql, args...)
		return err
	}

	// 3. purge métier (jamais auth_sessions/devices/sync/audit/idempotency)
	for _, t := range []string{"order_claim_photos", "order_items", "orders", "payments",
		"client_wallet_entries", "clients", "catalog_items", "expenses", "delivery_zones",
		"logistics_tasks", "inventory_movements", "inventory_items"} {
		if err := q(`TRUNCATE ` + t + ` CASCADE`); err != nil {
			rep.Status = "échec"
			rep.Errors = append(rep.Errors, t+": "+err.Error())
			return rep, err
		}
	}

	// 4. settings (IDs/casse legacy conservés, sans secrets publics)
	blanch, pressing, loyalty, err := marshalCfgs(b.Settings)
	if err != nil {
		rep.Status = "échec"
		rep.Errors = append(rep.Errors, err.Error())
		return rep, err
	}
	scope := b.Settings.ActivityScope
	if scope == "" {
		scope = "both"
	}
	nextSeq := int64(b.Settings.NextTicketSequence)
	if nextSeq < 1 {
		nextSeq = 1
	}
	// expressPercent legacy est porté par pressing_config (pas de colonne dédiée)
	if err := q(`INSERT INTO shop_settings (id, shop_name, tagline, commune, address, phone, whatsapp_phone,
		  rccm, ticket_footer_note, next_ticket_sequence, activity_scope,
		  blanchisserie_config, pressing_config, loyalty_config, onboarding_completed)
		VALUES (1, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		ON CONFLICT (id) DO UPDATE SET shop_name=EXCLUDED.shop_name, tagline=EXCLUDED.tagline,
		  commune=EXCLUDED.commune, address=EXCLUDED.address, phone=EXCLUDED.phone,
		  whatsapp_phone=EXCLUDED.whatsapp_phone, rccm=EXCLUDED.rccm,
		  ticket_footer_note=EXCLUDED.ticket_footer_note,
		  next_ticket_sequence=EXCLUDED.next_ticket_sequence, activity_scope=EXCLUDED.activity_scope,
		  blanchisserie_config=EXCLUDED.blanchisserie_config, pressing_config=EXCLUDED.pressing_config,
		  loyalty_config=EXCLUDED.loyalty_config, onboarding_completed=EXCLUDED.onboarding_completed`,
		b.Settings.ShopName, b.Settings.Tagline, b.Settings.Commune, b.Settings.Address,
		b.Settings.Phone, b.Settings.WhatsappPhone, b.Settings.Rccm,
		b.Settings.TicketFooterNote, nextSeq, scope,
		blanch, pressing, loyalty, b.Settings.OnboardingCompleted); err != nil {
		rep.Status = "échec"
		rep.Errors = append(rep.Errors, "settings: "+err.Error())
		return rep, err
	}
	rep.Created["settings"] = 1

	// 5. catalogue (IDs historiques préservés)
	for _, c := range b.Catalog {
		turn := intPtrFromFloat(c.TurnaroundDays)
		if err := q(`INSERT INTO catalog_items (id, name, category, default_mode, price_fcfa, unit,
			  active, image_url, turnaround_days, care_note, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),$9,NULLIF($10,''), now(), now())`,
			c.ID, c.Name, c.Category, c.DefaultMode, int64(c.PriceFCFA), c.Unit, c.Active,
			c.ImageURL, turn, c.CareNote); err != nil {
			rep.Status = "échec"
			rep.Errors = append(rep.Errors, fmt.Sprintf("catalog %s: %v", c.ID, err))
			return rep, err
		}
		rep.Created["catalog"]++
	}

	// 6. clients + historique wallet + soldes préservés
	for _, c := range b.Clients {
		pts := int64(0)
		if c.LoyaltyPoints != nil {
			pts = int64(*c.LoyaltyPoints)
		}
		bal := int64(0)
		if c.PrepaidBalanceFCFA != nil {
			bal = int64(*c.PrepaidBalanceFCFA)
		}
		createdAt := orNow(c.CreatedAt)
		if err := q(`INSERT INTO clients (id, full_name, phone, commune, address_note,
			  loyalty_points, prepaid_balance_fcfa, subscription_label, subscription_expires_at,
			  archived_at, created_at, updated_at)
			VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,NULLIF($8,''),NULLIF($9,'')::date, NULL, $10, now())`,
			c.ID, c.FullName, c.Phone, c.Commune, c.AddressNote, pts, bal,
			c.SubscriptionLabel, c.SubscriptionExpiresAt, createdAt); err != nil {
			rep.Status = "échec"
			rep.Errors = append(rep.Errors, fmt.Sprintf("client %s: %v", c.ID, err))
			return rep, err
		}
		rep.Created["clients"]++
		for _, w := range c.WalletHistory {
			if err := q(`INSERT INTO client_wallet_entries (id, client_id, entry_date, type, amount_fcfa, method, note)
				VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''))`,
				w.ID, c.ID, orNow(w.Date), w.Type, int64(w.AmountFCFA), w.Method, w.Note); err != nil {
				rep.Status = "échec"
				rep.Errors = append(rep.Errors, fmt.Sprintf("wallet %s: %v", w.ID, err))
				return rep, err
			}
			rep.Created["walletEntries"]++
		}
	}

	// 7. commandes + items + photos (dates, statuts, montants préservés).
	// Les FK modernes n'existaient pas côté IndexedDB : une référence orpheline
	// (déjà signalée au preview) est nullifiée, jamais bloquante.
	clientIDs := map[string]bool{}
	for _, c := range b.Clients {
		clientIDs[c.ID] = true
	}
	itemIDs := map[string]bool{}
	for _, i := range b.Inventory {
		itemIDs[i.ID] = true
	}
	for _, o := range b.Orders {
		var clientID any
		if o.ClientID != "" && clientIDs[o.ClientID] {
			clientID = o.ClientID
		}
		delivered := nullableTS(o.DeliveredAt)
		if err := q(`INSERT INTO orders (id, ticket_number, ticket_seq, client_id, client_name, client_phone,
			  commune, rack_slot, subtotal_fcfa, express_fee_fcfa, delivery_fee_fcfa, discount_fcfa,
			  prepaid_used_fcfa, loyalty_points_earned, loyalty_points_redeemed, total_fcfa, paid_fcfa,
			  status, drop_off_date, due_date, delivered_at, notes, is_express, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NULLIF($20,'')::date,$21,NULLIF($22,''),$23,$24,$25)`,
			o.ID, o.TicketNumber, ticketSeqOf(o.TicketNumber, o.CreatedAt), clientID, o.ClientName,
			o.ClientPhone, o.Commune, o.RackSlot, lineSubtotal(o), int64(o.ExpressFeeFCFA),
			int64(o.DeliveryFeeFCFA), int64(o.DiscountFCFA), int64(o.PrepaidUsedFCFA),
			int64(o.LoyaltyPointsEarned), int64(o.LoyaltyPointsRedeemed), int64(o.TotalFCFA),
			int64(o.PaidFCFA), o.Status, o.DropOffDate, o.DueDate, delivered, o.Notes,
			o.IsExpress, orNow(o.CreatedAt), orNow(o.UpdatedAt)); err != nil {
			rep.Status = "échec"
			rep.Errors = append(rep.Errors, fmt.Sprintf("order %s: %v", o.ID, err))
			return rep, err
		}
		rep.Created["orders"]++
		for _, it := range o.Items {
			var catID any
			if it.CatalogItemID != "" {
				catID = it.CatalogItemID
			}
			lineID := it.ID
			if lineID == "" {
				lineID = ids.NewUUID()
			}
			if err := q(`INSERT INTO order_items (id, order_id, catalog_item_id, name, mode, quantity,
				  unit, unit_price_fcfa, line_total_fcfa, note, activity_type, pricing_basis,
				  pieces_per_unit, weight_kg, is_express, express_fee_fcfa, express_due_date)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,''),NULLIF($11,''),NULLIF($12,''),$13,$14,$15,$16,NULLIF($17,'')::date)`,
				lineID, o.ID, catID, it.Name, it.Mode, it.Quantity, it.Unit, int64(it.UnitPriceFCFA),
				int64Or(int64(it.LineTotalFCFA), int64(it.UnitPriceFCFA)*int64(it.Quantity)), it.Note,
				it.ActivityType, it.PricingBasis, intPtrFromFloat(it.PiecesPerUnit), it.WeightKg,
				it.IsExpress, int64(it.ExpressFeeFCFA), it.ExpressDueDate); err != nil {
				rep.Status = "échec"
				rep.Errors = append(rep.Errors, fmt.Sprintf("order_item %s: %v", lineID, err))
				return rep, err
			}
			rep.Created["orderItems"]++
		}
		for _, ph := range o.ClaimPhotos {
			data, ext, err := photoBytes(ph)
			if err != nil {
				rep.PhotosSkipped++
				rep.Anomalies = append(rep.Anomalies, fmt.Sprintf("photo %s ignorée: %v", ph.ID, err))
				continue
			}
			rel := filepath.Join("photos", o.ID, ph.ID+"."+ext)
			abs := filepath.Join(s.storageDir, rel)
			if err := os.MkdirAll(filepath.Dir(abs), 0o750); err != nil {
				rep.Status = "échec"
				rep.Errors = append(rep.Errors, "photos: "+err.Error())
				return rep, err
			}
			if err := os.WriteFile(abs, data, 0o640); err != nil {
				rep.Status = "échec"
				rep.Errors = append(rep.Errors, "photos: "+err.Error())
				return rep, err
			}
			written = append(written, abs)
			if err := q(`INSERT INTO order_claim_photos (id, order_id, caption, item_name, captured_at, mime, size_bytes, storage_path)
				VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8)`,
				ph.ID, o.ID, ph.Caption, ph.ItemName, orNow(ph.CapturedAt),
				mimeOfExt(ext), len(data), "/"+rel); err != nil {
				rep.Status = "échec"
				rep.Errors = append(rep.Errors, fmt.Sprintf("photo %s: %v", ph.ID, err))
				return rep, err
			}
			rep.PhotosImported++
		}
	}

	// 8. paiements (kind déduit : prépaid-* → encaissement recharge)
	for _, p := range b.Payments {
		kind := "order"
		if strings.HasPrefix(p.OrderID, "prepaid-") {
			kind = "prepaid_topup"
		}
		var orderID any
		if !strings.HasPrefix(p.OrderID, "prepaid-") {
			orderID = p.OrderID
		}
		if err := q(`INSERT INTO payments (id, order_id, ticket_number, client_name, amount_fcfa, method,
			  paid_at, type, kind, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$7)`,
			p.ID, orderID, p.TicketNumber, p.ClientName, int64(p.AmountFCFA), p.Method,
			orNow(p.PaidAt), p.Type, kind); err != nil {
			rep.Status = "échec"
			rep.Errors = append(rep.Errors, fmt.Sprintf("payment %s: %v", p.ID, err))
			return rep, err
		}
		rep.Created["payments"]++
	}

	// 9. dépenses, zones, logistique, stocks, mouvements
	for _, e := range b.Expenses {
		if err := q(`INSERT INTO expenses (id, label, category, amount_fcfa, method, expense_date,
			  note, deleted_at, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,''),NULL,$8, now())`,
			e.ID, e.Label, e.Category, int64(e.AmountFCFA), e.Method, e.Date, e.Note, orNow(e.CreatedAt)); err != nil {
			rep.Status = "échec"
			rep.Errors = append(rep.Errors, fmt.Sprintf("expense %s: %v", e.ID, err))
			return rep, err
		}
		rep.Created["expenses"]++
	}
	for _, z := range b.Zones {
		if err := q(`INSERT INTO delivery_zones (id, commune, fee_fcfa, pickup_fee_fcfa, active, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,COALESCE(NULLIF($6,'')::timestamptz, now()), COALESCE(NULLIF($7,'')::timestamptz, now()))`,
			z.ID, z.Commune, int64(z.FeeFCFA), int64(z.PickupFeeFCFA), z.Active, z.CreatedAt, z.UpdatedAt); err != nil {
			rep.Status = "échec"
			rep.Errors = append(rep.Errors, fmt.Sprintf("zone %s: %v", z.ID, err))
			return rep, err
		}
		rep.Created["zones"]++
	}
	for _, t := range b.Logistics {
		var clientID, orderID any
		if t.ClientID != "" {
			clientID = t.ClientID
		}
		if t.OrderID != "" {
			orderID = t.OrderID
		}
		if err := q(`INSERT INTO logistics_tasks (id, type, status, client_id, client_name, client_phone,
			  commune, address_detail, order_id, ticket_number, scheduled_date, time_slot, courier_name,
			  courier_phone, estimated_pieces, fee_fcfa, notes, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE(NULLIF($8,''),''),$9,COALESCE(NULLIF($10,''),''),$11,$12,$13,COALESCE(NULLIF($14,''),''),$15,$16,COALESCE(NULLIF($17,''),''),$18,$18)`,
			t.ID, t.Type, t.Status, clientID, t.ClientName, t.ClientPhone, t.Commune, t.AddressDetail,
			orderID, t.TicketNumber, t.ScheduledDate, t.TimeSlot, t.CourierName, t.CourierPhone,
			intPtrFromFloat(t.EstimatedPieces), int64(t.FeeFCFA), t.Notes, orNow(t.CreatedAt)); err != nil {
			rep.Status = "échec"
			rep.Errors = append(rep.Errors, fmt.Sprintf("logistics %s: %v", t.ID, err))
			return rep, err
		}
		rep.Created["logistics"]++
	}
	for _, i := range b.Inventory {
		scope := i.ActivityScope
		if scope == "" {
			scope = "both"
		}
		arch := any(nil)
		if i.Archived {
			arch = orNow(i.UpdatedAt)
		}
		if err := q(`INSERT INTO inventory_items (id, name, sku, category, activity_scope, unit,
			  quantity, min_threshold, unit_cost_fcfa, supplier, notes, archived_at, created_at, updated_at)
			VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,NULLIF($10,''),NULLIF($11,''),$12, COALESCE(NULLIF($13,'')::timestamptz, now()), now())`,
			i.ID, i.Name, i.SKU, i.Category, scope, i.Unit, i.Quantity, i.MinThreshold,
			int64(i.UnitCostFCFA), i.Supplier, i.Notes, arch, i.CreatedAt); err != nil {
			rep.Status = "échec"
			rep.Errors = append(rep.Errors, fmt.Sprintf("inventory %s: %v", i.ID, err))
			return rep, err
		}
		rep.Created["inventory"]++
	}
	for _, m := range b.Movements {
		var itemID any
		if itemIDs[m.ItemID] {
			itemID = m.ItemID
		}
		if err := q(`INSERT INTO inventory_movements (id, item_id, item_name, type, quantity_delta,
			  previous_qty, new_qty, unit, unit_cost_fcfa, total_cost_fcfa, reason, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,0),NULLIF($10,0),NULLIF($11,''),COALESCE(NULLIF($12,'')::timestamptz, now()))`,
			m.ID, itemID, m.ItemName, m.Type, m.QuantityDelta, m.PreviousQty, m.NewQty, m.Unit,
			int64(m.UnitCostFCFA), int64(m.TotalCostFCFA), m.Reason, m.CreatedAt); err != nil {
			rep.Status = "échec"
			rep.Errors = append(rep.Errors, fmt.Sprintf("movement %s: %v", m.ID, err))
			return rep, err
		}
		rep.Created["inventoryMovements"]++
	}

	// 10. compteur ticket : max(EP-{année}-{seq}) par année + nextTicketSequence
	maxSeq, maxYear := ticketMax(b.Orders)
	if maxYear > 0 {
		if err := q(`INSERT INTO ticket_counters (year, last_seq) VALUES ($1,$2)
			ON CONFLICT (year) DO UPDATE SET last_seq = GREATEST(ticket_counters.last_seq, EXCLUDED.last_seq)`,
			maxYear, maxSeq); err != nil {
			rep.Status = "échec"
			rep.Errors = append(rep.Errors, "ticket_counters: "+err.Error())
			return rep, err
		}
	}
	var seqNeed int64 = 0
	if err := tx.QueryRow(ctx, `SELECT COALESCE(max(ticket_seq),0) FROM orders`).Scan(&seqNeed); err != nil {
		return nil, err
	}
	if seqNeed+1 > nextSeq {
		if err := q(`UPDATE shop_settings SET next_ticket_sequence=$1 WHERE id=1`, seqNeed+1); err != nil {
			return nil, err
		}
		rep.Updated["nextTicketSequence"] = 1
	}

	// 11. PIN legacy → credential (upgrade Argon2id au premier login, ADR A6)
	if b.Settings.PinHash != "" && b.Settings.PinSalt != "" {
		// état "legacy" (Prompt 04) : login avec l'ancien PIN → re-hash Argon2id immédiat
		if err := q(`INSERT INTO auth_credentials (id, algo, legacy_hash, legacy_salt)
			VALUES (1, 'none', $1, $2)
			ON CONFLICT (id) DO UPDATE SET algo='none',
			  legacy_hash=EXCLUDED.legacy_hash, legacy_salt=EXCLUDED.legacy_salt,
			  password_hash='', failed_attempts=0, locked_until=NULL`, b.Settings.PinHash, b.Settings.PinSalt); err != nil {
			rep.Status = "échec"
			rep.Errors = append(rep.Errors, "pin legacy: "+err.Error())
			return rep, err
		}
		rep.PinLegacy = true
	}

	// 12. enregistrement de l'import (idempotence reprise après interruption)
	reportJSON, _ := json.Marshal(rep)
	if err := q(`INSERT INTO backup_imports (hash, version, status, report, imported_at)
		VALUES ($1, $2, 'restauré', $3, now())
		ON CONFLICT (hash) DO UPDATE SET status='restauré', report=EXCLUDED.report, imported_at=now()`,
		hash, SchemaVersionV3, reportJSON); err != nil {
		rep.Status = "échec"
		rep.Errors = append(rep.Errors, "backup_imports: "+err.Error())
		return rep, err
	}

	if err := tx.Commit(ctx); err != nil {
		rep.Status = "échec"
		rep.Errors = append(rep.Errors, err.Error())
		return rep, err
	}
	rep.FinishedAt = time.Now().UTC().Format(time.RFC3339)
	return rep, nil
}

// FindImport : statut d'un hash déjà importé (idempotence / reprise).
func (s *Service) FindImport(ctx context.Context, hash string) (*Report, bool, error) {
	rows, err := s.pool.Query(ctx, `SELECT report FROM backup_imports WHERE hash=$1 AND status='restauré'`, hash)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, false, err
		}
		var rep Report
		if err := json.Unmarshal(raw, &rep); err != nil {
			return nil, false, err
		}
		return &rep, true, nil
	}
	return nil, false, rows.Err()
}

// dumpCurrent : export JSON des données métier actuelles (pré-restauration).
func (s *Service) dumpCurrent(ctx context.Context, path string) error {
	if path == "" {
		return nil
	}
	export, err := s.ExportV3(ctx)
	if err != nil {
		return err
	}
	raw, err := json.MarshalIndent(export, "", " ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o640)
}

// ExportV3 : export JSON compatible DatabaseBackup v3 (transition frontend).
func (s *Service) ExportV3(ctx context.Context) (map[string]any, error) {
	out := map[string]any{}
	out["version"] = SchemaVersionV3
	out["exportedAt"] = time.Now().UTC().Format(time.RFC3339)

	var settings map[string]any
	if err := s.pool.QueryRow(ctx, `SELECT to_jsonb(s) FROM shop_settings s WHERE id=1`).Scan(&settings); err != nil {
		if err != pgx.ErrNoRows {
			return nil, err
		}
		settings = map[string]any{}
	}
	// jamais de secrets dans l'export public
	delete(settings, "pin_hash")
	delete(settings, "pin_salt")
	out["settings"] = settings

	fetch := func(sql string) ([]map[string]any, error) {
		rows, err := s.pool.Query(ctx, sql)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		arr := []map[string]any{}
		for rows.Next() {
			var m map[string]any
			if err := rows.Scan(&m); err != nil {
				return nil, err
			}
			arr = append(arr, m)
		}
		return arr, rows.Err()
	}
	for k, sql := range map[string]string{
		"catalog":            `SELECT to_jsonb(c) FROM (SELECT * FROM catalog_items ORDER BY name) c`,
		"clients":            `SELECT to_jsonb(c) FROM (SELECT * FROM clients ORDER BY full_name) c`,
		"orders":             `SELECT to_jsonb(o) FROM (SELECT * FROM orders ORDER BY created_at) o`,
		"payments":           `SELECT to_jsonb(p) FROM (SELECT * FROM payments ORDER BY paid_at) p`,
		"expenses":           `SELECT to_jsonb(e) FROM (SELECT * FROM expenses WHERE deleted_at IS NULL ORDER BY expense_date) e`,
		"zones":              `SELECT to_jsonb(z) FROM (SELECT * FROM delivery_zones ORDER BY commune) z`,
		"logistics":          `SELECT to_jsonb(t) FROM (SELECT * FROM logistics_tasks ORDER BY scheduled_date) t`,
		"inventory":          `SELECT to_jsonb(i) FROM (SELECT * FROM inventory_items ORDER BY name) i`,
		"inventoryMovements": `SELECT to_jsonb(m) FROM (SELECT * FROM inventory_movements ORDER BY created_at) m`,
	} {
		arr, err := fetch(sql)
		if err != nil {
			return nil, err
		}
		out[k] = arr
	}

	// walletHistory + items + photos imbriqués (compatibilité v3)
	clientArr := out["clients"].([]map[string]any)
	for _, c := range clientArr {
		hist, err := fetch(`SELECT to_jsonb(w) FROM (SELECT id, entry_date AS date, type, amount_fcfa AS "amountFCFA", method, note FROM client_wallet_entries WHERE client_id='` + c["id"].(string) + `' ORDER BY entry_date) w`)
		if err != nil {
			return nil, err
		}
		if len(hist) > 0 {
			c["walletHistory"] = hist
		}
	}
	orderArr := out["orders"].([]map[string]any)
	for _, o := range orderArr {
		items, err := fetch(`SELECT to_jsonb(i) FROM (SELECT * FROM order_items WHERE order_id='` + o["id"].(string) + `' ORDER BY id) i`)
		if err != nil {
			return nil, err
		}
		o["items"] = items
		photos, err := fetch(`SELECT to_jsonb(p) FROM (SELECT id, caption, item_name AS "itemName", captured_at AS "capturedAt", storage_path FROM order_claim_photos WHERE order_id='` + o["id"].(string) + `' ORDER BY captured_at) p`)
		if err != nil {
			return nil, err
		}
		if len(photos) > 0 {
			o["claimPhotos"] = photos
		}
	}
	return out, nil
}

// --- helpers ---

func cloneCounts(m map[string]int) map[string]int {
	c := map[string]int{}
	for k, v := range m {
		c[k] = v
	}
	return c
}

func timeParseRFC3339(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, fmt.Errorf("vide")
	}
	return time.Parse(time.RFC3339, s)
}

func timeParseDate(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, fmt.Errorf("vide")
	}
	return time.Parse("2006-01-02", s)
}

func orNow(s string) time.Time {
	if t, err := timeParseRFC3339(s); err == nil {
		return t
	}
	return time.Now().UTC()
}

func nullableTS(s string) *time.Time {
	if s == "" {
		return nil
	}
	t := orNow(s)
	return &t
}

func intPtrFromFloat(v *float64) *int {
	if v == nil {
		return nil
	}
	i := int(*v)
	return &i
}

func int64Or(v, def int64) int64 {
	if v == 0 {
		return def
	}
	return v
}

func lineSubtotal(o LegacyOrder) int64 {
	var sum int64
	for _, it := range o.Items {
		sum += int64Or(int64(it.LineTotalFCFA), int64(it.UnitPriceFCFA)*int64(it.Quantity))
	}
	return sum
}

func ticketSeqOf(ticket, createdAt string) int64 {
	if m := ticketRe.FindStringSubmatch(ticket); m != nil {
		if v, err := strconv.ParseInt(m[2], 10, 64); err == nil {
			return v
		}
	}
	// ticket non standard : dérivé de l'ordre chronologique de création
	t := orNow(createdAt)
	return t.Unix() % 100000
}

func ticketMax(orders []LegacyOrder) (int64, int) {
	var maxSeq int64
	year := 0
	for _, o := range orders {
		if m := ticketRe.FindStringSubmatch(o.TicketNumber); m != nil {
			y, _ := strconv.Atoi(m[1])
			seq, _ := strconv.ParseInt(m[2], 10, 64)
			if seq > maxSeq {
				maxSeq = seq
				year = y
			}
		}
	}
	return maxSeq, year
}

func mimeOfExt(ext string) string {
	for mime, e := range validPhotoMIME {
		if e == ext {
			return mime
		}
	}
	return "application/octet-stream"
}

func marshalCfgs(s LegacySettings) (blanch, pressing, loyalty []byte, err error) {
	// valeurs par défaut legacy si absentes (normalizeSettings côté frontend)
	if len(s.BlanchisserieConfig) == 0 {
		s.BlanchisserieConfig = []byte(`{"enabledServices":{},"enableUnit":true,"unitPricesFCFA":{},"packs":[]}`)
	}
	if len(s.PressingConfig) == 0 {
		s.PressingConfig = []byte(fmt.Sprintf(`{"weightEnabled":false,"pricePerKgByMode":{},"weightOffers":[],"expressPricingMode":"percent","expressFixedAmountFCFA":0,"expressPercent":%d}`, int64(s.ExpressPercent)))
	}
	if len(s.LoyaltyConfig) == 0 {
		s.LoyaltyConfig = []byte(`{"enabled":false,"fcfaPerPoint":1000,"rewardThresholdPoints":50,"rewardDiscountFCFA":2000}`)
	}
	blanch, err = json.RawMessage(s.BlanchisserieConfig).MarshalJSON()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("blanchisserieConfig invalide: %v", err)
	}
	pressing, err = json.RawMessage(s.PressingConfig).MarshalJSON()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("pressingConfig invalide: %v", err)
	}
	loyalty, err = json.RawMessage(s.LoyaltyConfig).MarshalJSON()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("loyaltyConfig invalide: %v", err)
	}
	return blanch, pressing, loyalty, nil
}
