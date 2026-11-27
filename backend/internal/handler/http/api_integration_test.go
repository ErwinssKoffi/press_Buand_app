package http_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/erwinsskoffi/press_backend/internal/backup"
	"github.com/erwinsskoffi/press_backend/internal/domain/auth"
	httph "github.com/erwinsskoffi/press_backend/internal/handler/http"
	"github.com/erwinsskoffi/press_backend/internal/platform/dbtx"
	"github.com/erwinsskoffi/press_backend/internal/platform/itest"
	"github.com/erwinsskoffi/press_backend/internal/platform/migrate"
	"github.com/erwinsskoffi/press_backend/internal/repository/postgres"
	"github.com/erwinsskoffi/press_backend/internal/server"
	"github.com/erwinsskoffi/press_backend/internal/service"
)

// newFullStackServer : serveur HTTP complet (auth + API métier) sur PG réel.
func newFullStackServer(t *testing.T) (*httptest.Server, *pgxpool.Pool) {
	t.Helper()
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
	if _, err := pool.Exec(ctx, `TRUNCATE auth_sessions CASCADE; DELETE FROM auth_credentials;
		TRUNCATE orders, order_items, order_claim_photos, payments, clients, client_wallet_entries,
		expenses, delivery_zones, logistics_tasks, inventory_items, inventory_movements,
		catalog_items, ticket_counters, idempotency_keys CASCADE`); err != nil {
		t.Fatalf("reset: %v", err)
	}

	txm := dbtx.NewTxManager(pool)
	audit := postgres.NewAuditRepo(pool)
	policy := auth.Policy{MaxAttempts: 5, Lockout: time.Minute, AllowWeakPIN: true, SessionTTL: time.Hour}
	repos := postgres.New(pool)
	authSvc := service.NewAuthService(repos.Auth, repos.Auth, audit, policy)
	authH := httph.NewAuthHandlers(authSvc, false, "")

	orderRepo := &postgres.OrderRepo{}
	paymentRepo := &postgres.PaymentRepo{}
	settingsRepo := &postgres.SettingsRepo{}
	catalogRepo := &postgres.CatalogRepo{}
	clientRepo := &postgres.ClientRepo{}
	ticketRepo := &postgres.TicketRepo{}
	zoneRepo := &postgres.ZoneRepo{}
	expenseRepo := &postgres.ExpenseRepo{}
	orderSvc := service.NewOrderService(orderRepo, catalogRepo, paymentRepo, settingsRepo, clientRepo, ticketRepo, zoneRepo, txm, audit)
	orderSvc.SetStorageDir(t.TempDir())
	settingsSvc := service.NewSettingsService(settingsRepo, txm, audit)
	catalogSvc := service.NewCatalogService(catalogRepo, txm, audit)
	clientSvc := service.NewClientService(clientRepo, paymentRepo, txm, audit)
	logisticsSvc := service.NewLogisticsService(&postgres.LogisticsRepo{}, zoneRepo, txm, audit)
	inventorySvc := service.NewInventoryService(&postgres.InventoryRepo{}, txm, audit)
	cashbookSvc := service.NewCashbookService(expenseRepo, txm, audit)
	api := httph.NewAPI(orderSvc,
		settingsSvc,
		catalogSvc,
		clientSvc,
		logisticsSvc,
		inventorySvc,
		cashbookSvc,
		service.NewReportsService(&postgres.ReportRepo{}, txm),
		expenseRepo, backup.NewService(pool, t.TempDir()),
		service.NewSyncService(pool, orderSvc, settingsSvc, catalogSvc, clientSvc, logisticsSvc, inventorySvc, cashbookSvc, expenseRepo))
	router := chi.NewRouter()
	api.Routes(router)

	srv := server.New(server.Deps{
		Pool:         pool,
		AuthSvc:      authSvc,
		AuthHandlers: authH,
		APIRouter:    router,
		CORSOrigins:  []string{"http://localhost:5173"},
	})
	ts := httptest.NewServer(srv.Handler)
	t.Cleanup(ts.Close)
	return ts, pool
}

// client : cookiejar + helpers de requête.
type testClient struct {
	t  *testing.T
	ts *httptest.Server
	hc *http.Client
}

func newTestClient(t *testing.T, ts *httptest.Server) *testClient {
	jar, _ := cookiejar.New(nil)
	return &testClient{t: t, ts: ts, hc: &http.Client{Jar: jar}}
}

