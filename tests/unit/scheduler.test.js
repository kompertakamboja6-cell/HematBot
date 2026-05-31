const { generateDailySummary, checkAndSend, resetState } = require('../../src/scheduler');
const database = require('../../src/database');

describe('scheduler.js', () => {
  beforeEach(() => {
    const db = database.getDatabase();
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DELETE FROM expenses');
    db.exec('DELETE FROM budgets');
    db.exec('DELETE FROM users');
    db.exec('PRAGMA foreign_keys = ON');
    resetState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateDailySummary', () => {
    const telegramId = 'sched_user_1';

    it('returns null when user has no expenses today', () => {
      database.getOrCreateUser(telegramId);
      const result = generateDailySummary(telegramId);
      expect(result).toBeNull();
    });

    it('returns formatted summary when user has expenses', () => {
      database.getOrCreateUser(telegramId);
      database.setDailyLimit(telegramId, 100000);
      database.addExpense(telegramId, 25000, '', 'makan siang', null);
      database.addExpense(telegramId, 15000, '', 'kopi', null);

      const result = generateDailySummary(telegramId);
      expect(result).not.toBeNull();
      expect(result).toContain('Ringkasan Harian');
      expect(result).toContain('Rp40.000'); // total
      expect(result).toContain('Rp60.000'); // remaining (100000 - 40000)
      expect(result).toContain('makan siang');
      expect(result).toContain('kopi');
    });

    it('shows top 3 expenses sorted by amount descending', () => {
      database.getOrCreateUser(telegramId);
      database.setDailyLimit(telegramId, 200000);
      database.addExpense(telegramId, 10000, '', 'snack', null);
      database.addExpense(telegramId, 50000, '', 'makan besar', null);
      database.addExpense(telegramId, 30000, '', 'transport', null);
      database.addExpense(telegramId, 20000, '', 'kopi mahal', null);

      const result = generateDailySummary(telegramId);
      expect(result).not.toBeNull();

      // Top 3 should be: makan besar (50k), transport (30k), kopi mahal (20k)
      const lines = result.split('\n');
      const expenseLines = lines.filter(l => /^\d+\./.test(l));
      expect(expenseLines).toHaveLength(3);
      expect(expenseLines[0]).toContain('Rp50.000');
      expect(expenseLines[0]).toContain('makan besar');
      expect(expenseLines[1]).toContain('Rp30.000');
      expect(expenseLines[1]).toContain('transport');
      expect(expenseLines[2]).toContain('Rp20.000');
      expect(expenseLines[2]).toContain('kopi mahal');
      // snack (10k) should NOT be in top 3
      expect(result).not.toContain('snack');
    });

    it('shows all expenses if fewer than 3', () => {
      database.getOrCreateUser(telegramId);
      database.addExpense(telegramId, 20000, '', 'satu item', null);

      const result = generateDailySummary(telegramId);
      const lines = result.split('\n');
      const expenseLines = lines.filter(l => /^\d+\./.test(l));
      expect(expenseLines).toHaveLength(1);
      expect(expenseLines[0]).toContain('satu item');
    });

    it('shows (tanpa catatan) for expenses without notes', () => {
      database.getOrCreateUser(telegramId);
      database.addExpense(telegramId, 20000, '', '', null);

      const result = generateDailySummary(telegramId);
      expect(result).toContain('(tanpa catatan)');
    });

    it('includes total and remaining limit', () => {
      database.getOrCreateUser(telegramId);
      database.setDailyLimit(telegramId, 50000);
      database.addExpense(telegramId, 30000, '', 'test', null);

      const result = generateDailySummary(telegramId);
      expect(result).toContain('Rp30.000'); // total
      expect(result).toContain('Rp20.000'); // remaining
    });
  });

  describe('checkAndSend', () => {
    it('sends summaries to users with notifications enabled at 21:00 WIB', async () => {
      // Set up user with notifications and expenses BEFORE fake timers
      // (SQLite CURRENT_TIMESTAMP uses real system clock)
      database.getOrCreateUser('notif_test_1');
      database.setNotificationEnabled('notif_test_1', true);
      database.addExpense('notif_test_1', 25000, '', 'test expense', null);

      const mockBot = {
        telegram: {
          sendMessage: vi.fn(async () => {}),
        },
      };

      // Now set fake time to today at 21:00 WIB (14:00 UTC)
      const now = new Date();
      const todayAt2100WIB = new Date(Date.UTC(
        now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0
      ));
      vi.useFakeTimers();
      vi.setSystemTime(todayAt2100WIB);

      await checkAndSend(mockBot);

      expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(
        'notif_test_1',
        expect.stringContaining('Ringkasan Harian'),
        { parse_mode: 'HTML' }
      );
    });

    it('does not send when time is not 21:00 WIB', async () => {
      database.getOrCreateUser('notif_test_2');
      database.setNotificationEnabled('notif_test_2', true);
      database.addExpense('notif_test_2', 25000, '', 'test', null);

      const mockBot = {
        telegram: {
          sendMessage: vi.fn(),
        },
      };

      // Mock the time to be 15:00 WIB (08:00 UTC) - today
      const now = new Date();
      const todayAt1500WIB = new Date(Date.UTC(
        now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0
      ));
      vi.useFakeTimers();
      vi.setSystemTime(todayAt1500WIB);

      await checkAndSend(mockBot);

      expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('handles send failures gracefully', async () => {
      database.getOrCreateUser('fail_user_1');
      database.setNotificationEnabled('fail_user_1', true);
      database.addExpense('fail_user_1', 25000, '', 'test', null);

      database.getOrCreateUser('success_user_1');
      database.setNotificationEnabled('success_user_1', true);
      database.addExpense('success_user_1', 30000, '', 'test2', null);

      const mockBot = {
        telegram: {
          sendMessage: vi.fn(async (chatId) => {
            if (chatId === 'fail_user_1') {
              throw new Error('Telegram API error');
            }
          }),
        },
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Set fake time to today at 21:00 WIB (14:00 UTC)
      const now = new Date();
      const todayAt2100WIB = new Date(Date.UTC(
        now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0
      ));
      vi.useFakeTimers();
      vi.setSystemTime(todayAt2100WIB);

      await checkAndSend(mockBot);

      // Should have attempted both users
      expect(mockBot.telegram.sendMessage).toHaveBeenCalledTimes(2);
      // Should have logged the error
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('fail_user_1'),
        expect.any(String)
      );

      consoleSpy.mockRestore();
    });

    it('does not send to users with notifications disabled', async () => {
      database.getOrCreateUser('disabled_user');
      database.setNotificationEnabled('disabled_user', false);
      database.addExpense('disabled_user', 25000, '', 'test', null);

      const mockBot = {
        telegram: {
          sendMessage: vi.fn(),
        },
      };

      // Set fake time to today at 21:00 WIB (14:00 UTC)
      const now = new Date();
      const todayAt2100WIB = new Date(Date.UTC(
        now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0
      ));
      vi.useFakeTimers();
      vi.setSystemTime(todayAt2100WIB);

      await checkAndSend(mockBot);

      expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled();
    });
  });
});
