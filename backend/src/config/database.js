'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs   = require('fs');
const path = require('path');

const DB_PATH    = path.resolve(__dirname, '../../', process.env.DB_PATH || './database/zenith.db');
const SCHEMA_SQL = path.resolve(__dirname, '../../database/schema.sql');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const schema = fs.readFileSync(SCHEMA_SQL, 'utf8');
db.exec(schema);

console.log(`[DB] ${DB_PATH}`);

module.exports = db;
