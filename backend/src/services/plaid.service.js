'use strict';

/**
 * plaid.service.js — Intégration Plaid (Open Banking)
 *
 * Flux :
 * 1. createLinkToken(userId)            → link_token pour Plaid Link (frontend)
 * 2. exchangePublicToken(userId, token) → access_token stocké en DB + sync
 * 3. syncItem(userId, itemId)           → rafraîchit comptes + transactions
 */

const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = require('plaid');
const db = require('../config/database');

const CLIENT_ID = process.env.PLAID_CLIENT_ID;
const SECRET    = process.env.PLAID_SECRET;
const ENV       = process.env.PLAID_ENV || 'sandbox';

function getClient() {
  if (!CLIENT_ID || !SECRET) {
    const err = new Error('Plaid non configuré. Ajoutez PLAID_CLIENT_ID et PLAID_SECRET dans votre .env.');
    err.statusCode = 503;
    throw err;
  }
  const config = new Configuration({
    basePath   : PlaidEnvironments[ENV],
    baseOptions : { headers: { 'PLAID-CLIENT-ID': CLIENT_ID, 'PLAID-SECRET': SECRET } },
  });
  return new PlaidApi(config);
}

// ── Link token ────────────────────────────────────────────────────────────────

async function createLinkToken(userId) {
  const client = getClient();
  const res = await client.linkTokenCreate({
    user          : { client_user_id: String(userId) },
    client_name   : 'Zenith',
    products      : [Products.Transactions],
    country_codes : [CountryCode.Fr],
    language      : 'fr',
  });
  return { link_token: res.data.link_token };
}

// ── Exchange public token → access token ──────────────────────────────────────

async function exchangePublicToken(userId, publicToken, institutionName) {
  const client = getClient();
  const res = await client.itemPublicTokenExchange({ public_token: publicToken });
  const { access_token, item_id } = res.data;

  db.prepare(`
    INSERT OR IGNORE INTO plaid_items (user_id, item_id, access_token, institution_name)
    VALUES (?, ?, ?, ?)
  `).run(userId, item_id, access_token, institutionName || 'Banque');

  await syncItem(userId, item_id);
  return { item_id };
}

// ── Sync comptes + transactions ───────────────────────────────────────────────

async function syncItem(userId, itemId) {
  const client = getClient();
  const row = db.prepare(`SELECT access_token, cursor FROM plaid_items WHERE item_id = ? AND user_id = ?`).get(itemId, userId);
  if (!row) throw Object.assign(new Error('Item introuvable'), { statusCode: 404 });

  // Comptes
  const accRes  = await client.accountsGet({ access_token: row.access_token });
  let accCount  = 0;
  for (const acc of accRes.data.accounts) {
    db.prepare(`
      INSERT INTO plaid_accounts
        (user_id, item_id, account_id, name, type, subtype, balance_current, balance_available, currency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        name=excluded.name, balance_current=excluded.balance_current,
        balance_available=excluded.balance_available, updated_at=datetime('now')
    `).run(
      userId, itemId, acc.account_id, acc.name, acc.type, acc.subtype,
      acc.balances.current ?? 0, acc.balances.available ?? 0,
      acc.balances.iso_currency_code || 'EUR'
    );
    accCount++;
  }

  // Transactions (cursor-based sync)
  let cursor  = row.cursor || null;
  let txCount = 0;
  let hasMore = true;

  const upsertTx = db.prepare(`
    INSERT INTO plaid_transactions
      (account_id, transaction_id, amount, currency, date, description, category, is_pending)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(transaction_id) DO UPDATE SET
      amount=excluded.amount, description=excluded.description,
      is_pending=excluded.is_pending, category=excluded.category
  `);

  while (hasMore) {
    const params = { access_token: row.access_token };
    if (cursor) params.cursor = cursor;
    const r = await client.transactionsSync(params);

    for (const tx of r.data.added || []) {
      upsertTx.run(
        tx.account_id, tx.transaction_id, tx.amount,
        tx.iso_currency_code || 'EUR',
        tx.date,
        tx.name || tx.merchant_name || '',
        tx.personal_finance_category?.primary || (tx.category || [])[0] || '',
        tx.pending ? 1 : 0
      );
      txCount++;
    }
    // Mise à jour des transactions modifiées
    for (const tx of r.data.modified || []) {
      upsertTx.run(
        tx.account_id, tx.transaction_id, tx.amount,
        tx.iso_currency_code || 'EUR',
        tx.date,
        tx.name || tx.merchant_name || '',
        tx.personal_finance_category?.primary || (tx.category || [])[0] || '',
        tx.pending ? 1 : 0
      );
    }
    // Suppression des transactions retirées
    for (const tx of r.data.removed || []) {
      db.prepare(`DELETE FROM plaid_transactions WHERE transaction_id = ?`).run(tx.transaction_id);
    }

    cursor  = r.data.next_cursor;
    hasMore = r.data.has_more;
  }

  db.prepare(`UPDATE plaid_items SET cursor = ?, synced_at = datetime('now') WHERE item_id = ?`).run(cursor, itemId);
  return { accounts: accCount, transactions: txCount };
}

