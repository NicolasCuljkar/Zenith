'use strict';

const svc = require('../services/admin.service');

async function listUsers(req, res, next) {
  try { res.json({ success: true, data: svc.getUsers() }); }
  catch (err) { next(err); }
}

async function getUserData(req, res, next) {
  try { res.json({ success: true, data: svc.getUserData(Number(req.params.id)) }); }
  catch (err) { next(err); }
}

async function deleteUser(req, res, next) {
  try { res.json({ success: true, data: svc.deleteUser(Number(req.params.id), req.user.id) }); }
  catch (err) { next(err); }
}

async function resetPassword(req, res, next) {
  try { res.json({ success: true, data: svc.resetPassword(Number(req.params.id), req.user.id) }); }
  catch (err) { next(err); }
}

module.exports = { listUsers, getUserData, deleteUser, resetPassword };
