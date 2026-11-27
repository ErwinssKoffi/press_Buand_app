// Command api est le point d'entrée du backend Éclat Pressing.
// Aucune logique métier ici : config, connexions, migrations, serveur, shutdown gracieux.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/erwinsskoffi/press_backend/internal/backup"
	"github.com/erwinsskoffi/press_backend/internal/config"
	"github.com/erwinsskoffi/press_backend/internal/domain/auth"
	httph "github.com/erwinsskoffi/press_backend/internal/handler/http"
	"github.com/erwinsskoffi/press_backend/internal/platform/database"
	"github.com/erwinsskoffi/press_backend/internal/platform/dbtx"
	"github.com/erwinsskoffi/press_backend/internal/platform/migrate"
	"github.com/erwinsskoffi/press_backend/internal/repository/postgres"
	"github.com/erwinsskoffi/press_backend/internal/server"
	"github.com/erwinsskoffi/press_backend/internal/service"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(log)

	if err := run(log); err != nil {
		log.Error("démarrage impossible", "error", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx := context.Background()

	pool, err := database.Connect(ctx, cfg.DatabaseURL)
	_ = pool
	if err != nil {
		return err
	}
	defer pool.Close()
	log.Info("postgresql connecté")

	if cfg.AutoMigrate {
		dir := envOr("ECLAT_MIGRATIONS_DIR", "/app/migrations")
		if _, err := os.Stat(dir); err != nil {
			// exécution hors conteneur : relatif au module
			if _, err2 := os.Stat(filepath.Join("migrations")); err2 == nil {
				dir = "migrations"
			}
		}
		applied, err := migrate.Migrate(ctx, pool, dir)
		if err != nil {
			return err
		}
		log.Info("migrations appliquées", "versions", applied)
	}

	repo := postgres.New(pool)
	txm := dbtx.NewTxManager(pool)

	if err := os.MkdirAll(cfg.StorageDir, 0o750); err != nil {
		return err
	}

	// Auth : credentials + sessions + audit
	auditRepo := postgres.NewAuditRepo(pool)

	// Repos métier (phase 05/06)
	settingsRepo := &postgres.SettingsRepo{}
	catalogRepo := &postgres.CatalogRepo{}
	clientRepo := &postgres.ClientRepo{}
	ticketRepo := &postgres.TicketRepo{}
	orderRepo := &postgres.OrderRepo{}
	paymentRepo := &postgres.PaymentRepo{}
	expenseRepo := &postgres.ExpenseRepo{}
	zoneRepo := &postgres.ZoneRepo{}
	logisticsRepo := &postgres.LogisticsRepo{}
	inventoryRepo := &postgres.InventoryRepo{}
	reportRepo := &postgres.ReportRepo{}

	// Services métier
	orderSvc := service.NewOrderService(orderRepo, catalogRepo, paymentRepo, settingsRepo,
		clientRepo, ticketRepo, zoneRepo, txm, auditRepo)
	orderSvc.SetStorageDir(cfg.StorageDir)
	settingsSvc := service.NewSettingsService(settingsRepo, txm, auditRepo)
	catalogSvc := service.NewCatalogService(catalogRepo, txm, auditRepo)
	clientSvc := service.NewClientService(clientRepo, paymentRepo, txm, auditRepo)
	logisticsSvc := service.NewLogisticsService(logisticsRepo, zoneRepo, txm, auditRepo)
	inventorySvc := service.NewInventoryService(inventoryRepo, txm, auditRepo)
	cashbookSvc := service.NewCashbookService(expenseRepo, txm, auditRepo)
	reportsSvc := service.NewReportsService(reportRepo, txm)
	authPolicy := auth.Policy{
		MaxAttempts:  cfg.LoginMaxAttempts,
		Lockout:      cfg.LoginLockout,
		AllowWeakPIN: cfg.AllowWeakPIN,
		SessionTTL:   cfg.SessionTTL,
	}
	authSvc := service.NewAuthService(repo.Auth, repo.Auth, auditRepo, authPolicy)
	authH := httph.NewAuthHandlers(authSvc, cfg.CookieSecure, cfg.CookieDomain)

	srv := server.New(server.Deps{
		Pool:         pool,
		Log:          log,
		CORSOrigins:  cfg.CORSOrigins,
		BodyLimit:    cfg.BodyLimitBytes,
		ReadTimeout:  20 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
		AuthSvc:      authSvc,
		AuthHandlers: authH,
		APIRouter: buildAPIRouter(httph.NewAPI(orderSvc, settingsSvc, catalogSvc, clientSvc, logisticsSvc, inventorySvc, cashbookSvc, reportsSvc, expenseRepo, backup.NewService(pool, cfg.StorageDir),
			service.NewSyncService(pool, orderSvc, settingsSvc, catalogSvc, clientSvc, logisticsSvc, inventorySvc, cashbookSvc, expenseRepo))),
		SecureCookies: cfg.CookieSecure,
		CookieDomain:  cfg.CookieDomain,
	})
	srv.Addr = cfg.HTTPAddr

	errCh := make(chan error, 1)
	go func() {
		log.Info("serveur démarré", "addr", cfg.HTTPAddr, "env", cfg.Env)
		errCh <- srv.ListenAndServe()
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-stop:
		log.Info("signal reçu, arrêt gracieux", "signal", sig.String())
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}

	shCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownGrace)
	defer cancel()
	if err := srv.Shutdown(shCtx); err != nil {
		log.Error("shutdown", "error", err)
	}
	pool.Close()
	log.Info("serveur arrêté proprement")
	return nil
}

func buildAPIRouter(api *httph.API) http.Handler {
	r := chi.NewRouter()
	api.Routes(r)
	return r
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
