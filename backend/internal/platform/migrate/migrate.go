// Package migrate applique des migrations SQL versionnées de façon
// reproductible et transactionnelle. Chaque fichier backend/migrations/NNNN_*.sql
// est appliqué une seule fois, dans une transaction, et enregistré dans
// schema_migrations. Alternatif autonome à golang-migrate, sans dépendance
// externe (voir docs/migration/02-target-architecture.md, ADR A4).
package migrate

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

var fileNameRe = regexp.MustCompile(`^(\d{4})_([a-z0-9_]+)\.sql$`)

type migrationFile struct {
	version int
	name    string
	sql     string
}

// Migrate applique toutes les migrations manquantes du dossier dir.
// Elle est idempotente : un redémarrage n'applique rien de nouveau.
func Migrate(ctx context.Context, pool *pgxpool.Pool, dir string) ([]int, error) {
	if _, err := os.Stat(dir); err != nil {
		return nil, fmt.Errorf("dossier migrations introuvable %s: %w", dir, err)
	}
	files, err := loadDir(dir)
	if err != nil {
		return nil, err
	}
	if _, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations(
		version bigint PRIMARY KEY,
		name text NOT NULL,
		applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return nil, fmt.Errorf("créer schema_migrations: %w", err)
	}
	applied := map[int64]bool{}
	rows, err := pool.Query(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return nil, err
		}
		applied[v] = true
	}
	rows.Close()

	var pending []migrationFile
	for _, f := range files {
		if !applied[int64(f.version)] {
			pending = append(pending, f)
		}
	}
	var done []int
	for _, m := range pending {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return done, err
		}
		if _, err := tx.Exec(ctx, m.sql); err != nil {
			_ = tx.Rollback(ctx)
			return done, fmt.Errorf("migration %04d_%s: %w", m.version, m.name, err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO schema_migrations(version, name) VALUES ($1,$2)`,
			m.version, m.name); err != nil {
			_ = tx.Rollback(ctx)
			return done, err
		}
		if err := tx.Commit(ctx); err != nil {
			return done, err
		}
		done = append(done, m.version)
	}
	return done, nil
}

func loadDir(dir string) ([]migrationFile, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var out []migrationFile
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		m := fileNameRe.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		v, _ := strconv.Atoi(m[1])
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, err
		}
		out = append(out, migrationFile{version: v, name: m[2], sql: string(b)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	seen := map[int]bool{}
	for _, m := range out {
		if seen[m.version] {
			return nil, fmt.Errorf("version de migration dupliquée: %04d", m.version)
		}
		seen[m.version] = true
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("aucune migration trouvée dans %s (fichiers NNNN_nom.sql)", dir)
	}
	if strings.TrimSpace(out[0].sql) == "" {
		return nil, fmt.Errorf("migration vide: %04d", out[0].version)
	}
	return out, nil
}
