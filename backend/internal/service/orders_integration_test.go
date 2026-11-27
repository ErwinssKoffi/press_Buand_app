package service_test

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/erwinsskoffi/press_backend/internal/domain/pressing"
	"github.com/erwinsskoffi/press_backend/internal/platform/dbtx"
	"github.com/erwinsskoffi/press_backend/internal/platform/itest"
	"github.com/erwinsskoffi/press_backend/internal/platform/migrate"
	"github.com/erwinsskoffi/press_backend/internal/repository/postgres"
	"github.com/erwinsskoffi/press_backend/internal/service"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestOrderServiceIntegration : flux métier complet sur PG réel —
// topup prépayé, création commande transactionnelle, transitions,
// surpaiement rejetée, replay idempotent, annulation.
func TestOrderServiceIntegration(t *testing.T) {
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
	if _, err := migrate.Migrate(ctx, pool, "../../migrations"); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	if _, err := pool.Exec(ctx, `TRUNCATE orders, order_items, order_claim_photos, payments,
		clients, client_wallet_entries, expenses, delivery_zones, logistics_tasks,
		inventory_items, inventory_movements, catalog_items, ticket_counters, idempotency_keys CASCADE`); err != nil {
		t.Fatalf("reset: %v", err)
	}

	txm := dbtx.NewTxManager(pool)
	noopAudit := auditNoop{}
	settingsRepo := &postgres.SettingsRepo{}
	catalogRepo := &postgres.CatalogRepo{}
	clientRepo := &postgres.ClientRepo{}
	ticketRepo := &postgres.TicketRepo{}
	orderRepo := &postgres.OrderRepo{}
	paymentRepo := &postgres.PaymentRepo{}
	zoneRepo := &postgres.ZoneRepo{}

	orderSvc := service.NewOrderService(orderRepo, catalogRepo, paymentRepo, settingsRepo,
		clientRepo, ticketRepo, zoneRepo, txm, noopAudit)
	settingsSvc := service.NewSettingsService(settingsRepo, txm, noopAudit)
	catalogSvc := service.NewCatalogService(catalogRepo, txm, noopAudit)
	clientSvc := service.NewClientService(clientRepo, paymentRepo, txm, noopAudit)
	logisticsSvc := service.NewLogisticsService(&postgres.LogisticsRepo{}, zoneRepo, txm, noopAudit)

	// 1. Paramétrage + catalogue + client + zone
	s := &pressing.PressingSettings{
		ID: "default", ShopName: "Éclat", ActivityScope: pressing.ScopeBoth, ExpressPercent: 50,
		PressingConfig: pressing.PressingConfig{
			PricePerKgByMode: map[string]int64{"lavage_repassage": 1500},
			ExpressPercent:   50,
		},
		LoyaltyConfig: pressing.LoyaltyConfig{Enabled: true, FcfaPerPoint: 1000,
			RewardThresholdPoints: 50, RewardDiscountFCFA: 2000},
	}
	if _, err := settingsSvc.Update(ctx, s); err != nil {
		t.Fatalf("settings: %v", err)
	}
	if _, err := catalogSvc.Save(ctx, &pressing.CatalogItem{
		ID: "cat-chemise", Name: "Chemise", Category: "Habit",
		DefaultMode: pressing.ModeLavageRepassage, PriceFCFA: 1000, Unit: "pièce"}); err != nil {
		t.Fatalf("catalog: %v", err)
	}
	cl, err := clientSvc.Save(ctx, &pressing.Client{FullName: "Aya Koffi", Phone: "0102030405", Commune: "Cocody"})
	if err != nil {
		t.Fatalf("client: %v", err)
	}
	if err := logisticsSvc.SaveZone(ctx, &pressing.DeliveryZone{ID: "zone-cocody", Commune: "Cocody",
		FeeFCFA: 1500, PickupFeeFCFA: 1000, Active: true}); err != nil {
		t.Fatalf("zone: %v", err)
	}

	// 2. Topup prépayé 20 000 + historique + kind prepaid_topup
	updated, err := clientSvc.Topup(ctx, cl.ID, service.TopupIn{
		AmountFCFA: 20000, Method: pressing.MethodEspeces, Note: "Recharge"})
	if err != nil {
		t.Fatalf("topup: %v", err)
	}
	if updated.PrepaidBalanceFCFA != 20000 {
		t.Fatalf("solde après topup: %d", updated.PrepaidBalanceFCFA)
	}
	if len(updated.WalletHistory) != 1 || updated.WalletHistory[0].Type != "recharge" {
		t.Fatalf("wallet history: %+v", updated.WalletHistory)
	}
	pays, err := orderSvc.PaymentsOf(ctx, "")
	_ = pays
	if err != nil {
		t.Fatalf("payments: %v", err)
	}

	// 3. Création commande : 2 chemises + livraison Cocody, tout via prépayé
	zoneID := "zone-cocody"
	in := service.PricingInput{
		ClientID: &cl.ID,
		Items: []pressing.OrderLineItem{{
			CatalogItemID: strPtr("cat-chemise"), Name: "Chemise",
			Mode: pressing.ModeLavageRepassage, Quantity: 2, Unit: "pièce",
		}},
		DeliveryZoneID:       &zoneID,
		UsePrepaid:           true,
		InitialPaymentMethod: pressing.MethodEspeces,
	}
	o, err := orderSvc.Create(ctx, in, nil, "idem-1")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if o.TotalFCFA != 3500 || o.SubtotalFCFA != 2000 || o.DeliveryFeeFCFA != 1500 {
		t.Fatalf("totaux: %+v", o)
	}
	if o.PrepaidUsedFCFA != 3500 || o.PaidFCFA != 3500 {
		t.Fatalf("prépayé: used=%d paid=%d", o.PrepaidUsedFCFA, o.PaidFCFA)
	}
	if o.TicketNumber != "EP-2026-0001" || o.Status != pressing.StatusRecu {
		t.Fatalf("ticket/statut: %s %s", o.TicketNumber, o.Status)
	}
	if o.LoyaltyPointsEarned != 3 { // 3500/1000
		t.Fatalf("points gagnés: %d", o.LoyaltyPointsEarned)
	}
	cAfter, _ := clientSvc.Get(ctx, cl.ID)
	if cAfter.PrepaidBalanceFCFA != 16500 {
		t.Fatalf("solde après commande: %d", cAfter.PrepaidBalanceFCFA)
	}
	if len(cAfter.WalletHistory) != 2 {
		t.Fatalf("wallet après commande: %+v", cAfter.WalletHistory)
	}
	var utilFound bool
	for _, e := range cAfter.WalletHistory {
		if e.Type == "utilisation" && e.AmountFCFA == -3500 {
			utilFound = true
		}
	}
	if !utilFound {
		t.Fatalf("entrée utilisation absente: %+v", cAfter.WalletHistory)
	}
	if cAfter.LoyaltyPoints != 3 {
		t.Fatalf("points client: %d", cAfter.LoyaltyPoints)
	}

	// replay idempotent refusé
	if _, err := orderSvc.Create(ctx, in, nil, "idem-1"); !errors.Is(err, service.ErrIdempotentReplay) {
		t.Fatalf("replay attendu, obtenu: %v", err)
	}

	// 4. Transitions linéaires puis livraison
	for _, want := range []pressing.OrderStatus{pressing.StatusLavage, pressing.StatusRepassage, pressing.StatusPret} {
		o, err = orderSvc.AdvanceStatus(ctx, o.ID, "")
		if err != nil || o.Status != want {
			t.Fatalf("transition vers %s: %v / %s", want, err, o.Status)
		}
	}
	// régression interdite : pret → lavage refusé
	if _, err := orderSvc.AdvanceStatus(ctx, o.ID, string(pressing.StatusLavage)); !service.IsBusinessError(err) {
		t.Fatalf("régression acceptée: %v", err)
	}
	o, err = orderSvc.AdvanceStatus(ctx, o.ID, "")
	if err != nil || o.Status != pressing.StatusLivre || o.DeliveredAt == nil {
		t.Fatalf("livraison: %v %s %v", err, o.Status, o.DeliveredAt)
	}

	// 5. Paiement complémentaire : surpaiement rejetée
	in2 := service.PricingInput{
		ClientID: &cl.ID,
		Items: []pressing.OrderLineItem{{
			CatalogItemID: strPtr("cat-chemise"), Name: "Chemise",
			Mode: pressing.ModeLavageRepassage, Quantity: 1, Unit: "pièce"}},
		InitialPaymentMethod: pressing.MethodEspeces,
	}
	o2, err := orderSvc.Create(ctx, in2, nil, "")
	if err != nil {
		t.Fatalf("create2: %v", err)
	}
	if o2.TotalFCFA != 1000 || o2.PaidFCFA != 1000 {
		t.Fatalf("order2: %+v", o2)
	}
	// déjà soldée → toute additionnelle est une surpaiement
	if _, err := orderSvc.AddPayment(ctx, o2.ID, 500, pressing.MethodWave, ""); !service.IsBusinessError(err) {
		t.Fatalf("surpaiement acceptée: %v", err)
	}

	// 6. Prépayé partiel : solde 16500-1000(client direct)=... clamp sur commande 30 000
	in3 := service.PricingInput{
		ClientID: &cl.ID,
		Items: []pressing.OrderLineItem{{
			CatalogItemID: strPtr("cat-chemise"), Name: "Chemise",
			Mode: pressing.ModeLavageRepassage, Quantity: 30, Unit: "pièce"}},
		UsePrepaid:           true,
		InitialPaymentMethod: pressing.MethodEspeces,
	}
	o3, err := orderSvc.Create(ctx, in3, nil, "")
	if err != nil {
		t.Fatalf("create3: %v", err)
	}
	if o3.PrepaidUsedFCFA != 16500 || o3.TotalFCFA != 30000 || o3.PaidFCFA != 30000 {
		t.Fatalf("prépayé clampé: used=%d total=%d paid=%d", o3.PrepaidUsedFCFA, o3.TotalFCFA, o3.PaidFCFA)
	}

	// 6bis. Acompte cash partiel à la création (parité montant payé au dépôt)
	balance := int64(16500)
	in4 := service.PricingInput{
		ClientID: &cl.ID,
		Items: []pressing.OrderLineItem{{
			CatalogItemID: strPtr("cat-chemise"), Name: "Chemise",
			Mode: pressing.ModeLavageRepassage, Quantity: 30, Unit: "pièce"}},
		UsePrepaid:           true,
		InitialCashPaidFCFA:  &balance,
		InitialPaymentMethod: pressing.MethodWave,
	}
	o5, err := orderSvc.Create(ctx, in4, nil, "")
	if err != nil {
		t.Fatalf("create4: %v", err)
	}
	if o5.PrepaidUsedFCFA != 0 || o5.TotalFCFA != 30000 || o5.PaidFCFA != 16500 {
		t.Fatalf("acompte: used=%d total=%d paid=%d", o5.PrepaidUsedFCFA, o5.TotalFCFA, o5.PaidFCFA)
	}
	o5b, err := orderSvc.AddPayment(ctx, o5.ID, 13500, pressing.MethodWave, "")
	if err != nil || o5b.PaidFCFA != 30000 {
		t.Fatalf("solde après acompte: %v paid=%d", err, o5b.PaidFCFA)
	}

	// 7. Annulation non destructive
	o4, err := orderSvc.Void(ctx, o3.ID, "doublon")
	if err != nil || o4.VoidedAt == nil || o4.VoidReason == nil || *o4.VoidReason != "doublon" {
		t.Fatalf("void: %v %v", err, o4.VoidedAt)
	}
	if _, err := orderSvc.AdvanceStatus(ctx, o4.ID, ""); !service.IsBusinessError(err) {
		t.Fatalf("transition sur commande annulée acceptée: %v", err)
	}
}