// doRaw : requête JSON ; retourne (status, tableau décodé, erreur).
func (c *testClient) doRaw(method, path string) (int, []map[string]any, error) {
	c.t.Helper()
	req, _ := http.NewRequest(method, c.ts.URL+path, nil)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.hc.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	var arr []map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&arr)
	return resp.StatusCode, arr, nil
}

// do : requête JSON ; retourne (status, corps décodé).
func (c *testClient) do(method, path string, body any) (int, map[string]any) {
	c.t.Helper()
	var rd *strings.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = strings.NewReader(string(b))
	} else {
		rd = strings.NewReader("")
	}
	req, _ := http.NewRequest(method, c.ts.URL+path, rd)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.hc.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	out := map[string]any{}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func TestAPIFullStackIntegration(t *testing.T) {
	ts, _ := newFullStackServer(t)
	c := newTestClient(t, ts)

	// --- auth ---
	if st, _ := c.do("GET", "/auth/status", nil); st != 200 {
		t.Fatalf("status: %d", st)
	}
	if st, _ := c.do("POST", "/auth/setup", map[string]string{"secret": "54321"}); st != 204 {
		t.Fatalf("setup: %d", st)
	}
	// métier protégé : 401 sans session
	if st, body := c.do("GET", "/api/v1/settings", nil); st != 401 || codeOf(body) != "unauthorized" {
		t.Fatalf("settings sans session: %d %v", st, body)
	}
	if st, _ := c.do("POST", "/auth/login", map[string]string{"pinOrPassword": "54321"}); st != 200 {
		t.Fatalf("login: %d", st)
	}

	// --- settings (validation + succès) ---
	if st, body := c.do("PUT", "/api/v1/settings", map[string]any{"shopName": "", "activityScope": "both"}); st != 400 || codeOf(body) != "invalid_request" {
		t.Fatalf("settings invalide: %d %v", st, body)
	}
	if st, _ := c.do("PUT", "/api/v1/settings", map[string]any{
		"shopName": "Éclat", "activityScope": "both", "expressPercent": 50,
		"pressingConfig": map[string]any{"pricePerKgByMode": map[string]int64{"lavage_repassage": 1500}, "expressPercent": 50},
		"loyaltyConfig":  map[string]any{"enabled": true, "fcfaPerPoint": 1000, "rewardThresholdPoints": 50, "rewardDiscountFCFA": 2000},
	}); st != 200 {
		t.Fatalf("settings: %d", st)
	}
	if st, body := c.do("GET", "/api/v1/settings", nil); st != 200 || body["shopName"] != "Éclat" {
		t.Fatalf("settings get: %d %v", st, body)
	}

	// --- catalog ---
	if st, _ := c.do("POST", "/api/v1/catalog", map[string]any{
		"id": "cat-chemise", "name": "Chemise", "category": "Habit",
		"defaultMode": "lavage_repassage", "priceFCFA": 1000, "unit": "pièce"}); st != 201 {
		t.Fatalf("catalog: %d", st)
	}
	if st, body := c.do("POST", "/api/v1/catalog", map[string]any{"name": "X", "priceFCFA": 1000, "unit": "mètre", "defaultMode": "lavage_repassage"}); st != 400 || codeOf(body) != "invalid_request" {
		t.Fatalf("catalog unité invalide: %d %v", st, body)
	}
	if st, _ := c.do("PUT", "/api/v1/catalog/cat-chemise", map[string]any{
		"name": "Chemise", "category": "Habit", "defaultMode": "lavage_repassage", "priceFCFA": 1200, "unit": "pièce"}); st != 200 {
		t.Fatalf("catalog put: %d", st)
	}

	// --- zones ---
	if st, _ := c.do("POST", "/api/v1/delivery-zones", map[string]any{
		"id": "zone-cocody", "commune": "Cocody", "feeFCFA": 1500, "pickupFeeFCFA": 1000, "active": true}); st != 201 {
		t.Fatalf("zone: %d", st)
	}

	// --- clients + topup (idempotence) ---
	st, cl := c.do("POST", "/api/v1/clients", map[string]any{"fullName": "Aya Koffi", "phone": "0102030405", "commune": "Cocody"})
	if st != 201 {
		t.Fatalf("client: %d", st)
	}
	clID := cl["id"].(string)
	if st, _ := c.do("POST", fmt.Sprintf("/api/v1/clients/%s/wallet/topups", clID),
		map[string]any{"amountFCFA": 20000, "method": "especes", "idempotencyKey": "top-1"}); st != 200 {
		t.Fatalf("topup: %d", st)
	}
	// replay topup sans encaisser deux fois
	st, again := c.do("POST", fmt.Sprintf("/api/v1/clients/%s/wallet/topups", clID),
		map[string]any{"amountFCFA": 20000, "method": "especes", "idempotencyKey": "top-1"})
	if st != 409 || codeOf(again) != "conflict" {
		t.Fatalf("topup replay: %d %v", st, again)
	}
	st, got := c.do("GET", fmt.Sprintf("/api/v1/clients/%s", clID), nil)
	if st != 200 || got["prepaidBalanceFCFA"].(float64) != 20000 {
		t.Fatalf("solde après replay: %d %v", st, got["prepaidBalanceFCFA"])
	}

	// --- orders : Idempotency-Key requis ---
	orderBody := map[string]any{
		"clientId": clID,
		"items": []map[string]any{{
			"catalogItemId": "cat-chemise", "name": "Chemise",
			"mode": "lavage_repassage", "quantity": 2, "unit": "pièce"}},
		"deliveryZoneId":       "zone-cocody",
		"usePrepaid":           true,
		"initialPaymentMethod": "especes",
	}
	if st, body := c.do("POST", "/api/v1/orders", orderBody); st != 400 || codeOf(body) != "invalid_request" {
		t.Fatalf("sans Idempotency-Key: %d %v", st, body)
	}
	orderBody["idempotencyKey"] = "ord-1"
	st, ord := c.do("POST", "/api/v1/orders", orderBody)
	if st != 201 {
		t.Fatalf("order: %d %v", st, ord)
	}
	if ord["totalFCFA"].(float64) != 3900 || ord["prepaidUsedFCFA"].(float64) != 3900 {
		t.Fatalf("order totaux: %v", ord)
	}
	if ord["ticketNumber"] != "EP-2026-0001" {
		t.Fatalf("ticket: %v", ord["ticketNumber"])
	}
	ordID := ord["id"].(string)
	// replay → 409
	if st, body := c.do("POST", "/api/v1/orders", orderBody); st != 409 || codeOf(body) != "conflict" {
		t.Fatalf("order replay: %d %v", st, body)
	}
	// mapping : aperçu sans écriture
	if st, m := c.do("POST", "/api/v1/orders/mapping", map[string]any{
		"clientId": clID, "items": orderBody["items"], "deliveryZoneId": "zone-cocody", "usePrepaid": true}); st != 200 {
		t.Fatalf("mapping: %d", st)
	} else if m["actualPrepaidUsedFCFA"].(float64) != 3900 {
		t.Fatalf("mapping prépayé: %v", m["actualPrepaidUsedFCFA"])
	}

	// --- transitions : régression 422, cible invalide 422 ---
	if st, _ := c.do("PATCH", fmt.Sprintf("/api/v1/orders/%s/status", ordID), map[string]any{}); st != 200 {
		t.Fatalf("transition: %d", st)
	}
	if st, body := c.do("PATCH", fmt.Sprintf("/api/v1/orders/%s/status", ordID), map[string]any{"status": "recu"}); st != 422 || codeOf(body) != "business_rule" {
		t.Fatalf("régression: %d %v", st, body)
	}

	// --- paiement : surpaiement 422, key manquante 400 ---
	if st, _ := c.do("POST", fmt.Sprintf("/api/v1/orders/%s/payments", ordID), map[string]any{"amountFCFA": 100, "method": "wave", "idempotencyKey": "p-1"}); st != 422 {
		t.Fatalf("surpaiement: %d", st)
	}

	// --- liste + filtres + pagination ---
	st, list := c.do("GET", "/api/v1/orders?page=1&pageSize=10", nil)
	if st != 200 || list["total"].(float64) != 1 || list["pageSize"].(float64) != 10 {
		t.Fatalf("liste: %d %v", st, list)
	}
	if st, _ := c.do("GET", "/api/v1/orders?status=livre", nil); st != 200 {
		t.Fatalf("filtre: %d", st)
	}

	// --- 404 ---
	if st, body := c.do("GET", "/api/v1/orders/nope", nil); st != 404 || codeOf(body) != "not_found" {
		t.Fatalf("404 order: %d %v", st, body)
	}
	if st, _ := c.do("GET", "/api/v1/clients/nope", nil); st != 404 {
		t.Fatalf("404 client: %d", st)
	}

	// --- dépenses + rapports ---
	if st, _ := c.do("POST", "/api/v1/expenses", map[string]any{
		"label": "Lessive", "category": "Produits & Lessive", "amountFCFA": 7500,
		"method": "especes", "date": time.Now().Format("2006-01-02")}); st != 201 {
		t.Fatalf("expense: %d", st)
	}
	if st, body := c.do("POST", "/api/v1/expenses", map[string]any{
		"label": "Négative", "amountFCFA": -5, "method": "especes", "date": "2026-01-01"}); st != 400 || codeOf(body) != "invalid_request" {
		t.Fatalf("expense invalide: %d %v", st, body)
	}
	if st, body := c.do("POST", "/api/v1/expenses", map[string]any{
		"label": "Moyen invalide", "amountFCFA": 500, "method": "bitcoin", "date": "2026-01-01"}); st != 400 || codeOf(body) != "invalid_request" {
		t.Fatalf("expense moyen invalide: %d %v", st, body)
	}
	st, z := c.do("GET", "/api/v1/reports/daily-z", nil)
	if st != 200 {
		t.Fatalf("daily-z: %d %v", st, z)
	}
	if z["revenueTotal"].(float64) != 20000 || z["revenuePrepaidTopup"].(float64) != 20000 ||
		z["expensesTotal"].(float64) != 7500 || z["netCash"].(float64) != 12500 {
		t.Fatalf("daily-z agrégats: %v", z)
	}
	if st, m := c.do("GET", "/api/v1/reports/monthly", nil); st != 200 || m["month"] == nil {
		t.Fatalf("monthly: %d %v", st, m)
	}

	// --- logistique : PATCH status ---
	if st, task := c.do("POST", "/api/v1/logistics", map[string]any{
		"type": "livraison", "status": "planifie", "clientId": clID, "clientName": "Aya Koffi",
		"commune": "Cocody", "orderId": ordID, "scheduledDate": "2026-11-28"}); st != 201 {
		t.Fatalf("task: %d", st)
	} else {
		tkID := task["id"].(string)
		if st, _ := c.do("PATCH", fmt.Sprintf("/api/v1/logistics/%s/status", tkID), map[string]any{"status": "effectue"}); st != 200 {
			t.Fatalf("task status: %d", st)
		}
		if st, o := c.do("GET", fmt.Sprintf("/api/v1/orders/%s", ordID), nil); st != 200 || o["status"] != "livre" {
			t.Fatalf("order après livraison: %d %v", st, o["status"])
		}
	}

	// --- inventaire : mouvement idempotent ---
	if st, _ := c.do("POST", "/api/v1/inventory", map[string]any{
		"id": "inv-1", "name": "Lessive", "category": "Produits", "activityScope": "both",
		"unit": "kg", "quantity": 0, "minThreshold": 1, "unitCostFCFA": 1500}); st != 201 {
		t.Fatalf("item: %d", st)
	}
	if st, _ := c.do("POST", "/api/v1/inventory/inv-1/movements",
		map[string]any{"type": "entree", "quantity": 5, "idempotencyKey": "mv-1"}); st != 200 {
		t.Fatalf("movement: %d", st)
	}
	if st, body := c.do("POST", "/api/v1/inventory/inv-1/movements",
		map[string]any{"type": "entree", "quantity": 5, "idempotencyKey": "mv-1"}); st != 409 {
		t.Fatalf("movement replay: %d %v", st, body)
	}
	if st, body := c.do("POST", "/api/v1/inventory/inv-1/movements",
		map[string]any{"type": "sortie", "quantity": 50, "idempotencyKey": "mv-2"}); st != 422 {
		t.Fatalf("sortie excessive: %d %v", st, body)
	}
	st, invRaw := c.do("GET", "/api/v1/inventory", nil)
	if st != 200 {
		t.Fatalf("inventory: %d %v", st, invRaw)
	}
	invArr, _ := invRaw["items"].([]any)
	_ = invArr
	// la liste inventory renvoie un tableau JSON direct
	st2, inv2, _ := c.doRaw("GET", "/api/v1/inventory")
	if st2 != 200 || len(inv2) != 1 || inv2[0]["quantity"].(float64) != 5 {
		t.Fatalf("inventory contenu: %d %v", st2, inv2)
	}

	// photo de réserve : data URL → stockage privé → lecture authentifiée
	photoOrder := map[string]any{
		"clientId": clID,
		"items": []map[string]any{{
			"catalogItemId": "cat-chemise", "name": "Chemise",
			"mode": "lavage_repassage", "quantity": 1, "unit": "pièce"}},
		"initialPaymentMethod": "especes",
		"idempotencyKey":       "ord-photo",
		"claimPhotos": []map[string]any{{
			"id": "ph-t1", "caption": "Tache", "itemName": "Chemise",
			"capturedAt": "2026-11-27T10:00:00Z",
			"url":        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}},
	}
	st, pord := c.do("POST", "/api/v1/orders", photoOrder)
	if st != 201 {
		t.Fatalf("order photo: %d %v", st, pord)
	}
	phArr, _ := pord["claimPhotos"].([]any)
	if len(phArr) != 1 {
		t.Fatalf("claimPhotos vides: %v", pord["claimPhotos"])
	}
	phURL := phArr[0].(map[string]any)["url"].(string)
	if strings.HasPrefix(phURL, "data:") {
		t.Fatalf("photo data URL stockée en base (interdit): %s", phURL)
	}
	reqP, _ := http.NewRequest("GET", ts.URL+phURL, nil)
	respP, err := c.hc.Do(reqP)
	if err != nil {
		t.Fatalf("photo GET: %v", err)
	}
	pdata, _ := io.ReadAll(respP.Body)
	respP.Body.Close()
	if respP.StatusCode != 200 || len(pdata) == 0 || respP.Header.Get("Content-Type") == "" {
		t.Fatalf("photo lecture: %d %d octets: %s (url=%s)", respP.StatusCode, len(pdata), string(pdata), phURL)
	}
	_ = ordID

	// --- backup export/preview + stubs ---
	if st, ex := c.do("GET", "/api/v1/backup/export", nil); st != 200 || ex["version"].(float64) != 3 {
		t.Fatalf("export: %d %v", st, ex)
	}
	minimal := map[string]any{
		"version": 3, "exportedAt": "2026-11-27T00:00:00Z",
		"settings": map[string]any{"id": "default", "shopName": "Test Shop", "nextTicketSequence": 1, "activityScope": "both"},
		"clients": []any{map[string]any{"id": "cl-x", "fullName": "X", "phone": "1", "createdAt": "2026-01-01T00:00:00Z"},
			map[string]any{"id": "cl-y", "fullName": "Y", "phone": "2", "createdAt": "2026-01-01T00:00:00Z"}},
		"orders": []any{},
	}
	if st, pv := c.do("POST", "/api/v1/backup/preview", minimal); st != 200 || pv["status"] != "preview" {
		t.Fatalf("preview: %d %v", st, pv)
	}
	if st, body := c.do("POST", "/api/v1/backup/preview", map[string]any{"version": 2}); st != 422 || codeOf(body) != "business_rule" {
		t.Fatalf("preview invalide: %d %v", st, body)
	}
	// restore protégé : sans confirmation → 400
	if st, body := c.do("POST", "/api/v1/backup/restore", minimal); st != 400 {
		t.Fatalf("restore sans confirm: %d %v", st, body)
	}
	// restore confirmé → données remplacées
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/backup/restore", bytes.NewReader(mustJSON(minimal)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Backup-Confirm", "true")
	resp2, err := c.hc.Do(req)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	body2, _ := io.ReadAll(resp2.Body)
	resp2.Body.Close()
	if resp2.StatusCode != 200 {
		t.Fatalf("restore: %d %s", resp2.StatusCode, string(body2))
	}
	if st, body := c.do("POST", "/api/v1/backup/restore", map[string]any{}); st != 422 || codeOf(body) != "business_rule" {
		t.Fatalf("restore invalide: %d %v", st, body)
	}
	if st, stb := c.do("GET", "/api/v1/sync/status", nil); st != 200 || stb["cursor"] == nil {
		t.Fatalf("sync status: %d %v", st, stb)
	}

	// --- bootstrap ---
	st, boot := c.do("GET", "/api/v1/bootstrap", nil)
	if st != 200 {
		t.Fatalf("bootstrap: %d", st)
	}
	for _, k := range []string{"settings", "catalog", "clients", "orders", "payments", "expenses", "zones", "logistics", "inventory", "inventoryMovements", "sync"} {
		if _, ok := boot[k]; !ok {
			t.Fatalf("bootstrap champ manquant: %s", k)
		}
	}

	// --- logout → 401 ensuite ---
	if st, _ := c.do("POST", "/auth/logout", nil); st != 204 {
		t.Fatalf("logout: %d", st)
	}
	if st, _ := c.do("GET", "/api/v1/settings", nil); st != 401 {
		t.Fatalf("après logout: %d", st)
	}

	_ = bytes.MinRead
}

func codeOf(body map[string]any) string {
	e, _ := body["error"].(map[string]any)
	if e == nil {
		return ""
	}
	s, _ := e["code"].(string)
	return s
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
