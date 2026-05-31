'use strict';

const { getPeriodLabel, PERIOD_LABELS } = require('../../src/formatter');

describe('getPeriodLabel', () => {
  it('returns "hari" for daily', () => {
    expect(getPeriodLabel('daily')).toBe('hari');
  });

  it('returns "minggu" for weekly', () => {
    expect(getPeriodLabel('weekly')).toBe('minggu');
  });

  it('returns "bulan" for monthly', () => {
    expect(getPeriodLabel('monthly')).toBe('bulan');
  });

  it('returns "tahun" for yearly', () => {
    expect(getPeriodLabel('yearly')).toBe('tahun');
  });

  it('returns the period string itself for unknown period (fallback)', () => {
    expect(getPeriodLabel('unknown')).toBe('unknown');
    expect(getPeriodLabel('hourly')).toBe('hourly');
  });
});

describe('PERIOD_LABELS', () => {
  it('has all 4 period entries', () => {
    expect(Object.keys(PERIOD_LABELS)).toHaveLength(4);
    expect(PERIOD_LABELS).toHaveProperty('daily', 'hari');
    expect(PERIOD_LABELS).toHaveProperty('weekly', 'minggu');
    expect(PERIOD_LABELS).toHaveProperty('monthly', 'bulan');
    expect(PERIOD_LABELS).toHaveProperty('yearly', 'tahun');
  });
});
