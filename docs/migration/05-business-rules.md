# 05 — Règles métier migrées vers les services Go

> Prompt 05/10 du playbook. État : **implémenté, testé, validé en live** (smoke HTTP complet sur PostgreSQL réel).
> Source de vérité frontend portée : `src/db/localDb.ts` (1707 l.), `src/utils/formatters.ts`, `src/views/PosDepositView.tsx`.

## 1. Cartographie des services

| Service (Go) | Fichier | Rôle | Remplace (frontend) |
|---|---|---|---|
| `RecalculateOrder` | `internal/service/pricing.go` | Tarification autoritaire : pièces, kilo, offres poids, packs blanchisserie, express, zone, remises, fidélité, prépayé | `computeOrderTotals`/`createOrderWithPayment` (PosDepositView) |
| `OrderService` | `internal/service/orders.go` | Création transactionnelle, transitions, paiements complémentaires, annulation, photos | `createOrderWithPayment`, `advanceOrderStatus`, `voidOrder` |
| `SettingsService` | `internal/service/others.go` | Paramètres boutique, normalisation bornée | `saveSettings`/`normalizeSettings` |
| `CatalogService` | `internal/service/others.go` | Catalogue (création/màj/désactivation) | `saveCatalogItem` |
| `ClientService` | `internal/service/others.go` | Clients + archivage + historique wallet | `saveClient`, `archiveClient` |
| `ClientService.Topup` | `internal/service/others.go` | Recharge + bonus + abonnement + PaymentRecord `prepaid_topup` | `topUpClientPrepaid` |
| `LogisticsService` | `internal/service/others.go` | Tâches enlèvement/livraison, zones | `saveLogisticsTask`, `toggleTaskStatus`, `saveDeliveryZone` |
| `InventoryService` | `internal/service/others.go` | Articles, mouvements (entrée/sortie/ajustement), dépense auto | `saveInventoryItem`, `recordInventoryMovement` |
| `CashbookService` | `internal/service/others.go` | Dépenses (soft-delete) | `saveExpense`, `deleteExpense` |
| `ReportsService` | `internal/service/reports.go` | Z de caisse quotidien + rapport mensuel | `computeDailyZ`, `computeMonthlyReport` |

Les services ne dépendent **ni de `net/http` ni de pgx directement** : ils reçoivent des interfaces de stores fines (`OrderStore`, `PaymentStore`, `SettingsStore`, …) et un `TxRunner` (`dbtx.TxManager`). Les repos PostgreSQL (`internal/repository/postgres/ordersrepo.go`, `opsrepo.go`) les implémentent.

## 2. Tableau de parité ancien/nouveau

