# 06 — API REST complète `/api/v1`

> Prompt 06/10. État : **implémentée, testée (full-stack HTTP sur PG réel), OpenAPI synchronisée, exemples fournis**.

## 1. Routes réellement montées (`internal/handler/http/api.go`)

Alignées sur `docs/migration/02-api-contract.md` :

| Domaine | Routes |
|---|---|
| Bootstrap | `GET /bootstrap?windowDays=` (défaut 90, max 365) |
| Settings | `GET/PUT /settings` |
| Catalogue | `GET/POST /catalog`, `PUT/DELETE /catalog/{id}` (DELETE = désactivation, 204) |
| Clients | `GET/POST /clients`, `GET/PUT/DELETE /clients/{id}` (DELETE = archive, 204), `POST /clients/{id}/wallet/topups` |
| Commandes | `GET/POST /orders`, `POST /orders/mapping`, `GET /orders/{id}`, `GET/POST /orders/{id}/payments`, `PATCH /orders/{id}/status`, `POST /orders/{id}/void`, `GET /orders/{id}/photos/{photoId}` |
| Caisse | `GET/POST /expenses`, `DELETE /expenses/{id}` (soft-delete) |
| Rapports | `GET /reports/daily-z?date=`, `GET /reports/monthly?month=` |
| Zones | `GET/POST /delivery-zones`, `PUT/DELETE /delivery-zones/{id}` |
| Logistique | `GET/POST /logistics`, `PATCH /logistics/{id}/status`, `DELETE /logistics/{id}` |
| Stocks | `GET/POST /inventory`, `PUT/DELETE /inventory/{id}` (DELETE = archive), `GET/POST /inventory/{id}/movements` |
| Backup | `GET /backup/export` (v3), `POST /backup/preview`, `POST /backup/restore` → **501** (Prompt 08) |
| Sync | `POST /sync/push`, `GET /sync/pull`, `GET /sync/status` → **501** (Prompt 09) |

## 2. DTO et conventions

- Requêtes/réponses camelCase (`MappingRequest`, `PaymentRequest`, `TopupRequest`, `MovementRequest`, `StatusRequest`) — séparés des modèles de persistance.
- **Succès** : données à nu (`200/201` : objet ou tableau ; listes paginées `{items,total,page,pageSize}` ; mutations sans contenu → `204`).
- **Erreurs** : `{"error":{"code","message","details?"}}` uniforme (`WriteError`).
- Enums stricts validés côté service (`ValidServiceMode`, `ValidPaymentMethod`, `ValidLogisticsStatus`, `ValidMovementType`, `ValidStatus`).

## 3. Codes HTTP — classification réelle

| Code | Quand |
|---|---|
| `400 invalid_request` | JSON/params invalides, `shopName` vide, unité/moyen/quantité/montant invalide (`ErrValidation`, `ErrInvalidAmount`, `ErrInvalidQuantity`), **Idempotency-Key manquante** |
| `401 unauthorized` | session absente/expirée (`RequireAuth`) |
| `403 forbidden` | Origin non autorisé (OriginGuard) |
| `404 not_found` | ressource introuvable (commande, client, article, tâche) |
| `409 conflict` | **rejeu idempotent** (`ErrIdempotentReplay`), setup déjà fait |
| `422 business_rule` | surpaiement, stock insuffisant, transition invalide, commande annulée, zone/pack/offre inconnu, fidélité non éligible, backup schemaVersion ≠ 3 |
| `501 not_implemented` | backup restore / sync (phases 08–09, documenté) |
| `500 internal` | tout le reste — **journalisé** (`slog.Error` avec l'erreur), message générique au client |

## 4. Idempotence (contrat §1)

- `POST /orders` : clé en **en-tête `Idempotency-Key` ou champ `idempotencyKey`** — requise (400 sinon) ; rejeu → `409 conflict`, aucun double effet.
- `POST /orders/{id}/payments`, `POST /clients/{id}/wallet/topups`, `POST /inventory/{id}/movements` : même mécanisme (en-tête ou corps).
- Conservation : table `idempotency_keys (scope, key)` — `order.create`, `order.payment`, `client.topup`, `inventory.movement`.

## 5. Bootstrap

`GET /bootstrap` renvoie settings + catalogue + zones + clients (≤200) + commandes/paiements/dépenses/logistique sur fenêtre glissante (90 j par défaut) + inventaire + 500 derniers mouvements + `{sync:{cursor, serverTime}}`. Volumétrie bornée ; routes paginées pour le reste.

## 6. Sécurité

- Toutes les routes métier derrière `RequireAuth` (cookie `eclat_session` HttpOnly SameSite=Strict) ; le middleware global CORS/OriginGuard/BodyLimit(10 Mo)/SecurityHeaders/RequestID/Logger s'applique.
- Photos servies par route authentifiée (`bytea` en base), jamais de chemin disque exposé.
- Aucun hash/secret dans les DTO publics (settings sans credentials).
- Logs de requête sans payload ni données sensibles.

## 7. OpenAPI

`docs/migration/openapi.yaml` mis à jour depuis le comportement réel :
`POST /orders` → 201 + idempotence header/corps + `409` ; `POST /orders/mapping` documenté ; `GET /orders/{id}/payments` ajouté ; `PATCH /orders/{id}/status` → `422` ; idempotence mouvements ; backup restore/sync → `501` documentés. Validé YAML.

## 8. Tests

- **Full-stack HTTP (`api_integration_test.go`, PG réel)** : setup/login/logout, 401 sans session, validation settings/catalogue (400), CRUD, topup idempotent (409 au rejeu, solde inchangé), commande complète (201, ticket, totaux recalculés), Idempotency-Key requise (400), rejeu commande (409), mapping (aperçu fidèle), régression statut (422), surpaiement (422), liste + pagination + filtres, 404, dépenses (valid + 400), Z de caisse (agrégats exacts), logistique PATCH → commande `livre`, stock (entrée idempotente 409, sortie excessive 422), backup export/preview (+422 schema), stubs 501, bootstrap (tous champs), logout → 401.
- Suite unitaire + intégration complète : **tous les packages passent** (avec et sans `ECLAT_TEST_DATABASE_URL`).

## 9. Bugs corrigés pendant la phase

1. `AuthRepo.SetSecret` : UPDATE sans INSERT → setup silencieusement perdu sur base sans seed ; **UPSERT** implémenté.
2. `GET /settings` etc. renvoyaient une enveloppe `{success,data}` non conforme au contrat → données à nu + erreurs uniformes.
3. `PricingResult` sans tags JSON (noms Go exposés) → tags camelCase.
4. Idempotence paiements : clé acceptée en-tête **ou** corps partout.
5. Route `/orders/mapping` oubliée lors du remaniement → 405 ; rétablie.
6. Classification : montant négatif/moyen invalide → `400 invalid_request` (et non 422), conformément au contrat.
