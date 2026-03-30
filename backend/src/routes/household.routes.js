'use strict';

const { Router }      = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const ctrl            = require('../controllers/household.controller');

const router = Router();

router.get('/',         requireAuth, ctrl.getHousehold);
router.post('/create',  requireAuth, ctrl.createHousehold);
router.post('/invite',  requireAuth, ctrl.generateInvite);
router.post('/join',    requireAuth, ctrl.joinHousehold);
router.delete('/leave', requireAuth, ctrl.leaveHousehold);
router.delete('/delete',requireAuth, ctrl.deleteHousehold);

module.exports = router;
