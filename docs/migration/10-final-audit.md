# Prompt 10 — Audit final, durcissement et préparation production

> Audit exécuté le 2026-11-27 (branche `arena/4cae6de1-press-buand-app`).
> Environnement : Go 1.27, PostgreSQL 16, bun 1.x. **Aucun secret dans ce
> rapport** : les valeurs de configuration sont des placeholders.

## 1. Actions d'audit et corrections appliquées

| Vérification | Résultat | Action |
|---|---|---|
| `gofmt -l .` (backend) | vide — formaté | — |
| `go vet ./...` | propre | — |
| `go test ./...` (avec `ECLAT_TEST_DATABASE_URL`, PG réel) | PASS (services, handlers http, backup) | — |
| Couverture | config 70 %, auth 85 % ; services couverts par les INT (17,5 % unitaire) | voir défauts non bloquants |
| Requêtes SQL | exclusivement paramétrées (`$N`) — les seuls `Sprintf` construisent des placeholders | — |
| Goroutines/contextes | aucun `go func` résiduel ; arrêt gracieux `signal.Notify` + `srv.Shutdown(grace)` vérifié en live | — |
| Frontend Node serveur résiduel | `express`, `@google/genai`, `dotenv`, `motion` présents mais **jamais importés** | **supprimés** (`bun remove`), build/lint/tests revalidés |
| `localDb.ts` | utilisé et testé (IndexedDB v4 repository + outbox sync, 18/18 bun) | conservé (le critère de retrait n'est pas rempli) |
| Secrets | aucun secret dans git/logs/réponses ; bundle `dist/` sans clé ni `Bearer` | racine `.env.example` réécrite (l'ancien référençait `GEMINI_API_KEY`, obsolète) |
| Service worker / PWA | `vite-plugin-pwa` actif, `dist/sw.js` généré ; manifest + install button | — |
| docker-compose | fichier correct (healthcheck `pg_isready`, depends_on healthy, aucun Node) | **non exécutable dans l'environnement d'audit** (pas de démon Docker) — à valider sur l'hôte cible |
| Requêtes N+1 | pull sync : 1 requête par entité (10 requêtes/page), agrégats `json_agg` — pas de N+1 par ligne | — |
| Restauration PostgreSQL | **cycle pg_dump → pg_restore exécuté** sur base de contrôle : nombres de lignes identiques (clients 2, orders 3, payments 3, expenses 1, catalog 1, devices 2, sync_operations 8) | journalisé dans `BACKUP-RESTORE.md` |
| Smoke live complet | auth, settings, sync push/pull/status (conflit tarif réel, reprise `acceptPricing`, réconciliation paiement provisoire, retry `duplicate`), backup export/preview/restore | §3 |

## 2. Tableau de validation final (par module)

| Module | Source Go | Endpoint(s) | Écran | Tests | État | Risque restant |
|---|---|---|---|---|---|---|
| Auth PIN/session/lockout | `service/auth.go` | `/auth/*` | LoginView | UNIT + INT + LIVE | **PASS** | réinitialisation PIN uniquement en base (procédure à fournir à l'exploitant) |
| Sessions/rate limit/CORS | `middleware/*` | tous | — | INT (401/403/429) | **PASS** | CORS à renseigner strictement en prod |
| Settings/onboarding | `service/others.go` | GET/PUT `/settings` | SettingsView, OnboardingView | INT + LIVE | **PASS** | — |
| Catalogue/tarifs | `service/pricing.go` + repos | `/catalog` CRUD | CatalogView, PosDepositView | UNIT `pricing_test` + INT | **PASS** | express est un réglage frontend (hors DB, assumé) |
| Clients | `service/others.go` | `/clients` CRUD | ClientsView | INT + LIVE (sync, fusion tél.) | **PASS** | — |
| Dépôt + photos | `service/orders.go` | POST `/orders`, `/orders/{id}/photos/{photoId}` | PosDepositView, GarmentThumbnail | INT (matérialisation storage) + LIVE | **PASS** | photos hors ligne non autorisées (documenté) |
| Tickets officiels | `service/orders.go` (`NextTicket` en tx) | — | TicketPrintModal | INT 2 appareils → tickets distincts ; LIVE `EP-2026-0001/0002` | **PASS** | — |
| Caisse/paiements | `service/orders.go` | `/orders/{id}/payments` | CashbookView | INT + LIVE (double paiement refusé) | **PASS** | — |
| Wallet prépayé/fidélité | `service/others.go` | `/wallet/topups` | CashbookView | INT (bonus, consommation) | **PASS** | — |
| Statuts atelier/logistique | `service/others.go` | PATCH `/orders/{id}/status`, `/logistics` | LogisticsView, OrdersView | INT (transitions + void) | **PASS** | — |
| Dépenses/rapports Z & mensuel | `service/reports.go` | `/expenses`, `/reports/*` | DashboardView, MonthlyRevenueChart | INT (totaux recalculés) | **PASS** | — |
| Inventaire | `service/others.go` | `/inventory/*` + movements | InventoryView | INT (seuil, dépense auto) + LIVE | **PASS** | — |
| Sauvegarde/restore | `internal/backup` | `/backup/*` | SettingsView | INT + LIVE + pg_dump→restore vérifié | **PASS** | volume photos à sauvegarder en même temps que la base |
| Import legacy v3 | `internal/backup` | `/backup/preview`+`restore` | SettingsView | INT + LIVE | **PASS** | fichiers v3 très anciens à re-tester à l'occasion d'une vraie migration client |
| Sync offline push/pull | `service/sync.go` | `/sync/*` | OfflineBanner (pending/conflits) | INT 7/7 PG + UNIT 18/18 + LIVE complet + **E2E Chromium 2/2** | **PASS** | parcours dépôt complet hors ligne reste dans la checklist manuelle |
| PWA/service worker | — (frontend) | — | PWAInstallButton | build + checklist | **PASS** (build) | mise à jour SW à observer en prod |

## 3. Journal du smoke live (toutes vérifications exécutées sur serveur réel)

```
login PIN        → 200 ; mauvais PIN → 401 ; second setup → 409
GET  /sync/status→ {serverTime, cursor, device{...}}
PUSH client+order (article inexistant)      → rejected business_rule (règles serveur appliquées)
PUSH order.create seenTotal≠recalcul        → conflict pricing_changed (recalcul exposé)
REPRISE acceptPricing:true                  → accepted, ticket EP-2026-0001 (total 2000)
PUSH order.create cohérent                  → accepted EP-2026-0002
PUSH order.payment sur ID provisoire        → accepted, refs résolues (paid 500/2000)
RETRY même operationId                      → duplicate, aucun doublon SQL (payments=3, EP-2026 ×2)
PULL depuis cursor                          → changements incrémentaux, hasMore/cursor
BACKUP export/preview/restore               → 200 (X-Backup-Confirm exigé)
pg_dump→pg_restore base de contrôle         → nombres de lignes identiques
E2E navigateur (Chromium, 2 scénarios offline) → PASS (bun run test:e2e)
CI GitHub Actions → SUCCESS : backend (gofmt/vet/tests PG réels + build image),
frontend (tsc + bun tests + build PWA), docker compose up réel + healthz/readyz
+ setup/login ; corrections déclenchées par la CI : go.sum canonique (le miroir
GOPROXY du sandbox re-empaquette les archives — variante -modfile non committée
pour le sandbox), go test -p 1 (packages sérialisés sur bases partagées),
ordre des sections du test full-stack (photo avant restore, sinon 404)
```

## 4. Défauts non bloquants (priorités et plan)

| # | Défaut | Priorité | Plan |
|---|---|---|---|
| 1 | ~~Pas d'E2E navigateur automatisé~~ **RÉSOLU** : `tests/e2e/e2e-offline.test.ts` (Chromium réel via `@sparticuz/chromium` npm) — 2 scénarios PASS : client créé hors ligne → bannière en attente → sync → présent côté serveur ; fermeture navigateur → outbox persisté → reprise → sync sans doublon | **P1** | exécuté ; à brancher en CI (réseau sortant libre) — `bun run test:e2e` |
| 2 | Couverture unitaire services faible (17,5 %) — la logique est couverte par les INT | P2 | extraire des tests unitaires pricing/orders sans DB pour feedback rapide ; viser ≥ 50 % sur `pricing.go` |
| 3 | ~~docker-compose non validé sur démon Docker~~ **COUVERT EN CI** : job `compose` (.github/workflows/ci.yml) — `docker compose up --build`, healthchecks, setup auth 204, arrêt propre ; à confirmer une fois sur l'hôte cible réel | P1 | workflow CI fourni |
| 4 | `ECLAT_CORS_ORIGINS` vide par défaut : en prod, aucune mutation navigateur possible si non renseigné | P2 | documenté (PRODUCTION §1, diagnostic 403) ; vérifier au déploiement |
| 5 | Rotation des sessions non renouvelée à l'activité (TTL fixe 7 j) | P3 | glissement de fenêtre optionnel si l'exploitant le demande |
| 6 | Export JSON de gros volume synchrone (timeout client 120 s) | P3 | si besoin : export en fichier + téléchargement (chunking) |

## 5. Verdict

**PRÊT POUR PILOTE.**

Justification honnête :

- tous les parcours métier essentiels sont **réussis avec preuve** (INT PG réel
  + LIVE sur serveur réel + tests offline) ; la migration legacy, la
  sauvegarde/restauration et le mode hors ligne (dédoublonnement, conflits,
  réconciliation) sont testés et journalisés ;
- sécurité contrôlée : argon2id, lockout persistant, rate limit, CORS explicite,
  cookie HttpOnly/Secure en production, requêtes paramétrées, uploads limités et
  validés, aucune logique métier autoritative côté React (recalcul serveur
  systématique, ticket en tx serveur) ;
- **ne pas annoncer « PRÊT POUR PRODUCTION »** avant : (a) validation
  `docker compose` sur l'hôte cible, (b) E2E navigateur manuel de la checklist
  QA §2 sur l'installation réelle, (c) HTTPS/reverse proxy réellement en place,
  (d) première sauvegarde planifiée **et** restauration testée sur ce même
  hôte. Le passage pilote → production doit suivre la checklist
  `docs/deployment/PRODUCTION.md` §10.

Aucune donnée réelle n'a été supprimée pendant l'audit (les vérifications de
restauration ont utilisé une base de contrôle dédiée, supprimée après usage).
