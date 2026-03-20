/**
 * savings.service.js — Savings records (épargne cumulée mensuelle) business logic.
 * Handles CRUD operations with automatic delta computation.
 */

'use strict';

const db = require('../config/database');

/**
 * getValidMembers() — Returns valid member names from the users table (no Commun for savings).
 * @returns {string[]}
 */
function getValidMembers() {
  const rows = db.prepare('SELECT name FROM users').all();
  return rows.map(r => r.name);
}

const VALID_MONTHS = [
  'Janvier','Février','Mars','Avril','Mai','Juin',
  'Juillet','Août','Septembre','Octobre','Novembre','Décembre'
];

/**
 * Compute delta for a savings record relative to its chronological predecessor.
 * @param {string} member
 * @param {number} year
 * @param {string} month
 * @param {number} amount
 * @param {number|null} excludeId — id to exclude (for update operations)
 * @returns {number|null} delta or null if first record
 */
function computeDelta(member, year, month, amount, excludeId = null) {
  const monthIdx = VALID_MONTHS.indexOf(month);

  // Get the chronologically previous savings record for this member
  const prev = db.prepare(`
    SELECT amount FROM savings
    WHERE member = ?
      AND (year < ? OR (year = ? AND month != ?))
      ${excludeId ? 'AND id != ?' : ''}
    ORDER BY year DESC,
      CASE month
        WHEN 'Janvier'   THEN 1
        WHEN 'Février'   THEN 2
        WHEN 'Mars'      THEN 3
        WHEN 'Avril'     THEN 4
        WHEN 'Mai'       THEN 5
        WHEN 'Juin'      THEN 6
        WHEN 'Juillet'   THEN 7
        WHEN 'Août'      THEN 8
        WHEN 'Septembre' THEN 9
        WHEN 'Octobre'   THEN 10
        WHEN 'Novembre'  THEN 11
        WHEN 'Décembre'  THEN 12
      END DESC
    LIMIT 1
  `).get(...[member, year, year, month, ...(excludeId ? [excludeId] : [])]);

  return prev ? amount - prev.amount : null;
}

/**
 * getAll(filters) — Retrieve savings records with optional filtering.
 * @param {{ member?: string, year?: number }} filters
 * @returns {Array}
 */
function getAll(filters = {}) {
  const conditions = [];
  const params     = [];

  if (filters.member && filters.member !== 'all') {
    conditions.push('member = ?');
    params.push(filters.member);
  }

  if (filters.year) {
    conditions.push('year = ?');
    params.push(Number(filters.year));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.prepare(`
    SELECT id, member, year, month, amount, delta, created_at, updated_at
    FROM savings
    ${where}
    ORDER BY member ASC, year ASC,
      CASE month
        WHEN 'Janvier'   THEN 1  WHEN 'Février'   THEN 2
        WHEN 'Mars'      THEN 3  WHEN 'Avril'      THEN 4
        WHEN 'Mai'       THEN 5  WHEN 'Juin'       THEN 6
        WHEN 'Juillet'   THEN 7  WHEN 'Août'       THEN 8
        WHEN 'Septembre' THEN 9  WHEN 'Octobre'    THEN 10
        WHEN 'Novembre'  THEN 11 WHEN 'Décembre'   THEN 12
      END ASC
  `).all(...params);
}

/**
 * getById(id) — Fetch a single savings record by id.
 * @param {number} id
 * @returns {object|null}
 */
function getById(id) {
  return db.prepare('SELECT * FROM savings WHERE id = ?').get(id) || null;
}

/**
 * create(data) — Insert a new savings record, auto-computing delta.
 * @param {{ member, year, month, amount }} data
 * @returns {object} created savings record
 */
function create({ member, year, month, amount }) {
  // Validation
  if (!getValidMembers().includes(member)) {
    const err = new Error(`Membre invalide : ${member}`);
    err.statusCode = 400;
    throw err;
  }
  if (!month || !VALID_MONTHS.includes(month)) {
    const err = new Error(`Mois invalide : ${month}`);
    err.statusCode = 400;
    throw err;
  }
  if (isNaN(Number(amount))) {
    const err = new Error('Le montant doit être un nombre.');
    err.statusCode = 400;
    throw err;
  }

  const yr = Number(year);

  // Check for duplicate
  const dup = db.prepare('SELECT id FROM savings WHERE member = ? AND year = ? AND month = ?').get(member, yr, month);
  if (dup) {
    const err = new Error(`Une entrée existe déjà pour ${member} — ${month} ${yr}.`);
    err.statusCode = 409;
    throw err;
  }

  const delta = computeDelta(member, yr, month, Number(amount));

  const result = db.prepare(`
    INSERT INTO savings (member, year, month, amount, delta, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(member, yr, month, Number(amount), delta);

  return getById(result.lastInsertRowid);
}

/**
 * update(id, data) — Update a savings record, re-computing delta.
 * @param {number} id
 * @param {{ member?, year?, month?, amount? }} data
 * @returns {object} updated savings record
 */
function update(id, { member, year, month, amount }) {
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Entrée d\'épargne introuvable.');
    err.statusCode = 404;
    throw err;
  }

  const updatedMember = member !== undefined ? member : existing.member;
  const updatedYear   = year   !== undefined ? Number(year) : existing.year;
  const updatedMonth  = month  !== undefined ? month : existing.month;
  const updatedAmount = amount !== undefined ? Number(amount) : existing.amount;

  // Validate
  if (!VALID_MEMBERS.includes(updatedMember)) {
    const err = new Error(`Membre invalide : ${updatedMember}`);
    err.statusCode = 400;
    throw err;
  }
  if (!VALID_MONTHS.includes(updatedMonth)) {
    const err = new Error(`Mois invalide : ${updatedMonth}`);
    err.statusCode = 400;
    throw err;
  }
  if (isNaN(updatedAmount)) {
    const err = new Error('Le montant doit être un nombre.');
    err.statusCode = 400;
    throw err;
  }

  const delta = computeDelta(updatedMember, updatedYear, updatedMonth, updatedAmount, id);

  db.prepare(`
    UPDATE savings
    SET member = ?, year = ?, month = ?, amount = ?, delta = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(updatedMember, updatedYear, updatedMonth, updatedAmount, delta, id);

  return getById(id);
}

/**
 * remove(id) — Delete a savings record.
 * @param {number} id
 * @returns {{ deleted: true }}
 */
function remove(id) {
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Entrée d\'épargne introuvable.');
    err.statusCode = 404;
    throw err;
  }
  db.prepare('DELETE FROM savings WHERE id = ?').run(id);
  return { deleted: true };
}

module.exports = { getAll, getById, create, update, remove };
