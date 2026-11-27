# Backend Go — Éclat Pressing

Monolithe modulaire Go exposant l'API `/api/v1` (voir `docs/migration/openapi.yaml`).
PostgreSQL est la source de vérité ; IndexedDB reste le cache hors ligne du frontend.

## Lancement local

```bash
# 1. PostgreSQL (Docker ou local)
docker compose up -d db          # à la racine du dépôt

# 2. Backend
cd backend
cp .env.example .env             # renseigner ECLAT_DATABASE_URL
export $(grep -v '^#' .env | xargs)
go run ./cmd/api                 # migrations auto-appliquées au démarrage
curl localhost:8080/healthz      # {"status":"ok"}
curl localhost:8080/readyz       # {"status":"ready"}
```

## Conteneur

```bash
docker compose up --build        # db + api (aucun Node requis)
```

## Variables

Voir `backend/.env.example`. En `ECLAT_ENV=production` : cookie `Secure` forcé et les
secrets faibles (PIN 5 chiffres) sont refusés à la création. `ECLAT_AUTO_MIGRATE=true`
applique les migrations SQL de `backend/migrations/` (idempotent : un redémarrage
n'applique rien et ne re-seed jamais).

## Structure

```text
cmd/api/            point d'entrée (aucune logique métier)
internal/config/    configuration env validée au démarrage
internal/server/    assemblage chi + middlewares
internal/handler/   handlers HTTP fins
internal/middleware/ request id, logs slog, recover, CORS, body limit
internal/domain/    types métier + règles (phases 05+)
internal/service/   cas d'usage transactionnels (phases 05+)
internal/repository/ accès pgx (phases 05+)
internal/platform/  database, migrate (runner interne versionné)
migrations/         SQL versionnés NNNN_nom.sql
```

## Tests

```bash
go test ./...
# intégration PostgreSQL (base dédiée obligatoire) :
ECLAT_TEST_DATABASE_URL='postgres://eclat@127.0.0.1:5432/eclat_it?sslmode=disable' go test ./...
```

Les tests d'intégration sautent proprement si `ECLAT_TEST_DATABASE_URL` n'est pas défini.

## Exploitation

Variables détaillées : `.env.example`. Mise en production, reverse proxy HTTPS,
mises à jour et retour arrière : `docs/deployment/PRODUCTION.md` ;
sauvegarde/restauration : `docs/deployment/BACKUP-RESTORE.md`.

## Environnements à réseau restreint (CI isolée)

`go.mod`/`go.sum` utilisent les chemins de modules canoniques (`golang.org/x/*`) ;
aucun `replace` spécifique n'est requis. Dans un environnement à réseau restreint
(sandbox sans accès à proxy.golang.org), le graphe se résout via un proxy GOPROXY
miroir servant les mêmes archives canoniques (outil utilisé lors de la migration,
conservé hors dépôt — voir `docs/migration/03-backend-scaffold.md`) : il suffit de
lancer `GOPROXY=<miroir> go build ./...`, les sommes de `go.sum` restent valides.