func strPtr(s string) *string { return &s }

type auditNoop struct{}

func (auditNoop) Log(ctx context.Context, actor, action, entity, entityID string, details map[string]any) error {
	return nil
}

// TestTicketConcurrencyIntegration : deux créations simultanées → numéros uniques
// (verrou du compteur en base, parité localDb ticketCounter).
func TestTicketConcurrencyIntegration(t *testing.T) {
	itest.LockTestDB(t)
	dsn := os.Getenv("ECLAT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ECLAT_TEST_DATABASE_URL non défini")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	if _, err := migrate.Migrate(ctx, pool, "../../migrations"); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	if _, err := pool.Exec(ctx, `TRUNCATE orders, order_items, payments, clients, ticket_counters, idempotency_keys CASCADE`); err != nil {
		t.Fatalf("reset: %v", err)
	}
	txm := dbtx.NewTxManager(pool)
	orderSvc := service.NewOrderService(&postgres.OrderRepo{}, &postgres.CatalogRepo{},
		&postgres.PaymentRepo{}, &postgres.SettingsRepo{}, &postgres.ClientRepo{},
		&postgres.TicketRepo{}, &postgres.ZoneRepo{}, txm, auditNoop{})

	const n = 12
	errs := make([]error, n)
	tickets := make([]string, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			o, err := orderSvc.Create(ctx, service.PricingInput{
				ClientName: "Passage", ClientPhone: "-",
				Items: []pressing.OrderLineItem{{
					CatalogItemID: nil, Name: "Divers", Mode: pressing.ModeRepassageSeul,
					Quantity: 1, Unit: "pièce", UnitPriceFCFA: 500}},
				InitialPaymentMethod: pressing.MethodEspeces,
			}, nil, "")
			if err != nil {
				errs[i] = err
				return
			}
			tickets[i] = o.TicketNumber
		}(i)
	}
	wg.Wait()
	seen := map[string]bool{}
	for i := 0; i < n; i++ {
		if errs[i] != nil {
			t.Fatalf("création %d: %v", i, errs[i])
		}
		if seen[tickets[i]] {
			t.Fatalf("ticket dupliqué: %s", tickets[i])
		}
		seen[tickets[i]] = true
	}
	if len(seen) != n {
		t.Fatalf("tickets uniques attendus %d, obtenu %d", n, len(seen))
	}
}

