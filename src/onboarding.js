'use strict';

const { setDailyLimit, setOnboardingComplete, isOnboardingComplete, getBudgets } = require('./database');
const { buildKeyboard } = require('./keyboard');
const { formatRupiah } = require('./formatter');

const MIN_LIMIT = 1000;
const MAX_LIMIT = 10000000;

/**
 * Check if user needs onboarding.
 * @param {Object} user - User record from database
 * @returns {boolean}
 */
function needsOnboarding(user) {
  return !user || user.onboarding_complete !== 1;
}

/**
 * Get the onboarding welcome step response for a new user.
 * @param {string} telegramId
 * @param {string} firstName
 * @returns {{ text: string }}
 */
function getWelcomeStep(telegramId, firstName) {
  const greeting = firstName ? `Halo ${firstName}! 👋` : 'Halo! 👋';
  const welcome = `${greeting}\nSelamat datang di HematBot 🎉\n\nAku asisten keuangan pribadimu — bantu catat pengeluaran harian biar kamu lebih sadar ke mana uangmu pergi. Simpel, cepat, dan tanpa ribet! 💰`;

  const instruction = [
    '',
    '',
    'Yuk mulai dengan set limit harian kamu.',
    'Limit harian itu batas pengeluaran per hari yang kamu tentukan sendiri — ini bantu kamu tetap on track dan nggak kebablasan belanja. 📊',
    '',
    'Caranya gampang, ketik:',
    '`/limit 50000`',
    '',
    `Rentang yang bisa kamu pilih: ${formatRupiah(MIN_LIMIT)} - ${formatRupiah(MAX_LIMIT)}`,
    'Pilih angka yang realistis buat kebutuhan harianmu ya! 🙌',
  ].join('\n');

  return { text: welcome + instruction };
}

/**
 * Validate a limit value for onboarding.
 * @param {*} limit - The value to validate
 * @returns {{ valid: boolean, error?: string }}
 */
function validateLimit(limit) {
  if (typeof limit !== 'number' || isNaN(limit)) {
    return {
      valid: false,
      error: `Format tidak valid. Masukkan angka antara ${formatRupiah(MIN_LIMIT)} - ${formatRupiah(MAX_LIMIT)}.\nContoh: \`/limit 50000\``,
    };
  }
  if (limit < MIN_LIMIT || limit > MAX_LIMIT) {
    return {
      valid: false,
      error: `Nominal di luar rentang. Masukkan antara ${formatRupiah(MIN_LIMIT)} - ${formatRupiah(MAX_LIMIT)}.\nContoh: \`/limit 50000\``,
    };
  }
  return { valid: true };
}

/**
 * Handle limit set during onboarding, return next step.
 * @param {string} telegramId
 * @param {number} limit
 * @returns {{ text: string, keyboard?: object }}
 */
function handleLimitSet(telegramId, limit) {
  const validation = validateLimit(limit);
  if (!validation.valid) {
    return { text: validation.error };
  }

  setDailyLimit(telegramId, limit);

  const text = [
    `✅ Mantap! Limit harian kamu sudah di-set: ${formatRupiah(limit)}/hari`,
    '',
    'Langkah selanjutnya — mau buat budget kategori? 📂',
    '',
    'Budget itu kayak "amplop" virtual buat tiap jenis pengeluaran (misal: jajan, transport, makan). Dengan budget, kamu bisa pantau mana yang paling boros dan mana yang masih aman.',
    '',
    'Pilih opsi di bawah:',
  ].join('\n');

  const keyboard = buildKeyboard('onboarding_budget');

  return { text, keyboard };
}

/**
 * Handle budget creation step completion.
 * @param {string} telegramId
 * @param {'create'|'skip'} choice
 * @returns {{ text: string }}
 */
function handleBudgetStep(telegramId, choice) {
  setOnboardingComplete(telegramId);

  const budgets = getBudgets(telegramId);
  const budgetList = budgets.length > 0
    ? budgets.map(b => `• ${b.name}: ${formatRupiah(b.limit_amount)}`).join('\n')
    : 'Belum ada budget.';

  let text;
  if (choice === 'create') {
    text = [
      '🎉 Onboarding selesai! Kamu siap mulai hemat!',
      '',
      '📂 Buat budget kategori dengan perintah:',
      '`/buat <nama> <nominal>`',
      'Contoh: `/buat jajan 50k`',
      '',
      `Budget kamu saat ini:\n${budgetList}`,
      '',
      '💡 Tips: Sekarang coba catat pengeluaran pertamamu!',
      'Cukup ketik nominal dan keterangan, misal:',
      '`20 makan siang`',
      '',
      'Gampang kan? Selamat mencatat! ✨',
    ].join('\n');
  } else {
    text = [
      '🎉 Onboarding selesai! Kamu siap mulai hemat!',
      '',
      `Budget kamu saat ini:\n${budgetList}`,
      '',
      'Nanti kalau mau buat budget, tinggal ketik `/buat <nama> <nominal>` kapan aja ya.',
      '',
      '💡 Tips: Sekarang coba catat pengeluaran pertamamu!',
      'Cukup ketik nominal dan keterangan, misal:',
      '`20 makan siang`',
      '',
      'Gampang kan? Selamat mencatat! ✨',
    ].join('\n');
  }

  return { text };
}

module.exports = {
  needsOnboarding,
  getWelcomeStep,
  handleLimitSet,
  handleBudgetStep,
  validateLimit,
  MIN_LIMIT,
  MAX_LIMIT,
};
