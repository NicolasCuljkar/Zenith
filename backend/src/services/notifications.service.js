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

// ── Stats budgétaires ─────────────────────────────────────────────────────────

function getUserStats(memberName) {
  const entries = db.prepare('SELECT cat, amount FROM entries WHERE member = ?').all(memberName);
  const sum = cat => entries.filter(e => e.cat === cat).reduce((s, e) => s + Math.abs(e.amount), 0);
  const rev    = sum('revenu');
  const tax    = sum('impot');
  const fix    = sum('fixe');
  const vari   = sum('variable');
  const revNet = rev - tax;
  const dep    = fix + vari;
  const rav    = revNet - dep;
  const ep     = sum('epargne');
  return { rev, tax, fix, vari, revNet, dep, rav, ep };
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
  const s = getUserStats(memberName);
  if (s.rev === 0) return; // pas de données → rien à vérifier

  const revNet     = s.revNet;
  const dep        = s.dep;
  const rav        = s.rav;
  const fix        = s.fix;
  const tax        = s.tax;
  const depRate    = revNet > 0 ? Math.round(dep    / revNet * 100) : 0;
  const fixRate    = revNet > 0 ? Math.round(fix    / revNet * 100) : 0;
  const contrRate  = revNet > 0 ? Math.round((tax + fix) / revNet * 100) : 0;
  const epRate     = revNet > 0 ? Math.round(s.ep   / revNet * 100) : 0;
  const ravRate    = revNet > 0 ? Math.round(rav    / revNet * 100) : 0;

  // Jours couverts par l'épargne (dernier enregistrement)
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
  const totalSav = latestSav?.amount || 0;
  const joursCouverts = dep > 0 ? Math.round(totalSav / dep * 30) : null;

  // Score santé simplifié (sans savingPct)
  const scoreRig = fixRate <= 30 ? 30 : fixRate <= 50 ? Math.round(30 - (fixRate - 30) * 0.75) : 0;
  const depRatePct = revNet > 0 ? dep / revNet * 100 : 0;
  const scoreDep = depRatePct <= 50 ? 30 : depRatePct <= 70 ? Math.round(30 - (depRatePct - 50) * 1.5) : 0;
  const scoreSav = Math.min(40, ravRate * 1.2); // approximation sans savingPct
  const healthScore = Math.round(scoreSav + scoreRig + scoreDep);

  const ALERTS = [
    {
      key: 'rav_negatif',
      condition: rav < 0,
      title: '🔴 Budget en déficit — Zénith',
      body:  `Votre reste à vivre est négatif (${eur(rav)}). Vos dépenses dépassent vos revenus nets.`,
    },
    {
      key: 'dep_critique',
      condition: depRate > 70,
      title: '🔴 Dépenses critiques — Zénith',
      body:  `Vos dépenses représentent ${depRate}% de vos revenus nets. Seuil critique : 70%.`,
    },
    {
      key: 'ep_faible',
      condition: s.ep > 0 && epRate < 5,
      title: '🔴 Épargne insuffisante — Zénith',
      body:  `Votre taux d'épargne est de ${epRate}%. Objectif minimum recommandé : 10%.`,
    },
    {
      key: 'matelas_faible',
      condition: joursCouverts !== null && joursCouverts < 30,
      title: '🟠 Matelas de sécurité insuffisant — Zénith',
      body:  `Votre épargne couvre ${joursCouverts} jours de dépenses. Objectif recommandé : 90 jours (3 mois).`,
    },
    {
      key: 'score_bas',
      condition: healthScore < 40,
      title: '🔴 Score santé faible — Zénith',
      body:  `Votre score santé financière est de ${healthScore}/100. Consultez l'onglet Analyse pour les détails.`,
    },
    {
      key: 'fixes_eleves',
      condition: fixRate > 50,
      title: '🟠 Charges fixes élevées — Zénith',
      body:  `Vos charges fixes représentent ${fixRate}% de vos revenus nets. Peu de flexibilité budgétaire.`,
    },
    {
      key: 'contrainte_elev',
      condition: contrRate > 55,
      title: '🟠 Budget très rigide — Zénith',
      body:  `${contrRate}% de vos revenus sont bloqués (impôts + charges fixes). Votre budget manque de flexibilité.`,
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
      if (s.rev === 0) continue;
      const depRate  = s.revNet > 0 ? Math.round(s.dep / s.revNet * 100) : 0;
      const epRate   = s.revNet > 0 ? Math.round(s.ep  / s.revNet * 100) : 0;
      const alert    = depRate > 80 ? ' ⚠️ Dépenses élevées !' : '';
      await sendToUser(user.id, {
        title: `📊 Résumé hebdo — ${user.name}`,
        body:  `Revenus nets ${eur(s.revNet)} · Dépenses ${eur(s.dep)} (${depRate}%) · Épargne ${eur(s.ep)} (${epRate}%)${alert}`,
        url:   '/',
      });
    }
    console.log('[Push] Résumé hebdo envoyé');
  }, { timezone: 'Europe/Paris' });

  // Chaque jour à 7h30 — vérification des alertes budgétaires
  cron.schedule('30 7 * * *', async () => {
    const users = db.prepare('SELECT id, name FROM users').all();
    for (const user of users) {
      await checkBudgetAlerts(user.id, user.name);
    }
    console.log('[Push] Alertes budgétaires vérifiées');
  }, { timezone: 'Europe/Paris' });

  console.log('[Push] Scheduler démarré');
}

module.exports = { init, getPublicKey, subscribe, unsubscribe, sendToUser, startScheduler, checkBudgetAlerts };
