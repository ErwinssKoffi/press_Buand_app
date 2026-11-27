package config

import (
	"os"
	"testing"
	"time"
)

func setEnv(t *testing.T, k, v string) {
	t.Helper()
	old, had := os.LookupEnv(k)
	os.Setenv(k, v)
	t.Cleanup(func() {
		if had {
			os.Setenv(k, old)
		} else {
			os.Unsetenv(k)
		}
	})
}

func validEnvs(t *testing.T) map[string]string {
	t.Helper()
	return map[string]string{
		"ECLAT_DATABASE_URL": "postgres://eclat:secret@localhost:5432/eclat_test",
		"ECLAT_ENV":          "test",
	}
}

func loadWith(t *testing.T, extra map[string]string) (*Config, error) {
	t.Helper()
	os.Unsetenv("ECLAT_DATABASE_URL")
	os.Unsetenv("ECLAT_ENV")
	for k, v := range validEnvs(t) {
		setEnv(t, k, v)
	}
	for k, v := range extra {
		setEnv(t, k, v)
	}
	return Load()
}

func TestLoadValidDefaults(t *testing.T) {
	c, err := loadWith(t, nil)
	if err != nil {
		t.Fatalf("attendu valide, err=%v", err)
	}
	if c.HTTPAddr != ":8080" {
		t.Errorf("HTTPAddr=%q", c.HTTPAddr)
	}
	if c.SessionTTL != 7*24*time.Hour {
		t.Errorf("SessionTTL=%v", c.SessionTTL)
	}
	if !c.AllowWeakPIN {
		t.Errorf("AllowWeakPIN attendu true en test")
	}
}

func TestLoadMissingDatabaseURL(t *testing.T) {
	os.Unsetenv("ECLAT_DATABASE_URL")
	os.Unsetenv("ECLAT_ENV")
	setEnv(t, "ECLAT_DATABASE_URL", "")
	if _, err := Load(); err == nil {
		t.Fatal("attendu erreur si ECLAT_DATABASE_URL absent")
	}
}

func TestLoadBadDatabaseURL(t *testing.T) {
	if _, err := loadWith(t, map[string]string{"ECLAT_DATABASE_URL": "mysql://x"}); err == nil {
		t.Fatal("attendu erreur pour un DSN non postgres")
	}
}

func TestLoadProductionForcesSecureCookie(t *testing.T) {
	c, err := loadWith(t, map[string]string{"ECLAT_ENV": "production"})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if !c.CookieSecure {
		t.Fatal("CookieSecure attendu true en production")
	}
	if c.AllowWeakPIN {
		t.Fatal("AllowWeakPIN attendu false en production")
	}
}

func TestLoadRejectsShortSession(t *testing.T) {
	if _, err := loadWith(t, map[string]string{"ECLAT_SESSION_TTL": "5m"}); err == nil {
		t.Fatal("attendu erreur pour session trop courte")
	}
}

func TestLoadRejectsBadEnv(t *testing.T) {
	if _, err := loadWith(t, map[string]string{"ECLAT_ENV": "staging"}); err == nil {
		t.Fatal("attendu erreur pour ECLAT_ENV invalide")
	}
}
