'use strict';

const svc = require('../services/household.service');

async function getHousehold(req, res, next) {
  try { res.json({ success: true, data: svc.getForUser(req.user.id) }); }
  catch (err) { next(err); }
}

async function createHousehold(req, res, next) {
  try { res.status(201).json({ success: true, data: svc.create(req.user.id) }); }
  catch (err) { next(err); }
}

async function generateInvite(req, res, next) {
  try { res.json({ success: true, data: svc.generateInvite(req.user.id) }); }
  catch (err) { next(err); }
}

async function joinHousehold(req, res, next) {
  try {
    const data = svc.join(req.user.id, req.body.code);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

async function leaveHousehold(req, res, next) {
  try { res.json({ success: true, data: svc.leave(req.user.id) }); }
  catch (err) { next(err); }
}

async function deleteHousehold(req, res, next) {
  try { res.json({ success: true, data: svc.deleteHousehold(req.user.id) }); }
  catch (err) { next(err); }
}

module.exports = { getHousehold, createHousehold, generateInvite, joinHousehold, leaveHousehold, deleteHousehold };