| Règle frontend (localDb.ts) | Portage Go | Statut |
|---|---|---|
| `computeLineExpressFee` : express % = round(qté × prix × pct/100) ; fixe = montant × qté **sauf kg** | `recalcLineExpressFee` | ✅ identique (testé) |
| Article catalogue : prix **imposé** côté serveur ; ID non-UUID (`cat-chemise`) et pseudo-IDs (`kg-*`, `bl-*`) | `isPseudoCatalog` + `priceFromCatalog` | ✅ identique — colonnes IDs passées en `TEXT` (décision D1) |
| Kilo mesuré : round(kg × tarif/mode) | cas `WeightKg` | ✅ identique |
| Offre poids : prix/poids/mode imposés par l'offre | cas `kg-*` → `findWeightOffer` | ✅ identique |
| Blanchisserie : pack (`pricingBasis` = pack ID) ou à l'unité ; prix imposés | `blanchPrice` | ✅ identique |
| `total = max(0, subtotal + express + delivery − (discount + loyaltyDiscount))` | étapes 2→4 | ✅ identique |
| Remise commerciale bornée au sous-total | `clamp64(0, subtotal+express+delivery)` | ✅ identique (correction C4) |
| `canRedeem = enabled && points ≥ threshold` ; `loyaltyDiscount = rewardDiscountFCFA` | étape 3, revalidée serveur | ✅ identique (correction C3) |
| Points gagnés = floor(total / fcfaPerPoint) | étape 5 | ✅ identique |
| `actualPrepaidUsed = min(solde, total, montant demandé)` si usePrepaid | étape 6 | ✅ identique — le solde est **relu en base** dans la tx (jamais cru) |
| Ticket `EP-{année}-{seq pad4}` | `TicketRepo.NextTicket` : `INSERT … ON CONFLICT DO UPDATE … RETURNING` (verrou de ligne) | ✅ identique + concurrency testé (12 goroutines → 12 tickets uniques) |
| Wallet : recharge / utilisation / bonus, historique complet | `ClientService.Topup` + `OrderService.Create` | ✅ identique (correction E1/E4 : **kind `prepaid_topup`** enregistré en caisse) |
| Livraison effectuée → commande `livre` + `deliveredAt` | `LogisticsRepo.UpdateStatus`, même transaction | ✅ (correction E2 : c'était séquentiel côté frontend) |
| Stock : sortie > dispo refusée ; ajustement = nouvelle valeur ; entrée maj coût | `InventoryService.Movement` + `FOR UPDATE` | ✅ (correction A16 formalisée) |
| `recordExpense` : dépense auto à l'entrée de stock | même transaction | ✅ identique |
| Dépenses : suppression douce | `expenses.deleted_at` | ✅ (correction A14 : aucune perte d'historique financier) |
| Annulation commande non destructive (`voidedAt`/`voidReason`, statut conservé) | `OrderService.Void` | ✅ identique |
| Z de caisse : CA par moyen/kind, dépenses, net | `ReportRepo.DailyZ` (SQL) | ✅ identique |
| Rapport mensuel par jour | `ReportRepo.Monthly` (SQL) | ✅ identique |

## 3. Règles corrigées (risques du audit)

| Risque | Correction |
|---|---|
| **C3** fidélité : discount appliqué sans vérification serveur | `RecalculateOrder` revalide seuil + activation ; `pointsRedeemed` plafonné au seuil |
| **C4** totaux crus du navigateur | Tout recalculé : prix, express, livraison, remises, prépayé, points. `PaidFCFA` clampé par `LEAST(total, …)` en SQL |
| **C5/E5** soldes prépayés crus | Solde relu dans la tx ; débit gardien `WHERE prepaid_balance_fcfa >= $1` ; wallet + points dans la même tx |
| **E1/E4** recharges absentes de la caisse | Paiement `kind='prepaid_topup'` systématique pour l'encaissement (le bonus ne crée pas d'encaissement) |
| **E2** livraison ≠ commande livrée | `UpdateStatus` (logistique) met à jour la commande dans la **même transaction** |
| **A14** suppressions destructives | Dépenses : soft-delete ; commandes : void ; inventaire : archivage (mouvements conservés) |
| **A15** surpaiement | `AddPayment` rejette au-delà du restant (`ErrOverpayment` → 400) ; acompte initial clampé à `CashDue` |
| **A16** stock négatif | Sortie > dispo → `ErrInsufficientStock` ; verrou `FOR UPDATE` sur l'article |
| **A21/C1** atomicité | Ticket + commande + items + paiement + prépayé + wallet + fidélité + idempotence : **une seule transaction** (`OrderService.Create`) |
| Idempotence | `Idempotency-Key` sur POST `/orders`, `/orders/{id}/payments`, `/clients/{id}/wallet/topups`, `/inventory/{id}/movements` → replay = `409 idempotent_replay` |
| Audit | Chaque mutation sensible journalisée (`audit_logs`) via `AuditLogger` |

## 4. Décisions

- **D1 — IDs TEXT pour les données métier.** Le frontend génère des IDs non UUID (`cat-chemise`, `ord-…`, `pay-…`, `wlt-…`). Les colonnes des tables métier sont passées en `TEXT` (migration 0001) ; les tables serveur (auth, sessions, devices, sync) restent en UUID. Conditionne la future sync push (Prompt 09).
- **D2 — Mapping = aperçu, commande = vérité.** `POST /orders/mapping` recalcule avec les données réelles (client chargé) mais `POST /orders` reste l'autorité unique.
- **D3 — Acompte initial (`initialCashPaidFCFA`).** Parité « montant payé au dépôt » : clampé à [0, cashDue] ; le restant se règle via `POST /orders/{id}/payments`.
- **D4 — Transitions linéaires uniquement.** `PATCH /orders/{id}/status` n'accepte que la transition suivante (cible explicite ou implicite) ; toute régression → 400. `livre` est terminal (la livraison logistique est le seul autre chemin vers `livre`).
- **D5 — `PaidFCFA` jamais cru** : recalculé par `LEAST(total_fcfa, paid + delta)` en SQL à chaque paiement.
- **D6 — Rejets explicites** (jamais de troncature silencieuse) : surpaiement, stock insuffisant, zone/pack/offre inconnus, moyen de règlement invalide, quantité ≤ 0.
- **D7 — Seeds** : `0002_seed.sql` idempotent (`ON CONFLICT DO NOTHING`), utile à l'installation vierge et pour le compteur d'année ; aucune donnée métier seedée au-delà.

## 5. Tests

**Unitaires (sans DB) — `internal/service/pricing_test.go` (14)** : pièce (prix imposé), catalogue inconnu/inactif, kilo mesuré (1,75 × 1500 = 2625), offres poids (imposition + inactif), blanchisserie (pack/unité/inconnu), express % (2×1000×50 %) et fixe (multiplicateur qté, exception kg), zone (absente/inactive), fidélité (éligible/non/désactivée), remise bornée, prépayé (clamp total/solde/demandé/client nil), acompte partiel + clamp, validations (qté ≤ 0, moyen invalide), overflow, arrondi.

**Intégration PostgreSQL — `internal/service/orders_integration_test.go` + `internal/repository/postgres/orders_integration_test.go`** :
- Flux complet : topup → commande (prépayé, points, wallet, ticket EP-2026-0001) → transitions → régression refusée → livraison → surpaiement refusée → annulation ;
- **Concurrence** : 12 créations parallèles → 12 tickets uniques ;
- Recharge + bonus (solde 12000, historique complet, payment `prepaid_topup`) ;
- Inventaire : entrée (maj coût, dépense auto 900), sortie excessive refusée, ajustement, mouvements immuables, idempotence ;
- Repos : roundtrips settings/catalogue/clients/zones, wallet gardien, idempotence, soft-delete dépense, logistique → commande `livre`, rapports Z/mensuel.

**Smoke live HTTP** (serveur :8080 sur PostgreSQL réel) : setup/login → settings → catalogue → zone → client → recharge → mapping → création (prépayé total) → replay 409 → transitions → régression 400 → livraison → surpaiement 400 → acompte partiel (total 30000, prépayé 16500, cash 5000, solde 8500 encaissé) → 404 client inconnu → Z de caisse cohérent (CA = cash + topup, prépayé consommé non compté) → void.

## 6. Bugs réels découverts et corrigés par les tests

1. `ClientRepo.ApplyWalletDelta` ignorait `prepaidDelta` → recharge sans crédit de solde.
2. `dbtx.WithTx` ne libérait pas la connexion sur `Goexit` (panique de test) → `puddle.Close` infini. Rollback systématique si pas commité.
3. Paiement initial inséré **avant** la commande → violation FK ; réordonnancement (commande → paiements → wallet → paid).
4. `RecalculateOrder` exigeait un ID catalogue UUID (36 car.) → `cat-chemise` rejeté ; prix à 0.
5. `ApplyWalletDelta` sans gardien de débit prépayé — remplacé par `DebitPrepaid` gardien + delta non négatif.
6. Handler `createOrder` ne transmettait pas `clientId` → commandes anonymes en live.
7. `AuthRepo.Get` sur ligne absente → `ErrNoRows` (500 au lieu d'état vierge).

## 7. Limites connues / reporté

- `reports` ne couvre pas encore l'export Excel/PDF (phase UI/API ultérieure).
- `bootstrap` agrégé et routes `sync` : Prompt 06/09.
- La validation « schema v3 » du backup import appartient au Prompt 08 (importer).
- Les photos de réclamation sont stockées `bytea` (route `GET /orders/{id}/photos/{pid}`) ; l'upload base64 reste à la phase 06 (limite body 10 Mo).
