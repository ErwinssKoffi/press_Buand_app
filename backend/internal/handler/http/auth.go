package http

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/erwinsskoffi/press_backend/internal/domain/auth"
	"github.com/erwinsskoffi/press_backend/internal/service"
)

// CookieName : cookie de session opaque.
const CookieName = "eclat_session"

// AuthHandlers expose /auth/*.
type AuthHandlers struct {
	svc        *service.AuthService
	secureOnly bool
	domain     string
}

func NewAuthHandlers(svc *service.AuthService, secureOnly bool, domain string) *AuthHandlers {
	return &AuthHandlers{svc: svc, secureOnly: secureOnly, domain: domain}
}

// Mount enregistre les routes d'auth : setup/login/status publics,
// me/logout/change-pin protégés par session.
func (h *AuthHandlers) Mount(r chi.Router) {
	r.Get("/auth/status", h.status)
	r.Post("/auth/setup", h.setup)
	r.Post("/auth/login", h.login)
	r.Group(func(g chi.Router) {
		g.Use(RequireAuth(h.svc))
		g.Get("/auth/me", h.me)
		g.Post("/auth/logout", h.logout)
		g.Post("/auth/change-pin", h.changePin)
	})
}

func (h *AuthHandlers) status(w http.ResponseWriter, r *http.Request) {
	st, err := h.svc.Status(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "internal", "Erreur interne.", nil)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *AuthHandlers) setup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Secret string `json:"secret"`
	}
	if err := decodeJSON(r, &in); err != nil || strings.TrimSpace(in.Secret) == "" {
		WriteError(w, http.StatusBadRequest, "invalid_request", "Corps JSON invalide (secret requis).", nil)
		return
	}
	switch err := h.svc.Setup(r.Context(), in.Secret); {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, auth.ErrAlreadySetup):
		WriteError(w, http.StatusConflict, "conflict", "Le secret opérateur est déjà configuré.", nil)
	case errors.Is(err, auth.ErrWeakSecret):
		WriteError(w, http.StatusUnprocessableEntity, "business_rule",
			"Secret trop faible : PIN 5 chiffres accepté uniquement hors production, sinon 8 caractères minimum mêlant lettres et chiffres.", nil)
	default:
		WriteError(w, http.StatusInternalServerError, "internal", "Erreur interne.", nil)
	}
}

func (h *AuthHandlers) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		PinOrPassword string `json:"pinOrPassword"`
		DeviceID      string `json:"deviceId"`
	}
	if err := decodeJSON(r, &in); err != nil || in.PinOrPassword == "" {
		WriteError(w, http.StatusBadRequest, "invalid_request", "Corps JSON invalide (pinOrPassword requis).", nil)
		return
	}
	res, err := h.svc.Login(r.Context(), in.PinOrPassword, in.DeviceID, truncatedUA(r))
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrLocked):
			st, _ := h.svc.Status(r.Context())
			rem := st.LockRemainingSeconds
			WriteError(w, http.StatusTooManyRequests, "rate_limited",
				"Trop de tentatives incorrectes. Réessayer plus tard.",
				map[string]any{"lockRemainingSeconds": rem})
		case errors.Is(err, auth.ErrInvalidSecret):
			st, _ := h.svc.Status(r.Context())
			WriteError(w, http.StatusUnauthorized, "unauthorized", "Secret invalide.", map[string]any{
				"locked": st.Locked,
			})
		case errors.Is(err, auth.ErrWeakSecret):
			WriteError(w, http.StatusUnprocessableEntity, "business_rule", "Secret trop faible.", nil)
		default:
			WriteError(w, http.StatusInternalServerError, "internal", "Erreur interne.", nil)
		}
		return
	}
	h.setSessionCookie(w, res.Token, res.ExpiresAt)
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated":    true,
		"sessionExpiresAt": res.ExpiresAt.UTC().Format(time.RFC3339),
	})
}

