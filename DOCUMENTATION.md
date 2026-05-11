# Zénith — Documentation Technique Complète

> Application de gestion budgétaire personnelle et familiale.
> Stack : Node.js + Express + SQLite (backend) · PWA vanilla JS (frontend) · Railway (production)

---

## Table des matières

1. [Architecture générale](#1-architecture-générale)
2. [Structure des fichiers](#2-structure-des-fichiers)
3. [Base de données](#3-base-de-données)
4. [Backend — API REST](#4-backend--api-rest)
   - [Authentification](#41-authentification)
   - [Lignes budgétaires (entries)](#42-lignes-budgétaires-entries)
   - [Épargne (savings)](#43-épargne-savings)
   - [Dépenses mensuelles (monthly-expenses)](#44-dépenses-mensuelles-monthly-expenses)
   - [Désignations prédéfinies (expense-labels)](#45-désignations-prédéfinies-expense-labels)
   - [Foyer (household)](#46-foyer-household)
   - [Notifications push](#47-notifications-push)
   - [Intégration bancaire (bridge/Plaid)](#48-intégration-bancaire-bridgeplaid)
   - [Import bancaire](#49-import-bancaire)
   - [Admin](#410-admin)
   - [SSE (événements temps réel)](#411-sse-événements-temps-réel)
   - [Health check](#412-health-check)
5. [Middleware](#5-middleware)
6. [Système de notifications push](#6-système-de-notifications-push)
7. [Frontend — Structure](#7-frontend--structure)
8. [Frontend — Onglets et vues](#8-frontend--onglets-et-vues)
9. [Formules et calculs clés](#9-formules-et-calculs-clés)
10. [Variables d'environnement](#10-variables-denvironnement)
11. [Déploiement](#11-déploiement)

---

## 1. Architecture générale

```
Client (navigateur / PWA)
        │  fetch + JWT
        ▼
  Express API (Node.js)
  ├── Rate limiting (express-rate-limit)
  ├── JWT auth middleware
  ├── Routes → Controllers → Services
  └── SQLite (node:sqlite, WAL mode)
```

- **Frontend** : PWA mono-fichier (`frontend/index.html`). Vanilla JS, pas de framework. Servi statiquement par Express en production.
- **Backend** : Express.js, port 3001 en local, variable `PORT` en production.
- **Base de données** : SQLite via l'API native Node.js (`node:sqlite` — `DatabaseSync`). Fichier `backend/database/zenith.db`. Mode WAL activé, foreign keys ON.
- **Auth** : JWT signé côté serveur (HS256), stocké dans `localStorage` côté client. Durée configurable via `JWT_EXPIRES_IN` (défaut : `24h`).
- **Push notifications** : Web Push via `web-push` (VAPID). Scheduler `node-cron` pour les alertes automatiques.
- **Intégration bancaire** : Plaid (USA/sandbox) + GoCardless/Nordigen (Europe). Optionnel.

---

## 2. Structure des fichiers

```
zenith/
├── backend/
│   ├── database/
│   │   └── zenith.db               # Fichier SQLite (+ .bak automatiques avant migrations)
│   ├── src/
│   │   ├── app.js                  # Point d'entrée Express
│   │   ├── config/
│   │   │   └── database.js         # Connexion SQLite + 27 migrations séquentielles
│   │   ├── middleware/
│   │   │   ├── auth.middleware.js  # requireAuth / optionalAuth / requireAdmin
│   │   │   └── error.middleware.js # Gestionnaire d'erreurs global
│   │   ├── routes/                 # Déclaration des routes Express
│   │   ├── controllers/            # Validation HTTP → appel service
│   │   └── services/               # Logique métier + accès DB
│   ├── package.json
│   └── .env                        # Variables d'environnement (non commité)
├── frontend/
│   ├── index.html                  # Application complète (~8700 lignes)
│   ├── js/
│   │   └── api.js                  # Client API fetch (JWT, tous les modules)
│   ├── manifest.json               # PWA manifest
│   └── sw.js                       # Service Worker (cache + push)
└── DOCUMENTATION.md
```

---

## 3. Base de données

### Système de migrations

Le fichier `backend/src/config/database.js` contient un tableau `migrations[]` où chaque entrée est une chaîne SQL exécutée exactement une fois. La version courante est suivie via `PRAGMA user_version`. Avant chaque migration, une sauvegarde automatique `.v{N}.bak` est créée.

**Règle absolue** : ne jamais modifier une migration existante. Toujours ajouter une nouvelle migration à la fin.

### Schéma final (v27)

#### `users`
| Colonne | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-incrément |
| `name` | TEXT | Prénom affiché |
| `email` | TEXT UNIQUE | Email (insensible à la casse) |
| `password_hash` | TEXT | bcrypt (10 rounds) |
| `role` | TEXT | `Nicolas` / `Carla` / `Autre` |
| `color` | TEXT | Couleur hex (#3B8BD4 par défaut) |
| `photo` | TEXT | URL ou base64 (nullable) |
| `is_admin` | INTEGER | 0 = user, 1 = admin |
| `last_login_at` | TEXT | ISO 8601 UTC |
| `created_at` | TEXT | datetime('now') |

#### `entries` — Lignes budgétaires prévisionnelles
| Colonne | Type | Description |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER FK | Propriétaire |
| `name` | TEXT | Désignation |
| `amount` | REAL | Montant (toujours positif en affichage, stocké tel quel) |
| `cat` | TEXT | `revenu` / `impot` / `fixe` / `variable` / `epargne` / `loisir` |
| `member` | TEXT | Membre du foyer ou `Commun` |
| `sort_order` | INTEGER | Ordre d'affichage (drag-drop) |
| `debit_day` | INTEGER | Jour de prélèvement 1-31 (nullable, fixe uniquement) |
| `created_at` | TEXT | |
| `updated_at` | TEXT | |

Index : `user_id`, `member`, `cat`

#### `savings` — Épargne mensuelle réelle
| Colonne | Type | Description |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER FK | |
| `member` | TEXT | Nom du membre (= user.name) |
| `year` | INTEGER | Année |
| `month` | TEXT | Mois en français (`Janvier`…`Décembre`) |
| `amount` | REAL | Solde total de l'épargne à cette date |
| `delta` | REAL | Variation vs entrée précédente (calculé automatiquement) |
| `created_at` | TEXT | |
| `updated_at` | TEXT | |

Contrainte : `UNIQUE(user_id, year, month)`

#### `monthly_expenses` — Dépenses mensuelles réelles
| Colonne | Type | Description |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER FK | |
| `year` | INTEGER | |
| `month` | INTEGER | 1-12 |
| `name` | TEXT | Désignation |
| `amount` | REAL | Montant réel |
| `cat` | TEXT | `revenu` / `impot` / `fixe` / `variable` / `loisir` |
| `member` | TEXT | |
| `note` | TEXT | Commentaire libre (nullable) |
| `entry_id` | INTEGER | Référence à `entries.id` pour les surcharges mensuelles (nullable) |
| `is_exceptional` | INTEGER | 1 = dépense exceptionnelle (exclue des stats) |
| `created_at` | TEXT | |
| `updated_at` | TEXT | |

#### `config`
| Colonne | Type | Description |
|---|---|---|
| `key` | TEXT PK | Clé (ex: `vapid_public`, `alert_{userId}_{key}`) |
| `value` | TEXT | Valeur |

#### `households` — Foyers
| Colonne | Type | Description |
|---|---|---|
| `id` | INTEGER PK | |
| `creator_id` | INTEGER FK | Créateur du foyer |
| `created_at` | TEXT | |

#### `household_members`
| Colonne | Type | Description |
|---|---|---|
| `household_id` | INTEGER FK | |
| `user_id` | INTEGER FK | |
| `joined_at` | TEXT | |

Contrainte : `UNIQUE(household_id, user_id)`

#### `household_invites`
| Colonne | Type | Description |
|---|---|---|
| `household_id` | INTEGER FK | |
| `code` | TEXT UNIQUE | Code 6 caractères alphanumériques |
| `expires_at` | TEXT | Expiration ISO 8601 (15 min) |

#### `push_subscriptions`
| Colonne | Type | Description |
|---|---|---|
| `user_id` | INTEGER FK | |
| `endpoint` | TEXT UNIQUE | URL endpoint Web Push |
| `p256dh` | TEXT | Clé publique ECDH |
| `auth` | TEXT | Secret d'authentification |

#### `notifications` — Historique notifications
| Colonne | Type | Description |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER FK | |
| `title` | TEXT | Titre de la notification |
| `body` | TEXT | Corps du message |
| `is_read` | INTEGER | 0 = non lue, 1 = lue |
| `created_at` | TEXT | |

#### `expense_labels` — Désignations prédéfinies
| Colonne | Type | Description |
|---|---|---|
| `user_id` | INTEGER FK | |
| `cat` | TEXT | Catégorie |
| `name` | TEXT | Désignation |

Contrainte : `UNIQUE(user_id, cat, name)`

#### Tables bancaires (optionnelles)
- `plaid_items`, `plaid_accounts`, `plaid_transactions` — intégration Plaid
- `nordigen_requisitions`, `nordigen_accounts`, `nordigen_transactions` — intégration GoCardless

---

## 4. Backend — API REST

Toutes les réponses suivent le format :
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "Message d'erreur" }
```

### 4.1 Authentification

**Base** : `/api/auth`

| Méthode | Route | Auth | Description |
|---|---|---|---|
| GET | `/users` | Non | Liste des utilisateurs pour le sélecteur de profil (sans mdp ni email) |
| POST | `/login` | Non | Connexion email + mot de passe |
| POST | `/login-by-id` | Non | Connexion par ID + mot de passe (sélecteur de profil) |
| POST | `/register` | Non | Création de compte |
| POST | `/admin-login` | Non | Connexion administrateur |
| GET | `/me` | JWT | Profil de l'utilisateur connecté |

**Rate limiting** : 10 req/min pour `/login`, `/login-by-id`, `/register` ; 5 req/15min pour `/admin-login`.

#### POST `/api/auth/login`
```json
Body : { "email": "...", "password": "..." }
Retour : { "token": "JWT...", "user": { id, name, email, role, color, photo, ... } }
```

#### POST `/api/auth/register`
```json
Body : { "name": "...", "email": "...", "password": "...", "role": "Nicolas|Carla|Autre" }
Retour : { "token": "JWT...", "user": { ... } }
```
Contraintes : mot de passe ≥ 8 caractères, email unique.

Couleurs par défaut : Nicolas → `#3B8BD4`, Carla → `#e06fa0`, Autre → `#9e7bca`

---

### 4.2 Lignes budgétaires (entries)

**Base** : `/api/entries` — JWT requis

| Méthode | Route | Description |
|---|---|---|
| GET | `/` | Liste avec filtres optionnels |
| GET | `/stats` | Statistiques agrégées |
| PUT | `/order` | Réordonner (drag-drop) |
| POST | `/` | Créer une ligne |
| GET | `/:id` | Détail d'une ligne |
| PUT | `/:id` | Modifier une ligne |
| DELETE | `/:id` | Supprimer une ligne |

#### GET `/api/entries`
Paramètres query : `member`, `cat`, `search`

Le service filtre automatiquement par foyer : si l'utilisateur appartient à un foyer, les `userIds` de tous les membres sont inclus dans la requête.

#### GET `/api/entries/stats`
Paramètres query : `member`

Retourne :
```json
{
  "rev": 3500,      // Revenus bruts
  "tax": 300,       // Impôts
  "revNet": 3200,   // Revenus nets (rev - tax)
  "fix": 1200,      // Charges fixes
  "vari": 400,      // Variables
  "ep": 300,        // Épargne prévisionnelle
  "loi": 200,       // Loisirs
  "dep": 1800,      // Total dépenses (fix + vari + loi)
  "rav": 1600,      // Reste à vivre (revNet - fix - vari)
  "solde": 1100     // Solde (revNet - dep - ep)
}
```

#### POST `/api/entries`
```json
Body : { "name": "Loyer", "amount": 900, "cat": "fixe", "member": "Nicolas", "debit_day": 5 }
```
- `debit_day` : uniquement pour `cat = "fixe"`, jour 1-31 (nullable)
- `member` doit appartenir à la liste des membres valides (soi + membres du foyer + `Commun`)

#### PUT `/api/entries/order`
```json
Body : { "member": "Nicolas", "groupKey": "fixe", "orderedIds": [3, 1, 2, 5] }
```

---

### 4.3 Épargne (savings)

**Base** : `/api/savings` — JWT requis

| Méthode | Route | Description |
|---|---|---|
| GET | `/` | Liste avec filtres (`member`, `year`) |
| POST | `/` | Créer une entrée |
| GET | `/:id` | Détail |
| PUT | `/:id` | Modifier |
| DELETE | `/:id` | Supprimer |

#### Modèle de données
L'épargne enregistre le **solde total** à chaque mois. Le champ `delta` est calculé automatiquement comme la différence avec l'entrée précédente du même utilisateur. Il représente la variation mensuelle de l'épargne (positive ou négative).

Lors d'une modification ou suppression, le `delta` de l'entrée suivante est recalculé automatiquement.

#### POST `/api/savings`
```json
Body : { "member": "Nicolas", "year": 2025, "month": "Janvier", "amount": 12500 }
```
- Un seul enregistrement par `(user_id, year, month)` (contrainte UNIQUE).
- `member` doit correspondre exactement au `name` de l'utilisateur connecté.

---

### 4.4 Dépenses mensuelles (monthly-expenses)

**Base** : `/api/monthly-expenses` — JWT requis

| Méthode | Route | Description |
|---|---|---|
| GET | `/` | Dépenses saisies pour un mois donné |
| GET | `/stats` | Budget prévu vs réel par catégorie |
| GET | `/history` | Historique mensuel (24 derniers mois) |
| GET | `/names` | Noms distincts utilisés pour une catégorie |
| POST | `/` | Saisir une dépense réelle |
| PUT | `/:id` | Modifier |
| DELETE | `/:id` | Supprimer |

#### Concept clé : catégories auto vs manuelles

- **Catégories auto** (`revenu`, `impot`, `fixe`) : leur valeur de base est héritée des `entries` prévisionnelles. Une ligne dans `monthly_expenses` avec `entry_id` non null représente une **surcharge mensuelle** (override du montant prévu). Sans `entry_id`, c'est une dépense exceptionnelle additionnelle.
- **Catégories manuelles** (`variable`, `loisir`) : saisie libre chaque mois.
- **Épargne** : provient exclusivement de la table `savings` (calculé via `delta`).

#### GET `/api/monthly-expenses/stats`
Paramètres : `year`, `month`, `member`

Retourne pour chaque catégorie :
```json
{
  "revenu":   { "budget": 3500, "actual": 3500, "diff": 0 },
  "impot":    { "budget": 300,  "actual": 280,  "diff": 20 },
  "fixe":     { "budget": 1200, "actual": 1250, "diff": -50 },
  "variable": { "budget": 400,  "actual": 350,  "diff": 50 },
  "loisir":   { "budget": 200,  "actual": 180,  "diff": 20 },
  "epargne":  { "budget": 300,  "actual": 200,  "diff": 100 }
}
```
- `budget` = somme des `entries` prévisionnelles
- `actual` = valeur réelle saisie (overrides + dépenses manuelles + épargne réelle)
- `diff` = budget - actual (positif = économie, négatif = dépassement)

#### GET `/api/monthly-expenses/history`
Retourne les 24 derniers mois avec données, triés du plus récent au plus ancien :
```json
[{ "year": 2025, "month": 5, "total": 2850 }, ...]
```
`total` = fixe réel + variables + loisirs + épargne

---

### 4.5 Désignations prédéfinies (expense-labels)

**Base** : `/api/expense-labels` — JWT requis

| Méthode | Route | Description |
|---|---|---|
| GET | `/` | Liste par catégorie (`?cat=variable`) |
| POST | `/` | Créer une désignation |
| DELETE | `/:id` | Supprimer |

Permet de prédéfinir des libellés réutilisables par catégorie (ex: "Courses Lidl", "Netflix").

---

### 4.6 Foyer (household)

**Base** : `/api/household` — JWT requis

| Méthode | Route | Description |
|---|---|---|
| GET | `/` | Infos du foyer de l'utilisateur + liste membres |
| POST | `/create` | Créer un foyer |
| POST | `/invite` | Générer un code d'invitation (6 char, 15 min) |
| POST | `/join` | Rejoindre un foyer via code |
| DELETE | `/leave` | Quitter le foyer (non créateur uniquement) |
| DELETE | `/delete` | Supprimer le foyer (créateur uniquement) |

#### Logique foyer
- Un utilisateur ne peut appartenir qu'à un seul foyer.
- Le créateur ne peut pas quitter son foyer — il doit le supprimer.
- Supprimer un foyer supprime en cascade les membres et invitations.
- Les données financières (entries, savings) restent liées aux utilisateurs individuellement — c'est le frontend qui agrège par foyer.

---

### 4.7 Notifications push

**Base** : `/api/notifications` — JWT requis

| Méthode | Route | Description |
|---|---|---|
| GET | `/vapid-key` | Clé publique VAPID (pour enregistrement SW) |
| POST | `/subscribe` | Enregistrer une subscription Web Push |
| DELETE | `/unsubscribe` | Se désabonner |
| GET | `/` | Historique des notifications reçues |
| POST | `/mark-read` | Marquer toutes comme lues |
| DELETE | `/:id` | Supprimer une notification |
| DELETE | `/clear` | Vider tout l'historique |
| POST | `/test` | Envoyer une notification de test |
| POST | `/check-alerts` | Déclencher manuellement les alertes budgétaires |
| GET | `/debug` | Infos debug sur les subscriptions |

---

### 4.8 Intégration bancaire (bridge/Plaid)

**Base** : `/api/bridge` — JWT requis

| Méthode | Route | Description |
|---|---|---|
| POST | `/link-token` | Obtenir un token Plaid Link |
| POST | `/exchange-token` | Échanger le token public Plaid contre un access token |
| POST | `/sync/:itemId` | Synchroniser les transactions d'un compte |
| POST | `/sync-all` | Synchroniser tous les comptes |
| GET | `/accounts` | Liste des comptes bancaires liés |
| GET | `/transactions` | Transactions (filtres: `account_id`, `from`, `to`) |
| GET | `/summary` | Résumé des soldes |
| DELETE | `/items/:itemId` | Délier un compte bancaire |

Nécessite les clés Plaid (`PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`).

---

### 4.9 Import bancaire

**Base** : `/api/import` — JWT requis

| Méthode | Route | Description |
|---|---|---|
| POST | `/confirm` | Sauvegarder en lot des transactions catégorisées |

```json
Body : { "entries": [{ "name": "LIDL", "amount": -42.5, "cat": "variable", "member": "Nicolas" }] }
Retour : { "saved": 12, "failed": [] }
```

---

### 4.10 Admin

**Base** : `/api/admin` — JWT + `is_admin = 1` requis

Accès via `POST /api/auth/admin-login` avec identifiants admin.
Compte par défaut créé en migration v6 : `admin` / `admin` (à changer en production).

Endpoints de gestion : liste utilisateurs, suppression, reset de mot de passe, stats globales.

---

### 4.11 SSE (événements temps réel)

**Base** : `/api/events` — JWT optionnel

Server-Sent Events pour notifier le frontend en temps réel (ex: sync bancaire terminée).

---

### 4.12 Health check

```
GET /api/health
```
Retourne : `{ status: "ok", env, db_version, tables[] }`

---

## 5. Middleware

### `requireAuth`
Vérifie le header `Authorization: Bearer <JWT>`. Si absent ou invalide → 401. Vérifie que l'utilisateur existe toujours en base (sécurité suppression de compte). Attache `req.user` (payload JWT décodé).

### `optionalAuth`
Même logique que `requireAuth` mais n'échoue pas si le token est absent.

### `requireAdmin`
À utiliser après `requireAuth`. Vérifie `req.user.is_admin`. Retourne 403 si non admin.

### `errorHandler`
Gestionnaire global Express. Lit `err.statusCode` (défini dans les services) pour retourner le bon code HTTP. Format : `{ success: false, error: "..." }`.

---

## 6. Système de notifications push

### Initialisation (VAPID)
Au démarrage du serveur, `notifService.init()` :
1. Cherche les clés VAPID dans `process.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`)
2. Sinon, cherche dans la table `config`
3. Sinon, génère une nouvelle paire et la stocke en base

### Scheduler (node-cron)
`notifService.startScheduler()` lance 4 tâches :

| Cron | Heure | Description |
|---|---|---|
| `0 13 1 * *` | 1er du mois, 13h | Rappel saisie épargne mensuelle |
| `0 13 * * 1` | Chaque lundi, 13h | Résumé budgétaire hebdomadaire |
| `0 8 * * *` | Chaque jour, 8h | Rappel des prélèvements du jour (selon `debit_day`) |
| `0 13 * * *` | Chaque jour, 13h | Vérification des alertes budgétaires |

### Alertes budgétaires
7 alertes définies avec anti-spam (une seule par jour par alerte) :

| Clé | Condition | Titre |
|---|---|---|
| `rav_negatif` | RAV < 0 | Budget en déficit |
| `dep_critique` | dépenses > 70% revNet | Dépenses trop élevées |
| `ep_faible` | épargne > 0 et taux < 5% | Épargne insuffisante |
| `matelas_faible` | épargne couvre < 30 jours | Matelas de sécurité faible |
| `score_bas` | score santé < 40 | Santé financière dégradée |
| `fixes_eleves` | fixes > 50% revNet | Charges fixes élevées |
| `contrainte_elev` | (impôts + fixes) > 55% revNet | Budget rigide |

L'anti-spam utilise la table `config` avec des clés `alert_{userId}_{alertKey}` = date du jour.

---

## 7. Frontend — Structure

Le frontend est une **PWA mono-fichier** : `frontend/index.html` (~8700 lignes). Tout est inline : HTML, CSS, JS.

### Client API (`frontend/js/api.js`)
Wrapper fetch centralisé. Modules exposés via `window.API` :

| Module | Description |
|---|---|
| `API.auth` | login, loginById, register, getMe, logout, getUsers |
| `API.entries` | CRUD lignes budgétaires, stats, réordonnancement |
| `API.savings` | CRUD épargne |
| `API.monthlyExpenses` | CRUD dépenses mensuelles, stats, historique, noms |
| `API.expenseLabels` | CRUD désignations prédéfinies |
| `API.household` | Gestion foyer (créer, inviter, rejoindre, quitter) |
| `API.notifications` | Historique, marquer lu, supprimer |
| `API.bridge` | Intégration Plaid (comptes, transactions, sync) |
| `API.import` | Import bancaire en lot |
| `API.users` | updateSettings (couleur/photo), updateProfile, changePassword |

Toutes les requêtes attachent automatiquement le JWT depuis `localStorage`. Une réponse 401 déclenche l'événement `zenith:unauthorized` pour revenir à l'écran de connexion.

### Service Worker (`frontend/sw.js`)
Gère :
- Cache des assets statiques (offline)
- Réception des notifications push
- Clic sur notification → navigation

---

## 8. Frontend — Onglets et vues

### Navigation
5 onglets principaux + écran de sélection de profil + modal paramètres :

| Onglet | ID | Description |
|---|---|---|
| Vue d'ensemble | `tab-dashboard` | Héro solde, OVA, alertes, comparaison mensuelle |
| Budget | `tab-budget` | Lignes budgétaires prévisionnelles (drag-drop) |
| Épargne | `tab-savings` | Saisie et historique épargne mensuelle |
| Analyse | `tab-analyse` | Stats multi-mois, graphiques, score santé |
| Banque | `tab-bank` | Import bancaire, connexion Plaid |

### Sélecteur de membre
Filtre global (en haut) : `all` (tous les membres du foyer), ou un membre spécifique. Affecte toutes les vues.

---

### Vue d'ensemble (`renderDashboard`)

**Héro** (solde mensuel)
- Sélecteur mois/année
- Solde = Revenus nets − Dépenses − Épargne du mois
- Indicateur taux d'épargne vs objectif (vert/orange/rouge)
- RAV (Reste À Vivre)
- Alerte déficit si dépenses > revenus nets (bannière rouge)

**Où va l'argent (OVA)**
Répartition des dépenses réelles du mois en cours par catégorie :
- Fixes : charges prévisionnelles dont le `debit_day` ≤ aujourd'hui (si mois courant)
- Variables : saisies manuelles
- Loisirs : saisies manuelles
- Épargne : delta savings du mois
- Badge "exceptions" si dépenses exceptionnelles présentes
- Sous-titre dépassement budget si applicable

**Comparaison mensuelle** (`renderMonthlyComparison`)
- Tableau : 12 derniers mois avec colonnes Revenus nets / Dépenses / Épargne
- Flèches de tendance (↑/↓) avec couleur sémantique (revenus : vert=hausse, rouge=baisse ; dépenses : vert=baisse, rouge=hausse)
- Graphique Chart.js : courbe Dépenses (sans ombre) + courbe Épargne (pointillé, `spanGaps:true`, valeurs null pour mois sans données)
- Axe Y : `beginAtZero:false` pour supporter les valeurs négatives
- Tooltip personnalisé (ignore les null)

---

### Budget (`renderBudget`)
- Lignes groupées par membre puis catégorie
- Drag-drop pour réordonner (`PUT /api/entries/order`)
- Inline edit au clic
- Ajout rapide de lignes
- Champ `debit_day` pour les charges fixes
- Totaux par catégorie + solde global

---

### Épargne (`renderSavings`)
- Tableau mensuel par membre
- Saisie/modification inline du solde total
- Delta calculé automatiquement et affiché (variation mensuelle)
- Graphique évolution du patrimoine

---

### Analyse (`renderAnalysis`)
Données calculées sur les mois ayant `revNet > 0 AND dep > 0` (pour éviter les mois incomplets).

**4 métriques héro** : Revenu net moyen / Dépenses moyennes / Épargne moyenne / Solde moyen

**Insights intégrés** (sous les métriques) :
- Taux d'épargne moyen + projection annuelle
- Taux de charges fixes
- Nombre de mois positifs sur la période

**Graphique Comparaison mensuelle** (même que dashboard mais sur plus de mois)

**Score santé financière** (0-100)
```
scoreSav   = min(40, ravRate × 1.2)          // 0-40 pts : épargne
scoreRig   = fixRate <= 30 ? 30 : ...        // 0-30 pts : rigidité charges
scoreDep   = depRate <= 50 ? 30 : ...        // 0-30 pts : taux de dépenses
healthScore = scoreSav + scoreRig + scoreDep
```

---

## 9. Formules et calculs clés

### Budget prévisionnel (entries)

```
revenu   = Σ entries[cat='revenu']
impot    = Σ entries[cat='impot']
revNet   = revenu - impot

fixe     = Σ entries[cat='fixe']
variable = Σ entries[cat='variable']
loisir   = Σ entries[cat='loisir']
epargne  = Σ entries[cat='epargne']

dep      = fixe + variable + loisir
rav      = revNet - fixe - variable          // Reste à vivre brut (sans loisirs ni épargne)
solde    = revNet - dep - epargne            // Solde final
```

### Suivi mensuel réel (monthly_expenses + savings)

```
revA     = actual de revenu (overrides ou budget par défaut)
impA     = actual de impot
revNetA  = revA - impA

fixA     = actual de fixe (base prévisionnelle + overrides + extras manuels)
varA     = Σ monthly_expenses[cat='variable', is_exceptional=0]
loiA     = Σ monthly_expenses[cat='loisir', is_exceptional=0]
epMonthDelta = savings.delta pour ce mois (variation mensuelle d'épargne)

depA     = fixA + varA + loiA
soldeA   = revNetA - depA - max(0, epMonthDelta)
ravA     = revNetA - fixA - varA
```

### Taux
```
depRate  = dep / revNet × 100
fixRate  = fixe / revNet × 100
epRate   = epargne / revNet × 100
ravRate  = rav / revNet × 100
```

### Score santé
```
scoreRig = fixRate <= 30 ? 30 : fixRate <= 50 ? round(30 - (fixRate-30) × 0.75) : 0
scoreDep = depRate <= 50 ? 30 : depRate <= 70 ? round(30 - (depRate-50) × 1.5) : 0
scoreSav = min(40, ravRate × 1.2)
score    = scoreSav + scoreRig + scoreDep   // sur 100
```

### Delta épargne
```
delta(mois N) = savings.amount(N) - savings.amount(N-1)
// Si premier enregistrement : delta = null
// Recalculé automatiquement sur l'entrée suivante lors de modification/suppression
```

---

## 10. Variables d'environnement

| Variable | Requis | Défaut | Description |
|---|---|---|---|
| `JWT_SECRET` | Oui | — | Clé de signature JWT (minimum 32 caractères aléatoires) |
| `JWT_EXPIRES_IN` | Non | `24h` | Durée de validité des tokens JWT |
| `PORT` | Non | `3001` | Port d'écoute du serveur |
| `NODE_ENV` | Non | `development` | Environnement (`production` active les restrictions CORS) |
| `FRONTEND_URL` | Production | — | URL du frontend (CORS en production) |
| `DB_PATH` | Non | `./database/zenith.db` | Chemin vers le fichier SQLite |
| `VAPID_PUBLIC_KEY` | Non | Auto-généré | Clé publique VAPID Web Push |
| `VAPID_PRIVATE_KEY` | Non | Auto-généré | Clé privée VAPID Web Push |
| `PLAID_CLIENT_ID` | Non | — | Client ID Plaid |
| `PLAID_SECRET` | Non | — | Secret Plaid |
| `PLAID_ENV` | Non | `sandbox` | `sandbox` / `development` / `production` |

Si `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY` sont absents, des clés sont générées automatiquement et persistées en base. Pour la production, il est conseillé de les fixer dans les variables d'environnement pour éviter de perdre les subscriptions push lors d'un redémarrage.

---

## 11. Déploiement

### Local (développement)

```bash
# Backend
cd backend
cp .env.example .env   # Renseigner JWT_SECRET au minimum
npm install
npm start              # http://localhost:3001

# Frontend
# Servi automatiquement par Express depuis /frontend
# Ouvrir http://localhost:3001
```

### Production (Railway)

1. Connecter le dépôt GitHub à Railway.
2. Service backend : `cd backend && npm start`
3. Variables d'environnement à configurer dans Railway :
   - `JWT_SECRET` (requis)
   - `NODE_ENV=production`
   - `FRONTEND_URL` (URL Railway du service)
   - `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (optionnel mais recommandé)
4. Volume persistant monté sur `/app/backend/database` pour conserver `zenith.db`.
5. Le frontend est servi statiquement par Express (pas de service séparé nécessaire).

### Sauvegardes base de données

Avant chaque migration, une sauvegarde automatique est créée : `zenith.db.v{N}.bak`. Ces fichiers peuvent être supprimés manuellement une fois la migration validée.

---

*Documentation générée le 2026-05-07 — Schéma DB v27*
