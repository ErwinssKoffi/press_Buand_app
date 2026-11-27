# Prompt 09 — Mode hors ligne, outbox et synchronisation fiable

> Statut : **livré** (backend Go + frontend React). Les 501 de `/sync/*` sont
> remplacés par l'implémentation réelle. Aucune règle métier dupliquée : le push
> réutilise `OrderService`, `ClientService`, `CashbookService`,
> `InventoryService`, `LogisticsService` — les montants ne sont JAMAIS acceptés
> sans recalcul serveur.

## 1. Backend Go (`internal/service/sync.go` + routes `/api/v1/sync/*`)

| Endpoint | Comportement |
|---|---|
| `POST /sync/push` | Lot `{deviceId, operations[]}` (≤ 200). Chaque opération : verdict stable `accepted \| duplicate \| conflict \| rejected` + `entity` (objet serveur), `errorCode`, `message`, `officialTicket`. **Dédouicatement persistant** : table `sync_operations` (UNIQUE(device_id, operation_id), migration 0001) — un timeout suivi d'un retry renvoie `duplicate` sans aucun doublon. Les verdicts conflict/rejected sont aussi journalisés (verdict stable au retry ; un conflit `pricing_changed` est rejouable avec `acceptPricing:true`). |
| `GET /sync/pull?sinceRevision=&limit=&deviceId=` | Changements incrémentaux par `revision` (séquence `change_seq`), fusion 10 entités triées par révision, pagination stricte (`hasMore`, `cursor`), **jamais de snapshot complet**. camelCase aligné sur les DTO ; walletHistory/items/claimPhotos imbriqués. Met à jour `devices.last_pull_revision`. |
| `GET /sync/status?deviceId=` | `{serverTime, cursor, device:{lastPullRevision, lastSeenAt}}`. |

Types d'opérations **autorisés hors ligne** (cohérence assurée par le serveur) :
`client.create` (fusion idempotente par téléphone : si le client existe déjà →
`duplicate` + entité existante, jamais de doublon), `order.create` (recalcul
serveur + ticket officiel en transaction ; photos exclues : connexion requise),
`order.payment` (idempotence + surpaiement rejeté), `expense.create`,
`inventory.movement` (validations stock identiques), `logistics.save`.
Tout autre type → `rejected unsupported_type` (connexion exigée : settings,
catalogue, changements de statut, void, import/export, PIN).

**Conflit de tarif (Prompt 09 backend §8)** : le payload embarque les prix vus
hors ligne (`items[].unitPriceFCFA`, `seenTotalFCFA`) ; si le recalcul serveur
diffère → `conflict pricing_changed` + proposition recalculée dans `entity`.
Résolution : l'opérateur confirme → retry avec `acceptPricing:true` → application
aux tarifs actuels. Jamais de recalcul silencieux.

**Références provisoires** : le client hors ligne garde son UUID comme ID réel
(`client.create` conserve `payload.id`) ; la commande reçoit un ID serveur et le
mappage provisoire→officiel est dans le journal (`result.entity.order.id`) —
un paiement ultérieur référençant l'ID provisoire est automatiquement résolu
(`resolveRef`). Ticket officiel attribué côté serveur dans la transaction
(`NextTicket`) — deux appareils simultanés → tickets uniques (test 5).

Métriques : `slog.Info("sync push", device, ops, accepted/duplicate/conflict/rejected, duration)` —
aucune donnée personnelle.

## 2. Frontend (`src/services/offline/*`, IndexedDB v4)

- **Stores v4** : `outbox` (index by-status, by-localCreatedAt), `conflicts`,
  `syncMeta` (deviceId, cursor, lastSyncAt), `reconciliations`.
- **`deviceId` stable** par installation (syncMeta ; UUID). `operationId` UUID
  distinct par opération ; pour les commandes l'ID provisoire **est** l'operationId
  → réconciliation sûre.
- **`OutboxOperation`** : type/version du type, payload, date locale,
  `dependsOn` + `provisionalRefs`, statut (`pending|sending|conflict|failed`),
  `attempts`, `lastError`. Persistée **avant** toute tentative ; une `pending`
  n'est jamais supprimée avant confirmation serveur ; `sending` (interruption du
  navigateur) redevient `pending` au démarrage (retry sûr par operationId).
- **Ordre des dépendances** : tri topologique avant envoi — client.create avant
  order.create qui référence son UUID, order.create avant order.payment
  (`provisionalRefs.orderId`), réécriture des refs des opérations en attente
  après réconciliation.
