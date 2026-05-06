'use strict';

const webpush            = require('web-push');
const cron               = require('node-cron');
const db                 = require('../config/database');
const monthlyExpensesSvc = require('./monthly_expenses.service');
const householdService   = require('./household.service');

let vapidPublicKey = null;

// ── Initialisation VAPID ──────────────────────────────────────────────────────

function init() {
  let publicKey  = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
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
      console.log('[Push] Nouvelles clés VAPID générées — copiez ces valeurs dans Railway :');
      console.log(`[Push] VAPID_PUBLIC_KEY="${publicKey}"`);
      console.log(`[Push] VAPID_PRIVATE_KEY="${privateKey}"`);
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
  // Persiste la notification en base (historique consultable)
  try {
    db.prepare('INSERT INTO notifications (user_id, title, body) VALUES (?, ?, ?)').run(userId, payload.title, payload.body);
  } catch (_) { /* notifications table peut ne pas encore exister en dev */ }

  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  const body  = JSON.stringify(payload);

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body
      );
    } catch (err) {
      console.error(`[Push] Erreur envoi sub ${sub.id}:`, err.statusCode, err.message);
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      }
    }
  }
}

// ── Historique notifications ──────────────────────────────────────────────────

function getNotifications(userId) {
  return db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(userId);
}

function markAllRead(userId) {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
}

function deleteNotification(id, userId) {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(id, userId);
}

function clearNotifications(userId) {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
}

// ── Stats budgétaires du mois en cours ───────────────────────────────────────

function getMonthlyStats(userId) {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const household = householdService.getForUser(userId);
  const scope = household && household.members.length > 0
    ? { userIds: household.members.map(m => m.id) }
    : { userId };
  const stats = monthlyExpensesSvc.getStats({ ...scope, year, month });

  const revenu   = stats.revenu?.actual   || 0;
  const impot    = stats.impot?.actual    || 0;
  const fixe     = stats.fixe?.actual     || 0;
  const variable = stats.variable?.actual || 0;
  const loisir   = stats.loisir?.actual   || 0;
  const epargne  = stats.epargne?.actual  || 0;
  const revNet   = revenu - impot;
  const dep      = fixe + variable + loisir;
  const rav      = revNet - dep - epargne;

  return { revenu, impot, revNet, fixe, variable, loisir, dep, epargne, rav };
}

const eur = n => Math.round(n).toLocaleString('fr-FR') + ' €';

const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin',
                'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

// ── Suivi des alertes déjà envoyées (anti-spam) ───────────────────────────────

function wasAlertSentToday(userId, alertKey) {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(`alert_${userId}_${alertKey}`);
  return row?.value === today;
}

function markAlertSent(userId, alertKey) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run(`alert_${userId}_${alertKey}`, today);
}

// ── Vérification et envoi des alertes budgétaires ────────────────────────────

