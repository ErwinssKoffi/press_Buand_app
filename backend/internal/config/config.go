// Package config charge et valide la configuration du backend à partir de
// variables d'environnement. Aucune valeur par défaut secrète ; le démarrage
// est refusé si une variable obligatoire est absente ou invalide.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config décrit toute la configuration runtime du serveur.
type Config struct {
	Env            string        // development | production | test
	HTTPAddr       string        // ex. :8080
	BaseURL        string        // URL publique (cookies Secure, CORS)
	DatabaseURL    string        // postgres://… obligatoire
	StorageDir     string        // dossier privé des photos
	SessionTTL     time.Duration // durée de session
	CookieSecure   bool          // Secure sur le cookie de session (prod)
	CookieDomain   string        // vide = host-only
	CORSOrigins    []string      // origines autorisées (dev), vide = fermé
	BodyLimitBytes int64         // limite de taille des requêtes
	// Auth
	LoginMaxAttempts int           // échecs avant lockout persistant
	LoginLockout     time.Duration // durée du lockout
	AllowWeakPIN     bool          // true en dev/LAN : PIN 5 chiffres autorisé
	// Migrations
	AutoMigrate bool
	// Shutdown
	ShutdownGrace time.Duration
}

// Load lit les variables d'environnement préfixées ECLAT_ et retourne une
// configuration validée. Erreur non nil si invalide.
func Load() (*Config, error) {
	c := &Config{
		Env:              envStr("ECLAT_ENV", "development"),
		HTTPAddr:         envStr("ECLAT_HTTP_ADDR", ":8080"),
		BaseURL:          envStr("ECLAT_BASE_URL", ""),
		DatabaseURL:      os.Getenv("ECLAT_DATABASE_URL"),
		StorageDir:       envStr("ECLAT_STORAGE_DIR", "/var/lib/eclat/storage"),
		SessionTTL:       envDur("ECLAT_SESSION_TTL", 7*24*time.Hour),
		CookieSecure:     false,
		CookieDomain:     os.Getenv("ECLAT_COOKIE_DOMAIN"),
		CORSOrigins:      envList("ECLAT_CORS_ORIGINS"),
		BodyLimitBytes:   envInt64("ECLAT_BODY_LIMIT", 10*1024*1024),
		LoginMaxAttempts: envInt("ECLAT_LOGIN_MAX_ATTEMPTS", 5),
		LoginLockout:     envDur("ECLAT_LOGIN_LOCKOUT", 5*time.Minute),
		AllowWeakPIN:     false,
		AutoMigrate:      envBool("ECLAT_AUTO_MIGRATE", true),
		ShutdownGrace:    envDur("ECLAT_SHUTDOWN_GRACE", 15*time.Second),
	}
	if c.Env == "production" {
		c.CookieSecure = true
	}
	if c.Env == "development" || c.Env == "test" {
		c.AllowWeakPIN = true
	}
	if strings.TrimSpace(c.DatabaseURL) == "" {
		return nil, fmt.Errorf("ECLAT_DATABASE_URL est obligatoire")
	}
	if !strings.HasPrefix(c.DatabaseURL, "postgres://") && !strings.HasPrefix(c.DatabaseURL, "postgresql://") {
		return nil, fmt.Errorf("ECLAT_DATABASE_URL doit commencer par postgres:// ou postgresql://")
	}
	if c.SessionTTL < 15*time.Minute {
		return nil, fmt.Errorf("ECLAT_SESSION_TTL trop court (min 15m)")
	}
	if c.BodyLimitBytes < 64*1024 || c.BodyLimitBytes > 100*1024*1024 {
		return nil, fmt.Errorf("ECLAT_BODY_LIMIT doit être entre 64Ko et 100Mo")
	}
	if c.LoginMaxAttempts < 3 {
		return nil, fmt.Errorf("ECLAT_LOGIN_MAX_ATTEMPTS doit être >= 3")
	}
	switch c.Env {
	case "development", "production", "test":
	default:
		return nil, fmt.Errorf("ECLAT_ENV doit valoir development|production|test")
	}
	return c, nil
}

func envStr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envInt64(key string, def int64) int64 {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return def
}

func envDur(key string, def time.Duration) time.Duration {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
	}
	return def
}

func envList(key string) []string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
