package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/erwinsskoffi/press_backend/internal/domain/pressing"
	"github.com/erwinsskoffi/press_backend/internal/platform/dbtx"
	"github.com/erwinsskoffi/press_backend/internal/platform/ids"
	"github.com/erwinsskoffi/press_backend/internal/platform/itest"
	"github.com/erwinsskoffi/press_backend/internal/platform/migrate"
)

// TestOrdersIntegration : cycle complet sur PostgreSQL réel — settings, catalogue,
// client, zone, commande (création/paiement/statut/void), wallet, dépenses,
// logistique (livraison → commande livrée), inventaire (mouvements).
func TestOrdersIntegration(t *testing.T) {
	itest.LockTestDB(t)
	dsn := os.Getenv("ECLAT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ECLAT_TEST_DATABASE_URL non défini : test d'intégration sauté")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	if _, err := migrate.Migrate(ctx, pool, "../../../migrations"); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	// hermétique : tables métier vidées (le seed shop_settings reste en place)
	if _, err := pool.Exec(ctx, `TRUNCATE orders, order_items, order_claim_photos, payments,
		clients, client_wallet_entries, expenses, delivery_zones, logistics_tasks,
		inventory_items, inventory_movements, catalog_items, ticket_counters CASCADE`); err != nil {
		t.Fatalf("reset tables: %v", err)
	}
	txm := dbtx.NewTxManager(pool)
	zones := &ZoneRepo{}
	clients := &ClientRepo{}
	settings := &SettingsRepo{}
	catalog := &CatalogRepo{}
	orders := &OrderRepo{}
	payments := &PaymentRepo{}
	tickets := &TicketRepo{}
	expenses := &ExpenseRepo{}
	logi := &LogisticsRepo{}
	inv := &InventoryRepo{}

	withTx := func(fn func(ctx context.Context, q dbtx.Querier) error) {
		t.Helper()
		if err := txm.WithTx(ctx, fn); err != nil {
			t.Fatalf("tx: %v", err)
		}
	}

	var settingsID string
	withTx(func(ctx context.Context, q dbtx.Querier) error {
		s := &pressing.PressingSettings{
			ID: "default", ShopName: "Éclat Pressing", ActivityScope: pressing.ScopeBoth,
			ExpressPercent: 50,
			PressingConfig: pressing.PressingConfig{
				PricePerKgByMode: map[string]int64{"lavage-repassage": 1500},
				ExpressPercent:   50,
			},
			LoyaltyConfig:      pressing.LoyaltyConfig{FcfaPerPoint: 1000, RewardThresholdPoints: 50, RewardDiscountFCFA: 2000},
			NextTicketSequence: 1,
		}
		if err := settings.Update(ctx, q, s); err != nil {
			return err
		}
		got, err := settings.Get(ctx, q)
		if err != nil {
			return err
		}
		if got == nil || got.ShopName != "Éclat Pressing" {
			t.Fatalf("settings roundtrip: %+v", got)
		}
		settingsID = got.ID

		if err := catalog.Upsert(ctx, q, &pressing.CatalogItem{
			ID: "cat-chemise", Name: "Chemise", Category: "Habit", DefaultMode: pressing.ModeLavageRepassage,
			PriceFCFA: 1000, Unit: "pièce", Active: true, CreatedAt: "x", UpdatedAt: "x",
		}); err != nil {
			return err
		}
		gotCat, err := catalog.Get(ctx, q, "cat-chemise")
		if err != nil || gotCat == nil || gotCat.PriceFCFA != 1000 {
			t.Fatalf("catalog roundtrip: %+v err=%v", gotCat, err)
		}
		return nil
	})

	var clientID, zoneID string
	withTx(func(ctx context.Context, q dbtx.Querier) error {
		c := &pressing.Client{ID: ids.NewUUID(), FullName: "Koffi Test", Phone: "0707070707",
			Commune: "Cocody", AddressNote: strPtr("Riviera 3, near pharmacie"), CreatedAt: time.Now().UTC().Format(time.RFC3339)}
		if err := clients.Upsert(ctx, q, c); err != nil {
			return err
		}
		clientID = c.ID
		z := &pressing.DeliveryZone{ID: ids.NewUUID(), Commune: "Cocody", FeeFCFA: 1500, PickupFeeFCFA: 1000, Active: true}
		if err := zones.Upsert(ctx, q, z); err != nil {
			return err
		}
		zoneID = z.ID
		zonesList, err := zones.List(ctx, q)
		if err != nil || len(zonesList) == 0 {
			t.Fatalf("zones list: %v", err)
		}
		return nil
	})

	// Création commande complète (client + zone + items) + paiement cash
	var orderID, ticket string
	withTx(func(ctx context.Context, q dbtx.Querier) error {
		seq, tk, err := tickets.NextTicket(ctx, q, 2026)
		if err != nil {
			return err
		}
		if seq != 1 || tk != "EP-2026-0001" {
			t.Fatalf("ticket: seq=%d tk=%s", seq, tk)
		}
		seq2, tk2, err := tickets.NextTicket(ctx, q, 2026)
		if err != nil || seq2 != 2 || tk2 != "EP-2026-0002" {
			t.Fatalf("ticket2: seq=%d tk=%s err=%v", seq2, tk2, err)
		}
		ticket = tk
		order := &pressing.Order{
			ID: ids.NewUUID(), TicketNumber: tk, TicketSeq: seq, ClientID: &clientID,
			ClientName: "Koffi Test", ClientPhone: "0707070707", Commune: "Cocody",
			SubtotalFCFA: 2000, ExpressFeeFCFA: 0, DeliveryFeeFCFA: 1500, TotalFCFA: 3500,
			PaidFCFA: 3500, Status: pressing.StatusRecu, DropOffDate: "2026-11-27",
			Items: []pressing.OrderLineItem{
				{CatalogItemID: strPtr("cat-chemise"), Name: "Chemise",
					Mode: pressing.ModeLavageRepassage, Quantity: 2, Unit: "pièce", UnitPriceFCFA: 1000, LineTotalFCFA: 2000},
			},
		}
		if err := orders.Create(ctx, q, order); err != nil {
			return err
		}
		orderID = order.ID
		pay := &pressing.PaymentRecord{ID: ids.NewUUID(), OrderID: &orderID, TicketNumber: tk,
			ClientName: "Koffi Test", AmountFCFA: 3500, Method: pressing.MethodEspeces,
			PaidAt: time.Now().UTC().Format(time.RFC3339), Type: "integral", Kind: "order"}
		if err := payments.Create(ctx, q, pay, ""); err != nil {
			return err
		}
		got, err := orders.Get(ctx, q, orderID)
		if err != nil || got == nil || got.TotalFCFA != 3500 || len(got.Items) != 1 {
			t.Fatalf("order roundtrip: %+v err=%v", got, err)
		}
		if got.Items[0].Name != "Chemise" {
			t.Fatalf("items roundtrip: %+v", got.Items)
		}
		return nil
	})

	// List + filtres
	withTx(func(ctx context.Context, q dbtx.Querier) error {
		list, total, err := orders.List(ctx, q, pressing.OrderFilter{PageSize: 10, Page: 1, Status: "recu"})
		if err != nil || total != 1 || len(list) != 1 {
			t.Fatalf("list: total=%d len=%d err=%v", total, len(list), err)
		}
		return nil
	})

	// Wallet : recharge + historique + débit prépayé gardien
	withTx(func(ctx context.Context, q dbtx.Querier) error {
		if err := clients.ApplyWalletDelta(ctx, q, clientID, 10, 20000); err != nil {
			return err
		}
		if err := clients.AddWalletEntry(ctx, q, clientID, &pressing.ClientWalletEntry{
			ID: ids.NewUUID(), Date: time.Now().UTC().Format(time.RFC3339), Type: "recharge",
			AmountFCFA: 20000, Method: strPtr("especes"), Note: strPtr("Recharge test")}); err != nil {
			return err
		}
		if err := clients.DebitPrepaid(ctx, q, clientID, 5000); err != nil {
			return err
		}
		if err := clients.DebitPrepaid(ctx, q, clientID, 999999); err == nil {
			t.Fatalf("DebitPrepaid: dépassement accepté")
		}
		c, err := clients.Get(ctx, q, clientID)
		if err != nil || c == nil || c.PrepaidBalanceFCFA != 15000 || c.LoyaltyPoints != 10 {
			t.Fatalf("client wallet: %+v err=%v", c, err)
		}
		hist, err := clients.WalletHistory(ctx, q, clientID, 10)
		if err != nil || len(hist) != 1 {
			t.Fatalf("wallet history: %v len=%d", err, len(hist))
		}
		return nil
	})

	// Statut + paiement complémentaire + idempotence + void
	withTx(func(ctx context.Context, q dbtx.Querier) error {
		if err := orders.UpdateStatus(ctx, q, orderID, pressing.StatusLavage, false); err != nil {
			return err
		}
		got, _ := orders.Get(ctx, q, orderID)
		if got.Status != pressing.StatusLavage {
			t.Fatalf("status: %s", got.Status)
		}
		if err := payments.SaveIdempotency(ctx, q, "order.payment", "key-1"); err != nil {
			return err
		}
		exists, err := payments.FindIdempotent(ctx, q, "order.payment", "key-1")
		if err != nil || !exists {
			t.Fatalf("idempotency: %v %v", exists, err)
		}
		// annulation sur une commande dédiée (orderID reste utilisable pour la livraison)
		o2 := &pressing.Order{
			ID: ids.NewUUID(), TicketNumber: ticket + "-VOID", TicketSeq: 999,
			ClientName: "Void Test", ClientPhone: "-", SubtotalFCFA: 500, TotalFCFA: 500,
			PaidFCFA: 0, Status: pressing.StatusRecu, DropOffDate: "2026-11-27",
		}
		if err := orders.Create(ctx, q, o2); err != nil {
			return err
		}
		if err := orders.Void(ctx, q, o2.ID, "erreur de saisie"); err != nil {
			return err
		}
		got2, _ := orders.Get(ctx, q, o2.ID)
		if got2 == nil || got2.VoidedAt == nil {
			t.Fatalf("void non persisté")
		}
		return nil
	})

	// Dépense + soft delete
	withTx(func(ctx context.Context, q dbtx.Querier) error {
		e := &pressing.ExpenseRecord{ID: ids.NewUUID(), Label: "Lessive", Category: "Produits & Lessive",
			AmountFCFA: 7500, Method: pressing.MethodEspeces, Date: "2026-11-27", Note: strPtr("sac 5kg")}
		if err := expenses.Create(ctx, q, e); err != nil {
			return err
		}
		list, total, err := expenses.List(ctx, q, "2026-11-01", "2026-11-30", 10, 0)
		if err != nil || total != 1 || len(list) != 1 {
			t.Fatalf("expenses list: %v %d %d", err, total, len(list))
		}
		if err := expenses.SoftDelete(ctx, q, e.ID); err != nil {
			return err
		}
		_, total2, err := expenses.List(ctx, q, "", "", 10, 0)
		if err != nil || total2 != 0 {
			t.Fatalf("expenses après delete: %v %d", err, total2)
		}
		return nil
	})

	// Logistique : livraison effectuée → commande `livre` même transaction
	withTx(func(ctx context.Context, q dbtx.Querier) error {
		tk := &pressing.LogisticsTask{
			ID: ids.NewUUID(), Type: pressing.LogisticsLivraison, Status: pressing.LogisticsPlanifie,
			ClientName: "Koffi Test", Commune: "Cocody", OrderID: &orderID, TicketNumber: &ticket,
			ScheduledDate: "2026-11-28", FeeFCFA: 1500, EstimatedPieces: intPtr(2),
		}
		if err := logi.Upsert(ctx, q, tk); err != nil {
			return err
		}
		got, err := logi.UpdateStatus(ctx, q, tk.ID, pressing.LogisticsEffectue)
		if err != nil || got == nil || got.Status != pressing.LogisticsEffectue {
			t.Fatalf("task status: %+v err=%v", got, err)
		}
		o, err := orders.Get(ctx, q, orderID)
		if err != nil || o == nil || o.Status != pressing.StatusLivre || o.DeliveredAt == nil {
			t.Fatalf("order après livraison: %+v err=%v", o, err)
		}
		return nil
	})

	// Inventaire : upsert, entrée, sortie, insuffisant, ajustement, mouvements
	withTx(func(ctx context.Context, q dbtx.Querier) error {
		item := &pressing.InventoryItem{ID: ids.NewUUID(), Name: "Lessive 5kg", Category: "Produits",
			ActivityScope: pressing.ScopeBoth, Unit: "kg", Quantity: 2, MinThreshold: 1,
			UnitCostFCFA: 1500}
		if err := inv.Upsert(ctx, q, item); err != nil {
			return err
		}
		locked, err := inv.LockForUpdate(ctx, q, item.ID)
		if err != nil || locked == nil || locked.Quantity != 2 {
			t.Fatalf("lock: %+v err=%v", locked, err)
		}
		if err := inv.SetQuantity(ctx, q, item.ID, 12, &item.UnitCostFCFA); err != nil {
			return err
		}
		if err := inv.AddMovement(ctx, q, &pressing.InventoryMovement{ID: ids.NewUUID(), ItemID: item.ID,
			ItemName: "Lessive 5kg", Type: pressing.MovementEntree, QuantityDelta: 10,
			PreviousQty: 2, NewQty: 12, Unit: "kg", UnitCostFCFA: &item.UnitCostFCFA, TotalCostFCFA: int64Ptr(15000)}); err != nil {
			return err
		}
		moves, err := inv.ListMovements(ctx, q, item.ID, 10)
		if err != nil || len(moves) != 1 {
			t.Fatalf("movements: %v %d", err, len(moves))
		}
		if err := inv.Archive(ctx, q, item.ID); err != nil {
			return err
		}
		list, err := inv.List(ctx, q)
		if err != nil || len(list) != 0 {
			t.Fatalf("inventory après archive: %v %d", err, len(list))
		}
		_ = settingsID
		_ = zoneID
		return nil
	})

	// Rapports : Z de caisse + mensuel
	withTx(func(ctx context.Context, q dbtx.Querier) error {
		rep := &ReportRepo{}
		z, err := rep.DailyZ(ctx, q, "2026-11-27")
		if err != nil || z == nil {
			t.Fatalf("dailyZ: %v", err)
		}
		if z.RevenueTotal != 3500 || z.RevenueOrder != 3500 || z.ExpensesTotal != 0 {
			t.Fatalf("dailyZ agrégats: %+v", z)
		}
		m, err := rep.Monthly(ctx, q, "2026-11")
		if err != nil || m == nil || m.RevenueTotal != 3500 {
			t.Fatalf("monthly: %+v err=%v", m, err)
		}
		payList, err := rep.ListPayments(ctx, q, "2026-11-01", "2026-11-30", 10)
		if err != nil || len(payList) != 1 {
			t.Fatalf("listPayments: %v %d", err, len(payList))
		}
		return nil
	})
}

func mustTxManager(t *testing.T, dsn string) *dbtx.TxManager {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return dbtx.NewTxManager(pool)

}

func int64Ptr(v int64) *int64 { return &v }

func intPtr(v int) *int { return &v }

func strPtr(v string) *string { return &v }
