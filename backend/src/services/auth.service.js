/**
 * auth.service.js — Authentication business logic
 * Handles user listing, login (bcrypt), registration and settings update.
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../config/database');
require('dotenv').config();

const JWT_SECRET     = process.env.JWT_SECRET     || 'fallback_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Create a signed JWT for the given user.
 * @param {{ id, name, email, role }} user
 * @returns {string} JWT token
 */
function createToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Strip sensitive fields from a user row before sending to client.
 * @param {object} user - raw DB row
 * @returns {object} safe user object
 */
function sanitizeUser(user) {
  const { password_hash, ...safe } = user;
  return safe;
}

/**
 * getUsers() — List all users for the profile picker (no passwords).
 * @returns {Array} list of safe user objects
 */
function getUsers() {
  const rows = db.prepare(`
    SELECT id, name, email, role, color, photo, created_at
    FROM users
    ORDER BY id ASC
  `).all();
  return rows;
}

/**
 * login(email, password) — Verify credentials and return JWT + user.
 * @param {string} email
 * @param {string} password
 * @returns {{ token: string, user: object }}
 * @throws {Error} with statusCode 401 if invalid credentials
 */
function login(email, password) {
  if (!email || !password) {
    const err = new Error('Email et mot de passe requis.');
    err.statusCode = 400;
    throw err;
  }

  const user = db.prepare(`
    SELECT * FROM users WHERE email = ? COLLATE NOCASE
  `).get(email.trim().toLowerCase());

  if (!user) {
    const err = new Error('Identifiants incorrects.');
    err.statusCode = 401;
    throw err;
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    const err = new Error('Identifiants incorrects.');
    err.statusCode = 401;
    throw err;
  }

  const token = createToken(user);
  return { token, user: sanitizeUser(user) };
}

/**
 * register(name, email, password, role) — Create a new user.
 * @param {string} name
 * @param {string} email
 * @param {string} password
 * @param {string} role — 'Nicolas' | 'Carla' | 'Autre'
 * @returns {{ token: string, user: object }}
 * @throws {Error} with statusCode 400/409 on validation failure
 */
function register(name, email, password, role = 'Autre') {
  if (!name || !email || !password) {
    const err = new Error('Tous les champs sont requis.');
    err.statusCode = 400;
    throw err;
  }
  if (password.length < 6) {
    const err = new Error('Le mot de passe doit faire au moins 6 caractères.');
    err.statusCode = 400;
    throw err;
  }
  const validRoles = ['Nicolas', 'Carla', 'Autre'];
  if (!validRoles.includes(role)) {
    const err = new Error('Rôle invalide.');
    err.statusCode = 400;
    throw err;
  }

  // Check for duplicate email
  const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email.trim().toLowerCase());
  if (existing) {
    const err = new Error('Cet e-mail est déjà utilisé.');
    err.statusCode = 409;
    throw err;
  }

  const password_hash = bcrypt.hashSync(password, 10);
  // Default color based on role
  const defaultColors = { Nicolas: '#3B8BD4', Carla: '#e06fa0', Autre: '#9e7bca' };
  const color = defaultColors[role] || '#9e7bca';

  const result = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, color)
    VALUES (?, ?, ?, ?, ?)
  `).run(name.trim(), email.trim().toLowerCase(), password_hash, role, color);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = createToken(user);
  return { token, user: sanitizeUser(user) };
}

/**
 * updateSettings(userId, { color, photo }) — Update user appearance settings.
 * @param {number} userId
 * @param {{ color?: string, photo?: string|null }} settings
 * @returns {object} updated safe user object
 * @throws {Error} with statusCode 404 if user not found
 */
function updateSettings(userId, { color, photo } = {}) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    const err = new Error('Utilisateur introuvable.');
    err.statusCode = 404;
    throw err;
  }

  // Build dynamic update
  const fields = [];
  const values = [];

  if (color !== undefined) {
    fields.push('color = ?');
    values.push(color);
  }
  if (photo !== undefined) {
    // photo can be a base64 string or null (to clear)
    fields.push('photo = ?');
    values.push(photo || null);
  }

  if (fields.length === 0) {
    return sanitizeUser(user); // Nothing to update
  }

  values.push(userId);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return sanitizeUser(updated);
}

function updateProfile(userId, { name, email } = {}) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) { const err = new Error('Utilisateur introuvable.'); err.statusCode = 404; throw err; }
  if (email && email.trim().toLowerCase() !== user.email) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id != ?').get(email.trim().toLowerCase(), userId);
    if (existing) { const err = new Error('Cet e-mail est déjà utilisé.'); err.statusCode = 409; throw err; }
  }
  const fields = [], values = [];
  if (name && name.trim()) { fields.push('name = ?'); values.push(name.trim()); }
  if (email && email.trim()) { fields.push('email = ?'); values.push(email.trim().toLowerCase()); }
  if (fields.length === 0) return sanitizeUser(user);
  values.push(userId);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return sanitizeUser(updated);
}

function changePassword(userId, { currentPassword, newPassword } = {}) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) { const err = new Error('Utilisateur introuvable.'); err.statusCode = 404; throw err; }
  const valid = bcrypt.compareSync(currentPassword || '', user.password_hash);
  if (!valid) { const err = new Error('Mot de passe actuel incorrect.'); err.statusCode = 401; throw err; }
  if (!newPassword || newPassword.length < 6) { const err = new Error('Le nouveau mot de passe doit faire au moins 6 caractères.'); err.statusCode = 400; throw err; }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  return { success: true };
}

module.exports = { getUsers, login, register, updateSettings, updateProfile, changePassword, sanitizeUser };
