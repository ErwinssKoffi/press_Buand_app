# 02 — Contrat API `/api/v1`

Format : JSON, camelCase. Montants : entiers FCFA. Dates métier : `YYYY-MM-DD` ; horodatages : RFC3339 UTC.

## 1. Conventions transverses

- **Auth** : cookie de session `eclat_session` (HttpOnly, SameSite=Strict, Secure en HTTPS, 7 jours glissants). Toutes les routes sauf `/healthz`, `/readyz`, `/auth/status`, `/auth/login`, `/auth/setup` (conditionnel) exigent une session valide.
- **Erreurs** : `{ "error": { "code": "…", "message": "…", "details": {} } }` — mapping : 400 `invalid_request`, 401 `unauthorized`, 403 `forbidden`, 404 `not_found`, 409 `conflict`, 422 `business_rule`, 429 `rate_limited`, 500 `internal`.
- **Idempotence** : en-tête `Idempotency-Key` (UUID) requis sur `POST /orders`, `POST /orders/{id}/payments`, `POST /clients/{id}/wallet/topups`, `POST /inventory/{id}/movements` ; rejeu → même réponse, aucun double effet.
- **Pagination** : `?page=1&pageSize=50` (max 200) sur les listes → `{ "items": [...], "total": n, "page": p, "pageSize": s }`. Le bootstrap renvoie une fenêtre bornée (détail §3).
- **Enums stricts** (identiques aux unions TS) : `OrderStatus`, `PaymentMethod`, `ServiceMode`, `LogisticsStatus/Type`, `InventoryMovementType`.

## 2. Routes

| Méthode & route | Description | Succès |
|---|---|---|
| `GET /healthz` / `GET /readyz` | vivacité / accès base | 200 |
| `GET /auth/status` | état credential (`virgin`, `legacy`, `argon2id`), onboarding | 200 |
| `POST /auth/setup` | création du secret opérateur — **uniquement si `virgin`** | 204 |
| `POST /auth/login` | login {pinOrPassword} ; lockout persistant après N échecs ; legacy re-hash | 200 `{me}` |
| `POST /auth/logout` | révoque la session | 204 |
| `GET /auth/me` | session courante | 200 |
| `POST /auth/change-pin` | {currentPinOrPassword, newSecret} → Argon2id | 204 |
| `GET /bootstrap` | payload de démarrage (§3) | 200 |
| `GET /settings` / `PUT /settings` | lecture / mise à jour (sans secrets) | 200/200 |
| `GET /catalog` `POST /catalog` `PUT /catalog/{id}` `DELETE /catalog/{id}` | CRUD catalogue (DELETE → désactivation) | 200/204 |
| `GET /clients` `POST /clients` `GET/PUT /clients/{id}` `DELETE /clients/{id}` | CRUD clients (DELETE → archive) | 200/204 |
| `POST /clients/{id}/wallet/topups` | recharge {amountFCFA, bonusFCFA?, method, subscriptionLabel?, subscriptionExpiresAt?, note?} | 200 `{client}` |
| `GET /orders` `POST /orders` `GET /orders/{id}` | liste paginée + filtres (status, clientId, q) / création recalculée serveur | 200 |
| `PATCH /orders/{id}/status` | {status} — transition validée | 200 |
| `POST /orders/{id}/payments` | {amountFCFA, method} — rejet surpaiement | 200 |
| `POST /orders/{id}/void` | {reason} — annulation non destructive | 200 |
| `GET /expenses` `POST /expenses` `DELETE /expenses/{id}` | dépenses (DELETE → soft) | 200/204 |
| `GET /reports/daily-z?date=` | Z de caisse : recettes par méthode (order vs topup), dépenses, net | 200 |
| `GET /reports/monthly?month=` | bilan mensuel + séries journalières | 200 |
| `GET/POST /delivery-zones` `PUT/DELETE /delivery-zones/{id}` | zones | 200/204 |
| `GET/POST /logistics` `PATCH /logistics/{id}/status` `DELETE /logistics/{id}` | tâches ; `effectue` sur livraison → commande `livre` (même tx) | 200/204 |
| `GET/POST /inventory` `PUT /inventory/{id}` `DELETE /inventory/{id}` `POST /inventory/{id}/movements` | stocks ; mouvement {type, quantity, unitCostFCFA?, reason, recordExpense?, paymentMethod?} ; sortie > dispo rejetée | 200/204 |
| `GET /backup/export` | export JSON compatible v3+ | 200 |
| `POST /backup/preview` | validation sans écriture : compteurs, doublons, anomalies | 200 |
| `POST /backup/restore` | restauration atomique (audité) | 200 |
| `POST /sync/push` `GET /sync/pull?sinceRevision=` `GET /sync/status` | sync offline (détail phase 09) | 200 |

