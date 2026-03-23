'use strict';

const db = require('../config/database');

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

function computeDelta(member, year, month, amount, excludeId = null) {
  const prev = db.prepare(`
    SELECT amount FROM savings
    WHERE member = ?
      AND (year < ? OR (year = ? AND month != ?))
      ${excludeId ? 'AND id != ?' : ''}
    ORDER BY year DESC, ${MONTH_CASE} DESC
    LIMIT 1
  `).get(...[member, year, year, month, ...(excludeId ? [excludeId] : [])]);

  return prev ? amount - prev.amount : null;
}

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

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.prepare(`
    SELECT id, member, year, month, amount, delta, created_at, updated_at
    FROM savings
    ${where}
    ORDER BY member ASC, year ASC, ${MONTH_CASE} ASC
  `).all(...params);
}

function getById(id) {
  return db.prepare('SELECT * FROM savings WHERE id = ?').get(id) || null;
}

function create({ member, year, month, amount }) {
  if (!getValidMembers().includes(member))    throw httpError(`Membre invalide : ${member}`, 400);
  if (!month || !VALID_MONTHS.includes(month)) throw httpError(`Mois invalide : ${month}`, 400);
  if (isNaN(Number(amount)))                   throw httpError('Le montant doit être un nombre.', 400);

  const yr  = Number(year);
  const dup = db.prepare('SELECT id FROM savings WHERE member = ? AND year = ? AND month = ?').get(member, yr, month);
  if (dup) throw httpError(`Une entrée existe déjà pour ${member} — ${month} ${yr}.`, 409);

  const delta  = computeDelta(member, yr, month, Number(amount));
  const result = db.prepare(`
    INSERT INTO savings (member, year, month, amount, delta, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(member, yr, month, Number(amount), delta);

  return getById(result.lastInsertRowid);
}

function update(id, { member, year, month, amount }) {
  const existing = getById(id);
  if (!existing) throw httpError("Entrée d'épargne introuvable.", 404);

  const updatedMember = member !== undefined ? member        : existing.member;
  const updatedYear   = year   !== undefined ? Number(year)  : existing.year;
  const updatedMonth  = month  !== undefined ? month         : existing.month;
  const updatedAmount = amount !== undefined ? Number(amount): existing.amount;

  if (!getValidMembers().includes(updatedMember))    throw httpError(`Membre invalide : ${updatedMember}`, 400);
  if (!VALID_MONTHS.includes(updatedMonth))           throw httpError(`Mois invalide : ${updatedMonth}`, 400);
  if (isNaN(updatedAmount))                           throw httpError('Le montant doit être un nombre.', 400);

  const delta = computeDelta(updatedMember, updatedYear, updatedMonth, updatedAmount, id);

  db.prepare(`
    UPDATE savings
    SET member = ?, year = ?, month = ?, amount = ?, delta = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(updatedMember, updatedYear, updatedMonth, updatedAmount, delta, id);

  return getById(id);
}

function remove(id) {
  if (!getById(id)) throw httpError("Entrée d'épargne introuvable.", 404);
  db.prepare('DELETE FROM savings WHERE id = ?').run(id);
  return { deleted: true };
}

module.exports = { getAll, getById, create, update, remove };
