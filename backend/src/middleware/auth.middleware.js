'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Token manquant ou invalide.' });
  }

  try {
    req.user = jwt.verify(authHeader.slice(7), JWT_SECRET);
    next();
  } catch (err) {
    const message = err.name === 'TokenExpiredError'
      ? 'Session expirée. Reconnectez-vous.'
      : 'Token invalide.';
    res.status(401).json({ success: false, error: message });
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    try { req.user = jwt.verify(authHeader.slice(7), JWT_SECRET); } catch (_) {}
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Non authentifié.' });
  if (!req.user.is_admin) return res.status(403).json({ success: false, error: 'Accès réservé à l\'administrateur.' });
  next();
}

module.exports = { requireAuth, optionalAuth, requireAdmin };
