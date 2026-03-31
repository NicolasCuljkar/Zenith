'use strict';

/**
 * events.routes.js — Server-Sent Events endpoint.
 *
 * GET /api/events?token=JWT
 * The client subscribes and receives 'data_changed' events pushed by the server.
 * Token is passed as query param because EventSource doesn't support custom headers.
 */

const { Router } = require('express');
const jwt        = require('jsonwebtoken');
const db         = require('../config/database');
const sseService = require('../services/sse.service');

const router = Router();

const JWT_SECRET  = process.env.JWT_SECRET;
const PING_MS     = 25000; // keep-alive every 25 s (Railway timeout is 30 s)

router.get('/', (req, res) => {
  // Auth via query param (EventSource limitation)
  const token = req.query.token;
  if (!token) return res.status(401).json({ success: false, error: 'Token manquant.' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, error: 'Token invalide.' });
  }

  // Verify user still exists
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(payload.id);
  if (!user) return res.status(401).json({ success: false, error: 'Compte introuvable.' });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering if present
  res.flushHeaders();

  const userId = payload.id;
  sseService.subscribe(userId, res);

  // Initial handshake
  res.write('event: connected\ndata: {}\n\n');

  // Keep-alive ping
  const ping = setInterval(() => {
    try { res.write('event: ping\ndata: {}\n\n'); } catch (_) { cleanup(); }
  }, PING_MS);

  function cleanup() {
    clearInterval(ping);
    sseService.unsubscribe(userId, res);
  }

  req.on('close', cleanup);
  req.on('error', cleanup);
});

module.exports = router;
