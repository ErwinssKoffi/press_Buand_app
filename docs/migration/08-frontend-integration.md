# Prompt 08 — Connexion du frontend React au backend Go

> Statut : **livré**. Le frontend consomme l'API Go (`/api/v1` + `/auth/*`) via une
> couche de services typée ; IndexedDB devient un **cache de lecture** (fallback
> hors-ligne). Les composants, l'ergonomie et la PWA sont préservés — c'est une
> migration de persistance, pas une refonte UI.

## 1. Architecture livrée

| Fichier | Rôle |
|---|---|
| `src/services/api/http.ts` | Client HTTP centralisé : base URL configurable (`VITE_API_BASE_URL`, défaut = same-origin), cookie de session httpOnly (`credentials: 'include'`, **rien en localStorage**), timeout 15 s (120 s pour backup), `X-Request-ID`, erreurs normalisées `ApiError {status, code, message, details}` (contrat `{error:{...}}`) et `OfflineError` (réseau/timeout). |
| `src/services/api/index.ts` | Modules API par domaine : **auth, bootstrap, settings, catalog, clients (+wallet), orders (+mapping/payments/void/photos), expenses, reports, delivery zones, logistics, inventory (+movements), backup (export/preview/restore)**. Sources des DTO : `docs/migration/openapi.yaml` + `backend/internal/domain/pressing/types.go` — **aucune interface dupliquée** : les entités réimportent `src/types/pressing.ts`, seules les formes serveur nullables (`ServerClient`, `ServerOrder`, `ServerPayment`, `ServerPhotoDTO`) sont explicitées ici et commentées. |
| `src/services/backend.ts` | Repository frontend : **même surface que `src/db/localDb.ts`** (mêmes noms de fonctions, mêmes types d'entrée/sortie) → App.tsx et composants inchangés dans leur structure. Convertit les null serveur (`null` → `undefined`/`0`), génère les clés d'idempotence, réécrit le bootstrap serveur dans IndexedDB (`cacheSnapshot`) après chaque chargement réussi. |
| `vite.config.ts` | Proxy dev `/api` + `/auth` → `http://127.0.0.1:8080` (`BACKEND_ORIGIN` pour surcharger), en-tête `Origin` retiré (le navigateur parle au backend comme same-origin ; production = same-origin ou `VITE_API_BASE_URL` + CORS stricte `ECLAT_CORS_ORIGINS`). `allowedHosts: true` pour l'hôte de prévisualisation. |

### Répartition cache local vs API (Prompt 08 §8)

- **En cache (lecture seule)** : tout l'instantané bootstrap (settings, catalog,
  clients, orders, payments, expenses, zones, logistics, inventory, movements) →
  IndexedDB, réécrit à chaque bootstrap réussi. Hors-ligne : dernier instantané
  affiché avec bannière « lecture seule » (aucune écriture locale qui dévierait du serveur).
- **Uniquement via API en ligne** : toutes les écritures (commandes, paiements,
  topups, mouvements de stock, dépenses, zones, logistique, settings, import/export
  de sauvegarde, changement de PIN).
- **Photos** : capture locale = data URL compressée envoyée dans `POST /orders`
  (`claimPhotos[].url`) ; le serveur la matérialise en **fichier privé**
  (`<ECLAT_STORAGE_DIR>/photos/…`, jamais servi statiquement) et renvoie une URL
  authentifiée `/api/v1/orders/{id}/photos/{photoId}` (cookie requis). Rendu :
  `photoSrc()` (`src/utils/photos.ts`) = `dataUrl ?? apiUrl(url)`.
  Correctif backend associé : `OrderService.materializePhotos` (data URL → fichier,
  MIME jpeg/png/webp, ≤ 5 Mo) + `PhotoBytes` lit désormais `storage_path` (colonne
  `data` inexistante → 500 avant le correctif) ; l'URL publique remplace le chemin
  de stockage dans les réponses.

### Authentification (Prompt 08 §6)

- `LoginView` : modes pilotés par `GET /auth/status` (`virgin` → création, sinon
  déverrouillage). `POST /auth/setup {secret}` / `POST /auth/login {pinOrPassword}`
  → cookie `eclat_session` httpOnly. Le PIN ne transite **jamais** en stockage
  local ; le hash reste côté serveur (Argon2id, re-hash automatique de l'état
  `legacy` au premier login — migration Prompt 07).
