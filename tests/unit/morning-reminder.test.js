const { formatMorningReminder, escapeHtml } = require('../../src/formatter');
const { checkAndSendMorning, resetState } = require('../../src/scheduler');
const { resetQuoteState, getQuotePool } = require('../../src/quotes');
const database = require('../../src/database');

describe('formatMorningReminder', () => {
  it('returns personalized greeting with valid name and quote', () => {
    const result = formatMorningReminder({ name: 'Budi', quote: 'Semangat menabung!' });

    expect(result).toContain('Selamat Pagi, Budi!');
    expect(result).toContain('Semangat menabung!');
    expect(result).toContain('Yuk, mulai catat pengeluaranmu hari ini!');
  });

  it('returns generic greeting when name is empty string', () => {
    const result = formatMorningReminder({ name: '', quote: 'Hemat itu keren!' });

    expect(result).toContain('Selamat Pagi!</b>');
    expect(result).not.toContain('Selamat Pagi, ');
    expect(result).toContain('Hemat itu keren!');
  });

  it('returns generic greeting when name is null', () => {
    const result = formatMorningReminder({ name: null, quote: 'Catat pengeluaranmu!' });

    expect(result).toContain('Selamat Pagi!</b>');
    expect(result).not.toContain('Selamat Pagi, ');
    expect(result).toContain('Catat pengeluaranmu!');
  });

  it('escapes HTML special characters in name', () => {
    const result = formatMorningReminder({
      name: "<script>alert('xss')</script>",
      quote: 'Ayo hemat!',
    });

    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
    expect(result).toContain('&lt;/script&gt;');
  });

  it('uses HTML parse_mode compatible format with <b> tags', () => {
    const result = formatMorningReminder({ name: 'Andi', quote: 'Nabung yuk!' });

    expect(result).toContain('<b>');
    expect(result).toContain('</b>');
  });
});

describe('escapeHtml', () => {
  it('escapes < and > characters', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes & character', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('returns plain text unchanged', () => {
    expect(escapeHtml('hello')).toBe('hello');
  });
});

