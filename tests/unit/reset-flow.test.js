'use strict';

const { createConfirmation, resolveConfirmation, isValid, clearAll } = require('../../src/confirmation');
const { buildKeyboard } = require('../../src/keyboard');
const { formatRupiah } = require('../../src/formatter');

describe('Reset confirmation flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAll();
  });

  afterEach(() => {
    clearAll();
    vi.useRealTimers();
  });

  describe('Confirmation creation', () => {
    it('creates a confirmation with reset action and 60s TTL', () => {
      const id = createConfirmation('user1', 'reset', { expenseCount: 3, total: 50000 }, 60);
      expect(isValid(id)).toBe(true);
    });

    it('stores expense count and total in confirmation data', () => {
      const id = createConfirmation('user1', 'reset', { expenseCount: 5, total: 120000 }, 60);
      const result = resolveConfirmation(id, true);
      expect(result.data.expenseCount).toBe(5);
      expect(result.data.total).toBe(120000);
    });
  });

  describe('Confirm (reset:yes)', () => {
    it('resolves confirmation as confirmed', () => {
      const id = createConfirmation('user1', 'reset', { expenseCount: 3, total: 50000 }, 60);
      const result = resolveConfirmation(id, true);
      expect(result).not.toBeNull();
      expect(result.confirmed).toBe(true);
      expect(result.action).toBe('reset');
      expect(result.data.expenseCount).toBe(3);
    });

    it('confirmation is no longer valid after resolving', () => {
      const id = createConfirmation('user1', 'reset', { expenseCount: 3, total: 50000 }, 60);
      resolveConfirmation(id, true);
      expect(isValid(id)).toBe(false);
    });
  });

  describe('Cancel (reset:no)', () => {
    it('resolves confirmation as cancelled', () => {
      const id = createConfirmation('user1', 'reset', { expenseCount: 3, total: 50000 }, 60);
      const result = resolveConfirmation(id, false);
      expect(result).not.toBeNull();
      expect(result.confirmed).toBe(false);
      expect(result.action).toBe('reset');
    });

    it('confirmation is no longer valid after cancelling', () => {
      const id = createConfirmation('user1', 'reset', { expenseCount: 3, total: 50000 }, 60);
      resolveConfirmation(id, false);
      expect(isValid(id)).toBe(false);
    });
  });

  describe('Timeout (60s expiry)', () => {
    it('confirmation expires after 60 seconds', () => {
      const id = createConfirmation('user1', 'reset', { expenseCount: 3, total: 50000 }, 60);
      expect(isValid(id)).toBe(true);
      vi.advanceTimersByTime(60000);
      expect(isValid(id)).toBe(false);
    });

    it('resolving after timeout returns null', () => {
      const id = createConfirmation('user1', 'reset', { expenseCount: 3, total: 50000 }, 60);
      vi.advanceTimersByTime(60000);
      const result = resolveConfirmation(id, true);
      expect(result).toBeNull();
    });

    it('confirmation is still valid just before 60s', () => {
      const id = createConfirmation('user1', 'reset', { expenseCount: 3, total: 50000 }, 60);
      vi.advanceTimersByTime(59999);
      expect(isValid(id)).toBe(true);
    });
  });

  describe('Keyboard', () => {
    it('buildKeyboard confirm_reset produces Ya, Reset and Batal buttons', () => {
      const keyboard = buildKeyboard('confirm_reset');
      const markup = keyboard.reply_markup;
      expect(markup).toBeDefined();
      expect(markup.inline_keyboard).toBeDefined();

      // Flatten all buttons
      const buttons = markup.inline_keyboard.flat();
      const texts = buttons.map((b) => b.text);
      const callbackData = buttons.map((b) => b.callback_data);

      expect(texts).toContain('Ya, Reset');
      expect(texts).toContain('Batal');
      expect(callbackData).toContain('reset:yes');
      expect(callbackData).toContain('reset:no');
    });
  });

  describe('Confirmation message content', () => {
    it('message includes expense count and total amount', () => {
      const expenseCount = 5;
      const total = 75000;
      const message = `Kamu yakin mau reset data hari ini?\n\n📊 ${expenseCount} pengeluaran senilai ${formatRupiah(total)} akan dihapus.`;

      expect(message).toContain('5 pengeluaran');
      expect(message).toContain('Rp75.000');
      expect(message).toContain('akan dihapus');
    });
  });
});
