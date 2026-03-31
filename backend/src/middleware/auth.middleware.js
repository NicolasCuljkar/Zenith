'use strict';

const jwt = require('jsonwebtoken');
const db  = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET;

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Token manquant ou invalide.' });
  }

  let payload;
  try {
    payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
  } catch (err) {
    const message = err.name === 'TokenExpiredError'
      ? 'Session expirée. Reconnectez-vous.'
      : 'Token invalide.';
    return res.status(401).json({ success: false, error: message });
  }

  // Vérifie que l'utilisateur existe toujours en base
  const user = db.prepare('SELECT id, is_admin FROM users WHERE id = ?').get(payload.id);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Compte introuvable. Reconnectez-vous.' });
  }

  req.user = payload;
  next();
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
