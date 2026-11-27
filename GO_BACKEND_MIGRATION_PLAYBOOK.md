# GO BACKEND MIGRATION PLAYBOOK

## Migration complète du backend d'Éclat Pressing vers Golang

**Dépôt cible :** `https://github.com/ErwinssKoffi/press_Buand_app.git`  
**Branche de référence :** `main`  
**Date de préparation :** 27 novembre 2026  
**Livrable :** plan d'architecture et 10 prompts autonomes, à exécuter dans l'ordre avec Claude Code, Cursor ou un agent de développement équivalent.

---

## 0. Mode d'emploi

Ce playbook guide une migration progressive de l'application existante vers une architecture dans laquelle **tout le backend applicatif est écrit en Go**. Le frontend React/TypeScript reste en place : il constitue l'interface utilisateur et communique avec le backend via une API HTTP/JSON.

Les dix prompts doivent être exécutés **dans l'ordre, un à la fois**, dans le même dépôt Git. Chaque prompt est autonome : il rappelle le contexte, la mission, les contraintes et les critères d'acceptation. Il demande à l'agent de relire le code réel avant de modifier quoi que ce soit. Le résultat d'une phase devient la base de la suivante.

### Règles d'exécution

1. Ouvrir le dépôt `press_Buand_app` dans l'agent IA et vérifier la branche active.
2. Créer une branche de travail dédiée, par exemple `feature/go-backend-migration`.
3. Exécuter le Prompt 01, examiner son rapport, puis continuer avec le Prompt 02, etc.
4. À chaque phase, demander à l'agent de lancer les tests et les vérifications applicables, de corriger les échecs et de fournir un résumé des fichiers modifiés.
5. Ne jamais supprimer une ancienne fonctionnalité ou une ancienne donnée uniquement parce qu'elle n'est pas encore migrée.
6. Faire des commits cohérents à la fin de chaque phase. Ne pas demander à l'agent de pousser ou déployer sans autorisation explicite.
7. Ne pas poursuivre vers la phase suivante si les critères bloquants de la phase actuelle ne sont pas satisfaits. L'agent doit expliquer les blocages et proposer une correction concrète.

### Ce que signifie « backend exclusivement en Go »

Le code serveur, les routes API, l'authentification, les règles métier, les validations, les transactions, la synchronisation, les rapports côté serveur et les tâches de fond doivent être écrits en **Golang**. Aucun serveur Express, Node.js, TypeScript, Python ou autre langage ne doit porter une responsabilité backend.

Restent autorisés :

- React, TypeScript, Vite et Tailwind pour le frontend ;
- PostgreSQL comme moteur de base de données ;
- les fichiers SQL de migration de schéma ;
- les fichiers YAML/JSON de configuration et OpenAPI ;
- Node/Bun uniquement pour installer les dépendances et compiler le frontend ;
- les bibliothèques Go nécessaires au backend.

Le backend doit pouvoir démarrer et fonctionner sans serveur Node.js. La compilation du frontend peut continuer à nécessiter Node/Bun, car cela ne constitue pas un backend Node.

---

# 1. Diagnostic de départ du dépôt

L'agent doit confirmer ces constats dans le dépôt avant de les considérer comme définitifs. Ils proviennent de l'examen de la branche `main` et des fichiers accessibles lors de la préparation du playbook.

## 1.1 Stack et structure repérées

| Élément | État repéré |
|---|---|
| Frontend | React 19 + TypeScript |
| Bundler | Vite |
| Styles | Tailwind CSS 4 |
| Icônes | lucide-react |
| Graphiques | Recharts |
| PDF | jsPDF et utilitaires PDF locaux |
| Installation web | PWA via `vite-plugin-pwa` |
| Stockage actuel | IndexedDB via `idb` |
| Backend Go | Aucun backend Go repéré dans l'arborescence initiale |
| Base serveur | Aucune base centrale PostgreSQL repérée dans l'arborescence initiale |
| Ancien serveur Node | `express` apparaît dans `package.json`, mais aucun serveur Express fonctionnel n'a été confirmé ; vérifier les usages avant toute suppression |

## 1.2 Fichiers importants existants

- `src/App.tsx` : état global de l'application, chargement des données et orchestration des actions.
- `src/db/localDb.ts` : stockage IndexedDB, données initiales, fonctions de lecture/écriture et règles métier actuellement exécutées dans le navigateur.
- `src/types/pressing.ts` : contrats TypeScript des entités métier.
- `src/utils/pinAuth.ts` : génération du sel, hash et vérification du PIN côté navigateur.
- `src/components/LoginView.tsx` : création, vérification et réinitialisation du PIN local.
- `src/components/OnboardingView.tsx` : configuration initiale de l'établissement, activités, tarifs et fidélité.
- `src/components/PosDepositView.tsx` : création du dépôt et construction du brouillon de commande.
- `src/components/SettingsView.tsx` : paramètres, changement de PIN, export/import de sauvegarde et remise à zéro.
- `src/components/OrdersView.tsx` : liste, recherche, suivi et suppression des commandes.
- `src/components/InventoryView.tsx` : articles de stock et mouvements.
- `src/components/CashbookView.tsx` : caisse, recettes, dépenses et rapports.
- `src/components/LogisticsView.tsx` : enlèvements, livraisons et zones.
- `vite.config.ts` : configuration Vite/PWA et cache des ressources frontend.
- `.env.example` : variables `GEMINI_API_KEY` et `APP_URL` ; vérifier si et où Gemini est réellement utilisé.

## 1.3 Données et règles métier à préserver

La base IndexedDB actuelle est nommée `eclat_pressing_ci_v1`, avec une version de schéma repérée à `3`. Les magasins de données repérés sont :

- `settings`
- `catalog`
- `clients`
- `orders`
- `payments`
- `expenses`
- `zones`
- `logistics`
- `inventory`
- `inventoryMovements`

Le modèle TypeScript contient notamment :

- `PressingSettings`, `PressingConfig`, `BlanchisserieConfig`, `LoyaltyConfig` ;
- `CatalogItem`, `Client`, `ClientWalletEntry` ;
- `PressingOrder`, `OrderLineItem`, `IntakePhoto` ;
- `PaymentRecord`, `ExpenseRecord` ;
- `DeliveryZone`, `LogisticsTask` ;
- `InventoryItem`, `InventoryMovement` ;
- `DatabaseBackup`.

Les valeurs d'énumération actuellement utilisées incluent les statuts de commande `recu`, `lavage`, `repassage`, `pret`, `livre`, les moyens de paiement `especes`, `wave`, `orange_money`, `mtn_momo`, `moov_money`, et les états logistiques `planifie`, `en_cours`, `effectue`, `annule`. Les contrats API doivent préserver les valeurs existantes ou fournir une migration documentée et testée.

Les fonctions métier importantes présentes dans `localDb.ts` incluent notamment :

- `loadAllData`, `ensureSeededDatabase`, `normalizeSettings` ;
- `createOrderWithPayment`, `updateOrderStatus`, `recordOrderPayment`, `deleteOrder` ;
- `topUpClientPrepaid` ;
- `saveClient`, `saveCatalogItem`, `saveExpense`, `saveDeliveryZone`, `saveLogisticsTask`, `saveInventoryItem`, `saveSettings` ;
- `updateLogisticsStatus`, `recordInventoryMovement` ;
- `exportBackupJSON`, `importBackupJSON`, `clearAllBusinessData`, `resetDemoData`.

L'application supporte deux périmètres d'activité : pressing, blanchisserie ou les deux. Le dépôt doit préserver les tarifs à la pièce, au kilo, les offres au poids, les majorations express, les packs de blanchisserie, les acomptes, les paiements partiels, les comptes prépayés, les bonus et points de fidélité, les photos de réserves, les casiers, les zones et frais de livraison, la caisse, les dépenses, les stocks et leurs mouvements.

## 1.4 Risques à traiter explicitement

1. **Données locales non centralisées :** la migration ne doit pas initialiser une base vide et laisser les données utiles dans l'ancien navigateur.
2. **PIN faible :** le PIN à cinq chiffres est un verrou local pratique, pas une authentification suffisamment forte pour exposer directement un service sur Internet. Conserver un verrou local si nécessaire, mais sécuriser l'accès serveur avec une stratégie adaptée au mode de déploiement.
3. **Secrets :** aucun secret Gemini, secret de session, mot de passe de base ou clé privée ne doit se retrouver dans le bundle frontend.
4. **Montants financiers :** les montants FCFA doivent rester des entiers ; ne pas employer de flottants pour les calculs monétaires.
5. **Transactions :** commande, paiement initial, séquence de ticket, solde prépayé et fidélité doivent être cohérents dans une même transaction serveur.
6. **Suppressions :** ne pas effacer l'historique financier lors d'une suppression d'interface. Étudier les suppressions actuelles et privilégier annulation/archivage avec traçabilité.
7. **Hors ligne :** remplacer IndexedDB par des appels API directs sans mécanisme hors ligne ferait régresser une fonction importante de l'application.
8. **Données de démonstration :** les jeux de données initiaux ne doivent jamais écraser ni contaminer une installation contenant des données réelles.
9. **Photos :** les photos de réserves sont actuellement décrites comme des `dataUrl` dans `IntakePhoto`. Leur stockage serveur doit être sécurisé et tenir compte de la taille des fichiers.
10. **Compatibilité :** préserver le format JSON camelCase attendu par le frontend, les fonctions d'export/import et les types métier autant que possible.

---

# 2. Architecture cible obligatoire

## 2.1 Vue d'ensemble