async function syncAll(userId) {
  const items = db.prepare(`SELECT item_id FROM plaid_items WHERE user_id = ?`).all(userId);
  let total = { accounts: 0, transactions: 0 };
  for (const { item_id } of items) {
    const r = await syncItem(userId, item_id);
    total.accounts     += r.accounts;
    total.transactions += r.transactions;
  }
  return total;
}

// ── Suppression ───────────────────────────────────────────────────────────────

async function deleteItem(userId, itemId) {
  const row = db.prepare(`SELECT access_token FROM plaid_items WHERE item_id = ? AND user_id = ?`).get(itemId, userId);
  if (row) {
    try {
      const client = getClient();
      await client.itemRemove({ access_token: row.access_token });
    } catch (e) { console.warn('[Plaid] Remove error:', e.message); }
  }
  const accounts = db.prepare(`SELECT account_id FROM plaid_accounts WHERE item_id = ?`).all(itemId);
  for (const { account_id } of accounts) {
    db.prepare(`DELETE FROM plaid_transactions WHERE account_id = ?`).run(account_id);
  }
  db.prepare(`DELETE FROM plaid_accounts WHERE item_id = ?`).run(itemId);
  db.prepare(`DELETE FROM plaid_items WHERE item_id = ? AND user_id = ?`).run(itemId, userId);
}

// ── Lecture locale ────────────────────────────────────────────────────────────

function getItemsForUser(userId) {
  const items = db.prepare(`SELECT id, item_id, institution_name, synced_at, created_at FROM plaid_items WHERE user_id = ? ORDER BY created_at ASC`).all(userId);
  return items.map(item => ({
    ...item,
    accounts: db.prepare(`SELECT * FROM plaid_accounts WHERE item_id = ? ORDER BY name ASC`).all(item.item_id),
  }));
}

function getTransactionsForUser(userId, { accountId, limit = 50, offset = 0 } = {}) {
  let sql = `
    SELECT pt.*, pa.name as account_name, pi.institution_name as bank_name
    FROM plaid_transactions pt
    JOIN plaid_accounts pa ON pa.account_id = pt.account_id
    JOIN plaid_items pi    ON pi.item_id    = pa.item_id
    WHERE pi.user_id = ?
  `;
  const params = [userId];
  if (accountId) { sql += ` AND pt.account_id = ?`; params.push(accountId); }
  sql += ` ORDER BY pt.date DESC, pt.transaction_id DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

function getSummaryForUser(userId) {
  const accounts = db.prepare(`
    SELECT pa.*, pi.institution_name as bank_name
    FROM plaid_accounts pa
    JOIN plaid_items pi ON pi.item_id = pa.item_id
    WHERE pi.user_id = ?
  `).all(userId);
  const totalBalance  = accounts.reduce((s, a) => s + (a.balance_current || 0), 0);
  const totalPositive = accounts.filter(a => a.balance_current > 0).reduce((s, a) => s + a.balance_current, 0);
  const totalNegative = accounts.filter(a => a.balance_current < 0).reduce((s, a) => s + a.balance_current, 0);
  return { totalBalance, totalPositive, totalNegative, accounts };
}

module.exports = {
  createLinkToken, exchangePublicToken,
  syncItem, syncAll, deleteItem,
  getItemsForUser, getTransactionsForUser, getSummaryForUser,
};