## 3. Payload `GET /bootstrap`

```json
{
  "settings": { … "sans pinHash/pinSalt" },
  "catalog": [ … ],
  "clients": [ … ],
  "orders": [ … fenêtre 90 jours … ],
  "payments": [ … fenêtre 90 jours … ],
  "expenses": [ … fenêtre 90 jours … ],
  "zones": [ … ],
  "logistics": [ … fenêtre 90 jours … ],
  "inventory": [ … ],
  "inventoryMovements": [ … fenêtre 90 jours … ],
  "sync": { "cursor": 0, "serverTime": "…" }
}
```

Décision : fenêtre 90 jours pour les flux volumineux (multiplicables via `?windowDays=n`, max 365) ; les listes complètes restent accessibles par routes paginées.

## 4. Création de commande — contrat clé

Requête `POST /orders` (draft front):

```json
{
  "idempotencyKey": "uuid-v7",
  "clientId": "uuid | null",
  "newClient": { "fullName": "…", "phone": "…", "commune": "…", "addressNote": "…" } | null,
  "clientName": "…", "clientPhone": "…", "commune": "…",
  "rackSlot": "A-12",
  "items": [{
    "id": "uuid", "catalogItemId": "uuid|null", "name": "…", "mode": "lavage_repassage",
    "quantity": 4, "unit": "pièce", "unitPriceFCFA": 1000,
    "pricingBasis": "unite|lot_10|lot_20|weight_kg|weight_offer", "piecesPerUnit": null,
    "weightKg": null, "isExpress": true, "expressDueDate": null, "note": "…"
  }],
  "isExpress": false, "deliveryZoneId": "uuid|null", "deliveryFeeFCFA": 1500,
  "discountFCFA": 500, "usePrepaid": true, "prepaidAmountFCFA": 2000,
  "loyaltyPointsRedeemed": 0,
  "initialPaymentMethod": "wave",
  "dropOffDate": "2026-11-27", "dueDate": "2026-11-29",
  "notes": "…", "claimPhotos": [{ "id": "uuid", "dataUrl": "data:image/jpeg;base64,…" }]
}
```

Réponse 200 : commande **recalculée et validée serveur** (unitPrice, express fee, delivery fee, discount borné, prepaid réellement débité, points, ticket officiel, paid, payments créés). Toute divergence majeure (>0 FCFA) entre le total client et le total recalculé renvoie le total serveur — le frontend affiche le montant autoritaire.

## 5. Sync — types d'opérations (push)

`client.upsert`, `client.topup`, `catalog.upsert`, `catalog.delete`, `order.create`, `order.status`, `order.payment`, `order.void`, `expense.upsert`, `expense.delete`, `zone.upsert`, `zone.delete`, `logistics.upsert`, `logistics.status`, `logistics.delete`, `inventory.item.upsert`, `inventory.item.delete`, `inventory.movement`, `settings.update`.

Résultat par opération : `accepted` (avec entité finale, ticket officiel éventuel), `duplicate` (déjà appliquée — idempotent), `conflict` (état serveur joint), `rejected` (code + résolution attendue). Ordre : dépendances déclarées ; le serveur retente le parent avant l'enfant.
