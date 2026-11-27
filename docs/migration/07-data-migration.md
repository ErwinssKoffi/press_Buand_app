# Prompt 07 — Migration des données (IndexedDB → PostgreSQL) & sauvegardes

> Statut : **livré** (backend Go). Endpoints réels : `GET /api/v1/backup/export`,
> `POST /api/v1/backup/preview`, `POST /api/v1/backup/restore` (le 501 de la phase 06
> est remplacé). La table `backup_imports` (migration `0003_backup_imports.sql`) journalise
> les imports. La synchronisation offline (`/sync/*`) reste 501 jusqu'au Prompt 09.

## 1. Ce que fait le backend

| Endpoint | Comportement |
|---|---|
| `POST /api/v1/backup/preview` | Valide **strictement** un backup legacy v3 **sans aucune écriture** : version, champs obligatoires, énumérations (statuts, modes, méthodes, types), montants entiers ≥ 0, dates, IDs uniques à l'intérieur du backup (doublon → refus), photos data URL (MIME jpeg/png/webp, ≤ 5 Mo décodés). Retourne un **rapport de migration** complet : lignes source, doublons, anomalies (relations cassées tolérées), incompatibilités, photos, PIN. |
| `POST /api/v1/backup/restore` | **Restauration atomique** (une transaction SQL) : purge des tables métier, insertion avec **IDs historiques préservés**, photos décodées → stockage privé + `order_claim_photos`, PIN legacy → `auth_credentials` (état « legacy », upgrade Argon2id au premier login — mécanisme Prompt 04), compteur de tickets recalculé, **hash SHA-256 enregistré** → re-import du même backup = rapport « déjà appliqué » (sauf `X-Backup-Force: true`). Requiert `X-Backup-Confirm: true`. |
| `GET /api/v1/backup/export` | Export JSON compatible `DatabaseBackup` v3 (**jamais de secret** : `pin_hash`/`pin_salt` exclus). |

