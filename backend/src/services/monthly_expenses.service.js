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
  if (filters.member && filters.member !== 'all' && filters.member !== 'Commun') {
    cond.push('member = ?');
    params.push(filters.member);
  }
  cond.push('year = ?', 'month = ?');
  params.push(Number(filters.year), frMonth);
  const row = db.prepare(`SELECT COALESCE(SUM(delta), 0) AS total FROM savings WHERE ${cond.join(' AND ')} AND delta IS NOT NULL`).get(...params);
  return row?.total || 0;
}

// ── Lecture ──────────────────────────────────────────────────────

function getAll(filters = {}) {
  const { cond, params } = buildUserWhere(filters);

  if (filters.year)  { cond.push('year = ?');  params.push(Number(filters.year));  }
  if (filters.month) { cond.push('month = ?'); params.push(Number(filters.month)); }
  if (filters.cat)   { cond.push('cat = ?');   params.push(filters.cat); }
  if (filters.member && filters.member !== 'all' && filters.member !== 'Commun') {
    cond.push('member = ?'); params.push(filters.member);
  }

  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  return db.prepare(`
    SELECT * FROM monthly_expenses ${where}
    ORDER BY cat ASC, created_at ASC
  `).all(...params);
}

function getById(id) {
  return db.prepare('SELECT * FROM monthly_expenses WHERE id = ?').get(id) || null;
}

// Noms distincts utilisés par un user pour une catégorie donnée (triés par fréquence)
function getDistinctNames(userId, cat) {
  return db.prepare(`
    SELECT name, COUNT(*) AS freq
    FROM monthly_expenses
    WHERE user_id = ? AND cat = ? AND entry_id IS NULL
    GROUP BY name
    ORDER BY freq DESC, name ASC
  `).all(userId, cat).map(r => r.name);
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
      // Plus dépenses manuelles pour ce cat (sans entry_id)
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

// Historique : total réel = fixes (prévisionnel + overrides) + variables + loisirs + épargne
function getHistory(filters = {}) {
  const entryScope = filters.userIds ? { userIds: filters.userIds } : { userId: filters.userId };
  let fixeEntries = entriesService.getAll(entryScope).filter(e => e.cat === 'fixe');
  if (filters.member && filters.member !== 'all' && filters.member !== 'Commun') {
    fixeEntries = fixeEntries.filter(e => e.member === filters.member);
  }

  // Dépenses manuelles fixes/variables/loisirs + overrides fixes
  const { cond: expCond, params: expParams } = buildUserWhere(filters);
  if (filters.member && filters.member !== 'all' && filters.member !== 'Commun') {
    expCond.push('member = ?'); expParams.push(filters.member);
  }
  expCond.push("cat IN ('fixe','variable','loisir')");
  const expenses = db.prepare(`
    SELECT year, month, cat, entry_id, amount
    FROM monthly_expenses
    WHERE ${expCond.join(' AND ')}
  `).all(...expParams);

  // Épargne par mois
  const { cond: savCond, params: savParams } = buildUserWhere(filters);
  if (filters.member && filters.member !== 'all' && filters.member !== 'Commun') {
    savCond.push('member = ?'); savParams.push(filters.member);
  }
  const MONTH_NUM = `CASE month WHEN 'Janvier' THEN 1 WHEN 'Février' THEN 2 WHEN 'Mars' THEN 3 WHEN 'Avril' THEN 4 WHEN 'Mai' THEN 5 WHEN 'Juin' THEN 6 WHEN 'Juillet' THEN 7 WHEN 'Août' THEN 8 WHEN 'Septembre' THEN 9 WHEN 'Octobre' THEN 10 WHEN 'Novembre' THEN 11 WHEN 'Décembre' THEN 12 END`;
  const savings = db.prepare(`
    SELECT year, ${MONTH_NUM} as month, SUM(delta) as total
    FROM savings
    WHERE ${savCond.join(' AND ')} AND delta IS NOT NULL
    GROUP BY year, month
  `).all(...savParams);

  // Mois distincts (union expenses + savings)
  const monthSet = new Set();
  expenses.forEach(e => monthSet.add(`${e.year}-${e.month}`));
  savings.forEach(s => monthSet.add(`${s.year}-${s.month}`));

  return Array.from(monthSet)
    .map(key => {
      const [year, month] = key.split('-').map(Number);
      const monthExp = expenses.filter(e => e.year === year && e.month === month);

      // Fixes : prévisionnel de base + overrides appliqués
      const overrides = new Map(
        monthExp.filter(e => e.entry_id != null).map(e => [e.entry_id, Math.abs(e.amount)])
      );
      const fixeActual = fixeEntries.reduce((s, e) =>
        s + (overrides.has(e.id) ? overrides.get(e.id) : Math.abs(e.amount)), 0);
      const fixeExtra = monthExp.filter(e => e.cat === 'fixe' && e.entry_id == null)
        .reduce((s, e) => s + Math.abs(e.amount), 0);

      const variable = monthExp.filter(e => e.cat === 'variable').reduce((s, e) => s + Math.abs(e.amount), 0);
      const loisir   = monthExp.filter(e => e.cat === 'loisir').reduce((s, e) => s + Math.abs(e.amount), 0);
      const epargne  = savings.find(s => s.year === year && s.month === month)?.total || 0;

      return { year, month, total: fixeActual + fixeExtra + variable + loisir + epargne };
    })
    .sort((a, b) => b.year - a.year || b.month - a.month)
    .slice(0, 24);
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

function update(id, { name, amount, cat, member, note, entry_id, is_exceptional }, userId) {
  const existing = getById(id);
  if (!existing)                   throw httpError('Dépense introuvable.', 404);
  if (existing.user_id !== userId) throw httpError('Non autorisé.', 403);

  const updatedName        = name           !== undefined ? name.trim()           : existing.name;
  const updatedAmount      = amount         !== undefined ? Number(amount)        : existing.amount;
  const updatedCat         = cat            !== undefined ? cat                   : existing.cat;
  const updatedMember      = member         !== undefined ? member                : existing.member;
  const updatedNote        = note           !== undefined ? note                  : existing.note;
  const updatedEntryId     = entry_id       !== undefined ? entry_id             : existing.entry_id;
  const updatedExceptional = is_exceptional !== undefined ? (is_exceptional?1:0) : existing.is_exceptional;

  if (!AUTO_CATS.includes(updatedCat) && !MANUAL_CATS.includes(updatedCat)) throw httpError(`Catégorie invalide : ${updatedCat}`, 400);

  db.prepare(`
    UPDATE monthly_expenses
    SET name = ?, amount = ?, cat = ?, member = ?, note = ?, entry_id = ?, is_exceptional = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(updatedName, updatedAmount, updatedCat, updatedMember, updatedNote, updatedEntryId, updatedExceptional, id);

  return getById(id);
}

function remove(id, userId) {
  const existing = getById(id);
  if (!existing)                   throw httpError('Dépense introuvable.', 404);
  if (existing.user_id !== userId) throw httpError('Non autorisé.', 403);
  db.prepare('DELETE FROM monthly_expenses WHERE id = ?').run(id);
  return { deleted: true };
}

module.exports = { getAll, getById, getStats, getHistory, create, update, remove, getDistinctNames };
