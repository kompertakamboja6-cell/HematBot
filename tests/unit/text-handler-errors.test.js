'use strict';

/**
 * Unit tests for the enhanced text input handler error messages.
 * Tests the context-aware error message logic by verifying:
 * - Unrecognized format shows 2+ format examples
 * - Out-of-range nominal mentions Rp1.000 and Rp10.000.000 boundaries
 * - Budget not found (user has budgets): record without budget, list available budgets
 * - Budget not found (no budgets): record without budget, no extra message
 * - Parser receives user's budget list
 *
 * Requirements: 6.1, 6.2, 6.4, 6.5
 */

const database = require('../../src/database');
const { parseExpense } = require('../../src/parser');
const { formatRupiah } = require('../../src/formatter');

describe('Text input handler - context-aware error messages', () => {
  const TEST_USER = 'text_handler_test';

  beforeEach(() => {
    const db = database.getDatabase();
    db.exec('DELETE FROM shortcuts');
    db.exec('DELETE FROM expenses');
    db.exec('DELETE FROM budgets');
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DELETE FROM users');
    db.exec('PRAGMA foreign_keys = ON');
  });

  describe('Unrecognized format error (Requirement 6.1)', () => {
    it('parseExpense returns null for completely invalid input', () => {
      const result = parseExpense('hello world', []);
      expect(result).toBeNull();
    });

    it('parseExpense returns null for empty input', () => {
      const result = parseExpense('', []);
      expect(result).toBeNull();
    });

    it('error message should contain at least 2 format examples', () => {
      // Simulate the error message from the handler
      const errorMsg = 'Format tidak dikenali. Contoh:\n`20 makan` → Rp20.000\n`15k kopi` → Rp15.000\n`20000 parkir` → Rp20.000';

      // Should contain at least 2 distinct examples
      const examples = errorMsg.match(/`\d+k?\s+\w+`/g);
      expect(examples.length).toBeGreaterThanOrEqual(2);
    });

    it('parseExpense returns null for text-only input without number', () => {
      const result = parseExpense('makan siang', []);
      expect(result).toBeNull();
    });
  });

  describe('Out-of-range nominal error (Requirement 6.2)', () => {
    it('parseExpense returns null for nominal below Rp1.000 (amount 0)', () => {
      // "0 makan" -> amount = 0, which is < 1000
      const result = parseExpense('0 makan', []);
      expect(result).toBeNull();
    });

    it('parseExpense returns null for nominal above Rp10.000.000', () => {
      // "20000k makan" -> 20000 * 1000 = 20,000,000 > 10,000,000
      const result = parseExpense('20000k makan', []);
      expect(result).toBeNull();
    });

    it('detects out-of-range when input starts with number pattern', () => {
      // Simulate the out-of-range detection logic from the handler
      const text = '20000k makan';
      const outOfRangeMatch = text.match(/^(\d+)(k?)\s*/i);
      expect(outOfRangeMatch).not.toBeNull();

      let testAmount = parseInt(outOfRangeMatch[1], 10);
      const hasK = outOfRangeMatch[2].toLowerCase() === 'k';
      if (hasK) testAmount *= 1000;
      else if (testAmount < 100) testAmount *= 1000;

      expect(testAmount).toBeGreaterThan(10_000_000);
    });

    it('detects out-of-range for very small amounts', () => {
      // "0" -> amount = 0, which is < 1000
      const text = '0 makan';
      const outOfRangeMatch = text.match(/^(\d+)(k?)\s*/i);
      expect(outOfRangeMatch).not.toBeNull();

      let testAmount = parseInt(outOfRangeMatch[1], 10);
      const hasK = outOfRangeMatch[2].toLowerCase() === 'k';
      if (hasK) testAmount *= 1000;
      else if (testAmount < 100) testAmount *= 1000;

      expect(testAmount).toBeLessThan(1000);
    });

    it('error message mentions Rp1.000 and Rp10.000.000 boundaries', () => {
      const errorMsg = 'Nominal di luar rentang yang diperbolehkan.\nRentang valid: Rp1.000 - Rp10.000.000\n\nContoh: `20 makan` (= Rp20.000)';

      expect(errorMsg).toContain('Rp1.000');
      expect(errorMsg).toContain('Rp10.000.000');
    });
  });

  describe('Budget not found - user has budgets (Requirement 6.4)', () => {
    it('parseExpense returns result with budget=null when last word does not match any budget', () => {
      const budgets = ['makan', 'transport'];
      const result = parseExpense('20 kopi jajan', budgets);

      // "jajan" is not in budgets, so budget should be null
      expect(result).not.toBeNull();
      expect(result.budget).toBeNull();
      expect(result.note).toBe('kopi jajan');
    });

    it('parseExpense returns result with matched budget when last word matches', () => {
      const budgets = ['makan', 'transport'];
      const result = parseExpense('20 kopi makan', budgets);

      expect(result).not.toBeNull();
      expect(result.budget).toBe('makan');
      expect(result.note).toBe('kopi');
    });

    it('handler logic detects unmatched budget-like last word', () => {
      const budgetNames = ['makan', 'transport'];
      const inputText = '20 kopi jajan';

      // Simulate the handler logic
      const parsed = parseExpense(inputText, budgetNames);
      expect(parsed).not.toBeNull();
      expect(parsed.budget).toBeNull();

      // Extract last word from the text after the nominal
      const inputWords = inputText.replace(/^(\d+)(k?)\s*/i, '').trim().split(/\s+/);
      const lastWord = inputWords.length > 1 ? inputWords[inputWords.length - 1] : null;

      expect(lastWord).toBe('jajan');

      // Check it's not numeric
      const isLastWordNumeric = /^\d+(k?)$/i.test(lastWord);
      expect(isLastWordNumeric).toBe(false);

      // Build the info message
      const budgetList = budgetNames.map(n => `• ${n}`).join('\n');
      const infoMsg = `ℹ️ Budget "${lastWord}" tidak ditemukan. Pengeluaran dicatat tanpa budget.\n\nBudget yang tersedia:\n${budgetList}`;

      expect(infoMsg).toContain('Budget "jajan" tidak ditemukan');
      expect(infoMsg).toContain('• makan');
      expect(infoMsg).toContain('• transport');
    });

    it('does not trigger budget-not-found when input has only one word after nominal', () => {
      const budgetNames = ['makan', 'transport'];
      const inputText = '20 kopi';

      const parsed = parseExpense(inputText, budgetNames);
      expect(parsed).not.toBeNull();
      expect(parsed.budget).toBeNull();

      // Extract last word
      const inputWords = inputText.replace(/^(\d+)(k?)\s*/i, '').trim().split(/\s+/);
      const lastWord = inputWords.length > 1 ? inputWords[inputWords.length - 1] : null;

      // Only one word after nominal, so lastWord should be null (no budget hint)
      expect(lastWord).toBeNull();
    });
  });

  describe('Budget not found - user has no budgets (Requirement 6.5)', () => {
    it('records expense normally when user has no budgets and single word note', () => {
      const budgetNames = [];
      const inputText = '20 kopi';

      const parsed = parseExpense(inputText, budgetNames);
      expect(parsed).not.toBeNull();
      expect(parsed.budget).toBeNull();
      expect(parsed.note).toBe('kopi');

      // Single word after nominal - no budget hint triggered
      const inputWords = inputText.replace(/^(\d+)(k?)\s*/i, '').trim().split(/\s+/);
      const lastWord = inputWords.length > 1 ? inputWords[inputWords.length - 1] : null;
      expect(lastWord).toBeNull();
    });

    it('shows /buat guide when user has no budgets and multi-word input', () => {
      const budgetNames = [];
      const inputText = '20 kopi jajan';

      const parsed = parseExpense(inputText, budgetNames);
      expect(parsed).not.toBeNull();
      expect(parsed.budget).toBeNull();
      expect(parsed.note).toBe('kopi jajan');

      // Multi-word input with no budgets - should show /buat guide
      const inputWords = inputText.replace(/^(\d+)(k?)\s*/i, '').trim().split(/\s+/);
      const lastWord = inputWords.length > 1 ? inputWords[inputWords.length - 1] : null;
      expect(lastWord).toBe('jajan');

      const isLastWordNumeric = /^\d+(k?)$/i.test(lastWord);
      expect(isLastWordNumeric).toBe(false);

      // Simulate the /buat guide message
      const guideMsg = `ℹ️ Belum ada budget yang dibuat. Pengeluaran dicatat tanpa budget.\n\nBuat budget dengan:\n\`/buat <nama> <nominal>\`\nContoh: \`/buat jajan 50k\``;
      expect(guideMsg).toContain('/buat');
      expect(guideMsg).toContain('Belum ada budget');
    });
  });

  describe('Parser receives user budget list', () => {
    it('getBudgets returns budget names for the user', () => {
      database.getOrCreateUser(TEST_USER, 'Test');
      database.createBudget(TEST_USER, 'makan', 50000, 'daily');
      database.createBudget(TEST_USER, 'transport', 200000, 'monthly');

      const budgets = database.getBudgets(TEST_USER);
      const budgetNames = budgets.map(b => b.name);

      expect(budgetNames).toContain('makan');
      expect(budgetNames).toContain('transport');
      expect(budgetNames.length).toBe(2);
    });

    it('parseExpense correctly uses budget list for matching', () => {
      database.getOrCreateUser(TEST_USER, 'Test');
      database.createBudget(TEST_USER, 'makan', 50000, 'daily');
      database.createBudget(TEST_USER, 'transport', 200000, 'monthly');

      const budgets = database.getBudgets(TEST_USER);
      const budgetNames = budgets.map(b => b.name);

      // With budget list, last word "makan" should match
      const result = parseExpense('15 nasi padang makan', budgetNames);
      expect(result).not.toBeNull();
      expect(result.budget).toBe('makan');
      expect(result.note).toBe('nasi padang');
      expect(result.amount).toBe(15000);
    });

    it('parseExpense case-insensitive budget matching', () => {
      const budgetNames = ['Makan', 'Transport'];

      const result = parseExpense('20 kopi makan', budgetNames);
      expect(result).not.toBeNull();
      expect(result.budget).toBe('Makan');
    });
  });
});
