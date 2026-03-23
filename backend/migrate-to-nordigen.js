const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./database/zenith.db');

// Drop old bridge tables if they exist
['bridge_transactions','bridge_accounts','bridge_items','bridge_users'].forEach(t => {
  try { db.exec(`DROP TABLE IF EXISTS ${t}`); console.log(`Dropped ${t}`); } catch(e) { console.warn(e.message); }
});

// Create nordigen tables
db.exec(`
CREATE TABLE IF NOT EXISTS nordigen_requisitions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL,
  requisition_id   TEXT    NOT NULL UNIQUE,
  institution_id   TEXT    NOT NULL,
  institution_name TEXT    NOT NULL DEFAULT '',
  status           TEXT    NOT NULL DEFAULT 'CR',
  link             TEXT    NOT NULL DEFAULT '',
  reference        TEXT    NOT NULL DEFAULT '',
  synced_at        TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS nordigen_accounts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL,
  requisition_id   TEXT    NOT NULL,
  account_id       TEXT    NOT NULL UNIQUE,
  iban             TEXT,
  name             TEXT    NOT NULL DEFAULT '',
  currency         TEXT    NOT NULL DEFAULT 'EUR',
  type             TEXT    NOT NULL DEFAULT '',
  balance          REAL    NOT NULL DEFAULT 0,
  updated_at       TEXT
);
CREATE TABLE IF NOT EXISTS nordigen_transactions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id       TEXT    NOT NULL,
  transaction_id   TEXT    NOT NULL UNIQUE,
  amount           REAL    NOT NULL DEFAULT 0,
  currency         TEXT    NOT NULL DEFAULT 'EUR',
  date             TEXT    NOT NULL DEFAULT '',
  description      TEXT    NOT NULL DEFAULT '',
  is_pending       INTEGER NOT NULL DEFAULT 0
);
`);
console.log('Nordigen tables created. Migration complete.');
