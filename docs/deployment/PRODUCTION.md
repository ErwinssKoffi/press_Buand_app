# Mise en production — Éclat Pressing

> Prérequis : Docker 24+ (ou Go 1.27 + PostgreSQL 16 pour un lancement sans
> Docker), un reverse proxy HTTPS pour un usage réseau/distant, et une base
> PostgreSQL dédiée avec sauvegardes (voir `BACKUP-RESTORE.md`).

## 1. Variables d'environnement backend

Source de vérité : `backend/.env.example`. Aucune valeur secrète dans le dépôt.

| Variable | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `ECLAT_DATABASE_URL` | oui | — | DSN PostgreSQL (`postgres://eclat:…@db:5432/eclat?sslmode=disable`) |
| `ECLAT_ENV` | oui en prod | `development` | `production` force le cookie `Secure` et refuse les PIN faibles (5 chiffres identiques, séquences) |
| `ECLAT_HTTP_ADDR` | non | `:8080` | Adresse d'écoute HTTP |
| `ECLAT_BASE_URL` | conseillé | vide | URL publique (liens, callbacks) |
| `ECLAT_STORAGE_DIR` | oui | — | Dossier **privé** des photos de réserve (volume dédié, permissions `eclat` uniquement) |
| `ECLAT_MIGRATIONS_DIR` | conteneur | vide | `/app/migrations` (déjà positionné dans l'image) |
| `ECLAT_AUTO_MIGRATE` | non | `true` | Applique les migrations au démarrage (idempotent, forward-only) |
| `ECLAT_CORS_ORIGINS` | oui en prod | vide | Origines autorisées séparées par des virgules — **vide = CORS fermé** ; ne pas mettre `*` |
| `ECLAT_COOKIE_DOMAIN` | non | vide | Domaine du cookie de session (usage derrière sous-domaine dédié) |
| `ECLAT_SESSION_TTL` | non | `168h` | Durée de session (7 jours par défaut) |
| `ECLAT_LOGIN_MAX_ATTEMPTS` | non | `5` | Échecs avant lockout persistant |
| `ECLAT_LOGIN_LOCKOUT` | non | `5m` | Durée du lockout |
| `ECLAT_BODY_LIMIT` | non | `10485760` | Limite du corps (10 Mo — couvre les photos base64) |
| `ECLAT_SHUTDOWN_GRACE` | non | `15s` | Délai d'arrêt gracieux |

## 2. Ports, volumes, ordre de démarrage

- Ports : API `8080` (backend), PostgreSQL `5432` (interne ; **ne pas exposer
  `5432` publiquement** — retirer le mapping `ports:` de `db` en production).
- Volumes Docker : `pgdata` (données PostgreSQL), `storage` (`/var/lib/eclat/storage`,
  photos — sauvegarder ce volume en même temps que la base, voir §6).
- Ordre : `db` démarre d'abord (healthcheck `pg_isready`), `api` attend
  `condition: service_healthy`, applique les migrations puis écoute.
  `docker compose up -d db api` respecte cet ordre automatiquement.

## 3. Frontend

`bun run build` produit `dist/` (assets + service worker PWA). Deux modes :

1. **Recommandé** : servir `dist/` depuis le même origine que l'API derrière le
   reverse proxy (cf. nginx ci-dessous) — pas de CORS, cookie premier-party.
2. Autre origine : lister explicitement l'origine dans `ECLAT_CORS_ORIGINS`.

Le service worker (vite-plugin-pwa) met en cache les assets statiques ; l'app
fonctionne hors connexion pour le périmètre offline documenté
(`docs/migration/09-offline-sync.md`). Une nouvelle version est détectée au
rechargement suivant.

## 4. Migrations (initiales et mises à jour)

- Initialisation : automatique au premier démarrage (`ECLAT_AUTO_MIGRATE=true`),
  fichiers `backend/migrations/0001_*.sql` … appliqués dans l'ordre, journal
  `schema_migrations`.
- Mise à jour : déployer la nouvelle image → les migrations nouvelles s'appliquent
  au démarrage (forward-only). **Pas de migration descendante** : en cas de
  retour arrière applicatif, restaurer le backup pris avant la mise à jour (§7).

## 5. Reverse proxy HTTPS (exemple nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name eclat.exemple.ci;               # DNS → ce serveur
    ssl_certificate     /etc/letsencrypt/live/eclat/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/eclat/privkey.pem;
    client_max_body_size 12m;                    # > ECLAT_BODY_LIMIT

    location / {
        proxy_pass http://127.0.0.1:3000;        # dist/ statique (vite preview) ou serveur de fichiers
        proxy_set_header Host $host;
    }
    location ~ ^/(api|auth|healthz|readyz) {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 130s;                 # exports de sauvegarde (120 s côté client)
    }
}
```

Cookies : en `ECLAT_ENV=production` le cookie de session est `Secure`
(`SameSite=Lax`), donc **HTTPS obligatoire** pour se connecter. Le frontend est
servi depuis le même domaine → aucune configuration CORS supplémentaire.

## 6. Sauvegardes (résumé — procédure complète dans `BACKUP-RESTORE.md`)

- `pg_dump` quotidien (créé par cron/systemd) + sauvegarde du volume `storage`.
- Export applicatif JSON hebdomadaire : `GET /api/v1/backup/export` (session valide).
- Rétention conseillée : 7 quotidiens + 4 hebdomadaires + 12 mensuels, hors site.
- Restaurer est testé **avant** la mise en service (voir `BACKUP-RESTORE.md` §3).

## 7. Mise à jour sans perte de données / retour arrière

Procédure de mise à jour :

```bash
# 0. Prendre un point de restauration
docker compose exec db pg_dump -U eclat eclat > backups/pre-deploy-$(date +%F).sql
docker compose exec db pg_dump -U eclat eclat | gzip > backups/pre-deploy-$(date +%F).sql.gz