func (h *AuthHandlers) logout(w http.ResponseWriter, r *http.Request) {
	token, _ := r.Cookie(CookieName)
	if token != nil {
		_ = h.svc.Logout(r.Context(), token.Value)
	}
	h.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h *AuthHandlers) me(w http.ResponseWriter, r *http.Request) {
	sess := SessionFromContext(r.Context())
	if sess == nil {
		WriteError(w, http.StatusUnauthorized, "unauthorized", "Session absente ou expirée.", nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated":    true,
		"sessionExpiresAt": sess.ExpiresAt.UTC().Format(time.RFC3339),
	})
}

func (h *AuthHandlers) changePin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		CurrentSecret string `json:"currentSecret"`
		NewSecret     string `json:"newSecret"`
	}
	if err := decodeJSON(r, &in); err != nil || in.CurrentSecret == "" || in.NewSecret == "" {
		WriteError(w, http.StatusBadRequest, "invalid_request", "Corps JSON invalide (currentSecret et newSecret requis).", nil)
		return
	}
	err := h.svc.ChangeSecret(r.Context(), in.CurrentSecret, in.NewSecret)
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, auth.ErrInvalidSecret):
		WriteError(w, http.StatusUnauthorized, "unauthorized", "Secret actuel invalide.", nil)
	case errors.Is(err, auth.ErrWeakSecret):
		WriteError(w, http.StatusUnprocessableEntity, "business_rule", "Nouveau secret trop faible.", nil)
	default:
		WriteError(w, http.StatusInternalServerError, "internal", "Erreur interne.", nil)
	}
}

func (h *AuthHandlers) setSessionCookie(w http.ResponseWriter, token string, expires time.Time) {
	parts := []string{
		CookieName + "=" + token,
		"Path=/",
		"HttpOnly",
		"SameSite=Strict",
		"Max-Age=" + strconv.Itoa(int(time.Until(expires).Seconds())),
	}
	if h.secureOnly {
		parts = append(parts, "Secure")
	}
	if h.domain != "" {
		parts = append(parts, "Domain="+h.domain)
	}
	w.Header().Add("Set-Cookie", strings.Join(parts, "; "))
}

func (h *AuthHandlers) clearSessionCookie(w http.ResponseWriter) {
	parts := []string{
		CookieName + "=",
		"Path=/",
		"HttpOnly",
		"SameSite=Strict",
		"Max-Age=0",
	}
	if h.secureOnly {
		parts = append(parts, "Secure")
	}
	if h.domain != "" {
		parts = append(parts, "Domain="+h.domain)
	}
	w.Header().Add("Set-Cookie", strings.Join(parts, "; "))
}

func truncatedUA(r *http.Request) string {
	ua := r.UserAgent()
	if len(ua) > 200 {
		return ua[:200]
	}
	return ua
}

// --- session context ---

type sessionKey struct{}

// SessionFromContext renvoie la session validée du contexte (nil si anonyme).
func SessionFromContext(ctx context.Context) *service.Session {
	s, _ := ctx.Value(sessionKey{}).(*service.Session)
	return s
}

// RequireAuth protège les routes métier : session valide obligatoire.
func RequireAuth(svc *service.AuthService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie(CookieName)
			if err != nil || cookie.Value == "" {
				WriteError(w, http.StatusUnauthorized, "unauthorized", "Authentification requise.", nil)
				return
			}
			sess, verr := svc.ValidateSession(r.Context(), cookie.Value)
			if verr != nil {
				WriteError(w, http.StatusUnauthorized, "unauthorized", "Session absente, expirée ou révoquée.", nil)
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), sessionKey{}, sess)))
		})
	}
}

// OriginGuard refuse les mutations cross-origin non autorisées (défense CSRF additionnelle).
func OriginGuard(allowed []string) func(http.Handler) http.Handler {
	set := map[string]bool{}
	for _, o := range allowed {
		set[strings.ToLower(strings.TrimSpace(o))] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}
			origin := strings.ToLower(strings.TrimSpace(r.Header.Get("Origin")))
			// Client natif (curl, PWA sans Origin) ou origine explicitement autorisée.
			if origin == "" || set[origin] {
				next.ServeHTTP(w, r)
				return
			}
			WriteError(w, http.StatusForbidden, "forbidden", "Origine non autorisée.", nil)
		})
	}
}
