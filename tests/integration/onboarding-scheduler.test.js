'use strict';

const {
  needsOnboarding,
  getWelcomeStep,
  handleLimitSet,
  handleBudgetStep,
} = require('../../src/onboarding');

const { checkAndSend, resetState } = require('../../src/scheduler');
const database = require('../../src/database');

describe('Integration: Onboarding Flow', () => {
  const telegramId = 'integ_onb_user_1';

  beforeEach(() => {
    const db = database.getDatabase();
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DELETE FROM shortcuts');
    db.exec('DELETE FROM expenses');
    db.exec('DELETE FROM budgets');
    db.exec('DELETE FROM users');
    db.exec('PRAGMA foreign_keys = ON');
  });

  it('completes full onboarding: new user → welcome → limit → budget skip → onboarding complete', () => {
    // Step 1: New user needs onboarding
    const user = database.getOrCreateUser(telegramId, 'Budi');
    expect(needsOnboarding(user)).toBe(true);

    // Step 2: Show welcome step
    const welcome = getWelcomeStep(telegramId, 'Budi');
    expect(welcome.text).toContain('Halo Budi');
    expect(welcome.text).toContain('/limit 50000');

    // Step 3: Set daily limit
    const limitResult = handleLimitSet(telegramId, 75000);
    expect(limitResult.text).toContain('Rp75.000');
    expect(limitResult.text).toContain('✅');
    expect(limitResult.keyboard).toBeDefined();

    // Verify limit persisted in DB
    const db = database.getDatabase();
    const updatedUser = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    expect(updatedUser.daily_limit).toBe(75000);

    // Step 4: Skip budget creation
    const budgetResult = handleBudgetStep(telegramId, 'skip');
    expect(budgetResult.text).toContain('Onboarding selesai');
    expect(budgetResult.text).toContain('20 makan siang');

    // Step 5: Verify onboarding is complete in DB
    expect(database.isOnboardingComplete(telegramId)).toBe(true);

    // User no longer needs onboarding
    const finalUser = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    expect(needsOnboarding(finalUser)).toBe(false);
  });

  it('completes full onboarding: new user → welcome → limit → budget create → onboarding complete', () => {
    // Step 1: New user needs onboarding
    const user = database.getOrCreateUser(telegramId, 'Ani');
    expect(needsOnboarding(user)).toBe(true);

    // Step 2: Show welcome step
    const welcome = getWelcomeStep(telegramId, 'Ani');
    expect(welcome.text).toContain('Halo Ani');

    // Step 3: Set daily limit
    const limitResult = handleLimitSet(telegramId, 100000);
    expect(limitResult.text).toContain('Rp100.000');
    expect(limitResult.text).toContain('✅');
    expect(limitResult.keyboard).toBeDefined();

    // Step 4: Create a budget before completing onboarding
    database.createBudget(telegramId, 'jajan', 30000);

    // Step 5: Choose "create" budget path
    const budgetResult = handleBudgetStep(telegramId, 'create');
    expect(budgetResult.text).toContain('Onboarding selesai');
    expect(budgetResult.text).toContain('jajan');
    expect(budgetResult.text).toContain('Rp30.000');
    expect(budgetResult.text).toContain('/buat');

    // Step 6: Verify onboarding is complete in DB
    expect(database.isOnboardingComplete(telegramId)).toBe(true);
  });

  it('rejects invalid limit during onboarding and allows retry', () => {
    database.getOrCreateUser(telegramId, 'Cici');

    // Invalid limit (below minimum)
    const invalidResult = handleLimitSet(telegramId, 500);
    expect(invalidResult.text).toContain('luar rentang');
    expect(invalidResult.keyboard).toBeUndefined();

    // User is still in onboarding
    expect(database.isOnboardingComplete(telegramId)).toBe(false);

    // Retry with valid limit
    const validResult = handleLimitSet(telegramId, 50000);
    expect(validResult.text).toContain('Rp50.000');
    expect(validResult.text).toContain('✅');
    expect(validResult.keyboard).toBeDefined();
  });
});

