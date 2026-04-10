'use strict';

const db   = require('../config/database');
const bcrypt = require('bcryptjs');

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function getUsers() {
  return db.prepare(`
    SELECT
      u.id, u.name, u.email, u.role, u.color, u.is_admin, u.created_at, u.last_login_at,
      (SELECT COUNT(*) FROM entries          WHERE user_id = u.id) AS entries_count,
      (SELECT COUNT(*) FROM savings          WHERE user_id = u.id) AS savings_count,
      (SELECT COUNT(*) FROM monthly_expenses WHERE user_id = u.id) AS monthly_count,
      (SELECT h.id FROM households h
        JOIN household_members hm ON hm.household_id = h.id
        WHERE hm.user_id = u.id LIMIT 1) AS household_id
    FROM users u
    ORDER BY u.id ASC
  `).all();
}

function getUserData(userId) {
  const user = db.prepare('SELECT id, name, email, role, color, is_admin, created_at, last_login_at FROM users WHERE id = ?').get(userId);
  if (!user) throw httpError('Utilisateur introuvable.', 404);
  const entries          = db.prepare('SELECT id, name, amount, cat, member, created_at FROM entries WHERE user_id = ? ORDER BY cat, ABS(amount) DESC').all(userId);
  const savings          = db.prepare('SELECT id, year, month, amount, delta FROM savings WHERE user_id = ? ORDER BY year DESC, id DESC').all(userId);
  const monthlyExpenses  = db.prepare('SELECT id, year, month, name, amount, cat, created_at FROM monthly_expenses WHERE user_id = ? ORDER BY year DESC, month DESC, created_at DESC').all(userId);
  return { user, entries, savings, monthlyExpenses };
}

function deleteUser(userId, adminId) {
  if (userId === adminId) throw httpError('Impossible de supprimer son propre compte.', 400);
  const user = db.prepare('SELECT id, is_admin FROM users WHERE id = ?').get(userId);
  if (!user) throw httpError('Utilisateur introuvable.', 404);
  if (user.is_admin) throw httpError('Impossible de supprimer un compte administrateur.', 403);
  // Supprime les foyers dont l'user est créateur (CASCADE nettoie membres et invitations)
  db.prepare('DELETE FROM households WHERE creator_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return { deleted: true };
}

function resetPassword(userId, adminId) {
  if (userId === adminId) throw httpError('Utilisez les réglages pour changer votre propre mot de passe.', 400);
  const user = db.prepare('SELECT id, is_admin FROM users WHERE id = ?').get(userId);
  if (!user) throw httpError('Utilisateur introuvable.', 404);
  if (user.is_admin) throw httpError('Impossible de modifier le mot de passe d\'un administrateur.', 403);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  let pwd = '';
  for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(pwd, 10), userId);
  return { newPassword: pwd };
}

module.exports = { getUsers, getUserData, deleteUser, resetPassword };
