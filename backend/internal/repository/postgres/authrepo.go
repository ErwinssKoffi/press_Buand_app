// Package postgres contient tous les accès données pgx.
package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/erwinsskoffi/press_backend/internal/platform/ids"
	"github.com/erwinsskoffi/press_backend/internal/service"
)

// Repo agrège tous les repositories sur un pool commun.
type Repo struct {
	pool *pgxpool.Pool
	Auth *AuthRepo
}

func New(pool *pgxpool.Pool) *Repo {
	r := &Repo{pool: pool}
	r.Auth = &AuthRepo{pool: pool}
	return r
}

// AuthRepo : credentials + sessions.
type AuthRepo struct {
	pool *pgxpool.Pool
}

func (r *AuthRepo) Get(ctx context.Context) (*service.Credential, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT algo, COALESCE(password_hash,''), COALESCE(legacy_hash,''), COALESCE(legacy_salt,''),
		       failed_attempts, locked_until
		FROM auth_credentials WHERE id = 1`)
	c := &service.Credential{}
	if err := row.Scan(&c.Algo, &c.PasswordHash, &c.LegacyHash, &c.LegacySalt,
		&c.FailedAttempts, &c.LockedUntil); err != nil {
		return nil, err
	}
	return c, nil
}

func (r *AuthRepo) SetSecret(ctx context.Context, algo, passwordHash string, clearLegacy bool) error {
	q := `UPDATE auth_credentials SET algo=$1, password_hash=$2, failed_attempts=0, locked_until=NULL, updated_at=now()`
	if clearLegacy {
		q += `, legacy_hash='', legacy_salt=''`
	}
	q += ` WHERE id = 1`
	_, err := r.pool.Exec(ctx, q, algo, passwordHash)
	return err
}

func (r *AuthRepo) SetLegacy(ctx context.Context, legacyHash, legacySalt string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE auth_credentials SET legacy_hash=$1, legacy_salt=$2, updated_at=now() WHERE id=1`,
		legacyHash, legacySalt)
	return err
}

func (r *AuthRepo) RecordFailure(ctx context.Context, attempts int, lockedUntil *time.Time) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE auth_credentials SET failed_attempts=$1, locked_until=$2, updated_at=now() WHERE id=1`,
		attempts, lockedUntil)
	return err
}

func (r *AuthRepo) ResetFailures(ctx context.Context) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE auth_credentials SET failed_attempts=0, locked_until=NULL, updated_at=now() WHERE id=1`)
	return err
}

func (r *AuthRepo) Create(ctx context.Context, s *service.Session) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO auth_sessions (id, token_hash, device_id, user_agent, created_at, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		s.ID, s.TokenHash, s.DeviceID, s.UserAgent, s.CreatedAt, s.ExpiresAt)
	return err
}

func (r *AuthRepo) GetByTokenHash(ctx context.Context, tokenHash string) (*service.Session, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id, token_hash, COALESCE(device_id,''), COALESCE(user_agent,''), created_at, expires_at, revoked_at
		FROM auth_sessions WHERE token_hash = $1`, tokenHash)
	s := &service.Session{}
	if err := row.Scan(&s.ID, &s.TokenHash, &s.DeviceID, &s.UserAgent, &s.CreatedAt, &s.ExpiresAt, &s.RevokedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return s, nil
}

func (r *AuthRepo) Revoke(ctx context.Context, sessionID string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
		sessionID)
	return err
}

func (r *AuthRepo) DeleteExpired(ctx context.Context) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM auth_sessions WHERE expires_at < now() - interval '1 day' OR revoked_at < now() - interval '1 day'`)
	return err
}

// AuditRepo journalise les actions sensibles.
type AuditRepo struct {
	pool *pgxpool.Pool
}

func NewAuditRepo(pool *pgxpool.Pool) *AuditRepo { return &AuditRepo{pool: pool} }

func (r *AuditRepo) Log(ctx context.Context, actor, action, entity, entityID string, details map[string]any) error {
	if details == nil {
		details = map[string]any{}
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO audit_logs (actor, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)`,
		actor, action, entity, entityID, details)
	return err
}

var _ = ids.NewUUID
