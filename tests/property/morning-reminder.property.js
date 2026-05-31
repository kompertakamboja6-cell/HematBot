const { checkAndSendMorning, resetState } = require('../../src/scheduler');
const { getQuotePool, resetQuoteState } = require('../../src/quotes');
const { formatMorningReminder } = require('../../src/formatter');
const database = require('../../src/database');

const db = database.getDatabase();

function cleanDatabase() {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('DELETE FROM expenses');
  db.exec('DELETE FROM budgets');
  db.exec('DELETE FROM users');
  db.exec('PRAGMA foreign_keys = ON');
}

describe('Feature: daily-reminder-motivation, Property 1: Only enabled users receive morning reminders', () => {
  /**
   * **Validates: Requirements 1.1, 3.1, 3.4, 3.5**
   *
   * For any set of users with varying notification_enabled states,
   * only users with notification_enabled=1 receive messages.
   */
  beforeEach(() => {
    cleanDatabase();
    resetState();
    resetQuoteState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('only users with notification_enabled=1 receive messages', async () => {
    const fc = await import('fast-check');

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            telegram_id: fc.stringMatching(/^prop1_[0-9]{1,8}$/),
            name: fc.oneof(fc.constant(''), fc.constant(null), fc.string({ minLength: 1, maxLength: 20 })),
            notification_enabled: fc.constantFrom(0, 1),
          }),
          { minLength: 1, maxLength: 15 }
        ),
        async (users) => {
          cleanDatabase();
          resetState();

          // Deduplicate users by telegram_id
          const uniqueUsers = [...new Map(users.map(u => [u.telegram_id, u])).values()];

          // Create users in the real database
          for (const user of uniqueUsers) {
            database.getOrCreateUser(user.telegram_id);
            if (user.name) {
              db.prepare('UPDATE users SET name = ? WHERE telegram_id = ?').run(user.name, user.telegram_id);
            }
            database.setNotificationEnabled(user.telegram_id, user.notification_enabled === 1);
          }

          const enabledUsers = uniqueUsers.filter(u => u.notification_enabled === 1);
          const disabledUsers = uniqueUsers.filter(u => u.notification_enabled === 0);

          const sendMessage = vi.fn(async () => {});
          const mockBot = { telegram: { sendMessage } };

          // Set time to 07:00 WIB (00:00 UTC)
          vi.useFakeTimers();
          vi.setSystemTime(new Date(Date.UTC(2024, 5, 15, 0, 0, 0)));

          await checkAndSendMorning(mockBot);

          vi.useRealTimers();

          // All enabled users should receive a message
          for (const user of enabledUsers) {
            expect(sendMessage).toHaveBeenCalledWith(
              user.telegram_id,
              expect.any(String),
              { parse_mode: 'HTML' }
            );
          }

          // No disabled user should receive a message
          for (const user of disabledUsers) {
            expect(sendMessage).not.toHaveBeenCalledWith(
              user.telegram_id,
              expect.any(String),
              expect.anything()
            );
          }

          // Total calls should equal number of enabled users
          expect(sendMessage).toHaveBeenCalledTimes(enabledUsers.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: daily-reminder-motivation, Property 2: Deduplication prevents duplicate sends', () => {
  /**
   * **Validates: Requirements 1.2, 5.1**
   *
   * For any number of repeated checkAndSendMorning calls (2-10) within the same 07:00 minute,
   * each user receives exactly one message.
   */
  beforeEach(() => {
    cleanDatabase();
    resetState();
    resetQuoteState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('repeated calls within same minute send exactly one message per user', async () => {
    const fc = await import('fast-check');

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            telegram_id: fc.stringMatching(/^prop2_[0-9]{1,8}$/),
            name: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 20 })),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        fc.integer({ min: 2, max: 10 }),
        async (users, repeatCount) => {
          cleanDatabase();
          resetState();

          const uniqueUsers = [...new Map(users.map(u => [u.telegram_id, u])).values()];

          // Create users with notifications enabled
          for (const user of uniqueUsers) {
            database.getOrCreateUser(user.telegram_id);
            if (user.name) {
              db.prepare('UPDATE users SET name = ? WHERE telegram_id = ?').run(user.name, user.telegram_id);
            }
            database.setNotificationEnabled(user.telegram_id, true);
          }

          const sendMessage = vi.fn(async () => {});
          const mockBot = { telegram: { sendMessage } };

          // Set time to 07:00 WIB (00:00 UTC)
          vi.useFakeTimers();
          vi.setSystemTime(new Date(Date.UTC(2024, 5, 15, 0, 0, 0)));

          // Call checkAndSendMorning multiple times within the same minute
          for (let i = 0; i < repeatCount; i++) {
            await checkAndSendMorning(mockBot);
          }

          vi.useRealTimers();

          // Each user should receive exactly one message
          expect(sendMessage).toHaveBeenCalledTimes(uniqueUsers.length);

          for (const user of uniqueUsers) {
            const calls = sendMessage.mock.calls.filter(c => c[0] === user.telegram_id);
            expect(calls).toHaveLength(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: daily-reminder-motivation, Property 3: Error isolation per user', () => {
  /**
   * **Validates: Requirements 1.3, 5.4**
   *
   * For any list of users where a random subset of sends throw exceptions,
   * all non-failing users still receive their messages.
   */
  beforeEach(() => {
    cleanDatabase();
    resetState();
    resetQuoteState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('non-failing users still receive messages when some sends throw', async () => {
    const fc = await import('fast-check');

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            telegram_id: fc.stringMatching(/^prop3_[0-9]{1,8}$/),
            name: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 20 })),
            shouldFail: fc.boolean(),
          }),
          { minLength: 2, maxLength: 15 }
        ),
        async (users) => {
          cleanDatabase();
          resetState();

          const uniqueUsers = [...new Map(users.map(u => [u.telegram_id, u])).values()];

          // Need at least one failing and one succeeding user for meaningful test
          const failingIds = new Set(
            uniqueUsers.filter(u => u.shouldFail).map(u => u.telegram_id)
          );
          const successIds = new Set(
            uniqueUsers.filter(u => !u.shouldFail).map(u => u.telegram_id)
          );

          // If all fail or all succeed, skip this iteration
          if (failingIds.size === 0 || successIds.size === 0) return;

          // Create users with notifications enabled
          for (const user of uniqueUsers) {
            database.getOrCreateUser(user.telegram_id);
            if (user.name) {
              db.prepare('UPDATE users SET name = ? WHERE telegram_id = ?').run(user.name, user.telegram_id);
            }
            database.setNotificationEnabled(user.telegram_id, true);
          }

          const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

          const sendMessage = vi.fn(async (chatId) => {
            if (failingIds.has(chatId)) {
              throw new Error(`Telegram API error for ${chatId}`);
            }
          });
          const mockBot = { telegram: { sendMessage } };

          // Set time to 07:00 WIB (00:00 UTC)
          vi.useFakeTimers();
          vi.setSystemTime(new Date(Date.UTC(2024, 5, 15, 0, 0, 0)));

          await checkAndSendMorning(mockBot);

          vi.useRealTimers();

          // All users should have been attempted (total calls = all users)
          expect(sendMessage).toHaveBeenCalledTimes(uniqueUsers.length);

          // Each successful user should have been called
          for (const userId of successIds) {
            expect(sendMessage).toHaveBeenCalledWith(
              userId,
              expect.any(String),
              { parse_mode: 'HTML' }
            );
          }

          consoleSpy.mockRestore();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: daily-reminder-motivation, Property 4: Morning reminder contains a valid quote from the pool', () => {
  /**
   * **Validates: Requirements 1.4**
   *
   * For any user with notifications enabled, the sent message contains a quote
   * that exists in the quote pool.
   */
  beforeEach(() => {
    cleanDatabase();
    resetState();
    resetQuoteState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sent message contains a quote from the quote pool', async () => {
    const fc = await import('fast-check');
    const quotePool = getQuotePool();

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            telegram_id: fc.stringMatching(/^prop4_[0-9]{1,8}$/),
            name: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 20 })),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (users) => {
          cleanDatabase();
          resetState();
          resetQuoteState();

          const uniqueUsers = [...new Map(users.map(u => [u.telegram_id, u])).values()];

          // Create users with notifications enabled
          for (const user of uniqueUsers) {
            database.getOrCreateUser(user.telegram_id);
            if (user.name) {
              db.prepare('UPDATE users SET name = ? WHERE telegram_id = ?').run(user.name, user.telegram_id);
            }
            database.setNotificationEnabled(user.telegram_id, true);
          }

          const sentMessages = [];
          const sendMessage = vi.fn(async (chatId, message) => {
            sentMessages.push({ chatId, message });
          });
          const mockBot = { telegram: { sendMessage } };

          // Set time to 07:00 WIB (00:00 UTC)
          vi.useFakeTimers();
          vi.setSystemTime(new Date(Date.UTC(2024, 5, 15, 0, 0, 0)));

          await checkAndSendMorning(mockBot);

          vi.useRealTimers();

          // Each sent message should contain at least one quote from the pool
          for (const { message } of sentMessages) {
            const containsQuote = quotePool.some(quote => message.includes(quote));
            expect(containsQuote).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: daily-reminder-motivation, Property 7: Message format ordering', () => {
  /**
   * **Validates: Requirements 2.4**
   *
   * For any valid name (or empty name) and any quote from the pool,
   * the formatted morning reminder shall have the greeting appearing before the quote,
   * and the quote appearing before the call-to-action text.
   */
  it('greeting appears before quote, and quote appears before call-to-action', async () => {
    const fc = await import('fast-check');
    const quotePool = getQuotePool();

    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(''),
          fc.constant(null),
          fc.string({ minLength: 1, maxLength: 50 })
        ),
        fc.integer({ min: 0, max: quotePool.length - 1 }),
        (name, quoteIndex) => {
          const quote = quotePool[quoteIndex];
          const result = formatMorningReminder({ name, quote });

          const greetingText = 'Selamat Pagi';
          const callToAction = 'catat pengeluaranmu hari ini';

          const greetingPos = result.indexOf(greetingText);
          const quotePos = result.indexOf(quote);
          const ctaPos = result.indexOf(callToAction);

          // All parts must be present
          expect(greetingPos).toBeGreaterThanOrEqual(0);
          expect(quotePos).toBeGreaterThanOrEqual(0);
          expect(ctaPos).toBeGreaterThanOrEqual(0);

          // Ordering: greeting < quote < call-to-action
          expect(greetingPos).toBeLessThan(quotePos);
          expect(quotePos).toBeLessThan(ctaPos);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: daily-reminder-motivation, Property 8: Formatted message visible text within length limit', () => {
  /**
   * **Validates: Requirements 4.2**
   *
   * For any user name (0–50 characters) and any quote from the pool,
   * the formatted morning reminder stripped of HTML tags shall have length ≤ 300 characters.
   */
  it('visible text (stripped of HTML) is at most 300 characters', async () => {
    const fc = await import('fast-check');
    const quotePool = getQuotePool();

    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(''),
          fc.constant(null),
          fc.string({ minLength: 1, maxLength: 50 })
        ),
        fc.integer({ min: 0, max: quotePool.length - 1 }),
        (name, quoteIndex) => {
          const quote = quotePool[quoteIndex];
          const result = formatMorningReminder({ name, quote });

          // Strip HTML tags to get visible text
          const visibleText = result.replace(/<[^>]*>/g, '');

          expect(visibleText.length).toBeLessThanOrEqual(300);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: daily-reminder-motivation, Property 9: Formatted message contains emoji', () => {
  /**
   * **Validates: Requirements 4.3**
   *
   * For any name and any quote from the pool,
   * the formatted morning reminder shall contain at least one emoji character.
   */
  it('message contains at least one emoji', async () => {
    const fc = await import('fast-check');
    const quotePool = getQuotePool();

    // Regex to match common emoji characters
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F3}\u{26F5}\u{26FA}\u{26FD}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}]/u;

    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(''),
          fc.constant(null),
          fc.string({ minLength: 1, maxLength: 50 })
        ),
        fc.integer({ min: 0, max: quotePool.length - 1 }),
        (name, quoteIndex) => {
          const quote = quotePool[quoteIndex];
          const result = formatMorningReminder({ name, quote });

          expect(emojiRegex.test(result)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: daily-reminder-motivation, Property 10: Name personalization correctness', () => {
  /**
   * **Validates: Requirements 4.4, 4.5**
   *
   * For any non-empty, non-null name string and any quote, the formatted morning reminder
   * shall contain that name in the greeting. For any empty or null name and any quote,
   * the formatted morning reminder shall use a generic greeting without any user-specific name.
   */
  it('non-empty name appears in the greeting', async () => {
    const fc = await import('fast-check');
    const quotePool = getQuotePool();

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 0, max: quotePool.length - 1 }),
        (name, quoteIndex) => {
          const quote = quotePool[quoteIndex];
          const result = formatMorningReminder({ name, quote });

          // The greeting portion (before the quote) should contain the name
          const greetingEnd = result.indexOf('💬');
          const greetingSection = result.substring(0, greetingEnd);

          // Name should be present in the greeting (HTML-escaped version)
          const escapedName = name
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          expect(greetingSection).toContain(escapedName);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty or null name uses generic greeting without user-specific name', async () => {
    const fc = await import('fast-check');
    const quotePool = getQuotePool();

    fc.assert(
      fc.property(
        fc.constantFrom('', null),
        fc.integer({ min: 0, max: quotePool.length - 1 }),
        (name, quoteIndex) => {
          const quote = quotePool[quoteIndex];
          const result = formatMorningReminder({ name, quote });

          // Should contain generic greeting "Selamat Pagi!" without a comma+name
          expect(result).toContain('Selamat Pagi!</b>');
          // Should NOT contain "Selamat Pagi, " (which would indicate a personalized greeting)
          expect(result).not.toContain('Selamat Pagi, ');
        }
      ),
      { numRuns: 100 }
    );
  });
});
