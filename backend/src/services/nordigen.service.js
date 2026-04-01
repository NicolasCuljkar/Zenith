'use strict';

const https  = require('https');
const db     = require('../config/database');
require('dotenv').config();

const NORDIGEN_BASE   = 'https://bankaccountdata.gocardless.com/api/v2';
const SECRET_ID       = process.env.NORDIGEN_SECRET_ID;
const SECRET_KEY      = process.env.NORDIGEN_SECRET_KEY;
const PERSONAL_TOKEN  = process.env.NORDIGEN_ACCESS_TOKEN;

let _accessToken  = null;
let _accessExpiry = 0;

// ── HTTP helper ───────────────────────────────────────────────────────────────

function nordigenRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    if (!PERSONAL_TOKEN && (!SECRET_ID || !SECRET_KEY)) {
      return reject(Object.assign(
        new Error('Nordigen non configuré. Ajoutez NORDIGEN_ACCESS_TOKEN dans votre .env.'),
        { statusCode: 503 }
      ));
    }

    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (token)   headers['Authorization']  = `Bearer ${token}`;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const url  = new URL(NORDIGEN_BASE + path);
    const opts = { hostname: url.hostname, path: url.pathname + url.search, method, headers };

    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(raw); } catch { json = { raw }; }
        console.log(`[Nordigen] ${method} ${path} → ${res.statusCode}`);
        if (res.statusCode >= 400) {
          const msg = json.detail || json.summary || `Nordigen error ${res.statusCode}`;
          const err = new Error(`[Nordigen] ${msg}`);
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

// ── App-level token ──────────────────────────────────────────────────────────

async function getAccessToken() {
  // Personal access token (jeton d'accès personnel GoCardless) — utilisé directement
  if (PERSONAL_TOKEN) return PERSONAL_TOKEN;
  // OAuth flow avec secret_id + secret_key
  if (_accessToken && Date.now() < _accessExpiry) return _accessToken;
  const res      = await nordigenRequest('POST', '/token/new/', { secret_id: SECRET_ID, secret_key: SECRET_KEY });
  _accessToken   = res.access;
  _accessExpiry  = Date.now() + ((res.access_expires || 7200) - 60) * 1000;
  return _accessToken;
}

// ── Institutions ─────────────────────────────────────────────────────────────

async function getInstitutions(country = 'FR') {
  const token = await getAccessToken();
  return nordigenRequest('GET', `/institutions/?country=${country}`, null, token);
}

// ── Requisition (= bank connection) ──────────────────────────────────────────

async function createRequisition(userId, institutionId, institutionName, redirectUri) {
  const token     = await getAccessToken();
  const reference = `zenith_${userId}_${Date.now()}`;

  const res = await nordigenRequest('POST', '/requisitions/', {
    redirect       : redirectUri,
    institution_id : institutionId,
    reference,
    user_language  : 'FR',
  }, token);

  db.prepare(`
    INSERT INTO nordigen_requisitions
      (user_id, requisition_id, institution_id, institution_name, status, link, reference)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, res.id, institutionId, institutionName, res.status || 'CR', res.link, reference);

  return { link: res.link, requisitionId: res.id, reference };
}

async function syncRequisition(userId, requisitionId) {
  const token = await getAccessToken();
  const req   = await nordigenRequest('GET', `/requisitions/${requisitionId}/`, null, token);

  db.prepare(`UPDATE nordigen_requisitions SET status = ? WHERE requisition_id = ?`)
    .run(req.status, requisitionId);

  if (!req.accounts || req.accounts.length === 0) return { accounts: 0, transactions: 0 };

  let accCount = 0;
  let txCount  = 0;

  for (const accountId of req.accounts) {
    try {
      const [details, balances, transactions] = await Promise.all([
        nordigenRequest('GET', `/accounts/${accountId}/details/`,      null, token),
        nordigenRequest('GET', `/accounts/${accountId}/balances/`,     null, token),
        nordigenRequest('GET', `/accounts/${accountId}/transactions/`, null, token),
      ]);

      const acc     = details.account || {};
      const balObj  = balances.balances?.find(b => b.balanceType === 'interimAvailable')
                   || balances.balances?.[0] || {};
      const balance  = parseFloat(balObj.balanceAmount?.amount || 0);
      const currency = balObj.balanceAmount?.currency || acc.currency || 'EUR';
      const name     = acc.name || acc.ownerName || accountId;

      db.prepare(`
        INSERT INTO nordigen_accounts
          (user_id, requisition_id, account_id, iban, name, currency, type, balance, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(account_id) DO UPDATE SET
          iban=excluded.iban, name=excluded.name, balance=excluded.balance,
          currency=excluded.currency, updated_at=excluded.updated_at
      `).run(userId, requisitionId, accountId, acc.iban || null, name, currency, acc.cashAccountType || '', balance);

      accCount++;

      const allTxs = [
        ...(transactions.transactions?.booked  || []),
        ...(transactions.transactions?.pending || []),
      ];

      const upsertTx = db.prepare(`
        INSERT INTO nordigen_transactions
          (account_id, transaction_id, amount, currency, date, description, is_pending)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(transaction_id) DO UPDATE SET
          amount=excluded.amount, description=excluded.description, is_pending=excluded.is_pending
      `);

      for (const tx of allTxs) {
        const txId   = tx.transactionId || tx.internalTransactionId || `${accountId}_${tx.bookingDate || tx.valueDate}_${Math.random()}`;
        const amount = parseFloat(tx.transactionAmount?.amount || 0);
        const cur2   = tx.transactionAmount?.currency || currency;
        const date   = tx.bookingDate || tx.valueDate || '';
        const desc   = tx.remittanceInformationUnstructured
                    || tx.creditorName || tx.debtorName
                    || tx.remittanceInformationStructured || '';
        const isPending = tx.bookingDate ? 0 : 1;
        upsertTx.run(accountId, txId, amount, cur2, date, desc, isPending);
        txCount++;
      }
    } catch (e) {
      console.warn(`[Nordigen] Failed to sync account ${accountId}:`, e.message);
    }
  }

  db.prepare(`UPDATE nordigen_requisitions SET synced_at = datetime('now') WHERE requisition_id = ?`)
    .run(requisitionId);

  return { accounts: accCount, transactions: txCount };
}

async function syncRequisitionByRef(userId, reference) {
  const row = db.prepare(`SELECT requisition_id FROM nordigen_requisitions WHERE reference = ? AND user_id = ?`).get(reference, userId);
  if (!row) throw new Error('Requisition introuvable');
  return syncRequisition(userId, row.requisition_id);
}

async function syncAll(userId) {
  const reqs  = db.prepare(`SELECT requisition_id FROM nordigen_requisitions WHERE user_id = ?`).all(userId);
  let total   = { accounts: 0, transactions: 0 };
  for (const { requisition_id } of reqs) {
    const r         = await syncRequisition(userId, requisition_id);
    total.accounts     += r.accounts;
    total.transactions += r.transactions;
  }
  return total;
}

async function deleteRequisition(userId, requisitionId) {
  const token = await getAccessToken();
  try { await nordigenRequest('DELETE', `/requisitions/${requisitionId}/`, null, token); }
  catch (e)   { console.warn('[Nordigen] Delete error:', e.message); }

  const accounts = db.prepare(`SELECT account_id FROM nordigen_accounts WHERE requisition_id = ?`).all(requisitionId);
  for (const { account_id } of accounts) {
    db.prepare(`DELETE FROM nordigen_transactions WHERE account_id = ?`).run(account_id);
  }
  db.prepare(`DELETE FROM nordigen_accounts      WHERE requisition_id = ?`).run(requisitionId);
  db.prepare(`DELETE FROM nordigen_requisitions  WHERE requisition_id = ? AND user_id = ?`).run(requisitionId, userId);
}

// ── Read local data ──────────────────────────────────────────────────────────

function getAccountsForUser(userId) {
  const reqs = db.prepare(`SELECT * FROM nordigen_requisitions WHERE user_id = ? ORDER BY created_at ASC`).all(userId);
  return reqs.map(req => ({
    ...req,
    accounts: db.prepare(`SELECT * FROM nordigen_accounts WHERE requisition_id = ? ORDER BY name ASC`).all(req.requisition_id),
  }));
}

function getTransactionsForUser(userId, { accountId, limit = 50, offset = 0 } = {}) {
  let sql = `
    SELECT nt.*, na.name as account_name, nr.institution_name as bank_name
    FROM nordigen_transactions nt
    JOIN nordigen_accounts na       ON na.account_id      = nt.account_id
    JOIN nordigen_requisitions nr   ON nr.requisition_id  = na.requisition_id
    WHERE na.user_id = ?
  `;
  const params = [userId];
  if (accountId) { sql += ` AND nt.account_id = ?`; params.push(accountId); }
  sql += ` ORDER BY nt.date DESC, nt.transaction_id DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

function getSummaryForUser(userId) {
  const accounts      = db.prepare(`
    SELECT na.*, nr.institution_name as bank_name FROM nordigen_accounts na
    JOIN nordigen_requisitions nr ON nr.requisition_id = na.requisition_id WHERE na.user_id = ?
  `).all(userId);
  const totalBalance  = accounts.reduce((s, a) => s + (a.balance || 0), 0);
  const totalPositive = accounts.filter(a => a.balance > 0).reduce((s, a) => s + a.balance, 0);
  const totalNegative = accounts.filter(a => a.balance < 0).reduce((s, a) => s + a.balance, 0);
  return { totalBalance, totalPositive, totalNegative, accounts };
}

module.exports = {
  getInstitutions, createRequisition,
  syncRequisition, syncRequisitionByRef, syncAll, deleteRequisition,
  getAccountsForUser, getTransactionsForUser, getSummaryForUser,
};
