'use strict';

const db = require('../config/database');

// Doit rester identique à MONTHS dans frontend/index.html
const VALID_MONTHS = [
  'Janvier','Février','Mars','Avril','Mai','Juin',
  'Juillet','Août','Septembre','Octobre','Novembre','Décembre',
];

function getValidMembers() {
  return db.prepare('SELECT name FROM users').all().map(r => r.name);
}

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const MONTH_CASE = `
  CASE month
    WHEN 'Janvier'   THEN 1  WHEN 'Février'   THEN 2
    WHEN 'Mars'      THEN 3  WHEN 'Avril'     THEN 4
    WHEN 'Mai'       THEN 5  WHEN 'Juin'      THEN 6
    WHEN 'Juillet'   THEN 7  WHEN 'Août'      THEN 8
    WHEN 'Septembre' THEN 9  WHEN 'Octobre'   THEN 10
    WHEN 'Novembre'  THEN 11 WHEN 'Décembre'  THEN 12
  END`;

// Calcule le delta par rapport à l'entrée précédente du même user
function computeDelta(userId, year, month, amount, excludeId = null) {
  const monthNum = VALID_MONTHS.indexOf(month) + 1;
  if (monthNum === 0) return null;
  const params = [userId, year, year, monthNum];
  if (excludeId) params.push(excludeId);
  const prev = db.prepare(`
    SELECT amount FROM savings
    WHERE user_id = ?
      AND (year < ? OR (year = ? AND ${MONTH_CASE} < ?))
      ${excludeId ? 'AND id != ?' : ''}
    ORDER BY year DESC, ${MONTH_CASE} DESC
    LIMIT 1
  `).get(...params);
  return prev != null ? amount - prev.amount : null;
}

// Recalcule le delta de l'entrée qui suit (year, month) — à appeler après update/delete
function recomputeNextDelta(userId, year, month) {
  const monthNum = VALID_MONTHS.indexOf(month) + 1;
  if (monthNum === 0) return;
  const next = db.prepare(`
    SELECT id, year, month, amount FROM savings
    WHERE user_id = ?
      AND (year > ? OR (year = ? AND ${MONTH_CASE} > ?))
    ORDER BY year ASC, ${MONTH_CASE} ASC
    LIMIT 1
  `).get(userId, year, year, monthNum);
  if (!next) return;
  const newDelta = computeDelta(userId, next.year, next.month, next.amount);
  db.prepare(`UPDATE savings SET delta = ?, updated_at = datetime('now') WHERE id = ?`).run(newDelta, next.id);
}

// ── Lecture ──────────────────────────────────────────────────────

function getAll(filters = {}) {
  const conditions = [];
  const params     = [];

  if (filters.userIds && filters.userIds.length > 0) {
    conditions.push(`user_id IN (${filters.userIds.map(() => '?').join(',')})`);
    params.push(...filters.userIds);
  } else if (filters.userId) {
    conditions.push('user_id = ?');
    params.push(filters.userId);
  }

  if (filters.member && filters.member !== 'all' && filters.member !== 'Commun') {
    conditions.push('member = ?');
    params.push(filters.member);
  }

  if (filters.year) {
    conditions.push('year = ?');
    params.push(Number(filters.year));
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.prepare(`
    SELECT id, user_id, member, year, month, amount, delta, created_at, updated_at
    FROM savings
    ${where}
    ORDER BY member ASC, year ASC, ${MONTH_CASE} ASC
  `).all(...params);
}

function getById(id) {
  return db.prepare('SELECT * FROM savings WHERE id = ?').get(id) || null;
}

// ── Écriture ─────────────────────────────────────────────────────

function create({ member, year, month, amount }, userId) {
  // member doit correspondre au nom de l'utilisateur connecté
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  if (!user) throw httpError('Utilisateur introuvable.', 404);
  if (user.name !== member) throw httpError(`Vous ne pouvez créer des épargnes que pour votre propre compte.`, 403);

  if (!VALID_MONTHS.includes(month)) throw httpError(`Mois invalide : ${month}`, 400);
  if (isNaN(Number(amount)))         throw httpError('Le montant doit être un nombre.', 400);

  const yr  = Number(year);
  const dup = db.prepare('SELECT id FROM savings WHERE user_id = ? AND year = ? AND month = ?').get(userId, yr, month);
  if (dup) throw httpError(`Une entrée existe déjà pour ${month} ${yr}.`, 409);

  const delta  = computeDelta(userId, yr, month, Number(amount));
  const result = db.prepare(`
    INSERT INTO savings (user_id, member, year, month, amount, delta, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(userId, member, yr, month, Number(amount), delta);

  return getById(result.lastInsertRowid);
}

function update(id, { member, year, month, amount }, userId) {
  const existing = getById(id);
  if (!existing) throw httpError("Entrée d'épargne introuvable.", 404);

  // Seul le propriétaire peut modifier
  if (existing.user_id !== userId) throw httpError('Non autorisé à modifier cette entrée.', 403);

  const updatedYear   = year   !== undefined ? Number(year)   : existing.year;
  const updatedMonth  = month  !== undefined ? month          : existing.month;
  const updatedAmount = amount !== undefined ? Number(amount) : existing.amount;
  // member ne peut pas changer (lié au compte)
  const updatedMember = existing.member;

  if (!VALID_MONTHS.includes(updatedMonth)) throw httpError(`Mois invalide : ${updatedMonth}`, 400);
  if (isNaN(updatedAmount))                 throw httpError('Le montant doit être un nombre.', 400);

  const delta = computeDelta(userId, updatedYear, updatedMonth, updatedAmount, id);

  db.prepare(`
    UPDATE savings
    SET year = ?, month = ?, amount = ?, delta = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(updatedYear, updatedMonth, updatedAmount, delta, id);

  // Recalcule le delta de l'entrée suivante (elle référençait l'ancienne valeur)
  recomputeNextDelta(userId, updatedYear, updatedMonth);

  return getById(id);
}

function remove(id, userId) {
  const existing = getById(id);
  if (!existing) throw httpError("Entrée d'épargne introuvable.", 404);

  if (existing.user_id !== userId) throw httpError('Non autorisé à supprimer cette entrée.', 403);

  db.prepare('DELETE FROM savings WHERE id = ?').run(id);
  // Recalcule le delta de l'entrée suivante (elle référençait l'entrée supprimée)
  recomputeNextDelta(userId, existing.year, existing.month);
  return { deleted: true };
}

module.exports = { getAll, getById, create, update, remove };
