'use strict';

const db = require('../config/database');

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function generateCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CHARS[Math.floor(Math.random() * CHARS.length)];
  return code;
}

function getMembers(householdId) {
  return db.prepare(`
    SELECT u.id, u.name, u.role, u.color, u.photo
    FROM household_members hm
    JOIN users u ON u.id = hm.user_id
    WHERE hm.household_id = ?
    ORDER BY hm.joined_at ASC
  `).all(householdId);
}

function getForUser(userId) {
  const row = db.prepare(`
    SELECT h.id, h.created_at
    FROM households h
    JOIN household_members hm ON hm.household_id = h.id
    WHERE hm.user_id = ?
  `).get(userId);
  if (!row) return null;
  return { ...row, members: getMembers(row.id) };
}

function create(userId) {
  if (getForUser(userId)) throw httpError('Vous faites déjà partie d\'un foyer.', 409);

  const result = db.prepare('INSERT INTO households DEFAULT VALUES').run();
  const householdId = result.lastInsertRowid;
  db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').run(householdId, userId);

  return getForUser(userId);
}

function generateInvite(userId) {
  const household = getForUser(userId);
  if (!household) throw httpError('Vous ne faites pas partie d\'un foyer.', 404);

  db.prepare('DELETE FROM household_invites WHERE household_id = ?').run(household.id);

  let code;
  let attempts = 0;
  do {
    code = generateCode();
    if (++attempts > 20) throw httpError('Impossible de générer un code unique.', 500);
  } while (db.prepare('SELECT id FROM household_invites WHERE code = ?').get(code));

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO household_invites (household_id, code, expires_at) VALUES (?, ?, ?)').run(household.id, code, expiresAt);

  return { code, expires_at: expiresAt };
}

function join(userId, code) {
  if (!code) throw httpError('Code requis.', 400);
  if (getForUser(userId)) throw httpError('Vous faites déjà partie d\'un foyer.', 409);

  const invite = db.prepare('SELECT * FROM household_invites WHERE code = ?').get(code.toUpperCase().trim());
  if (!invite) throw httpError('Code invalide ou expiré.', 404);
  if (new Date(invite.expires_at) < new Date()) {
    db.prepare('DELETE FROM household_invites WHERE id = ?').run(invite.id);
    throw httpError('Ce code a expiré. Demandez-en un nouveau.', 410);
  }

  const already = db.prepare('SELECT id FROM household_members WHERE household_id = ? AND user_id = ?').get(invite.household_id, userId);
  if (already) throw httpError('Vous êtes déjà membre de ce foyer.', 409);

  db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').run(invite.household_id, userId);
  db.prepare('DELETE FROM household_invites WHERE id = ?').run(invite.id);

  return getForUser(userId);
}

function leave(userId) {
  const household = getForUser(userId);
  if (!household) throw httpError('Vous ne faites pas partie d\'un foyer.', 404);

  db.prepare('DELETE FROM household_members WHERE household_id = ? AND user_id = ?').run(household.id, userId);

  const remaining = db.prepare('SELECT COUNT(*) AS cnt FROM household_members WHERE household_id = ?').get(household.id).cnt;
  if (remaining === 0) {
    db.prepare('DELETE FROM households WHERE id = ?').run(household.id);
  }

  return { left: true };
}

module.exports = { getForUser, create, generateInvite, join, leave };
