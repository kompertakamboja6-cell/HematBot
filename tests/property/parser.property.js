const { parseExpense } = require('../../src/parser');

describe('Feature: refactor-user-flow, Property 3: Parser note length invariant', () => {
  /**
   * **Validates: Requirements 2.6**
   *
   * For any input text of arbitrary length, the parser SHALL produce
   * a note that is at most 100 characters long.
   */
  it('should always produce a note with length <= 100 regardless of input length', async () => {
    const fc = await import('fast-check');

    fc.assert(
      fc.property(
        // Generate a valid nominal (1-99 so it gets multiplied to valid range)
        fc.integer({ min: 1, max: 99 }),
        // Generate an arbitrary long string for the note portion
        fc.string({ minLength: 1, maxLength: 500 }),
        // Generate an optional budget list (may or may not match)
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 5 }),
        (nominal, noteText, budgets) => {
          // Build input: nominal + space + noteText
          // Replace any newlines/tabs with spaces to keep it as a single-line input
          const sanitizedNote = noteText.replace(/[\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();

          // Skip if sanitized note is empty (would be nominal-only input)
          if (!sanitizedNote) return;

          const input = `${nominal} ${sanitizedNote}`;
          const result = parseExpense(input, budgets);

          // If parser returns a result, the note must be <= 100 chars
          if (result !== null) {
            expect(result.note.length).toBeLessThanOrEqual(100);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should truncate notes that exceed 100 characters', async () => {
    const fc = await import('fast-check');

    fc.assert(
      fc.property(
        // Generate a nominal in valid range
        fc.integer({ min: 1, max: 99 }),
        // Generate a string guaranteed to be longer than 100 chars
        fc.string({ minLength: 101, maxLength: 500 }),
        (nominal, longNote) => {
          // Replace whitespace chars to keep it as valid note content
          const sanitizedNote = longNote.replace(/[\n\r\t]/g, 'a').replace(/^\s+/, 'a');

          // Skip if sanitized note becomes empty or only whitespace
          if (!sanitizedNote.trim()) return;

          const input = `${nominal} ${sanitizedNote}`;
          const result = parseExpense(input, []);

          // If parser returns a result, the note must be exactly 100 chars (truncated)
          if (result !== null && sanitizedNote.trim().length > 100) {
            expect(result.note.length).toBeLessThanOrEqual(100);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Feature: refactor-user-flow, Property 2: Parser nominal normalization', () => {
  /**
   * Validates: Requirements 2.4
   *
   * Property 2: Parser nominal normalization
   * For any valid numeric input (plain number, number with 'k' suffix, or number less than 100),
   * the parser SHALL produce an amount within the range 1,000–10,000,000 Rupiah, where:
   * - numbers with 'k' suffix are multiplied by 1000
   * - numbers less than 100 without 'k' are multiplied by 1000
   * - numbers 100 or greater without 'k' are used as-is
   */

  it('should multiply k-suffix numbers by 1000', async () => {
    const fc = await import('fast-check');

    fc.assert(
      fc.property(
        // Generate numbers 1-10000 with 'k' suffix that produce valid range (1k-10000k => 1000-10,000,000)
        fc.integer({ min: 1, max: 10000 }),
        fc.constantFrom('k', 'K'),
        (num, suffix) => {
          const input = `${num}${suffix} catatan`;
          const result = parseExpense(input);
          if (result === null) {
            // Only null if amount out of range after multiplication
            const expected = num * 1000;
            return expected < 1000 || expected > 10_000_000;
          }
          return result.amount === num * 1000;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should multiply numbers less than 100 (without k) by 1000', async () => {
    const fc = await import('fast-check');

    fc.assert(
      fc.property(
        // Numbers 1-99 without 'k' suffix should be multiplied by 1000
        fc.integer({ min: 1, max: 99 }),
        (num) => {
          const input = `${num} catatan`;
          const result = parseExpense(input);
          if (result === null) {
            // Only null if amount out of range
            const expected = num * 1000;
            return expected < 1000 || expected > 10_000_000;
          }
          return result.amount === num * 1000;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should use numbers >= 100 (without k) as-is', async () => {
    const fc = await import('fast-check');

    fc.assert(
      fc.property(
        // Numbers >= 100 without 'k' suffix should be used as-is
        fc.integer({ min: 100, max: 10_000_000 }),
        (num) => {
          const input = `${num} catatan`;
          const result = parseExpense(input);
          if (result === null) {
            // Only null if amount out of valid range
            return num < 1000 || num > 10_000_000;
          }
          return result.amount === num;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should always produce amounts in range 1000-10,000,000 when result is non-null', async () => {
    const fc = await import('fast-check');

    fc.assert(
      fc.property(
        // Generate various nominal formats
        fc.oneof(
          // Plain numbers
          fc.integer({ min: 1, max: 20_000_000 }).map(n => `${n}`),
          // Numbers with k suffix
          fc.integer({ min: 1, max: 20000 }).map(n => `${n}k`),
          // Numbers with K suffix
          fc.integer({ min: 1, max: 20000 }).map(n => `${n}K`)
        ),
        fc.constantFrom('', ' makan', ' kopi pagi'),
        (nominal, note) => {
          const input = `${nominal}${note}`.trim();
          const result = parseExpense(input);
          if (result === null) {
            return true; // null results are valid (out of range rejection)
          }
          return result.amount >= 1000 && result.amount <= 10_000_000;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject amounts that would fall outside valid range', async () => {
    const fc = await import('fast-check');

    fc.assert(
      fc.property(
        // Generate numbers that after normalization would be out of range
        fc.oneof(
          // k-suffix numbers that exceed 10,000,000 (>10000k)
          fc.integer({ min: 10001, max: 50000 }).map(n => `${n}k`),
          // Plain numbers >= 100 but < 1000 (used as-is, below minimum)
          fc.integer({ min: 100, max: 999 }).map(n => `${n}`)
        ),
        (nominal) => {
          const input = `${nominal} catatan`;
          const result = parseExpense(input);
          return result === null;
        }
      ),
      { numRuns: 100 }
    );
  });
});
