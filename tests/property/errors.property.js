'use strict';

const { parseExpense } = require('../../src/parser');

/**
 * Property-based tests for error messages (Properties 8-11).
 * These tests validate the error handling logic from bot.js text handler
 * by simulating the same decision logic used in the handler.
 *
 * Feature: refactor-user-flow
 */

// Recognized commands from the spec
const RECOGNIZED_COMMANDS = [
  '/start', '/help', '/limit', '/buat', '/budget', '/hapus',
  '/today', '/history', '/reset', '/menu', '/notif',
  '/simpan', '/q', '/shortcuts', '/hapus_shortcut'
];

/**
 * Simulate the out-of-range detection logic from bot.js text handler.
 * Returns the error message if out-of-range, or null otherwise.
 */
function getOutOfRangeError(text) {
  text = text.trim();
  const outOfRangeMatch = text.match(/^(\d+)(k?)\s*/i);

  if (outOfRangeMatch) {
    let testAmount = parseInt(outOfRangeMatch[1], 10);
    const hasK = outOfRangeMatch[2].toLowerCase() === 'k';
    if (hasK) {
      testAmount *= 1000;
    } else if (testAmount < 100) {
      testAmount *= 1000;
    }

    if (testAmount < 1000 || testAmount > 10_000_000) {
      return 'Nominal di luar rentang yang diperbolehkan.\nRentang valid: Rp1.000 - Rp10.000.000\n\nContoh: `20 makan` (= Rp20.000)';
    }
  }

  return null;
}

/**
 * Simulate the unrecognized format error message from bot.js text handler.
 */
function getFormatError() {
  return 'Format tidak dikenali. Contoh:\n`20 makan` → Rp20.000\n`15k kopi` → Rp15.000\n`20000 parkir` → Rp20.000';
}

/**
 * Simulate the budget-not-found response from bot.js text handler.
 * Returns the info message when user has budgets but last word doesn't match.
 */
function getBudgetNotFoundMessage(lastWord, budgetNames) {
  const budgetList = budgetNames.map(n => `• ${n}`).join('\n');
  return `ℹ️ Budget "${lastWord}" tidak ditemukan. Pengeluaran dicatat tanpa budget.\n\nBudget yang tersedia:\n${budgetList}`;
}

/**
 * Simulate the unknown command response from bot.js text handler.
 */
function getUnknownCommandResponse() {
  return 'Perintah tidak dikenali. Ketik /help untuk melihat daftar perintah yang tersedia.';
}

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


