/**
 * users.routes.js — Express router for user settings endpoint.
 *
 * Routes:
 *   PUT /api/users/settings — Update color and/or photo (protected)
 */

'use strict';

const { Router }      = require('express');
const authCtrl        = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();

router.put('/settings',  requireAuth, authCtrl.updateSettings);
router.patch('/profile', requireAuth, authCtrl.updateProfile);
router.patch('/password',requireAuth, authCtrl.changePassword);

module.exports = router;
