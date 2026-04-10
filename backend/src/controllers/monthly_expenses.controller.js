'use strict';

const monthlyService   = require('../services/monthly_expenses.service');
const householdService = require('../services/household.service');

function resolveUserScope(userId, member) {
  if (!member || member === 'all' || member === 'Commun') {
    const household = householdService.getForUser(userId);
    if (household && household.members.length > 0) {
      return { userIds: household.members.map(m => m.id) };
    }
  }
  return { userId };
}

async function listExpenses(req, res, next) {
  try {
    const { member, year, month } = req.query;
    const scope = resolveUserScope(req.user.id, member);
    res.json({ success: true, data: monthlyService.getAll({ ...scope, year, month }) });
  } catch (err) { next(err); }
}

async function getStats(req, res, next) {
  try {
    const { member, year, month } = req.query;
    const scope = resolveUserScope(req.user.id, member);
    res.json({ success: true, data: monthlyService.getStats({ ...scope, year, month }) });
  } catch (err) { next(err); }
}

async function getHistory(req, res, next) {
  try {
    const { member } = req.query;
    const scope = resolveUserScope(req.user.id, member);
    res.json({ success: true, data: monthlyService.getHistory(scope) });
  } catch (err) { next(err); }
}

async function createExpense(req, res, next) {
  try {
    const { year, month, name, amount, cat, member, note } = req.body;
    const expense = monthlyService.create({ year, month, name, amount, cat, member, note }, req.user.id);
    res.status(201).json({ success: true, data: expense });
  } catch (err) { next(err); }
}

async function updateExpense(req, res, next) {
  try {
    const { name, amount, cat, member, note } = req.body;
    const expense = monthlyService.update(Number(req.params.id), { name, amount, cat, member, note }, req.user.id);
    res.json({ success: true, data: expense });
  } catch (err) { next(err); }
}

async function deleteExpense(req, res, next) {
  try {
    const result = monthlyService.remove(Number(req.params.id), req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

module.exports = { listExpenses, getStats, getHistory, createExpense, updateExpense, deleteExpense };
