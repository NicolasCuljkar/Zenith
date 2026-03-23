'use strict';

const db = require('../config/database');

const VALID_CATS = ['revenu', 'impot', 'fixe', 'variable', 'epargne', 'loisir'];

function getValidMembers() {
  return [...db.prepare('SELECT name FROM users').all().map(r => r.name), 'Commun'];
}

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function getAll(filters = {}) {
  const conditions = [];
  const params     = [];

  if (filters.member && filters.member !== 'all' && filters.member !== 'Commun') {
    conditions.push('member = ?');
    params.push(filters.member);
  }
  if (filters.cat) {
    conditions.push('cat = ?');
    params.push(filters.cat);
  }
  if (filters.search) {
    conditions.push('name LIKE ?');
    params.push(`%${filters.search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.prepare(`
    SELECT id, name, amount, cat, member, sort_order, created_at, updated_at
    FROM entries
    ${where}
    ORDER BY member ASC, sort_order ASC, ABS(amount) DESC
  `).all(...params);
}

function getById(id) {
  return db.prepare('SELECT * FROM entries WHERE id = ?').get(id) || null;
}

function create({ name, amount, cat, member }) {
  if (!name || !name.trim())              throw httpError('La désignation est requise.', 400);
  if (isNaN(Number(amount)))              throw httpError('Le montant doit être un nombre.', 400);
  if (!VALID_CATS.includes(cat))          throw httpError(`Catégorie invalide : ${cat}`, 400);
  if (!getValidMembers().includes(member)) throw httpError(`Membre invalide : ${member}`, 400);

  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) AS m FROM entries WHERE member = ?'
  ).get(member).m;

  const result = db.prepare(`
    INSERT INTO entries (name, amount, cat, member, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(name.trim(), Number(amount), cat, member, maxOrder + 1);

  return getById(result.lastInsertRowid);
}

function update(id, { name, amount, cat, member }) {
  const existing = getById(id);
  if (!existing) throw httpError('Ligne budgétaire introuvable.', 404);

  if (cat    !== undefined && !VALID_CATS.includes(cat))           throw httpError(`Catégorie invalide : ${cat}`, 400);
  if (member !== undefined && !getValidMembers().includes(member)) throw httpError(`Membre invalide : ${member}`, 400);
  if (amount !== undefined && isNaN(Number(amount)))               throw httpError('Le montant doit être un nombre.', 400);

  const updatedName   = name   !== undefined ? name.trim()    : existing.name;
  const updatedAmount = amount !== undefined ? Number(amount) : existing.amount;
  const updatedCat    = cat    !== undefined ? cat            : existing.cat;
  const updatedMember = member !== undefined ? member         : existing.member;

  db.prepare(`
    UPDATE entries
    SET name = ?, amount = ?, cat = ?, member = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(updatedName, updatedAmount, updatedCat, updatedMember, id);

  return getById(id);
}

function remove(id) {
  if (!getById(id)) throw httpError('Ligne budgétaire introuvable.', 404);
  db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  return { deleted: true };
}

function getStats(filters = {}) {
  const entries = getAll(filters);
  const sum = (cat) => entries.filter(e => e.cat === cat).reduce((s, e) => s + Math.abs(e.amount), 0);

  const rev    = sum('revenu');
  const tax    = sum('impot');
  const revNet = rev - tax;
  const fix    = sum('fixe');
  const vari   = sum('variable');
  const ep     = sum('epargne');
  const loi    = sum('loisir');
  const dep    = fix + vari + loi;
  const rav    = revNet - fix - vari;

  return { rev, tax, revNet, fix, vari, ep, loi, dep, rav, solde: revNet - dep - ep };
}

function updateOrder(memberName, groupKey, orderedIds) {
  const updateStmt = db.prepare('UPDATE entries SET sort_order = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    orderedIds.forEach((id, index) => updateStmt.run(index + 1, id));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { updated: true };
}

module.exports = { getAll, create, getById, update, remove, getStats, updateOrder };
