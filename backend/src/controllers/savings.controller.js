/**
 * savings.controller.js — Thin controller layer for savings routes.
 * Delegates all logic to savings.service.js, handles HTTP responses.
 */

'use strict';

const savingsService = require('../services/savings.service');

/**
 * GET /api/savings
 * Query: ?member=Nicolas&year=2026
 * Returns: { success, data: [...savings] }
 */
async function listSavings(req, res, next) {
  try {
    const { member, year } = req.query;
    const savings = savingsService.getAll({ member, year: year ? Number(year) : undefined });
    res.json({ success: true, data: savings });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/savings
 * Body: { member, year, month, amount }
 * Returns: { success, data: createdSaving }
 */
async function createSaving(req, res, next) {
  try {
    const { member, year, month, amount } = req.body;
    const saving = savingsService.create({ member, year, month, amount });
    res.status(201).json({ success: true, data: saving });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/savings/:id
 * Returns: { success, data: saving }
 */
async function getSaving(req, res, next) {
  try {
    const saving = savingsService.getById(Number(req.params.id));
    if (!saving) return res.status(404).json({ success: false, error: 'Entrée d\'épargne introuvable.' });
    res.json({ success: true, data: saving });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/savings/:id
 * Body: { member?, year?, month?, amount? }
 * Returns: { success, data: updatedSaving }
 */
async function updateSaving(req, res, next) {
  try {
    const { member, year, month, amount } = req.body;
    const saving = savingsService.update(Number(req.params.id), { member, year, month, amount });
    res.json({ success: true, data: saving });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/savings/:id
 * Returns: { success, data: { deleted: true } }
 */
async function deleteSaving(req, res, next) {
  try {
    const result = savingsService.remove(Number(req.params.id));
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { listSavings, createSaving, getSaving, updateSaving, deleteSaving };