```text
┌──────────────────────────────────────────────────────────┐
│ FRONTEND                                                  │
│ React 19 / TypeScript / Vite / Tailwind / PWA             │
│                                                          │
│ UI → services/api → cache IndexedDB → outbox de sync       │
└──────────────────────────────┬───────────────────────────┘
                               │ HTTPS / HTTP JSON
                               │ /api/v1/*
┌──────────────────────────────▼───────────────────────────┐
│ BACKEND GO — monolithe modulaire                          │
│                                                          │
│ HTTP Router → Middleware → Handlers → Services → Domain  │
│                                    │                     │
│                                    ▼                     │
│                                Repositories               │
│                                    │                     │
│                    Transactions / PostgreSQL             │
└──────────────────────────────────────────────────────────┘
```

Choisir un **monolithe modulaire Go**, pas des microservices. Le projet est une application métier de pressing ; un serveur unique, organisé par domaines, est plus simple à maintenir, tester et déployer.

## 2.2 Stack backend de référence

- Langage : Go, version stable compatible avec l'environnement du projet. Ne pas choisir une version expérimentale.
- HTTP : `net/http` avec `chi` (ou `net/http` seul si l'agent justifie une solution plus simple).
- Base principale : PostgreSQL.
- Driver PostgreSQL : `pgx/v5`.
- Migrations : `golang-migrate` ou outil de migration Go équivalent, versionné et reproductible.
- Authentification : session serveur à jeton opaque dans un cookie `HttpOnly`, ou mécanisme explicitement justifié ; éviter les JWT longue durée stockés dans `localStorage`.
- Hash de secrets utilisateur : Argon2id pour les mots de passe/PIN quand applicable, avec limitation de tentatives et verrouillage côté serveur.
- Validation : validation explicite des DTO et règles de domaine. Une bibliothèque peut être utilisée, mais les règles métier ne doivent pas être réduites à des tags.
- Logs : `log/slog` avec format structuré.
- Configuration : variables d'environnement validées au démarrage.
- Documentation API : OpenAPI 3.x et Swagger UI en développement si utile.
- Tests : `go test`, tests d'intégration sur une base PostgreSQL dédiée, tests HTTP.
- Déploiement : Docker et Docker Compose en environnement de développement ; conteneur backend autonome en production.

Les bibliothèques sont des dépendances Go : elles ne changent pas le fait que le serveur applicatif est écrit en Go.

## 2.3 Organisation de dossiers indicative

L'agent peut adapter les noms, mais doit conserver les responsabilités séparées.

```text
backend/
├── cmd/
│   └── api/
│       └── main.go
├── internal/
│   ├── app/
│   ├── config/
│   ├── domain/
│   │   ├── auth/
│   │   ├── settings/
│   │   ├── catalog/
│   │   ├── clients/
│   │   ├── orders/
│   │   ├── payments/
│   │   ├── cashbook/
│   │   ├── logistics/
│   │   ├── inventory/
│   │   └── reports/
│   ├── handler/http/
│   ├── middleware/
│   ├── repository/postgres/
│   ├── service/
│   ├── platform/
│   │   ├── database/
│   │   ├── logging/
│   │   ├── storage/
│   │   └── clock/
│   └── transport/dto/
├── migrations/
├── tests/
├── go.mod
└── README.md

frontend/                 # ou racine actuelle conservée si déplacer tout est risqué
```

Ne pas déplacer le frontend simplement pour faire joli. La séparation peut être obtenue en ajoutant `backend/` à la racine et en conservant momentanément les chemins actuels.

## 2.4 Principes de conception

- Le domaine ne dépend ni de HTTP, ni de PostgreSQL, ni de React.
- Les handlers HTTP sont fins : parsing, authentification, validation de transport, appel service, réponse JSON.
- Les services portent les cas d'utilisation et orchestrent les transactions.
- Les repositories portent exclusivement l'accès aux données.
- Les règles de calcul sont centralisées dans le backend. Le frontend peut prévisualiser, mais le serveur décide du montant validé.
- Les identifiants d'entités doivent être non prévisibles et compatibles avec l'outbox hors ligne (UUID recommandé).
- Les montants FCFA sont stockés en `BIGINT` / `int64` et transportés comme nombres entiers.
- Les dates sont stockées en `TIMESTAMPTZ` et transportées en ISO-8601/RFC3339.
- Les erreurs API sont uniformes, documentées et exploitables par le frontend.
- Chaque écriture sensible est protégée par authentification, autorisation et validation.
- Ajouter des transactions, contraintes SQL, clés étrangères et index là où ils sont nécessaires.

---

# 3. Modèle de données et contrats à couvrir

L'agent doit réaliser un mapping précis du modèle TypeScript existant vers des tables PostgreSQL. Les noms ci-dessous sont une base recommandée, pas une permission d'ignorer des propriétés découvertes dans le code.

| Domaine | Tables indicatives | Points à préserver |
|---|---|---|
| Configuration | `shop_settings`, `auth_credentials`, `auth_sessions` | paramètres du pressing, configs pressing/blanchisserie, fidélité ; secrets d'auth séparés des DTO publics |
| Catalogue | `catalog_items` | catégorie, mode, unité, prix FCFA, activation, délai, note d'entretien, image |
| Clients | `clients`, `client_wallet_entries` | coordonnées, commune, compte prépayé, historique et points fidélité |
| Commandes | `orders`, `order_items`, `order_claim_photos` | ticket, casier, dates, statut, remises, livraison, express, notes et photos |
| Paiements | `payments` | acompte, solde, intégral, moyen et date ; historique non destructif |
| Dépenses | `expenses` | libellé, catégorie, montant, moyen, date et note |
| Logistique | `delivery_zones`, `logistics_tasks` | enlèvements/livraisons, statut, commune, créneau, livreur et frais |
| Stocks | `inventory_items`, `inventory_movements` | quantité, seuil, coût, fournisseur et historique des mouvements |
| Synchronisation | `devices`, `sync_operations`, `idempotency_keys` | opérations offline, déduplication et traçabilité |
| Audit | `audit_logs` | actions sensibles, utilisateur, date, entité et motif |

### Contrats métier critiques

- `PressingSettings.id` vaut actuellement `default`. Préserver une configuration principale compatible, même si la conception laisse une possibilité d'évolution future.
- `nextTicketSequence` doit être géré avec verrouillage/transaction SQL afin que deux dépôts simultanés ne reçoivent jamais le même ticket.
- Les valeurs des statuts et moyens de paiement doivent rester compatibles avec les unions TypeScript existantes.
- `PressingOrder.totalFCFA`, `paidFCFA`, `discountFCFA`, `deliveryFeeFCFA`, `expressFeeFCFA`, `prepaidUsedFCFA` et les prix unitaires doivent être recalculés ou vérifiés côté Go.
- `Client.prepaidBalanceFCFA` et `loyaltyPoints` ne doivent pas être modifiés sans transaction et écriture de l'historique associé.
- Les mouvements de stock doivent conserver `previousQty`, `newQty`, `quantityDelta`, leur raison et le coût éventuel.
- La livraison marquée effectuée doit pouvoir faire évoluer le statut de la commande liée, comme le fait actuellement `updateLogisticsStatus`.
- Une entrée de stock peut déclencher une dépense selon l'option `recordExpense`; l'opération doit être atomique.
- Importer une sauvegarde doit être validé avant écriture et exécuté dans une transaction ; une sauvegarde invalide ne doit jamais vider la base.

### API REST minimale recommandée

Préfixe versionné : `/api/v1`.

| Domaine | Routes indicatives |
|---|---|
| Santé | `GET /healthz`, `GET /readyz` |
| Auth | `GET /auth/status`, `POST /auth/setup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-pin` |
| Initialisation | `GET /bootstrap` |
| Paramètres | `GET /settings`, `PUT /settings` |
| Catalogue | `GET/POST /catalog`, `PUT/DELETE /catalog/{id}` |
| Clients | `GET/POST /clients`, `GET/PUT/DELETE /clients/{id}`, `POST /clients/{id}/wallet/topups` |
| Commandes | `GET/POST /orders`, `GET /orders/{id}`, `PATCH /orders/{id}/status`, `POST /orders/{id}/payments`, `POST /orders/{id}/void` |
| Caisse | `GET/POST /expenses`, `DELETE /expenses/{id}`, `GET /reports/daily-z`, `GET /reports/monthly` |
| Zones | `GET/POST /delivery-zones`, `PUT/DELETE /delivery-zones/{id}` |
| Logistique | `GET/POST /logistics`, `PATCH /logistics/{id}/status`, `DELETE /logistics/{id}` |
| Stocks | `GET/POST /inventory`, `PUT/DELETE /inventory/{id}`, `POST /inventory/{id}/movements` |
| Sauvegarde | `GET /backup/export`, `POST /backup/preview`, `POST /backup/restore` |
| Synchronisation | `POST /sync/push`, `GET /sync/pull`, `GET /sync/status` |

Les routes peuvent être ajustées après l'audit, mais les cas d'utilisation existants doivent tous être couverts. Utiliser la pagination pour les listes volumineuses. Éviter de charger indéfiniment toute la base à chaque action.

---

# 4. Stratégie de données, sauvegarde et mode hors ligne

## 4.1 Règle de vérité des données

En ligne, PostgreSQL côté backend Go est la source de vérité. IndexedDB reste un cache local et un espace de travail hors ligne, pas une deuxième base indépendante concurrente.

En mode hors ligne :

1. le frontend lit le dernier snapshot local disponible ;
2. les actions autorisées sont enregistrées localement et ajoutées à une outbox durable ;
3. chaque opération reçoit un `operationId` UUID, un `deviceId`, un type, une date locale et une version de schéma ;
4. à la reconnexion, le frontend envoie les opérations dans leur ordre de dépendance ;
5. Go déduplique par `operationId`/clé d'idempotence, valide et applique les opérations dans des transactions ;
6. Go renvoie les identifiants, numéros de ticket, totaux et versions définitifs ;
7. le frontend réconcilie IndexedDB, marque les opérations traitées et rafraîchit les données ;
8. les conflits non résolus sont présentés à l'utilisateur. Ne pas écraser silencieusement une donnée métier.

Ne pas synchroniser des snapshots complets en écrasement aveugle : cela peut supprimer des écritures récentes faites depuis un autre appareil.

## 4.2 Numérotation provisoire hors ligne

Le ticket définitif doit être attribué par Go dans une transaction. Pour un dépôt créé hors ligne, utiliser un identifiant local provisoire distinct du numéro officiel (par exemple une référence locale clairement identifiable). À la synchronisation, le serveur attribue le numéro officiel et retourne le mapping. Si le ticket est imprimé avant la synchronisation, l'interface doit signaler clairement qu'il s'agit d'une référence provisoire à confirmer. Ne jamais générer un numéro officiel à partir d'un compteur local non coordonné.

## 4.3 Idempotence et dépendances

- Une opération de création envoyée deux fois ne doit créer qu'une seule commande.
- Un paiement ne doit pas être enregistré deux fois après un timeout réseau suivi d'une nouvelle tentative.
- Une recharge prépayée, un bonus ou un mouvement de stock doivent être idempotents.
- Les opérations doivent pouvoir référencer des identifiants UUID créés sur le terminal, même avant leur synchronisation.
- Une opération enfant doit attendre l'opération parent si nécessaire (ex. commande puis paiement complémentaire).
- Les réponses de synchronisation doivent être rejouables sans effets secondaires supplémentaires.

## 4.4 Données et configuration à migrer

La version actuelle du backup JSON est `3`. Garder un importeur compatible avec ce format et définir une version serveur/version cible explicite. La migration doit :

- proposer un export JSON de sécurité avant toute migration ;
- importer les paramètres, le catalogue, clients, commandes, paiements, dépenses, zones, logistique, stocks et mouvements ;
- valider les références et les relations ;
- préserver les identifiants historiques quand ils ne créent pas de conflit ;
- préserver les horodatages et montants ;
- transférer les photos en sécurité ;
- traiter séparément le secret PIN ;
- produire un rapport de migration avec éléments importés, ignorés, transformés et erreurs ;
- être relançable sans dupliquer les enregistrements ;
- ne jamais effacer la base locale source avant vérification de l'import et confirmation de l'utilisateur.

## 4.5 Compatibilité de l'ancien PIN

L'ancien mécanisme utilise SHA-256 avec un sel et un suffixe fixe côté navigateur ; un fallback non cryptographique existe lorsque Web Crypto n'est pas disponible. Ne pas conserver ce fallback comme mécanisme de sécurité serveur.

Prévoir une transition sûre : soit demander à l'utilisateur de définir un nouveau secret lors de la migration, soit vérifier temporairement le hash legacy en Go après audit exact de la fonction existante, puis re-hasher immédiatement avec Argon2id après une connexion valide. Ne jamais transférer le hash PIN dans une réponse `GET /settings`. Pour un déploiement accessible à distance, ne pas considérer un PIN à cinq chiffres comme seul facteur de sécurité.

---

# 5. Qualité, sécurité et critères globaux de livraison

## Qualité technique

- `go test ./...` doit réussir.
- Les tests d'intégration doivent utiliser une base dédiée, jamais la base réelle.
- Le frontend doit compiler avec son gestionnaire de paquets actuel.
- Les types TypeScript ne doivent pas être contournés avec `any` pour accélérer la migration.
- Les fonctions de calcul doivent avoir des tests unitaires indépendants de HTTP et de PostgreSQL.
- Les erreurs réseau, serveur indisponible et conflit de synchronisation doivent être présentées clairement dans l'interface.

## Sécurité

- Hash Argon2id pour les secrets utilisateur lorsque le contexte l'exige.
- Limitation de tentatives et verrouillage temporaire côté serveur.
- Cookies de session `HttpOnly`, `SameSite` et `Secure` en production HTTPS ; protection CSRF si authentification par cookie.
- CORS fermé par défaut, ouvert uniquement aux origines explicitement configurées pour le développement.
- Secrets exclusivement dans l'environnement serveur ou un gestionnaire de secrets.
- Requêtes SQL paramétrées ; aucune concaténation de valeurs utilisateur.
- Validation de taille et type MIME des photos ; noms de fichiers générés côté serveur ; pas de chemin contrôlé par l'utilisateur.
- Limites de taille du body, timeouts HTTP et limites de pagination.
- Audit des actions financières, suppressions/annulations, changements de paramètres, restauration et authentification.
- Aucun endpoint de remise à zéro ou de restauration ne doit être public.

## Exploitation

- `GET /healthz` confirme que le processus Go est vivant.
- `GET /readyz` vérifie que le backend peut accéder à sa base.
- Arrêt HTTP gracieux et fermeture correcte du pool PostgreSQL.
- Logs structurés sans PIN, cookie, token ni données personnelles inutiles.
- Sauvegarde PostgreSQL documentée et procédure de restauration testée.
- Docker Compose de développement avec backend et PostgreSQL ; aucun serveur Express requis.
- Configuration par variables d'environnement documentées dans `backend/.env.example` sans secrets réels.

## Critère final

L'application est considérée comme migrée lorsque toutes les opérations métier sont exécutées et validées côté Go, les données historiques ont une procédure de migration vérifiée, l'interface React continue à fonctionner, le mode hors ligne est conservé via cache/outbox, les tests passent et le backend peut démarrer sans Node.js.

---

# 6. LES 10 PROMPTS AUTONOMES ET SÉQUENTIELS

> Utiliser chaque prompt séparément. Ne pas fusionner les phases et ne pas demander à l'agent de sauter une étape pour « aller plus vite ».

---

## PROMPT 01/10 — Audit intégral et cartographie fonctionnelle du projet

```text
Tu es un architecte logiciel senior, spécialiste de Go, React, TypeScript, PostgreSQL, PWA et migration d'applications métier vers une architecture backend professionnelle.

PROJET
Dépôt : https://github.com/ErwinssKoffi/press_Buand_app.git
Branche de référence : main
Application : Éclat Pressing, logiciel de gestion de pressing et blanchisserie en Côte d'Ivoire.

OBJECTIF GLOBAL
Nous allons remplacer progressivement la logique de stockage et les règles métier actuellement exécutées dans le navigateur par un backend exclusivement écrit en Golang. Le frontend React 19 / TypeScript / Vite doit être conservé. L'application doit garder ses fonctionnalités actuelles, ses contrats de données utiles, son interface et son mode PWA hors ligne.

MISSION DE CETTE PHASE
Effectuer un audit approfondi et factuel du dépôt. Ne commence aucune migration et ne supprime aucun fichier. Tu dois comprendre le fonctionnement réel avant de proposer une architecture.

TRAVAUX OBLIGATOIRES
1. Examiner l'arborescence complète, package.json, bun.lock, vite.config.ts, .env.example, tsconfig.json, index.html, tous les fichiers `src/` et les assets utiles.
2. Lire intégralement `src/db/localDb.ts`, `src/types/pressing.ts`, `src/App.tsx`, les composants et utilitaires qui utilisent ou modifient des données.
3. Rechercher toutes les opérations IndexedDB, les fonctions de persistance, les calculs financiers, la génération de tickets, les règles de statut, les flux de paiement, les opérations de stock, les backups, les appels externes et les secrets.
4. Vérifier l'utilisation effective de `express`, `tsx`, `@google/genai`, `dotenv`, `idb`, `jsPDF` et toute dépendance potentiellement liée à un ancien backend. Ne déduis pas qu'un package est inutile uniquement à partir de son nom.
5. Cartographier toutes les pages, composants, hooks, types, fonctions de données, règles métier, et leur dépendance entre elles.
6. Identifier précisément le parcours : onboarding, création/connexion par PIN, création client, dépôt, calcul du total, paiement initial, ticket, changement de statut, encaissement du solde, livraison, recharge prépayée, fidélité, caisse, inventaire, sauvegarde et restauration.
7. Vérifier comment les photos de réserves sont compressées, stockées et affichées.
8. Examiner le comportement PWA et Workbox : quelles ressources sont cachées, comment les appels API pourraient être traités, et quelles régressions hors ligne sont à éviter.
9. Repérer les règles problématiques ou incohérentes : suppression de commandes et paiements, paiements supérieurs au solde, stock négatif, reset de données, compteur de tickets, fallback de hash PIN, et opérations non transactionnelles.
10. Exécuter les vérifications disponibles sans modifier les données réelles : build frontend, lint/typecheck et tests existants. Noter clairement tout outil manquant.

LIVRABLES À CRÉER
Créer `docs/migration/01-current-state-audit.md` avec :
- résumé exécutif ;
- architecture actuelle et arborescence pertinente ;
- inventaire exhaustif des modules et parcours ;
- inventaire des entités et champs ;
- tableau des fonctions de `localDb.ts` et de leur rôle ;
- matrice « fonction actuelle → futur domaine Go → endpoint probable » ;
- diagramme Mermaid de l'architecture existante ;
- flux métier détaillés ;
- risques et dettes techniques priorisés (critique/élevé/moyen/faible) ;
- dépendances à conserver, remplacer ou potentiellement retirer ;
- stratégie de conservation des données ;
- liste des inconnues qui nécessitent une décision ;
- résultats réels des commandes de validation.

CONTRAINTES
- Aucune modification fonctionnelle à ce stade.
- Aucune suppression de code ou de package.
- Ne fabrique aucune fonctionnalité qui n'existe pas.
- Cite les chemins et noms de fonctions réels dans le rapport.
- Distingue les faits confirmés, les hypothèses et les recommandations.
- Si un fichier est trop volumineux, lis-le par sections jusqu'à l'avoir couvert.

CRITÈRES D'ACCEPTATION
Le rapport permet à un autre développeur de comprendre le fonctionnement et les risques du projet sans devoir deviner. Tous les modules existants sont couverts. Les risques de perte de données et de régression offline sont clairement identifiés. Aucun code fonctionnel n'a été changé.

À LA FIN
Présente le rapport créé, les commandes exécutées, les constats essentiels et les points bloquants. N'entame pas le Prompt 02 automatiquement.
```

---

## PROMPT 02/10 — Architecture cible, modèle de données et contrat API

```text
Tu es un architecte backend Go senior chargé de concevoir une migration robuste d'Éclat Pressing.

CONTEXTE DU DÉPÔT
`ErwinssKoffi/press_Buand_app`, branche de travail dédiée. Le frontend actuel est React 19 / TypeScript / Vite / PWA. La persistance actuelle s'appuie sur IndexedDB dans `src/db/localDb.ts`. Nous voulons un backend applicatif exclusivement en Go, PostgreSQL comme base centrale, et conserver un cache local avec synchronisation hors ligne.

PRÉREQUIS
Lire `docs/migration/01-current-state-audit.md` créé au Prompt 01. Relire les sources originales concernées lorsqu'un détail est ambigu. Ne pas supposer que le rapport remplace le code.

MISSION
Concevoir l'architecture détaillée et figer les contrats backend/frontend avant l'implémentation. Cette phase peut créer les documents de conception et les contrats OpenAPI, mais ne migre pas encore les fonctionnalités métier.

DÉCISIONS D'ARCHITECTURE
- Backend monolithe modulaire en Go.
- HTTP REST JSON versionné sous `/api/v1`.
- PostgreSQL comme source centrale de vérité.
- Frontend React conservé.
- IndexedDB conservé pour cache et outbox offline.
- Pas de microservices.
- Pas de serveur Express ou Node.
- `net/http` + `chi` ou une alternative Go équivalente, justifiée.
- `pgx/v5` pour PostgreSQL.
- Montants en entiers XOF/FCFA, jamais en float.
- DTO JSON en camelCase compatibles avec le frontend.

TRAVAUX OBLIGATOIRES
1. Définir les frontières des domaines : auth, settings, catalog, clients, orders, payments/wallet, cashbook, logistics, inventory, reports, backup, sync, audit.
2. Définir les couches et dépendances : domain, service/use cases, repository, handler, middleware et infrastructure.
3. Produire le modèle relationnel PostgreSQL complet : tables, colonnes, types, contraintes, clés étrangères, index, uniques, suppressions et historique.
4. Décider comment stocker `IntakePhoto` sans exposer les fichiers publiquement. Prévoir limites, validation MIME et stratégie de migration des anciens data URLs.
5. Séparer les secrets PIN/session des paramètres métier exposés au frontend.
6. Définir les règles transactionnelles : création commande + paiement initial + compteur ticket + compte prépayé + fidélité ; paiement complémentaire ; recharge ; entrée/sortie/ajustement de stock ; clôture livraison liée à une commande ; restauration backup.
7. Définir l'authentification selon le contexte réel. Le PIN 5 chiffres existant peut servir de verrou local, mais ne doit pas être considéré comme une sécurité suffisante pour une API ouverte à Internet. Prévoir limitation des tentatives, sessions révocables et transition du hash legacy.
8. Définir le protocole de synchronisation offline : deviceId, operationId UUID, idempotence, ordre des dépendances, conflits, ticket provisoire, mapping vers ticket officiel, pull cursor/version et réconciliation.
9. Définir les comportements en cas de conflit de tarif ou de paramétrage modifié alors que le terminal était hors ligne. Ne pas laisser le frontend imposer un total final non validé.
10. Définir l'API avec méthodes, routes, schémas de requête/réponse, codes HTTP, erreurs, pagination, permissions et idempotency keys.
11. Définir les conventions de date, fuseau horaire, devise et arrondis.
12. Définir les versions de backup : compatibilité avec le JSON existant `version: 3`, validations et procédure de restauration.

LIVRABLES
Créer :
- `docs/migration/02-target-architecture.md`
- `docs/migration/02-data-model.md`
- `docs/migration/02-api-contract.md`
- `docs/migration/openapi.yaml`
- diagrammes Mermaid : architecture cible, entités/relations, création commande/paiement, synchronisation offline.

CONTRAINTES
- Ne code pas encore tous les endpoints.
- Ne change pas l'UI.
- Ne supprime pas IndexedDB.
- Documente toutes les décisions qui modifient une règle existante.
- Pour toute incertitude, reviens au code source et marque ce qui ne peut pas être confirmé.

CRITÈRES D'ACCEPTATION
Un développeur Go et un développeur frontend peuvent implémenter chacun leur partie sans ambiguïté sur les payloads, les règles métier, les transactions ou le mode offline. OpenAPI est syntaxiquement valide. Le modèle couvre toutes les entités réellement utilisées.

À LA FIN
Fournis un résumé des décisions, les chemins créés, les risques résiduels et les éventuelles décisions produit nécessaires. N'entame pas le Prompt 03.
```

---

## PROMPT 03/10 — Initialisation du backend Go et infrastructure PostgreSQL

```text
Tu es un ingénieur backend Go senior. Tu dois mettre en place le socle technique de production du backend d'Éclat Pressing, sans encore déplacer toutes les règles métier.

CONTEXTE
Dépôt `ErwinssKoffi/press_Buand_app`. Le frontend React/TypeScript/Vite existe déjà. Le backend doit être exclusivement Go. PostgreSQL est la base centrale. L'application doit conserver son mode offline frontend.

PRÉREQUIS
Lire attentivement :
- `docs/migration/01-current-state-audit.md`
- `docs/migration/02-target-architecture.md`
- `docs/migration/02-data-model.md`
- `docs/migration/02-api-contract.md`
- `docs/migration/openapi.yaml`

MISSION
Créer un backend Go exécutable, configurable, testable et capable de se connecter à PostgreSQL. Construire les migrations de schéma initiales validées par le modèle cible. Ne migre pas encore toutes les règles métier ni le frontend.

TRAVAUX OBLIGATOIRES
1. Vérifier la version stable de Go disponible dans l'environnement et initialiser `backend/go.mod` avec une version compatible. Ne pas choisir une version expérimentale.
2. Créer la structure modulaire prévue dans l'architecture cible, sans ajouter des abstractions inutiles.
3. Créer le point d'entrée `backend/cmd/api/main.go`.
4. Implémenter le chargement et la validation de configuration : adresse HTTP, environnement, URL/base PostgreSQL, pool, timeouts, chemins de stockage, origines CORS et paramètres de cookie.
5. Refuser le démarrage si une variable obligatoire est absente ou invalide. Ne jamais afficher les secrets dans les logs.
6. Configurer `pgx/v5`, pool de connexions, ping de readiness, fermeture propre.
7. Installer un gestionnaire de migrations versionnées. Les migrations doivent être reproductibles, transactionnelles quand possible et adaptées à PostgreSQL.
8. Créer `GET /healthz` et `GET /readyz` avec des réponses JSON sobres. Health ne doit pas révéler de secret ; ready doit vérifier la base.
9. Ajouter `slog` structuré, request ID, méthode, chemin, code HTTP, durée et récupération des panic avec réponse 500 contrôlée.
10. Ajouter arrêt gracieux du serveur avec `context`, signal système et délai de shutdown.
11. Créer Dockerfile backend multi-stage et `docker-compose.yml` de développement avec PostgreSQL et backend. Ne pas inclure Node comme serveur.
12. Créer `backend/.env.example` documenté sans secret réel.
13. Ajouter les premières migrations de tables et index définis au Prompt 02. Ajouter contraintes, valeurs par défaut et relations nécessaires.
14. Ajouter un mécanisme de seed uniquement pour une installation vierge. Ne jamais écraser des paramètres, catalogue ou données existantes au redémarrage.
15. Si Gemini est réellement utilisé, préparer uniquement la configuration serveur `GEMINI_API_KEY` ; ne pas exposer cette clé au frontend. Ne crée pas d'intégration fictive.
16. Mettre à jour les scripts de développement/documentation sans casser les commandes Vite actuelles.

TESTS OBLIGATOIRES
- tests unitaires de parsing de configuration ;
- tests du handler health ;
- test de readiness avec base PostgreSQL de test ;
- test d'application/rollback des migrations ;
- vérification qu'un second démarrage ne reseed pas les données ;
- `go test ./...` ;
- vérification Docker Compose si l'environnement le permet.

CONTRAINTES
- Pas d'Express.
- Pas de serveur TypeScript ou JavaScript.
- Pas de logique métier laissée dans un fichier `main.go`.
- Ne touche pas à l'UI.
- Ne supprime pas les dépendances du frontend sans preuve d'inutilité.
- Ne stocke aucun secret dans Git.

CRITÈRES D'ACCEPTATION
Le backend Go compile et démarre ; les migrations peuvent créer la base de test ; `/healthz` et `/readyz` répondent correctement ; le shutdown ferme le pool ; le frontend existant continue de compiler indépendamment.

À LA FIN
Fournis les commandes de lancement local, les variables nécessaires, les tests passés/échoués et les fichiers principaux créés. Ne commence pas le Prompt 04.
```

---

## PROMPT 04/10 — Authentification, sessions et sécurité serveur

```text
Tu es un ingénieur Go spécialisé en sécurité applicative, authentification et protection des données métier.

CONTEXTE
Backend Go en cours de création dans `backend/`. Lis les rapports de migration et l'architecture cible. L'application existante a un écran de connexion avec un PIN à cinq chiffres, un hash SHA-256 salé dans `src/utils/pinAuth.ts`, un compteur d'échecs côté navigateur et une fonction de réinitialisation du PIN. Ce mécanisme est actuellement local et ne doit pas être copié aveuglément comme sécurité serveur.

PRÉREQUIS
Lire les documents `docs/migration/01-current-state-audit.md`, `docs/migration/02-target-architecture.md`, `docs/migration/02-api-contract.md`, ainsi que le code exact de LoginView, SettingsView et pinAuth.

MISSION
Implémenter un mécanisme d'accès sécurisé au backend Go adapté au mode de déploiement retenu, avec sessions, limites de tentatives, séparation des secrets et endpoints cohérents avec OpenAPI.

TRAVAUX OBLIGATOIRES
1. Déterminer à partir de l'audit si le projet est mono-poste local, réseau local ou destiné à être exposé à distance. Documenter la posture de sécurité pour chacun.
2. Séparer les credentials de la table `shop_settings`. Aucun champ `pinHash`, `pinSalt`, mot de passe ou token ne doit être renvoyé par les endpoints de configuration.
3. Implémenter le setup initial protégé : une installation vierge doit pouvoir créer le credential du propriétaire/opérateur sans route de création publique permanente.
4. Implémenter login, logout, session courante et changement du secret selon le contrat API.
5. Utiliser Argon2id pour le secret utilisateur quand applicable. Paramètres de coût documentés et configurables raisonnablement. Ajouter une comparaison sûre.
6. Si la compatibilité legacy est requise, reproduire en Go le hash SHA-256 historique uniquement dans une fonction de migration isolée, avec tests basés sur les vecteurs exacts du code actuel. Après une authentification réussie, re-hasher immédiatement en Argon2id. Ne jamais conserver le fallback non cryptographique comme credential serveur.
7. Pour un déploiement public, exiger un secret plus robuste qu'un PIN numérique à cinq chiffres. Le PIN historique peut rester une étape de verrouillage d'interface, mais ne doit pas être le seul facteur d'accès distant.
8. Utiliser une session opaque, aléatoire et révocable. Stocker côté base uniquement un hash du token de session lorsque cela est approprié. Prévoir expiration, révocation, rotation et invalidation au logout.
9. Si cookie : `HttpOnly`, `SameSite=Lax` ou plus strict selon le flux, `Secure` obligatoire en HTTPS production, protection CSRF sur mutations et CORS strict. En local HTTP, documenter l'exception sans l'activer en production.
10. Ajouter rate limiting login, délai progressif/lockout persistant, messages d'erreur qui ne révèlent pas si un secret précis est correct, et audit des connexions.
11. Protéger chaque route métier par middleware et autorisation. Créer une politique claire pour les routes publiques (health uniquement, setup initial conditionnel).
12. Ajouter en-têtes de sécurité, limites de taille, timeouts, validation stricte des payloads et prévention des fuites de secrets.
13. Rédiger une menace simplifiée : vol du poste, accès LAN, API exposée, vol de cookie, brute force PIN, export backup, accès photo.

TESTS OBLIGATOIRES
- setup autorisé une seule fois ;
- login valide/invalide ;
- lockout/rate-limit ;
- expiration et révocation de session ;
- changement de secret ;
- migration de hash legacy avec vecteurs de test ;
- refus d'accès anonyme aux endpoints métier ;
- refus des origines CORS non autorisées ;
- absence des hashes dans les réponses settings ;
- tests CSRF si cookie.

LIVRABLES
Code Go, migrations additionnelles, tests, OpenAPI mise à jour et `docs/migration/04-auth-security.md`.

CONTRAINTES
- Aucune clé ou valeur par défaut faible codée en dur.
- Aucune session dans localStorage.
- Aucun PIN, mot de passe, token ou cookie dans les logs.
- Ne pas considérer qu'un PIN 5 chiffres est acceptable sur Internet.
- Ne pas casser l'onboarding sans fournir un chemin de transition frontend au Prompt 08.

CRITÈRES D'ACCEPTATION
Toutes les routes métier sont protégées ; les secrets ne sont jamais exposés ; les tests d'authentification et de limitation passent ; le comportement legacy est documenté ; une installation neuve et une migration depuis l'ancien PIN disposent chacune d'un parcours sécurisé.

À LA FIN
Décris les routes d'auth, les variables de configuration, les limites connues et les tests. N'entame pas le Prompt 05.
```

---

## PROMPT 05/10 — Migration des règles métier vers les services Go

```text
Tu es un architecte et développeur Go senior, expert en applications de caisse, gestion commerciale, transactions financières et stocks.

CONTEXTE
Projet Éclat Pressing. Le stockage historique et les règles métier sont actuellement majoritairement dans `src/db/localDb.ts`. Le modèle de référence est `src/types/pressing.ts`. Le backend Go, PostgreSQL, l'architecture et l'authentification ont été initialisés dans les phases précédentes.

PRÉREQUIS
Lire tous les documents `docs/migration/01-*`, `02-*`, `04-*`, les migrations SQL, le code de `backend/` et relire chaque fonction métier source dans `src/db/localDb.ts`. Ne pas se fier uniquement aux noms de fonctions.

MISSION
Déplacer les règles métier dans des services Go testables, indépendants de HTTP et de PostgreSQL. Les repositories peuvent être utilisés derrière des interfaces. Le résultat doit conserver les comportements utiles et corriger explicitement les risques documentés.

DOMAINES À IMPLÉMENTER
1. Paramètres et configuration d'activité : pressing, blanchisserie ou les deux ; normalisation et valeurs par défaut.
2. Catalogue : catégories, modes, unités, prix, activation et délais.
3. Clients : création, mise à jour, recherche, suppression/archivage et historique.
4. Portefeuille prépayé : recharge, bonus, consommation, historique et abonnements éventuels.
5. Tarification pressing : pièce, kilo, offres au poids, modes de service, tarif express fixe ou pourcentage.
6. Tarification blanchisserie : services activés, unité, packs personnalisables et tarifs.
7. Commandes : lignes, dates, casier, photos, remises, livraison, frais express, statut, total et séquence ticket.
8. Paiements : paiement initial, acompte, solde, paiement intégral, moyen de règlement et solde restant.
9. Fidélité : points gagnés, points utilisés, seuil et récompense configurés.
10. Caisse et dépenses : agrégats par jour/mois, moyens de paiement et rapports Z.
11. Logistique : enlèvement, livraison, changement de statut et effet sur la commande liée.
12. Inventaire : création, ajustement, entrée, sortie, quantité, seuil, coût, fournisseur et alertes.
13. Entrée de stock avec création automatique d'une dépense si `recordExpense` est activé.
14. Backup : validation du schéma et règles de restauration sans perte silencieuse.

RÈGLES CRITIQUES
- Tous les montants restent des entiers FCFA (`int64`/`BIGINT`). Vérifier overflow, nombres négatifs et valeurs aberrantes.
- Ne jamais faire confiance au `totalFCFA`, `paidFCFA`, `prepaidUsedFCFA`, `loyaltyPointsEarned` ou aux champs de solde envoyés par le navigateur. Le serveur doit recalculer ou vérifier.
- La commande, la séquence ticket, le paiement initial, le compte prépayé et les points fidélité doivent être traités atomiquement.
- Le compteur ticket doit être verrouillé en base et unique, même avec plusieurs requêtes simultanées.
- Un paiement répété doit être idempotent et ne doit jamais encaisser deux fois.
- Un paiement supérieur au solde doit être rejeté ou géré selon une règle explicitement documentée ; ne pas tronquer silencieusement une somme encaissée.
- Une sortie de stock supérieure au disponible doit suivre une règle validée et testée ; ne pas créer une quantité négative.
- Une livraison terminée met à jour la commande correspondante dans la même transaction.
- Les annulations/suppressions financières doivent conserver une trace ; ne pas supprimer l'historique de paiement en cascade.
- Les seeds ne doivent être appliqués qu'à l'installation vierge.
- Toute mutation sensible doit produire un historique/audit.

STRUCTURE ATTENDUE
Créer les modèles domaine et services/use cases par module. Les services ne doivent pas importer `net/http` ni dépendre directement des types de requêtes HTTP. Définir les interfaces nécessaires et des erreurs métier typées.

TESTS OBLIGATOIRES
- tests de tarification à la pièce, au kilo, express et blanchisserie ;
- tests d'arrondi et valeurs limites ;
- commande avec paiement intégral, acompte, prépayé et points ;
- deux créations de commande simultanées : numéros uniques ;
- double soumission idempotente ;
- paiement de solde et surpaiement ;
- recharge et bonus avec historique ;
- mouvement stock entrée/sortie/ajustement et création de dépense ;
- livraison terminée et statut commande ;
- annulation avec conservation de l'audit et du journal financier.

LIVRABLES
- Services Go et types domaine complets ;
- repositories requis ;
- migrations complémentaires si elles sont justifiées ;
- tests unitaires et intégration ;
- `docs/migration/05-business-rules.md` avec tableau de parité ancien/nouveau, règles conservées, règles corrigées et décisions.

CONTRAINTES
- Ne pas déplacer ces règles dans les handlers.
- Ne pas laisser des calculs financiers autoritatifs dans le frontend.
- Ne pas réécrire les composants React à cette phase.
- Toute différence de comportement par rapport au code actuel doit être signalée et couverte par un test.

CRITÈRES D'ACCEPTATION
Les principaux cas métier sont entièrement exécutables à travers les services Go avec tests. Toutes les écritures financières et de stock utilisent des transactions. Aucun service critique ne dépend du navigateur.

À LA FIN
Présente les services, règles migrées, règles volontairement corrigées, résultats des tests et éventuels domaines encore incomplets. N'entame pas le Prompt 06.
```

---

## PROMPT 06/10 — API REST Go complète et documentation OpenAPI

```text
Tu es un développeur backend Go senior spécialisé dans la conception d'API REST robustes et versionnées.

CONTEXTE
Le backend Go d'Éclat Pressing possède désormais son socle, sa base PostgreSQL, son authentification et ses services métier. Le frontend React/TypeScript doit les consommer via HTTP JSON.

PRÉREQUIS
Lire les documents de migration, `docs/migration/openapi.yaml`, les services domaine, les DTO et l'ensemble des règles métier du Prompt 05.

MISSION
Exposer toutes les fonctionnalités métier via une API REST `/api/v1` sécurisée, cohérente, documentée et testée. Les handlers doivent rester fins et déléguer les opérations aux services Go.

TRAVAUX OBLIGATOIRES
1. Implémenter toutes les routes définies au contrat : auth, bootstrap, settings, catalog, clients, wallet, orders, payments, expenses, reports, delivery zones, logistics, inventory, backup et sync (les routes de sync peuvent être préparées ici et finalisées au Prompt 09).
2. Définir les DTO d'entrée et de sortie, séparés des modèles de persistance. Respecter camelCase et les valeurs d'enum nécessaires au frontend.
3. Valider chaque paramètre, corps JSON, identifiant, enum, montant, date et taille de champ. Rejeter les champs invalides avec une erreur utile.
4. Implémenter pagination, tri et filtres pour les listes. Éviter de charger toute la base à chaque changement d'écran.
5. Appliquer authentification et permissions à toutes les routes protégées.
6. Gérer CORS, CSRF si applicable, request ID, timeouts, limites du body et headers de sécurité.
7. Créer un format d'erreur stable, par exemple `{ "error": { "code": "...", "message": "...", "details": {} } }`.
8. Distinguer `400`, `401`, `403`, `404`, `409`, `422`, `429` et `500` de manière cohérente.
9. Gérer les clés d'idempotence pour les créations sensibles : commandes, paiements, recharges et mouvements stock.
10. Produire/mettre à jour OpenAPI à partir du comportement réel. Toutes les routes et payloads doivent y figurer.
11. Ajouter des exemples réalistes en FCFA, sans données personnelles ni secrets.
12. Ajouter une route bootstrap qui permet au frontend de récupérer les données de démarrage nécessaires, avec pagination ou découpage si le volume augmente.
13. Protéger l'accès aux photos et aux fichiers d'export : aucun chemin local ne doit être exposé directement.
14. Ajouter des logs de requête sans données sensibles.

TESTS OBLIGATOIRES
Pour chaque domaine : tests HTTP des cas succès, validation, absence d'auth, permissions, ressource introuvable et erreur métier. Tester idempotence et conflits HTTP. Tester que les DTO publics n'exposent aucun hash de credential. Tester OpenAPI et cohérence des routes.

LIVRABLES
- API complète dans les packages HTTP ;
- `docs/migration/openapi.yaml` mis à jour ;
- exemples curl ou collection HTTP dans `docs/api/` ;
- `docs/migration/06-api-implementation.md` ;
- tests d'intégration HTTP.

CONTRAINTES
- Aucun endpoint ne doit exécuter directement du SQL dans le handler.
- Ne pas implémenter un faux endpoint avec données codées en dur.
- Pas de serveur Express/Node.
- Respecter le contrat frontend existant lorsque cela est possible ; documenter tout breaking change et fournir l'adaptateur prévu au Prompt 08.

CRITÈRES D'ACCEPTATION
Chaque action métier existante dispose d'un endpoint opérationnel et protégé. OpenAPI décrit exactement l'API livrée. Les tests couvrent les réponses et les erreurs importantes. Le frontend peut être branché sans appeler directement PostgreSQL ni IndexedDB pour les données centrales en ligne.

À LA FIN
Fournis le tableau routes/statut/tests et les commandes pour démarrer l'API. N'entame pas le Prompt 07.
```

---

## PROMPT 07/10 — Migration des données IndexedDB et sauvegardes JSON

```text
Tu es un ingénieur Go spécialisé en migration de données, reprise après incident et compatibilité de versions.

CONTEXTE
Éclat Pressing dispose actuellement d'une base IndexedDB locale `eclat_pressing_ci_v1`, version repérée 3. Le frontend exporte un `DatabaseBackup` JSON contenant settings, clients, catalogue, commandes, paiements, dépenses, zones, logistique, stock et mouvements. Le backend Go/PostgreSQL existe maintenant.

PRÉREQUIS
Lire le modèle TypeScript réel, `src/db/localDb.ts` en entier, les documents de migration, les tables PostgreSQL, les services et les DTO API. Lire aussi les exemples de backup réellement exportés s'ils sont disponibles dans le dépôt ou fournis par l'utilisateur. Ne jamais inventer de fichier backup absent.

MISSION
Mettre en place un parcours de migration fiable depuis les données locales de l'ancienne version vers PostgreSQL, tout en conservant le backup JSON et la possibilité de restaurer une sauvegarde.

TRAVAUX OBLIGATOIRES
1. Documenter l'ancien format `DatabaseBackup` version 3, les propriétés obligatoires/facultatives et les valeurs par défaut réellement utilisées.
2. Créer un parseur/importeur Go compatible avec la sauvegarde legacy. Prévoir validation stricte, taille maximum, erreurs par champ et contrôle des relations.
3. Créer un endpoint de prévisualisation qui valide la sauvegarde et retourne le nombre de lignes qui seront créées/mises à jour, les doublons, les anomalies et les incompatibilités sans rien modifier.
4. Créer une procédure de confirmation de restauration protégée. Créer une sauvegarde serveur avant restauration si possible. Effectuer la restauration atomiquement ou avec stratégie de staging/commit qui évite une base partiellement restaurée.
5. Préserver les IDs historiques quand ils sont uniques et correctement formés. Détecter les collisions sans écraser arbitrairement.
6. Préserver les dates, montants FCFA, statuts, références client/commande et historique de wallet.
7. Traiter les photos : décoder les data URLs autorisées, vérifier MIME et taille, stocker les fichiers dans un stockage privé, lier leurs métadonnées aux commandes et préserver les légendes.
8. Migrer le PIN legacy selon la stratégie du Prompt 04. Ne jamais exposer ni exporter les hash dans les paramètres publics.
9. Éviter l'import des données de démonstration par-dessus des données réelles. Bien distinguer un backup réel et un seed d'installation vierge.
10. Garantir qu'un même backup ne crée pas de doublons lors d'une reprise après interruption. Enregistrer un identifiant ou hash d'import et son statut.
11. Conserver un export JSON compatible avec les champs attendus par la version frontend actuelle pendant la période de transition.
12. Créer un rapport de migration : totals source, créés, mis à jour, ignorés, médias importés, erreurs et date.
13. Prévoir un chemin utilisateur clair : exporter depuis l'ancienne application, ouvrir la nouvelle, importer/prévisualiser, confirmer, vérifier, conserver l'export original.
14. Ne pas supprimer automatiquement les données IndexedDB une fois transférées. La suppression éventuelle est une action explicite post-vérification.

TESTS OBLIGATOIRES
- import backup v3 valide ;
- propriétés facultatives absentes ;
- JSON mal formé ;
- ID en doublon ;
- relation cassée ;
- photo invalide ou trop volumineuse ;
- PIN absent et PIN legacy ;
- restauration interrompue/rollback ;
- import du même backup deux fois ;
- vérification des totaux et montants après migration ;
- export puis réimport sans perte de données.

LIVRABLES
- import/export Go ;
- endpoints preview/restore/export ;
- tests et fixtures synthétiques non sensibles ;
- `docs/migration/07-data-migration.md` avec procédure pas à pas de migration d'une installation existante.

CONTRAINTES
- Ne jamais écraser sans prévisualisation et confirmation.
- Ne jamais effacer la source locale automatiquement.
- Ne jamais afficher de secret dans un rapport.
- Ne pas introduire de données fictives.

CRITÈRES D'ACCEPTATION
Une sauvegarde legacy v3 est reconnue, prévisualisée, restaurée et exportée sans perte des informations métier prises en charge. L'import est idempotent ou refuse proprement un doublon. Toute anomalie est expliquée avant confirmation.

À LA FIN
Présente la procédure utilisateur exacte, les versions compatibles, le rapport des tests et les limitations résiduelles. N'entame pas le Prompt 08.
```

---

## PROMPT 08/10 — Connexion du frontend React au backend Go

```text
Tu es un ingénieur frontend senior React/TypeScript qui sait intégrer proprement une API Go sans dégrader une interface métier existante.

CONTEXTE
Éclat Pressing possède un frontend React 19 / TypeScript / Vite avec composants déjà développés. Jusqu'ici, App.tsx appelle directement des fonctions de `src/db/localDb.ts` pour lire et écrire dans IndexedDB. Le backend Go expose désormais `/api/v1`, avec PostgreSQL, authentification et import/export JSON.

PRÉREQUIS
Lire :
- l'audit initial et l'architecture cible ;
- OpenAPI réelle ;
- tous les composants utilisant les fonctions de `localDb.ts` ;
- les services Go, les DTO et le parcours de migration de données.

MISSION
Remplacer progressivement l'accès direct aux données centrales par une couche de services API TypeScript qui consomme le backend Go, tout en conservant les composants, l'ergonomie et la PWA. Ne réécris pas l'application entière.

TRAVAUX OBLIGATOIRES
1. Créer un client HTTP typé centralisé dans `src/services/api/` : base URL configurable, credentials de session, timeout, parsing d'erreurs, request ID si nécessaire et gestion des réponses JSON.
2. Créer des modules API par domaine : auth, bootstrap, settings, catalog, clients, orders, payments, expenses, logistics, inventory, reports et backup.
3. Générer ou synchroniser les types TypeScript depuis OpenAPI si le workflow est stable ; sinon maintenir des DTO explicites et documenter leur source. Ne pas dupliquer des interfaces divergentes.
4. Remplacer les appels directs à `localDb.ts` dans `App.tsx` et les composants par des hooks/services API ou un repository frontend propre.
5. Préserver les signatures et composants visuels autant que possible. Le but est une migration de persistance, pas une refonte UI.
6. Adapter LoginView et SettingsView au flux d'authentification serveur. Le PIN ou mot de passe ne doit pas être stocké en clair, ni les tokens dans localStorage.
7. Adapter l'onboarding et le bootstrap pour une première installation serveur vierge.
8. Garder IndexedDB pour cache/local fallback ; définir clairement quelles données sont en cache et lesquelles sont uniquement modifiables via API en ligne à ce stade.
9. Adapter les états loading, error, empty, offline et retry pour chaque écran.
10. Préserver l'export/import de sauvegarde via les endpoints Go et garder la compatibilité avec le fichier JSON attendu.
11. Adapter la récupération des photos à la stratégie privée définie par le backend.
12. Vérifier que les PDF/tickets/exports frontend continuent de fonctionner avec les DTO fournis par Go. Ne déplacer leur génération côté serveur que si l'architecture l'exige réellement.
13. Configurer Vite pour le développement local : frontend sur son port habituel, backend sur un port distinct et proxy `/api` adapté. En production, prévoir un déploiement same-origin ou une configuration CORS stricte.
14. Examiner le service worker : ne jamais mettre en cache des réponses privées de session comme des ressources publiques ; les mutations API ne doivent pas être servies depuis le cache.
15. Garder l'ancienne base IndexedDB intacte le temps de la migration ; ne retirer ses fonctions qu'après vérification qu'elles ne sont plus appelées et que les données ont été migrées.
16. Rechercher dans tout `src/` les imports restants de `localDb.ts` et classer ceux qui servent encore au cache/offline, aux valeurs par défaut ou à des règles métier qui doivent être déplacées.

TESTS ET VALIDATIONS
- build Vite ;
- `tsc --noEmit` ou script de lint/typecheck du projet ;
- tests du client API et des erreurs HTTP ;
- tests composants critiques avec réponses API mockées ;
- vérification manuelle des parcours onboarding, login, création client, dépôt, ticket, paiement, commande, inventaire, caisse, logistique, paramètres et sauvegarde ;
- vérification absence de hash/secret dans le bundle ;
- recherche de tout accès réseau direct non centralisé.

CONTRAINTES
- Ne change pas inutilement le design.
- Ne supprime pas encore le mode offline.
- Ne laisse pas le frontend calculer une valeur financière finale autoritative.
- Ne crée aucun endpoint fictif.
- Pas de backend Node/Express.

CRITÈRES D'ACCEPTATION
En ligne, les opérations de l'interface passent par l'API Go et sont persistées dans PostgreSQL. L'application reste visuellement et fonctionnellement proche de la version existante. Les erreurs API sont traitées. Le build frontend réussit. Les anciens accès IndexedDB sont justifiés et listés.

À LA FIN
Fournis la liste des écrans testés, des fonctions `localDb` restantes et leur raison d'exister. N'entame pas le Prompt 09.
```

---

## PROMPT 09/10 — Mode hors ligne, outbox et synchronisation fiable

```text
Tu es un architecte full-stack spécialisé en applications PWA offline-first, synchronisation distribuée, IndexedDB et APIs Go idempotentes.

CONTEXTE
Éclat Pressing doit fonctionner même lorsque la connexion Internet est coupée. L'ancienne application utilisait IndexedDB comme stockage opérationnel. Le frontend React est désormais connecté à un backend Go/PostgreSQL. Le backend est la source centrale en ligne, mais le terminal doit garder un cache local et accepter certaines opérations hors ligne.

PRÉREQUIS
Lire l'architecture, l'audit, le contrat API, les documents de migration de données et l'intégration frontend du Prompt 08. Lire les vrais flux de création commande, paiement, clients, stock et logistique.

MISSION
Implémenter un mécanisme de synchronisation offline-first fiable, explicite et testable. Ne jamais synchroniser par remplacement aveugle d'une base complète.

TRAVAUX OBLIGATOIRES — FRONTEND
1. Créer/faire évoluer le schéma IndexedDB avec des stores versionnés pour snapshot/cache, outbox, conflits, device metadata et curseur de synchronisation.
2. Générer un `deviceId` stable par installation et un `operationId` UUID distinct pour chaque opération.
3. Définir un modèle d'opération contenant type/version, payload, date locale, dépendances, statut (pending/sending/synced/conflict/failed), nombre de tentatives et dernier message d'erreur.
4. Ajouter un service de détection de connexion et un gestionnaire de synchronisation déclenché au retour online, au démarrage et par action utilisateur. Éviter les boucles réseau et les timers permanents inutiles.
5. Persister l'opération et la mutation locale de manière cohérente. Si la transaction IndexedDB échoue, ne pas montrer une confirmation trompeuse.
6. Continuer à afficher les données du cache quand l'API est inaccessible, avec indicateur clair de données locales et date de dernière synchronisation.
7. Permettre les opérations offline explicitement autorisées : création de client, brouillon/dépôt, et autres actions seulement si leur cohérence est assurée. Documenter les opérations qui exigent Internet.
8. Gérer l'ordre des dépendances : client avant commande si nécessaire, commande avant paiement complémentaire, article avant mouvement de stock, etc.
9. Afficher les opérations en attente, conflits et erreurs ; proposer une reprise sans perdre le payload original.
10. Maintenir les identifiants UUID provisoires et réconcilier les IDs/tickets officiels renvoyés par Go.
11. Afficher une référence provisoire clairement distinguée du ticket définitif si un ticket est généré hors ligne. Informer l'utilisateur lorsque la synchronisation a attribué le numéro officiel.
12. Préserver le service worker PWA pour les assets statiques, mais ne pas cacher des mutations API ou des données privées de manière dangereuse.

TRAVAUX OBLIGATOIRES — BACKEND GO
1. Implémenter `POST /api/v1/sync/push`, `GET /api/v1/sync/pull` et `GET /api/v1/sync/status` conformément au contrat.
2. Ajouter déduplication persistante par deviceId + operationId ou idempotency key.
3. Appliquer chaque commande via les mêmes services métier que les endpoints en ligne. Ne pas créer un second ensemble de règles métier pour le offline.
4. Traiter l'ordre des dépendances, les erreurs métier, les conflits de version et les commandes inconnues.
5. Retourner pour chaque opération un résultat stable : accepté, déjà appliqué, conflit ou rejet avec code et résolution attendue.
6. Générer le numéro de ticket officiel côté serveur dans une transaction.
7. Ne jamais accepter des totaux ou montants encaissés sans recalcul/validation serveur.
8. Prendre en compte la configuration tarifaire utilisée par le terminal au moment de l'opération. Si elle est trop ancienne ou incompatible, produire un conflit exploitable au lieu de recalculer silencieusement un tarif différent.
9. Établir une politique de résolution selon le type : fusion si sûr, acceptation idempotente, rejet avec intervention utilisateur, jamais « last write wins » pour les montants, paiements et stocks.
10. Ajouter pagination/cursor pour le pull des changements serveur et éviter de renvoyer toutes les données à chaque synchronisation.
11. Ajouter métriques/logs de sync sans données personnelles inutiles.

TESTS OBLIGATOIRES
- création offline puis sync ;
- client créé offline puis commande qui le référence ;
- timeout après écriture serveur puis retry (aucun doublon) ;
- double paiement soumis (aucun double encaissement) ;
- deux appareils créant des commandes simultanément (tickets officiels uniques) ;
- modification serveur et terminal offline sur la même ressource ;
- tarif modifié pendant l'absence de réseau ;
- appareil longtemps hors ligne ;
- interruption du navigateur pendant l'envoi ;
- corruption/ancienne version de l'outbox ;
- reprise manuelle après conflit ;
- absence d'écrasement de données récentes.

LIVRABLES
Code frontend + backend, migrations sync nécessaires, tests et `docs/migration/09-offline-sync.md` avec diagrammes des états et procédure de résolution des conflits.

CONTRAINTES
- Ne jamais supprimer une opération pending avant confirmation serveur.
- Ne jamais considérer `navigator.onLine` seul comme preuve qu'une API est joignable.
- Ne jamais faire de synchronisation destructive d'un snapshot complet.
- Ne jamais dupliquer les règles métier dans le frontend.

CRITÈRES D'ACCEPTATION
L'application peut être utilisée sur les parcours offline pris en charge, conserve les opérations après rechargement/fermeture, synchronise sans doublon lorsque la connexion revient, et présente clairement les conflits ou références provisoires. Les tests de concurrence et d'idempotence passent.

À LA FIN
Présente les scénarios offline couverts, ceux qui nécessitent une connexion, les tests effectués et les limites. N'entame pas le Prompt 10.
```

---

## PROMPT 10/10 — Audit final, tests de bout en bout, durcissement et préparation production

```text
Tu es un auditeur technique senior, ingénieur Go/React, expert QA, sécurité applicative et déploiement Docker.

CONTEXTE
Le projet Éclat Pressing a suivi les phases précédentes : audit, architecture, socle Go/PostgreSQL, authentification, services métier, API REST, migration de données, intégration frontend et synchronisation offline. Il doit maintenant être évalué comme un logiciel métier prêt à être utilisé en conditions réelles.

PRÉREQUIS
Lire tous les documents `docs/migration/`, les README backend/frontend, les migrations, le code Go, le frontend, les tests, Dockerfile et docker-compose. Ne pas supposer qu'un livrable est complet uniquement parce qu'il existe.

MISSION
Effectuer un audit final sans complaisance, corriger les défauts détectés, exécuter les tests pertinents et produire les procédures de lancement, sauvegarde, restauration et exploitation.

AUDIT FONCTIONNEL
Tester les parcours de bout en bout :
1. installation vierge, setup propriétaire/opérateur et connexion ;
2. onboarding établissement, activité pressing/blanchisserie/les deux ;
3. configuration catalogue, tarifs à la pièce, kilo, express, packs et fidélité ;
4. création client et modification ;
5. dépôt complet : sélection client, articles, photos de réserve, casier, dates, remise et livraison ;
6. calcul total et création ticket ;
7. paiement intégral, acompte, complément et moyens espèces/Wave/Orange Money/MTN/Moov ;
8. recharge prépayée, bonus et utilisation ;
9. cycle complet de statut reçu/lavage/repassage/prêt/livré ;
10. livraison terminée mettant à jour la commande ;
11. dépenses, rapports journaliers Z et rapports mensuels ;
12. inventaire, entrée, sortie, ajustement, seuil, historique et dépense automatique ;
13. sauvegarde, export, prévisualisation et restauration ;
14. migration d'un backup legacy version 3 ;
15. utilisation offline, fermeture navigateur, reconnexion, synchro, doublons et conflits.

AUDIT TECHNIQUE GO
- lancer `gofmt` sur tous les fichiers Go ;
- `go vet ./...` ;
- `go test ./...` avec couverture des packages critiques ;
- exécuter tests d'intégration PostgreSQL ;
- détecter les goroutines qui fuient, problèmes de context, timeouts et arrêt gracieux ;
- contrôler transactions, index, contraintes, requêtes N+1 et pagination ;
- vérifier les erreurs SQL et les logs ;
- vérifier que tous les handlers appellent les services ;
- vérifier que les services ne dépendent pas de HTTP ;
- vérifier qu'aucune logique métier autoritative n'est restée seulement dans React.

AUDIT FRONTEND/PWA
- installer avec le lockfile existant ;
- lint/typecheck et `vite build` ;
- vérifier les routes API et les erreurs ;
- tester le service worker, cache des assets et comportement API ;
- vérifier installation PWA et mise à jour ;
- vérifier que les composants visuels et PDF n'ont pas régressé ;
- rechercher tout appel IndexedDB qui contourne le repository/sync ;
- rechercher toute clé secrète, token ou donnée privée intégrée au bundle.

AUDIT SÉCURITÉ
- vérifier l'auth, l'expiration des sessions, logout, lockout, CSRF et CORS ;
- vérifier les permissions et routes d'administration ;
- vérifier injection SQL, validation JSON, tailles et uploads photos ;
- vérifier export et restore ;
- vérifier absence de secrets dans Git, logs, erreurs et réponses ;
- vérifier le stockage des photos et permissions de fichiers ;
- vérifier que l'API n'est pas exposée sans configuration explicite ;
- exécuter les outils de sécurité disponibles et expliquer les limites.

AUDIT EXPLOITATION
1. Vérifier Docker Compose propre depuis un environnement vierge.
2. Documenter variables, ports, volumes et ordre de démarrage.
3. Documenter migrations initiales et mises à jour.
4. Documenter stratégie de backup PostgreSQL, fréquence conseillée, rétention et restauration testée.
5. Documenter export applicatif JSON et différence avec un backup PostgreSQL.
6. Documenter mise à jour backend et frontend sans perte de données.
7. Documenter reverse proxy HTTPS pour un usage réseau/distant.
8. Documenter lancement local sans Docker si cela est supporté.
9. Décrire les logs, healthchecks et diagnostics courants.
10. Fournir un plan de retour arrière en cas d'échec de déploiement.

NETTOYAGE
- rechercher les anciennes dépendances serveur Node/Express ; retirer uniquement celles dont l'inutilité est prouvée ;
- retirer `src/db/localDb.ts` uniquement si toutes ses responsabilités ont été migrées ou remplacées par un repository local/cache utilisé et testé ;
- garder les utilitaires frontend encore nécessaires (formatage, PDF, affichage, compression, PWA) ;
- retirer les mocks, routes fictives, seeds accidentels et logs de debug ;
- conserver une compatibilité de données et une procédure d'import pour les anciens utilisateurs.

LIVRABLES FINAUX
Créer ou mettre à jour :
- `README.md` racine ;
- `backend/README.md` ;
- `docs/deployment/PRODUCTION.md` ;
- `docs/deployment/BACKUP-RESTORE.md` ;
- `docs/deployment/DATA-MIGRATION.md` ;
- `docs/qa/END-TO-END-ACCEPTANCE.md` ;
- `docs/migration/10-final-audit.md` ;
- `.env.example` non secret ;
- Dockerfile et docker-compose validés.

TABLEAU DE VALIDATION FINAL
Créer un tableau pour chaque module : fonctionnalité, source Go, endpoint, écran, test unitaire, test intégration, test E2E, état (PASS/FAIL/PARTIAL), risque restant.

CONTRAINTES
- Ne pas annoncer « prêt pour la production » si les tests ou procédures n'ont pas été exécutés.
- Ne pas supprimer les données réelles pour faire passer les tests.
- Ne pas déployer ni pousser les changements sans autorisation.
- Corriger les défauts bloquants identifiés avant de conclure ; pour les défauts non bloquants, donner une priorité et un plan précis.

CRITÈRES D'ACCEPTATION
Backend Go autonome sans serveur Node ; frontend compilable ; PostgreSQL migrable ; parcours métier essentiels réussis ; données legacy importables ; sauvegarde/restauration documentées et testées ; mode offline fiable sur les scénarios acceptés ; sécurité contrôlée ; matrice de validation finale complète.

À LA FIN
Donne un verdict honnête parmi :
- NON PRÊT : défauts critiques ou parcours de base cassés ;
- PRÊT POUR PILOTE : utilisable avec périmètre et limites clairement identifiés ;
- PRÊT POUR PRODUCTION : critères de sécurité, tests, exploitation et restauration réellement validés.

Ne confonds jamais compilation réussie et logiciel métier prêt pour la production.
```

---

# 7. Checklist de pilotage des dix phases

À cocher au fur et à mesure. Une phase ne doit être déclarée terminée qu'après vérification des livrables et des critères d'acceptation.

- [x] **01 — Audit :** cartographie réelle et risques documentés. (docs/migration/01-*.md)
- [x] **02 — Architecture :** modèle relationnel, flux, API et OpenAPI validés. (docs/migration/02-*.md + openapi.yaml)
- [x] **03 — Infrastructure :** backend Go, PostgreSQL, migrations, Docker et healthchecks opérationnels. (/healthz, /readyz, docker-compose.yml)
- [x] **04 — Sécurité :** authentification, sessions, rate limit, séparation des secrets et tests. (argon2id, lockout persistant, 429)
- [x] **05 — Métier :** règles de pressing, blanchisserie, caisse, paiements, fidélité, stocks et logistique dans Go. (tests service + intégration PG)
- [x] **06 — API :** routes REST protégées, documentées et testées. (api_integration_test.go)
- [x] **07 — Données :** backup v3 importable, prévisualisation, restauration et export vérifiés. (internal/backup + tests)
- [x] **08 — Frontend :** React connecté à Go, expérience existante préservée. (src/services/api + backend.ts)
- [x] **09 — Offline :** cache, outbox, idempotence, réconciliation et conflits testés. (7 suites PG + 9 suites bun + E2E navigateur)
- [x] **10 — Livraison :** E2E, sécurité, Docker, backup/restore et documentation de production validés. (docs/migration/10-final-audit.md, CI, docs/deployment/)

# 8. Commandes de contrôle de référence

Les commandes exactes peuvent varier selon les scripts réellement présents. L'agent doit les adapter au dépôt et ne jamais déclarer une vérification réussie si elle n'a pas été exécutée.

```bash
# Backend Go
cd backend
gofmt -w $(find . -type f -name '*.go')
go vet ./...
go test ./...
go test -race ./...
go build ./cmd/api

# Frontend (depuis le dossier frontend ou la racine actuelle)
bun install --frozen-lockfile
bun run lint
bun run build

# Infrastructure locale
 docker compose config
 docker compose up --build
```

Pour les tests d'intégration, utiliser une base PostgreSQL isolée et des fixtures synthétiques. Ne jamais lancer les tests destructifs contre la base de production.

# 9. Décision d'architecture à garder en tête

La migration ne consiste pas à « convertir TypeScript en Go » ligne par ligne. Elle consiste à faire de Go le propriétaire des règles métier, de la sécurité et de la persistance centrale, tout en gardant React comme interface et IndexedDB comme mécanisme de résilience hors ligne.

Le résultat attendu est un logiciel Éclat Pressing plus fiable : les calculs et transactions ne dépendent plus du navigateur, les données sont centralisées et sauvegardables, et les utilisateurs conservent une expérience PWA capable de continuer à travailler dans les limites prévues lorsque le réseau est indisponible.