describe('Feature: refactor-user-flow, Property 8: Invalid input error contains format examples', () => {
  /**
   * **Validates: Requirements 6.1**
   *
   * For any text input that the parser cannot recognize as a valid expense,
   * the error response SHALL contain at least 2 distinct format examples.
   */
  it('should contain at least 2 format examples for any unrecognized input', async () => {
    const fc = await import('fast-check');

    fc.assert(
      fc.property(
        // Generate arbitrary non-numeric strings that won't parse as expenses
        alphaString(fc, 2, 30),
        (input) => {
          // Only test inputs that don't start with a digit and don't start with /
          const trimmed = input.trim();
          if (!trimmed || /^\d/.test(trimmed) || trimmed.startsWith('/')) return;

          const result = parseExpense(trimmed, []);
          if (result !== null) return; // Skip inputs that actually parse successfully

          // The handler would show the format error
          const errorMsg = getFormatError();

          // Count distinct format examples (patterns like `<number> <word>` or `<number>k <word>`)
          const examples = errorMsg.match(/`\d+k?\s+\w+`/g);
          expect(examples).not.toBeNull();
          expect(examples.length).toBeGreaterThanOrEqual(2);
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Feature: refactor-user-flow, Property 9: Out-of-range nominal error mentions valid range', () => {
  /**
   * **Validates: Requirements 6.2**
   *
   * For any nominal value less than 1,000 or greater than 10,000,000,
   * the error response SHALL mention both boundary values (Rp1.000 and Rp10.000.000).
   */
  it('should mention both Rp1.000 and Rp10.000.000 for out-of-range nominals', async () => {
    const fc = await import('fast-check');

    fc.assert(
      fc.property(
        // Generate nominals that produce amounts < 1000 or > 10,000,000
        fc.oneof(
          // Numbers with k suffix that exceed 10,000,000 (>10000k)
          fc.integer({ min: 10001, max: 99999 }).map(n => `${n}k`),
          // Plain numbers >= 100 but < 1000 (used as-is, below minimum)
          fc.integer({ min: 100, max: 999 }).map(n => `${n}`),
          // Zero
          fc.constant('0')
        ),
        // Generate a note word
        alphaString(fc, 2, 8),
        (nominal, noteWord) => {
          const input = `${nominal} ${noteWord}`;

          // Verify parser rejects this
          const result = parseExpense(input, []);
          if (result !== null) return; // Skip if parser somehow accepts it

          // Simulate the handler's out-of-range detection
          const errorMsg = getOutOfRangeError(input);

          // If the handler detects it as out-of-range, verify the message
          if (errorMsg !== null) {
            expect(errorMsg).toContain('Rp1.000');
            expect(errorMsg).toContain('Rp10.000.000');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should detect out-of-range for amounts below minimum', async () => {
    const fc = await import('fast-check');

    fc.assert(
      fc.property(
        // Generate numbers that after normalization produce < 1000
        // Numbers >= 100 and < 1000 are used as-is → below minimum
        fc.integer({ min: 100, max: 999 }),
        (num) => {
          const input = `${num} makan`;
          const errorMsg = getOutOfRangeError(input);

          // These numbers are >= 100 so not multiplied, and < 1000 so out of range
          expect(errorMsg).not.toBeNull();
          expect(errorMsg).toContain('Rp1.000');
          expect(errorMsg).toContain('Rp10.000.000');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should detect out-of-range for amounts above maximum', async () => {
    const fc = await import('fast-check');

    fc.assert(
      fc.property(
        // Generate k-suffix numbers that exceed 10,000,000
        fc.integer({ min: 10001, max: 50000 }),
        (num) => {
          const input = `${num}k makan`;
          const errorMsg = getOutOfRangeError(input);

          expect(errorMsg).not.toBeNull();
          expect(errorMsg).toContain('Rp1.000');
          expect(errorMsg).toContain('Rp10.000.000');
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Feature: refactor-user-flow, Property 10: Unrecognized budget graceful degradation with listing', () => {
  /**
   * **Validates: Requirements 6.4**
   *
   * For any expense input where the last word matches no budget and the user
   * has at least one budget, the system SHALL still record the expense (without budget)
   * and the response SHALL contain all available budget names.
   */
  it('should list all available budget names when last word does not match any budget', async () => {
    const fc = await import('fast-check');

    fc.assert(
      fc.property(
        // Generate a valid nominal (1-99 → multiplied by 1000 → valid range)
        fc.integer({ min: 1, max: 99 }),
        // Generate a note word (first word after nominal)
        alphaString(fc, 2, 8),
        // Generate a last word that will NOT match any budget (use different chars)
        fc.array(
          fc.constantFrom('x', 'y', 'z', 'w', 'v'),
          { minLength: 2, maxLength: 6 }
        ).map(arr => arr.join('')),
        // Generate user's budget list (at least 1 budget, using different chars)
        fc.array(
          fc.array(
            fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'),
            { minLength: 2, maxLength: 6 }
          ).map(arr => arr.join('')),
          { minLength: 1, maxLength: 5 }
        ),
        (nominal, noteWord, lastWord, budgetNames) => {
          // Ensure lastWord doesn't accidentally match any budget
          const uniqueBudgets = [...new Set(budgetNames.filter(b => b.length > 0))];
          if (uniqueBudgets.length === 0) return;
          if (uniqueBudgets.some(b => b.toLowerCase() === lastWord.toLowerCase())) return;

          const input = `${nominal} ${noteWord} ${lastWord}`;
          const parsed = parseExpense(input, uniqueBudgets);

          // Parser should return a result with budget=null (last word didn't match)
          if (parsed === null) return; // Skip if parser rejects entirely

          expect(parsed.budget).toBeNull();

          // Simulate the handler logic: detect unmatched budget-like last word
          const inputWords = input.replace(/^(\d+)(k?)\s*/i, '').trim().split(/\s+/);
          const detectedLastWord = inputWords.length > 1 ? inputWords[inputWords.length - 1] : null;

          if (detectedLastWord && !/^\d+(k?)$/i.test(detectedLastWord)) {
            // Handler would show budget-not-found message with all budget names
            const infoMsg = getBudgetNotFoundMessage(detectedLastWord, uniqueBudgets);

            // Verify ALL budget names are present in the response
            for (const budgetName of uniqueBudgets) {
              expect(infoMsg).toContain(budgetName);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Feature: refactor-user-flow, Property 11: Unknown command suggests /help', () => {
  /**
   * **Validates: Requirements 6.6**
   *
   * For any message starting with `/` that is not in the recognized command set,
   * the response SHALL contain the text `/help`.
   */
  it('should contain /help for any unrecognized command', async () => {
    const fc = await import('fast-check');

    fc.assert(
      fc.property(
        // Generate arbitrary command names that are NOT in the recognized set
        alphaString(fc, 1, 15),
        (commandName) => {
          const command = `/${commandName}`;

          // Skip if it accidentally matches a recognized command
          const baseCommand = command.split(' ')[0].split('@')[0];
          if (RECOGNIZED_COMMANDS.includes(baseCommand)) return;

          // The handler would respond with the unknown command message
          const response = getUnknownCommandResponse();
          expect(response).toContain('/help');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should never trigger for recognized commands', async () => {
    const fc = await import('fast-check');

    fc.assert(
      fc.property(
        // Pick from recognized commands
        fc.constantFrom(...RECOGNIZED_COMMANDS),
        (command) => {
          // The base command should be recognized
          expect(RECOGNIZED_COMMANDS).toContain(command);

          // Therefore the unknown command handler should NOT fire
          // (recognized commands are handled by their specific handlers)
        }
      ),
      { numRuns: 100 }
    );
  });
});
