'use strict';

const { Router }      = require('express');
const ctrl            = require('../controllers/notifications.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();

router.get('/vapid-key',    ctrl.getVapidKey);
router.post('/subscribe',   requireAuth, ctrl.subscribe);
router.delete('/subscribe', requireAuth, ctrl.unsubscribe);
router.post('/test',         requireAuth, ctrl.test);
router.post('/check-alerts', requireAuth, ctrl.checkAlerts);
router.get('/debug',         requireAuth, ctrl.debug);

module.exports = router;
