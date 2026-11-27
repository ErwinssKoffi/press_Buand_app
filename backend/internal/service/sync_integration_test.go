package service_test

import (
	"context"
	"encoding/json"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/erwinsskoffi/press_backend/internal/domain/pressing"
	"github.com/erwinsskoffi/press_backend/internal/platform/dbtx"
	"github.com/erwinsskoffi/press_backend/internal/platform/itest"
	"github.com/erwinsskoffi/press_backend/internal/platform/migrate"
	"github.com/erwinsskoffi/press_backend/internal/repository/postgres"
	"github.com/erwinsskoffi/press_backend/internal/service"
)

type syncFixture struct {
	pool    *pgxpool.Pool
	sync    *service.SyncService
	orders  *service.OrderService
	catalog *service.CatalogService
	clients *service.ClientService
}

func freshSync(t *testing.T) *syncFixture {
	t.Helper()
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
	if _, err := pool.Exec(ctx, `TRUNCATE sync_operations, devices, order_claim_photos, order_items, orders,
		payments, client_wallet_entries, clients, catalog_items, expenses, delivery_zones,
		logistics_tasks, inventory_movements, inventory_items, ticket_counters, idempotency_keys CASCADE`); err != nil {
		t.Fatalf("reset: %v", err)
	}

	txm := dbtx.NewTxManager(pool)
	audit := postgres.NewAuditRepo(pool)
	orderRepo := &postgres.OrderRepo{}
	paymentRepo := &postgres.PaymentRepo{}
	settingsRepo := &postgres.SettingsRepo{}
	catalogRepo := &postgres.CatalogRepo{}
	clientRepo := &postgres.ClientRepo{}
	ticketRepo := &postgres.TicketRepo{}
	zoneRepo := &postgres.ZoneRepo{}
	expenseRepo := &postgres.ExpenseRepo{}

	settingsSvc := service.NewSettingsService(settingsRepo, txm, audit)
	catalogSvc := service.NewCatalogService(catalogRepo, txm, audit)
	clientSvc := service.NewClientService(clientRepo, paymentRepo, txm, audit)
	logisticsSvc := service.NewLogisticsService(&postgres.LogisticsRepo{}, zoneRepo, txm, audit)
	inventorySvc := service.NewInventoryService(&postgres.InventoryRepo{}, txm, audit)
	cashbookSvc := service.NewCashbookService(expenseRepo, txm, audit)
	orderSvc := service.NewOrderService(orderRepo, catalogRepo, paymentRepo, settingsRepo, clientRepo, ticketRepo, zoneRepo, txm, audit)

	// catalogue + zone de référence (seed minimal non sensible)
	if _, err := pool.Exec(ctx, `INSERT INTO catalog_items (id, name, category, default_mode, price_fcfa, unit, active)
		VALUES ('cat-1','Chemise','Quotidien','lavage_repassage',1000,'pièce',true) ON CONFLICT DO NOTHING`); err != nil {
		t.Fatalf("seed catalog: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO delivery_zones (id, commune, fee_fcfa, pickup_fee_fcfa, active)
		VALUES ('zone-1','Cocody',1500,1000,true) ON CONFLICT DO NOTHING`); err != nil {
		t.Fatalf("seed zone: %v", err)
	}
	seed := &pressing.PressingSettings{ID: "default", ShopName: "Sync Test", ActivityScope: "both",
		ExpressPercent: 50, OnboardingCompleted: true}
	if _, err := settingsSvc.Update(ctx, seed); err != nil {
		t.Fatalf("seed settings: %v", err)
	}

	syncSvc := service.NewSyncService(pool, orderSvc, settingsSvc, catalogSvc, clientSvc, logisticsSvc, inventorySvc, cashbookSvc, expenseRepo)
	return &syncFixture{pool: pool, sync: syncSvc, orders: orderSvc, catalog: catalogSvc, clients: clientSvc}
}

func op(operationID, typ string, payload any) service.SyncOperation {
	raw, _ := json.Marshal(payload)
	return service.SyncOperation{OperationID: operationID, Type: typ, Payload: raw,
		LocalCreatedAt: time.Now().UTC().Format(time.RFC3339)}
}

func orderPayload(clientID *string, name, phone string, price int64, acceptPricing bool) map[string]any {
	return map[string]any{
		"clientId":    clientID,
		"clientName":  name,
		"clientPhone": phone,
		"commune":     "Cocody",
		"items": []map[string]any{{
			"catalogItemId": "cat-1", "name": "Chemise", "mode": "lavage_repassage",
			"quantity": 2, "unit": "pièce", "unitPriceFCFA": price}},
		"deliveryZoneId":       "zone-1",
		"initialPaymentMethod": "especes",
		"initialCashPaidFCFA":  0,
		"dropOffDate":          "2026-11-27",
		"acceptPricing":        acceptPricing,
		"seenTotalFCFA":        price*2 + 1500,
	}
}

func resultOf(t *testing.T, results []service.SyncOpResult, operationID string) service.SyncOpResult {
	t.Helper()
	for _, r := range results {
		if r.OperationID == operationID {
			return r
		}
	}
	t.Fatalf("résultat absent pour %s", operationID)
	return service.SyncOpResult{}
}

// 1+2. création offline puis sync ; client créé offline référencé par une commande.
func TestSyncClientThenOrderIntegration(t *testing.T) {
	f := freshSync(t)
	ctx := context.Background()

	in := service.SyncPushIn{DeviceID: "dev-A", Operations: []service.SyncOperation{
		op("11111111-1111-4111-8111-111111111111", "client.create", map[string]any{
			"id": "11111111-1111-4111-8111-111111111111", "fullName": "Aya Sync",
			"phone": "0700000001", "commune": "Cocody", "createdAt": "2026-11-27T08:00:00Z"}),
	}}
	results, cursor, err := f.sync.Push(ctx, in)
	if err != nil || len(results) != 1 || results[0].Status != "accepted" {
		t.Fatalf("client.create: %v %+v", err, results)
	}
	if cursor == 0 {
		t.Fatalf("cursor nul")
	}

	clientID := "11111111-1111-4111-8111-111111111111"
	in2 := service.SyncPushIn{DeviceID: "dev-A", Operations: []service.SyncOperation{
		op("22222222-2222-4222-8222-222222222222", "order.create", orderPayload(&clientID, "Aya Sync", "0700000001", 1000, false)),
	}}
	results2, _, err := f.sync.Push(ctx, in2)
	if err != nil {
		t.Fatalf("order.create: %v", err)
	}
	r := resultOf(t, results2, "22222222-2222-4222-8222-222222222222")
	if r.Status != "accepted" || r.OfficialTicket == "" {
		t.Fatalf("order sync: %+v", r)
	}
	// ticket officiel serveur (EP-2026-0001) — pas la référence provisoire
	if r.OfficialTicket != "EP-2026-0001" {
		t.Fatalf("ticket attendu EP-2026-0001, obtenu %s", r.OfficialTicket)
	}
	// l'ID client provisoire (UUID) est conservé comme ID réel → réconciliation triviale
	var clientCount int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM clients WHERE id=$1`, clientID).Scan(&clientCount)
	if clientCount != 1 {
		t.Fatalf("client provisoire non conservé: %d", clientCount)
	}
	// la commande reçoit un ID serveur ; le mapping provisoire→officiel est
	// dans le journal (utilisé par resolveRef, testé par le test paiements)
	entityOrder := r.Entity["order"].(*pressing.Order)
	if entityOrder.ID == "" || entityOrder.ID == clientID {
		t.Fatalf("ID serveur inattendu: %s", entityOrder.ID)
	}
	// total recalculé serveur : 2×1000 + zone 1500 = 3500 ; cash 0 → non soldée
	if entityOrder.TotalFCFA != 3500 || entityOrder.PaidFCFA != 0 {
		t.Fatalf("totaux recalculés: total=%d paid=%d", entityOrder.TotalFCFA, entityOrder.PaidFCFA)
	}
}

// 3. timeout après écriture serveur puis retry → duplicate, aucun doublon.
func TestSyncRetryAfterTimeoutNoDuplicationIntegration(t *testing.T) {
	f := freshSync(t)
	ctx := context.Background()
	opID := "33333333-3333-4333-8333-333333333333"
	in := service.SyncPushIn{DeviceID: "dev-A", Operations: []service.SyncOperation{
		op(opID, "order.create", orderPayload(nil, "Walk Client", "0700000002", 1000, false))}}
	r1, _, err := f.sync.Push(ctx, in)
	if err != nil || resultOf(t, r1, opID).Status != "accepted" {
		t.Fatalf("première push: %v %+v", err, r1)
	}
	// « timeout » : le terminal renvoie la même opération (pas d'accusé reçu)
	r2, _, err := f.sync.Push(ctx, in)
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	r := resultOf(t, r2, opID)
	if r.Status != "duplicate" {
		t.Fatalf("retry doit être duplicate: %+v", r)
	}
	var count int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM orders`).Scan(&count)
	if count != 1 {
		t.Fatalf("doublon créé ! orders=%d", count)
	}
}

// 4. double paiement soumis → un seul encaissement ; surpaiement rejeté.
func TestSyncDoublePaymentIntegration(t *testing.T) {
	f := freshSync(t)
	ctx := context.Background()
	ordID := "44444444-4444-4444-8444-444444444444"
	_, _, _ = f.sync.Push(ctx, service.SyncPushIn{DeviceID: "dev-A", Operations: []service.SyncOperation{
		op(ordID, "order.create", orderPayload(nil, "Pay Test", "0700000003", 1000, false))}})
	// paiement partiel : 2×2000 sur total 3500 → second soumis deux fois
	payOp := op("55555555-5555-4555-8555-555555555555", "order.payment",
		map[string]any{"orderId": ordID, "amountFCFA": 2000, "method": "wave"})
	r1, _, _ := f.sync.Push(ctx, service.SyncPushIn{DeviceID: "dev-A", Operations: []service.SyncOperation{payOp}})
	if resultOf(t, r1, payOp.OperationID).Status != "accepted" {
		t.Fatalf("paiement 1: %+v", r1)
	}
	r2, _, _ := f.sync.Push(ctx, service.SyncPushIn{DeviceID: "dev-A", Operations: []service.SyncOperation{payOp}})
	if resultOf(t, r2, payOp.OperationID).Status != "duplicate" {
		t.Fatalf("paiement rejoué doit être duplicate: %+v", r2)
	}
	var count int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM payments`).Scan(&count)
	if count != 1 {
		t.Fatalf("double encaissement ! payments=%d", count)
	}
	// surpaiement : reste 1500, tenter 5000 → rejected overpayment
	r3, _, _ := f.sync.Push(ctx, service.SyncPushIn{DeviceID: "dev-A", Operations: []service.SyncOperation{
		op("66666666-6666-4666-8666-666666666666", "order.payment",
			map[string]any{"orderId": ordID, "amountFCFA": 5000, "method": "especes"})}})
	r := resultOf(t, r3, "66666666-6666-4666-8666-666666666666")
	if r.Status != "rejected" || r.ErrorCode != "overpayment" {
		t.Fatalf("surpaiement: %+v", r)
	}
	// verdict stable au retry (journalisé)
	r4, _, _ := f.sync.Push(ctx, service.SyncPushIn{DeviceID: "dev-A", Operations: []service.SyncOperation{
		op("66666666-6666-4666-8666-666666666666", "order.payment",
			map[string]any{"orderId": ordID, "amountFCFA": 5000, "method": "especes"})}})
	if resultOf(t, r4, "66666666-6666-4666-8666-666666666666").Status != "rejected" {
		t.Fatalf("rejoue surpaiement: %+v", r4)
	}
}

