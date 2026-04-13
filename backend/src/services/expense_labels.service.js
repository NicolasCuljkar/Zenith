'use strict';

const db = require('../config/database');
const householdService = require('./household.service');

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function getScopeCondition(userId) {
  const household = householdService.getForUser(userId);
  if (household && household.members.length > 0) {
    const ids = household.members.map(m => m.id);
    return { cond: `user_id IN (${ids.map(() => '?').join(',')})`, params: ids };
  }
  return { cond: 'user_id = ?', params: [userId] };
}

function getAll({ userId, cat } = {}) {
  const { cond, params } = getScopeCondition(userId);
  const catClause = cat ? ' AND cat = ?' : '';
  if (cat) params.push(cat);
  return db.prepare(
    `SELECT id, user_id, cat, name FROM expense_labels WHERE ${cond}${catClause} ORDER BY name ASC`
  ).all(...params);
}

function create({ cat, name }, userId) {
  if (!cat || !name || !name.trim()) throw httpError('Catégorie et désignation requises.', 400);
  try {
    const result = db.prepare(
      `INSERT INTO expense_labels (user_id, cat, name) VALUES (?, ?, ?)`
    ).run(userId, cat, name.trim());
    return db.prepare('SELECT * FROM expense_labels WHERE id = ?').get(result.lastInsertRowid);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) throw httpError('Cette désignation existe déjà.', 409);
    throw err;
  }
}

function remove(id, userId) {
  const existing = db.prepare('SELECT * FROM expense_labels WHERE id = ?').get(id);
  if (!existing) throw httpError('Désignation introuvable.', 404);
  // Allow any household member to delete
  const { params } = getScopeCondition(userId);
  if (!params.includes(existing.user_id)) throw httpError('Non autorisé.', 403);
  db.prepare('DELETE FROM expense_labels WHERE id = ?').run(id);
  return { deleted: true };
}

module.exports = { getAll, create, remove };
