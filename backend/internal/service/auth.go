// Package service porte les cas d'usage métier transactionnels.
package service

import (
	"context"

	"time"

	"github.com/erwinsskoffi/press_backend/internal/domain/auth"
	"github.com/erwinsskoffi/press_backend/internal/platform/ids"
)

func newUUID() string { return ids.NewUUID() }

// Credential : secrets opérateur (séparés de shop_settings, ADR A5).
type Credential struct {
	Algo           string // none | argon2id
	PasswordHash   string // PHC Argon2id
	LegacyHash     string // SHA-256 navigateur historique (transition)
	LegacySalt     string
	FailedAttempts int
	LockedUntil    *time.Time
}

// Session : session opaque révocable.
type Session struct {
	ID        string
	TokenHash string
	DeviceID  string
	UserAgent string
	CreatedAt time.Time
	ExpiresAt time.Time
	RevokedAt *time.Time
}

// CredentialRepo persiste le credential singleton.
type CredentialRepo interface {
	Get(ctx context.Context) (*Credential, error)
	SetSecret(ctx context.Context, algo, passwordHash string, clearLegacy bool) error
	SetLegacy(ctx context.Context, legacyHash, legacySalt string) error
	RecordFailure(ctx context.Context, attempts int, lockedUntil *time.Time) error
	ResetFailures(ctx context.Context) error
}

// SessionRepo persiste les sessions (hash du token uniquement).
type SessionRepo interface {
	Create(ctx context.Context, s *Session) error
	GetByTokenHash(ctx context.Context, tokenHash string) (*Session, error)
	Revoke(ctx context.Context, sessionID string) error
	DeleteExpired(ctx context.Context) error
}

// AuditLogger trace les actions sensibles.
type AuditLogger interface {
	Log(ctx context.Context, actor, action, entity, entityID string, details map[string]any) error
}

// AuthService : setup, login (avec upgrade legacy), logout, sessions, changement de secret.
type AuthService struct {
	creds    CredentialRepo
	sessions SessionRepo
	audit    AuditLogger
	policy   auth.Policy
	now      func() time.Time
}

func NewAuthService(creds CredentialRepo, sessions SessionRepo, audit AuditLogger, policy auth.Policy) *AuthService {
	if policy.MaxAttempts <= 0 {
		policy.MaxAttempts = 5
	}
	if policy.Lockout <= 0 {
		policy.Lockout = 5 * time.Minute
	}
	if policy.SessionTTL <= 0 {
		policy.SessionTTL = 7 * 24 * time.Hour
	}
	return &AuthService{creds: creds, sessions: sessions, audit: audit, policy: policy, now: time.Now}
}

// AuthStatus : état public des credentials (aucun secret).
type AuthStatus struct {
	State                string `json:"state"` // virgin | legacy | argon2id
	Locked               bool   `json:"locked"`
	LockRemainingSeconds int    `json:"lockRemainingSeconds"`
}

func (s *AuthService) Status(ctx context.Context) (*AuthStatus, error) {
	c, err := s.creds.Get(ctx)
	if err != nil {
		return nil, err
	}
	st := &AuthStatus{State: "argon2id"}
	if c.Algo == "none" {
		if c.LegacyHash != "" {
			st.State = "legacy"
		} else {
			st.State = "virgin"
		}
	}
	if c.LockedUntil != nil {
		if rem := time.Until(*c.LockedUntil); rem > 0 {
			st.Locked = true
			st.LockRemainingSeconds = int(rem.Seconds())
		}
	}
	return st, nil
}

// Setup crée le credential d'un opérateur sur une installation vierge.
func (s *AuthService) Setup(ctx context.Context, secret string) error {
	c, err := s.creds.Get(ctx)
	if err != nil {
		return err
	}
	if c.Algo != "none" || c.PasswordHash != "" {
		return auth.ErrAlreadySetup
	}
	if err := auth.ValidateSecret(secret, s.policy.AllowWeakPIN); err != nil {
		return err
	}
	hash, err := auth.HashSecret(secret)
	if err != nil {
		return err
	}
	if err := s.creds.SetSecret(ctx, "argon2id", hash, true); err != nil {
		return err
	}
	_ = s.audit.Log(ctx, "operator", "auth.setup", "auth_credentials", "1", nil)
	return nil
}

// LoginResult : jeton et expiration (le jeton clair ne vit qu'en mémoire/handler).
type LoginResult struct {
	Token     string
	ExpiresAt time.Time
}

