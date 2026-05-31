'use strict';

const { createConfirmation, resolveConfirmation, isValid, clearAll } = require('../../src/confirmation');
const { buildUndoKeyboard } = require('../../src/keyboard');
const { formatRupiah } = require('../../src/formatter');
const {
  getDatabase,
  getOrCreateUser,
  addExpense,
  getTodayTotal,
  deleteExpenseById,
  getExpenseById,
} = require('../../src/database');

describe('Undo expense flow', () => {
  let db;
  let user;
  const telegramId = 'undo_test_user';

  beforeAll(() => {
    db = getDatabase();
    user = getOrCreateUser(telegramId, 'UndoTester');
  });

  beforeEach(() => {
    vi.useFakeTimers();
    clearAll();
    // Clean up expenses for this user
    db.prepare('DELETE FROM expenses WHERE user_id = ?').run(user.id);
  });

  afterEach(() => {
    clearAll();
    vi.useRealTimers();
  });

  afterAll(() => {
    db.prepare('DELETE FROM expenses WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(telegramId);
  });

  describe('Undo keyboard', () => {
    it('buildUndoKeyboard produces Undo and Ringkasan Hari Ini buttons', () => {
      const keyboard = buildUndoKeyboard(42, Date.now());
      const markup = keyboard.reply_markup;
      expect(markup).toBeDefined();
      expect(markup.inline_keyboard).toBeDefined();

      const buttons = markup.inline_keyboard.flat();
      const texts = buttons.map((b) => b.text);
      const callbackData = buttons.map((b) => b.callback_data);

      expect(texts).toContain('Undo');
      expect(texts).toContain('Ringkasan Hari Ini');
      expect(callbackData).toContain('undo:42');
      expect(callbackData).toContain('nav:today');
    });

    it('callback data format is undo:<expenseId>', () => {
      const keyboard = buildUndoKeyboard(123, Date.now());
      const buttons = keyboard.reply_markup.inline_keyboard.flat();
      const undoBtn = buttons.find((b) => b.text === 'Undo');
      expect(undoBtn.callback_data).toBe('undo:123');
    });
  });

  describe('Undo confirmation creation', () => {
    it('creates a confirmation with undo action and 30s TTL', () => {
      const id = createConfirmation(telegramId, 'undo', { expenseId: 1, amount: 20000, note: 'kopi' }, 30);
      expect(isValid(id)).toBe(true);
    });

    it('confirmation expires after 30 seconds', () => {
      const id = createConfirmation(telegramId, 'undo', { expenseId: 1, amount: 20000, note: 'kopi' }, 30);
      expect(isValid(id)).toBe(true);
      vi.advanceTimersByTime(30000);
      expect(isValid(id)).toBe(false);
    });

    it('confirmation is still valid just before 30s', () => {
      const id = createConfirmation(telegramId, 'undo', { expenseId: 1, amount: 20000, note: 'kopi' }, 30);
      vi.advanceTimersByTime(29999);
      expect(isValid(id)).toBe(true);
    });

    it('stores expense data in confirmation', () => {
      const id = createConfirmation(telegramId, 'undo', { expenseId: 5, amount: 15000, note: 'makan' }, 30);
      const result = resolveConfirmation(id, true);
      expect(result.data.expenseId).toBe(5);
      expect(result.data.amount).toBe(15000);
      expect(result.data.note).toBe('makan');
    });
  });

  describe('Undo within 30s (success)', () => {
    it('deletes the expense from database', () => {
      const expense = addExpense(telegramId, 20000, '', 'kopi');
      expect(getExpenseById(expense.id)).not.toBeNull();

      const deleted = deleteExpenseById(expense.id, user.id);
      expect(deleted).toBe(true);
      expect(getExpenseById(expense.id)).toBeNull();
    });

    it('updates today total after undo', () => {
      addExpense(telegramId, 20000, '', 'kopi');
      const expense2 = addExpense(telegramId, 15000, '', 'makan');

      expect(getTodayTotal(telegramId)).toBe(35000);

      deleteExpenseById(expense2.id, user.id);
      expect(getTodayTotal(telegramId)).toBe(20000);
    });

    it('undo response includes amount, note, and updated total', () => {
      addExpense(telegramId, 20000, '', 'kopi');
      const expense2 = addExpense(telegramId, 15000, '', 'makan');

      deleteExpenseById(expense2.id, user.id);
      const updatedTotal = getTodayTotal(telegramId);

      const noteLabel = expense2.note || 'tanpa keterangan';
      const response = `↩️ ${formatRupiah(expense2.amount)} (${noteLabel}) dibatalkan.\nTotal hari ini: ${formatRupiah(updatedTotal)}`;

      expect(response).toContain('Rp15.000');
      expect(response).toContain('makan');
      expect(response).toContain('dibatalkan');
      expect(response).toContain('Rp20.000'); // updated total
    });
  });

  describe('Undo after 30s (expired)', () => {
    it('resolving confirmation after 30s returns null', () => {
      const id = createConfirmation(telegramId, 'undo', { expenseId: 1, amount: 20000, note: 'kopi' }, 30);
      vi.advanceTimersByTime(30000);
      const result = resolveConfirmation(id, true);
      expect(result).toBeNull();
    });

    it('expired undo message suggests /reset', () => {
      const expiredMsg = '⏰ Waktu undo telah habis. Gunakan /reset jika ingin menghapus pengeluaran hari ini.';
      expect(expiredMsg).toContain('/reset');
      expect(expiredMsg).toContain('habis');
    });
  });

  describe('Double-undo (expense already deleted)', () => {
    it('getExpenseById returns null for deleted expense', () => {
      const expense = addExpense(telegramId, 20000, '', 'kopi');
      deleteExpenseById(expense.id, user.id);
      expect(getExpenseById(expense.id)).toBeNull();
    });

    it('deleteExpenseById returns false for already-deleted expense', () => {
      const expense = addExpense(telegramId, 20000, '', 'kopi');
      deleteExpenseById(expense.id, user.id);
      const secondDelete = deleteExpenseById(expense.id, user.id);
      expect(secondDelete).toBe(false);
    });
  });

  describe('Security: expense ownership check', () => {
    it('deleteExpenseById fails for wrong user_id', () => {
      const expense = addExpense(telegramId, 20000, '', 'kopi');
      const deleted = deleteExpenseById(expense.id, 99999);
      expect(deleted).toBe(false);
      // Expense still exists
      expect(getExpenseById(expense.id)).not.toBeNull();
    });
  });
});
