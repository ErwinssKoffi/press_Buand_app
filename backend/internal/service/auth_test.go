package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/erwinsskoffi/press_backend/internal/domain/auth"
)

// --- fakes ---

type fakeCredRepo struct {
	mu     sync.Mutex
	cred   Credential
	secret string // argon2id PHC
}

func newFakeCreds() *fakeCredRepo {
	return &fakeCredRepo{cred: Credential{Algo: "none"}}
}

func (f *fakeCredRepo) Get(_ context.Context) (*Credential, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c := f.cred
	c.PasswordHash = f.secret
	return &c, nil
}

func (f *fakeCredRepo) SetSecret(_ context.Context, algo, hash string, clearLegacy bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cred.Algo = algo
	f.secret = hash
	if clearLegacy {
		f.cred.LegacyHash = ""
		f.cred.LegacySalt = ""
	}
	return nil
}

func (f *fakeCredRepo) SetLegacy(_ context.Context, h, s string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cred.LegacyHash = h
	f.cred.LegacySalt = s
	return nil
}

func (f *fakeCredRepo) RecordFailure(_ context.Context, attempts int, lockedUntil *time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cred.FailedAttempts = attempts
	f.cred.LockedUntil = lockedUntil
	return nil
}

func (f *fakeCredRepo) ResetFailures(_ context.Context) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cred.FailedAttempts = 0
	f.cred.LockedUntil = nil
	return nil
}

type fakeSessionRepo struct {
	mu       sync.Mutex
	sessions map[string]*Session // par tokenHash
}

func newFakeSessions() *fakeSessionRepo {
	return &fakeSessionRepo{sessions: map[string]*Session{}}
}

func (f *fakeSessionRepo) Create(_ context.Context, s *Session) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	cp := *s
	f.sessions[s.TokenHash] = &cp
	return nil
}

func (f *fakeSessionRepo) GetByTokenHash(_ context.Context, h string) (*Session, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if s, ok := f.sessions[h]; ok {
		cp := *s
		return &cp, nil
	}
	return nil, nil
}

func (f *fakeSessionRepo) Revoke(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, s := range f.sessions {
		if s.ID == id {
			t := time.Now()
			s.RevokedAt = &t
		}
	}
	return nil
}

func (f *fakeSessionRepo) DeleteExpired(_ context.Context) error { return nil }

type fakeAudit struct {
	mu     sync.Mutex
	events []string
}

func (f *fakeAudit) Log(_ context.Context, _, action, _, _ string, _ map[string]any) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, action)
	return nil
}

// --- fixtures ---

const testLegacySalt = "abcdef0123456789abcdef0123456789"
const testLegacyPin = "12345"

func legacyCreds() *fakeCredRepo {
	f := newFakeCreds()
	_ = f.SetLegacy(context.Background(), auth.LegacyHash(testLegacyPin, testLegacySalt), testLegacySalt)
	return f
}

func policy(weak bool) auth.Policy {
	return auth.Policy{MaxAttempts: 3, Lockout: 5 * time.Minute, AllowWeakPIN: weak, SessionTTL: time.Hour}
}

// --- tests ---

func TestSetupOnce(t *testing.T) {
	svc := NewAuthService(newFakeCreds(), newFakeSessions(), &fakeAudit{}, policy(true))
	ctx := context.Background()

	if err := svc.Setup(ctx, "54321"); err != nil {
		t.Fatalf("setup: %v", err)
	}
	if err := svc.Setup(ctx, "99999"); !errors.Is(err, auth.ErrAlreadySetup) {
		t.Fatalf("second setup doit échouer, obtenu %v", err)
	}
	st, _ := svc.Status(ctx)
	if st.State != "argon2id" {
		t.Fatalf("état attendu argon2id, obtenu %s", st.State)
	}
}

func TestSetupVirginOnly(t *testing.T) {
	svc := NewAuthService(newFakeCreds(), newFakeSessions(), &fakeAudit{}, policy(true))
	st, _ := svc.Status(context.Background())
	if st.State != "virgin" {
		t.Fatalf("état attendu virgin, obtenu %s", st.State)
	}
}

func TestLoginValidInvalidAndLockout(t *testing.T) {
	creds := newFakeCreds()
	svc := NewAuthService(creds, newFakeSessions(), &fakeAudit{}, policy(true))
	ctx := context.Background()
	if err := svc.Setup(ctx, "54321"); err != nil {
		t.Fatalf("setup: %v", err)
	}

	if _, err := svc.Login(ctx, "11111", "", ""); !errors.Is(err, auth.ErrInvalidSecret) {
		t.Fatalf("attendu ErrInvalidSecret, obtenu %v", err)
	}
	if _, err := svc.Login(ctx, "11111", "", ""); !errors.Is(err, auth.ErrInvalidSecret) {
		t.Fatalf("tentative 2: %v", err)
	}
	if _, err := svc.Login(ctx, "11111", "", ""); !errors.Is(err, auth.ErrLocked) {
		t.Fatalf("3e échec doit déclencher le lockout, obtenu %v", err)
	}
	// lockout persistant : même le bon secret est refusé
	if _, err := svc.Login(ctx, "54321", "", ""); !errors.Is(err, auth.ErrLocked) {
		t.Fatalf("lockout persistant attendu, obtenu %v", err)
	}
	// le credential en base porte le verrou
	c, _ := creds.Get(ctx)
	if c.LockedUntil == nil {
		t.Fatal("locked_until doit être persisté")
	}
}

