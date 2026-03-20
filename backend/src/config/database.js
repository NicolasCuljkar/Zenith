/**
 * database.js — SQLite database initialization
 *
 * Utilise le module SQLite NATIF de Node.js v22+ (node:sqlite).
 * Aucune dépendance externe, aucune compilation nécessaire.
 *
 * Docs : https://nodejs.org/api/sqlite.html
 */

'use strict';

// node:sqlite est intégré dans Node.js v22.5+ (stable depuis v22.13 / v24)
const { DatabaseSync } = require('node:sqlite');
const fs       = require('fs');
const path     = require('path');
require('dotenv').config();

const DB_PATH    = path.resolve(__dirname, '../../', process.env.DB_PATH || './database/zenith.db');
const SCHEMA_SQL = path.resolve(__dirname, '../../database/schema.sql');

// Créer le répertoire de la base si nécessaire
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Ouvrir (ou créer) la base SQLite
const db = new DatabaseSync(DB_PATH);

// Activer WAL et les foreign keys pour de meilleures performances
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/**
 * initDB — Exécute le schéma SQL et insère les utilisateurs par défaut.
 */
function initDB() {
  // Lire et exécuter schema.sql (CREATE IF NOT EXISTS + INSERT OR IGNORE)
  const schema = fs.readFileSync(SCHEMA_SQL, 'utf8');
  db.exec(schema);

  console.log(`[DB] Base de données initialisée : ${DB_PATH}`);
}

// Lancer l'initialisation au chargement du module
initDB();

module.exports = db;