- Verrouillage serveur (429 `rate_limited`) affiché ; verrouillage local conservé
  pour l'ergonomie. La réinitialisation locale « Code PIN oublié » est **supprimée**
  (breaking change assumé : seul l'opérateur serveur peut réinitialiser).
- `SettingsView` : changement de PIN via `POST /auth/change-pin {currentSecret,
  newSecret}` (401 = PIN actuel incorrect, 422 = trop faible).
- Bouton « Verrouiller » : retour à l'écran PIN (la session cookie reste valide).

### Onboarding / première installation serveur (Prompt 08 §7)

`OnboardingView` inchangé visuellement ; `handleCompleteOnboarding` enregistre les
settings sur le serveur (`PUT /api/v1/settings`, `onboardingCompleted=true`).
L'option « démarrer à zéro » est **sans objet** : la base PostgreSQL d'une première
installation est déjà vierge, et tout effacement automatique est interdit (Prompt 07).
Les jeux de démonstration n'existent pas côté serveur.

### Sauvegarde (Prompt 08 §10)

- Export : `GET /api/v1/backup/export` (format v3 compatible, **sans secrets**).
- Import : **deux étapes obligatoires** — `POST /backup/preview` (rapport lu :
  doublons bloquants, anomalies, incompatibilités) → `window.confirm` listant les
  avertissements si données réelles déjà présentes → `POST /backup/restore`
  (`X-Backup-Confirm: true`). Rapport final affiché (lignes créées, photos, chemin
  de la sauvegarde pré-restauration serveur). `déjà appliqué` = hash identique,
  aucune réécriture. Les boutons « Vider la base » et « Recharger démo Abidjan »
  sont retirés (données réelles serveur).

### Autres adaptations

- Suppression d'une commande → **annulation non destructive** `POST /orders/{id}/void`
  (motif « Annulée depuis le comptoir ») : plus de suppression dure.
- Montants : l'aperçu du POS reste indicatif ; les montants affichés après création
  sont **ceux renvoyés par le serveur** (recalcul autoritaire, mapping prépayé réel).
- Normalisation `clientId/orderId` vides → `NULL` dans `LogisticsService.Save`
  (client de passage : pas de violation FK).
- Service worker : `generateSW` ne met en cache **que** les assets statiques
  (precache) et les fonts (CacheFirst) — aucune `runtimeCaching` sur `/api` ni
  `/auth` ; les réponses privées et mutations ne sont jamais servies du cache.
- PDF tickets/facture Z : inchangés, alimentés par les DTO serveur (génération
  client conservée : rien ne justifie de la déplacer).

## 2. Vite : dev vs prod

```bash
# développement : frontend :3000, backend :8080, proxy /api + /auth
bun run dev
# production : build statique servi same-origin derrière le backend Go
bun run build   # dist/
```

## 3. Tests et validations

| Vérification | Résultat |
|---|---|
| `tsc --noEmit` (`bun run lint`) | **PASS** (0 erreur) |
| `bun test tests/` — client API : parse JSON, 204, erreurs contrat → `ApiError`, réseau/timeout → `OfflineError`, `Idempotency-Key`, `X-Backup-Confirm`, credentials | **9/9 PASS** |
| `bun run build` (Vite + PWA) | **PASS** (precache 28 entries) |
| Secrets dans le bundle | Aucun (grep `eclat-pressing-pin-v1` / vecteurs legacy : **absents** — tree-shaking, plus aucun hash client) |
| Accès réseau non centralisé | Aucun `fetch` hors `services/api/http.ts` |
| Go `go test ./...` + intégration PG (photo data URL → stockage privé → lecture authentifiée ; logistics clientId vide) | **PASS** |
| Smoke live proxy : `/auth/status` 200, `/auth/login` (état legacy → upgrade) 200 + cookie, `/api/v1/bootstrap` 200 via `:3000` | **PASS** |

### Écrans testés (manuellement via API/proxy)

login (setup + déverrouillage + verrouillage serveur), onboarding (settings serveur),
tableau de bord (bootstrap), nouveau dépôt (création commande idempotente + photos),
commandes & suivi (liste, statuts, paiement, void, ticket PDF), enlèvements/livraisons
(clientId vide toléré), clients (création, topup idempotent, wallet), catalogue,
stocks (mouvement + dépense auto), caisse (dépenses, facture Z via reports),
paramètres (settings, PIN serveur, export/import deux étapes). Mode hors-ligne :
bannière lecture seule sur instantané local.

## 4. Fonctions `localDb.ts` restantes et raison d'être

| Fonction / export | Raison |
|---|---|
| `getDB`, schéma IndexedDB | Ouvre la base locale de **cache** (lecture hors-ligne) ; utilisée par `cacheSnapshot`. |
| `DEFAULT_SETTINGS`, `DEFAULT_*_CONFIG`, `INITIAL_CATALOG`, `normalizeSettings` | Valeurs par défaut et normalisation **purement fonctionnelle** (affichage avant login, onboarding, formulaires) — aucune écriture. |
| `loadAllData` | Fallback lecture du dernier instantané quand le backend est injoignable (appelé dynamiquement par `services/backend.loadAllData`). |
| `ensureSeededDatabase` | Amorçage du cache local (catalogue par défaut) pour un premier lancement hors-ligne ; ne part plus en écriture « métier ». |
| Toutes les autres (`saveClient`, `createOrderWithPayment`, `importBackupJSON`, `resetDemoData`, `clearAllBusinessData`, …) | **Non appelées** par l'app (aucun import dans `App.tsx`/composants, vérifié par grep §6) ; conservées temporairement pour la transition Prompt 09 (outbox) — suppression prévue quand l'offline-écrire sera livré. |

## 5. Limitations connues (reportées au Prompt 09)

- Hors-ligne = **lecture seule** ; les écritures hors-ligne (outbox, file d'attente,
  reprise) arrivent avec `/sync/push` (routes déjà stub 501 côté serveur).
- La fenêtre bootstrap est bornée (90 jours par défaut, max 365) : les historiques
  plus anciens restent dans PostgreSQL et consultables via les filtres des listes.
