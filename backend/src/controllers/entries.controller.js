'use strict';

const entriesService = require('../services/entries.service');

async function listEntries(req, res, next) {
  try {
    const { member, cat, search } = req.query;
    res.json({ success: true, data: entriesService.getAll({ member, cat, search }) });
  } catch (err) { next(err); }
}

async function getStats(req, res, next) {
  try {
    const { member } = req.query;
    res.json({ success: true, data: entriesService.getStats({ member }) });
  } catch (err) { next(err); }
}

async function createEntry(req, res, next) {
  try {
    const { name, amount, cat, member } = req.body;
    const entry = entriesService.create({ name, amount, cat, member }, req.user.id);
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
    res.json({ success: true, data: entry });
  } catch (err) { next(err); }
}

async function deleteEntry(req, res, next) {
  try {
    const result = entriesService.remove(Number(req.params.id), req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

async function updateOrder(req, res, next) {
  try {
    const { member, groupKey, orderedIds } = req.body;
    res.json({ success: true, data: entriesService.updateOrder(member, groupKey, orderedIds) });
  } catch (err) { next(err); }
}

module.exports = { listEntries, getStats, createEntry, getEntry, updateEntry, deleteEntry, updateOrder };
