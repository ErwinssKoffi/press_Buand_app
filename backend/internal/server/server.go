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
)

// Deps rassemble les dépendances du serveur HTTP.
type Deps struct {
	Pool         *pgxpool.Pool
	Log          *slog.Logger
	CORSOrigins  []string
	BodyLimit    int64
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	IdleTimeout  time.Duration
	Auth         http.Handler // handler d'auth (routes /auth/*) — injecté à la phase 04
	API          http.Handler // routes métier authentifiées — injecté à la phase 06
}

// New construit le serveur HTTP complet.
func New(d Deps) *http.Server {
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

	// Les routes métier sont montées par les phases suivantes.
	if d.Auth != nil {
		r.Mount("/", d.Auth)
	}
	if d.API != nil {
		r.Mount("/api/v1", d.API)
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
