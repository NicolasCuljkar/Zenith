'use strict';

const { Router }      = require('express');
const ctrl            = require('../controllers/notifications.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();

router.get('/vapid-key',  ctrl.getVapidKey);           // public — clé VAPID pour le frontend
router.post('/subscribe', requireAuth, ctrl.subscribe); // enregistrer une subscription
router.delete('/subscribe', requireAuth, ctrl.unsubscribe); // supprimer une subscription

module.exports = router;
