/**
 * auth.middleware.js — JWT verification middleware
 * Extracts and verifies the Bearer token, attaches req.user on success.
 */

'use strict';

const jwt = require('jsonwebtoken');
require('dotenv').config();

/**
 * Middleware: require a valid JWT.
 * Sets req.user = { id, name, email, role } on success.
 * Returns 401 if missing or invalid.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Token manquant ou invalide.' });
  }

  const token = authHeader.slice(7); // Remove "Bearer "

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    req.user = decoded; // { id, name, email, role, iat, exp }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Session expirée. Reconnectez-vous.' });
    }
    return res.status(401).json({ success: false, error: 'Token invalide.' });
  }
}

/**
 * Optional auth: attaches req.user if token is present and valid,
 * but does NOT block the request if missing.
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    } catch (_) {
      // Invalid token is silently ignored for optional auth
    }
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
