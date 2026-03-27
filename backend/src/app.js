'use strict';

require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const rateLimit = require('express-rate-limit');

const authRoutes          = require('./routes/auth.routes');
const entriesRoutes       = require('./routes/entries.routes');
const savingsRoutes       = require('./routes/savings.routes');
const usersRoutes         = require('./routes/users.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const importRoutes        = require('./routes/import.routes');
const notifService        = require('./services/notifications.service');

const { errorHandler, notFoundHandler } = require('./middleware/error.middleware');

require('./config/database');
notifService.init();
notifService.startScheduler();

const app  = express();
const PORT = process.env.PORT || 3001;

app.set('trust proxy', 1); // Railway passe par un reverse proxy
app.set('json replacer', (key, value) =>
  typeof value === 'bigint' ? Number(value) : value
);

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.FRONTEND_URL || false)
    : true,
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, error: 'Trop de tentatives. Réessayez dans une minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth/login',    loginLimiter);
app.use('/api/auth/register', loginLimiter);
app.use('/api/auth',          authRoutes);
app.use('/api/entries',       entriesRoutes);
app.use('/api/savings',       savingsRoutes);
app.use('/api/users',         usersRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/import',        importRoutes);

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', env: process.env.NODE_ENV || 'development' });
});

const frontendPath = path.resolve(__dirname, '../../frontend');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  app.get(/^(?!\/api).*/, (req, res) => {
    const indexPath = path.join(frontendPath, 'index.html');
    fs.existsSync(indexPath)
      ? res.sendFile(indexPath)
      : res.status(404).json({ success: false, error: 'Frontend introuvable.' });
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[Zenith] http://localhost:${PORT} (${process.env.NODE_ENV || 'development'})`);
});

module.exports = app;