# 1. Nouveau code
git pull && docker compose build api && docker compose up -d api
# 2. Vérifier
curl -fsS http://127.0.0.1:8080/healthz && curl -fsS http://127.0.0.1:8080/readyz
```

Retour arrière en cas d'échec :

1. `docker compose down api` (le trafic s'arrête proprement — arrêt gracieux
   `ECLAT_SHUTDOWN_GRACE`) ;
2. restaurer le backup `pre-deploy-*` (procédure §3 de `BACKUP-RESTORE.md`) —
   indispensable si des migrations ont ajouté des tables/colonnes ;
3. démarrer l'image précédente : `docker compose up -d api` après avoir rebasé le
   code sur le tag précédent (`git checkout <tag-précédent> && docker compose build api`).

Les données du volume `storage` sont inchangées par une mise à jour (seuls les
binaires changent) ; les IndexedDB clients restent compatibles (versionnée v4,
aucune suppression automatique).

## 8. Lancement local sans Docker (supporté)

```bash
# PostgreSQL local puis :
cd backend
cp .env.example .env                    # renseigner ECLAT_DATABASE_URL + ECLAT_STORAGE_DIR
export $(grep -v '^#' .env | xargs)
go run ./cmd/api                        # migrations auto + écoute :8080
```

Frontend : `bun install && bun run dev` (proxy `/api`, `/auth` → `http://127.0.0.1:8080`).

## 9. Logs, healthchecks, diagnostics courants

- **Logs** : JSON structurés (`slog`) sur stdout — une ligne par requête HTTP
  (méthode, chemin, statut, durée, request_id) et par événement métier (sync,
  backup, auth). Pas de données personnelles dans les logs (ni PIN, ni noms) ;
  la sync journalise uniquement `deviceId` + compteurs de verdicts.
- **Healthchecks** : `GET /healthz` (processus vivant) — pour Docker/K8s ;
  `GET /readyz` (base joignable + migrations) — pour le reverse proxy.
- **Diagnostics fréquents** :

| Symptôme | Cause probable | Action |
|---|---|---|
| Login 401 immédiat | PIN oublié / session expirée | refaire `/auth/setup` seulement sur base vierge ; sinon réinitialisation manuelle en base (hors périmètre API) |
| Login 429 `rate_limited` | trop d'essais | attendre la fenêtre du rate limit ; le lockout persistant se débloque via la base |
| 403 sur les mutations depuis le navigateur | origine non autorisée (CORS/OriginGuard) | ajouter l'origine exacte à `ECLAT_CORS_ORIGINS`, servir le frontend du même domaine |
| `/sync/push` verdicts `conflict` récurrents | tarifs modifiés pendant l'offline | panneau « Résoudre » de l'app (accepter les nouveaux tarifs ou abandonner) |
| Sauvegarde 422 | fichier legacy non conforme | vérifier `POST /api/v1/backup/preview` pour le diagnostic exact |
| Photos 404 | volume `storage` absent/monté à froid | vérifier le montage du volume et les permissions `eclat` |

## 10. Checklist avant mise en service

- [ ] `ECLAT_ENV=production`, HTTPS actif, cookie `Secure` vérifié
- [ ] `POSTGRES_PASSWORD` fort et `5432` non exposé publiquement
- [ ] `ECLAT_CORS_ORIGINS` explicite (pas de `*`)
- [ ] Sauvegarde pg_dump + storage planifiée (cron) et **restauration testée**
- [ ] `/healthz` + `/readyz` branchés au monitoring
- [ ] Premier PIN propriétaire fort défini (setup initial)
- [ ] Export JSON de référence conservé hors site
