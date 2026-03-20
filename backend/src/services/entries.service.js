/**
 * entries.service.js — Budget entries (lignes budgétaires) business logic.
 * Handles CRUD operations and statistics computation.
 */

'use strict';

const db = require('../config/database');

const VALID_CATS = ['revenu', 'impot', 'fixe', 'variable', 'epargne', 'loisir'];

/**
 * getValidMembers() — Returns valid member names from the users table + 'Commun'.
 * @returns {string[]}
 */
function getValidMembers() {
  const rows = db.prepare('SELECT name FROM users').all();
  return [...rows.map(r => r.name), 'Commun'];
}

/**
 * getAll(filters) — Retrieve entries with optional filtering.
 * @param {{ member?: string, cat?: string, search?: string }} filters
 * @returns {Array} array of entry objects
 */
function getAll(filters = {}) {
  const conditions = [];
  const params     = [];

  if (filters.member && filters.member !== 'all') {
    if (filters.member === 'Commun') {
      // "Commun" view shows all entries (all members combined)
      // No filter needed — return everything
    } else {
      conditions.push('member = ?');
      params.push(filters.member);
    }
  }

  if (filters.cat) {
    conditions.push('cat = ?');
    params.push(filters.cat);
  }

  if (filters.search) {
    conditions.push('name LIKE ?');
    params.push(`%${filters.search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT id, name, amount, cat, member, sort_order, created_at, updated_at
    FROM entries
    ${where}
    ORDER BY member ASC, sort_order ASC, ABS(amount) DESC
  `).all(...params);

  return rows;
}

/**
 * create(data) — Insert a new entry.
 * @param {{ name, amount, cat, member }} data
 * @returns {object} created entry
 */
function create({ name, amount, cat, member }) {
  // Validation
  if (!name || name.trim() === '') {
    const err = new Error('La désignation est requise.');
    err.statusCode = 400;
    throw err;
  }
  if (isNaN(Number(amount))) {
    const err = new Error('Le montant doit être un nombre.');
    err.statusCode = 400;
    throw err;
  }
  if (!VALID_CATS.includes(cat)) {
    const err = new Error(`Catégorie invalide : ${cat}`);
    err.statusCode = 400;
    throw err;
  }
  if (!getValidMembers().includes(member)) {
    const err = new Error(`Membre invalide : ${member}`);
    err.statusCode = 400;
    throw err;
  }

  // Compute next sort_order for this member
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) AS m FROM entries WHERE member = ?'
  ).get(member).m;

  const result = db.prepare(`
    INSERT INTO entries (name, amount, cat, member, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(name.trim(), Number(amount), cat, member, maxOrder + 1);

  return getById(result.lastInsertRowid);
}

/**
 * getById(id) — Fetch a single entry by id.
 * @param {number} id
 * @returns {object|null}
 */
function getById(id) {
  return db.prepare('SELECT * FROM entries WHERE id = ?').get(id) || null;
}

/**
 * update(id, data) — Update an existing entry.
 * @param {number} id
 * @param {{ name?, amount?, cat?, member? }} data
 * @returns {object} updated entry
 */
function update(id, { name, amount, cat, member }) {
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Ligne budgétaire introuvable.');
    err.statusCode = 404;
    throw err;
  }

  // Validate provided fields
  if (cat !== undefined && !VALID_CATS.includes(cat)) {
    const err = new Error(`Catégorie invalide : ${cat}`);
    err.statusCode = 400;
    throw err;
  }
  if (member !== undefined && !getValidMembers().includes(member)) {
    const err = new Error(`Membre invalide : ${member}`);
    err.statusCode = 400;
    throw err;
  }
  if (amount !== undefined && isNaN(Number(amount))) {
    const err = new Error('Le montant doit être un nombre.');
    err.statusCode = 400;
    throw err;
  }

  const updatedName   = name   !== undefined ? name.trim()      : existing.name;
  const updatedAmount = amount !== undefined ? Number(amount)   : existing.amount;
  const updatedCat    = cat    !== undefined ? cat              : existing.cat;
  const updatedMember = member !== undefined ? member           : existing.member;

  db.prepare(`
    UPDATE entries
    SET name = ?, amount = ?, cat = ?, member = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(updatedName, updatedAmount, updatedCat, updatedMember, id);

  return getById(id);
}

/**
 * remove(id) — Delete an entry.
 * @param {number} id
 * @returns {{ deleted: true }}
 */
function remove(id) {
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Ligne budgétaire introuvable.');
    err.statusCode = 404;
    throw err;
  }
  db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  return { deleted: true };
}

/**
 * getStats(filters) — Compute revenues, expenses, balance, savings rate.
 * Mirrors the calcStats() function from the frontend mockup.
 * @param {{ member?: string }} filters
 * @returns {{ rev, tax, revNet, fix, vari, ep, loi, dep, rav, solde }}
 */
function getStats(filters = {}) {
  const entries = getAll(filters);

  const absSumCat = (cat) =>
    entries.filter(e => e.cat === cat).reduce((s, e) => s + Math.abs(e.amount), 0);

  const rev    = absSumCat('revenu');
  const tax    = absSumCat('impot');
  const revNet = rev - tax;
  const fix    = absSumCat('fixe');
  const vari   = absSumCat('variable');
  const ep     = absSumCat('epargne');
  const loi    = absSumCat('loisir');
  const dep    = fix + vari + loi;
  const rav    = revNet - fix - vari; // reste à vivre (before savings & leisure)

  return { rev, tax, revNet, fix, vari, ep, loi, dep, rav, solde: revNet - dep - ep };
}

/**
 * updateOrder(memberName, groupKey, orderedIds) — Persist drag-drop sort order.
 * @param {string} memberName
 * @param {string} groupKey — 'revenus' | 'depenses' | 'epargne'
 * @param {number[]} orderedIds — array of entry IDs in desired order
 */
function updateOrder(memberName, groupKey, orderedIds) {
  // node:sqlite n'a pas db.transaction() — on utilise BEGIN/COMMIT manuellement
  const updateStmt = db.prepare('UPDATE entries SET sort_order = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    orderedIds.forEach((id, index) => {
      updateStmt.run(index + 1, id);
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { updated: true };
}

module.exports = { getAll, create, getById, update, remove, getStats, updateOrder };
