/**
 * app.js — Zénith Budget Manager Backend
 * Express application entry point.
 *
 * Sets up: CORS, JSON parsing, all API routes, error handling, and HTTP server.
 */

'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

// ── Import routes ──────────────────────────────────────────────
const authRoutes    = require('./routes/auth.routes');
const entriesRoutes = require('./routes/entries.routes');
const savingsRoutes = require('./routes/savings.routes');
const usersRoutes   = require('./routes/users.routes');
const bridgeRoutes  = require('./routes/bridge.routes');

// ── Import middleware ──────────────────────────────────────────
const { errorHandler, notFoundHandler } = require('./middleware/error.middleware');

// Initialize the database (runs schema.sql + seeds on first launch)
require('./config/database');

// ── Create Express app ─────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3001;

// node:sqlite retourne les INTEGER SQLite comme BigInt en Node.js v22+.
// Ce replacer les convertit en Number pour que JSON.stringify() fonctionne.
app.set('json replacer', (key, value) =>
  typeof value === 'bigint' ? Number(value) : value
);

// ── Global middleware ──────────────────────────────────────────

// CORS — allow requests from any origin in development (credentials via Authorization header, not cookies)
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.FRONTEND_URL || 'http://localhost:3000']
    : true, // reflect request origin — safe for dev, works with file://
  credentials: false, // We use Bearer token in header, not cookies — no need for credentials
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Parse JSON bodies (limit 10MB to accommodate base64 photos)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── API routes ──────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/entries', entriesRoutes);
app.use('/api/savings', savingsRoutes);
app.use('/api/users',   usersRoutes);
app.use('/api/bridge',  bridgeRoutes);

// ── Health check endpoint ───────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    success : true,
    message : 'Zénith API is running',
    version : '1.0.0',
    env     : process.env.NODE_ENV || 'development',
  });
});

// ── Serve frontend static files (optional, for production) ───────
// If the frontend is in ../frontend relative to this file, serve it statically.
const frontendPath = path.resolve(__dirname, '../../frontend');
const fs = require('fs');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  // Fallback: serve index.html for all non-API routes (SPA support)
  app.get(/^(?!\/api).*/, (req, res) => {
    const indexPath = path.join(frontendPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).json({ success: false, error: 'Frontend introuvable.' });
    }
  });
}

// ── Error handling (must be LAST) ──────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ── Start server ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n[Zenith] API running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
  console.log(`   Environment : ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
