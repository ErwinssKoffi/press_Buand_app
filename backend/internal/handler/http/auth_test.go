package http_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/erwinsskoffi/press_backend/internal/domain/auth"
	httph "github.com/erwinsskoffi/press_backend/internal/handler/http"
	"github.com/erwinsskoffi/press_backend/internal/server"
	"github.com/erwinsskoffi/press_backend/internal/service"
)

// --- fakes (copie locale des tests service, non exportés entre packages) ---

type fakeCredRepo struct {
	mu     sync.Mutex
	cred   service.Credential
	secret string
}

func newFakeCreds() *fakeCredRepo {
	return &fakeCredRepo{cred: service.Credential{Algo: "none"}}
}

func (f *fakeCredRepo) Get(_ context.Context) (*service.Credential, error) {
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
	sessions map[string]*service.Session
}

func newFakeSessions() *fakeSessionRepo {
	return &fakeSessionRepo{sessions: map[string]*service.Session{}}
}

func (f *fakeSessionRepo) Create(_ context.Context, s *service.Session) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	cp := *s
	f.sessions[s.TokenHash] = &cp
	return nil
}

func (f *fakeSessionRepo) GetByTokenHash(_ context.Context, h string) (*service.Session, error) {
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

// --- serveur HTTP de test complet ---

func testServer(t *testing.T, weak bool) *httptest.Server {
	t.Helper()
	svc := service.NewAuthService(newFakeCreds(), newFakeSessions(), &fakeAudit{}, auth.Policy{
		MaxAttempts: 3, Lockout: time.Minute, AllowWeakPIN: weak, SessionTTL: time.Hour,
	})
	h := httph.NewAuthHandlers(svc, false, "")
	api := chi.NewRouter()
	api.Get("/ping", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	srv := server.New(server.Deps{
		AuthSvc:      svc,
		AuthHandlers: h,
		APIRouter:    api,
	})
	ts := httptest.NewServer(srv.Handler)
	t.Cleanup(ts.Close)
	return ts
}

func postJSON(t *testing.T, ts *httptest.Server, path, body string) (*http.Response, map[string]any) {
	t.Helper()
	resp, err := http.Post(ts.URL+path, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	out := map[string]any{}
	defer resp.Body.Close()
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp, out
}

func get(t *testing.T, ts *httptest.Server, path, cookie string) (*http.Response, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, ts.URL+path, nil)
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	out := map[string]any{}
	defer resp.Body.Close()
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp, out
}

func TestAuthFlowHTTP(t *testing.T) {
	ts := testServer(t, true)

	// 1. statut vierge
	resp, st := get(t, ts, "/auth/status", "")
	if st["state"] != "virgin" {
		t.Fatalf("état attendu virgin, obtenu %v", st["state"])
	}

	// 2. setup
	resp, _ = postJSON(t, ts, "/auth/setup", `{"secret":"54321"}`)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("setup attendu 204, obtenu %d", resp.StatusCode)
	}

	// 3. setup refusé ensuite
	resp, _ = postJSON(t, ts, "/auth/setup", `{"secret":"99999"}`)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("second setup attendu 409, obtenu %d", resp.StatusCode)
	}

	// 4. login valide → cookie HttpOnly
	resp, body := postJSON(t, ts, "/auth/login", `{"pinOrPassword":"54321","deviceId":"dev1"}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login attendu 200, obtenu %d (%v)", resp.StatusCode, body)
	}
	cookie := ""
	for _, c := range resp.Cookies() {
		if c.Name == httph.CookieName {
			cookie = c.Name + "=" + c.Value
			if !c.HttpOnly {
				t.Fatal("cookie doit être HttpOnly")
			}
		}
	}
	if cookie == "" {
		t.Fatal("cookie de session attendu")
	}

	// 5. /auth/me avec session
	if resp, _ = get(t, ts, "/auth/me", cookie); resp.StatusCode != http.StatusOK {
		t.Fatalf("me attendu 200, obtenu %d", resp.StatusCode)
	}

	// 6. route métier protégée : anonyme → 401 ; authentifié → 200
	if resp, _ = get(t, ts, "/api/v1/ping", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("accès anonyme attendu 401, obtenu %d", resp.StatusCode)
	}
	if resp, _ = get(t, ts, "/api/v1/ping", cookie); resp.StatusCode != http.StatusOK {
		t.Fatalf("route authentifiée attendue 200, obtenu %d", resp.StatusCode)
	}

	// 7. lockout après 3 échecs
	postJSON(t, ts, "/auth/login", `{"pinOrPassword":"00000"}`)
	postJSON(t, ts, "/auth/login", `{"pinOrPassword":"00000"}`)
	resp, body = postJSON(t, ts, "/auth/login", `{"pinOrPassword":"00000"}`)
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("lockout attendu 429, obtenu %d (%v)", resp.StatusCode, body)
	}

	// 8. logout (avec session) puis me → 401
	logoutReq, _ := http.NewRequest(http.MethodPost, ts.URL+"/auth/logout", strings.NewReader("{}"))
	logoutReq.Header.Set("Cookie", cookie)
	logoutResp, err := http.DefaultClient.Do(logoutReq)
	if err != nil {
		t.Fatal(err)
	}
	logoutResp.Body.Close()
	if logoutResp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout attendu 204, obtenu %d", logoutResp.StatusCode)
	}
	if resp, _ = get(t, ts, "/auth/me", cookie); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("me après logout attendu 401, obtenu %d", resp.StatusCode)
	}
}

func TestOriginGuardRejectsForeignOrigin(t *testing.T) {
	ts := testServer(t, true)
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/auth/setup", strings.NewReader(`{"secret":"54321"}`))
	req.Header.Set("Origin", "https://evil.example.com")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("origines non autorisées doivent être refusées, obtenu %d", resp.StatusCode)
	}
}
