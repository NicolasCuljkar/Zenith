'use strict';

const nodemailer = require('nodemailer');

// Transporter configuré via variables d'environnement
function createTransporter() {
  const host = process.env.SMTP_HOST;
  if (!host) return null; // email désactivé si non configuré

  return nodemailer.createTransport({
    host,
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

const FROM = () => process.env.SMTP_FROM || 'Zénith <noreply@zenith.app>';
const APP_URL = () => (process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '');

// ── Templates ─────────────────────────────────────────────────────────────────

function baseLayout(title, body) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;min-height:100vh">
  <tr><td align="center" style="padding:40px 20px">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
      <!-- Logo -->
      <tr><td style="padding-bottom:24px;text-align:center">
        <span style="font-size:1.5rem;font-weight:700;color:#e8eaf0;letter-spacing:-.03em">
          <span style="color:#3B8BD4">Zé</span>nith
        </span>
      </td></tr>
      <!-- Card -->
      <tr><td style="background:#1a1d27;border:1px solid #2a2e42;border-radius:16px;padding:32px">
        ${body}
      </td></tr>
      <!-- Footer -->
      <tr><td style="padding-top:20px;text-align:center;font-size:12px;color:#6b7280">
        Zénith Budget Manager · Cet e-mail a été envoyé automatiquement, merci de ne pas y répondre.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function welcomeTemplate(name) {
  const html = baseLayout('Bienvenue sur Zénith', `
    <h1 style="margin:0 0 8px;font-size:1.3rem;font-weight:700;color:#e8eaf0;letter-spacing:-.02em">
      Bienvenue, ${name} !
    </h1>
    <p style="margin:0 0 20px;font-size:.9rem;color:#8b93a5;line-height:1.6">
      Votre compte Zénith a bien été créé. Vous pouvez dès maintenant gérer votre budget mensuel, suivre votre épargne et analyser vos finances.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#22263a;border-radius:10px;margin-bottom:24px">
      <tr><td style="padding:16px 18px">
        <p style="margin:0 0 6px;font-size:.75rem;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Quelques conseils pour démarrer</p>
        <ul style="margin:8px 0 0;padding-left:18px;color:#8b93a5;font-size:.85rem;line-height:1.8">
          <li>Ajoutez vos revenus et dépenses dans <strong style="color:#e8eaf0">Lignes budgétaires</strong></li>
          <li>Suivez votre épargne dans l'onglet <strong style="color:#e8eaf0">Épargne</strong></li>
          <li>Consultez vos analyses dans <strong style="color:#e8eaf0">Analyses</strong></li>
        </ul>
      </td></tr>
    </table>
    <a href="${APP_URL()}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#3B8BD4,#e06fa0);color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:.9rem">
      Accéder à l'application →
    </a>
  `);
  return { subject: 'Bienvenue sur Zénith 🎉', html };
}

function resetPasswordTemplate(name, resetUrl) {
  const html = baseLayout('Réinitialisation de mot de passe', `
    <h1 style="margin:0 0 8px;font-size:1.3rem;font-weight:700;color:#e8eaf0;letter-spacing:-.02em">
      Réinitialiser votre mot de passe
    </h1>
    <p style="margin:0 0 20px;font-size:.9rem;color:#8b93a5;line-height:1.6">
      Bonjour ${name},<br><br>
      Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau. Ce lien est valable <strong style="color:#e8eaf0">1 heure</strong>.
    </p>
    <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:#3B8BD4;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:.9rem;margin-bottom:20px">
      Réinitialiser mon mot de passe →
    </a>
    <p style="margin:16px 0 0;font-size:.8rem;color:#6b7280;line-height:1.5">
      Si vous n'avez pas demandé de réinitialisation, ignorez cet e-mail — votre mot de passe ne sera pas modifié.<br>
      Ce lien expirera dans 1 heure.
    </p>
  `);
  return { subject: 'Réinitialisation de votre mot de passe Zénith', html };
}

// ── Send helpers ──────────────────────────────────────────────────────────────

async function sendWelcome(to, name) {
  const transporter = createTransporter();
  if (!transporter) return; // silently skip if not configured
  const { subject, html } = welcomeTemplate(name);
  await transporter.sendMail({ from: FROM(), to, subject, html });
}

async function sendPasswordReset(to, name, token) {
  const transporter = createTransporter();
  if (!transporter) throw new Error('Le service e-mail n\'est pas configuré sur ce serveur.');
  const resetUrl = `${APP_URL()}/?reset=${token}`;
  const { subject, html } = resetPasswordTemplate(name, resetUrl);
  await transporter.sendMail({ from: FROM(), to, subject, html });
}

module.exports = { sendWelcome, sendPasswordReset };
