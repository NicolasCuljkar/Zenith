'use strict';

/**
 * bridge.service.js — Bridge API v3 (bridgeapi.io) integration
 * API version : 2025-01-15
 * Base URL    : https://api.bridgeapi.io/v3
 */

const https  = require('https');
const crypto = require('crypto');
const db     = require('../config/database');
require('dotenv').config();

const BRIDGE_BASE    = 'https://api.bridgeapi.io/v3';
const BRIDGE_VERSION = '2025-01-15';
const CLIENT_ID      = process.env.BRIDGE_CLIENT_ID;
const CLIENT_SECRET  = process.env.BRIDGE_CLIENT_SECRET;

const ACCOUNT_TYPES = {
  0: 'Courant', 1: 'Épargne', 2: 'Bourse',
  3: 'Carte de crédit', 4: 'Prêt', 5: 'Autre',
};

// ── HTTP helper ──────────────────────────────────────────────────────────────

function bridgeRequest(method, path, body, accessToken) {
  return new Promise((resolve, reject) => {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return reject(Object.assign(
        new Error('Bridge API non configurée. Ajoutez BRIDGE_CLIENT_ID et BRIDGE_CLIENT_SECRET.'),
        { statusCode: 503 }
      ));
    }

    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type'  : 'application/json',
      'Accept'        : 'application/json',
      'Bridge-Version': BRIDGE_VERSION,
      'Client-Id'     : CLIENT_ID,
      'Client-Secret' : CLIENT_SECRET,
    };
    if (accessToken)  headers['Authorization']  = `Bearer ${accessToken}`;
    if (payload)      headers['Content-Length'] = Buffer.byteLength(payload);

    const url  = new URL(BRIDGE_BASE + path);
    const opts = {
      hostname: url.hostname,
      path    : url.pathname + url.search,
      method,
      headers,
    };

    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(raw); } catch { json = { raw }; }
        console.log(`[Bridge] ${method} ${path} → ${res.statusCode}`);
        if (res.statusCode >= 400) {
          const msg = json.errors?.[0]?.message || json.message || `Bridge API error ${res.statusCode}`;
          const err = new Error(`[Bridge ${method} ${path}] ${msg}`);
          err.statusCode = res.statusCode;
          err.data       = json;
          return reject(err);
        }
        resolve(json);
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── User management ──────────────────────────────────────────────────────────

async function getOrCreateBridgeUser(userId) {
  let row = db.prepare('SELECT * FROM bridge_users WHERE user_id = ?').get(userId);

  if (!row) {
    const externalId = `zenith_user_${userId}`;
    const created    = await bridgeRequest('POST', '/aggregation/users', {
      external_user_id: externalId,
    });

    const bridgeUuid = created.uuid || created.id || null;

    db.prepare(`
      INSERT INTO bridge_users (user_id, bridge_uuid, bridge_email, bridge_password)
      VALUES (?, ?, '', '')
    `).run(userId, bridgeUuid);

    row = db.prepare('SELECT * FROM bridge_users WHERE user_id = ?').get(userId);
  }

  row = await ensureToken(row);
  return row;
}

async function ensureToken(row) {
  const now = new Date().toISOString();
  if (row.access_token && row.token_expires_at && row.token_expires_at > now) {
    return row;
  }

  // v3: POST /aggregation/authorization/token with user_uuid
  const auth = await bridgeRequest('POST', '/aggregation/authorization/token', {
    user_uuid: row.bridge_uuid,
  });

  const accessToken = auth.access_token || auth.token || null;
  // Tokens valid 2 hours
  const expiresAt   = auth.expires_at || new Date(Date.now() + 2 * 3600 * 1000).toISOString();

  db.prepare(`UPDATE bridge_users SET access_token = ?, token_expires_at = ? WHERE id = ?`)
    .run(accessToken, expiresAt, row.id);

  return { ...row, access_token: accessToken, token_expires_at: expiresAt };
}

// ── Connect URL ──────────────────────────────────────────────────────────────
// Bridge v3: POST /aggregation/connect-sessions → returns session URL

async function getConnectUrl(userId, userEmail, redirectUri) {
  const bUser = await getOrCreateBridgeUser(userId);
  const res   = await bridgeRequest('POST', '/aggregation/connect-sessions', {
    user_email   : userEmail,
    callback_url : redirectUri,
  }, bUser.access_token);
  return res.url;
}

// ── Reconnect URL ────────────────────────────────────────────────────────────

async function getReconnectUrl(userId, userEmail, itemId, redirectUri) {
  const bUser = await getOrCreateBridgeUser(userId);
  const res   = await bridgeRequest('POST', '/aggregation/connect-sessions', {
    user_email   : userEmail,
    callback_url : redirectUri,
    item_id      : itemId,
  }, bUser.access_token);
  return res.url;
}

// ── Sync ─────────────────────────────────────────────────────────────────────

async function syncAccounts(userId) {
  const bUser = await getOrCreateBridgeUser(userId);

  let accounts = [];
  let nextUri  = '/aggregation/accounts?limit=100';
  while (nextUri) {
    const page = await bridgeRequest('GET', nextUri, null, bUser.access_token);
    accounts.push(...(page.resources || page.items || []));
    nextUri = page.pagination?.next_uri || null;
  }

  const upsert = db.prepare(`
    INSERT INTO bridge_accounts (user_id, account_id, item_id, name, balance, currency_code, type, iban, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(account_id) DO UPDATE SET
      name=excluded.name, balance=excluded.balance,
      currency_code=excluded.currency_code, type=excluded.type,
      iban=excluded.iban, updated_at=excluded.updated_at
  `);

  for (const acc of accounts) {
    const itemId = acc.item?.id ?? acc.item_id ?? 0;
    upsert.run(userId, acc.id, itemId, acc.name, acc.balance, acc.currency_code || 'EUR', acc.type ?? 0, acc.iban || null);
  }

  return accounts.length;
}

