# Zénith — Budget Manager

Application de gestion budgétaire pour couple, avec backend Node.js/SQLite et frontend HTML pur.

## Structure du projet

```
zenith/
├── backend/              ← API Node.js + Express + SQLite
│   ├── src/
│   │   ├── app.js        ← Point d'entrée Express
│   │   ├── config/
│   │   │   └── database.js     ← Connexion SQLite + initialisation
│   │   ├── controllers/  ← Couche HTTP (mince — délègue aux services)
│   │   ├── middleware/   ← Auth JWT + gestion d'erreurs
│   │   ├── routes/       ← Routeurs Express
│   │   └── services/     ← Logique métier
│   ├── database/
│   │   └── schema.sql    ← Schéma SQLite + données de démo
│   ├── .env              ← Variables d'environnement (à ne pas commiter)
│   ├── .env.example      ← Exemple de configuration
│   └── package.json
└── frontend/
    ├── index.html        ← Application SPA complète
    └── js/
        └── api.js        ← Client API (fetch wrapper)
```

## Prérequis

- **Node.js** v18+ (https://nodejs.org/)
- Un navigateur moderne

## Installation & démarrage

### 1. Backend

```bash
cd backend
npm install
npm start
```

Le serveur démarre sur **http://localhost:3001**

Pour le mode développement (rechargement automatique) :
```bash
npm run dev
```

### 2. Frontend

Ouvrez simplement `frontend/index.html` dans votre navigateur,
**ou** utilisez un serveur local (recommandé pour éviter les restrictions CORS de `file://`) :

```bash
# Avec Python
cd frontend && python -m http.server 8080
# Puis ouvrir http://localhost:8080

# Avec Node.js (serve)
npx serve frontend
```

> **Note :** L'API doit être démarrée AVANT d'ouvrir le frontend.

## Comptes de démo

| Utilisateur | Email                | Mot de passe |
|-------------|----------------------|--------------|
| Nicolas     | nicolas@budget.fr    | nicolas123   |
| Carla       | carla@budget.fr      | carla123     |

## Variables d'environnement

Copiez `.env.example` vers `.env` et modifiez les valeurs :

```env
PORT=3001
JWT_SECRET=votre_clé_secrète_très_longue
JWT_EXPIRES_IN=7d
DB_PATH=./database/zenith.db
NODE_ENV=development
```

## API Endpoints

### Authentification
| Méthode | URL                  | Description                    | Auth |
|---------|----------------------|--------------------------------|------|
| GET     | /api/auth/users      | Liste des profils (picker)     | Non  |
| POST    | /api/auth/login      | Connexion email + mot de passe | Non  |
| POST    | /api/auth/register   | Créer un compte                | Non  |
| GET     | /api/auth/me         | Utilisateur courant            | Oui  |

### Lignes budgétaires
| Méthode | URL                   | Description                       | Auth |
|---------|-----------------------|-----------------------------------|------|
| GET     | /api/entries          | Lister (filtres: member, cat, search) | Oui |
| GET     | /api/entries/stats    | Statistiques (rev, dep, etc.)     | Oui  |
| POST    | /api/entries          | Créer une ligne                   | Oui  |
| GET     | /api/entries/:id      | Détail d'une ligne                | Oui  |
| PUT     | /api/entries/:id      | Modifier une ligne                | Oui  |
| DELETE  | /api/entries/:id      | Supprimer une ligne               | Oui  |
| PUT     | /api/entries/order    | Mettre à jour l'ordre (drag-drop) | Oui  |

### Épargne
| Méthode | URL                | Description                         | Auth |
|---------|--------------------|-------------------------------------|------|
| GET     | /api/savings       | Lister (filtres: member, year)      | Oui  |
| POST    | /api/savings       | Créer un enregistrement             | Oui  |
| GET     | /api/savings/:id   | Détail                              | Oui  |
| PUT     | /api/savings/:id   | Modifier (recalcule le delta auto.) | Oui  |
| DELETE  | /api/savings/:id   | Supprimer                           | Oui  |

### Utilisateur
| Méthode | URL                  | Description                       | Auth |
|---------|----------------------|-----------------------------------|------|
| PUT     | /api/users/settings  | Mettre à jour couleur et/ou photo | Oui  |

### Format de réponse

Toutes les réponses suivent ce format :

```json
{ "success": true, "data": { ... } }
// ou en cas d'erreur :
{ "success": false, "error": "Message d'erreur" }
```

## Architecture

### Backend

- **Express** — Framework HTTP
- **better-sqlite3** — SQLite synchrone (performant, adapté pour usage mono-serveur)
- **bcryptjs** — Hachage des mots de passe
- **jsonwebtoken** — Authentification JWT (Bearer token)
- **cors** — Cross-Origin Resource Sharing
- **dotenv** — Chargement des variables d'environnement

### Frontend

- **HTML/CSS/JS pur** — Pas de framework frontend
- `api.js` — Client fetch avec gestion du JWT, des erreurs et de l'état de chargement
- **Chart.js** — Graphiques (donut, barres, lignes, radar, gauge)
- **ChartDataLabels** — Labels sur les graphiques

### Base de données

Le fichier SQLite (`backend/database/zenith.db`) est créé automatiquement au premier démarrage.
Les données de démonstration (26 lignes budgétaires + 10 entrées d'épargne) sont insérées via `schema.sql`.

## Sécurité

- Mots de passe hashés avec **bcrypt** (10 rounds)
- Authentification par **JWT** (Bearer token, 7 jours)
- Validation des données côté serveur
- CORS configuré (restreindre les origines en production)

---

*Zénith — Budget Manager v1.0*