// Login vérifie le secret, gère le lockout persistant et l'upgrade du hash legacy.
func (s *AuthService) Login(ctx context.Context, secret, deviceID, userAgent string) (*LoginResult, error) {
	c, err := s.creds.Get(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now()

	if c.LockedUntil != nil && now.Before(*c.LockedUntil) {
		return nil, auth.ErrLocked
	}

	valid := false
	upgraded := false
	switch {
	case c.Algo == "argon2id" && c.PasswordHash != "":
		valid = auth.VerifyPHC(secret, c.PasswordHash)
	case c.Algo == "none" && c.LegacyHash != "":
		// transition : compatibilité legacy uniquement, puis re-hash immédiat (ADR A6)
		if auth.LegacyHash(secret, c.LegacySalt) == c.LegacyHash {
			hash, herr := auth.HashSecret(secret)
			if herr != nil {
				return nil, herr
			}
			if serr := s.creds.SetSecret(ctx, "argon2id", hash, true); serr != nil {
				return nil, serr
			}
			valid = true
			upgraded = true
		}
	default:
		// installation vierge : aucun login possible tant que setup non fait
		valid = false
	}

	if !valid {
		attempts := c.FailedAttempts + 1
		var lockedUntil *time.Time
		if attempts >= s.policy.MaxAttempts {
			t := now.Add(s.policy.Lockout)
			lockedUntil = &t
			attempts = 0
		}
		if err := s.creds.RecordFailure(ctx, attempts, lockedUntil); err != nil {
			return nil, err
		}
		_ = s.audit.Log(ctx, "operator", "auth.login_failed", "auth_credentials", "1",
			map[string]any{"attempts": attempts, "locked": lockedUntil != nil})
		if lockedUntil != nil {
			return nil, auth.ErrLocked
		}
		return nil, auth.ErrInvalidSecret
	}

	if err := s.creds.ResetFailures(ctx); err != nil {
		return nil, err
	}
	token, err := auth.NewToken()
	if err != nil {
		return nil, err
	}
	sess := &Session{
		ID:        newUUID(),
		TokenHash: auth.TokenHash(token),
		DeviceID:  deviceID,
		UserAgent: userAgent,
		CreatedAt: now,
		ExpiresAt: now.Add(s.policy.SessionTTL),
	}
	if err := s.sessions.Create(ctx, sess); err != nil {
		return nil, err
	}
	_ = s.sessions.DeleteExpired(ctx)
	details := map[string]any{"deviceId": deviceID}
	if upgraded {
		details["legacyUpgraded"] = true
	}
	_ = s.audit.Log(ctx, "operator", "auth.login", "auth_credentials", "1", details)
	return &LoginResult{Token: token, ExpiresAt: sess.ExpiresAt}, nil
}

// ValidateSession retourne la session valide associée au jeton.
func (s *AuthService) ValidateSession(ctx context.Context, token string) (*Session, error) {
	if token == "" {
		return nil, auth.ErrUnauthorized
	}
	sess, err := s.sessions.GetByTokenHash(ctx, auth.TokenHash(token))
	if err != nil || sess == nil {
		return nil, auth.ErrUnauthorized
	}
	now := s.now()
	if sess.RevokedAt != nil || now.After(sess.ExpiresAt) {
		return nil, auth.ErrUnauthorized
	}
	return sess, nil
}

// Logout révoque la session courante.
func (s *AuthService) Logout(ctx context.Context, token string) error {
	sess, err := s.ValidateSession(ctx, token)
	if err != nil {
		return nil // logout idempotent
	}
	if err := s.sessions.Revoke(ctx, sess.ID); err != nil {
		return err
	}
	_ = s.audit.Log(ctx, "operator", "auth.logout", "auth_sessions", sess.ID, nil)
	return nil
}

// ChangeSecret exige le secret courant ; le nouveau est haché Argon2id.
func (s *AuthService) ChangeSecret(ctx context.Context, current, next string) error {
	c, err := s.creds.Get(ctx)
	if err != nil {
		return err
	}
	valid := false
	switch {
	case c.Algo == "argon2id" && c.PasswordHash != "":
		valid = auth.VerifyPHC(current, c.PasswordHash)
	case c.Algo == "none" && c.LegacyHash != "":
		valid = auth.LegacyHash(current, c.LegacySalt) == c.LegacyHash
	}
	if !valid {
		return auth.ErrInvalidSecret
	}
	if err := auth.ValidateSecret(next, s.policy.AllowWeakPIN); err != nil {
		return err
	}
	hash, err := auth.HashSecret(next)
	if err != nil {
		return err
	}
	if err := s.creds.SetSecret(ctx, "argon2id", hash, true); err != nil {
		return err
	}
	_ = s.audit.Log(ctx, "operator", "auth.change_secret", "auth_credentials", "1", nil)
	return nil
}
