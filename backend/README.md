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
ECLAT_TEST_DATABASE_URL='postgres://eclat@127.0.0.1:5432/eclat_it?sslmode=disable' go test -p 1 ./...
```

Les tests d'intégration sautent proprement si `ECLAT_TEST_DATABASE_URL` n'est pas défini.
`-p 1` sérialise les packages : les fixtures tronquent les mêmes tables et un scénario
ne doit jamais être interrompu par un `TRUNCATE` d'un autre package.

## Exploitation

Variables détaillées : `.env.example`. Mise en production, reverse proxy HTTPS,
mises à jour et retour arrière : `docs/deployment/PRODUCTION.md` ;
sauvegarde/restauration : `docs/deployment/BACKUP-RESTORE.md`.

## Environnements à réseau restreint (CI isolée)

`go.mod`/`go.sum` sont **canoniques** (chemins `golang.org/x/*`, sommes vérifiées
contre `sum.golang.org` en CI) : aucun `replace` spécifique dans les fichiers
committés. Dans un environnement à réseau restreint sans accès à proxy.golang.org,
on utilise une **variante `-modfile`** générée à la demande (non committée,
gitignorée) qui remappe `golang.org/x/* → github.com/golang/*` (miroir officiel)
avec les sommes du miroir local :

```bash
# à faire une seule fois dans le clone restreint (sandbox de migration) :
cp go.mod sandbox.go.mod
# + bloc replace golang.org/x/* => github.com/golang/* (voir git log)
GOPROXY=<miroir-local> GOSUMDB=off go mod tidy -modfile=sandbox.go.mod

# puis toutes les commandes Go avec :
export GOFLAGS=-modfile=sandbox.go.mod
go vet ./... && go test ./...
```

Voir `docs/migration/03-backend-scaffold.md` pour l'outil de proxy local.