async function syncTransactions(userId, since) {
  const bUser = await getOrCreateBridgeUser(userId);

  const afterDate = since || new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().split('T')[0];
  let transactions = [];
  let nextUri = `/aggregation/transactions?limit=500&since=${afterDate}`;

  while (nextUri) {
    const page = await bridgeRequest('GET', nextUri, null, bUser.access_token);
    transactions.push(...(page.resources || page.items || []));
    nextUri = page.pagination?.next_uri || null;
  }

  const upsert = db.prepare(`
    INSERT INTO bridge_transactions
      (account_id, transaction_id, amount, date, description, clean_description, category_id, is_future)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(transaction_id) DO UPDATE SET
      amount=excluded.amount, description=excluded.description,
      clean_description=excluded.clean_description, category_id=excluded.category_id,
      is_future=excluded.is_future
  `);

  for (const tx of transactions) {
    upsert.run(
      tx.account?.id ?? tx.account_id, tx.id, tx.amount,
      tx.date, tx.description || '', tx.clean_description || '',
      tx.category?.id || null, tx.is_future ? 1 : 0
    );
  }

  return transactions.length;
}

async function syncItem(userId, itemId) {
  const bUser = await getOrCreateBridgeUser(userId);

  // Fetch item info
  let bankName = 'Banque';
  try {
    const item = await bridgeRequest('GET', `/aggregation/items/${itemId}`, null, bUser.access_token);
    bankName   = item.bank?.name || item.provider?.name || item.name || 'Banque';
    db.prepare(`
      INSERT INTO bridge_items (user_id, item_id, bank_name, status, synced_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(item_id) DO UPDATE SET bank_name=excluded.bank_name, status=excluded.status, synced_at=excluded.synced_at
    `).run(userId, itemId, bankName, item.status ?? 0);
  } catch {
    db.prepare(`
      INSERT INTO bridge_items (user_id, item_id, bank_name, status, synced_at)
      VALUES (?, ?, 'Banque', 0, datetime('now'))
      ON CONFLICT(item_id) DO UPDATE SET synced_at=datetime('now')
    `).run(userId, itemId);
  }

  const accCount = await syncAccounts(userId);
  const txCount  = await syncTransactions(userId);

  return { accounts: accCount, transactions: txCount };
}

// ── Delete item ──────────────────────────────────────────────────────────────

async function deleteItem(userId, itemId) {
  const bUser = await getOrCreateBridgeUser(userId);
  await bridgeRequest('DELETE', `/aggregation/items/${itemId}`, null, bUser.access_token);

  const accountIds = db.prepare('SELECT account_id FROM bridge_accounts WHERE item_id = ?')
    .all(itemId).map(r => r.account_id);
  for (const accId of accountIds) {
    db.prepare('DELETE FROM bridge_transactions WHERE account_id = ?').run(accId);
  }
  db.prepare('DELETE FROM bridge_accounts WHERE item_id = ?').run(itemId);
  db.prepare('DELETE FROM bridge_items WHERE item_id = ?').run(itemId);
}

// ── Read local data ──────────────────────────────────────────────────────────

function getAccountsForUser(userId) {
  const items = db.prepare('SELECT * FROM bridge_items WHERE user_id = ? ORDER BY created_at ASC').all(userId);
  return items.map(item => ({
    ...item,
    accounts: db.prepare(`
      SELECT * FROM bridge_accounts WHERE item_id = ? ORDER BY type ASC, name ASC
    `).all(item.item_id).map(a => ({ ...a, type_label: ACCOUNT_TYPES[a.type] || 'Autre' })),
  }));
}

function getTransactionsForUser(userId, { accountId, limit = 50, offset = 0 } = {}) {
  let sql = `
    SELECT bt.*, ba.name as account_name, bi.bank_name
    FROM bridge_transactions bt
    JOIN bridge_accounts ba ON ba.account_id = bt.account_id
    JOIN bridge_items bi    ON bi.item_id     = ba.item_id
    WHERE ba.user_id = ?
  `;
  const params = [userId];
  if (accountId) { sql += ' AND bt.account_id = ?'; params.push(accountId); }
  sql += ' ORDER BY bt.date DESC, bt.transaction_id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

function getSummaryForUser(userId) {
  const accounts     = db.prepare(`
    SELECT ba.*, bi.bank_name FROM bridge_accounts ba
    JOIN bridge_items bi ON bi.item_id = ba.item_id WHERE ba.user_id = ?
  `).all(userId);
  const totalBalance  = accounts.reduce((s, a) => s + (a.balance || 0), 0);
  const totalPositive = accounts.filter(a => a.balance > 0).reduce((s, a) => s + a.balance, 0);
  const totalNegative = accounts.filter(a => a.balance < 0).reduce((s, a) => s + a.balance, 0);
  return { totalBalance, totalPositive, totalNegative, accounts };
}

module.exports = {
  getOrCreateBridgeUser, getConnectUrl, getReconnectUrl,
  syncItem, syncAccounts, syncTransactions, deleteItem,
  getAccountsForUser, getTransactionsForUser, getSummaryForUser,
  ACCOUNT_TYPES,
};
