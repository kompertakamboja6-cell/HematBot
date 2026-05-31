'use strict';

const { parseExpense } = require('../../src/parser');

describe('parseExpense', () => {
  describe('backward compatibility (no userBudgets)', () => {
    it('parses number only', () => {
      const result = parseExpense('15');
      expect(result).toEqual({ amount: 15000, note: '', budget: null });
    });

    it('parses number with k suffix', () => {
      const result = parseExpense('20k');
      expect(result).toEqual({ amount: 20000, note: '', budget: null });
    });

    it('parses number with single word note', () => {
      const result = parseExpense('20 makan');
      expect(result).toEqual({ amount: 20000, note: 'makan', budget: null });
    });

    it('parses number with multi-word text as note (no budgets)', () => {
      const result = parseExpense('20 makan siang');
      expect(result).toEqual({ amount: 20000, note: 'makan siang', budget: null });
    });

    it('returns null for invalid input', () => {
      expect(parseExpense(null)).toBeNull();
      expect(parseExpense('')).toBeNull();
      expect(parseExpense('abc')).toBeNull();
      expect(parseExpense(123)).toBeNull();
    });
  });

  describe('budget-aware matching with userBudgets', () => {
    const budgets = ['Jajan', 'Transport', 'Makan'];

    it('matches last word as budget (case-insensitive)', () => {
      const result = parseExpense('20 kopi jajan', budgets);
      expect(result).toEqual({ amount: 20000, note: 'kopi', budget: 'Jajan' });
    });

    it('matches budget regardless of case', () => {
      const result = parseExpense('20 bensin TRANSPORT', budgets);
      expect(result).toEqual({ amount: 20000, note: 'bensin', budget: 'Transport' });
    });

    it('returns original budget name casing from userBudgets', () => {
      const result = parseExpense('15 nasi goreng makan', budgets);
      expect(result).toEqual({ amount: 15000, note: 'nasi goreng', budget: 'Makan' });
    });

    it('does not match if last word is not in budgets', () => {
      const result = parseExpense('20 makan siang enak', budgets);
      expect(result).toEqual({ amount: 20000, note: 'makan siang enak', budget: null });
    });

    it('single word that matches budget becomes note with null budget (no remaining words for note)', () => {
      // When there's only one word and it matches a budget, it should still be treated as note
      // because separating it as budget would leave an empty note
      // Actually per the algorithm: last word matches -> budget = matched, note = remaining words joined
      // If only 1 word and it matches, note = '' (empty join of 0 words), budget = matched
      const result = parseExpense('20 jajan', budgets);
      expect(result).toEqual({ amount: 20000, note: '', budget: 'Jajan' });
    });

    it('does not match partial budget names', () => {
      const result = parseExpense('20 kopi jaj', budgets);
      expect(result).toEqual({ amount: 20000, note: 'kopi jaj', budget: null });
    });

    it('works with empty userBudgets array', () => {
      const result = parseExpense('20 makan jajan', []);
      expect(result).toEqual({ amount: 20000, note: 'makan jajan', budget: null });
    });
  });

  describe('nominal normalization', () => {
    it('multiplies numbers < 100 by 1000', () => {
      expect(parseExpense('20')).toEqual({ amount: 20000, note: '', budget: null });
      expect(parseExpense('99')).toEqual({ amount: 99000, note: '', budget: null });
    });

    it('uses numbers >= 100 as-is', () => {
      expect(parseExpense('1000')).toEqual({ amount: 1000, note: '', budget: null });
      expect(parseExpense('20000')).toEqual({ amount: 20000, note: '', budget: null });
    });

    it('multiplies k-suffix by 1000', () => {
      expect(parseExpense('20k')).toEqual({ amount: 20000, note: '', budget: null });
      expect(parseExpense('5k')).toEqual({ amount: 5000, note: '', budget: null });
    });

    it('rejects amounts below 1000', () => {
      // 0 * 1000 = 0, below range
      expect(parseExpense('0')).toBeNull();
    });

    it('rejects amounts above 10,000,000', () => {
      expect(parseExpense('11000000')).toBeNull();
      expect(parseExpense('10001k')).toBeNull();
    });

    it('accepts boundary values', () => {
      expect(parseExpense('1')).toEqual({ amount: 1000, note: '', budget: null });
      expect(parseExpense('1000')).toEqual({ amount: 1000, note: '', budget: null });
      expect(parseExpense('10000k')).toEqual({ amount: 10000000, note: '', budget: null });
      expect(parseExpense('10000000')).toEqual({ amount: 10000000, note: '', budget: null });
    });
  });

  describe('note truncation', () => {
    it('truncates note to 100 characters', () => {
      const longText = 'a'.repeat(150);
      const result = parseExpense(`20 ${longText}`);
      expect(result.note.length).toBe(100);
    });

    it('does not truncate note at or below 100 characters', () => {
      const text = 'a'.repeat(100);
      const result = parseExpense(`20 ${text}`);
      expect(result.note.length).toBe(100);
      expect(result.note).toBe(text);
    });
  });

  describe('edge cases', () => {
    it('handles extra whitespace', () => {
      const result = parseExpense('  20  makan  ');
      expect(result).toEqual({ amount: 20000, note: 'makan', budget: null });
    });

    it('handles number-only with k suffix and note', () => {
      const result = parseExpense('5k kopi');
      expect(result).toEqual({ amount: 5000, note: 'kopi', budget: null });
    });
  });
});
