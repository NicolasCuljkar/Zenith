'use strict';

const { Router }      = require('express');
const labelsCtrl      = require('../controllers/expense_labels.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();
router.use(requireAuth);

router.get('/',    labelsCtrl.listLabels);
router.post('/',   labelsCtrl.createLabel);
router.delete('/:id', labelsCtrl.deleteLabel);

module.exports = router;
