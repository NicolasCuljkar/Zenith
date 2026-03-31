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
const PING_MS     = 20000; // keep-alive every 20 s (Railway proxy timeout ~30 s)

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

  // SSE headers — no-transform important to prevent proxy buffering
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const userId = payload.id;
  sseService.subscribe(userId, res);

  // Tell client to reconnect after 3 s if connection drops
  res.write('retry: 3000\n');
  res.write('event: connected\ndata: {}\n\n');

  // Keep-alive: SSE comment (no event name = no client listener needed)
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { cleanup(); }
  }, PING_MS);

  function cleanup() {
    clearInterval(ping);
    sseService.unsubscribe(userId, res);
  }

  req.on('close', cleanup);
  req.on('error', cleanup);
});

module.exports = router;
