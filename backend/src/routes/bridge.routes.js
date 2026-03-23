'use strict';

const router     = require('express').Router();
const ctrl       = require('../controllers/bridge.controller');
const { requireAuth } = require('../middleware/auth.middleware');

router.use(requireAuth);

router.get   ('/institutions',        ctrl.getInstitutions);
router.post  ('/connect',             ctrl.getConnectUrl);
router.post  ('/sync/:itemId',        ctrl.syncItem);
router.post  ('/sync-by-ref/:ref',    ctrl.syncByRef);
router.post  ('/sync-all',            ctrl.syncAll);
router.get   ('/accounts',            ctrl.getAccounts);
router.get   ('/transactions',        ctrl.getTransactions);
router.get   ('/summary',             ctrl.getSummary);
router.delete('/items/:itemId',       ctrl.deleteItem);

module.exports = router;
