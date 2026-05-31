'use strict';

const { getPeriodRange } = require('../../src/bot');

/**
 * Helper: parse the sqlite date string back to a Date object.
 * toSqliteDate outputs date.toISOString() without 'T' and without ms/Z,
 * so the string is in UTC. We parse it as UTC.
 */
function parseSqliteDate(str) {
  return new Date(str.replace(' ', 'T') + 'Z');
}

/**
 * Helper: get the local day-of-week for a sqlite date string.
 * Since getPeriodRange creates dates in local time and toSqliteDate converts to UTC,
 * we need to convert back to local time to check the day.
 * We do this by creating a Date from the UTC string and getting local day.
 *
 * Actually, since the original date was created as local midnight,
 * we can reconstruct the local date by using the timezone offset.
 */
function getLocalDayOfWeek(sqliteDateStr) {
  // The sqlite date is UTC representation of a local-time date.
  // To get the original local day, create a Date from UTC and get local day.
  const utcDate = parseSqliteDate(sqliteDateStr);
  return utcDate.getDay(); // getDay() returns local day-of-week
}

function getLocalDateParts(sqliteDateStr) {
  const utcDate = parseSqliteDate(sqliteDateStr);
  return {
    year: utcDate.getFullYear(),
    month: utcDate.getMonth(),
    date: utcDate.getDate(),
    hours: utcDate.getHours(),
    minutes: utcDate.getMinutes(),
    seconds: utcDate.getSeconds(),
  };
}

describe('getPeriodRange("weekly") edge cases', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Monday (offset=0)', () => {
    it('start is that Monday at 00:00:00, end is next Monday', () => {
      // Monday, 2024-07-01
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2024, 6, 1, 10, 30, 0)); // July 1, 2024 is a Monday

      const { start, end } = getPeriodRange('weekly');

      // Verify start is Monday (day 1) in local time
      expect(getLocalDayOfWeek(start)).toBe(1);
      // Verify end is also Monday (7 days later)
      expect(getLocalDayOfWeek(end)).toBe(1);

      const startParts = getLocalDateParts(start);
      const endParts = getLocalDateParts(end);

      // Start should be July 1
      expect(startParts.month).toBe(6); // July (0-indexed)
      expect(startParts.date).toBe(1);
      // End should be July 8
      expect(endParts.month).toBe(6);
      expect(endParts.date).toBe(8);

      // Verify start is at midnight (00:00:00)
      expect(startParts.hours).toBe(0);
      expect(startParts.minutes).toBe(0);
      expect(startParts.seconds).toBe(0);

      // Verify range spans exactly 7 days
      const startDate = parseSqliteDate(start);
      const endDate = parseSqliteDate(end);
      const diffMs = endDate.getTime() - startDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(7);
    });
  });

  describe('Sunday (offset=6)', () => {
    it('start is the previous Monday, end is the next day (Monday)', () => {
      // Sunday, 2024-07-07
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2024, 6, 7, 15, 0, 0)); // July 7, 2024 is a Sunday

      const { start, end } = getPeriodRange('weekly');

      // Start should be Monday (day 1)
      expect(getLocalDayOfWeek(start)).toBe(1);
      // End should be Monday (day 1)
      expect(getLocalDayOfWeek(end)).toBe(1);

      const startParts = getLocalDateParts(start);
      const endParts = getLocalDateParts(end);

      // Start should be Monday July 1 (6 days back from Sunday July 7)
      expect(startParts.month).toBe(6);
      expect(startParts.date).toBe(1);
      // End should be Monday July 8
      expect(endParts.month).toBe(6);
      expect(endParts.date).toBe(8);

      // Verify range spans exactly 7 days
      const startDate = parseSqliteDate(start);
      const endDate = parseSqliteDate(end);
      const diffMs = endDate.getTime() - startDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(7);
    });
  });

  describe('Wednesday (mid-week)', () => {
    it('start is the Monday of that week, end is next Monday', () => {
      // Wednesday, 2024-07-03
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2024, 6, 3, 8, 45, 0)); // July 3, 2024 is a Wednesday

      const { start, end } = getPeriodRange('weekly');

      // Start should be Monday (day 1)
      expect(getLocalDayOfWeek(start)).toBe(1);
      // End should be Monday (day 1)
      expect(getLocalDayOfWeek(end)).toBe(1);

      const startParts = getLocalDateParts(start);
      const endParts = getLocalDateParts(end);

      // Start should be Monday July 1
      expect(startParts.month).toBe(6);
      expect(startParts.date).toBe(1);
      // End should be Monday July 8
      expect(endParts.month).toBe(6);
      expect(endParts.date).toBe(8);

      // Verify range spans exactly 7 days
      const startDate = parseSqliteDate(start);
      const endDate = parseSqliteDate(end);
      const diffMs = endDate.getTime() - startDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(7);
    });
  });

  describe('start is always at midnight (00:00:00)', () => {
    it('start time is 00:00:00 regardless of current time of day', () => {
      // Thursday, 2024-07-04 at 23:59:59
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2024, 6, 4, 23, 59, 59));

      const { start } = getPeriodRange('weekly');

      const startParts = getLocalDateParts(start);
      expect(startParts.hours).toBe(0);
      expect(startParts.minutes).toBe(0);
      expect(startParts.seconds).toBe(0);
    });
  });

  describe('range always spans exactly 7 days', () => {
    it('Saturday yields a 7-day range', () => {
      // Saturday, 2024-07-06
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2024, 6, 6, 12, 0, 0)); // July 6, 2024 is a Saturday

      const { start, end } = getPeriodRange('weekly');

      const startDate = parseSqliteDate(start);
      const endDate = parseSqliteDate(end);
      const diffMs = endDate.getTime() - startDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(7);
    });

    it('Tuesday yields a 7-day range', () => {
      // Tuesday, 2024-07-02
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2024, 6, 2, 6, 0, 0)); // July 2, 2024 is a Tuesday

      const { start, end } = getPeriodRange('weekly');

      const startDate = parseSqliteDate(start);
      const endDate = parseSqliteDate(end);
      const diffMs = endDate.getTime() - startDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(7);
    });
  });
});
