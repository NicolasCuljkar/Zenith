const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./database/zenith.db');

// ── Épargne ──────────────────────────────────────────────────────────────────
const upsertSaving = db.prepare(`
  INSERT INTO savings (member, year, month, amount)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(member, year, month) DO UPDATE SET amount=excluded.amount
`);

const savings = [
  ['Carla', 2025, 'Décembre',  15219],
  ['Carla', 2026, 'Janvier',   15191],
  ['Carla', 2026, 'Février',   14905],
  ['Carla', 2026, 'Mars',      15584],
];

for (const [member, year, month, amount] of savings) {
  upsertSaving.run(member, year, month, amount);
  console.log(`  Épargne ${month} ${year} : ${amount} €`);
}

// ── Entrées budgétaires ───────────────────────────────────────────────────────
// Supprimer les anciennes entrées Carla pour repartir propre
db.prepare("DELETE FROM entries WHERE member = 'Carla'").run();

const insertEntry = db.prepare(`
  INSERT INTO entries (name, amount, cat, member) VALUES (?, ?, ?, 'Carla')
`);

const entries = [
  // Revenus
  ['Salaire',            400,  'revenu'],
  ['Virements',          810,  'revenu'],
  ['CAF',                153,  'revenu'],
  ['Bourse',             145,  'revenu'],
  // Charges fixes
  ['Loyer',             -450,  'fixe'],
  ['Electricité & Wifi',  -38,  'fixe'],
  ['Canal+',              -22,  'fixe'],
  ['iCloud',              -10,  'fixe'],
  ['Spotify',              -7,  'fixe'],
  // Charges variables
  ['Courses',           -250,  'variable'],
  ['Carburant',         -100,  'variable'],
];

for (const [name, amount, cat] of entries) {
  insertEntry.run(name, amount, cat);
  console.log(`  ${cat.padEnd(8)} ${name.padEnd(22)} ${amount > 0 ? '+' : ''}${amount} €`);
}

console.log('\nTerminé — données Carla insérées avec succès.');
