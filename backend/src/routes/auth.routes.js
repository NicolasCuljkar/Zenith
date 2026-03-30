/**
 * auth.routes.js — Express router for authentication endpoints.
 *
 * Routes:
 *   GET  /api/auth/users    — Profile picker list (public)
 *   POST /api/auth/login    — Login with email + password
 *   POST /api/auth/register — Register a new user
 *   GET  /api/auth/me       — Get current user (protected)
 */

'use strict';

const { Router }      = require('express');
const authCtrl        = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();

// Public routes
router.get('/users',              authCtrl.listUsers);
router.post('/login',             authCtrl.login);
router.post('/login-by-id',       authCtrl.loginById);
router.post('/register',          authCtrl.register);

// Protected route — requires valid JWT
router.get('/me', requireAuth, authCtrl.getMe);

module.exports = router;
