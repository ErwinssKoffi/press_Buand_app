package migrate

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/erwinsskoffi/press_backend/internal/platform/itest"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	itest.LockTestDB(t)
	dsn := os.Getenv("ECLAT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ECLAT_TEST_DATABASE_URL non défini : test d'intégration sauté")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connexion: %v", err)
	}
	t.Cleanup(pool.Close)

	// base isolée : nettoyage des tables du schéma applicatif
	_, err = pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`)
	if err != nil {
		t.Fatalf("reset schéma: %v", err)
	}
	return pool
}

func testMigrationsDir(t *testing.T) string {
	t.Helper()
	for _, dir := range []string{"../../../migrations", "../../migrations", "migrations"} {
		if st, err := os.Stat(dir); err == nil && st.IsDir() {
			return dir
		}
	}
	t.Skip("dossier migrations introuvable")
	return ""
}

func TestMigrateAppliesAllVersions(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	dir := testMigrationsDir(t)

	done, err := Migrate(ctx, pool, dir)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if len(done) < 2 {
		t.Fatalf("au moins 2 migrations attendues, obtenu %v", done)
	}

	// Idempotence : rien à appliquer au second passage
	done2, err := Migrate(ctx, pool, dir)
	if err != nil {
		t.Fatalf("migrate 2: %v", err)
	}
	if len(done2) != 0 {
		t.Fatalf("second passage doit être no-op, obtenu %v", done2)
	}

	// Tables clés présentes
	for _, table := range []string{
		"shop_settings", "auth_credentials", "auth_sessions", "catalog_items",
		"clients", "client_wallet_entries", "orders", "order_items",
		"order_claim_photos", "payments", "expenses", "delivery_zones",
		"logistics_tasks", "inventory_items", "inventory_movements",
		"ticket_counters", "devices", "sync_operations", "idempotency_keys", "audit_logs",
	} {
		var exists bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name=$1)`,
			table).Scan(&exists); err != nil || !exists {
			t.Errorf("table %s absente (err=%v)", table, err)
		}
	}
}

func TestMigrateSeedsVirginInstallOnly(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	dir := testMigrationsDir(t)

	if _, err := Migrate(ctx, pool, dir); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	var shopName string
	if err := pool.QueryRow(ctx, `SELECT shop_name FROM shop_settings WHERE id=1`).Scan(&shopName); err != nil {
		t.Fatalf("seed settings manquant: %v", err)
	}
	var algo string
	if err := pool.QueryRow(ctx, `SELECT algo FROM auth_credentials WHERE id=1`).Scan(&algo); err != nil {
		t.Fatalf("seed credentials manquant: %v", err)
	}
	if algo != "none" {
		t.Fatalf("credential vierge doit être algo=none, obtenu %q", algo)
	}
}
