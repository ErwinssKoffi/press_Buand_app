# 04 — Authentification, sessions et sécurité serveur

> Phase 04/10. Code : `backend/internal/domain/auth`, `internal/service/auth.go`,
> `internal/repository/postgres/authrepo.go`, `internal/handler/http/auth.go`.

## 1. Posture de sécurité par contexte

| Contexte (`ECLAT_ENV`) | Secret autorisé | Transport | Lockout |
|---|---|---|---|
| `development` / `test` | PIN 5 chiffres OU mot de passe fort | HTTP local autorisé | persistant (base) |
| `production` | **8 caractères min. mêlant lettres et chiffres** (PIN 5 chiffres refusé) | cookie `Secure` forcé | persistant |

Le contexte cible (décision audit §11.1) reste paramétrable : le serveur impose la
politique forte en production sans changer le code.

## 2. Composants

- **Argon2id** (PHC `$argon2id$v=19$m=65536,t=1,p=4$salt$key`), 64 Mo / t=1 / p=4, sel 16 octets — `auth.HashSecret` / `auth.VerifyPHC` (temps constant).
- **Compatibilité legacy** : `auth.LegacyHash` reproduit exactement le hash navigateur
  `SHA-256("salt:pin:eclat-pressing-pin-v1")` (vecteurs de test générés depuis
  `src/utils/pinAuth.ts`). À la première connexion legacy : vérification → **re-hash
  Argon2id immédiat** + effacement du legacy (ADR A6). Le fallback non cryptographique
  du navigateur n'est jamais porté côté serveur.
- **Sessions opaques** : token 32 octets aléatoires (base64url) ; seul son SHA-256 est
  stocké (`auth_sessions.token_hash`) ; `HttpOnly`, `SameSite=Strict`, `Secure` en HTTPS,
  TTL 7 jours ; révocables (`revoked_at`) ; purge des sessions expirées au login.
- **Lockout persistant** : `ECLAT_LOGIN_MAX_ATTEMPTS` (défaut 5) échecs →
  `ECLAT_LOGIN_LOCKOUT` (défaut 5 min) en base (`auth_credentials.locked_until`),
  message 429 avec `lockRemainingSeconds`. Audit de chaque tentative.
- **Séparation des secrets** : `auth_credentials` est une table distincte de
  `shop_settings` ; aucun endpoint de settings n'expose `pinHash/pinSalt` (contrôle en phase 06).
- **Setup protégé** : `POST /auth/setup` n'est accepté qu'à l'état `virgin`
  (`algo='none'` sans hash) ; ensuite 409 pour toujours.
- **CSRF** : cookie `SameSite=Strict` + CORS fermé par défaut + `OriginGuard`
  (mutations avec `Origin` étranger → 403 ; clients sans `Origin` (curl/PWA) autorisés).
- **En-têtes** : `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cache-Control: no-store`.

## 3. Endpoints

| Route | Auth | Effet |
|---|---|---|
| `GET /auth/status` | publique | `virgin | legacy | argon2id` + lockout |
| `POST /auth/setup` | virgin uniquement | création du secret (Argon2id) |
| `POST /auth/login` | publique | session + cookie ; upgrade legacy automatique |
| `POST /auth/logout` | session | révocation + effacement du cookie |
| `GET /auth/me` | session | état de session |
| `POST /auth/change-pin` | session + secret courant | changement (Argon2id) |

Toutes les routes métier `/api/v1/*` sont derrière `RequireAuth` (401 sinon).

## 4. Menaces couvertes (résumé)

| Menace | Contre-mesure |
|---|---|
| Vol du poste | secrets jamais en clair (Argon2id), sessions révocables |
| Brute force PIN | lockout persistant + audit + limite de tentatives |
| API exposée LAN/Internet | politique de secret par environnement, CORS fermé, OriginGuard |
| Vol de cookie | HttpOnly, SameSite=Strict, Secure (HTTPS), hash du token en base |
| Fuite de logs | aucun PIN/token/cookie loggé (logs = méthode/chemin/code/durée/request id) |

## 5. Tests

- `domain/auth` : roundtrip Argon2id, **vecteurs legacy exacts** (2 cas), politique de secret, tokens.
- `service` : setup unique, lockout persistant après N échecs, upgrade legacy→Argon2id,
  refus d'upgrade si PIN erroné, expiration/révocation de session, changement de secret, vierge → login refusé.
- `handler/http` : flux HTTP complet (setup 204 puis 409, cookie HttpOnly, me, 401 anonyme,
  lockout 429, logout) + OriginGuard.
- `repository/postgres` : persistance credential/session sur PostgreSQL réel (env `ECLAT_TEST_DATABASE_URL`).
