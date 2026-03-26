'use strict';

const authService = require('../services/auth.service');

async function listUsers(req, res, next) {
  try {
    res.json({ success: true, data: authService.getPublicUsers() });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    res.json({ success: true, data: authService.login(email, password) });
  } catch (err) {
    next(err);
  }
}

async function register(req, res, next) {
  try {
    const { name, email, password, role } = req.body;
    res.status(201).json({ success: true, data: authService.register(name, email, password, role) });
  } catch (err) {
    next(err);
  }
}

async function getMe(req, res, next) {
  try {
    const user = authService.getUsers().find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

async function updateSettings(req, res, next) {
  try {
    const { color, photo } = req.body;
    res.json({ success: true, data: authService.updateSettings(req.user.id, { color, photo }) });
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const { name, email } = req.body;
    res.json({ success: true, data: authService.updateProfile(req.user.id, { name, email }) });
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    res.json({ success: true, data: authService.changePassword(req.user.id, { currentPassword, newPassword }) });
  } catch (err) {
    next(err);
  }
}

module.exports = { listUsers, login, register, getMe, updateSettings, updateProfile, changePassword };
