/**
 * api.js — Zénith Budget Manager API Client
 *
 * A clean fetch-based API wrapper for all backend calls.
 * Handles JWT storage, request headers, error parsing, and loading state.
 *
 * Usage:
 *   await API.auth.login('email', 'password')
 *   await API.entries.getAll({ member: 'Nicolas' })
 *   etc.
 */

'use strict';

// ── Configuration ──────────────────────────────────────────────────────────────
// En local : http://localhost:3001/api — En production : /api (même domaine)
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3001/api'
  : '/api';

// LocalStorage keys
const TOKEN_KEY   = 'zenith_token';
const USER_KEY    = 'zenith_user';
const PROFILE_KEY = 'zenith_last_profile'; // survit à la déconnexion

// ── Token helpers ──────────────────────────────────────────────────────────────

/** Store JWT token in localStorage */
function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else        localStorage.removeItem(TOKEN_KEY);
}

/** Retrieve stored JWT token */
function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/** Store user object in localStorage */
function setStoredUser(user) {
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    // Profil minimal persisté même après déconnexion (pour l'accès rapide)
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ id: user.id, name: user.name, color: user.color, photo: user.photo }));
  } else {
    localStorage.removeItem(USER_KEY);
  }
}

/** Retrieve stored user object */
function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch (_) {
    return null;
  }
}

/** Clear auth data from localStorage (conserve zenith_last_profile pour l'accès rapide) */
function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  // PROFILE_KEY intentionnellement conservé
}

// ── Core fetch wrapper ─────────────────────────────────────────────────────────

/**
 * Make an authenticated API request.
 *
 * @param {string} endpoint — path relative to API_BASE (e.g. '/entries')
 * @param {object} options  — fetch options (method, body, etc.)
 * @param {boolean} skipAuth — if true, don't attach Authorization header
 * @returns {Promise<any>} parsed JSON data (throws on error)
 */
