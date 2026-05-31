'use strict';

/**
 * Property-based tests for weekly range calculation (Property 1).
 * Feature: weekly-period-copywriting
 *
 * Tests validate that for any date, getPeriodRange('weekly') always
 * starts on Monday and spans exactly 7 days, with the input date
 * falling within the range.
 */

const { getPeriodRange } = require('../../src/bot');

describe('Feature: weekly-period-copywriting, Property 1: Weekly Range Always Starts on Monday', () => {
  /**
   * **Validates: Requirements 2.1, 2.2, 2.3**
   *
   * FOR ALL dates d:
   *   getPeriodRange('weekly') computed on date d
   *   => start.getDay() === 1 (Monday)
   *   AND end === start + 7 days
   *   AND start <= d < end
   */

  /** @type {import('fast-check')} */
  let fc;

  beforeAll(async () => {
    fc = await import('fast-check');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('weekly range start is always Monday and range spans exactly 7 days', () => {
    fc.assert(
      fc.property(
        // Generate arbitrary timestamps in a reasonable range (2020-01-01 to 2030-12-31)
        fc.integer({
          min: new Date(2020, 0, 1).getTime(),
          max: new Date(2030, 11, 31).getTime(),
        }),
        (timestamp) => {
          const arbitraryDate = new Date(timestamp);

          // Set fake timer to the arbitrary date
          vi.useFakeTimers();
          vi.setSystemTime(arbitraryDate);

          const result = getPeriodRange('weekly');

          vi.useRealTimers();

          // getPeriodRange constructs local-time dates and then calls toSqliteDate
          // which uses toISOString() (UTC). To verify the properties, we reconstruct
          // the local-time dates that were used internally.

          const dayOfWeek = arbitraryDate.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
          const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

          // Expected start: Monday of the week containing arbitraryDate (local time, midnight)
          const expectedStart = new Date(
            arbitraryDate.getFullYear(),
            arbitraryDate.getMonth(),
            arbitraryDate.getDate() - mondayOffset
          );

          // Expected end: start + 7 days
          const expectedEnd = new Date(
            expectedStart.getFullYear(),
            expectedStart.getMonth(),
            expectedStart.getDate() + 7
          );

          // Verify start is Monday (local time)
          expect(expectedStart.getDay()).toBe(1);

          // Verify the returned sqlite date strings match expected dates
          // toSqliteDate format: "YYYY-MM-DD HH:MM:SS" (UTC via toISOString)
          const expectedStartStr = expectedStart.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
          const expectedEndStr = expectedEnd.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

          expect(result.start).toBe(expectedStartStr);
          expect(result.end).toBe(expectedEndStr);

          // Verify the span is exactly 7 days (604800000 ms)
          const startMs = expectedStart.getTime();
          const endMs = expectedEnd.getTime();
          expect(endMs - startMs).toBe(7 * 24 * 60 * 60 * 1000);

          // Verify start <= arbitraryDate < end (in local date terms)
          const dateOnly = new Date(
            arbitraryDate.getFullYear(),
            arbitraryDate.getMonth(),
            arbitraryDate.getDate()
          );
          expect(startMs).toBeLessThanOrEqual(dateOnly.getTime());
          expect(dateOnly.getTime()).toBeLessThan(endMs);
        }
      ),
      { numRuns: 200 }
    );
  });
});