- **`syncManager`** : déclencheurs démarrage / événement `online` / focus /
  bouton manuel — pas de timer permanent, single-flight. `syncNow()` = flush
  (push 1-opération-par-lot, file re-lue à chaque itération) puis pull incrémental
  paginé (≤ 20 pages) puis `lastSyncAt`.
- **Brouillons visibles** : commande hors ligne → ticket **`LOCAL-YYMMDD-XXXX`**
  (préfixe distinct de `EP-`), écritue dans le cache IndexedDB (survit au
  rechargement) + paiement local indicatif ; à la sync, la commande officielle
  remplace le brouillon et la référence officielle est réconciliée.
- **Indicateurs** : bannière offline (lecture seule + dernière synchro), compteur
  d'opérations en attente, bouton « Synchroniser », panneau « Résoudre » pour les
  conflits (pricing_changed → « Accepter les nouveaux tarifs » ; sinon relance ou
  abandon explicite — le payload original n'est jamais détruit silencieusement).
- **Hors ligne autorisé** : client, dépôt, paiement complémentaire, dépense,
  mouvement de stock, tâche logistique. **Exige Internet** : settings, catalogue,
  changements de statut, void, import/export de sauvegarde, PIN, photos (data URL
  envoyée à la création seulement), reports.

```
État d'une opération (diagramme) :

  enqueue ──► pending ──► sending ──► 200 accepted/duplicate ──► (supprimée + réconciliation)
                 ▲            │
                 │            ├──► 200 conflict ──► conflict ──(reprise manuelle)──► pending
                 │            │                                         └──► abandon explicite
                 │            └──► 200 rejected ──► failed (payload conservé)
                 └────────────┴─── erreur réseau ◄─ retry au retour online/démarrage/manuel

  PULL (serveur → terminal) : cursor syncMeta ──► GET /sync/pull ──► applyServerChanges (upsert)
        ──► saveSyncCursor ──► lastSyncAt ; pagination via hasMore.
```

## 3. Tests

**Backend** (`internal/service/sync_integration_test.go`, PostgreSQL réel) — 7 suites :
1. client offline puis commande qui le référence (ticket `EP-2026-0001`, ID client conservé) ;
2. timeout après écriture puis retry → `duplicate`, `orders=1` ;
3. double paiement → 1 seul encaissement ; surpaiement → `rejected overpayment` stable au retry ;
4. deux appareils simultanés → tickets officiels distincts ;
5. tarif modifié pendant l'offline → `conflict pricing_changed` + recalcul exposé ; `acceptPricing` → accepted aux nouveaux tarifs ;
6. fusion client par téléphone (aucun doublon) + pull incrémental sans chevauchement/écrasement ;
7. appareil longtemps hors ligne (dépense + stock), mouvement rejoué → `duplicate`, stock exact ; type interdit → `rejected unsupported_type` ; `sync/status` avec appareil.

**Frontend** (`tests/outbox.test.ts`, fake-indexeddb) — 9 suites : deviceId stable ;
création offline → sync → réconciliation ticket officiel ; ordre des dépendances ;
timeout puis retry sans perte ; paiement référencé réécrit vers l'ID officiel ;
conflit pricing_changed avec reprise manuelle `acceptPricing` ; enregistrement
corrompu isolé sans bloquer la file ; `sending` interrompu → `pending` au
démarrage ; curseur/horodatage persistés.

**Smoke live** (backend :8080 via proxy :3000) : push client+commande, conflit
tarif réel (seenTotal≠recalcul → `pricing_changed`), reprise `acceptPricing` →
`accepted EP-2026-0001`, push cohérent → `EP-2026-0002`, paiement sur référence
provisoire résolue (500/2000 FCFA), retry → `duplicate`, aucun doublon SQL.

## 4. Limites connues

- Les photos de réserves ne peuvent pas être prises hors ligne (payload volumineux
  + validation MIME/taille serveur) : la capture photo exige la connexion.
- Les changements de statut d'atelier restent en ligne (Prompt 09 autorise ce
  périmètre : cohérence des transitions serveur prioritaire).
- Le pull est en upsert only : les archives soft-delete passent par les champs
  `archived`/`voided*` (aucune suppression destructive).
- Un conflit de type `rejected` (ex. dépendance définitivement introuvable)
  nécessite une intervention : relance ou abandon explicite dans le panneau conflits.