// TestClientBonusAndInventoryIntegration : recharge + bonus avec historique,
// mouvements stock (entrée/sortie/ajustement, insuffisant rejeté, dépense auto).
func TestClientBonusAndInventoryIntegration(t *testing.T) {
	itest.LockTestDB(t)
	dsn := os.Getenv("ECLAT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ECLAT_TEST_DATABASE_URL non défini")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	if _, err := migrate.Migrate(ctx, pool, "../../migrations"); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	if _, err := pool.Exec(ctx, `TRUNCATE orders, payments, clients, client_wallet_entries,
		expenses, inventory_items, inventory_movements, idempotency_keys CASCADE`); err != nil {
		t.Fatalf("reset: %v", err)
	}
	txm := dbtx.NewTxManager(pool)
	noop := auditNoop{}
	clientSvc := service.NewClientService(&postgres.ClientRepo{}, &postgres.PaymentRepo{}, txm, noop)
	inventorySvc := service.NewInventoryService(&postgres.InventoryRepo{}, txm, noop)
	expenseRepo := &postgres.ExpenseRepo{}

	// recharge 10000 + bonus 2000
	cl, err := clientSvc.Save(ctx, &pressing.Client{FullName: "Bonus Test", Phone: "0788888888"})
	if err != nil {
		t.Fatalf("client: %v", err)
	}
	upd, err := clientSvc.Topup(ctx, cl.ID, service.TopupIn{
		AmountFCFA: 10000, BonusFCFA: 2000, Method: pressing.MethodOrangeMoney, Note: "Offre mois"})
	if err != nil {
		t.Fatalf("topup+bonus: %v", err)
	}
	if upd.PrepaidBalanceFCFA != 12000 {
		t.Fatalf("solde attendu 12000: %d", upd.PrepaidBalanceFCFA)
	}
	if len(upd.WalletHistory) != 2 {
		t.Fatalf("historique attendu 2 entrées: %+v", upd.WalletHistory)
	}
	var bonusFound, rechargeFound bool
	for _, e := range upd.WalletHistory {
		if e.Type == "bonus" && e.AmountFCFA == 2000 {
			bonusFound = true
		}
		if e.Type == "recharge" && e.AmountFCFA == 10000 {
			rechargeFound = true
		}
	}
	if !bonusFound || !rechargeFound {
		t.Fatalf("bonus/recharge absents: %+v", upd.WalletHistory)
	}
	payments, err := clientSvcPayments(ctx, pool)
	if err != nil || len(payments) != 1 || payments[0].Kind != "prepaid_topup" || payments[0].AmountFCFA != 10000 {
		t.Fatalf("payment kind prepaid_topup: %+v err=%v", payments, err)
	}

	// inventaire
	item, err := inventorySvc.Save(ctx, &pressing.InventoryItem{
		Name: "Hangers", Category: "Matériel", ActivityScope: pressing.ScopeBoth,
		Unit: "pièce", Quantity: 5, MinThreshold: 10, UnitCostFCFA: 100})
	if err != nil {
		t.Fatalf("item: %v", err)
	}
	cost := int64(300)
	if _, err := inventorySvc.Movement(ctx, item.ID, service.MovementIn{
		Type: pressing.MovementEntree, Quantity: 3, UnitCostFCFA: &cost,
		RecordExpense: true, PaymentMethod: pressing.MethodEspeces}, expenseRepo); err != nil {
		t.Fatalf("entrée: %v", err)
	}
	got, _ := inventorySvc.List(ctx)
	if got[0].Quantity != 8 || got[0].UnitCostFCFA != 300 {
		t.Fatalf("après entrée: %+v", got[0])
	}
	if _, err := inventorySvc.Movement(ctx, item.ID, service.MovementIn{
		Type: pressing.MovementSortie, Quantity: 9}, expenseRepo); !service.IsBusinessError(err) {
		t.Fatalf("sortie excessive acceptée: %v", err)
	}
	if _, err := inventorySvc.Movement(ctx, item.ID, service.MovementIn{
		Type: pressing.MovementSortie, Quantity: 2}, expenseRepo); err != nil {
		t.Fatalf("sortie: %v", err)
	}
	if _, err := inventorySvc.Movement(ctx, item.ID, service.MovementIn{
		Type: pressing.MovementAjustement, Quantity: 20}, expenseRepo); err != nil {
		t.Fatalf("ajustement: %v", err)
	}
	got, _ = inventorySvc.List(ctx)
	if got[0].Quantity != 20 {
		t.Fatalf("après ajustement: %+v", got[0])
	}
	moves, err := inventorySvc.Movements(ctx, item.ID, 50)
	if err != nil || len(moves) != 3 {
		t.Fatalf("mouvements: %v %d", err, len(moves))
	}
	exp, _, err := (&postgres.ExpenseRepo{}).List(ctx, pool, "", "", 10, 0)
	if err != nil || len(exp) != 1 || exp[0].AmountFCFA != 900 { // 3 × 300
		t.Fatalf("dépense auto: %v %+v", err, exp)
	}
	// idempotence mouvement
	if _, err := inventorySvc.Movement(ctx, item.ID, service.MovementIn{
		Type: pressing.MovementSortie, Quantity: 1, IdempotencyKey: "mv-1"}, expenseRepo); err != nil {
		t.Fatalf("sortie idem: %v", err)
	}
	if _, err := inventorySvc.Movement(ctx, item.ID, service.MovementIn{
		Type: pressing.MovementSortie, Quantity: 1, IdempotencyKey: "mv-1"}, expenseRepo); !errors.Is(err, service.ErrIdempotentReplay) {
		t.Fatalf("replay mouvement: %v", err)
	}
	if got, _ = inventorySvc.List(ctx); got[0].Quantity != 19 {
		t.Fatalf("double sortie appliquée: %+v", got[0])
	}
}

func clientSvcPayments(ctx context.Context, pool *pgxpool.Pool) ([]*pressing.PaymentRecord, error) {
	rows, err := pool.Query(ctx, `SELECT id, order_id, ticket_number, client_name, amount_fcfa, method, to_char(paid_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), type, kind FROM payments`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*pressing.PaymentRecord{}
	for rows.Next() {
		p := &pressing.PaymentRecord{}
		if err := rows.Scan(&p.ID, &p.OrderID, &p.TicketNumber, &p.ClientName, &p.AmountFCFA, &p.Method, &p.PaidAt, &p.Type, &p.Kind); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
