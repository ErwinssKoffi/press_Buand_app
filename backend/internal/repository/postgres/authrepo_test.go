package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/erwinsskoffi/press_backend/internal/platform/itest"
	"github.com/erwinsskoffi/press_backend/internal/platform/migrate"

	"github.com/erwinsskoffi/press_backend/internal/domain/auth"
	"github.com/erwinsskoffi/press_backend/internal/service"
)

func itPool(t *testing.T) *pgxpool.Pool {
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
	_, err = pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`)
	if err != nil {
		t.Fatalf("reset: %v", err)
	}
	return pool
}

func TestAuthRepoIntegration(t *testing.T) {
	pool := itPool(t)
	ctx := context.Background()

	// migrations via le runner versionné (comme en production)
	if _, err := migrate.Migrate(ctx, pool, "../../../migrations"); err != nil {
		t.Fatalf("migrations: %v", err)
	}

	repo := New(pool)
	cred, err := repo.Auth.Get(ctx)
	if err != nil {
		t.Fatalf("get credential: %v", err)
	}
	if cred.Algo != "none" {
		t.Fatalf("credential vierge attendu, obtenu %s", cred.Algo)
	}

	hash, _ := auth.HashSecret("54321")
	if err := repo.Auth.SetSecret(ctx, "argon2id", hash, true); err != nil {
		t.Fatalf("set secret: %v", err)
	}
	cred, _ = repo.Auth.Get(ctx)
	if cred.Algo != "argon2id" || cred.PasswordHash != hash {
		t.Fatal("secret non persisté")
	}

	sess := &service.Session{
		ID:        "11111111-1111-5111-8111-111111111111",
		TokenHash: auth.TokenHash("jeton-test"),
		DeviceID:  "dev",
		UserAgent: "ua",
		CreatedAt: timeNow(),
		ExpiresAt: timeNow().Add(time.Hour),
	}
	if err := repo.Auth.Create(ctx, sess); err != nil {
		t.Fatalf("create session: %v", err)
	}
	got, err := repo.Auth.GetByTokenHash(ctx, auth.TokenHash("jeton-test"))
	if err != nil || got == nil {
		t.Fatalf("session non retrouvée: %v", err)
	}
	if err := repo.Auth.Revoke(ctx, sess.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	got, _ = repo.Auth.GetByTokenHash(ctx, auth.TokenHash("jeton-test"))
	if got == nil || got.RevokedAt == nil {
		t.Fatal("session devrait être révoquée")
	}

	if err := repo.Auth.RecordFailure(ctx, 3, nil); err != nil {
		t.Fatalf("record failure: %v", err)
	}
	cred, _ = repo.Auth.Get(ctx)
	if cred.FailedAttempts != 3 {
		t.Fatalf("attempts=3 attendu, obtenu %d", cred.FailedAttempts)
	}
}

func timeNow() time.Time { return time.Now().UTC() }
