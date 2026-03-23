# Zénith — Budget Manager

Application de gestion budgétaire personnelle et en couple. Suivi des revenus, dépenses, épargne et analyses financières (règle 50/30/20, flux budgétaire, top dépenses).

---

## Fonctionnalités

- **Multi-utilisateurs** — vue individuelle ou couple côte à côte
- **Lignes budgétaires** — revenus et dépenses par catégorie, triées par montant
- **Épargne** — historique mensuel/annuel avec évolution et pourcentage du revenu
- **Analyse** — graphiques interactifs (flux budgétaire, top dépenses, règle 50/30/20)
- **Thème clair/sombre** — bascule instantanée, badges de catégories adaptatifs
- **Réglages** — photo de profil, couleur de membre, changement de mot de passe

---

## Structure du projet

```
zenith/
├── backend/
│   ├── src/
│   │   ├── app.js              ← Point d'entrée Express
│   │   ├── config/
│   │   │   └── database.js     ← Connexion SQLite + initialisation
│   │   ├── controllers/        ← Couche HTTP (délègue aux services)
│   │   ├── middleware/         ← Auth JWT + gestion d'erreurs
│   │   ├── routes/             ← Routeurs Express
│   │   └── services/           ← Logique métier
│   ├── database/
│   │   └── schema.sql          ← Schéma SQLite + données de démo
│   ├── .env                    ← Variables d'environnement (ne pas commiter)
│   ├── .env.example            ← Exemple de configuration
│   └── package.json
└── frontend/
    ├── index.html              ← SPA complète (HTML/CSS/JS inline)
    ├── favicon.svg             ← Logo Zénith
    └── js/
        └── api.js              ← Client fetch (JWT, erreurs, état)
```

---

## Prérequis

- **Node.js** v18+
- Un navigateur moderne

---

## Installation

### 1. Backend

```bash
cd backend
cp .env.example .env   # puis éditer JWT_SECRET
npm install
npm start
```

Le serveur démarre sur **http://localhost:3001**.

Mode développement (rechargement automatique) :
```bash
npm run dev
```

### 2. Frontend

Ouvrir `frontend/index.html` directement dans le navigateur, **ou** via un serveur local pour éviter les restrictions CORS :

```bash
# Python
cd frontend && python -m http.server 8080

# Node.js
npx serve frontend
```

> L'API doit être démarrée avant d'ouvrir le frontend.

---

## Variables d'environnement

| Variable       | Défaut        | Description                        |
|----------------|---------------|------------------------------------|
| `PORT`         | `3001`        | Port du serveur Express            |
| `JWT_SECRET`   | —             | Clé secrète JWT (à personnaliser)  |
| `JWT_EXPIRES_IN` | `7d`        | Durée de vie des tokens            |
| `DB_PATH`      | `./database/zenith.db` | Chemin de la base SQLite  |
| `NODE_ENV`     | `development` | Environnement                      |

---

## API

### Authentification

| Méthode | Endpoint          | Description                    | Auth |
|---------|-------------------|--------------------------------|------|
| GET     | /api/auth/users   | Liste des profils (login picker) | Non |
| POST    | /api/auth/login   | Connexion email + mot de passe | Non  |
| POST    | /api/auth/register | Créer un compte               | Non  |
| GET     | /api/auth/me      | Utilisateur courant            | Oui  |

### Lignes budgétaires

| Méthode | Endpoint              | Description                          | Auth |
|---------|-----------------------|--------------------------------------|------|
| GET     | /api/entries          | Lister (filtres : member, cat, search) | Oui |
| GET     | /api/entries/stats    | Statistiques agrégées                | Oui  |
| POST    | /api/entries          | Créer une ligne                      | Oui  |
| GET     | /api/entries/:id      | Détail                               | Oui  |
| PUT     | /api/entries/:id      | Modifier                             | Oui  |
| DELETE  | /api/entries/:id      | Supprimer                            | Oui  |

### Épargne

| Méthode | Endpoint         | Description                          | Auth |
|---------|------------------|--------------------------------------|------|
| GET     | /api/savings     | Lister (filtres : member, year)      | Oui  |
| POST    | /api/savings     | Créer un enregistrement              | Oui  |
| GET     | /api/savings/:id | Détail                               | Oui  |
| PUT     | /api/savings/:id | Modifier (recalcule le delta auto.)  | Oui  |
| DELETE  | /api/savings/:id | Supprimer                            | Oui  |

### Utilisateur

| Méthode | Endpoint            | Description                       | Auth |
|---------|---------------------|-----------------------------------|------|
| PUT     | /api/users/settings | Mettre à jour couleur et/ou photo | Oui  |

### Format de réponse

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "Message d'erreur" }
```

---

## Stack technique

**Backend**
- [Express](https://expressjs.com/) — framework HTTP
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — SQLite synchrone
- [bcryptjs](https://github.com/dcodeIO/bcrypt.js) — hachage des mots de passe (10 rounds)
- [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) — authentification JWT
- [dotenv](https://github.com/motdotla/dotenv) — variables d'environnement

**Frontend**
- HTML / CSS / JS pur — aucun framework
- [Chart.js](https://www.chartjs.org/) — graphiques (donut, barres, lignes, radar)
- [ChartDataLabels](https://chartjs-plugin-datalabels.netlify.app/) — labels sur les graphiques

---

## Sécurité

- Mots de passe hachés avec bcrypt (10 rounds)
- Authentification stateless par JWT (Bearer token)
- Validation des données côté serveur
- CORS à restreindre aux origines autorisées en production
- `.env` exclu du dépôt (`.gitignore`)
