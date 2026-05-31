'use strict';

const {
  createConfirmation,
  resolveConfirmation,
  isValid,
  getPendingCount,
  clearAll,
} = require('../../src/confirmation');

describe('confirmation.js', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAll();
  });

  afterEach(() => {
    clearAll();
    vi.useRealTimers();
  });

  describe('createConfirmation', () => {
    it('returns a unique confirmationId string', () => {
      const id1 = createConfirmation('user1', 'reset', {}, 60);
      const id2 = createConfirmation('user1', 'reset', {}, 60);
      expect(typeof id1).toBe('string');
      expect(typeof id2).toBe('string');
      expect(id1).not.toBe(id2);
    });

    it('stores the confirmation in the pending map', () => {
      expect(getPendingCount()).toBe(0);
      createConfirmation('user1', 'reset', { count: 5 }, 60);
      expect(getPendingCount()).toBe(1);
    });

    it('supports all valid actions', () => {
      const id1 = createConfirmation('user1', 'reset', {}, 60);
      const id2 = createConfirmation('user1', 'delete_budget', { name: 'jajan' }, 60);
      const id3 = createConfirmation('user1', 'undo', { expenseId: 42 }, 30);
      expect(isValid(id1)).toBe(true);
      expect(isValid(id2)).toBe(true);
      expect(isValid(id3)).toBe(true);
    });
  });

  describe('resolveConfirmation', () => {
    it('returns confirmation data when confirmed within TTL', () => {
      const id = createConfirmation('user1', 'reset', { count: 3 }, 60);
      const result = resolveConfirmation(id, true);
      expect(result).toEqual({
        telegramId: 'user1',
        action: 'reset',
        data: { count: 3 },
        confirmed: true,
      });
    });

    it('returns confirmation data when cancelled within TTL', () => {
      const id = createConfirmation('user1', 'delete_budget', { name: 'jajan' }, 60);
      const result = resolveConfirmation(id, false);
      expect(result).toEqual({
        telegramId: 'user1',
        action: 'delete_budget',
        data: { name: 'jajan' },
        confirmed: false,
      });
    });

    it('returns null for non-existent confirmationId', () => {
      const result = resolveConfirmation('non-existent-id', true);
      expect(result).toBeNull();
    });

    it('returns null after TTL has expired', () => {
      const id = createConfirmation('user1', 'undo', { expenseId: 1 }, 30);
      vi.advanceTimersByTime(30000); // advance 30 seconds
      const result = resolveConfirmation(id, true);
      expect(result).toBeNull();
    });

    it('removes the confirmation from the map after resolving', () => {
      const id = createConfirmation('user1', 'reset', {}, 60);
      expect(getPendingCount()).toBe(1);
      resolveConfirmation(id, true);
      expect(getPendingCount()).toBe(0);
    });

    it('cannot resolve the same confirmation twice', () => {
      const id = createConfirmation('user1', 'reset', {}, 60);
      const first = resolveConfirmation(id, true);
      const second = resolveConfirmation(id, true);
      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });
  });

  describe('isValid', () => {
    it('returns true for a fresh confirmation', () => {
      const id = createConfirmation('user1', 'reset', {}, 60);
      expect(isValid(id)).toBe(true);
    });

    it('returns true just before TTL expires', () => {
      const id = createConfirmation('user1', 'reset', {}, 60);
      vi.advanceTimersByTime(59999);
      expect(isValid(id)).toBe(true);
    });

    it('returns false after TTL expires', () => {
      const id = createConfirmation('user1', 'reset', {}, 60);
      vi.advanceTimersByTime(60000);
      expect(isValid(id)).toBe(false);
    });

    it('returns false for non-existent confirmationId', () => {
      expect(isValid('does-not-exist')).toBe(false);
    });

    it('returns false after confirmation has been resolved', () => {
      const id = createConfirmation('user1', 'reset', {}, 60);
      resolveConfirmation(id, true);
      expect(isValid(id)).toBe(false);
    });
  });

  describe('auto-cleanup via setTimeout', () => {
    it('removes confirmation from map when TTL expires', () => {
      createConfirmation('user1', 'reset', {}, 10);
      expect(getPendingCount()).toBe(1);
      vi.advanceTimersByTime(10000);
      expect(getPendingCount()).toBe(0);
    });

    it('handles multiple confirmations with different TTLs', () => {
      createConfirmation('user1', 'undo', {}, 30);
      createConfirmation('user2', 'reset', {}, 60);
      expect(getPendingCount()).toBe(2);

      vi.advanceTimersByTime(30000);
      expect(getPendingCount()).toBe(1);

      vi.advanceTimersByTime(30000);
      expect(getPendingCount()).toBe(0);
    });
  });

  describe('clearAll', () => {
    it('removes all pending confirmations', () => {
      createConfirmation('user1', 'reset', {}, 60);
      createConfirmation('user2', 'undo', {}, 30);
      expect(getPendingCount()).toBe(2);
      clearAll();
      expect(getPendingCount()).toBe(0);
    });
  });
});
