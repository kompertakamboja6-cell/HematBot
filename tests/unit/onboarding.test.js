'use strict';

const {
  needsOnboarding,
  getWelcomeStep,
  handleLimitSet,
  handleBudgetStep,
  validateLimit,
  MIN_LIMIT,
  MAX_LIMIT,
} = require('../../src/onboarding');

const database = require('../../src/database');

describe('onboarding.js', () => {
  beforeEach(() => {
    // Clean up test data before each test (order matters for FK constraints)
    const db = database.getDatabase();
    db.exec('DELETE FROM shortcuts');
    db.exec('DELETE FROM expenses');
    db.exec('DELETE FROM budgets');
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DELETE FROM users');
    db.exec('PRAGMA foreign_keys = ON');
  });

  describe('needsOnboarding', () => {
    it('returns true for null user', () => {
      expect(needsOnboarding(null)).toBe(true);
    });

    it('returns true for undefined user', () => {
      expect(needsOnboarding(undefined)).toBe(true);
    });

    it('returns true for user with onboarding_complete !== 1', () => {
      expect(needsOnboarding({ onboarding_complete: 0 })).toBe(true);
      expect(needsOnboarding({ onboarding_complete: null })).toBe(true);
      expect(needsOnboarding({})).toBe(true);
    });

    it('returns false for user with onboarding_complete === 1', () => {
      expect(needsOnboarding({ onboarding_complete: 1 })).toBe(false);
    });
  });

  describe('getWelcomeStep', () => {
    it('returns text with greeting that includes firstName', () => {
      const result = getWelcomeStep('123', 'Budi');
      expect(result.text).toContain('Halo Budi');
    });

    it('returns generic greeting when firstName is empty', () => {
      const result = getWelcomeStep('123', '');
      expect(result.text).toContain('Halo!');
      expect(result.text).not.toContain('Halo !');
    });

    it('welcome message before instructions is max 300 characters', () => {
      const result = getWelcomeStep('123', 'Budi');
      // The welcome portion is before the instruction block (starts with "Yuk mulai")
      const instructionStart = result.text.indexOf('Yuk mulai');
      const welcomePart = result.text.substring(0, instructionStart);
      expect(welcomePart.length).toBeLessThanOrEqual(300);
    });

    it('includes format example with /limit command', () => {
      const result = getWelcomeStep('123', 'Budi');
      expect(result.text).toContain('/limit 50000');
    });

    it('includes the valid range information', () => {
      const result = getWelcomeStep('123', 'Budi');
      expect(result.text).toContain('Rp1.000');
      expect(result.text).toContain('Rp10.000.000');
    });
  });

  describe('handleLimitSet', () => {
    it('with valid limit returns confirmation text and keyboard', () => {
      const result = handleLimitSet('onb_test_1', 50000);

      expect(result.text).toContain('Rp50.000');
      expect(result.text).toContain('✅');
      expect(result.keyboard).toBeDefined();
      // Verify the keyboard has inline_keyboard structure
      expect(result.keyboard).toHaveProperty('reply_markup');
    });

    it('with valid limit at minimum boundary returns confirmation', () => {
      const result = handleLimitSet('onb_test_2', MIN_LIMIT);

      expect(result.text).toContain('✅');
      expect(result.keyboard).toBeDefined();
    });

    it('with valid limit at maximum boundary returns confirmation', () => {
      const result = handleLimitSet('onb_test_3', MAX_LIMIT);

      expect(result.text).toContain('✅');
      expect(result.keyboard).toBeDefined();
    });

    it('with valid limit persists the daily limit in database', () => {
      // Create user first, then set limit
      database.getOrCreateUser('onb_test_4');
      handleLimitSet('onb_test_4', 75000);
      // Re-query to get updated value
      const db = database.getDatabase();
      const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get('onb_test_4');
      expect(user.daily_limit).toBe(75000);
    });

    it('with invalid limit (non-number) returns error text', () => {
      const result = handleLimitSet('onb_test_5', 'abc');

      expect(result.text).toContain('tidak valid');
      expect(result.keyboard).toBeUndefined();
    });

    it('with invalid limit (below minimum) returns error text', () => {
      const result = handleLimitSet('onb_test_6', 500);

      expect(result.text).toContain('luar rentang');
      expect(result.keyboard).toBeUndefined();
    });

    it('with invalid limit (above maximum) returns error text', () => {
      const result = handleLimitSet('onb_test_7', 20000000);

      expect(result.text).toContain('luar rentang');
      expect(result.keyboard).toBeUndefined();
    });
  });

  describe('handleBudgetStep', () => {
    it('with "create" choice returns summary with budget creation guide', () => {
      const result = handleBudgetStep('onb_budget_1', 'create');

      expect(result.text).toContain('Onboarding selesai');
      expect(result.text).toContain('/buat');
      expect(result.text).toContain('Contoh:');
    });

    it('with "skip" choice returns summary with example input', () => {
      const result = handleBudgetStep('onb_budget_2', 'skip');

      expect(result.text).toContain('Onboarding selesai');
      expect(result.text).toContain('20 makan siang');
    });

    it('with "create" choice shows existing budgets if any', () => {
      // Create budgets first
      database.createBudget('onb_budget_3', 'jajan', 30000);
      database.createBudget('onb_budget_3', 'transport', 20000);

      const result = handleBudgetStep('onb_budget_3', 'create');

      expect(result.text).toContain('jajan');
      expect(result.text).toContain('Rp30.000');
      expect(result.text).toContain('transport');
      expect(result.text).toContain('Rp20.000');
    });

    it('with "skip" choice shows "Belum ada budget" when no budgets exist', () => {
      const result = handleBudgetStep('onb_budget_4', 'skip');

      expect(result.text).toContain('Belum ada budget');
    });

    it('marks onboarding as complete regardless of choice', () => {
      handleBudgetStep('onb_budget_5', 'create');
      expect(database.isOnboardingComplete('onb_budget_5')).toBe(true);

      handleBudgetStep('onb_budget_6', 'skip');
      expect(database.isOnboardingComplete('onb_budget_6')).toBe(true);
    });
  });

  describe('validateLimit', () => {
    it('returns valid for number within range', () => {
      expect(validateLimit(50000)).toEqual({ valid: true });
    });

    it('returns valid for minimum boundary', () => {
      expect(validateLimit(MIN_LIMIT)).toEqual({ valid: true });
    });

    it('returns valid for maximum boundary', () => {
      expect(validateLimit(MAX_LIMIT)).toEqual({ valid: true });
    });

    it('returns error for non-number input', () => {
      const result = validateLimit('abc');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('tidak valid');
      expect(result.error).toContain('/limit 50000');
    });

    it('returns error for NaN', () => {
      const result = validateLimit(NaN);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('tidak valid');
    });

    it('returns error for number below minimum', () => {
      const result = validateLimit(999);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('luar rentang');
      expect(result.error).toContain('/limit 50000');
    });

    it('returns error for number above maximum', () => {
      const result = validateLimit(10000001);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('luar rentang');
    });
  });
});
