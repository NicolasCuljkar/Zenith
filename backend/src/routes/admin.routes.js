'use strict';

const { Router }                    = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');
const ctrl                          = require('../controllers/admin.controller');

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/users',            ctrl.listUsers);
router.get('/users/:id/data',   ctrl.getUserData);
router.delete('/users/:id',     ctrl.deleteUser);
router.post('/users/:id/reset-password', ctrl.resetPassword);

module.exports = router;
