'use strict';

const db             = require('../config/database');
const entriesService = require('./entries.service');

// Catégories auto-renseignées depuis les lignes budgétaires (montant prévu = réel)
const AUTO_CATS   = ['revenu', 'impot', 'fixe'];
// Catégories à saisir manuellement chaque mois
const MANUAL_CATS = ['variable', 'epargne', 'loisir'];

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// ── Lecture ──────────────────────────────────────────────────────

function getAll(filters = {}) {
  const conditions = [];
  const params     = [];

  if (filters.userIds && filters.userIds.length > 0) {
    const ph = filters.userIds.map(() => '?').join(',');
    conditions.push(`user_id IN (${ph})`);
    params.push(...filters.userIds);
  } else if (filters.userId) {
    conditions.push('user_id = ?');
    params.push(filters.userId);
  }

  if (filters.year)  { conditions.push('year = ?');  params.push(Number(filters.year));  }
  if (filters.month) { conditions.push('month = ?'); params.push(Number(filters.month)); }
  if (filters.cat)   { conditions.push('cat = ?');   params.push(filters.cat); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`
    SELECT * FROM monthly_expenses ${where}
    ORDER BY cat ASC, created_at ASC
  `).all(...params);
}

function getById(id) {
  return db.prepare('SELECT * FROM monthly_expenses WHERE id = ?').get(id) || null;
}

// Retourne les stats comparatives budget prévu vs réel pour un mois donné
function getStats(filters = {}) {
  const entryScope = filters.userIds ? { userIds: filters.userIds } : { userId: filters.userId };
  const allEntries = entriesService.getAll(entryScope);
  const manualExpenses = getAll(filters);

  const result = {};
  for (const cat of [...AUTO_CATS, ...MANUAL_CATS]) {
    const budget = allEntries
      .filter(e => e.cat === cat)
      .reduce((s, e) => s + Math.abs(e.amount), 0);

    // Les catégories auto ont actual = budget (pas de saisie manuelle)
    const actual = AUTO_CATS.includes(cat)
      ? budget
      : manualExpenses.filter(e => e.cat === cat).reduce((s, e) => s + Math.abs(e.amount), 0);

    result[cat] = { budget, actual, diff: budget - actual };
  }

  return result;
}

// Historique : liste des mois ayant des données saisies
function getHistory(filters = {}) {
  const conditions = [];
  const params     = [];

  if (filters.userIds && filters.userIds.length > 0) {
    const ph = filters.userIds.map(() => '?').join(',');
    conditions.push(`user_id IN (${ph})`);
    params.push(...filters.userIds);
  } else if (filters.userId) {
    conditions.push('user_id = ?');
    params.push(filters.userId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`
    SELECT year, month, COUNT(*) as count, SUM(ABS(amount)) as total
    FROM monthly_expenses ${where}
    GROUP BY year, month
    ORDER BY year DESC, month DESC
    LIMIT 24
  `).all(...params);
}

// ── Écriture ─────────────────────────────────────────────────────

function create({ year, month, name, amount, cat, member, note }, userId) {
  if (!name || !name.trim())      throw httpError('La désignation est requise.', 400);
  if (isNaN(Number(amount)))      throw httpError('Le montant doit être un nombre.', 400);
  if (!MANUAL_CATS.includes(cat)) throw httpError(`Catégorie invalide pour la saisie manuelle : ${cat}`, 400);
  if (!year || !month)            throw httpError('Année et mois requis.', 400);

  const result = db.prepare(`
    INSERT INTO monthly_expenses (user_id, year, month, name, amount, cat, member, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(userId, Number(year), Number(month), name.trim(), Number(amount), cat, member, note || null);

  return getById(result.lastInsertRowid);
}

function update(id, { name, amount, cat, member, note }, userId) {
  const existing = getById(id);
  if (!existing)                throw httpError('Dépense introuvable.', 404);
  if (existing.user_id !== userId) throw httpError('Non autorisé.', 403);

  const updatedName   = name   !== undefined ? name.trim()    : existing.name;
  const updatedAmount = amount !== undefined ? Number(amount) : existing.amount;
  const updatedCat    = cat    !== undefined ? cat            : existing.cat;
  const updatedMember = member !== undefined ? member         : existing.member;
  const updatedNote   = note   !== undefined ? note           : existing.note;

  if (!MANUAL_CATS.includes(updatedCat)) throw httpError(`Catégorie invalide : ${updatedCat}`, 400);

  db.prepare(`
    UPDATE monthly_expenses
    SET name = ?, amount = ?, cat = ?, member = ?, note = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(updatedName, updatedAmount, updatedCat, updatedMember, updatedNote, id);

  return getById(id);
}

function remove(id, userId) {
  const existing = getById(id);
  if (!existing)                throw httpError('Dépense introuvable.', 404);
  if (existing.user_id !== userId) throw httpError('Non autorisé.', 403);
  db.prepare('DELETE FROM monthly_expenses WHERE id = ?').run(id);
  return { deleted: true };
}

module.exports = { getAll, getById, getStats, getHistory, create, update, remove };
