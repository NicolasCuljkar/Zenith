'use strict';

const db             = require('../config/database');
const entriesService = require('./entries.service');

const FR_MONTHS   = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const AUTO_CATS   = ['revenu', 'impot', 'fixe'];
const MANUAL_CATS = ['variable', 'loisir'];
// 'epargne' is sourced from the savings table, not monthly_expenses

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// ── Helpers ──────────────────────────────────────────────────────

function buildUserWhere(filters) {
  const cond = [];
  const params = [];
  if (filters.userIds && filters.userIds.length > 0) {
    cond.push(`user_id IN (${filters.userIds.map(() => '?').join(',')})`);
    params.push(...filters.userIds);
  } else if (filters.userId) {
    cond.push('user_id = ?');
    params.push(filters.userId);
  }
  return { cond, params };
}

// Map<entry_id, { id, amount }> for monthly overrides of auto-cat entries
function getOverridesMap(filters) {
  const { cond, params } = buildUserWhere(filters);
  cond.push('entry_id IS NOT NULL');
  if (filters.year)  { cond.push('year = ?');  params.push(Number(filters.year));  }
  if (filters.month) { cond.push('month = ?'); params.push(Number(filters.month)); }
  const rows = db.prepare(`SELECT entry_id, id, amount FROM monthly_expenses WHERE ${cond.join(' AND ')}`).all(...params);
  return new Map(rows.map(r => [r.entry_id, { id: r.id, amount: r.amount }]));
}

// Total épargne from savings table for a given month
function getSavingsActual(filters) {
  if (!filters.year || !filters.month) return 0;
  const frMonth = FR_MONTHS[Number(filters.month) - 1];
  if (!frMonth) return 0;
  const { cond, params } = buildUserWhere(filters);
  cond.push('year = ?', 'month = ?');
  params.push(Number(filters.year), frMonth);
  const row = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM savings WHERE ${cond.join(' AND ')}`).get(...params);
  return row?.total || 0;
}

// ── Lecture ──────────────────────────────────────────────────────

function getAll(filters = {}) {
  const { cond, params } = buildUserWhere(filters);

  if (filters.year)  { cond.push('year = ?');  params.push(Number(filters.year));  }
  if (filters.month) { cond.push('month = ?'); params.push(Number(filters.month)); }
  if (filters.cat)   { cond.push('cat = ?');   params.push(filters.cat); }

  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
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
  let allEntries = entriesService.getAll(entryScope);

  // Filtre par membre si vue spécifique (pas Commun/all)
  if (filters.member && filters.member !== 'all' && filters.member !== 'Commun') {
    allEntries = allEntries.filter(e => e.member === filters.member);
  }

  const manualExpenses = getAll(filters);
  const overrides      = getOverridesMap(filters);
  const epargneActual  = getSavingsActual(filters);

  const result = {};
  for (const cat of [...AUTO_CATS, 'variable', 'epargne', 'loisir']) {
    const catEntries = allEntries.filter(e => e.cat === cat);
    const budget     = catEntries.reduce((s, e) => s + Math.abs(e.amount), 0);

    let actual;
    if (AUTO_CATS.includes(cat)) {
      // Base : override si existe, sinon budget prévisionnel
      actual = catEntries.reduce((s, e) => {
        const ov = overrides.get(e.id);
        return s + (ov !== undefined ? Math.abs(ov.amount) : Math.abs(e.amount));
      }, 0);
      // Plus dépenses exceptionnelles pour ce cat (sans entry_id)
      actual += manualExpenses.filter(e => e.cat === cat && !e.entry_id).reduce((s, e) => s + Math.abs(e.amount), 0);
    } else if (cat === 'epargne') {
      actual = epargneActual;
    } else {
      actual = manualExpenses.filter(e => e.cat === cat && !e.entry_id).reduce((s, e) => s + Math.abs(e.amount), 0);
    }

    result[cat] = { budget, actual, diff: budget - actual };
  }

  return result;
}

// Historique : liste des mois ayant des données saisies
function getHistory(filters = {}) {
  const { cond, params } = buildUserWhere(filters);
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  return db.prepare(`
    SELECT year, month, COUNT(*) as count, SUM(ABS(amount)) as total
    FROM monthly_expenses ${where}
    GROUP BY year, month
    ORDER BY year DESC, month DESC
    LIMIT 24
  `).all(...params);
}

// ── Écriture ─────────────────────────────────────────────────────

function create({ year, month, name, amount, cat, member, note, entry_id }, userId) {
  if (!name || !name.trim())  throw httpError('La désignation est requise.', 400);
  if (isNaN(Number(amount))) throw httpError('Le montant doit être un nombre.', 400);
  if (!year || !month)       throw httpError('Année et mois requis.', 400);

  const isAuto   = AUTO_CATS.includes(cat);
  const isManual = MANUAL_CATS.includes(cat);
  if (!isAuto && !isManual) throw httpError(`Catégorie invalide : ${cat}`, 400);
  // entry_id requis uniquement pour les overrides (cat auto + entry_id fourni) — sans entry_id c'est une dépense exceptionnelle

  const result = db.prepare(`
    INSERT INTO monthly_expenses (user_id, year, month, name, amount, cat, member, note, entry_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(userId, Number(year), Number(month), name.trim(), Number(amount), cat, member, note || null, entry_id || null);

  return getById(result.lastInsertRowid);
}

function update(id, { name, amount, cat, member, note, entry_id }, userId) {
  const existing = getById(id);
  if (!existing)                   throw httpError('Dépense introuvable.', 404);
  if (existing.user_id !== userId) throw httpError('Non autorisé.', 403);

  const updatedName    = name      !== undefined ? name.trim()      : existing.name;
  const updatedAmount  = amount    !== undefined ? Number(amount)   : existing.amount;
  const updatedCat     = cat       !== undefined ? cat              : existing.cat;
  const updatedMember  = member    !== undefined ? member           : existing.member;
  const updatedNote    = note      !== undefined ? note             : existing.note;
  const updatedEntryId = entry_id  !== undefined ? entry_id        : existing.entry_id;

  if (!AUTO_CATS.includes(updatedCat) && !MANUAL_CATS.includes(updatedCat)) throw httpError(`Catégorie invalide : ${updatedCat}`, 400);

  db.prepare(`
    UPDATE monthly_expenses
    SET name = ?, amount = ?, cat = ?, member = ?, note = ?, entry_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(updatedName, updatedAmount, updatedCat, updatedMember, updatedNote, updatedEntryId, id);

  return getById(id);
}

function remove(id, userId) {
  const existing = getById(id);
  if (!existing)                   throw httpError('Dépense introuvable.', 404);
  if (existing.user_id !== userId) throw httpError('Non autorisé.', 403);
  db.prepare('DELETE FROM monthly_expenses WHERE id = ?').run(id);
  return { deleted: true };
}

module.exports = { getAll, getById, getStats, getHistory, create, update, remove };
