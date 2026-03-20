'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.resolve(__dirname, 'zenith.db'));
db.exec('PRAGMA journal_mode = WAL');

const insert = db.prepare(`
  INSERT INTO entries (name, amount, cat, member, sort_order, updated_at)
  VALUES (?, ?, ?, ?, ?, datetime('now'))
`);

const entries = [
  // Revenus
  { name: 'Salaire',          amount: 400,  cat: 'revenu'   },
  { name: 'Virements',        amount: 810,  cat: 'revenu'   },
  { name: 'CAF',              amount: 153,  cat: 'revenu'   },
  { name: 'Bourse',           amount: 145,  cat: 'revenu'   },
  // Dépenses fixes
  { name: 'Loyer',            amount: -450, cat: 'fixe'     },
  { name: 'Electricité & Wifi', amount: -38, cat: 'fixe'   },
  { name: 'Canal +',          amount: -22,  cat: 'fixe'     },
  { name: 'Icloud',           amount: -10,  cat: 'fixe'     },
  { name: 'Spotify',          amount: -7,   cat: 'fixe'     },
  // Dépenses variables
  { name: 'Courses',          amount: -250, cat: 'variable' },
  { name: 'Carburant',        amount: -100, cat: 'variable' },
];

db.exec('BEGIN');
try {
  entries.forEach((e, i) => insert.run(e.name, e.amount, e.cat, 'Carla', i + 1));
  db.exec('COMMIT');
  console.log(`✓ ${entries.length} lignes insérées pour Carla.`);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('Erreur :', err.message);
}