describe('checkAndSendMorning - scheduler morning reminder', () => {
  let mockBot;
  let consoleSpy;

  beforeEach(() => {
    resetState();
    resetQuoteState();
    // Clean database state
    const db = database.getDatabase();
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DELETE FROM users');
    db.exec('PRAGMA foreign_keys = ON');
    mockBot = {
      telegram: {
        sendMessage: vi.fn().mockResolvedValue(true),
      },
    };
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleSpy.mockRestore();
  });

  /**
   * Helper: set fake time to 07:00 WIB (00:00 UTC)
   */
  function setTimeTo0700WIB() {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2025, 0, 15, 0, 0, 0))); // 00:00 UTC = 07:00 WIB
  }

  /**
   * Helper: set fake time to a specific hour WIB
   */
  function setTimeToWIB(hour, minute = 0) {
    // WIB = UTC+7, so UTC hour = WIB hour - 7
    const utcHour = hour - 7;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2025, 0, 15, utcHour < 0 ? utcHour + 24 : utcHour, minute, 0)));
  }

  function createEnabledUser(id, name) {
    database.getOrCreateUser(id);
    database.setNotificationEnabled(id, true);
    if (name) {
      const db = database.getDatabase();
      db.prepare('UPDATE users SET name = ? WHERE telegram_id = ?').run(name, id);
    }
  }

  it('sends morning reminder at 07:00 WIB to enabled users', async () => {
    // Validates: Requirement 1.1
    createEnabledUser('user_morning_1', 'Budi');

    setTimeTo0700WIB();
    await checkAndSendMorning(mockBot);

    expect(mockBot.telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(
      'user_morning_1',
      expect.any(String),
      { parse_mode: 'HTML' }
    );
  });

  it('does not send at other times (e.g., 08:00 WIB)', async () => {
    // Validates: Requirement 5.2
    createEnabledUser('user_morning_2', 'Andi');

    setTimeToWIB(8, 0);
    await checkAndSendMorning(mockBot);

    expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send at 21:00 WIB', async () => {
    // Validates: Requirement 5.2
    createEnabledUser('user_morning_3', 'Cici');

    setTimeToWIB(21, 0);
    await checkAndSendMorning(mockBot);

    expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('resets dedup state when time is not 07:00 (can send again next day)', async () => {
    // Validates: Requirement 5.2
    createEnabledUser('user_dedup_reset', 'Dedi');

    // First: send at 07:00
    setTimeTo0700WIB();
    await checkAndSendMorning(mockBot);
    expect(mockBot.telegram.sendMessage).toHaveBeenCalledTimes(1);

    // Then: time moves to 08:00 (resets dedup state)
    vi.setSystemTime(new Date(Date.UTC(2025, 0, 15, 1, 0, 0))); // 08:00 WIB
    await checkAndSendMorning(mockBot);

    // Next day at 07:00 — should send again because dedup was reset
    vi.setSystemTime(new Date(Date.UTC(2025, 0, 16, 0, 0, 0))); // next day 07:00 WIB
    await checkAndSendMorning(mockBot);
    expect(mockBot.telegram.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('dedup prevents multiple sends in same minute', async () => {
    // Validates: Requirement 5.1
    createEnabledUser('user_dedup', 'Eka');

    setTimeTo0700WIB();

    await checkAndSendMorning(mockBot);
    await checkAndSendMorning(mockBot);
    await checkAndSendMorning(mockBot);

    expect(mockBot.telegram.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('per-user error isolation: one failure does not stop others', async () => {
    // Validates: Requirements 1.3, 5.4
    createEnabledUser('user_fail', 'Fail');
    createEnabledUser('user_ok', 'Ok');

    mockBot.telegram.sendMessage = vi.fn(async (chatId) => {
      if (chatId === 'user_fail') {
        throw new Error('Telegram API error');
      }
      return true;
    });

    setTimeTo0700WIB();
    await checkAndSendMorning(mockBot);

    // Both users should have been attempted
    expect(mockBot.telegram.sendMessage).toHaveBeenCalledTimes(2);
    // Error should be logged for the failing user
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('user_fail'),
      expect.any(String)
    );
    // The successful user should still get their message
    expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(
      'user_ok',
      expect.any(String),
      { parse_mode: 'HTML' }
    );
  });

  it('database error prevents all sends and logs error', async () => {
    // Validates: Requirement 5.3
    // Temporarily rename the users table to cause a real SQL error
    const db = database.getDatabase();
    db.exec('ALTER TABLE users RENAME TO users_backup');

    setTimeTo0700WIB();
    await checkAndSendMorning(mockBot);

    expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch users for morning reminder'),
      expect.any(String)
    );

    // Restore the table
    db.exec('ALTER TABLE users_backup RENAME TO users');
  });

  it('user with notification_enabled=0 is not messaged', async () => {
    // Validates: Requirement 3.5
    // Create user but don't enable notifications (default is 0)
    database.getOrCreateUser('user_disabled');

    setTimeTo0700WIB();
    await checkAndSendMorning(mockBot);

    expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('uses HTML parse_mode in sendMessage', async () => {
    // Validates: Requirement 4.1
    createEnabledUser('user_html', 'Html');

    setTimeTo0700WIB();
    await checkAndSendMorning(mockBot);

    expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(
      'user_html',
      expect.any(String),
      { parse_mode: 'HTML' }
    );
  });

  it('sends default message when quote pool is empty', async () => {
    // Validates: Requirement 1.5
    createEnabledUser('user_no_quote', 'Sari');

    // Temporarily empty the quote pool by splicing the internal array
    const pool = getQuotePool();
    const backup = [...pool];
    pool.length = 0;

    setTimeTo0700WIB();
    await checkAndSendMorning(mockBot);

    // Restore the pool
    pool.push(...backup);

    expect(mockBot.telegram.sendMessage).toHaveBeenCalledTimes(1);
    const sentMessage = mockBot.telegram.sendMessage.mock.calls[0][1];
    // Should contain the default CTA without a quote
    expect(sentMessage).toContain('Yuk, mulai catat pengeluaranmu hari ini!');
    expect(sentMessage).toContain('Selamat Pagi');
    // Should NOT contain the quote format (💬 "...")
    expect(sentMessage).not.toContain('💬');
  });
});
