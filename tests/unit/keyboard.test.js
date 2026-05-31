'use strict';

const { buildKeyboard, buildUndoKeyboard, truncateCallbackData } = require('../../src/keyboard');

/**
 * Helper to extract inline_keyboard buttons from a Telegraf markup object.
 */
function getButtons(markup) {
  return markup.reply_markup.inline_keyboard;
}

/**
 * Helper to flatten all buttons into a single array.
 */
function flatButtons(markup) {
  return getButtons(markup).flat();
}

/**
 * Helper to get all callback_data values from a keyboard.
 */
function getCallbackDataValues(markup) {
  return flatButtons(markup).map((btn) => btn.callback_data);
}

describe('keyboard.js', () => {
  describe('buildKeyboard - button presence per context', () => {
    it('menu context has 4 buttons: Ringkasan Hari Ini, Lihat Budget, Riwayat 7 Hari, Bantuan', () => {
      const kb = buildKeyboard('menu');
      const buttons = flatButtons(kb);
      expect(buttons).toHaveLength(4);
      expect(buttons.map((b) => b.text)).toEqual([
        'Ringkasan Hari Ini',
        'Lihat Budget',
        'Riwayat 7 Hari',
        'Bantuan',
      ]);
    });

    it('today context has 2 buttons: Catat Pengeluaran, Lihat Budget', () => {
      const kb = buildKeyboard('today');
      const buttons = flatButtons(kb);
      expect(buttons).toHaveLength(2);
      expect(buttons.map((b) => b.text)).toEqual(['Catat Pengeluaran', 'Lihat Budget']);
    });

    it('budget context has 2 buttons: Ringkasan Hari Ini, Catat Pengeluaran', () => {
      const kb = buildKeyboard('budget');
      const buttons = flatButtons(kb);
      expect(buttons).toHaveLength(2);
      expect(buttons.map((b) => b.text)).toEqual(['Ringkasan Hari Ini', 'Catat Pengeluaran']);
    });

    it('history context has 2 buttons: Ringkasan Hari Ini, Lihat Budget', () => {
      const kb = buildKeyboard('history');
      const buttons = flatButtons(kb);
      expect(buttons).toHaveLength(2);
      expect(buttons.map((b) => b.text)).toEqual(['Ringkasan Hari Ini', 'Lihat Budget']);
    });

    it('expense context has 2 buttons: Undo, Ringkasan Hari Ini', () => {
      const kb = buildKeyboard('expense', { expenseId: 42 });
      const buttons = flatButtons(kb);
      expect(buttons).toHaveLength(2);
      expect(buttons.map((b) => b.text)).toEqual(['Undo', 'Ringkasan Hari Ini']);
    });

    it('confirm_reset context has 2 buttons: Ya, Reset and Batal', () => {
      const kb = buildKeyboard('confirm_reset');
      const buttons = flatButtons(kb);
      expect(buttons).toHaveLength(2);
      expect(buttons.map((b) => b.text)).toEqual(['Ya, Reset', 'Batal']);
    });

    it('confirm_delete context has 2 buttons: Ya, Hapus and Batal', () => {
      const kb = buildKeyboard('confirm_delete', { budgetName: 'jajan' });
      const buttons = flatButtons(kb);
      expect(buttons).toHaveLength(2);
      expect(buttons.map((b) => b.text)).toEqual(['Ya, Hapus', 'Batal']);
    });

    it('onboarding_budget context has 2 buttons: Buat Budget, Lewati', () => {
      const kb = buildKeyboard('onboarding_budget');
      const buttons = flatButtons(kb);
      expect(buttons).toHaveLength(2);
      expect(buttons.map((b) => b.text)).toEqual(['Buat Budget', 'Lewati']);
    });

    it('unknown context returns empty keyboard', () => {
      const kb = buildKeyboard('nonexistent');
      const buttons = getButtons(kb);
      expect(buttons).toEqual([]);
    });
  });

  describe('buildKeyboard - callback data encoding format', () => {
    it('menu buttons use menu:<action> format', () => {
      const kb = buildKeyboard('menu');
      const data = getCallbackDataValues(kb);
      expect(data).toEqual(['menu:today', 'menu:budget', 'menu:history', 'menu:help']);
    });

    it('today buttons use nav:<target> format', () => {
      const kb = buildKeyboard('today');
      const data = getCallbackDataValues(kb);
      expect(data).toEqual(['nav:expense', 'nav:budget']);
    });

    it('budget buttons use nav:<target> format', () => {
      const kb = buildKeyboard('budget');
      const data = getCallbackDataValues(kb);
      expect(data).toEqual(['nav:today', 'nav:expense']);
    });

    it('history buttons use nav:<target> format', () => {
      const kb = buildKeyboard('history');
      const data = getCallbackDataValues(kb);
      expect(data).toEqual(['nav:today', 'nav:budget']);
    });

    it('expense buttons use undo:<id> and nav:<target> format', () => {
      const kb = buildKeyboard('expense', { expenseId: 123 });
      const data = getCallbackDataValues(kb);
      expect(data).toEqual(['undo:123', 'nav:today']);
    });

    it('confirm_reset buttons use reset:yes/no format', () => {
      const kb = buildKeyboard('confirm_reset');
      const data = getCallbackDataValues(kb);
      expect(data).toEqual(['reset:yes', 'reset:no']);
    });

    it('confirm_delete buttons use del:<name>:yes/no format', () => {
      const kb = buildKeyboard('confirm_delete', { budgetName: 'makan' });
      const data = getCallbackDataValues(kb);
      expect(data).toEqual(['del:makan:yes', 'del:makan:no']);
    });

    it('onboarding_budget buttons use onb:<step> format', () => {
      const kb = buildKeyboard('onboarding_budget');
      const data = getCallbackDataValues(kb);
      expect(data).toEqual(['onb:budget', 'onb:skip']);
    });
  });

  describe('buildKeyboard - 64-byte callback_data limit compliance', () => {
    it('all menu callback data fits within 64 bytes', () => {
      const kb = buildKeyboard('menu');
      for (const data of getCallbackDataValues(kb)) {
        expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
      }
    });

    it('expense callback data with large ID fits within 64 bytes', () => {
      const kb = buildKeyboard('expense', { expenseId: 999999999 });
      for (const data of getCallbackDataValues(kb)) {
        expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
      }
    });

    it('confirm_delete truncates long budget names to fit 64 bytes', () => {
      const longName = 'a'.repeat(100);
      const kb = buildKeyboard('confirm_delete', { budgetName: longName });
      for (const data of getCallbackDataValues(kb)) {
        expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
      }
    });

    it('confirm_delete with multi-byte characters stays within 64 bytes', () => {
      // Indonesian/emoji characters that are multi-byte in UTF-8
      const multiByteName = '🍕'.repeat(30); // each emoji is 4 bytes
      const kb = buildKeyboard('confirm_delete', { budgetName: multiByteName });
      for (const data of getCallbackDataValues(kb)) {
        expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
      }
    });
  });

  describe('buildUndoKeyboard', () => {
    it('returns keyboard with Undo and Ringkasan Hari Ini buttons', () => {
      const kb = buildUndoKeyboard(42, Date.now());
      const buttons = flatButtons(kb);
      expect(buttons).toHaveLength(2);
      expect(buttons.map((b) => b.text)).toEqual(['Undo', 'Ringkasan Hari Ini']);
    });

    it('encodes expense ID in undo:<id> format', () => {
      const kb = buildUndoKeyboard(99, Date.now());
      const data = getCallbackDataValues(kb);
      expect(data[0]).toBe('undo:99');
      expect(data[1]).toBe('nav:today');
    });

    it('callback data fits within 64 bytes for large IDs', () => {
      const kb = buildUndoKeyboard(Number.MAX_SAFE_INTEGER, Date.now());
      for (const data of getCallbackDataValues(kb)) {
        expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
      }
    });
  });

  describe('truncateCallbackData', () => {
    it('returns string unchanged if within byte limit', () => {
      expect(truncateCallbackData('hello', 10)).toBe('hello');
    });

    it('truncates string to fit within byte limit', () => {
      const long = 'a'.repeat(100);
      const result = truncateCallbackData(long, 50);
      expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(50);
    });

    it('handles multi-byte characters correctly', () => {
      // Each emoji is 4 bytes in UTF-8
      const emojis = '🍕🍔🌮🥗🍜';
      const result = truncateCallbackData(emojis, 8);
      expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(8);
      // Should fit exactly 2 emojis (8 bytes)
      expect(result).toBe('🍕🍔');
    });

    it('returns empty string when maxBytes is 0', () => {
      expect(truncateCallbackData('hello', 0)).toBe('');
    });

    it('returns original string when exactly at byte limit', () => {
      const str = 'abc'; // 3 bytes
      expect(truncateCallbackData(str, 3)).toBe('abc');
    });
  });
});
