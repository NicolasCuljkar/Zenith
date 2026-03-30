'use strict';

const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
const crypto      = require('crypto');
const db          = require('../config/database');
const emailSvc    = require('./email.service');

const JWT_SECRET     = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required.');

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function createToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role, is_admin: user.is_admin || 0 },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function sanitizeUser(user) {
  const { password_hash, ...safe } = user;
  return safe;
}

function getUsers() {
  return db.prepare('SELECT id, name, email, role, color, photo, created_at FROM users ORDER BY id ASC').all();
}

// Version publique sans email (profile picker) — exclut les admins
function getPublicUsers() {
  return db.prepare('SELECT id, name, role, color, photo FROM users WHERE is_admin = 0 ORDER BY id ASC').all();
}

function login(email, password) {
  if (!email || !password) throw httpError('Email et mot de passe requis.', 400);

  const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw httpError('Identifiants incorrects.', 401);
  }
  if (user.is_admin) throw httpError('Identifiants incorrects.', 401);

  return { token: createToken(user), user: sanitizeUser(user) };
}

function loginById(userId, password) {
  if (!userId || !password) throw httpError('Identifiants requis.', 400);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw httpError('Mot de passe incorrect.', 401);
  }
  if (user.is_admin) throw httpError('Mot de passe incorrect.', 401);

  return { token: createToken(user), user: sanitizeUser(user) };
}

function register(name, email, password, role = 'Autre') {
  if (!name || !email || !password) throw httpError('Tous les champs sont requis.', 400);
  if (password.length < 6)          throw httpError('Le mot de passe doit faire au moins 6 caractères.', 400);
  if (!['Nicolas', 'Carla', 'Autre'].includes(role)) throw httpError('Rôle invalide.', 400);

  const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email.trim().toLowerCase());
  if (existing) throw httpError('Cet e-mail est déjà utilisé.', 409);

  const defaultColors = { Nicolas: '#3B8BD4', Carla: '#e06fa0', Autre: '#9e7bca' };
  const password_hash = bcrypt.hashSync(password, 10);
  const color         = defaultColors[role] || '#9e7bca';

  const result = db.prepare('INSERT INTO users (name, email, password_hash, role, color) VALUES (?, ?, ?, ?, ?)')
    .run(name.trim(), email.trim().toLowerCase(), password_hash, role, color);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

  // Envoi email de bienvenue (non bloquant)
  emailSvc.sendWelcome(user.email, user.name).catch(err =>
    console.error('[email] Welcome email failed:', err.message)
  );

  return { token: createToken(user), user: sanitizeUser(user) };
}

function updateSettings(userId, { color, photo } = {}) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw httpError('Utilisateur introuvable.', 404);

  const fields = [];
  const values = [];

  if (color !== undefined) { fields.push('color = ?'); values.push(color); }
  if (photo !== undefined) { fields.push('photo = ?'); values.push(photo || null); }
  if (!fields.length) return sanitizeUser(user);

  values.push(userId);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  return sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
}

function updateProfile(userId, { name, email } = {}) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw httpError('Utilisateur introuvable.', 404);

  if (email && email.trim().toLowerCase() !== user.email) {
    const dup = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id != ?').get(email.trim().toLowerCase(), userId);
    if (dup) throw httpError('Cet e-mail est déjà utilisé.', 409);
  }

  const fields = [];
  const values = [];
  if (name  && name.trim())  { fields.push('name = ?');  values.push(name.trim()); }
  if (email && email.trim()) { fields.push('email = ?'); values.push(email.trim().toLowerCase()); }
  if (!fields.length) return sanitizeUser(user);

  values.push(userId);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  return sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
}

function changePassword(userId, { currentPassword, newPassword } = {}) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw httpError('Utilisateur introuvable.', 404);
  if (!bcrypt.compareSync(currentPassword || '', user.password_hash)) throw httpError('Mot de passe actuel incorrect.', 401);
  if (!newPassword || newPassword.length < 6) throw httpError('Le nouveau mot de passe doit faire au moins 6 caractères.', 400);

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), userId);
  return { success: true };
}

async function forgotPassword(email) {
  if (!email) throw httpError('E-mail requis.', 400);
  const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND is_admin = 0').get(email.trim().toLowerCase());
  // Réponse identique si user existe ou non (sécurité anti-énumération)
  if (!user) return { sent: true };

  // Supprime les anciens tokens de cet utilisateur
  db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);

  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h
  db.prepare('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);

  await emailSvc.sendPasswordReset(user.email, user.name, token);
  return { sent: true };
}

function resetPassword(token, newPassword) {
  if (!token)       throw httpError('Token requis.', 400);
  if (!newPassword || newPassword.length < 6) throw httpError('Le mot de passe doit faire au moins 6 caractères.', 400);

  const row = db.prepare('SELECT * FROM password_reset_tokens WHERE token = ?').get(token);
  if (!row) throw httpError('Lien invalide ou déjà utilisé.', 400);
  if (new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM password_reset_tokens WHERE id = ?').run(row.id);
    throw httpError('Ce lien a expiré. Faites une nouvelle demande.', 410);
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), row.user_id);
  db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(row.user_id);
  return { reset: true };
}

module.exports = { getUsers, getPublicUsers, login, loginById, register, updateSettings, updateProfile, changePassword, forgotPassword, resetPassword, sanitizeUser };
