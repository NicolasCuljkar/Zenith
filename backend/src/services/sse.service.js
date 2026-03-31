'use strict';

/**
 * sse.service.js — Server-Sent Events registry.
 *
 * Maintains a map of userId → Set<Response>.
 * When data changes, broadcasts a 'data_changed' event to all
 * other members of the same household.
 */

const householdService = require('./household.service');

// userId (number) → Set<Response>
const clients = new Map();

function subscribe(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
}

function unsubscribe(userId, res) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(userId);
}

function _send(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (_) {}
}

/**
 * Notify all SSE connections that should see the change:
 * - All household members (including the author, for multi-device sync)
 * - If solo, still notify the author's other devices
 */
function broadcastToHousehold(userId) {
  const household = householdService.getForUser(userId);
  // Collect all userIds to notify (household members, or just the author if solo)
  const memberIds = household
    ? household.members.map(m => m.id)
    : [userId];

  const ts = Date.now();
  for (const memberId of memberIds) {
    const set = clients.get(memberId);
    if (!set || set.size === 0) continue;
    for (const res of set) {
      _send(res, 'data_changed', { ts });
    }
  }
}

module.exports = { subscribe, unsubscribe, broadcastToHousehold };
