/**
 * auth.controller.js — Thin controller layer for authentication routes.
 * Delegates all logic to auth.service.js, handles HTTP responses.
 */

'use strict';

const authService = require('../services/auth.service');

/**
 * GET /api/auth/users
 * List all users for the profile picker (no passwords returned).
 */
async function listUsers(req, res, next) {
  try {
    const users = authService.getUsers();
    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { success, data: { token, user } }
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const result = authService.login(email, password);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/register
 * Body: { name, email, password, role }
 * Returns: { success, data: { token, user } }
 */
async function register(req, res, next) {
  try {
    const { name, email, password, role } = req.body;
    const result = authService.register(name, email, password, role);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/users/settings
 * Body: { color?, photo? }
 * Requires: Bearer JWT (req.user.id set by auth middleware)
 * Returns: { success, data: updatedUser }
 */
async function updateSettings(req, res, next) {
  try {
    const userId = req.user.id;
    const { color, photo } = req.body;
    const updatedUser = authService.updateSettings(userId, { color, photo });
    res.json({ success: true, data: updatedUser });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/auth/me
 * Returns current authenticated user (from JWT).
 */
async function getMe(req, res, next) {
  try {
    const users = authService.getUsers();
    const user = users.find(u => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    }
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const { name, email } = req.body;
    const updatedUser = authService.updateProfile(req.user.id, { name, email });
    res.json({ success: true, data: updatedUser });
  } catch (err) { next(err); }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    const result = authService.changePassword(req.user.id, { currentPassword, newPassword });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

module.exports = { listUsers, login, register, updateSettings, updateProfile, changePassword, getMe };