describe('Integration: Scheduler Dispatch', () => {
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

  it('dispatches daily summary at 21:00 WIB to users with notifications enabled', async () => {
    // IMPORTANT: Add expenses BEFORE setting fake timers
    // (SQLite CURRENT_TIMESTAMP uses real system clock)
    database.getOrCreateUser('sched_integ_1');
    database.setDailyLimit('sched_integ_1', 100000);
    database.setNotificationEnabled('sched_integ_1', true);
    database.addExpense('sched_integ_1', 25000, '', 'makan siang', null);
    database.addExpense('sched_integ_1', 15000, '', 'kopi', null);

    const mockBot = {
      telegram: {
        sendMessage: vi.fn(async () => {}),
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

    // Verify sendMessage was called with the user's summary
    expect(mockBot.telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(
      'sched_integ_1',
      expect.stringContaining('Ringkasan Harian'),
      { parse_mode: 'HTML' }
    );

    // Verify summary content includes expenses
    const sentMessage = mockBot.telegram.sendMessage.mock.calls[0][1];
    expect(sentMessage).toContain('Rp40.000'); // total: 25000 + 15000
    expect(sentMessage).toContain('Rp60.000'); // remaining: 100000 - 40000
    expect(sentMessage).toContain('makan siang');
    expect(sentMessage).toContain('kopi');
  });

  it('skips users with notifications disabled at 21:00 WIB', async () => {
    // Add expenses BEFORE fake timers
    database.getOrCreateUser('sched_integ_disabled');
    database.setNotificationEnabled('sched_integ_disabled', false);
    database.addExpense('sched_integ_disabled', 30000, '', 'test expense', null);

    const mockBot = {
      telegram: {
        sendMessage: vi.fn(async () => {}),
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

    // sendMessage should NOT be called for disabled user
    expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('does not dispatch at wrong time (15:00 WIB)', async () => {
    // Add expenses BEFORE fake timers
    database.getOrCreateUser('sched_integ_wrongtime');
    database.setNotificationEnabled('sched_integ_wrongtime', true);
    database.addExpense('sched_integ_wrongtime', 20000, '', 'snack', null);

    const mockBot = {
      telegram: {
        sendMessage: vi.fn(async () => {}),
      },
    };

    // Set fake time to today at 15:00 WIB (08:00 UTC) — not dispatch time
    const now = new Date();
    const todayAt1500WIB = new Date(Date.UTC(
      now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0
    ));
    vi.useFakeTimers();
    vi.setSystemTime(todayAt1500WIB);

    await checkAndSend(mockBot);

    // sendMessage should NOT be called at wrong time
    expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('dispatches to multiple enabled users and skips disabled ones', async () => {
    // User 1: notifications enabled, has expenses
    database.getOrCreateUser('sched_multi_1');
    database.setNotificationEnabled('sched_multi_1', true);
    database.addExpense('sched_multi_1', 20000, '', 'item1', null);

    // User 2: notifications enabled, has expenses
    database.getOrCreateUser('sched_multi_2');
    database.setNotificationEnabled('sched_multi_2', true);
    database.addExpense('sched_multi_2', 35000, '', 'item2', null);

    // User 3: notifications disabled, has expenses
    database.getOrCreateUser('sched_multi_3');
    database.setNotificationEnabled('sched_multi_3', false);
    database.addExpense('sched_multi_3', 10000, '', 'item3', null);

    const mockBot = {
      telegram: {
        sendMessage: vi.fn(async () => {}),
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

    // Only 2 enabled users should receive messages
    expect(mockBot.telegram.sendMessage).toHaveBeenCalledTimes(2);
    const calledIds = mockBot.telegram.sendMessage.mock.calls.map(c => c[0]);
    expect(calledIds).toContain('sched_multi_1');
    expect(calledIds).toContain('sched_multi_2');
    expect(calledIds).not.toContain('sched_multi_3');
  });
});
