# Sauvegarde et restauration — Éclat Pressing

Deux niveaux de sauvegarde complémentaires, à ne pas confondre :

| | **Backup PostgreSQL** (`pg_dump`) | **Export applicatif JSON** (`/api/v1/backup/export`) |
|---|---|---|
| Contenu | base entière : schéma + données + sessions + journal sync | données métier (clients, commandes, paiements, wallet, catalogue, stock, logistique, dépenses, settings), format versionné (v3 legacy compatible) |
| Restitution | exacte (PITR du moment du dump) | via `/api/v1/backup/restore` — **recrée** les entités, prévisualisation + confirmation obligatoires |
| Usage | sécurité quotidienne, avant chaque déploiement | portabilité entre installations/versions, import legacy v3, copie de contrôle lisible |
| Outil | `pg_dump` / `pg_restore` (cron) | UI (Settings) ou API avec session authentifiée |

## 1. Sauvegarde applicative JSON (API)

```bash
# Session authentifiée requise (cookie) — export JSON versionné
curl -b cookies.txt http://127.0.0.1:8080/api/v1/backup/export -o eclat-export-$(date +%F).json

# Prévisualisation d'un fichier avant restauration (aucune écriture)
curl -b cookies.txt -H 'Content-Type: application/json' \
     -d @eclat-export.json http://127.0.0.1:8080/api/v1/backup/preview

# Restauration — exige l'en-tête de confirmation
curl -b cookies.txt -H 'Content-Type: application/json' -H 'X-Backup-Confirm: eclat-restore' \
     -d @eclat-export.json http://127.0.0.1:8080/api/v1/backup/restore
```

La restauration est **transactionnelle** : fichier invalide → rien n'est écrit
(422, diagnostic par entité). L'export est aussi disponible depuis l'UI
(Settings → Sauvegarde), qui ajoute prévisualisation + confirmation explicite
avant toute écriture.

## 2. Sauvegarde PostgreSQL (cron conseillé)

```bash
# quotidien 02:00 + rétention 7j/4sem/12mois ( exemple systemd timer ou cron)
0 2 * * * docker compose -f /srv/eclat/docker-compose.yml exec -T db \
  pg_dump -U eclat eclat | gzip > /srv/backups/eclat-$(date +\%F).sql.gz

# photos (volume storage) — même fréquence
tar czf /srv/backups/eclat-storage-$(date +\%F).tar.gz /var/lib/docker/volumes/eclat_storage/_data
```

Fréquence conseillée : `pg_dump` **quotidien** + dump manuel **avant chaque
déploiement** ; export JSON hebdomadaire (contrôle croisé) ; rétention
7 quotidiens + 4 hebdomadaires + 12 mensuels, au moins une copie hors site.

> Les photos vivent dans le volume `storage`, **pas** dans la base : restaurer
> la base sans restaurer le volume laisse des photos 404. Toujours restaurer
> les deux ensembles (base + storage) de la même date.

## 3. Restauration PostgreSQL testée (procédure de référence)

```bash
# 1. Arrêter l'API (arrêt gracieux, pas de session en écriture)
docker compose stop api

# 2. Base propre
docker compose exec db psql -U eclat -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# 3. Restaurer
gunzip -c /srv/backups/eclat-2026-11-27.sql.gz | \
  docker compose exec -T db psql -U eclat -d eclat

# 4. Redémarrer et vérifier
docker compose start api
curl -fsS http://127.0.0.1:8080/healthz && curl -fsS http://127.0.0.1:8080/readyz
# puis connexion UI : tickets, clients, totaux quotidiens conformes au dump
```

**Cette procédure a été exécutée et vérifiée** (dump/pg_restore sur base de
contrôle séparée `eclat_restore_check` : nombres de lignes identiques sur
clients, orders, payments, expenses, catalog_items, devices, sync_operations —
voir journal d'audit `docs/migration/10-final-audit.md` ; import JSON v3 testé
par ailleurs via `docs/migration/07-legacy-backup.md`).

## 4. Restauration applicative (export JSON)

Utiliser `/api/v1/backup/restore` sur une base **vierge** (post-migrations) :
la prévisualisation affiche le nombre d'entités par type ; la confirmation
(`X-Backup-Confirm`) est obligatoire ; les IDs du fichier sont conservés
(déduplication idempotente si re-restauration d'un même export).

Différence clé vs pg_dump : la restauration JSON repasse par les services métier
(règles appliquées : recalcul des totaux, tickets réattribués si conflits) —
c'est un import de données, pas une copie binaire du passé.
