/**
 * entries.routes.js — Express router for budget entry endpoints.
 *
 * All routes require a valid JWT (requireAuth middleware).
 *
 * Routes:
 *   GET    /api/entries           — List entries (filterable)
 *   GET    /api/entries/stats     — Compute statistics
 *   PUT    /api/entries/order     — Update sort order (drag-drop)
 *   POST   /api/entries           — Create a new entry
 *   GET    /api/entries/:id       — Get single entry
 *   PUT    /api/entries/:id       — Update entry
 *   DELETE /api/entries/:id       — Delete entry
 */

'use strict';

const { Router }      = require('express');
const entriesCtrl     = require('../controllers/entries.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();

// Apply auth to all entry routes
router.use(requireAuth);

// NOTE: /stats and /order must be declared BEFORE /:id to avoid route conflicts
router.get('/stats',      entriesCtrl.getStats);
router.put('/order',      entriesCtrl.updateOrder);
router.get('/',           entriesCtrl.listEntries);
router.post('/',          entriesCtrl.createEntry);
router.get('/:id',        entriesCtrl.getEntry);
router.put('/:id',        entriesCtrl.updateEntry);
router.delete('/:id',     entriesCtrl.deleteEntry);

module.exports = router;
