'use strict';

const { Markup } = require('telegraf');

/**
 * Build inline keyboard for a given context.
 * @param {string} context - One of: 'menu', 'today', 'budget', 'history', 'expense', 'confirm_reset', 'confirm_delete', 'onboarding_budget'
 * @param {Object} [data] - Context-specific data (e.g., { expenseId, budgetName })
 * @returns {Object} Telegraf-compatible inline keyboard markup ({ reply_markup: { inline_keyboard: [[...]] } })
 */
function buildKeyboard(context, data = {}) {
  let buttons;

  switch (context) {
    case 'menu':
      buttons = [
        [
          Markup.button.callback('Ringkasan Hari Ini', 'menu:today'),
          Markup.button.callback('Lihat Budget', 'menu:budget'),
        ],
        [
          Markup.button.callback('Riwayat 7 Hari', 'menu:history'),
          Markup.button.callback('Bantuan', 'menu:help'),
        ],
      ];
      break;

    case 'today':
      buttons = [
        [
          Markup.button.callback('Catat Pengeluaran', 'nav:expense'),
          Markup.button.callback('Lihat Budget', 'nav:budget'),
        ],
      ];
      break;

    case 'budget':
      buttons = [
        [
          Markup.button.callback('Ringkasan Hari Ini', 'nav:today'),
          Markup.button.callback('Catat Pengeluaran', 'nav:expense'),
        ],
      ];
      break;

    case 'history':
      buttons = [
        [
          Markup.button.callback('Ringkasan Hari Ini', 'nav:today'),
          Markup.button.callback('Lihat Budget', 'nav:budget'),
        ],
      ];
      break;

    case 'expense':
      buttons = [
        [
          Markup.button.callback('Undo', `undo:${data.expenseId}`),
          Markup.button.callback('Ringkasan Hari Ini', 'nav:today'),
        ],
      ];
      break;

    case 'confirm_reset':
      buttons = [
        [
          Markup.button.callback('Ya, Reset', 'reset:yes'),
          Markup.button.callback('Batal', 'reset:no'),
        ],
      ];
      break;

    case 'confirm_delete': {
      // Truncate budget name to fit within 64-byte callback_data limit
      // Format: del:<name>:yes (max 64 bytes)
      // Overhead: "del:" (4) + ":yes" (4) = 8 bytes, leaving 56 for name
      const name = truncateCallbackData(data.budgetName || '', 56);
      buttons = [
        [
          Markup.button.callback('Ya, Hapus', `del:${name}:yes`),
          Markup.button.callback('Batal', `del:${name}:no`),
        ],
      ];
      break;
    }

    case 'onboarding_budget':
      buttons = [
        [
          Markup.button.callback('Buat Budget', 'onb:budget'),
          Markup.button.callback('Lewati', 'onb:skip'),
        ],
      ];
      break;

    default:
      buttons = [];
  }

  return Markup.inlineKeyboard(buttons);
}

/**
 * Build undo button with encoded callback data.
 * @param {number} expenseId
 * @param {number} timestamp - Unix timestamp of creation
 * @returns {Object} Telegraf-compatible inline keyboard markup
 */
function buildUndoKeyboard(expenseId, timestamp) {
  // Format: undo:<id> — keep it compact to fit 64-byte limit
  // The timestamp is encoded to allow validation on the handler side
  const callbackData = `undo:${expenseId}`;

  // Ensure callback_data fits within 64 bytes
  if (Buffer.byteLength(callbackData, 'utf8') > 64) {
    // Fallback: use just the ID (should always fit)
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('Undo', `undo:${expenseId}`),
        Markup.button.callback('Ringkasan Hari Ini', 'nav:today'),
      ],
    ]);
  }

  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Undo', callbackData),
      Markup.button.callback('Ringkasan Hari Ini', 'nav:today'),
    ],
  ]);
}

/**
 * Truncate a string to fit within a byte limit (UTF-8).
 * @param {string} str - String to truncate
 * @param {number} maxBytes - Maximum byte length
 * @returns {string} Truncated string
 */
function truncateCallbackData(str, maxBytes) {
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) {
    return str;
  }

  // Truncate character by character until it fits
  let truncated = str;
  while (Buffer.byteLength(truncated, 'utf8') > maxBytes) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

module.exports = { buildKeyboard, buildUndoKeyboard, truncateCallbackData };
