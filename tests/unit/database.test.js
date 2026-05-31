const database = require('../../src/database');

describe('database.js - new functions', () => {
  beforeEach(() => {
    const db = database.getDatabase();
    // Clean up test data before each test (order matters for FK constraints)
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DELETE FROM shortcuts');
    db.exec('DELETE FROM expenses');
    db.exec('DELETE FROM budgets');
    db.exec('DELETE FROM users');
    db.exec('PRAGMA foreign_keys = ON');
  });

  describe('Shortcut CRUD', () => {
    const telegramId = 'test_user_123';

    it('createShortcut creates a new shortcut', () => {
      const shortcut = database.createShortcut(telegramId, 'kopi', 15000, 'kopi pagi', 'jajan');
      expect(shortcut).toBeDefined();
      expect(shortcut.name).toBe('kopi');
      expect(shortcut.amount).toBe(15000);
      expect(shortcut.note).toBe('kopi pagi');
      expect(shortcut.budget_name).toBe('jajan');
    });

    it('createShortcut upserts when name already exists', () => {
      database.createShortcut(telegramId, 'kopi', 15000, 'kopi pagi', 'jajan');
      const updated = database.createShortcut(telegramId, 'kopi', 20000, 'kopi sore', 'makan');
      expect(updated.amount).toBe(20000);
      expect(updated.note).toBe('kopi sore');
      expect(updated.budget_name).toBe('makan');
    });

    it('getShortcuts returns all shortcuts for a user', () => {
      database.createShortcut(telegramId, 'kopi', 15000, 'kopi pagi', null);
      database.createShortcut(telegramId, 'makan', 25000, 'makan siang', 'jajan');
      const shortcuts = database.getShortcuts(telegramId);
      expect(shortcuts).toHaveLength(2);
    });

    it('getShortcuts returns empty array for user with no shortcuts', () => {
      database.getOrCreateUser(telegramId);
      const shortcuts = database.getShortcuts(telegramId);
      expect(shortcuts).toEqual([]);
    });

    it('getShortcutByName returns the correct shortcut', () => {
      database.createShortcut(telegramId, 'kopi', 15000, 'kopi pagi', 'jajan');
      const shortcut = database.getShortcutByName(telegramId, 'kopi');
      expect(shortcut).not.toBeNull();
      expect(shortcut.name).toBe('kopi');
      expect(shortcut.amount).toBe(15000);
    });

    it('getShortcutByName returns null for non-existent shortcut', () => {
      database.getOrCreateUser(telegramId);
      const shortcut = database.getShortcutByName(telegramId, 'nonexistent');
      expect(shortcut).toBeNull();
    });

    it('deleteShortcut removes the shortcut and returns true', () => {
      database.createShortcut(telegramId, 'kopi', 15000, 'kopi pagi', null);
      const result = database.deleteShortcut(telegramId, 'kopi');
      expect(result).toBe(true);
      expect(database.getShortcutByName(telegramId, 'kopi')).toBeNull();
    });

    it('deleteShortcut returns false for non-existent shortcut', () => {
      database.getOrCreateUser(telegramId);
      const result = database.deleteShortcut(telegramId, 'nonexistent');
      expect(result).toBe(false);
    });

    it('countShortcuts returns the correct count', () => {
      database.getOrCreateUser(telegramId);
      expect(database.countShortcuts(telegramId)).toBe(0);
      database.createShortcut(telegramId, 'kopi', 15000, '', null);
      expect(database.countShortcuts(telegramId)).toBe(1);
      database.createShortcut(telegramId, 'makan', 25000, '', null);
      expect(database.countShortcuts(telegramId)).toBe(2);
    });
  });

  describe('Notification preferences', () => {
    const telegramId = 'test_notif_user';

    it('setNotificationEnabled enables notifications', () => {
      database.getOrCreateUser(telegramId);
      database.setNotificationEnabled(telegramId, true);
      const settings = database.getNotificationSettings(telegramId);
      expect(settings.enabled).toBe(true);
      expect(settings.time).toBe('21:00');
    });

    it('setNotificationEnabled disables notifications', () => {
      database.getOrCreateUser(telegramId);
      database.setNotificationEnabled(telegramId, true);
      database.setNotificationEnabled(telegramId, false);
      const settings = database.getNotificationSettings(telegramId);
      expect(settings.enabled).toBe(false);
    });

    it('getNotificationSettings returns defaults for new user', () => {
      const settings = database.getNotificationSettings(telegramId);
      expect(settings.enabled).toBe(false);
      expect(settings.time).toBe('21:00');
    });

    it('getUsersWithNotificationsEnabled returns only enabled users', () => {
      database.getOrCreateUser('notif_user1');
      database.getOrCreateUser('notif_user2');
      database.getOrCreateUser('notif_user3');
      database.setNotificationEnabled('notif_user1', true);
      database.setNotificationEnabled('notif_user3', true);

      const users = database.getUsersWithNotificationsEnabled();
      const telegramIds = users.map(u => u.telegram_id);
      expect(telegramIds).toContain('notif_user1');
      expect(telegramIds).toContain('notif_user3');
      expect(telegramIds).not.toContain('notif_user2');
    });
  });

  describe('Undo support', () => {
    const telegramId = 'test_undo_user';

    it('getExpenseById returns the expense', () => {
      const expense = database.addExpense(telegramId, 20000, '', 'test', null);
      const found = database.getExpenseById(expense.id);
      expect(found).not.toBeNull();
      expect(found.id).toBe(expense.id);
      expect(found.amount).toBe(20000);
    });

    it('getExpenseById returns null for non-existent expense', () => {
      const found = database.getExpenseById(99999);
      expect(found).toBeNull();
    });

    it('deleteExpenseById deletes the expense and returns true', () => {
      const expense = database.addExpense(telegramId, 20000, '', 'test', null);
      const user = database.getOrCreateUser(telegramId);
      const result = database.deleteExpenseById(expense.id, user.id);
      expect(result).toBe(true);
      expect(database.getExpenseById(expense.id)).toBeNull();
    });

    it('deleteExpenseById returns false for wrong userId', () => {
      const expense = database.addExpense(telegramId, 20000, '', 'test', null);
      const result = database.deleteExpenseById(expense.id, 99999);
      expect(result).toBe(false);
    });

    it('deleteExpenseById returns false for non-existent expense', () => {
      const user = database.getOrCreateUser(telegramId);
      const result = database.deleteExpenseById(99999, user.id);
      expect(result).toBe(false);
    });
  });

  describe('Onboarding state', () => {
    const telegramId = 'test_onboard_user';

    it('isOnboardingComplete returns false for new user', () => {
      expect(database.isOnboardingComplete(telegramId)).toBe(false);
    });

    it('setOnboardingComplete marks onboarding as complete', () => {
      database.getOrCreateUser(telegramId);
      database.setOnboardingComplete(telegramId);
      expect(database.isOnboardingComplete(telegramId)).toBe(true);
    });
  });
});
