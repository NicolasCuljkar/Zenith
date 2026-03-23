'use strict';

const nordigen = require('../services/nordigen.service');

async function getInstitutions(req, res, next) {
  try {
    res.json({ success: true, data: await nordigen.getInstitutions(req.query.country || 'FR') });
  } catch (err) { next(err); }
}

async function getConnectUrl(req, res, next) {
  try {
    const { institutionId, institutionName } = req.body;
    if (!institutionId) return res.status(400).json({ success: false, error: 'institutionId requis' });
    const redirectUri = `${req.protocol}://${req.get('host')}/banque`;
    res.json({ success: true, data: await nordigen.createRequisition(req.user.id, institutionId, institutionName || institutionId, redirectUri) });
  } catch (err) { next(err); }
}

async function syncItem(req, res, next) {
  try {
    res.json({ success: true, data: await nordigen.syncRequisition(req.user.id, req.params.itemId) });
  } catch (err) { next(err); }
}

async function syncByRef(req, res, next) {
  try {
    res.json({ success: true, data: await nordigen.syncRequisitionByRef(req.user.id, req.params.ref) });
  } catch (err) { next(err); }
}

async function syncAll(req, res, next) {
  try {
    res.json({ success: true, data: await nordigen.syncAll(req.user.id) });
  } catch (err) { next(err); }
}

async function getAccounts(req, res, next) {
  try {
    res.json({ success: true, data: nordigen.getAccountsForUser(req.user.id) });
  } catch (err) { next(err); }
}

async function getTransactions(req, res, next) {
  try {
    const { accountId, limit = 50, offset = 0 } = req.query;
    res.json({ success: true, data: nordigen.getTransactionsForUser(req.user.id, {
      accountId: accountId || null,
      limit    : Math.min(Number(limit) || 50, 200),
      offset   : Number(offset) || 0,
    })});
  } catch (err) { next(err); }
}

async function getSummary(req, res, next) {
  try {
    res.json({ success: true, data: nordigen.getSummaryForUser(req.user.id) });
  } catch (err) { next(err); }
}

async function deleteItem(req, res, next) {
  try {
    await nordigen.deleteRequisition(req.user.id, req.params.itemId);
    res.json({ success: true, data: { deleted: true } });
  } catch (err) { next(err); }
}

module.exports = {
  getInstitutions, getConnectUrl, syncItem, syncByRef, syncAll,
  getAccounts, getTransactions, getSummary, deleteItem,
};
