# 03 — Squelette backend Go et infrastructure PostgreSQL

> Prompt 03/10 du playbook. État : livré (commit dc504a8 + 55efe01), complété par la phase 04 (auth) et la phase 05 (métier).

## 1. Stack

| Composant | Choix | Note |
|---|---|---|
| Langage | Go 1.27 | module `github.com/erwinsskoffi/press_backend` |
| Routeur HTTP | `go-chi/chi v5.5.0` | léger, stdlib-compatible |
| PostgreSQL | `jackc/pgx/v5 v5.13.0` (pgxpool) | driver pur, requêtes paramétrées |
| UUID | `google/uuid v1.6.0` | UUIDv7 via `internal/platform/ids` |
| Hash | `golang.org/x/crypto` (Argon2id) | phase 04 |
| Logs | `log/slog` JSON structuré, sans données sensibles | |

Dépendances indirectes `golang.org/x/*` remplacées par les miroirs `github.com/golang/*` (contrainte réseau du sandbox, transparente en prod).

## 2. Arborescence

```
backend/
├── cmd/api/main.go            # assemblage : config, pool, migrations, serveur, shutdown gracieux
├── migrations/0001_init.sql   # schéma complet (tables métier + auth + sync + audit)
├── migrations/0002_seed.sql   # seeds idempotents (settings par défaut, credential 'none', compteur année)
└── internal/
    ├── config/                # ECLAT_* uniquement, validation au boot
    ├── domain/auth/           # politique Argon2id/PIN (pure)
    ├── domain/pressing/       # enums + DTO camelCase + configs JSONB (phase 05)
    ├── handler/http/          # handlers fins : auth + API métier /api/v1
    ├── middleware/            # RequestID, Recover, Logger, SecurityHeaders, CORS, BodyLimit
    ├── platform/database/     # Connect (pool, timeouts, limits)
    ├── platform/migrate/      # runner SQL interne : table schema_migrations, fichiers ordonnés, idempotent
    ├── platform/ids/          # UUIDv7
    ├── platform/itest/        # verrou flock pour tests d'intégration parallèles
    ├── platform/dbtx/         # Querier (pool|tx) + TxManager.WithTx (rollback erreur/panic/Goexit)
    ├── repository/postgres/   # AuthRepo, AuditRepo + repos métier (orders, ops)
    ├── server/                # chi : healthz/readyz, /auth/*, /api/v1 protégé (OriginGuard + RequireAuth)
    └── service/               # AuthService + services métier (pricing, orders, others, reports)
```

## 3. Migration SQL interne

- `migrate.Migrate(ctx, pool, dir)` : lit `NNNN_nom.sql` triés, applique dans **une transaction par fichier**, enregistre la version dans `schema_migrations`, ignore les déjà appliquées.
- Exécutée au démarrage (`ECLAT_AUTO_MIGRATE=true`, défaut) et par les tests d'intégration.
- **Jamais** de driver externe ni d'outil tiers.

## 4. Configuration (env, préfixe `ECLAT_`)

| Variable | Défaut | Rôle |
|---|---|---|
| `ECLAT_ENV` | `development` | development/production/test |
| `ECLAT_HTTP_ADDR` | `:8080` | écoute |
| `ECLAT_DATABASE_URL` | — (obligatoire) | `postgres://…` |
| `ECLAT_SESSION_TTL` | 168 h (7 j) | sessions cookie |
| `ECLAT_COOKIE_SECURE` | false | Secure en production |
| `ECLAT_CORS_ORIGINS` | vide | allowlist, séparées par virgules |
| `ECLAT_BODY_LIMIT` | 10 MiB | 64 Ko–100 Mo |
| `ECLAT_LOGIN_MAX_ATTEMPTS` / `ECLAT_LOGIN_LOCKOUT` | 5 / 5 min | lockout persistant |
| `ECLAT_ALLOW_WEAK_PIN` | false | PIN 5 chiffres hors prod |
| `ECLAT_AUTO_MIGRATE` | true | migrations au boot |
| `ECLAT_STORAGE_DIR` | `/var/lib/eclat/storage` | fichiers (photos/exports) |
| `ECLAT_SHUTDOWN_GRACE` | 15 s | arrêt gracieux |

`backend/.env.example` documenté, sans secret réel.

## 5. Conventions serveur

- Middlewares globaux : RequestID → Recover → Logger → SecurityHeaders → CORS → BodyLimit.
- `/healthz` (process OK) et `/readyz` (ping DB) hors auth.
- `/auth/*` : OriginGuard (Origin absent OU allowlist) ; mutations JSON only.
- `/api/v1/*` : OriginGuard + RequireAuth (cookie `eclat_session`, HttpOnly, SameSite=Strict).
- 404/405 JSON via `WriteError` ; format d'erreur stable étendu en phase 06.
- Arrêt gracieux : SIGINT/SIGTERM → `Shutdown(grace)` → pool.Close.

## 6. Docker

- `backend/Dockerfile` multi-stage (golang:alpine → distroless/alpine, binaire statique `CGO_ENABLED=0`).
- `docker-compose.yml` développement : service `db` (postgres:16-alpine, volume, healthcheck) + `api` (dépend healthcheck, `ECLAT_*`), pas de Node.
- Build/test sans Docker dans ce sandbox (compilation directe).

## 7. Tests d'infrastructure

- `platform/migrate` : intégration sur PG réel (versions appliquées, idempotence).
- `config` : validation des bornes et défauts.
- `server`/handlers : smoke HTTP (auth + ping) via `httptest`.
- Correction d'exécution : les tests d'intégration parallèles sérialisent l'accès à la base dédiée via `itest.LockTestDB` (flock `/tmp/eclat_it.lock`) et passent toujours par `migrate.Migrate`.
