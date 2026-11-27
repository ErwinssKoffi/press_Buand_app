// Package dbtx fournit l'abstraction Querier (pool ou transaction pgx)
// et le gestionnaire de transactions des services.
package dbtx

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Querier est satisfait à la fois par *pgxpool.Pool et par pgx.Tx.
type Querier interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, arguments ...any) pgx.Row
	Query(ctx context.Context, sql string, arguments ...any) (pgx.Rows, error)
}

// TxManager exécute fn dans une transaction ; rollback en cas d'erreur ou de panic.
type TxManager struct {
	pool *pgxpool.Pool
}

func NewTxManager(pool *pgxpool.Pool) *TxManager { return &TxManager{pool: pool} }

// WithTx ouvre une transaction et la commit si fn renvoie nil.
func (m *TxManager) WithTx(ctx context.Context, fn func(ctx context.Context, q Querier) error) error {
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		// Rollback si le callback panique OU sort par runtime.Goexit
		// (testing.Fatalf) : sinon la connexion reste louée et puddle.Close
		// attend indéfiniment.
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		}
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()
	if err := fn(ctx, Tx(tx)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	committed = true
	return nil
}

type txAdapter struct{ tx pgx.Tx }

// Tx adapte pgx.Tx à Querier.
func Tx(tx pgx.Tx) Querier { return txAdapter{tx: tx} }

func (a txAdapter) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return a.tx.Exec(ctx, sql, args...)
}
func (a txAdapter) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return a.tx.QueryRow(ctx, sql, args...)
}
func (a txAdapter) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return a.tx.Query(ctx, sql, args...)
}

type poolAdapter struct{ pool *pgxpool.Pool }

// Pool adapte le pool à Querier (lectures / opérations simples).
func Pool(pool *pgxpool.Pool) Querier { return poolAdapter{pool} }

func (p poolAdapter) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return p.pool.Exec(ctx, sql, args...)
}
func (p poolAdapter) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return p.pool.QueryRow(ctx, sql, args...)
}
func (p poolAdapter) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return p.pool.Query(ctx, sql, args...)
}
