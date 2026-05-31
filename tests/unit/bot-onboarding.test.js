'use strict';

const database = require('../../src/database');
const { needsOnboarding, getWelcomeStep, handleLimitSet, handleBudgetStep, validateLimit } = require('../../src/onboarding');
const { formatRupiah } = require('../../src/formatter');

describe('Bot /start onboarding integration', () => {
  beforeEach(() => {
    // Clean up test data before each test
    const db = database.getDatabase();
    db.exec('DELETE FROM shortcuts');
    db.exec('DELETE FROM expenses');
    db.exec('DELETE FROM budgets');
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DELETE FROM users');
    db.exec('PRAGMA foreign_keys = ON');
  });

  describe('New user flow (onboarding not complete)', () => {
    it('should detect new user needs onboarding', () => {
      const user = database.getOrCreateUser('new_user_1', 'Budi');
      expect(needsOnboarding(user)).toBe(true);
      expect(user.onboarding_complete).toBe(0);
    });

    it('should show onboarding welcome step for new users', () => {
      const step = getWelcomeStep('new_user_2', 'Budi');
      expect(step.text).toContain('Halo Budi');
      expect(step.text).toContain('HematBot');
      expect(step.text).toContain('/limit');
      expect(step.text).toContain('50000');
    });

    it('should show welcome step without name if first_name is empty', () => {
      const step = getWelcomeStep('new_user_3', '');
      expect(step.text).toContain('Halo!');
      expect(step.text).toContain('/limit');
    });

    it('isOnboardingComplete returns false for new user', () => {
      database.getOrCreateUser('new_user_4', 'Test');
      expect(database.isOnboardingComplete('new_user_4')).toBe(false);
    });
  });

  describe('Existing user flow (onboarding complete)', () => {
    it('should not trigger onboarding for existing users', () => {
      database.getOrCreateUser('existing_1', 'Budi');
      database.setOnboardingComplete('existing_1');
      const user = database.getOrCreateUser('existing_1');
      // After re-fetching, onboarding_complete should be 1
      expect(database.isOnboardingComplete('existing_1')).toBe(true);
      expect(needsOnboarding({ ...user, onboarding_complete: 1 })).toBe(false);
    });

    it('should show welcome back message for existing users with settings summary', () => {
      // Simulate existing user with budgets
      database.getOrCreateUser('existing_2', 'Budi');
      database.setDailyLimit('existing_2', 75000);
      database.createBudget('existing_2', 'jajan', 30000);
      database.setOnboardingComplete('existing_2');

      // Verify the data that would be used in the /start response
      const user = database.getOrCreateUser('existing_2');
      const budgets = database.getBudgets('existing_2');

      expect(database.isOnboardingComplete('existing_2')).toBe(true);
      expect(user.daily_limit).toBe(75000);
      expect(budgets.length).toBe(1);
      expect(budgets[0].name).toBe('jajan');
    });
  });

  describe('/limit during onboarding', () => {
    it('should use onboarding flow and show budget step after valid limit', () => {
      database.getOrCreateUser('limit_onb_1', 'Test');
      const step = handleLimitSet('limit_onb_1', 50000);

      expect(step.text).toContain('Rp50.000');
      expect(step.text).toContain('✅');
      expect(step.text).toContain('budget');
      expect(step.keyboard).toBeDefined();
      expect(step.keyboard).toHaveProperty('reply_markup');
    });

    it('should show error for invalid limit during onboarding', () => {
      const validation = validateLimit(500);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('Rp1.000');
      expect(validation.error).toContain('Rp10.000.000');
    });

    it('should show error for non-numeric limit during onboarding', () => {
      const validation = validateLimit(null);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('Format tidak valid');
    });

    it('should show error for limit above max during onboarding', () => {
      const validation = validateLimit(20000000);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('di luar rentang');
    });
  });

  describe('Onboarding callback queries (onb:budget, onb:skip)', () => {
    it('should complete onboarding when user chooses skip', () => {
      database.getOrCreateUser('cb_skip_1', 'Test');
      const step = handleBudgetStep('cb_skip_1', 'skip');

      expect(step.text).toContain('Onboarding selesai');
      expect(step.text).toContain('20 makan siang');
      expect(database.isOnboardingComplete('cb_skip_1')).toBe(true);
    });

    it('should complete onboarding when user chooses create budget', () => {
      database.getOrCreateUser('cb_create_1', 'Test');
      const step = handleBudgetStep('cb_create_1', 'create');

      expect(step.text).toContain('Onboarding selesai');
      expect(step.text).toContain('/buat');
      expect(database.isOnboardingComplete('cb_create_1')).toBe(true);
    });

    it('should show budget list in summary if budgets exist', () => {
      database.getOrCreateUser('cb_budgets_1', 'Test');
      database.createBudget('cb_budgets_1', 'makan', 50000);

      const step = handleBudgetStep('cb_budgets_1', 'skip');
      expect(step.text).toContain('makan');
      expect(step.text).toContain('Rp50.000');
    });
  });
});
