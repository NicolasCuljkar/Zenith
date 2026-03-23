-- ══════════════════════════════════════════════════════════════════
-- Zénith Budget Manager — SQLite Schema
-- ══════════════════════════════════════════════════════════════════

-- ── Users table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'Autre',
  color         TEXT    NOT NULL DEFAULT '#3B8BD4',
  photo         TEXT,   -- base64 encoded image or NULL
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Settings table (key-value per user) ──────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        TEXT    NOT NULL,
  value      TEXT,
  UNIQUE(user_id, key)
);

-- ── Budget entries (lignes budgétaires mensuelles) ────────────────
CREATE TABLE IF NOT EXISTS entries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT    NOT NULL,
  amount    REAL    NOT NULL,  -- positive = revenue, negative = expense
  cat       TEXT    NOT NULL  CHECK(cat IN ('revenu','impot','fixe','variable','epargne','loisir')),
  member    TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT   NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT   NOT NULL DEFAULT (datetime('now'))
);

-- ── Savings (épargne cumulée mensuelle) ──────────────────────────
CREATE TABLE IF NOT EXISTS savings (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  member    TEXT    NOT NULL,
  year      INTEGER NOT NULL,
  month     TEXT    NOT NULL  CHECK(month IN ('Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre')),
  amount    REAL    NOT NULL,
  delta     REAL,             -- NULL for first entry, otherwise computed
  created_at TEXT  NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT  NOT NULL DEFAULT (datetime('now')),
  UNIQUE(member, year, month)
);

-- ── Bridge API — utilisateurs Bridge (un par utilisateur Zénith) ──
CREATE TABLE IF NOT EXISTS bridge_users (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  bridge_uuid      TEXT,
  bridge_email     TEXT    NOT NULL UNIQUE,
  bridge_password  TEXT    NOT NULL DEFAULT '',
  access_token     TEXT,
  token_expires_at TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Bridge API — connexions bancaires (items) ──────────────────────
CREATE TABLE IF NOT EXISTS bridge_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL UNIQUE,
  bank_name  TEXT,
  bank_logo  TEXT,
  status     INTEGER DEFAULT 0,
  synced_at  TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Bridge API — comptes bancaires ────────────────────────────────
CREATE TABLE IF NOT EXISTS bridge_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id    INTEGER NOT NULL UNIQUE,
  item_id       INTEGER NOT NULL,
  name          TEXT,
  balance       REAL,
  currency_code TEXT    DEFAULT 'EUR',
  type          INTEGER DEFAULT 0,
  iban          TEXT,
  updated_at    TEXT
);

-- ── Bridge API — transactions ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS bridge_transactions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id        INTEGER NOT NULL,
  transaction_id    INTEGER NOT NULL UNIQUE,
  amount            REAL,
  date              TEXT,
  description       TEXT,
  clean_description TEXT,
  category_id       INTEGER,
  is_future         INTEGER DEFAULT 0,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Nordigen (GoCardless Bank Account Data) ──────────────────────────────────
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

-- ── Indexes for performance ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_entries_member          ON entries(member);
CREATE INDEX IF NOT EXISTS idx_entries_cat             ON entries(cat);
CREATE INDEX IF NOT EXISTS idx_savings_member          ON savings(member);
CREATE INDEX IF NOT EXISTS idx_savings_year            ON savings(year);
CREATE INDEX IF NOT EXISTS idx_bridge_items_user       ON bridge_items(user_id);
CREATE INDEX IF NOT EXISTS idx_bridge_accounts_user    ON bridge_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_bridge_accounts_item    ON bridge_accounts(item_id);
CREATE INDEX IF NOT EXISTS idx_bridge_transactions_acc ON bridge_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_bridge_transactions_dt  ON bridge_transactions(date);
