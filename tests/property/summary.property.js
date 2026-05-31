'use strict';

/**
 * Property-based tests for daily summary (Property 12).
 * Feature: refactor-user-flow
 *
 * Tests validate that the daily summary contains correct total,
 * remaining limit, and top min(N, 3) expenses sorted by amount descending.
 */

const database = require('../../src/database');
const { generateDailySummary, resetState } = require('../../src/scheduler');
const { formatRupiah } = require('../../src/formatter');

/**
 * Helper: generate a string from a constrained alphabet using fc.array + map.
 */
function alphaString(fc, minLength, maxLength) {
  return fc.array(
    fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
      'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'),
    { minLength, maxLength }
  ).map(arr => arr.join(''));
}

/**
 * Helper: clean database state for each test iteration.
 */
function cleanDatabase() {
  const db = database.getDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('DELETE FROM shortcuts');
  db.exec('DELETE FROM expenses');
  db.exec('DELETE FROM budgets');
  db.exec('DELETE FROM users');
  db.exec('PRAGMA foreign_keys = ON');
}


describe('Feature: refactor-user-flow, Property 12: Daily summary contains correct top expenses', () => {
  /**
   * **Validates: Requirements 7.3**
   *
   * For any user with N expenses today (N >= 1), the daily summary SHALL contain
   * the total amount, remaining daily limit, and the top min(N, 3) expenses
   * sorted by amount descending.
   */

  /** @type {import('fast-check')} */
  let fc;

  beforeAll(async () => {
    fc = await import('fast-check');
  });

  beforeEach(() => {
    cleanDatabase();
    resetState();
  });

  it('summary contains total amount, remaining limit, and top min(N, 3) expenses sorted by amount desc', () => {
    fc.assert(
      fc.property(
        // Generate 1-10 expenses with distinct amounts
        fc.uniqueArray(
          fc.record({
            amount: fc.integer({ min: 1000, max: 500000 }),
            note: alphaString(fc, 2, 15),
          }),
          { minLength: 1, maxLength: 10, selector: (e) => e.amount }
        ),
        // Generate a daily limit
        fc.integer({ min: 100000, max: 10000000 }),
        (expenses, dailyLimit) => {
          cleanDatabase();

          const telegramId = 'summary_test_user';

          // Set up user with daily limit
          database.getOrCreateUser(telegramId);
          database.setDailyLimit(telegramId, dailyLimit);

          // Add expenses
          for (const exp of expenses) {
            database.addExpense(telegramId, exp.amount, '', exp.note, null);
          }

          // Generate summary
          const summary = generateDailySummary(telegramId);

          // Summary should not be null since we have expenses
          expect(summary).not.toBeNull();

          // Calculate expected total
          const total = expenses.reduce((sum, e) => sum + e.amount, 0);
          const remaining = dailyLimit - total;

          // Summary should contain the total amount formatted
          expect(summary).toContain(formatRupiah(total));

          // Summary should contain the remaining limit formatted
          expect(summary).toContain(formatRupiah(remaining));

          // Determine top min(N, 3) expenses sorted by amount descending
          const topCount = Math.min(expenses.length, 3);
          const sortedExpenses = [...expenses].sort((a, b) => b.amount - a.amount);
          const topExpenses = sortedExpenses.slice(0, topCount);

          // Summary should contain each top expense's amount
          for (const exp of topExpenses) {
            expect(summary).toContain(formatRupiah(exp.amount));
          }

          // Summary should contain each top expense's note
          for (const exp of topExpenses) {
            expect(summary).toContain(exp.note);
          }

          // Verify the top expenses appear in descending order in the summary
          // Find positions of each top expense amount in the summary
          if (topExpenses.length > 1) {
            for (let i = 0; i < topExpenses.length - 1; i++) {
              const currentFormatted = formatRupiah(topExpenses[i].amount);
              const nextFormatted = formatRupiah(topExpenses[i + 1].amount);
              // The "Pengeluaran terbesar" section lists them in order
              const pengeluaranSection = summary.split('Pengeluaran terbesar')[1];
              if (pengeluaranSection) {
                const currentPos = pengeluaranSection.indexOf(currentFormatted);
                const nextPos = pengeluaranSection.indexOf(nextFormatted);
                // Current should appear before next (descending order)
                expect(currentPos).toBeLessThan(nextPos);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('summary returns null when user has no expenses today', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100000, max: 10000000 }),  // daily limit
        (dailyLimit) => {
          cleanDatabase();

          const telegramId = 'empty_test_user';

          // Set up user with daily limit but no expenses
          database.getOrCreateUser(telegramId);
          database.setDailyLimit(telegramId, dailyLimit);

          // Generate summary
          const summary = generateDailySummary(telegramId);

          // Should be null when no expenses
          expect(summary).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('summary shows exactly min(N, 3) top expenses', () => {
    fc.assert(
      fc.property(
        // Generate 1-8 expenses with unique amounts to avoid ambiguity
        fc.integer({ min: 1, max: 8 }),
        (numExpenses) => {
          cleanDatabase();

          const telegramId = 'count_test_user';

          // Set up user
          database.getOrCreateUser(telegramId);
          database.setDailyLimit(telegramId, 5000000);

          // Add expenses with distinct amounts (using index to ensure uniqueness)
          const expenses = [];
          for (let i = 0; i < numExpenses; i++) {
            const amount = (i + 1) * 10000;
            const note = `expense${i}`;
            database.addExpense(telegramId, amount, '', note, null);
            expenses.push({ amount, note });
          }

          // Generate summary
          const summary = generateDailySummary(telegramId);
          expect(summary).not.toBeNull();

          // Count numbered items in the "Pengeluaran terbesar" section
          const pengeluaranSection = summary.split('Pengeluaran terbesar')[1];
          expect(pengeluaranSection).toBeDefined();

          // Count lines that start with a number followed by a dot and space (e.g., "1. ", "2. ", "3. ")
          // Use pattern that matches the list format: "\n1. Rp..."
          const numberedLines = pengeluaranSection.match(/\d+\. Rp/g);
          const expectedCount = Math.min(numExpenses, 3);
          expect(numberedLines).not.toBeNull();
          expect(numberedLines.length).toBe(expectedCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});
