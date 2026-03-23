const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./database/zenith.db');

// Find Carla's user
const carla = db.prepare("SELECT * FROM users WHERE name = 'Carla'").get();
if (!carla) { console.log('Aucun compte Carla trouvé.'); process.exit(0); }

console.log(`Suppression du compte : ${carla.name} (${carla.email}) — id: ${carla.id}`);

// Delete entries
const e = db.prepare("DELETE FROM entries WHERE member = 'Carla'").run();
console.log(`  ${e.changes} ligne(s) budgétaire(s) supprimée(s)`);

// Delete savings
const s = db.prepare("DELETE FROM savings WHERE member = 'Carla'").run();
console.log(`  ${s.changes} enregistrement(s) d'épargne supprimé(s)`);

// Delete bridge data
db.prepare('DELETE FROM bridge_transactions WHERE account_id IN (SELECT account_id FROM bridge_accounts WHERE user_id = ?)').run(carla.id);
db.prepare('DELETE FROM bridge_accounts WHERE user_id = ?').run(carla.id);
db.prepare('DELETE FROM bridge_items WHERE user_id = ?').run(carla.id);
db.prepare('DELETE FROM bridge_users WHERE user_id = ?').run(carla.id);

// Delete user account
db.prepare('DELETE FROM users WHERE id = ?').run(carla.id);
console.log('  Compte utilisateur supprimé.');
console.log('\nTerminé — Carla peut se réinscrire et ressaisir ses données.');