async function request(endpoint, options = {}, skipAuth = false) {
  const url = `${API_BASE}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Attach JWT if available and not skipping auth
  if (!skipAuth) {
    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const config = {
    ...options,
    headers,
  };

  // Stringify body if it's an object
  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  let response;
  try {
    response = await fetch(url, config);
  } catch (networkError) {
    // Network failure (server down, CORS etc.)
    throw new Error('Impossible de contacter le serveur. Vérifiez que le backend est démarré.');
  }

  // Parse JSON response
  let json;
  try {
    json = await response.json();
  } catch (_) {
    throw new Error(`Réponse invalide du serveur (HTTP ${response.status})`);
  }

  // Handle API errors
  if (!response.ok || json.success === false) {
    const msg = json.error || json.message || `Erreur HTTP ${response.status}`;

    // Auto-logout on 401 (expired/invalid token)
    if (response.status === 401) {
      clearAuth();
      // Dispatch a custom event so the app can react (show login screen)
      window.dispatchEvent(new CustomEvent('zenith:unauthorized'));
    }

    const err = new Error(msg);
    err.statusCode = response.status;
    err.data       = json;
    throw err;
  }

  return json.data;
}

// Convenience helpers
const get    = (ep, params = {}) => {
  const qs = Object.keys(params).length
    ? '?' + new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      ).toString()
    : '';
  return request(ep + qs, { method: 'GET' });
};
const post   = (ep, body) => request(ep, { method: 'POST',   body });
const put    = (ep, body) => request(ep, { method: 'PUT',    body });
const patch  = (ep, body) => request(ep, { method: 'PATCH',  body });
const del    = (ep)       => request(ep, { method: 'DELETE' });

// ── API modules ────────────────────────────────────────────────────────────────

/**
 * auth — Authentication methods
 */
const _auth = {
  /**
   * Get list of users for the profile picker (no auth needed).
   * @returns {Promise<Array>} users without passwords
   */
  getUsers() {
    return request('/auth/users', { method: 'GET' }, true /* skipAuth */);
  },

  /**
   * Login with email and password.
   * Stores JWT and user object in localStorage on success.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{ token, user }>}
   */
  async login(email, password) {
    const result = await request('/auth/login', {
      method : 'POST',
      body   : { email, password },
    }, true /* skipAuth */);
    setToken(result.token);
    setStoredUser(result.user);
    return result;
  },

  async loginById(userId, password) {
    const result = await request('/auth/login-by-id', {
      method : 'POST',
      body   : { userId, password },
    }, true /* skipAuth */);
    setToken(result.token);
    setStoredUser(result.user);
    return result;
  },

  /**
   * Register a new user.
   * Stores JWT and user object on success.
   * @param {string} name
   * @param {string} email
   * @param {string} password
   * @param {string} role — 'Nicolas' | 'Carla' | 'Autre'
   * @returns {Promise<{ token, user }>}
   */
  async register(name, email, password, role) {
    const result = await request('/auth/register', {
      method : 'POST',
      body   : { name, email, password, role },
    }, true /* skipAuth */);
    setToken(result.token);
    setStoredUser(result.user);
    return result;
  },

  /**
   * Get current authenticated user from the server.
   * @returns {Promise<object>} user object
   */
  getMe() {
    return get('/auth/me');
  },

  /**
   * Logout — clear local token and user.
   */
  logout() {
    clearAuth();
  },

  /** Check if user is currently logged in */
  isLoggedIn() {
    return !!getToken();
  },

  /** Get stored user (may be stale — use getMe() for fresh data) */
  getLocalUser() {
    return getStoredUser();
  },
};

/**
 * entries — Budget entry CRUD methods
 */
const _entries = {
  /**
   * Get all entries with optional filters.
   * @param {{ member?, cat?, search? }} filters
   * @returns {Promise<Array>}
   */
  getAll(filters = {}) {
    return get('/entries', filters);
  },

  /**
   * Get computed statistics.
   * @param {{ member? }} filters
   * @returns {Promise<{ rev, tax, revNet, fix, vari, ep, loi, dep, rav, solde }>}
   */
  getStats(filters = {}) {
    return get('/entries/stats', filters);
  },

  /**
   * Create a new budget entry.
   * @param {{ name, amount, cat, member }} data
   * @returns {Promise<object>} created entry
   */
  create(data) {
    return post('/entries', data);
  },

  /**
   * Get a single entry by id.
   * @param {number} id
   * @returns {Promise<object>}
   */
  getById(id) {
    return get(`/entries/${id}`);
  },

  /**
   * Update an existing entry.
   * @param {number} id
   * @param {{ name?, amount?, cat?, member? }} data
   * @returns {Promise<object>} updated entry
   */
  update(id, data) {
    return put(`/entries/${id}`, data);
  },

  /**
   * Delete an entry.
   * @param {number} id
   * @returns {Promise<{ deleted: true }>}
   */
  delete(id) {
    return del(`/entries/${id}`);
  },

  /**
   * Update drag-drop sort order.
   * @param {string} member
   * @param {string} groupKey
   * @param {number[]} orderedIds
   * @returns {Promise<{ updated: true }>}
   */
  updateOrder(member, groupKey, orderedIds) {
    return put('/entries/order', { member, groupKey, orderedIds });
  },
};

/**
 * savings — Savings record CRUD methods
 */
const _savings = {
  /**
   * Get all savings records with optional filters.
   * @param {{ member?, year? }} filters
   * @returns {Promise<Array>}
   */
  getAll(filters = {}) {
    return get('/savings', filters);
  },

  /**
   * Create a new savings record.
   * @param {{ member, year, month, amount }} data
   * @returns {Promise<object>} created saving
   */
  create(data) {
    return post('/savings', data);
  },

  /**
   * Get a single savings record by id.
   * @param {number} id
   * @returns {Promise<object>}
   */
  getById(id) {
    return get(`/savings/${id}`);
  },

  /**
   * Update an existing savings record.
   * @param {number} id
   * @param {{ member?, year?, month?, amount? }} data
   * @returns {Promise<object>} updated saving
   */
  update(id, data) {
    return put(`/savings/${id}`, data);
  },

  /**
   * Delete a savings record.
   * @param {number} id
   * @returns {Promise<{ deleted: true }>}
   */
  delete(id) {
    return del(`/savings/${id}`);
  },
};

/**
 * users — User settings methods
 */
const _users = {
  /**
   * Update current user's color and/or photo.
   * @param {{ color?, photo? }} data
   * @returns {Promise<object>} updated user
   */
  async updateSettings(data) {
    const updatedUser = await put('/users/settings', data);
    const current = getStoredUser();
    if (current) setStoredUser({ ...current, ...data });
    return updatedUser;
  },
  async updateProfile(data) {
    const updatedUser = await patch('/users/profile', data);
    const current = getStoredUser();
    if (current) setStoredUser({ ...current, ...data });
    return updatedUser;
  },
  async changePassword(data) {
    return patch('/users/password', data);
  },
};

/**
 * bridge — Open Banking via Plaid
 */
const _bridge = {
  getLinkToken:    ()                          => post('/bridge/link-token'),
  exchangeToken:   (publicToken, name)         => post('/bridge/exchange-token', { publicToken, institutionName: name }),
  syncItem:        (itemId)                    => post(`/bridge/sync/${itemId}`),
  syncAll:         ()                          => post('/bridge/sync-all'),
  getAccounts:     ()                          => get('/bridge/accounts'),
  getTransactions: (p={})                      => get('/bridge/transactions?' + new URLSearchParams(p)),
  getSummary:      ()                          => get('/bridge/summary'),
  deleteItem:      (itemId)                    => del(`/bridge/items/${itemId}`),
};

// ── Export the API object ──────────────────────────────────────────────────────

/**
 * Global API object — attach to window for use in the HTML scripts.
 *
 * @type {{
 *   auth: typeof _auth,
 *   entries: typeof _entries,
 *   savings: typeof _savings,
 *   users: typeof users,
 *   getToken: typeof getToken,
 *   clearAuth: typeof clearAuth,
 * }}
 */
/**
 * importBank — CSV bank statement import + AI categorization
 */
const _import = {
  /**
   * Send raw CSV/text content to Claude for categorization.
   * @param {string} csvContent — raw file text
   * @param {string} member — member name (default 'Commun')
   * @returns {Promise<Array>} categorized entries
   */
  analyzeCSV(csvContent, member) {
    return post('/import/csv', { csvContent, member });
  },

  /**
   * Confirm and save categorized entries to the database.
   * @param {Array} entries — array of { name, amount, cat, member }
   * @returns {Promise<{ saved: number, failed: string[] }>}
   */
  confirm(entries) {
    return post('/import/confirm', { entries });
  },
};

/**
 * household — Foyer (household) management
 */
const _household = {
  get:    ()     => get('/household'),
  create: ()     => post('/household/create'),
  invite: ()     => post('/household/invite'),
  join:   (code) => post('/household/join', { code }),
  leave:  ()     => request('/household/leave',  { method: 'DELETE' }),
  delete: ()     => request('/household/delete', { method: 'DELETE' }),
};

const API = { auth: _auth, entries: _entries, savings: _savings, users: _users, bridge: _bridge, household: _household, import: _import, getToken, clearAuth };

// Attach to window for global access in inline scripts
if (typeof window !== 'undefined') {
  window.API = API;
}
