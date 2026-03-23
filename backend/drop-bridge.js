const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./database/zenith.db');
db.exec('DROP TABLE IF EXISTS bridge_users');
console.log('Done — bridge_users table dropped.');
