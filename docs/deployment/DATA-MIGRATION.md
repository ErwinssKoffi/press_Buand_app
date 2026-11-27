# Migration des données legacy (backup v3 → Éclat Pressing Go)

Public : installations existantes de l'ancienne application (export JSON v3)
qui migrent vers le backend Go. Détails techniques complets : `docs/migration/07-legacy-backup.md`.

## Procédure

1. **Préparer la cible** : déployer le backend (migrations initialisées, voir
   `PRODUCTION.md`), créer le PIN propriétaire (`/auth/setup`), se connecter.
2. **Prévisualiser** : Settings → Sauvegarde → importer le fichier legacy
   (ou `POST /api/v1/backup/preview`). Le serveur valide la version du format
   et liste le contenu par entité **sans rien écrire**.
3. **Restaurer** : confirmer explicitement dans l'UI (case de confirmation) ou
   via API avec l'en-tête `X-Backup-Confirm` (`POST /api/v1/backup/restore`).
   La restauration est transactionnelle : erreur → rien n'est écrit.
4. **Vérifier** : tickets et totaux de la journée, clients, wallet, stock ;
   export JSON de contrôle (`GET /api/v1/backup/export`) conservé hors site.
5. **Photos legacy** : si le backup v3 embarque des photos (base64), elles sont
   matérialisées dans `ECLAT_STORAGE_DIR/photos/<commande>/` (phase 07) et
   servies par `/api/v1/orders/{id}/photos/{photoId}`.

## Compatibilité des anciens utilisateurs

- **PIN de connexion** : le PIN propriétaire du backup legacy reste valable
  après restauration (constaté en test : hash legacy reconnu puis ré-haché en
  argon2id au premier login). En cas de perte, réinitialisation manuelle en
  base — l'API refuse volontairement un second `/auth/setup` sur une base
  déjà initialisée.
- **Données navigateur** : l'ancien IndexedDB du navigateur n'est **pas**
  supprimé automatiquement ; après migration, les données officielles viennent
  du serveur (pull) et le cache local est reconstruit — jamais d'écrasement
  destructif du snapshot local sans confirmation.
- **Tickets** : les numéros legacy sont conservés ; les nouveaux dépôts
  reçoivent un ticket officiel `EP-YYYY-NNNN` attribué côté serveur.
- **Reprise hors ligne** : un appareil qui avait des opérations pending pendant
  la migration les enverra au retour de la connexion avec dédoublonnement
  `deviceId+operationId` (phase 09) — pas de double encaissement.

## Rôle de chaque sauvegarde après migration

- le **dump PostgreSQL** du jour J (avant restauration) reste le point de retour
  arrière ; 
- l'**export v3 original** est conservé tel quel (source historique) ;
- un **export JSON post-migration** sert de contrôle de cohérence.
