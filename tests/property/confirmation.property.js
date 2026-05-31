'use strict';

/**
 * Property 5: Reset confirmation preserves data until confirmed
 * Feature: refactor-user-flow, Property 5: Reset confirmation preserves data until confirmed
 * Validates: Requirements 3.2, 3.3
 *
 * For any set of today's expenses, initiating a reset and then cancelling SHALL leave
 * all expenses unchanged; initiating a reset and confirming SHALL delete all of today's
 * expenses and only today's expenses.
 */

const {
  createConfirmation,
  resolveConfirmation,
  clearAll,
} = require('../../src/confirmation');

const database = require('../../src/database');

describe('Property 5: Reset confirmation preserves data until confirmed', () => {
  /** @type {import('fast-check')} */
  let fc;

  beforeAll(async () => {
    fc = await import('fast-check');
  });

  beforeEach(() => {
    clearAll();
    const db = database.getDatabase();
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DELETE FROM shortcuts');
    db.exec('DELETE FROM expenses');
    db.exec('DELETE FROM budgets');
    db.exec('DELETE FROM users');
    db.exec('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    clearAll();
  });

  /**
   * Simulate the reset flow as the bot would do it:
   * 1. Get today's expenses
   * 2. Create a confirmation
   * 3. Resolve it (confirm or cancel)
   * 4. If confirmed, delete today's expenses from the database
   */
  function performResetFlow(telegramId, confirmed) {
    const confirmationId = createConfirmation(telegramId, 'reset', {}, 60);
    const result = resolveConfirmation(confirmationId, confirmed);

    if (result && result.confirmed) {
      // Simulate what bot.js does on reset confirm: delete today's expenses
      const db = database.getDatabase();
      const user = database.getOrCreateUser(telegramId);
      const today = new Date();
      const startOfDay = database.toSqliteDate(
        new Date(today.getFullYear(), today.getMonth(), today.getDate())
      );
      const endOfDay = database.toSqliteDate(
        new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
      );
      db.prepare(
        'DELETE FROM expenses WHERE user_id = ? AND created_at >= ? AND created_at < ?'
      ).run(user.id, startOfDay, endOfDay);
    }

    return result;
  }

  // Generator for expense amounts (valid range: 1000 - 10,000,000)
  function expenseAmountArb() {
    return fc.integer({ min: 1000, max: 10000000 });
  }

  // Generator for expense notes (short strings)
  function expenseNoteArb() {
    return fc.string({ minLength: 0, maxLength: 30 });
  }

  // Generator for a list of expenses (1 to 10 expenses)
  function expenseListArb() {
    return fc.array(
      fc.record({
        amount: expenseAmountArb(),
        note: expenseNoteArb(),
      }),
      { minLength: 1, maxLength: 10 }
    );
  }

  it('cancel leaves data unchanged (expenses still exist)', () => {
    fc.assert(
      fc.property(expenseListArb(), (expenses) => {
        // Setup: clean state for this iteration
        const db = database.getDatabase();
        db.exec('PRAGMA foreign_keys = OFF');
        db.exec('DELETE FROM shortcuts');
        db.exec('DELETE FROM expenses');
        db.exec('DELETE FROM budgets');
        db.exec('DELETE FROM users');
        db.exec('PRAGMA foreign_keys = ON');

        const telegramId = 'prop_test_user';

        // Add expenses for today
        for (const exp of expenses) {
          database.addExpense(telegramId, exp.amount, '', exp.note, null);
        }

        // Verify expenses were added
        const beforeExpenses = database.getTodayExpenses(telegramId);
        const beforeCount = beforeExpenses.length;
        const beforeTotal = beforeExpenses.reduce((sum, e) => sum + e.amount, 0);

        // Perform reset flow with cancel (confirmed = false)
        performResetFlow(telegramId, false);

        // Verify: data unchanged
        const afterExpenses = database.getTodayExpenses(telegramId);
        const afterCount = afterExpenses.length;
        const afterTotal = afterExpenses.reduce((sum, e) => sum + e.amount, 0);

        // Expenses count and total should be unchanged
        return afterCount === beforeCount && afterTotal === beforeTotal;
      }),
      { numRuns: 100 }
    );
  });

  it('confirm deletes today\'s expenses only', () => {
    fc.assert(
      fc.property(expenseListArb(), (expenses) => {
        // Setup: clean state for this iteration
        const db = database.getDatabase();
        db.exec('PRAGMA foreign_keys = OFF');
        db.exec('DELETE FROM shortcuts');
        db.exec('DELETE FROM expenses');
        db.exec('DELETE FROM budgets');
        db.exec('DELETE FROM users');
        db.exec('PRAGMA foreign_keys = ON');

        const telegramId = 'prop_test_user';

        // Add expenses for today
        for (const exp of expenses) {
          database.addExpense(telegramId, exp.amount, '', exp.note, null);
        }

        // Also add a "yesterday" expense by inserting directly with a past date
        const user = database.getOrCreateUser(telegramId);
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = database.toSqliteDate(yesterday);
        db.prepare(
          'INSERT INTO expenses (user_id, amount, category, note, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(user.id, 50000, '', 'yesterday expense', yesterdayStr);

        // Verify today's expenses exist
        const todayBefore = database.getTodayExpenses(telegramId);
        expect(todayBefore.length).toBe(expenses.length);

        // Count all expenses (today + yesterday)
        const allBefore = db.prepare(
          'SELECT COUNT(*) as count FROM expenses WHERE user_id = ?'
        ).get(user.id);

        // Perform reset flow with confirm (confirmed = true)
        performResetFlow(telegramId, true);

        // Verify: today's expenses are deleted
        const todayAfter = database.getTodayExpenses(telegramId);
        expect(todayAfter.length).toBe(0);

        // Verify: yesterday's expense still exists
        const allAfter = db.prepare(
          'SELECT COUNT(*) as count FROM expenses WHERE user_id = ?'
        ).get(user.id);

        // Only yesterday's expense should remain (1 expense)
        return todayAfter.length === 0 && allAfter.count === 1;
      }),
      { numRuns: 100 }
    );
  });
});
