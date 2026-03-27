'use strict';

const { Router }      = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const importCtrl      = require('../controllers/import.controller');

const router = Router();

router.post('/photo', requireAuth, importCtrl.analyzePhoto);

module.exports = router;
