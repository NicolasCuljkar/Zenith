/**
 * savings.controller.js — Thin controller layer for savings routes.
 * Delegates all logic to savings.service.js, handles HTTP responses.
 */

'use strict';

const savingsService = require('../services/savings.service');
const notifService   = require('../services/notifications.service');

const MILESTONES = [5000, 10000, 20000, 30000, 50000, 75000, 100000, 150000, 200000, 300000, 500000];
const fmt = n => Math.round(n).toLocaleString('fr-FR') + ' €';

function checkSavingsNotifications(saving, userId) {
  const { amount, delta, member, month, year } = saving;
  const prevAmount = (delta !== null && delta !== undefined) ? amount - delta : 0;

  if (delta !== null && delta !== undefined && delta < 0) {
    notifService.sendToUser(userId, {
      title: `📉 Épargne en baisse — ${member}`,
      body:  `Votre épargne a diminué de ${fmt(Math.abs(delta))} par rapport au mois précédent (${month} ${year}).`,
      url:   '/index.html#savings',
    });
  }

  for (const milestone of MILESTONES) {
    if (prevAmount < milestone && amount >= milestone) {
      notifService.sendToUser(userId, {
        title: `🎯 Palier atteint — ${member}`,
        body:  `Félicitations ! Vous franchissez les ${fmt(milestone)} d'épargne !`,
        url:   '/index.html#savings',
      });
    }
  }
}

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
    const saving = savingsService.create({ member, year, month, amount }, req.user.id);
    checkSavingsNotifications(saving, req.user.id);
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
    const saving = savingsService.update(Number(req.params.id), { member, year, month, amount }, req.user.id);
    checkSavingsNotifications(saving, req.user.id);
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
    const result = savingsService.remove(Number(req.params.id), req.user.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { listSavings, createSaving, getSaving, updateSaving, deleteSaving };
