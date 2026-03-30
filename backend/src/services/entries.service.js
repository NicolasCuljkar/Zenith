'use strict';

const db = require('../config/database');

const VALID_CATS = ['revenu', 'impot', 'fixe', 'variable', 'epargne', 'loisir'];

// Membres valides pour un utilisateur = lui-même + membres du foyer + 'Commun'
function getValidMembers(userId) {
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  if (!user) return ['Commun'];
  const householdRow = db.prepare(`
    SELECT hm2.user_id FROM household_members hm1
    JOIN household_members hm2 ON hm2.household_id = hm1.household_id
    WHERE hm1.user_id = ?
  `).all(userId);
  const names = householdRow.length
    ? [...new Set(householdRow.map(r => db.prepare('SELECT name FROM users WHERE id = ?').get(r.user_id)?.name).filter(Boolean))]
    : [user.name];
  return [...names, 'Commun'];
}

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// ── Lecture ──────────────────────────────────────────────────────

function getAll(filters = {}) {
  const conditions = [];
  const params     = [];

  // Isolation par user_id — clé du fix : on ne filtre plus par nom (member)
  if (filters.userIds && filters.userIds.length > 0) {
    // Vue Commun foyer : entrées de tous les membres du foyer
    const placeholders = filters.userIds.map(() => '?').join(',');
    conditions.push(`user_id IN (${placeholders})`);
    params.push(...filters.userIds);
  } else if (filters.userId) {
    // Vue personnelle : uniquement les entrées de cet utilisateur
    conditions.push('user_id = ?');
    params.push(filters.userId);
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
    SELECT id, user_id, name, amount, cat, member, sort_order, created_at, updated_at
    FROM entries
    ${where}
    ORDER BY member ASC, sort_order ASC, ABS(amount) DESC
  `).all(...params);
}

function getById(id) {
  return db.prepare('SELECT * FROM entries WHERE id = ?').get(id) || null;
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

// ── Écriture ─────────────────────────────────────────────────────

function create({ name, amount, cat, member }, userId) {
  if (!name || !name.trim())                        throw httpError('La désignation est requise.', 400);
  if (isNaN(Number(amount)))                        throw httpError('Le montant doit être un nombre.', 400);
  if (!VALID_CATS.includes(cat))                    throw httpError(`Catégorie invalide : ${cat}`, 400);
  if (!getValidMembers(userId).includes(member))    throw httpError(`Membre invalide : ${member}`, 400);

  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) AS m FROM entries WHERE member = ?'
  ).get(member).m;

  const result = db.prepare(`
    INSERT INTO entries (user_id, name, amount, cat, member, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(userId, name.trim(), Number(amount), cat, member, maxOrder + 1);

  return getById(result.lastInsertRowid);
}

function update(id, { name, amount, cat, member }, userId) {
  const existing = getById(id);
  if (!existing) throw httpError('Ligne budgétaire introuvable.', 404);

  // Seul le propriétaire peut modifier (sauf entrées 'Commun' = tout le monde)
  if (existing.member !== 'Commun' && existing.user_id !== userId) {
    throw httpError('Non autorisé à modifier cette ligne.', 403);
  }

  if (cat    !== undefined && !VALID_CATS.includes(cat))                    throw httpError(`Catégorie invalide : ${cat}`, 400);
  if (member !== undefined && !getValidMembers(userId).includes(member))   throw httpError(`Membre invalide : ${member}`, 400);
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

function remove(id, userId) {
  const existing = getById(id);
  if (!existing) throw httpError('Ligne budgétaire introuvable.', 404);

  // Seul le propriétaire peut supprimer (sauf entrées 'Commun' = tout le monde)
  if (existing.member !== 'Commun' && existing.user_id !== userId) {
    throw httpError('Non autorisé à supprimer cette ligne.', 403);
  }

  db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  return { deleted: true };
}

function updateOrder(memberName, groupKey, orderedIds, userId) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return { updated: true };

  // Vérifie que chaque ID appartient à l'utilisateur ou est une entrée Commun
  const placeholders = orderedIds.map(() => '?').join(',');
  const owned = db.prepare(
    `SELECT id FROM entries WHERE id IN (${placeholders}) AND (user_id = ? OR member = 'Commun')`
  ).all(...orderedIds, userId);

  if (owned.length !== orderedIds.length) {
    throw httpError('Non autorisé à réordonner ces lignes.', 403);
  }

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
