# Éclat Pressing

Logiciel métier pour pressing/blanchisserie : dépôts avec tickets officiels,
paiements (espèces, Wave, Orange Money, MTN MoMo, Moov Money), wallet prépayé,
fidélité, statuts atelier, logistique, inventaire, dépenses, rapports journaliers
Z et mensuels, sauvegarde/restauration (compatibilité legacy v3) et **mode hors
ligne** avec synchronisation idempotente.

- **Backend** : Go monolithe modulaire + PostgreSQL (`backend/`) — aucune
  dépendance Node côté serveur.
- **Frontend** : React + Vite + PWA installable (`src/`) — IndexedDB v4 comme
  cache hors ligne (`outbox`, `conflicts`, `syncMeta`, `reconciliations`).
- **API** : `/api/v1` documentée dans `docs/migration/openapi.yaml`.

## Démarrage rapide (développement)

```bash
# 1. PostgreSQL + backend (aucun Node requis côté serveur)
docker compose up --build        # db :5432 + api :8080 (migrations auto)

# 2. Frontend
bun install                      # ou npm install
bun run dev                      # http://localhost:3000, proxy /api → :8080 (vite.config.ts)
```

Lancement sans Docker : voir `backend/README.md` (PostgreSQL local + `go run ./cmd/api`).
Premier accès : `/auth/setup` (PIN propriétaire), puis login — en `ECLAT_ENV=production`
les PIN à 5 chiffres identiques/faibles sont refusés.

## Fonctionnalités clés

| Domaine | Entrée |
|---|---|
| Authentification | PIN/mot de passe argon2id, sessions cookie HttpOnly, lockout persistant, rate limit |
| Dépôt (POS) | catalogue pièce/kilo/express/packs, photos de réserve (upload, dossier privé), casier, dates, remise, fidélité |
| Caisse | acompte/complément/solde, wallet recharge + bonus, **recalcul serveur systématique**, ticket officiel `EP-YYYY-NNNN` en transaction |
| Atelier | statuts reçu → lavage → repassage → prêt → livré, logistique par zone |
| Rapports | journalier Z, mensuel ; dépenses (créent un mouvement de stock automatique si article) |
| Inventaire | entrées/sorties/ajustements, seuil, historique, dépense automatique qty × coût |
| Sauvegarde | export JSON, prévisualisation, restauration confirmée (`X-Backup-Confirm`) ; import legacy v3 |
| Hors ligne | 6 opérations autorisées hors connexion (client, dépôt, paiement, dépense, stock, logistique), outbox persistant, réconciliation des références, conflits de tarifs explicites (`pricing_changed`), jamais last-write-wins sur les montants |

## Documentation

- `docs/migration/01…10-*.md` — cahiers des phases (audit → offline → audit final).
- `docs/deployment/PRODUCTION.md` — mise en production, HTTPS, mises à jour, retour arrière.
- `docs/deployment/BACKUP-RESTORE.md` — sauvegarde PostgreSQL vs export applicatif.
- `docs/deployment/DATA-MIGRATION.md` — import d'un backup legacy v3.
- `docs/qa/END-TO-END-ACCEPTANCE.md` — matrice des 15 parcours et preuves de test.
- `docs/migration/10-final-audit.md` — tableau de validation final et verdict.

## Développement

```bash
bun run lint            # tsc --noEmit
bun run build           # vite build (+ service worker PWA)
bun test tests/         # tests outbox/sync (fake-indexeddb)
bun run test:e2e        # E2E navigateur (serveurs :3000/:8080 démarrés, Chromium du registre npm)
cd backend && go vet ./... && go test ./...   # tests métier + intégration PostgreSQL
```

Tests d'intégration PostgreSQL : exporter `ECLAT_TEST_DATABASE_URL` (base de test
jetable, ex. `postgres://eclat@127.0.0.1:5432/eclat_test`) — les tests tronquent
leurs fixtures eux-mêmes. Sans cette variable, ils sont ignorés.
