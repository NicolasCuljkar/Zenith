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
const householdRoutes     = require('./routes/household.routes');
const adminRoutes         = require('./routes/admin.routes');
const eventsRoutes        = require('./routes/events.routes');
const bridgeRoutes          = require('./routes/bridge.routes');
const monthlyExpensesRoutes = require('./routes/monthly_expenses.routes');
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

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth/login',       loginLimiter);
app.use('/api/auth/login-by-id', loginLimiter);
app.use('/api/auth/register',    loginLimiter);
app.use('/api/auth/admin-login', adminLoginLimiter);
app.use('/api/auth',          authRoutes);
app.use('/api/entries',       entriesRoutes);
app.use('/api/savings',       savingsRoutes);
app.use('/api/users',         usersRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/import',        importRoutes);
app.use('/api/household',     householdRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/events',        eventsRoutes);
app.use('/api/bridge',           bridgeRoutes);
app.use('/api/monthly-expenses', monthlyExpensesRoutes);

app.get('/api/health', (req, res) => {
  const db = require('./config/database');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  const tables  = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
  res.json({ success: true, status: 'ok', env: process.env.NODE_ENV || 'development', db_version: version, tables });
});

const frontendPath = path.resolve(__dirname, '../../frontend');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  app.get(/^(?!\/api).*/, (req, res) => {
    const indexPath = path.join(frontendPath, 'index.html');
    if (!fs.existsSync(indexPath)) return res.status(404).json({ success: false, error: 'Frontend introuvable.' });
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(indexPath);
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[Zenith] http://localhost:${PORT} (${process.env.NODE_ENV || 'development'})`);
});

module.exports = app;