Règles de sécurité respectées :
- **Aucune écriture sans preview + confirmation** (`X-Backup-Confirm: true`, deux étapes) ;
- **Jamais de suppression automatique d'IndexedDB** côté backend (le frontend reste maître de sa base locale) ;
- Sauvegarde serveur **pré-restauration** écrite dans `<ECLAT_STORAGE_DIR>/backups/pre-restore-<timestamp>.json` ;
- Échec au milieu de l'import = **rollback complet** (rien n'est écrit, fichiers photos orphelins purgés, rapport d'échec détaillé) ;
- Relations cassées (client/article/commande absents du backup) : **tolérées et signalées** au preview, référence nullifiée à l'import (jamais bloquantes — le frontend IndexedDB n'avait pas de FK) ;
- Paiements synthétiques `prepaid-<clientId>` : importés avec `kind='prepaid_topup'` (exclus des statistiques commandes ; `walletHistory` du client fait foi) ;
- `nextTicketSequence` → `shop_settings` + `ticket_counters` recalculés (max `EP-<année>-<seq>`) ;
- **Aucun secret dans les rapports** (le PIN n'apparaît jamais, seul un booléen `pinLegacyImported`).

## 2. Procédure pas à pas (utilisateur / support)

1. **Ouvrir l'ancienne application** (frontend IndexedDB) → *Paramètres → Sauvegarder*
   (export JSON v3). Le fichier `eclat-backup-....json` contient tout : réglages, clients,
   catalogue, commandes, paiements, dépenses, zones, logistique, stocks, photos.
2. **Se connecter au nouveau backend** (`POST /auth/setup` puis `/auth/login`, ou migration
   du PIN à l'étape 6).
3. **Toujours commencer par un preview** (aucun risque, aucune écriture) :
   ```bash
   curl -b cookies.txt -X POST https://…/api/v1/backup/preview \
     -H 'Content-Type: application/json' \
     --data-binary @eclat-backup-2026-01-15.json
   ```
   Lire le rapport : `source` (compteages), `duplicates` (doit être vide — sinon corriger
   le JSON ou refaire l'export), `anomalies` (relations cassées : listées, non bloquantes),
   `incompatibilities` (données réelles déjà présentes → elles seront remplacées).
4. **Décider** : si `incompatibilities` n'est pas vide, exporter d'abord les données
   serveur actuelles (`GET /api/v1/backup/export` → fichier de secours) avant de continuer.
5. **Confirmer la restauration** :
   ```bash
   curl -b cookies.txt -X POST https://…/api/v1/backup/restore \
     -H 'Content-Type: application/json' -H 'X-Backup-Confirm: true' \
     --data-binary @eclat-backup-2026-01-15.json
   ```
   Réponse 200 : `status: "restauré"`, `created{...}`, `photosImported`, `serverBackup`
   (chemin du fichier de sauvegarde préalable). Re-import du **même** fichier : 200
   `status: "déjà appliqué"` sans réécriture (idempotent, hash SHA-256).
6. **Première connexion** : si le backup contenait un PIN (`pinHash`/`pinSalt`), l'ancien
   PIN fonctionne **une seule fois** ; le backend le re-hash immédiatement en Argon2id
   (état « legacy » → « argon2id », `details.legacyUpgraded=true` dans l'audit).
7. **Vérifier** : `GET /api/v1/orders?page=1&pageSize=20` (tickets historiques), facture Z
   du jour, `GET /api/v1/clients?q=` (soldes prépayés), photos (`order_claim_photos`).
   Le frontend peut ensuite être **purgé manuellement** par l'utilisateur (jamais
   automatiquement par le backend).

## 3. Rapport de migration (contrat)

```json
{
  "hash": "ca09…", "status": "restauré", "exportedAt": "2026-01-15T10:00:00Z",
  "source": {"clients": 1, "orders": 1, "payments": 2, "photos": 1, "…": 0},
  "created": {"settings": 1, "catalog": 1, "clients": 1, "walletEntries": 2, "orders": 1,
               "orderItems": 1, "payments": 2, "expenses": 1, "zones": 1, "logistics": 1,
               "inventory": 1, "inventoryMovements": 1},
  "updated": {}, "ignored": {},
  "duplicates": [], "anomalies": [], "incompatibilities": [],
  "photosImported": 1, "photosSkipped": 0, "pinLegacyImported": true,
  "serverBackup": "/var/lib/eclat/backups/pre-restore-20261127T101500.json",
  "errors": [], "startedAt": "…", "finishedAt": "…"
}
```

## 4. Erreurs

| Cas | Réponse |
|---|---|
| JSON mal formé, `version≠3`, champ obligatoire manquant, énumération invalide, montant non entier, photo MIME/taile invalide | `422 business_rule` (message précis : champ + index) |
| IDs dupliqués **à l'intérieur** du backup | `422 business_rule` (`duplicates`) — jamais d'écrasement arbitraire |
| Restore sans `X-Backup-Confirm: true` | `400 invalid_request` (message d'aide deux étapes) |
| Corps > 64 Mo | `400 invalid_request` |
| Échec SQL au milieu de l'import | 200 `status:"échec"` + `errors[]` — base **inchangée** (rollback), photos purgées |

## 5. Tests livrés (Prompt 07 §13 — 10 cas)

`backend/internal/backup/backup_integration_test.go` (PG réel) + suite HTTP
`api_integration_test.go` :

1. **Setup vierge + import complet** → `TestBackupV3LifecycleIntegration` (preview →
   restore → vérifications SQL : settings, total/paid/statut/date livrée, solde prépayé,
   wallet 2 entrées, `kind='prepaid_topup'`, fichier photo, `ticket_counters`) ;
   version HTTP : restore après création de données réelles (champ `Version` v3).
2. **Re-import du même backup** → rapport conservé (`FindImport`), ré-exécution sans
   doublons (REPLACE idempotent).
3. **Sauvegarde serveur préalable** → fichier présent (`os.Stat`), export sans secrets.
4. **PIN legacy** → `auth_credentials(algo='none', legacy_hash, legacy_salt)` ; login
   upgrade Argon2id déjà testé (Prompt 04).
5. **Photos** → data URL 1×1 décodée, fichier privé + métadonnées ; MIME interdit
   (`application/zip`) → 422 ; photo > 5 Mo → 422.
6. **Relations cassées** → anomalies listées au preview, restore OK, `client_id` nullifié,
   `client_name` conservé.
7. **Paiements synthétiques** `prepaid-cl-1` → `kind='prepaid_topup'` (hors stats commandes).
8. **Propriétés facultatives absentes** (zones, logistique, stocks, walletHistory,
   photos, soldes) → restore OK, valeurs par défaut neutres (0).
9. **Compteur tickets** → `ticket_counters(2025, 4)` depuis `EP-2025-0004` ;
   `next_ticket_sequence` recalé au-dessus du max.
10. **Refus propres** : version 2 → 422 ; statut/mode/méthode inconnus → 422 ;
    montant `7500.5` → 422 ; doublon d'ID → 422 ; JSON tronqué → 422.

## 6. Limites connues

- L'export serveur v3 inclut des extra serveur (statuts internes, `storage_path` des
  photos au lieu des data URLs) : il est destiné à la transition frontend, pas à un
  re-import tel quel (les data URLs seraient refusées — comportement assumé : un export
  serveur n'est pas un backup IndexedDB).
- La restauration est réservée aux rôles authentifiés (session requise, comme toutes les
  routes `/api/v1`) ; l'authentification est vérifiée par le middleware existant.
