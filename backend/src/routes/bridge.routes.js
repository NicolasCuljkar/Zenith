'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/bridge.controller');
const { requireAuth } = require('../middleware/auth.middleware');

router.use(requireAuth);

router.post  ('/link-token',          ctrl.getLinkToken);
router.post  ('/exchange-token',      ctrl.exchangeToken);
router.post  ('/sync/:itemId',        ctrl.syncItem);
router.post  ('/sync-all',            ctrl.syncAll);
router.get   ('/accounts',            ctrl.getAccounts);
router.get   ('/transactions',        ctrl.getTransactions);
router.get   ('/summary',             ctrl.getSummary);
router.delete('/items/:itemId',       ctrl.deleteItem);

module.exports = router;
