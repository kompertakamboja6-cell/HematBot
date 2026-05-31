'use strict';

/**
 * Unit tests for the /hapus confirmation flow.
 * Tests the handler logic by directly testing the database/keyboard/confirmation
 * interactions that the refactored /hapus command uses.
 *
 * Since bot.js registers handlers on a Telegraf instance which is hard to mock
 * in CommonJS, we test the flow logic by verifying:
 * - Budget lookup and error message formatting
 * - Keyboard building for confirm_delete context
 * - Confirmation creation and resolution
 * - Delete budget operation
 */

const database = require('../../src/database');
const { createConfirmation, resolveConfirmation, clearAll } = require('../../src/confirmation');
const { buildKeyboard } = require('../../src/keyboard');
const { formatRupiah } = require('../../src/formatter');

describe('/hapus confirmation flow', () => {
  const TEST_USER = 'hapus_test_user';

  beforeEach(() => {
    vi.useFakeTimers();
    clearAll();
    // Clean up test data
    const db = database.getDatabase();
    db.exec('DELETE FROM shortcuts');
    db.exec('DELETE FROM expenses');
    db.exec('DELETE FROM budgets');
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DELETE FROM users');
    db.exec('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    clearAll();
    vi.useRealTimers();
  });

  describe('budget not found - error with available budgets', () => {
    it('returns null when budget does not exist', () => {
      database.getOrCreateUser(TEST_USER);
      const budget = database.getBudgetByName(TEST_USER, 'nonexistent');
      expect(budget).toBeUndefined();
    });

    it('lists available budgets when budget not found', () => {
      database.getOrCreateUser(TEST_USER);
      database.createBudget(TEST_USER, 'makan', 50000, 'daily');
      database.createBudget(TEST_USER, 'transport', 200000, 'monthly');

      const budget = database.getBudgetByName(TEST_USER, 'jajan');
      expect(budget).toBeUndefined();

      const budgets = database.getBudgets(TEST_USER);
      expect(budgets.length).toBe(2);

      // Simulate the error message construction from the handler
      let response = `Budget "jajan" tidak ditemukan.`;
      if (budgets.length > 0) {
        const names = budgets.map((b) => b.name).join(', ');
        response += `\n\nBudget yang tersedia: ${names}`;
      }

      expect(response).toContain('Budget "jajan" tidak ditemukan.');
      expect(response).toContain('Budget yang tersedia: makan, transport');
    });

    it('shows only error message when user has no budgets', () => {
      database.getOrCreateUser(TEST_USER);

      const budgets = database.getBudgets(TEST_USER);
      expect(budgets.length).toBe(0);

      let response = `Budget "jajan" tidak ditemukan.`;
      if (budgets.length > 0) {
        const names = budgets.map((b) => b.name).join(', ');
        response += `\n\nBudget yang tersedia: ${names}`;
      }

      expect(response).toBe('Budget "jajan" tidak ditemukan.');
      expect(response).not.toContain('Budget yang tersedia');
    });
  });

  describe('budget exists - confirmation with details', () => {
    it('shows confirmation message with name, limit, and period', () => {
      database.getOrCreateUser(TEST_USER);
      database.createBudget(TEST_USER, 'jajan', 50000, 'daily');

      const budget = database.getBudgetByName(TEST_USER, 'jajan');
      expect(budget).toBeDefined();
      expect(budget.name).toBe('jajan');
      expect(budget.limit_amount).toBe(50000);
      expect(budget.period).toBe('daily');

      // Simulate the confirmation message construction
      const periodLabel = { daily: 'hari', monthly: 'bulan', yearly: 'tahun' }[budget.period];
      const confirmMsg = `Hapus budget *${budget.name}*?\n\nLimit: ${formatRupiah(budget.limit_amount)}/${periodLabel}\nPeriode: ${periodLabel}`;

      expect(confirmMsg).toContain('Hapus budget *jajan*?');
      expect(confirmMsg).toContain('Rp50.000/hari');
      expect(confirmMsg).toContain('Periode: hari');
    });

    it('shows monthly period label for monthly budgets', () => {
      database.getOrCreateUser(TEST_USER);
      database.createBudget(TEST_USER, 'transport', 300000, 'monthly');

      const budget = database.getBudgetByName(TEST_USER, 'transport');
      const periodLabel = { daily: 'hari', monthly: 'bulan', yearly: 'tahun' }[budget.period];
      const confirmMsg = `Hapus budget *${budget.name}*?\n\nLimit: ${formatRupiah(budget.limit_amount)}/${periodLabel}\nPeriode: ${periodLabel}`;

      expect(confirmMsg).toContain('Hapus budget *transport*?');
      expect(confirmMsg).toContain('Rp300.000/bulan');
    });

    it('builds confirm_delete keyboard with budget name', () => {
      const keyboard = buildKeyboard('confirm_delete', { budgetName: 'jajan' });
      const buttons = keyboard.reply_markup.inline_keyboard.flat();

      expect(buttons).toHaveLength(2);
      expect(buttons[0].text).toBe('Ya, Hapus');
      expect(buttons[0].callback_data).toBe('del:jajan:yes');
      expect(buttons[1].text).toBe('Batal');
      expect(buttons[1].callback_data).toBe('del:jajan:no');
    });

    it('creates confirmation with 60s TTL for delete_budget action', () => {
      const confirmationId = createConfirmation(TEST_USER, 'delete_budget', { budgetName: 'jajan' }, 60);
      expect(confirmationId).toBeDefined();
      expect(typeof confirmationId).toBe('string');
    });
  });

  describe('callback confirm - delete budget', () => {
    it('deletes budget successfully on confirm', () => {
      database.getOrCreateUser(TEST_USER);
      database.createBudget(TEST_USER, 'jajan', 50000, 'daily');

      // Verify budget exists
      expect(database.getBudgetByName(TEST_USER, 'jajan')).toBeDefined();

      // Simulate confirm callback
      const deleted = database.deleteBudget(TEST_USER, 'jajan');
      expect(deleted).toBe(true);

      // Verify budget is gone
      expect(database.getBudgetByName(TEST_USER, 'jajan')).toBeUndefined();
    });

    it('returns false when budget already deleted', () => {
      database.getOrCreateUser(TEST_USER);

      const deleted = database.deleteBudget(TEST_USER, 'nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('callback cancel - no deletion', () => {
    it('budget remains intact after cancel', () => {
      database.getOrCreateUser(TEST_USER);
      database.createBudget(TEST_USER, 'jajan', 50000, 'daily');

      // Simulate cancel - just resolve confirmation as cancelled
      const confirmationId = createConfirmation(TEST_USER, 'delete_budget', { budgetName: 'jajan' }, 60);
      const result = resolveConfirmation(confirmationId, false);

      expect(result).toBeDefined();
      expect(result.confirmed).toBe(false);
      expect(result.data.budgetName).toBe('jajan');

      // Budget should still exist
      expect(database.getBudgetByName(TEST_USER, 'jajan')).toBeDefined();
    });
  });

  describe('timeout handling', () => {
    it('confirmation expires after TTL', () => {
      const confirmationId = createConfirmation(TEST_USER, 'delete_budget', { budgetName: 'jajan' }, 60);

      // Advance time past TTL
      vi.advanceTimersByTime(61000);

      // Trying to resolve should return null (expired)
      const result = resolveConfirmation(confirmationId, true);
      expect(result).toBeNull();
    });

    it('confirmation is still valid before TTL expires', () => {
      const confirmationId = createConfirmation(TEST_USER, 'delete_budget', { budgetName: 'jajan' }, 60);

      // Advance time but not past TTL
      vi.advanceTimersByTime(30000);

      // Should still be resolvable
      const result = resolveConfirmation(confirmationId, true);
      expect(result).toBeDefined();
      expect(result.confirmed).toBe(true);
      expect(result.data.budgetName).toBe('jajan');
    });

    it('budget is not deleted when confirmation expires', () => {
      database.getOrCreateUser(TEST_USER);
      database.createBudget(TEST_USER, 'jajan', 50000, 'daily');

      createConfirmation(TEST_USER, 'delete_budget', { budgetName: 'jajan' }, 60);

      // Advance time past TTL (simulating timeout)
      vi.advanceTimersByTime(61000);

      // Budget should still exist since confirmation expired
      expect(database.getBudgetByName(TEST_USER, 'jajan')).toBeDefined();
    });
  });
});