async function checkBudgetAlerts(userId, memberName) {
  const s = getMonthlyStats(userId);
  if (s.revenu === 0) return; // pas de données ce mois → rien à vérifier

  const { revNet, dep, rav, fixe, impot, epargne } = s;
  const depRate   = revNet > 0 ? Math.round(dep    / revNet * 100) : 0;
  const fixRate   = revNet > 0 ? Math.round(fixe   / revNet * 100) : 0;
  const contrRate = revNet > 0 ? Math.round((impot + fixe) / revNet * 100) : 0;
  const epRate    = revNet > 0 ? Math.round(epargne / revNet * 100) : 0;
  const ravRate   = revNet > 0 ? Math.round(rav    / revNet * 100) : 0;

  // Jours de dépenses couverts par le matelas d'épargne
  const latestSav = db.prepare(`
    SELECT amount FROM savings WHERE member = ?
    ORDER BY year DESC,
      CASE month
        WHEN 'Janvier' THEN 1 WHEN 'Février' THEN 2 WHEN 'Mars' THEN 3
        WHEN 'Avril' THEN 4   WHEN 'Mai' THEN 5     WHEN 'Juin' THEN 6
        WHEN 'Juillet' THEN 7 WHEN 'Août' THEN 8    WHEN 'Septembre' THEN 9
        WHEN 'Octobre' THEN 10 WHEN 'Novembre' THEN 11 WHEN 'Décembre' THEN 12
      END DESC LIMIT 1
  `).get(memberName);
  const totalSav      = latestSav?.amount || 0;
  const joursCouverts = dep > 0 ? Math.round(totalSav / dep * 30) : null;

  // Score santé
  const scoreRig   = fixRate <= 30 ? 30 : fixRate <= 50 ? Math.round(30 - (fixRate - 30) * 0.75) : 0;
  const depRatePct = revNet > 0 ? dep / revNet * 100 : 0;
  const scoreDep   = depRatePct <= 50 ? 30 : depRatePct <= 70 ? Math.round(30 - (depRatePct - 50) * 1.5) : 0;
  const scoreSav   = Math.min(40, ravRate * 1.2);
  const healthScore = Math.round(scoreSav + scoreRig + scoreDep);

  const now   = new Date();
  const mois  = MONTHS[now.getMonth()];

  const ALERTS = [
    {
      key:       'rav_negatif',
      condition: rav < 0,
      title:     'Budget en déficit',
      body:      `Votre reste à vivre est de ${eur(rav)} en ${mois}. Vos dépenses dépassent vos revenus nets.`,
    },
    {
      key:       'dep_critique',
      condition: depRate > 70,
      title:     'Dépenses trop élevées',
      body:      `${depRate}% de vos revenus nets sont partis en dépenses ce mois-ci. Seuil recommandé : 70%.`,
    },
    {
      key:       'ep_faible',
      condition: epargne > 0 && epRate < 5,
      title:     'Épargne insuffisante',
      body:      `Votre taux d'épargne est de ${epRate}% en ${mois}. Visez au moins 10% de vos revenus nets.`,
    },
    {
      key:       'matelas_faible',
      condition: joursCouverts !== null && joursCouverts < 30,
      title:     'Matelas de sécurité faible',
      body:      `Votre épargne couvre ${joursCouverts} jour${joursCouverts > 1 ? 's' : ''} de dépenses. Objectif : 3 mois (90 jours).`,
    },
    {
      key:       'score_bas',
      condition: healthScore < 40,
      title:     'Santé financière dégradée',
      body:      `Votre score financier est de ${healthScore}/100 ce mois-ci. Ouvrez l'onglet Analyse pour en savoir plus.`,
    },
    {
      key:       'fixes_eleves',
      condition: fixRate > 50,
      title:     'Charges fixes élevées',
      body:      `Vos charges fixes représentent ${fixRate}% de vos revenus nets en ${mois}. Peu de flexibilité budgétaire.`,
    },
    {
      key:       'contrainte_elev',
      condition: contrRate > 55,
      title:     'Budget rigide',
      body:      `${contrRate}% de vos revenus sont mobilisés par les impôts et charges fixes. Peu de marge de manœuvre.`,
    },
  ];

  for (const alert of ALERTS) {
    if (alert.condition && !wasAlertSentToday(userId, alert.key)) {
      await sendToUser(userId, { title: alert.title, body: alert.body, url: '/' });
      markAlertSent(userId, alert.key);
      console.log(`[Push] Alerte "${alert.key}" envoyée → user ${userId}`);
    }
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function startScheduler() {

  // 1er du mois à 13h — rappel mise à jour épargne
  cron.schedule('0 13 1 * *', async () => {
    const month = MONTHS[new Date().getMonth()];
    const users = db.prepare('SELECT id, name FROM users').all();
    for (const user of users) {
      await sendToUser(user.id, {
        title: `Épargne de ${month}`,
        body:  `N'oubliez pas de saisir votre épargne pour ${month}.`,
        url:   '/',
      });
    }
    console.log(`[Push] Rappel épargne envoyé (${month})`);
  }, { timezone: 'Europe/Paris' });

  // Chaque lundi à 13h — résumé budgétaire du mois en cours
  cron.schedule('0 13 * * 1', async () => {
    const now   = new Date();
    const mois  = MONTHS[now.getMonth()];
    const users = db.prepare('SELECT id, name FROM users').all();
    for (const user of users) {
      const s = getMonthlyStats(user.id);
      if (s.revenu === 0) continue;
      const depRate = s.revNet > 0 ? Math.round(s.dep     / s.revNet * 100) : 0;
      const epRate  = s.revNet > 0 ? Math.round(s.epargne / s.revNet * 100) : 0;
      const suffix  = depRate > 80 ? ' — dépenses élevées ce mois-ci.' : '.';
      await sendToUser(user.id, {
        title: `Bilan de la semaine`,
        body:  `${mois} — Revenus nets ${eur(s.revNet)}, dépenses ${eur(s.dep)} (${depRate}%), épargne ${eur(s.epargne)} (${epRate}%)${suffix}`,
        url:   '/',
      });
    }
    console.log('[Push] Résumé hebdo envoyé');
  }, { timezone: 'Europe/Paris' });

  // Chaque jour à 8h — rappel des prélèvements du jour
  cron.schedule('0 8 * * *', async () => {
    const today = new Date().getDate();
    const rows = db.prepare(`
      SELECT e.user_id, e.name, e.amount
      FROM entries e
      WHERE e.cat = 'fixe' AND e.debit_day = ?
    `).all(today);

    // Grouper par user_id
    const byUser = {};
    for (const row of rows) {
      if (!byUser[row.user_id]) byUser[row.user_id] = [];
      byUser[row.user_id].push(row);
    }

    for (const [userId, charges] of Object.entries(byUser)) {
      const total = charges.reduce((s, c) => s + Math.abs(c.amount), 0);
      const liste = charges.map(c => c.name).join(', ');
      await sendToUser(Number(userId), {
        title: 'Prélèvement aujourd\'hui',
        body: `${liste} — ${Math.round(total).toLocaleString('fr-FR')} € débité ce jour.`,
        url: '/',
      });
    }
    if (rows.length > 0) console.log(`[Push] Rappels prélèvements envoyés (jour ${today})`);
  }, { timezone: 'Europe/Paris' });

  // Chaque jour à 13h — vérification des alertes budgétaires
  cron.schedule('0 13 * * *', async () => {
    const users = db.prepare('SELECT id, name FROM users').all();
    for (const user of users) {
      await checkBudgetAlerts(user.id, user.name);
    }
    console.log('[Push] Alertes budgétaires vérifiées');
  }, { timezone: 'Europe/Paris' });

  console.log('[Push] Scheduler démarré');
}

module.exports = { init, getPublicKey, subscribe, unsubscribe, sendToUser, startScheduler, checkBudgetAlerts, getNotifications, markAllRead, deleteNotification, clearNotifications };
