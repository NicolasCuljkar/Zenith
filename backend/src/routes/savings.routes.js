/**
 * savings.routes.js — Express router for savings endpoints.
 *
 * All routes require a valid JWT (requireAuth middleware).
 *
 * Routes:
 *   GET    /api/savings       — List savings records (filterable)
 *   POST   /api/savings       — Create a new savings record
 *   GET    /api/savings/:id   — Get single savings record
 *   PUT    /api/savings/:id   — Update savings record
 *   DELETE /api/savings/:id   — Delete savings record
 */

'use strict';

const { Router }      = require('express');
const savingsCtrl     = require('../controllers/savings.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();

// Apply auth to all savings routes
router.use(requireAuth);

router.get('/',           savingsCtrl.listSavings);
router.post('/',          savingsCtrl.createSaving);
router.get('/:id',        savingsCtrl.getSaving);
router.put('/:id',        savingsCtrl.updateSaving);
router.delete('/:id',     savingsCtrl.deleteSaving);

module.exports = router;