func TestLegacyLoginUpgradesToArgon2(t *testing.T) {
	creds := legacyCreds()
	svc := NewAuthService(creds, newFakeSessions(), &fakeAudit{}, policy(true))
	ctx := context.Background()

	res, err := svc.Login(ctx, testLegacyPin, "dev-1", "ua")
	if err != nil {
		t.Fatalf("login legacy: %v", err)
	}
	if res.Token == "" {
		t.Fatal("token attendu")
	}
	c, _ := creds.Get(ctx)
	if c.Algo != "argon2id" || c.LegacyHash != "" {
		t.Fatalf("credential doit être upgrade argon2id + legacy effacé, obtenu algo=%s legacy=%q", c.Algo, c.LegacyHash)
	}
	if !auth.VerifyPHC(testLegacyPin, c.PasswordHash) {
		t.Fatal("le PIN legacy doit valider le nouveau hash Argon2id")
	}
	// le PIN reste valide au second login
	if _, err := svc.Login(ctx, testLegacyPin, "dev-1", "ua"); err != nil {
		t.Fatalf("second login après upgrade: %v", err)
	}
}

func TestLegacyLoginWrongPinDoesNotUpgrade(t *testing.T) {
	creds := legacyCreds()
	svc := NewAuthService(creds, newFakeSessions(), &fakeAudit{}, policy(true))
	if _, err := svc.Login(context.Background(), "99999", "", ""); err == nil {
		t.Fatal("mauvais PIN doit échouer")
	}
	c, _ := creds.Get(context.Background())
	if c.Algo != "none" || c.LegacyHash == "" {
		t.Fatal("le credential legacy doit rester intact après un mauvais PIN")
	}
}

func TestSessionExpiryAndRevocation(t *testing.T) {
	creds := newFakeCreds()
	svc := NewAuthService(creds, newFakeSessions(), &fakeAudit{}, policy(true))
	ctx := context.Background()
	_ = svc.Setup(ctx, "54321")

	res, _ := svc.Login(ctx, "54321", "", "")
	if _, err := svc.ValidateSession(ctx, res.Token); err != nil {
		t.Fatalf("session valide attendue: %v", err)
	}
	if err := svc.Logout(ctx, res.Token); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if _, err := svc.ValidateSession(ctx, res.Token); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatalf("session révoquée doit être refusée, obtenu %v", err)
	}

	// expiration
	res2, _ := svc.Login(ctx, "54321", "", "")
	sess, _ := svc.ValidateSession(ctx, res2.Token)
	sess.ExpiresAt = svc.now().Add(-time.Minute)
	// réécriture directe du fake (hash identique)
	fakeSessions := svc.sessions.(*fakeSessionRepo)
	fakeSessions.mu.Lock()
	fakeSessions.sessions[sess.TokenHash] = sess
	fakeSessions.mu.Unlock()
	if _, err := svc.ValidateSession(ctx, res2.Token); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatalf("session expirée doit être refusée, obtenu %v", err)
	}
}

func TestChangeSecretRequiresCurrent(t *testing.T) {
	creds := newFakeCreds()
	svc := NewAuthService(creds, newFakeSessions(), &fakeAudit{}, policy(true))
	ctx := context.Background()
	_ = svc.Setup(ctx, "54321")

	if err := svc.ChangeSecret(ctx, "00000", "Nouveau123"); !errors.Is(err, auth.ErrInvalidSecret) {
		t.Fatalf("attendu ErrInvalidSecret, obtenu %v", err)
	}
	if err := svc.ChangeSecret(ctx, "54321", "Nouveau123"); err != nil {
		t.Fatalf("changement valide: %v", err)
	}
	if _, err := svc.Login(ctx, "Nouveau123", "", ""); err != nil {
		t.Fatalf("login avec le nouveau secret: %v", err)
	}
	if _, err := svc.Login(ctx, "54321", "", ""); err == nil {
		t.Fatal("l'ancien secret doit être invalide après changement")
	}
}

func TestVirginInstallationRejectsLogin(t *testing.T) {
	svc := NewAuthService(newFakeCreds(), newFakeSessions(), &fakeAudit{}, policy(true))
	if _, err := svc.Login(context.Background(), "54321", "", ""); err == nil {
		t.Fatal("aucun login possible sur installation vierge")
	}
}
