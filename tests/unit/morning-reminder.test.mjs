import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/quotes.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getQuotePool: vi.fn(() => actual.getQuotePool()),
  };
});

import { checkAndSendMorning, resetState } from '../../src/scheduler.js';
import { getQuotePool } from '../../src/quotes.js';

describe('debug scheduler import', () => {
  it('scheduler imports work', () => {
    console.log('checkAndSendMorning:', typeof checkAndSendMorning);
    console.log('getQuotePool isMock:', vi.isMockFunction(getQuotePool));
    expect(typeof checkAndSendMorning).toBe('function');
  });
});
