'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs   = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../../', process.env.DB_PATH || './database/zenith.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ── Migrations ────────────────────────────────────────────────────────────────
// Chaque migration s'exécute exactement une fois, suivie via PRAGMA user_version.
// RÈGLE : ne jamais modifier une migration existante — ajouter une nouvelle à la fin.

const migrations = [

  // v1 — schéma complet (users, settings, entries, savings + index)
  `CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'Autre',
    color         TEXT    NOT NULL DEFAULT '#3B8BD4',
    photo         TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key        TEXT    NOT NULL,
    value      TEXT,
    UNIQUE(user_id, key)
  );
  CREATE TABLE IF NOT EXISTS entries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    amount     REAL    NOT NULL,
    cat        TEXT    NOT NULL CHECK(cat IN ('revenu','impot','fixe','variable','epargne','loisir')),
    member     TEXT    NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS savings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member     TEXT    NOT NULL,
    year       INTEGER NOT NULL,
    month      TEXT    NOT NULL CHECK(month IN ('Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre')),
    amount     REAL    NOT NULL,
    delta      REAL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, year, month)
  );
  CREATE INDEX IF NOT EXISTS idx_entries_user   ON entries(user_id);
  CREATE INDEX IF NOT EXISTS idx_entries_member ON entries(member);
  CREATE INDEX IF NOT EXISTS idx_entries_cat    ON entries(cat);
  CREATE INDEX IF NOT EXISTS idx_savings_user   ON savings(user_id);
  CREATE INDEX IF NOT EXISTS idx_savings_member ON savings(member);
  CREATE INDEX IF NOT EXISTS idx_savings_year   ON savings(year);`,

  // v2 — config (clés VAPID) + push_subscriptions
  `CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT    NOT NULL UNIQUE,
    p256dh     TEXT    NOT NULL,
    auth       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);`,

  // v3 — système foyer (households)
  `CREATE TABLE IF NOT EXISTS households (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS household_members (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
    joined_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(household_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS household_invites (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    code         TEXT    NOT NULL UNIQUE,
    expires_at   TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_hm_household ON household_members(household_id);
  CREATE INDEX IF NOT EXISTS idx_hm_user      ON household_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_hi_code      ON household_invites(code);`,

  // v4 — ajout creator_id aux foyers
  `ALTER TABLE households ADD COLUMN creator_id INTEGER REFERENCES users(id);
UPDATE households SET creator_id = (
  SELECT user_id FROM household_members
  WHERE household_id = households.id
  ORDER BY joined_at ASC
  LIMIT 1
) WHERE creator_id IS NULL;`,

  // v5 — colonne is_admin
  `ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;`,

  // v6 — compte admin par défaut (identifiant: admin / mdp: admin)
  `INSERT OR IGNORE INTO users (name, email, password_hash, role, color, is_admin)
   VALUES ('Admin', 'admin', '$2a$10$Cmgxu7VcJMOktNz/njXer.Q5NN2NzYoj6F0Mrl8g/R25ObcUznGRy', 'Autre', '#6366f1', 1);`,

  // v7 — tokens de réinitialisation de mot de passe
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT    NOT NULL UNIQUE,
    expires_at TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens(token);`,

  // v8 — intégration bancaire GoCardless (Nordigen)
  `CREATE TABLE IF NOT EXISTS nordigen_requisitions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requisition_id   TEXT    NOT NULL UNIQUE,
    institution_id   TEXT    NOT NULL,
    institution_name TEXT    NOT NULL,
    status           TEXT    NOT NULL DEFAULT 'CR',
    link             TEXT,
    reference        TEXT    NOT NULL UNIQUE,
    synced_at        TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS nordigen_accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requisition_id  TEXT    NOT NULL REFERENCES nordigen_requisitions(requisition_id) ON DELETE CASCADE,
    account_id      TEXT    NOT NULL UNIQUE,
    iban            TEXT,
    name            TEXT,
    currency        TEXT    NOT NULL DEFAULT 'EUR',
    type            TEXT,
    balance         REAL    NOT NULL DEFAULT 0,
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS nordigen_transactions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id     TEXT    NOT NULL,
    transaction_id TEXT    NOT NULL UNIQUE,
    amount         REAL    NOT NULL,
    currency       TEXT    NOT NULL DEFAULT 'EUR',
    date           TEXT    NOT NULL,
    description    TEXT,
    is_pending     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_nreq_user   ON nordigen_requisitions(user_id);
  CREATE INDEX IF NOT EXISTS idx_nacc_req    ON nordigen_accounts(requisition_id);
  CREATE INDEX IF NOT EXISTS idx_ntx_date    ON nordigen_transactions(date);`,

  // v9 — intégration bancaire Plaid
  `CREATE TABLE IF NOT EXISTS plaid_items (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id          TEXT    NOT NULL UNIQUE,
    access_token     TEXT    NOT NULL,
    institution_name TEXT    NOT NULL DEFAULT 'Banque',
    cursor           TEXT,
    synced_at        TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS plaid_accounts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id           TEXT    NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
    account_id        TEXT    NOT NULL UNIQUE,
    name              TEXT    NOT NULL,
    type              TEXT,
    subtype           TEXT,
    balance_current   REAL    NOT NULL DEFAULT 0,
    balance_available REAL,
    currency          TEXT    NOT NULL DEFAULT 'EUR',
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS plaid_transactions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id     TEXT    NOT NULL,
    transaction_id TEXT    NOT NULL UNIQUE,
    amount         REAL    NOT NULL,
    currency       TEXT    NOT NULL DEFAULT 'EUR',
    date           TEXT    NOT NULL,
    description    TEXT,
    category       TEXT,
    is_pending     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pitems_user  ON plaid_items(user_id);
  CREATE INDEX IF NOT EXISTS idx_paccs_item   ON plaid_accounts(item_id);
  CREATE INDEX IF NOT EXISTS idx_ptx_date     ON plaid_transactions(date);`,

];

// ── Apply pending migrations ──────────────────────────────────────────────────
const currentVersion = db.prepare('PRAGMA user_version').get().user_version;

if (currentVersion < migrations.length) {
  // Sauvegarde automatique avant toute migration
  if (currentVersion > 0 && fs.existsSync(DB_PATH)) {
    const backupPath = `${DB_PATH}.v${currentVersion}.bak`;
    fs.copyFileSync(DB_PATH, backupPath);
    console.log(`[DB] Backup → ${backupPath}`);
  }

  for (let i = currentVersion; i < migrations.length; i++) {
    db.exec(migrations[i]);
    db.exec(`PRAGMA user_version = ${i + 1}`);
    console.log(`[DB] Migration v${i + 1} appliquée`);
  }
}

console.log(`[DB] ${DB_PATH} (schema v${migrations.length})`);

module.exports = db;
