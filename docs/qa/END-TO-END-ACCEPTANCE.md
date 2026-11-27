# Acceptance de bout en bout — Éclat Pressing

Chaque parcours du cahier des charges (Prompt 10) est tracé avec sa **preuve
d'exécution**. Types de preuves utilisées :

- **INT** : tests d'intégration Go contre PostgreSQL réel (`go test ./...`,
  fixtures tronquées par test — services + handlers HTTP dans la boucle) ;
- **UNIT** : tests unitaires (Go `pricing/auth` ; bun `outbox/sync` fake-indexeddb) ;
- **LIVE** : smoke exécuté contre le serveur réel démarré (backend `:8080` via le
  proxy Vite `:3000`, mêmes routes que la production) ;
- **UI** : parcours à cocher manuellement dans le navigateur (pas d'automatisation
  navigateur disponible dans l'environnement d'audit — voir §2).

## 1. Matrice des 15 parcours

| # | Parcours | Preuve | État |
|---|---|---|---|
| 1 | Installation vierge, setup propriétaire/opérateur, connexion | INT `TestAPIFullStackIntegration` (setup→login→bootstrap) ; LIVE login 200, mauvais PIN 401, secret double → 409 | **PASS** |
| 2 | Onboarding établissement / activité (pressing, blanchisserie, les deux) | INT settings Update/GET ; LIVE PUT+GET `/settings` 200 ; UI SettingsView (checklist §2) | **PASS** (API+UI) |
| 3 | Catalogue : pièces, kilo, express, packs, fidélité | INT catalogue CRUD (création/édition/archivage) ; UNIT `pricing_test` (kilo, express, packs, remise, fidélité) ; LIVE rejet article inactif en sync | **PASS** |
| 4 | Création client + modification | INT clients CRUD ; LIVE sync client (UUID conservé) ; fusion par téléphone INT sync test 6 | **PASS** |
| 5 | Dépôt complet : client, articles, photos, casier, dates, remise, livraison | INT commande avec photos (matérialisation storage + URL publique) ; LIVE `order.create` sync → `EP-2026-0001` | **PASS** |
| 6 | Calcul du total + création ticket | UNIT `pricing_test` ; LIVE conflit `pricing_changed` = preuve du recalcul serveur ; ticket `EP-YYYY-NNNN` en tx serveur (INT 2 appareils → tickets distincts) | **PASS** |
| 7 | Paiement intégral/acompte/complément ; espèces/Wave/Orange Money/MTN/Moov | INT paiements (méthodes `especes, wave, orange_money, mtn_momo, moov_money`) ; INT double paiement → 1 seul encaissement ; LIVE acompte 500/2000 via sync | **PASS** |
| 8 | Recharge prépayée, bonus, utilisation | INT wallet topups (bonus) + consommation `usePrepaid` sur commande ; LIVE smoke phase 08 (topup 200) | **PASS** |
| 9 | Cycle statut reçu→lavage→repassage→prêt→livré | INT transitions PATCH status (+ void qui préserve le statut) | **PASS** |
| 10 | Livraison terminée → commande mise à jour | INT logistique : tâche livrée → statut/mise à jour commande | **PASS** |
| 11 | Dépenses, rapport journalier Z, rapport mensuel | INT `/reports/daily-z` + `/reports/monthly` (totaux recalculés serveur) ; dépense → mouvement stock automatique | **PASS** |
| 12 | Inventaire : entrée/sortie/ajustement, seuil, historique, dépense auto | INT movements (validation seuil, dépense qty × coût unitaire) ; LIVE re-passe movement → `duplicate` (stock exact) | **PASS** |
| 13 | Sauvegarde export / prévisualisation / restauration | INT package backup ; LIVE export/preview/restore 200 avec `X-Backup-Confirm` ; **pg_dump→pg_restore vérifié sur base de contrôle** (nombres de lignes identiques) | **PASS** |
| 14 | Migration backup legacy v3 | INT import v3 (mapping, PIN, onboarding) ; LIVE restore legacy 200 ; voir `DATA-MIGRATION.md` | **PASS** |
| 15 | Offline : fermeture navigateur, reconnexion, synchro, doublons, conflits | UNIT 18/18 tests outbox ; INT 7/7 sync PG ; LIVE push/conflit/reprise/réessai ; **E2E navigateur automatisé 2/2** (`bun run test:e2e` : client créé hors ligne → sync → preuve serveur ; reload navigateur → outbox persisté → sync sans doublon) | **PASS** |

## 2. Checklist navigateur manuelle (à exécuter par l'opérateur, ~20 min)

Le parcours offline→sync est désormais **automatisé** (E2E Chromium via
`@sparticuz/chromium`, voir §3). La checklist ci-dessous couvre ce que
l'automatisation ne peut pas vérifier : rendu visuel, PWA installée, impression.

- [ ] PWA installable (bouton d'installation du navigateur), icône + splash corrects
- [ ] Rechargement avec réseau coupé → l'app s'ouvre depuis le service worker, bandeau « hors ligne » visible, lecture du cache
- [ ] Dépôt hors ligne → ticket `LOCAL-YYMMDD-XXXX` clairement distinct, compteur d'opérations en attente
- [ ] Retour du réseau → synchro automatique (ou bouton « Synchroniser »), ticket devient `EP-YYYY-NNNN`, aucune ligne dupliquée
- [ ] Modification d'un tarif serveur pendant l'offline d'un autre poste → dépôt rejoué → panneau « Résoudre » (accepter nouveaux tarifs ou abandonner)
- [ ] Impression ticket PDF (jspdf) : en-tête, totaux, mention de paiement
- [ ] Photos de réserve : capture/upload → miniature puis photo persistante après refresh

## 3. Commandes de rejeu

```bash
# Backend (PostgreSQL de test requis pour les INT)
cd backend && ECLAT_TEST_DATABASE_URL="postgres://eclat@127.0.0.1:5432/eclat_test" go test ./... -count=1

# Frontend
bun run lint && bun run build && bun test tests/

# Smoke live (serveur démarré) — voir journal d'audit docs/migration/10-final-audit.md
curl -fsS http://127.0.0.1:3000/api/v1/sync/status?deviceId=audit   # après login

# E2E navigateur automatisé (Chromium téléchargé du registre npm)
bun run test:e2e    # E2E_BASE_URL=http://127.0.0.1:3000 par défaut
```
