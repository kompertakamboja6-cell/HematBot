'use strict';

const {
  createConfirmation,
  resolveConfirmation,
  isValid,
  clearAll,
} = require('../../src/confirmation');
const database = require('../../src/database');

describe('Integration: Confirmation Flows', () => {
  const telegramId = 'integration_confirm_user';
  let db;
  let user;

  beforeAll(() => {
    db = database.getDatabase();
    user = database.getOrCreateUser(telegramId, 'ConfirmTester');
  });

  beforeEach(() => {
    vi.useFakeTimers();
    clearAll();
    // Clean expenses and budgets for this user
    db.prepare('DELETE FROM expenses WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM budgets WHERE user_id = ?').run(user.id);
  });

  afterEach(() => {
    clearAll();
    vi.useRealTimers();
  });

  afterAll(() => {
    db.prepare('DELETE FROM expenses WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM budgets WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(telegramId);
  });

  describe('Reset confirm/cancel flow', () => {
    it('confirm deletes all today expenses from database', () => {
      // Set up: add expenses for today
      database.addExpense(telegramId, 20000, '', 'kopi');
      database.addExpense(telegramId, 35000, '', 'makan siang');
      database.addExpense(telegramId, 15000, '', 'snack');

      expect(database.getTodayExpenses(telegramId)).toHaveLength(3);
      expect(database.getTodayTotal(telegramId)).toBe(70000);

      // Create reset confirmation with 60s TTL
      const confirmId = createConfirmation(telegramId, 'reset', {
        expenseCount: 3,
        total: 70000,
      }, 60);

      // Resolve as confirmed
      const result = resolveConfirmation(confirmId, true);
      expect(result).not.toBeNull();
      expect(result.confirmed).toBe(true);
      expect(result.action).toBe('reset');

      // Perform the actual deletion (simulating what bot.js does on confirm)
      db.prepare('DELETE FROM expenses WHERE user_id = ? AND DATE(created_at) = DATE(\'now\')').run(user.id);

      // Verify expenses are deleted
      expect(database.getTodayExpenses(telegramId)).toHaveLength(0);
      expect(database.getTodayTotal(telegramId)).toBe(0);
    });

    it('cancel leaves all expenses unchanged', () => {
      // Set up: add expenses for today
      database.addExpense(telegramId, 20000, '', 'kopi');
      database.addExpense(telegramId, 35000, '', 'makan siang');

      expect(database.getTodayExpenses(telegramId)).toHaveLength(2);
      expect(database.getTodayTotal(telegramId)).toBe(55000);

      // Create reset confirmation
      const confirmId = createConfirmation(telegramId, 'reset', {
        expenseCount: 2,
        total: 55000,
      }, 60);

      // Resolve as cancelled
      const result = resolveConfirmation(confirmId, false);
      expect(result).not.toBeNull();
      expect(result.confirmed).toBe(false);

      // Verify expenses are unchanged
      expect(database.getTodayExpenses(telegramId)).toHaveLength(2);
      expect(database.getTodayTotal(telegramId)).toBe(55000);
    });

    it('confirmation expires after 60s and expenses remain unchanged', () => {
      // Set up: add expenses
      database.addExpense(telegramId, 25000, '', 'transport');

      expect(database.getTodayExpenses(telegramId)).toHaveLength(1);

      // Create reset confirmation
      const confirmId = createConfirmation(telegramId, 'reset', {
        expenseCount: 1,
        total: 25000,
      }, 60);

      // Advance time past TTL
      vi.advanceTimersByTime(60000);

      // Attempt to resolve — should return null (expired)
      const result = resolveConfirmation(confirmId, true);
      expect(result).toBeNull();

      // Verify expenses are unchanged (auto-cancel behavior)
      expect(database.getTodayExpenses(telegramId)).toHaveLength(1);
      expect(database.getTodayTotal(telegramId)).toBe(25000);
    });
  });

  describe('Undo within/after time limit', () => {
    it('undo within 30s deletes the expense from database', () => {
      // Record an expense
      const expense = database.addExpense(telegramId, 18000, '', 'es teh');
      expect(database.getExpenseById(expense.id)).not.toBeNull();

      // Create undo confirmation with 30s TTL
      const confirmId = createConfirmation(telegramId, 'undo', {
        expenseId: expense.id,
        amount: 18000,
        note: 'es teh',
      }, 30);

      // Advance time within limit (e.g., 15s)
      vi.advanceTimersByTime(15000);

      // Resolve as confirmed (undo)
      const result = resolveConfirmation(confirmId, true);
      expect(result).not.toBeNull();
      expect(result.confirmed).toBe(true);
      expect(result.action).toBe('undo');

      // Perform the actual deletion
      const deleted = database.deleteExpenseById(expense.id, user.id);
      expect(deleted).toBe(true);

      // Verify expense is gone
      expect(database.getExpenseById(expense.id)).toBeNull();
    });

    it('undo updates today total correctly', () => {
      // Record two expenses
      database.addExpense(telegramId, 20000, '', 'kopi');
      const expense2 = database.addExpense(telegramId, 30000, '', 'makan');

      expect(database.getTodayTotal(telegramId)).toBe(50000);

      // Create undo confirmation for second expense
      const confirmId = createConfirmation(telegramId, 'undo', {
        expenseId: expense2.id,
        amount: 30000,
        note: 'makan',
      }, 30);

      // Resolve within time limit
      const result = resolveConfirmation(confirmId, true);
      expect(result).not.toBeNull();

      // Delete the expense
      database.deleteExpenseById(expense2.id, user.id);

      // Verify updated total
      expect(database.getTodayTotal(telegramId)).toBe(20000);
    });

    it('undo after 30s returns null (expired)', () => {
      // Record an expense
      const expense = database.addExpense(telegramId, 12000, '', 'parkir');

      // Create undo confirmation
      const confirmId = createConfirmation(telegramId, 'undo', {
        expenseId: expense.id,
        amount: 12000,
        note: 'parkir',
      }, 30);

      // Advance time past TTL
      vi.advanceTimersByTime(30000);

      // Attempt to resolve — should return null
      const result = resolveConfirmation(confirmId, true);
      expect(result).toBeNull();

      // Verify expense is still in database (not deleted)
      expect(database.getExpenseById(expense.id)).not.toBeNull();
      expect(database.getTodayTotal(telegramId)).toBe(12000);
    });

    it('undo at exactly 29999ms still succeeds', () => {
      const expense = database.addExpense(telegramId, 10000, '', 'air');

      const confirmId = createConfirmation(telegramId, 'undo', {
        expenseId: expense.id,
        amount: 10000,
        note: 'air',
      }, 30);

      // Advance to just before expiry
      vi.advanceTimersByTime(29999);

      // Should still be valid
      expect(isValid(confirmId)).toBe(true);
      const result = resolveConfirmation(confirmId, true);
      expect(result).not.toBeNull();
      expect(result.confirmed).toBe(true);
    });
  });

  describe('Budget delete confirm/cancel flow', () => {
    it('confirm deletes the budget from database', () => {
      // Set up: create a budget
      database.createBudget(telegramId, 'jajan', 100000, 'daily');
      expect(database.getBudgetByName(telegramId, 'jajan')).not.toBeNull();

      // Create delete_budget confirmation
      const confirmId = createConfirmation(telegramId, 'delete_budget', {
        budgetName: 'jajan',
      }, 60);

      // Resolve as confirmed
      const result = resolveConfirmation(confirmId, true);
      expect(result).not.toBeNull();
      expect(result.confirmed).toBe(true);
      expect(result.action).toBe('delete_budget');
      expect(result.data.budgetName).toBe('jajan');

      // Perform the actual deletion
      const deleted = database.deleteBudget(telegramId, 'jajan');
      expect(deleted).toBe(true);

      // Verify budget is gone
      expect(database.getBudgetByName(telegramId, 'jajan')).toBeUndefined();
    });

    it('cancel leaves the budget unchanged', () => {
      // Set up: create a budget
      database.createBudget(telegramId, 'transport', 200000, 'daily');
      expect(database.getBudgetByName(telegramId, 'transport')).not.toBeNull();

      // Create delete_budget confirmation
      const confirmId = createConfirmation(telegramId, 'delete_budget', {
        budgetName: 'transport',
      }, 60);

      // Resolve as cancelled
      const result = resolveConfirmation(confirmId, false);
      expect(result).not.toBeNull();
      expect(result.confirmed).toBe(false);

      // Verify budget still exists
      const budget = database.getBudgetByName(telegramId, 'transport');
      expect(budget).not.toBeNull();
      expect(budget.name).toBe('transport');
      expect(budget.limit_amount).toBe(200000);
    });

    it('confirmation expires after 60s and budget remains', () => {
      // Set up: create a budget
      database.createBudget(telegramId, 'makan', 150000, 'daily');

      // Create delete_budget confirmation
      const confirmId = createConfirmation(telegramId, 'delete_budget', {
        budgetName: 'makan',
      }, 60);

      // Advance time past TTL
      vi.advanceTimersByTime(60000);

      // Attempt to resolve — should return null
      const result = resolveConfirmation(confirmId, true);
      expect(result).toBeNull();

      // Verify budget still exists
      const budget = database.getBudgetByName(telegramId, 'makan');
      expect(budget).not.toBeNull();
      expect(budget.name).toBe('makan');
    });
  });

  describe('Confirmation timeout auto-cancel', () => {
    it('reset confirmation auto-removes from pending after timeout', () => {
      const confirmId = createConfirmation(telegramId, 'reset', { expenseCount: 2, total: 40000 }, 60);
      expect(isValid(confirmId)).toBe(true);

      vi.advanceTimersByTime(60000);

      // Confirmation is no longer valid
      expect(isValid(confirmId)).toBe(false);
      // Attempting to resolve returns null
      expect(resolveConfirmation(confirmId, true)).toBeNull();
      expect(resolveConfirmation(confirmId, false)).toBeNull();
    });

    it('undo confirmation auto-removes from pending after timeout', () => {
      const confirmId = createConfirmation(telegramId, 'undo', { expenseId: 99, amount: 5000 }, 30);
      expect(isValid(confirmId)).toBe(true);

      vi.advanceTimersByTime(30000);

      expect(isValid(confirmId)).toBe(false);
      expect(resolveConfirmation(confirmId, true)).toBeNull();
    });

    it('budget delete confirmation auto-removes from pending after timeout', () => {
      const confirmId = createConfirmation(telegramId, 'delete_budget', { budgetName: 'test' }, 60);
      expect(isValid(confirmId)).toBe(true);

      vi.advanceTimersByTime(60000);

      expect(isValid(confirmId)).toBe(false);
      expect(resolveConfirmation(confirmId, true)).toBeNull();
    });

    it('multiple confirmations expire independently based on their TTL', () => {
      const undoId = createConfirmation(telegramId, 'undo', { expenseId: 1 }, 30);
      const resetId = createConfirmation(telegramId, 'reset', { expenseCount: 1 }, 60);

      // After 30s: undo expired, reset still valid
      vi.advanceTimersByTime(30000);
      expect(isValid(undoId)).toBe(false);
      expect(isValid(resetId)).toBe(true);

      // After another 30s (total 60s): both expired
      vi.advanceTimersByTime(30000);
      expect(isValid(undoId)).toBe(false);
      expect(isValid(resetId)).toBe(false);
    });

    it('expired confirmation does not affect database state', () => {
      // Set up data
      database.addExpense(telegramId, 50000, '', 'belanja');
      database.createBudget(telegramId, 'belanja', 500000, 'daily');

      // Create confirmations that will expire
      const resetId = createConfirmation(telegramId, 'reset', { expenseCount: 1, total: 50000 }, 60);
      const deleteId = createConfirmation(telegramId, 'delete_budget', { budgetName: 'belanja' }, 60);

      // Let them expire
      vi.advanceTimersByTime(60000);

      // Verify data is untouched
      expect(database.getTodayExpenses(telegramId)).toHaveLength(1);
      expect(database.getTodayTotal(telegramId)).toBe(50000);
      expect(database.getBudgetByName(telegramId, 'belanja')).not.toBeNull();
    });
  });
});
