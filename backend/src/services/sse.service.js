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
 * Notify all household members of `userId` (excluding the author)
 * that data has changed so they can refresh.
 */
function broadcastToHousehold(userId) {
  const household = householdService.getForUser(userId);
  if (!household) return; // solo user — no one else to notify

  for (const member of household.members) {
    if (member.id === userId) continue; // skip the author
    const set = clients.get(member.id);
    if (!set || set.size === 0) continue;
    for (const res of set) {
      _send(res, 'data_changed', { ts: Date.now() });
    }
  }
}

module.exports = { subscribe, unsubscribe, broadcastToHousehold };
