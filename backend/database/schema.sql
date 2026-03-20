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

-- ── Indexes for performance ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_entries_member ON entries(member);
CREATE INDEX IF NOT EXISTS idx_entries_cat    ON entries(cat);
CREATE INDEX IF NOT EXISTS idx_savings_member ON savings(member);
CREATE INDEX IF NOT EXISTS idx_savings_year   ON savings(year);
