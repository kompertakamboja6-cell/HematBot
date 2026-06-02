/**
 * Format amount to Indonesian Rupiah format.
 * Examples:
 *   5000   -> Rp5.000
 *   20000  -> Rp20.000
 *   150000 -> Rp150.000
 */

function formatRupiah(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return 'Rp0';
  }

  const num = Math.abs(amount);
  const formatted = num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `Rp${formatted}`;
}

function getDayName(dateStr) {
  const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const d = new Date(dateStr);
  return days[d.getDay()];
}

const PERIOD_LABELS = {
  daily: 'hari',
  weekly: 'minggu',
  monthly: 'bulan',
  yearly: 'tahun',
};

/**
 * Get Indonesian label for a budget period.
 * @param {string} period - One of: daily, weekly, monthly, yearly
 * @returns {string} Indonesian label
 */
function getPeriodLabel(period) {
  return PERIOD_LABELS[period] || period;
}

/**
 * Escape HTML special characters to prevent broken formatting.
 * @param {string} text - Raw text to escape
 * @returns {string} HTML-safe text
 */
function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escape Telegram Markdown special characters in user-provided text.
 * Prevents parse errors when names contain _ * or ` .
 * @param {string} text - Raw text
 * @returns {string} Markdown-safe text
 */
function escapeMarkdown(text) {
  return text.replace(/[_*[\]`]/g, '\\$&');
}

/**
 * Format morning reminder message with personalized greeting and motivational quote.
 * @param {Object} params
 * @param {string} params.name - User's name (may be empty/null)
 * @param {string} params.quote - Motivational quote text
 * @returns {string} HTML-formatted morning reminder message (max 300 visible chars)
 */
function formatMorningReminder({ name, quote }) {
  const greeting = name
    ? `🌅 <b>Selamat Pagi, ${escapeHtml(name)}!</b>`
    : '🌅 <b>Selamat Pagi!</b>';

  const quoteLine = `💬 "${quote}"`;
  const cta = '📝 Yuk, mulai catat pengeluaranmu hari ini!';

  return `${greeting}\n\n${quoteLine}\n\n${cta}`;
}

module.exports = { formatRupiah, getDayName, PERIOD_LABELS, getPeriodLabel, escapeHtml, escapeMarkdown, formatMorningReminder };