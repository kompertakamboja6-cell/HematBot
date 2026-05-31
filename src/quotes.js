/**
 * Quote Pool Module
 * Provides motivational quotes in Bahasa Indonesia with no-repeat selection per user.
 */

const QUOTES = [
  'Langkah kecil hari ini, hemat besar di masa depan 💪',
  'Catat dulu, hemat kemudian. Kamu pasti bisa! ✨',
  'Setiap rupiah yang dicatat adalah langkah menuju kebebasan finansial 🎯',
  'Hari baru, semangat baru! Yuk jaga pengeluaranmu 🌟',
  'Nabung itu bukan soal besar kecil, tapi konsisten 💰',
  'Kamu sudah hebat karena mau mencatat. Lanjutkan! 🔥',
  'Budget terjaga, hati tenang. Semangat hari ini! 😊',
  'Pengeluaran tercatat = keuangan terkontrol. Kamu bisa! 📊',
  'Satu catatan hari ini, seribu manfaat di kemudian hari 📝',
  'Hemat bukan pelit, tapi bijak mengelola uang 🧠',
  'Hari ini catat, besok syukur. Mulai dari sekarang! 🌈',
  'Setiap pengeluaran yang tercatat membawamu lebih dekat ke tujuan 🎯',
  'Jangan tunda mencatat — kebiasaan baik dimulai hari ini 💫',
  'Uang yang tercatat adalah uang yang terjaga. Semangat! 💪',
  'Konsisten mencatat = konsisten berhemat. Kamu luar biasa! ⭐',
];

/**
 * Per-user last-sent quote index tracking.
 * @type {Map<string, number>}
 */
const lastQuoteIndex = new Map();

/**
 * Get a random quote that differs from the last one sent to this user.
 * @param {string} userId - Telegram ID of the user
 * @returns {string} Selected motivational quote text
 */
function getRandomQuote(userId) {
  const lastIndex = lastQuoteIndex.get(userId) ?? -1;

  let newIndex;
  if (QUOTES.length <= 1) {
    newIndex = 0;
  } else {
    do {
      newIndex = Math.floor(Math.random() * QUOTES.length);
    } while (newIndex === lastIndex);
  }

  lastQuoteIndex.set(userId, newIndex);
  return QUOTES[newIndex];
}

/**
 * Get the full quote pool array (for testing).
 * @returns {string[]} Array of all quotes
 */
function getQuotePool() {
  return QUOTES;
}

/**
 * Reset the last-sent tracking (for testing).
 */
function resetQuoteState() {
  lastQuoteIndex.clear();
}

module.exports = {
  getRandomQuote,
  getQuotePool,
  resetQuoteState,
};
