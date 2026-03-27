'use strict';

const webpush = require('web-push');
const cron    = require('node-cron');
const db      = require('../config/database');

let vapidPublicKey = null;

// ── Initialisation VAPID ──────────────────────────────────────────────────────

function init() {
  let publicKey  = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    // Génération auto + stockage en DB si pas de vars d'env
    const rows = db.prepare("SELECT key, value FROM config WHERE key IN ('vapid_public','vapid_private')").all();
    const map  = Object.fromEntries(rows.map(r => [r.key, r.value]));

    if (map.vapid_public && map.vapid_private) {
      publicKey  = map.vapid_public;
      privateKey = map.vapid_private;
    } else {
      const keys = webpush.generateVAPIDKeys();
      publicKey  = keys.publicKey;
      privateKey = keys.privateKey;
      db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('vapid_public',  ?)").run(publicKey);
      db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('vapid_private', ?)").run(privateKey);
      console.log('[Push] Nouvelles clés VAPID générées');
    }
  }

  webpush.setVapidDetails('mailto:no-reply@zenith.app', publicKey, privateKey);
  vapidPublicKey = publicKey;
  console.log('[Push] VAPID initialisé');
}

function getPublicKey() { return vapidPublicKey; }

// ── Gestion des subscriptions ─────────────────────────────────────────────────

function subscribe(userId, subscription) {
  const { endpoint, keys } = subscription;
  db.prepare(`
    INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?)
  `).run(userId, endpoint, keys.p256dh, keys.auth);
}

function unsubscribe(userId, endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint);
}

// ── Envoi ─────────────────────────────────────────────────────────────────────

async function sendToUser(userId, payload) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  const body  = JSON.stringify(payload);

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body
      );
    } catch (err) {
      // Subscription expirée ou invalide → on la supprime
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      }
    }
  }
}

// ── Stats budgétaires (pour les résumés) ──────────────────────────────────────

function getUserStats(memberName) {
  const entries = db.prepare('SELECT cat, amount FROM entries WHERE member = ?').all(memberName);
  const sum = cat => entries.filter(e => e.cat === cat).reduce((s, e) => s + Math.abs(e.amount), 0);
  const rev    = sum('revenu');
  const tax    = sum('impot');
  const revNet = rev - tax;
  const dep    = sum('fixe') + sum('variable');
  const rav    = revNet - dep;
  const ep     = sum('epargne');
  return { rev, tax, revNet, dep, rav, ep };
}

const eur = n => Math.round(n).toLocaleString('fr-FR') + ' €';

const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin',
                'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

// ── Scheduler ─────────────────────────────────────────────────────────────────

function startScheduler() {

  // 1er du mois à 9h — rappel mise à jour épargne
  cron.schedule('0 9 1 * *', async () => {
    const month = MONTHS[new Date().getMonth()];
    const users = db.prepare('SELECT id, name FROM users').all();
    for (const user of users) {
      await sendToUser(user.id, {
        title: '💰 Rappel épargne — Zénith',
        body:  `Pensez à mettre à jour votre épargne pour ${month} !`,
        url:   '/index.html#savings',
      });
    }
    console.log(`[Push] Rappel épargne envoyé (${month})`);
  }, { timezone: 'Europe/Paris' });

  // Chaque lundi à 8h — résumé budgétaire hebdo
  cron.schedule('0 8 * * 1', async () => {
    const users = db.prepare('SELECT id, name FROM users').all();
    for (const user of users) {
      const s = getUserStats(user.name);
      if (s.rev === 0) continue; // pas de données → pas de notif
      const depRate = s.revNet > 0 ? Math.round(s.dep / s.revNet * 100) : 0;
      const alert   = depRate > 80 ? ' ⚠️ Dépenses élevées !' : '';
      await sendToUser(user.id, {
        title: `📊 Résumé hebdo — ${user.name}`,
        body:  `Revenus nets ${eur(s.revNet)} · Dépenses ${eur(s.dep)} (${depRate}%) · Reste à vivre ${eur(s.rav)}${alert}`,
        url:   '/',
      });
    }
    console.log('[Push] Résumé hebdo envoyé');
  }, { timezone: 'Europe/Paris' });

  console.log('[Push] Scheduler démarré');
}

module.exports = { init, getPublicKey, subscribe, unsubscribe, sendToUser, startScheduler };
