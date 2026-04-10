'use strict';

const { Router }      = require('express');
const monthlyCtrl     = require('../controllers/monthly_expenses.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();
router.use(requireAuth);

// NOTE: /stats et /history avant /:id pour éviter les conflits de routes
router.get('/stats',   monthlyCtrl.getStats);
router.get('/history', monthlyCtrl.getHistory);
router.get('/',        monthlyCtrl.listExpenses);
router.post('/',       monthlyCtrl.createExpense);
router.put('/:id',     monthlyCtrl.updateExpense);
router.delete('/:id',  monthlyCtrl.deleteExpense);

module.exports = router;
