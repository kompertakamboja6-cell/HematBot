/**
 * Property-Based Tests for onboarding.js
 * Feature: refactor-user-flow, Property 18: Onboarding limit validation
 * Validates: Requirements 1.4
 */

const { validateLimit, handleLimitSet, MIN_LIMIT, MAX_LIMIT } = require('../../src/onboarding');

describe('Feature: refactor-user-flow, Property 18: Onboarding limit validation', () => {
  it('non-numeric inputs produce error with rejection reason and format example', async () => {
    const fc = await import('fast-check');

    // Generator for non-numeric values
    const nonNumericArb = fc.oneof(
      fc.string(),                          // arbitrary strings
      fc.constant(null),                    // null
      fc.constant(undefined),               // undefined
      fc.dictionary(fc.string(), fc.string()), // objects
      fc.array(fc.anything()),              // arrays
      fc.boolean(),                         // booleans
      fc.constant(NaN),                     // NaN
      fc.constant(Infinity),               // Infinity
      fc.constant(-Infinity)               // -Infinity
    ).filter(v => typeof v !== 'number' || isNaN(v));

    await fc.assert(
      fc.asyncProperty(nonNumericArb, async (input) => {
        const result = validateLimit(input);

        // Should be invalid
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();

        // Error should state rejection reason (format tidak valid)
        expect(result.error).toMatch(/format tidak valid|tidak valid/i);

        // Error should include a format example like /limit 50000
        expect(result.error).toMatch(/\/limit\s+\d+/);
      }),
      { numRuns: 100 }
    );
  });

  it('numbers below MIN_LIMIT produce error with rejection reason and format example', async () => {
    const fc = await import('fast-check');

    // Numbers below MIN_LIMIT (1000)
    const belowMinArb = fc.oneof(
      fc.integer({ min: -1000000, max: MIN_LIMIT - 1 }),
      fc.double({ min: -1000000, max: MIN_LIMIT - 0.001, noNaN: true, noDefaultInfinity: true })
    );

    await fc.assert(
      fc.asyncProperty(belowMinArb, async (input) => {
        const result = validateLimit(input);

        // Should be invalid
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();

        // Error should state rejection reason (di luar rentang)
        expect(result.error).toMatch(/di luar rentang|rentang/i);

        // Error should include a format example like /limit 50000
        expect(result.error).toMatch(/\/limit\s+\d+/);
      }),
      { numRuns: 100 }
    );
  });

  it('numbers above MAX_LIMIT produce error with rejection reason and format example', async () => {
    const fc = await import('fast-check');

    // Numbers above MAX_LIMIT (10000000)
    const aboveMaxArb = fc.oneof(
      fc.integer({ min: MAX_LIMIT + 1, max: 100000000 }),
      fc.double({ min: MAX_LIMIT + 0.001, max: 100000000, noNaN: true, noDefaultInfinity: true })
    );

    await fc.assert(
      fc.asyncProperty(aboveMaxArb, async (input) => {
        const result = validateLimit(input);

        // Should be invalid
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();

        // Error should state rejection reason (di luar rentang)
        expect(result.error).toMatch(/di luar rentang|rentang/i);

        // Error should include a format example like /limit 50000
        expect(result.error).toMatch(/\/limit\s+\d+/);
      }),
      { numRuns: 100 }
    );
  });

  it('NaN and Infinity produce error with rejection reason and format example', async () => {
    const fc = await import('fast-check');

    const specialNumericArb = fc.oneof(
      fc.constant(NaN),
      fc.constant(Infinity),
      fc.constant(-Infinity)
    );

    await fc.assert(
      fc.asyncProperty(specialNumericArb, async (input) => {
        const result = validateLimit(input);

        // Should be invalid
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();

        // Error should state rejection reason:
        // NaN → "format tidak valid", Infinity/-Infinity → "di luar rentang"
        expect(result.error).toMatch(/format tidak valid|di luar rentang/i);

        // Error should include a format example like /limit 50000
        expect(result.error).toMatch(/\/limit\s+\d+/);
      }),
      { numRuns: 100 }
    );
  });
});
