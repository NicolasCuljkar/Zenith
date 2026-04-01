'use strict';

const plaid = require('../services/plaid.service');

async function getLinkToken(req, res, next) {
  try {
    res.json({ success: true, data: await plaid.createLinkToken(req.user.id) });
  } catch (err) { next(err); }
}

async function exchangeToken(req, res, next) {
  try {
    const { publicToken, institutionName } = req.body;
    if (!publicToken) return res.status(400).json({ success: false, error: 'publicToken requis' });
    res.json({ success: true, data: await plaid.exchangePublicToken(req.user.id, publicToken, institutionName) });
  } catch (err) { next(err); }
}

async function syncItem(req, res, next) {
  try {
    res.json({ success: true, data: await plaid.syncItem(req.user.id, req.params.itemId) });
  } catch (err) { next(err); }
}

async function syncAll(req, res, next) {
  try {
    res.json({ success: true, data: await plaid.syncAll(req.user.id) });
  } catch (err) { next(err); }
}

async function getAccounts(req, res, next) {
  try {
    res.json({ success: true, data: plaid.getItemsForUser(req.user.id) });
  } catch (err) { next(err); }
}

async function getTransactions(req, res, next) {
  try {
    const { accountId, limit = 50, offset = 0 } = req.query;
    res.json({ success: true, data: plaid.getTransactionsForUser(req.user.id, {
      accountId : accountId || null,
      limit     : Math.min(Number(limit) || 50, 200),
      offset    : Number(offset) || 0,
    })});
  } catch (err) { next(err); }
}

async function getSummary(req, res, next) {
  try {
    res.json({ success: true, data: plaid.getSummaryForUser(req.user.id) });
  } catch (err) { next(err); }
}

async function deleteItem(req, res, next) {
  try {
    await plaid.deleteItem(req.user.id, req.params.itemId);
    res.json({ success: true, data: { deleted: true } });
  } catch (err) { next(err); }
}

module.exports = { getLinkToken, exchangeToken, syncItem, syncAll, getAccounts, getTransactions, getSummary, deleteItem };