// 5. deux appareils créent des commandes simultanément → tickets officiels uniques.
func TestSyncTwoDevicesUniqueTicketsIntegration(t *testing.T) {
	f := freshSync(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	tickets := make([]string, 2)
	for i, dev := range []string{"dev-A", "dev-B"} {
		wg.Add(1)
		go func(i int, dev string) {
			defer wg.Done()
			opID := "7777777" + map[int]string{0: "7", 1: "8"}[i] + "-7777-4777-8777-77777777777" + map[int]string{0: "7", 1: "8"}[i]
			res, _, err := f.sync.Push(ctx, service.SyncPushIn{DeviceID: dev, Operations: []service.SyncOperation{
				op(opID, "order.create", orderPayload(nil, "Dev "+dev, "070000000"+map[int]string{0: "4", 1: "5"}[i], 1000, false))}})
			if err != nil {
				t.Errorf("push %s: %v", dev, err)
				return
			}
			tickets[i] = resultOf(t, res, opID).OfficialTicket
		}(i, dev)
	}
	wg.Wait()
	if tickets[0] == "" || tickets[1] == "" || tickets[0] == tickets[1] {
		t.Fatalf("tickets identiques ou vides: %v", tickets)
	}
}

// 7. tarif modifié pendant l'absence de réseau → conflit puis acceptation explicite.
func TestSyncPricingConflictIntegration(t *testing.T) {
	f := freshSync(t)
	ctx := context.Background()
	// le prix catalogue change pendant l'offline
	if _, err := f.pool.Exec(ctx, `UPDATE catalog_items SET price_fcfa=1500, revision=nextval('change_seq') WHERE id='cat-1'`); err != nil {
		t.Fatalf("prix: %v", err)
	}
	opID := "88888888-8888-4888-8888-888888888888"
	in := service.SyncPushIn{DeviceID: "dev-A", Operations: []service.SyncOperation{
		op(opID, "order.create", orderPayload(nil, "Price Test", "0700000006", 1000, false))}}
	r1, _, _ := f.sync.Push(ctx, in)
	conflict := resultOf(t, r1, opID)
	if conflict.Status != "conflict" || conflict.ErrorCode != "pricing_changed" {
		t.Fatalf("conflit attendu: %+v", conflict)
	}
	if _, ok := conflict.Entity["recomputed"]; !ok {
		t.Fatalf("recalcul manquant dans le conflit: %+v", conflict)
	}
	// reprise manuelle : l'opérateur confirme les nouveaux tarifs
	payload := orderPayload(nil, "Price Test", "0700000006", 1000, true)
	in2 := service.SyncPushIn{DeviceID: "dev-A", Operations: []service.SyncOperation{op(opID, "order.create", payload)}}
	r2, _, _ := f.sync.Push(ctx, in2)
	acc := resultOf(t, r2, opID)
	if acc.Status != "accepted" {
		t.Fatalf("acceptPricing: %+v", acc)
	}
	ord := acc.Entity["order"].(*pressing.Order)
	if ord.TotalFCFA != 1500*2+1500 {
		t.Fatalf("total aux nouveaux tarifs: %d", ord.TotalFCFA)
	}
}

// 6+10. modification serveur sur la même ressource + aucun écrasement de données récentes :
// client créé offline alors qu'un client au même téléphone existe → fusion (duplicate),
// et pull n'expose que les révisions > cursor (pas de renvoi complet).
func TestSyncFusionAndIncrementalPullIntegration(t *testing.T) {
	f := freshSync(t)
	ctx := context.Background()
	// client existant côté serveur (créé pendant l'offline du terminal)
	_, err := f.clients.Save(ctx, &pressing.Client{FullName: "Existant Serveur", Phone: "0700000007", Commune: "Cocody"})
	if err != nil {
		t.Fatalf("seed client: %v", err)
	}
	var cursor1 int64
	_ = f.pool.QueryRow(ctx, `SELECT last_value FROM change_seq`).Scan(&cursor1)

	// l'appareil créé le même client hors ligne (UUID provisoire différent)
	in := service.SyncPushIn{DeviceID: "dev-C", Operations: []service.SyncOperation{
		op("99999999-9999-4999-8999-999999999999", "client.create", map[string]any{
			"id": "99999999-9999-4999-8999-999999999999", "fullName": "Existant Serveur (offline)",
			"phone": "0700000007", "commune": "Cocody"})}}
	r1, _, _ := f.sync.Push(ctx, in)
	r := resultOf(t, r1, "99999999-9999-4999-8999-999999999999")
	if r.Status != "duplicate" || r.ErrorCode != "client_merged" {
		t.Fatalf("fusion attendue: %+v", r)
	}
	var count int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM clients WHERE phone='0700000007'`).Scan(&count)
	if count != 1 {
		t.Fatalf("doublon client par téléphone: %d", count)
	}

	// pull incrémental : depuis cursor1 → aucune entité renvoyée (rien de nouveau)
	pull1, err := f.sync.Pull(ctx, "dev-C", cursor1, 500)
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	if len(pull1.Changes) != 0 || pull1.HasMore {
		t.Fatalf("pull incrémental devrait être vide: %d changements", len(pull1.Changes))
	}
	// depuis 0 (appareil longtemps hors ligne) → tout l'état, paginé
	pull2, err := f.sync.Pull(ctx, "dev-C", 0, 3)
	if err != nil {
		t.Fatalf("pull complet: %v", err)
	}
	if len(pull2.Changes) != 3 || !pull2.HasMore {
		t.Fatalf("pagination: %d changements hasMore=%v", len(pull2.Changes), pull2.HasMore)
	}
	if pull2.Cursor == 0 || pull2.Cursor >= cursor1+1<<30 {
		t.Fatalf("cursor incohérent: %d", pull2.Cursor)
	}
	// reprise à partir du cursor : pas de chevauchement (aucune donnée récente écrasée)
	pull3, err := f.sync.Pull(ctx, "dev-C", pull2.Cursor, 500)
	if err != nil {
		t.Fatalf("pull suite: %v", err)
	}
	for _, c := range pull3.Changes {
		for _, prev := range pull2.Changes {
			if c.Entity == prev.Entity && c.EntityID == prev.EntityID {
				t.Fatalf("chevauchement pull: %s/%s renvoyé deux fois", c.Entity, c.EntityID)
			}
		}
	}
	// entités camelCase présentes
	found := map[string]bool{}
	for _, c := range append(pull2.Changes, pull3.Changes...) {
		found[c.Entity] = true
		if c.Data["shopName"] == nil && c.Entity == "settings" {
			t.Fatalf("settings non camelCase: %v", c.Data)
		}
	}
	for _, want := range []string{"settings", "catalog", "zones"} {
		if !found[want] {
			t.Fatalf("entité %s absente du pull", want)
		}
	}
}

// 8+9+11. appareil longtemps hors ligne : expense + mouvement + statut ; interruption
// pendant l'envoi (payload partiel) ne crée rien ; verdicts journalisés stables.
func TestSyncLongOfflineAndInterruptionIntegration(t *testing.T) {
	f := freshSync(t)
	ctx := context.Background()
	// dépense + mouvement de stock hors ligne
	expID := "aaaaaaa1-0000-4000-8000-000000000001"
	movID := "aaaaaaa2-0000-4000-8000-000000000002"
	if _, err := f.pool.Exec(ctx, `INSERT INTO inventory_items (id, name, category, activity_scope, unit, quantity, min_threshold, unit_cost_fcfa)
		VALUES ('inv-1','Lessive','Produits','both','kg',10,1,1000)`); err != nil {
		t.Fatalf("seed inv: %v", err)
	}
	res, _, err := f.sync.Push(ctx, service.SyncPushIn{DeviceID: "dev-D", Operations: []service.SyncOperation{
		op(expID, "expense.create", map[string]any{"id": expID, "label": "Sachets", "category": "Fournitures",
			"amountFCFA": 3000, "method": "especes", "date": "2026-11-27", "createdAt": "2026-11-27T08:00:00Z"}),
		op(movID, "inventory.movement", map[string]any{"itemId": "inv-1", "type": "sortie",
			"quantity": 1, "reason": "Atelier", "idempotencyNote": "test"}),
	}})
	if err != nil {
		t.Fatalf("push long offline: %v", err)
	}
	if resultOf(t, res, expID).Status != "accepted" || resultOf(t, res, movID).Status != "accepted" {
		t.Fatalf("verdicts: %+v", res)
	}
	// mouvement rejoué → duplicate (clé d'idempotence)
	res2, _, _ := f.sync.Push(ctx, service.SyncPushIn{DeviceID: "dev-D", Operations: []service.SyncOperation{
		op(movID, "inventory.movement", map[string]any{"itemId": "inv-1", "type": "sortie", "quantity": 1, "reason": "Atelier"})}})
	if resultOf(t, res2, movID).Status != "duplicate" {
		t.Fatalf("mouvement rejoué: %+v", res2)
	}
	var qty float64
	_ = f.pool.QueryRow(ctx, `SELECT quantity FROM inventory_items WHERE id='inv-1'`).Scan(&qty)
	if qty != 9 {
		t.Fatalf("stock: %v (double mouvement ?)", qty)
	}

	// type non supporté hors ligne → rejected + message clair (connexion requise)
	res3, _, _ := f.sync.Push(ctx, service.SyncPushIn{DeviceID: "dev-D", Operations: []service.SyncOperation{
		op("aaaaaaa3-0000-4000-8000-000000000003", "settings.update", map[string]any{"shopName": "Hack"})}})
	r := resultOf(t, res3, "aaaaaaa3-0000-4000-8000-000000000003")
	if r.Status != "rejected" || r.ErrorCode != "unsupported_type" {
		t.Fatalf("type interdit: %+v", r)
	}
	// statut sync
	st, err := f.sync.Status(ctx, "dev-D")
	if err != nil || st["cursor"] == nil || st["device"] == nil {
		t.Fatalf("status: %v %v", err, st)
	}
}
