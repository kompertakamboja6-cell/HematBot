const { getUsersWithNotificationsEnabled, getTodayExpenses, getOrCreateUser } = require('./database');
const { formatRupiah, formatMorningReminder } = require('./formatter');
const { getRandomQuote, getQuotePool } = require('./quotes');

let lastSentMinute = null;
let lastSentMorning = null;

/**
 * Reset the scheduler state (for testing).
 */
function resetState() {
  lastSentMinute = null;
  lastSentMorning = null;
}

/**
 * Start the daily summary scheduler.
 * Checks every 60 seconds if it's 21:00 WIB and sends summaries to opted-in users.
 * @param {Object} bot - Telegraf bot instance
 * @returns {NodeJS.Timeout} interval ID (for testing/cleanup)
 */
function startScheduler(bot) {
  const intervalId = setInterval(() => {
    checkAndSend(bot);
    checkAndSendMorning(bot);
  }, 60 * 1000);

  return intervalId;
}

/**
 * Check if current time is 21:00 WIB and send summaries if so.
 * @param {Object} bot - Telegraf bot instance
 */
async function checkAndSend(bot) {
  const now = new Date();
  const jakartaTime = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
  const jakartaDate = new Date(jakartaTime);
  const hour = jakartaDate.getHours();
  const minute = jakartaDate.getMinutes();

  // Only send at 21:00 WIB
  if (hour !== 21 || minute !== 0) {
    lastSentMinute = null;
    return;
  }

  // Prevent sending multiple times in the same minute
  const currentKey = `${jakartaDate.getFullYear()}-${jakartaDate.getMonth()}-${jakartaDate.getDate()}-${hour}-${minute}`;
  if (lastSentMinute === currentKey) {
    return;
  }
  lastSentMinute = currentKey;

  // Get all users with notifications enabled
  const users = getUsersWithNotificationsEnabled();

  for (const user of users) {
    try {
      const summary = generateDailySummary(user.telegram_id);
      if (summary) {
        await bot.telegram.sendMessage(user.telegram_id, summary, { parse_mode: 'HTML' });
      }
    } catch (error) {
      console.error(`Failed to send daily summary to user ${user.telegram_id}:`, error.message);
    }
  }
}

/**
 * Generate daily summary message for a user.
 * @param {string} telegramId
 * @returns {string|null} Formatted summary or null if no expenses today
 */
function generateDailySummary(telegramId) {
  const expenses = getTodayExpenses(telegramId);

  if (!expenses || expenses.length === 0) {
    return null;
  }

  const user = getOrCreateUser(telegramId);
  const dailyLimit = user.daily_limit || 50000;
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const remaining = dailyLimit - total;

  // Top 3 expenses sorted by amount descending
  const topExpenses = [...expenses]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);

  let message = `📊 <b>Ringkasan Harian</b>\n\n`;
  message += `Hai! Ini rekap pengeluaranmu hari ini 👇\n\n`;
  message += `💰 Total belanja: ${formatRupiah(total)}\n`;
  message += `💵 Sisa limit: ${formatRupiah(remaining)}\n\n`;
  message += `🔝 <b>Pengeluaran terbesar:</b>\n`;

  topExpenses.forEach((expense, index) => {
    const note = expense.note || '(tanpa catatan)';
    message += `${index + 1}. ${formatRupiah(expense.amount)} — ${note}\n`;
  });

  if (remaining > 0) {
    message += `\n✨ Masih ada sisa — semangat hemat terus ya!`;
  } else {
    message += `\n⚠️ Limit harian sudah terpakai — besok semangat lagi ya!`;
  }

  return message;
}

/**
 * Check if current time is 07:00 WIB and send morning reminders if so.
 * @param {Object} bot - Telegraf bot instance
 */
async function checkAndSendMorning(bot) {
  const now = new Date();
  const jakartaTime = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
  const jakartaDate = new Date(jakartaTime);
  const hour = jakartaDate.getHours();
  const minute = jakartaDate.getMinutes();

  // Only send at 07:00 WIB
  if (hour !== 7 || minute !== 0) {
    lastSentMorning = null;
    return;
  }

  // Prevent sending multiple times in the same minute
  const year = jakartaDate.getFullYear();
  const month = String(jakartaDate.getMonth() + 1).padStart(2, '0');
  const day = String(jakartaDate.getDate()).padStart(2, '0');
  const currentKey = `morning-${year}-${month}-${day}-07-00`;
  if (lastSentMorning === currentKey) {
    return;
  }
  lastSentMorning = currentKey;

  // Get all users with notifications enabled
  let users;
  try {
    users = getUsersWithNotificationsEnabled();
  } catch (error) {
    console.error('Failed to fetch users for morning reminder:', error.message);
    return;
  }

  for (const user of users) {
    try {
      let quote;
      try {
        if (getQuotePool().length === 0) {
          quote = null;
        } else {
          quote = getRandomQuote(user.telegram_id);
        }
      } catch (quoteError) {
        quote = null;
      }

      let message;
      if (quote) {
        message = formatMorningReminder({ name: user.name, quote });
      } else {
        // Default message without quote
        const name = user.name;
        const greeting = name
          ? `🌅 <b>Selamat Pagi, ${name}!</b>`
          : '🌅 <b>Selamat Pagi!</b>';
        message = `${greeting}\n\n📝 Yuk, mulai catat pengeluaranmu hari ini!`;
      }

      await bot.telegram.sendMessage(user.telegram_id, message, { parse_mode: 'HTML' });
    } catch (error) {
      console.error(`Failed to send morning reminder to user ${user.telegram_id}:`, error.message);
    }
  }
}

module.exports = {
  startScheduler,
  generateDailySummary,
  checkAndSend,
  checkAndSendMorning,
  resetState,
};
