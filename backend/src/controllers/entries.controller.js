'use strict';

const entriesService  = require('../services/entries.service');
const householdService = require('../services/household.service');
const sseService       = require('../services/sse.service');

function resolveUserScope(userId, member) {
  // Vue Commun (foyer) : renvoie tous les userIds du foyer
  if (!member || member === 'all' || member === 'Commun') {
    const household = householdService.getForUser(userId);
    if (household && household.members.length > 0) {
      return { userIds: household.members.map(m => m.id) };
    }
  }
  // Vue personnelle (ou solo sans foyer)
  return { userId };
}

async function listEntries(req, res, next) {
  try {
    const { member, cat, search } = req.query;
    const scope = resolveUserScope(req.user.id, member);
    res.json({ success: true, data: entriesService.getAll({ ...scope, cat, search }) });
  } catch (err) { next(err); }
}

async function getStats(req, res, next) {
  try {
    const { member } = req.query;
    const scope = resolveUserScope(req.user.id, member);
    res.json({ success: true, data: entriesService.getStats(scope) });
  } catch (err) { next(err); }
}

async function createEntry(req, res, next) {
  try {
    const { name, amount, cat, member } = req.body;
    const entry = entriesService.create({ name, amount, cat, member }, req.user.id);
    sseService.broadcastToHousehold(req.user.id);
    res.status(201).json({ success: true, data: entry });
  } catch (err) { next(err); }
}

async function getEntry(req, res, next) {
  try {
    const entry = entriesService.getById(Number(req.params.id));
    if (!entry) return res.status(404).json({ success: false, error: 'Ligne budgétaire introuvable.' });
    res.json({ success: true, data: entry });
  } catch (err) { next(err); }
}

async function updateEntry(req, res, next) {
  try {
    const { name, amount, cat, member } = req.body;
    const entry = entriesService.update(Number(req.params.id), { name, amount, cat, member }, req.user.id);
    sseService.broadcastToHousehold(req.user.id);
    res.json({ success: true, data: entry });
  } catch (err) { next(err); }
}

async function deleteEntry(req, res, next) {
  try {
    const result = entriesService.remove(Number(req.params.id), req.user.id);
    sseService.broadcastToHousehold(req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

async function updateOrder(req, res, next) {
  try {
    const { member, groupKey, orderedIds } = req.body;
    res.json({ success: true, data: entriesService.updateOrder(member, groupKey, orderedIds, req.user.id) });
  } catch (err) { next(err); }
}

module.exports = { listEntries, getStats, createEntry, getEntry, updateEntry, deleteEntry, updateOrder };
