'use strict';

const crypto = require('crypto');

/**
 * In-memory store for pending confirmations.
 * Key: confirmationId (string)
 * Value: { telegramId, action, data, createdAt, ttlMs, timer }
 */
const pendingConfirmations = new Map();

/**
 * Create a pending confirmation.
 * @param {string} telegramId
 * @param {'reset'|'delete_budget'|'undo'} action
 * @param {Object} data - Action-specific payload
 * @param {number} ttlSeconds - Time to live in seconds
 * @returns {string} confirmationId
 */
function createConfirmation(telegramId, action, data, ttlSeconds) {
  const confirmationId = crypto.randomUUID();
  const ttlMs = ttlSeconds * 1000;

  const timer = setTimeout(() => {
    pendingConfirmations.delete(confirmationId);
  }, ttlMs);

  // Prevent the timer from keeping the process alive
  if (timer.unref) {
    timer.unref();
  }

  pendingConfirmations.set(confirmationId, {
    telegramId,
    action,
    data,
    createdAt: Date.now(),
    ttlMs,
    timer,
  });

  return confirmationId;
}

/**
 * Resolve a confirmation (confirm or cancel).
 * Returns the confirmation data if valid, null if expired or not found.
 * @param {string} confirmationId
 * @param {boolean} confirmed
 * @returns {{ telegramId: string, action: string, data: Object, confirmed: boolean } | null}
 */
function resolveConfirmation(confirmationId, confirmed) {
  const entry = pendingConfirmations.get(confirmationId);
  if (!entry) {
    return null;
  }

  const elapsed = Date.now() - entry.createdAt;
  if (elapsed >= entry.ttlMs) {
    // Expired — clean up
    clearTimeout(entry.timer);
    pendingConfirmations.delete(confirmationId);
    return null;
  }

  // Valid — clear timer and remove from map
  clearTimeout(entry.timer);
  pendingConfirmations.delete(confirmationId);

  return {
    telegramId: entry.telegramId,
    action: entry.action,
    data: entry.data,
    confirmed,
  };
}

/**
 * Check if a confirmation is still valid (not expired).
 * @param {string} confirmationId
 * @returns {boolean}
 */
function isValid(confirmationId) {
  const entry = pendingConfirmations.get(confirmationId);
  if (!entry) {
    return false;
  }

  const elapsed = Date.now() - entry.createdAt;
  return elapsed < entry.ttlMs;
}

/**
 * Get the number of pending confirmations (useful for testing).
 * @returns {number}
 */
function getPendingCount() {
  return pendingConfirmations.size;
}

/**
 * Clear all pending confirmations (useful for testing/cleanup).
 */
function clearAll() {
  for (const [, entry] of pendingConfirmations) {
    clearTimeout(entry.timer);
  }
  pendingConfirmations.clear();
}

module.exports = {
  createConfirmation,
  resolveConfirmation,
  isValid,
  getPendingCount,
  clearAll,
};
