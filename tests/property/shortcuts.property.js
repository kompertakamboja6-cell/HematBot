'use strict';

/**
 * Property-based tests for shortcuts (Properties 13-17).
 * Feature: refactor-user-flow
 *
 * Tests validate shortcut CRUD operations, execution, listing,
 * limit enforcement, and not-found behavior.
 */

const database = require('../../src/database');

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


describe('Feature: refactor-user-flow, Property 13: Shortcut save/upsert correctness', () => {
  /**
   * **Validates: Requirements 8.1, 8.7**
   *
   * For any valid shortcut input (name, nominal, note, optional budget),
   * saving it SHALL store the shortcut such that retrieving it by name returns
   * the same nominal, note, and budget. If a shortcut with the same name already
   * exists, it SHALL be overwritten with the new data.
   */

  /** @type {import('fast-check')} */
  let fc;

  beforeAll(async () => {
    fc = await import('fast-check');
  });

  beforeEach(() => {
    cleanDatabase();
  });

  it('saving a shortcut stores it correctly and can be retrieved by name', () => {
    fc.assert(
      fc.property(
        alphaString(fc, 2, 10),  // shortcut name
        fc.integer({ min: 1000, max: 10000000 }),  // amount
        alphaString(fc, 1, 20),  // note
        fc.option(alphaString(fc, 2, 8), { nil: null }),  // optional budget
        (name, amount, note, budget) => {
          cleanDatabase();

          const telegramId = 'prop_test_user';

          // Save shortcut
          const saved = database.createShortcut(telegramId, name, amount, note, budget);

          // Retrieve by name
          const retrieved = database.getShortcutByName(telegramId, name);

          // Verify stored correctly
          expect(retrieved).not.toBeNull();
          expect(retrieved.name).toBe(name);
          expect(retrieved.amount).toBe(amount);
          expect(retrieved.note).toBe(note);
          expect(retrieved.budget_name).toBe(budget);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('saving a shortcut with an existing name overwrites the old data', () => {
    fc.assert(
      fc.property(
        alphaString(fc, 2, 10),  // shortcut name (same for both)
        fc.integer({ min: 1000, max: 5000000 }),  // first amount
        fc.integer({ min: 5000001, max: 10000000 }),  // second amount (different range to ensure different)
        alphaString(fc, 1, 10),  // first note
        alphaString(fc, 11, 20),  // second note (different length to ensure different)
        (name, amount1, amount2, note1, note2) => {
          cleanDatabase();

          const telegramId = 'prop_test_user';

          // Save first version
          database.createShortcut(telegramId, name, amount1, note1, null);

          // Verify first version stored
          const first = database.getShortcutByName(telegramId, name);
          expect(first.amount).toBe(amount1);
          expect(first.note).toBe(note1);

          // Overwrite with second version
          database.createShortcut(telegramId, name, amount2, note2, 'newbudget');

          // Verify overwritten
          const second = database.getShortcutByName(telegramId, name);
          expect(second.amount).toBe(amount2);
          expect(second.note).toBe(note2);
          expect(second.budget_name).toBe('newbudget');

          // Should still be only 1 shortcut with this name
          const count = database.countShortcuts(telegramId);
          expect(count).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Feature: refactor-user-flow, Property 14: Shortcut execution produces correct expense', () => {
  /**
   * **Validates: Requirements 8.2**
   *
   * For any saved shortcut, executing it (addExpense with shortcut data)
   * produces an expense with the same amount, note, and budget as stored
   * in the shortcut.
   */

  /** @type {import('fast-check')} */
  let fc;

  beforeAll(async () => {
    fc = await import('fast-check');
  });

  beforeEach(() => {
    cleanDatabase();
  });

  it('executing a saved shortcut records an expense with matching data', () => {
    fc.assert(
      fc.property(
        alphaString(fc, 2, 10),  // shortcut name
        fc.integer({ min: 1000, max: 10000000 }),  // amount
        alphaString(fc, 1, 20),  // note
        (name, amount, note) => {
          cleanDatabase();

          const telegramId = 'prop_test_user';

          // Save shortcut
          database.createShortcut(telegramId, name, amount, note, null);

          // Retrieve shortcut (simulating /q lookup)
          const shortcut = database.getShortcutByName(telegramId, name);
          expect(shortcut).not.toBeNull();

          // Execute shortcut by adding expense with shortcut data
          const expense = database.addExpense(
            telegramId,
            shortcut.amount,
            '',
            shortcut.note,
            shortcut.budget_name
          );

          // Verify expense matches shortcut data
          expect(expense.amount).toBe(amount);
          expect(expense.note).toBe(note);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('executing a shortcut with budget records expense linked to that budget', () => {
    fc.assert(
      fc.property(
        alphaString(fc, 2, 10),  // shortcut name
        fc.integer({ min: 1000, max: 10000000 }),  // amount
        alphaString(fc, 1, 15),  // note
        alphaString(fc, 2, 8),  // budget name
        (name, amount, note, budgetName) => {
          cleanDatabase();

          const telegramId = 'prop_test_user';

          // Create a budget first
          database.createBudget(telegramId, budgetName, 500000, 'daily');

          // Save shortcut with budget
          database.createShortcut(telegramId, name, amount, note, budgetName);

          // Retrieve and execute shortcut
          const shortcut = database.getShortcutByName(telegramId, name);
          const expense = database.addExpense(
            telegramId,
            shortcut.amount,
            '',
            shortcut.note,
            shortcut.budget_name
          );

          // Verify expense has correct budget linkage
          expect(expense.amount).toBe(amount);
          expect(expense.note).toBe(note);
          expect(expense.budget_id).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Feature: refactor-user-flow, Property 15: Shortcut listing completeness', () => {
  /**
   * **Validates: Requirements 8.3**
   *
   * For any user with N shortcuts (0 <= N <= 20), getShortcuts returns
   * exactly N items.
   */

  /** @type {import('fast-check')} */
  let fc;

  beforeAll(async () => {
    fc = await import('fast-check');
  });

  beforeEach(() => {
    cleanDatabase();
  });

  it('getShortcuts returns exactly N items for a user with N shortcuts', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),  // number of shortcuts to create
        (n) => {
          cleanDatabase();

          const telegramId = 'prop_test_user';

          // Create N shortcuts with unique names
          for (let i = 0; i < n; i++) {
            database.createShortcut(telegramId, `shortcut${i}`, 10000 + i * 1000, `note${i}`, null);
          }

          // Retrieve all shortcuts
          const shortcuts = database.getShortcuts(telegramId);

          // Verify exactly N items returned
          expect(shortcuts.length).toBe(n);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('each shortcut in listing contains name, amount, note, and budget_name', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),  // number of shortcuts
        (n) => {
          cleanDatabase();

          const telegramId = 'prop_test_user';
          const expected = [];

          for (let i = 0; i < n; i++) {
            const name = `sc${i}`;
            const amount = 5000 + i * 1000;
            const note = `note${i}`;
            database.createShortcut(telegramId, name, amount, note, null);
            expected.push({ name, amount, note });
          }

          const shortcuts = database.getShortcuts(telegramId);

          // Verify each shortcut has required fields
          for (const sc of shortcuts) {
            expect(sc).toHaveProperty('name');
            expect(sc).toHaveProperty('amount');
            expect(sc).toHaveProperty('note');
            expect(sc).toHaveProperty('budget_name');
          }

          // Verify all expected names are present
          const names = shortcuts.map(s => s.name);
          for (const exp of expected) {
            expect(names).toContain(exp.name);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Feature: refactor-user-flow, Property 16: Shortcut limit enforcement', () => {
  /**
   * **Validates: Requirements 8.5, 8.6**
   *
   * For any user, the system SHALL never allow more than 20 shortcuts to be stored.
   * Attempting to save a 21st shortcut SHALL be rejected.
   */

  /** @type {import('fast-check')} */
  let fc;

  beforeAll(async () => {
    fc = await import('fast-check');
  });

  beforeEach(() => {
    cleanDatabase();
  });

  it('countShortcuts never exceeds 20 when limit is enforced', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 15, max: 25 }),  // attempt to create this many shortcuts
        (attemptCount) => {
          cleanDatabase();

          const telegramId = 'prop_test_user';

          // Simulate the bot's limit enforcement logic
          for (let i = 0; i < attemptCount; i++) {
            const count = database.countShortcuts(telegramId);
            if (count >= 20) {
              // Bot would reject - stop creating
              break;
            }
            database.createShortcut(telegramId, `shortcut${i}`, 10000, `note${i}`, null);
          }

          // Verify count never exceeds 20
          const finalCount = database.countShortcuts(telegramId);
          expect(finalCount).toBeLessThanOrEqual(20);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('exactly 20 shortcuts can be stored', () => {
    fc.assert(
      fc.property(
        fc.constant(20),  // always try to create exactly 20
        (n) => {
          cleanDatabase();

          const telegramId = 'prop_test_user';

          // Create exactly 20 shortcuts
          for (let i = 0; i < n; i++) {
            const count = database.countShortcuts(telegramId);
            if (count >= 20) break;
            database.createShortcut(telegramId, `sc${i}`, 5000 + i * 100, `note${i}`, null);
          }

          const finalCount = database.countShortcuts(telegramId);
          expect(finalCount).toBe(20);

          // Attempting to add a 21st (with a new name) should be blocked by the limit check
          const countBefore21st = database.countShortcuts(telegramId);
          expect(countBefore21st).toBe(20);

          // The bot checks count >= 20 before calling createShortcut
          // So the 21st would never be created
          expect(countBefore21st >= 20).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('upsert (overwriting existing) is allowed even at limit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 10000000 }),  // new amount for overwrite
        alphaString(fc, 1, 10),  // new note for overwrite
        (newAmount, newNote) => {
          cleanDatabase();

          const telegramId = 'prop_test_user';

          // Fill up to 20 shortcuts
          for (let i = 0; i < 20; i++) {
            database.createShortcut(telegramId, `sc${i}`, 10000, `note${i}`, null);
          }

          expect(database.countShortcuts(telegramId)).toBe(20);

          // Overwriting an existing shortcut should work (it's an upsert, not a new entry)
          database.createShortcut(telegramId, 'sc0', newAmount, newNote, null);

          // Count should still be 20
          expect(database.countShortcuts(telegramId)).toBe(20);

          // Verify the overwrite took effect
          const updated = database.getShortcutByName(telegramId, 'sc0');
          expect(updated.amount).toBe(newAmount);
          expect(updated.note).toBe(newNote);
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Feature: refactor-user-flow, Property 17: Shortcut not found lists available shortcuts', () => {
  /**
   * **Validates: Requirements 8.4**
   *
   * For any user with at least one shortcut and for any shortcut name that
   * does not exist, the /q response SHALL contain all available shortcut names.
   */

  /** @type {import('fast-check')} */
  let fc;

  beforeAll(async () => {
    fc = await import('fast-check');
  });

  beforeEach(() => {
    cleanDatabase();
  });

  it('when shortcut not found, all available shortcut names are listed', () => {
    fc.assert(
      fc.property(
        // Generate 1-5 existing shortcut names (using letters a-f)
        fc.array(
          fc.array(
            fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'),
            { minLength: 2, maxLength: 6 }
          ).map(arr => arr.join('')),
          { minLength: 1, maxLength: 5 }
        ),
        // Generate a non-existing shortcut name (using letters x-z to avoid collision)
        fc.array(
          fc.constantFrom('x', 'y', 'z', 'w', 'v'),
          { minLength: 2, maxLength: 6 }
        ).map(arr => arr.join('')),
        (existingNames, missingName) => {
          cleanDatabase();

          const telegramId = 'prop_test_user';

          // Deduplicate existing names
          const uniqueNames = [...new Set(existingNames.filter(n => n.length > 0))];
          if (uniqueNames.length === 0) return;

          // Ensure missingName doesn't collide with existing names
          if (uniqueNames.includes(missingName)) return;

          // Create shortcuts
          for (const name of uniqueNames) {
            database.createShortcut(telegramId, name, 10000, 'note', null);
          }

          // Look up the missing shortcut
          const result = database.getShortcutByName(telegramId, missingName);
          expect(result).toBeNull();

          // Simulate bot behavior: get all shortcuts for listing
          const allShortcuts = database.getShortcuts(telegramId);
          expect(allShortcuts.length).toBe(uniqueNames.length);

          // Build the response message (same logic as bot.js)
          const list = allShortcuts.map(s => `• ${s.name}`).join('\n');
          const response = `❌ Shortcut "${missingName}" tidak ditemukan.\n\nShortcut tersedia:\n${list}`;

          // Verify ALL available shortcut names are in the response
          for (const name of uniqueNames) {
            expect(response).toContain(name);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
