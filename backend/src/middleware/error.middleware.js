/**
 * error.middleware.js — Global Express error handler
 * Catches errors thrown or passed via next(err) and returns consistent JSON.
 */

'use strict';

/**
 * Global error handler — must be registered LAST with app.use()
 * and must have exactly 4 parameters (err, req, res, next).
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Log the error in development
  if (process.env.NODE_ENV !== 'production') {
    console.error('[ERROR]', err.message);
    if (err.stack) console.error(err.stack);
  }

  const status  = err.statusCode || err.status || 500;
  const message = err.message    || 'Une erreur interne est survenue.';

  res.status(status).json({
    success : false,
    error   : message,
  });
}

/**
 * 404 handler — catches unmatched routes
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success : false,
    error   : `Route introuvable : ${req.method} ${req.originalUrl}`,
  });
}

module.exports = { errorHandler, notFoundHandler };
