// Package server assemble le routeur chi et les middlewares.
package server

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	httph "github.com/erwinsskoffi/press_backend/internal/handler/http"
	"github.com/erwinsskoffi/press_backend/internal/middleware"
	"github.com/erwinsskoffi/press_backend/internal/service"
)

// Deps rassemble les dépendances du serveur HTTP.
type Deps struct {
	Pool          *pgxpool.Pool
	Log           *slog.Logger
	CORSOrigins   []string
	BodyLimit     int64
	ReadTimeout   time.Duration
	WriteTimeout  time.Duration
	IdleTimeout   time.Duration
	AuthSvc       *service.AuthService // nil = phase 03 uniquement (tests)
	AuthHandlers  *httph.AuthHandlers
	APIRouter     http.Handler // routes métier /api/v1 (phase 05+) : chi.Router prêt
	SecureCookies bool
	CookieDomain  string
}

// New construit le serveur HTTP complet.
func New(d Deps) *http.Server {
	if d.Log == nil {
		d.Log = slog.Default()
	}
	if d.BodyLimit <= 0 {
		d.BodyLimit = 10 * 1024 * 1024
	}
	r := chi.NewRouter()

	r.Use(middleware.RequestIDGen)
	r.Use(middleware.Recover(d.Log))
	r.Use(middleware.Logger(d.Log))
	r.Use(middleware.SecurityHeaders)
	r.Use(middleware.CORS(d.CORSOrigins))
	r.Use(middleware.BodyLimit(d.BodyLimit))

	health := httph.NewHealthHandlers(d.Pool)
	r.Get("/healthz", health.Healthz)
	r.Get("/readyz", health.Readyz)

	if d.AuthSvc != nil && d.AuthHandlers != nil {
		// routes d'auth publiques (setup/login/status) + logout/me
		r.Group(func(r chi.Router) {
			r.Use(httph.OriginGuard(d.CORSOrigins))
			d.AuthHandlers.Mount(r)
		})

		// routes métier protégées par session
		api := chi.NewRouter()
		api.Use(httph.OriginGuard(d.CORSOrigins))
		api.Use(httph.RequireAuth(d.AuthSvc))
		if d.APIRouter != nil {
			api.Mount("/", d.APIRouter)
		} else {
			// aucune route métier : /api/v1 répond 404 via une route factice
			api.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			})
		}
		r.Mount("/api/v1", api)
	}

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		httph.WriteError(w, http.StatusNotFound, "not_found", "Ressource introuvable.", nil)
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		httph.WriteError(w, http.StatusMethodNotAllowed, "invalid_request", "Méthode non autorisée.", nil)
	})

	return &http.Server{
		Addr:              "",
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       d.ReadTimeout,
		WriteTimeout:      d.WriteTimeout,
		IdleTimeout:       d.IdleTimeout,
	}
}
