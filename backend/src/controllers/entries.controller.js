/**
 * entries.controller.js — Thin controller layer for budget entry routes.
 * Delegates all logic to entries.service.js, handles HTTP responses.
 */

'use strict';

const entriesService = require('../services/entries.service');

/**
 * GET /api/entries
 * Query: ?member=Nicolas&cat=fixe&search=loyer
 * Returns: { success, data: [...entries] }
 */
async function listEntries(req, res, next) {
  try {
    const { member, cat, search } = req.query;
    const entries = entriesService.getAll({ member, cat, search });
    res.json({ success: true, data: entries });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/entries/stats
 * Query: ?member=Nicolas
 * Returns: { success, data: { rev, tax, revNet, fix, vari, ep, loi, dep, rav, solde } }
 */
async function getStats(req, res, next) {
  try {
    const { member } = req.query;
    const stats = entriesService.getStats({ member });
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/entries
 * Body: { name, amount, cat, member }
 * Returns: { success, data: createdEntry }
 */
async function createEntry(req, res, next) {
  try {
    const { name, amount, cat, member } = req.body;
    const entry = entriesService.create({ name, amount, cat, member });
    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/entries/:id
 * Returns: { success, data: entry }
 */
async function getEntry(req, res, next) {
  try {
    const entry = entriesService.getById(Number(req.params.id));
    if (!entry) return res.status(404).json({ success: false, error: 'Ligne budgétaire introuvable.' });
    res.json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/entries/:id
 * Body: { name?, amount?, cat?, member? }
 * Returns: { success, data: updatedEntry }
 */
async function updateEntry(req, res, next) {
  try {
    const { name, amount, cat, member } = req.body;
    const entry = entriesService.update(Number(req.params.id), { name, amount, cat, member });
    res.json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/entries/:id
 * Returns: { success, data: { deleted: true } }
 */
async function deleteEntry(req, res, next) {
  try {
    const result = entriesService.remove(Number(req.params.id));
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/entries/order
 * Body: { member, groupKey, orderedIds: [id, id, ...] }
 * Updates sort_order for drag-drop reordering.
 */
async function updateOrder(req, res, next) {
  try {
    const { member, groupKey, orderedIds } = req.body;
    const result = entriesService.updateOrder(member, groupKey, orderedIds);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { listEntries, getStats, createEntry, getEntry, updateEntry, deleteEntry, updateOrder };
