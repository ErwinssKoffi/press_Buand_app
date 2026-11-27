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

	"github.com/erwinsskoffi/press_backend/internal/config"
	"github.com/erwinsskoffi/press_backend/internal/platform/database"
	"github.com/erwinsskoffi/press_backend/internal/platform/migrate"
	"github.com/erwinsskoffi/press_backend/internal/server"
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

	if err := os.MkdirAll(cfg.StorageDir, 0o750); err != nil {
		return err
	}

	srv := server.New(server.Deps{
		Pool:         pool,
		Log:          log,
		CORSOrigins:  cfg.CORSOrigins,
		BodyLimit:    cfg.BodyLimitBytes,
		ReadTimeout:  20 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
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

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
