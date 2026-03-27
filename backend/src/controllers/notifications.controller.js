'use strict';

const notifService = require('../services/notifications.service');

async function getVapidKey(req, res, next) {
  try {
    res.json({ success: true, data: { publicKey: notifService.getPublicKey() } });
  } catch (err) { next(err); }
}

async function subscribe(req, res, next) {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ success: false, error: 'Subscription invalide.' });
    }
    notifService.subscribe(req.user.id, subscription);
    res.json({ success: true });
  } catch (err) { next(err); }
}

async function unsubscribe(req, res, next) {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ success: false, error: 'Endpoint manquant.' });
    notifService.unsubscribe(req.user.id, endpoint);
    res.json({ success: true });
  } catch (err) { next(err); }
}

async function debug(req, res, next) {
  try {
    const db = require('../config/database');
    const subs = db.prepare('SELECT id, endpoint FROM push_subscriptions WHERE user_id = ?').all(req.user.id);
    res.json({ success: true, data: { count: subs.length, endpoints: subs.map(s => s.endpoint.slice(0, 60) + '...') } });
  } catch (err) { next(err); }
}

async function test(req, res, next) {
  try {
    await notifService.sendToUser(req.user.id, {
      title: '🔔 Test — Zénith',
      body:  'Les notifications fonctionnent correctement !',
      url:   '/',
    });
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = { getVapidKey, subscribe, unsubscribe, test };
