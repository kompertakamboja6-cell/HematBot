require('dotenv').config();
const { Telegraf } = require('telegraf');
const { parseExpense } = require('./parser');
const { formatRupiah, getDayName } = require('./formatter');
const {
  getOrCreateUser,
  setDailyLimit,
  createBudget,
  getBudgets,
  getBudgetByName,
  deleteBudget,
  addExpense,
  getTodayExpenses,
  getTodayTotal,
  getBudgetExpenses,
  getHistory,
  toSqliteDate,
} = require('./database');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN tidak ditemukan! Buat file .env dan isi BOT_TOKEN.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

/** helper: dapetin start/end date buat suatu period */
function getPeriodRange(period) {
  const now = new Date();
  let start, end;

  if (period === 'daily') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  } else if (period === 'monthly') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  } else if (period === 'yearly') {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear() + 1, 0, 1);
  }

  return { start: toSqliteDate(start), end: toSqliteDate(end) };
}

/** Helper: send expense response with overbudget warning */
async function sendExpenseResponse(ctx, amount, note, category, budgetName = null) {
  const telegramId = String(ctx.from.id);

  // Cek apakah budget name beneran ada
  let finalBudgetName = null;
  let budget = null;
  if (budgetName) {
    budget = getBudgetByName(telegramId, budgetName);
    if (budget) {
      finalBudgetName = budgetName;
    }
  }

  const expense = addExpense(telegramId, amount, category, note, finalBudgetName);
  const todayTotal = getTodayTotal(telegramId);
  const user = getOrCreateUser(telegramId);
  const limit = user.daily_limit;
  const sisa = limit - todayTotal;

  let response = `+ ${formatRupiah(amount)} tercatat`;

  if (note) {
    response += ` (${note})`;
  }
  if (budget) {
    response += ` [${budget.name}]`;
  }

  response += `\nTotal hari ini: ${formatRupiah(todayTotal)}`;
  response += `\nSisa budget: ${formatRupiah(sisa)}`;

  // Cek overbudget untuk budget spesifik kalo ada
  if (budget) {
    const range = getPeriodRange(budget.period);
    const budgetExpenses = getBudgetExpenses(telegramId, budget.id, range.start, range.end);
    const budgetTotal = budgetExpenses.reduce((s, e) => s + e.amount, 0);
    const budgetSisa = budget.limit_amount - budgetTotal;

    response += `\n\nBudget *${budget.name}*: ${formatRupiah(budgetTotal)} / ${formatRupiah(budget.limit_amount)}`;

    if (budgetTotal > budget.limit_amount) {
      response += `\n⚠️ *Budget ${budget.name} over limit!* 💸`;
    } else {
      response += `\nSisa *${budget.name}*: ${formatRupiah(budgetSisa)}`;
    }
  }

  if (todayTotal > limit) {
    response += `\n\n⚠️ *Limit harian terlewati!*\nHari ini: ${formatRupiah(todayTotal)} / ${formatRupiah(limit)}`;
    response += '\n\n_Dompet sedang mengalami critical damage._ 💸';
  } else if (sisa <= 5000) {
    response += `\n\n⚠️ Sisa budget tinggal ${formatRupiah(sisa)}. Bijak-bijaklah!`;
  }

  await ctx.reply(response, { parse_mode: 'Markdown' });
}

// Helper buat parse nominal (dipakai di /limit, /buat)
function parseNominal(text) {
  const match = text.match(/^(\d+)(k?)$/i);
  if (!match) return null;
  let val = parseInt(match[1], 10);
  if (match[2]?.toLowerCase() === 'k') val *= 1000;
  else if (val < 100) val *= 1000;
  return val;
}

// /start - Onboarding
bot.start(async (ctx) => {
  const telegramId = String(ctx.from.id);
  const name = ctx.from.first_name || '';
  getOrCreateUser(telegramId, name);

  const msg = [
    'Selamat datang di *HematBot*!',
    '',
    'Catat pengeluaran & pantau budget langsung dari chat.',
    '',
    '*Input cepat:*',
    '`20 makan` => Rp20.000 untuk makan',
    '`15 kopi jajan` => Rp15.000 kopi, budget "jajan"',
    '`50 bensin operasional` => Rp50.000 bensin, budget "operasional"',
    '',
    '*Budget kustom:*',
    '`/buat jajan 50k` => Budget jajan Rp50rb/hari',
    '`/buat operasional 300000 monthly` => Budget operasional Rp300rb/bulan',
    '',
    '*Commands:*',
    '`/limit 50000` => Set limit harian utama',
    '`/buat` => Buat budget baru',
    '`/budget` => Lihat semua budget',
    '`/hapus` => Hapus budget',
    '`/today` => Ringkasan hari ini',
    '`/history` => Riwayat 7 hari',
    '`/reset` => Reset hari ini',
    '',
    'Set limit dulu ya:',
    '`/limit 50000`',
    '',
    'Butuh panduan lengkap? Ketik `/help`',
  ].join('\n');

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /help - Help
bot.help(async (ctx) => {
  const msg = [
    '*HematBot - Panduan Lengkap* 🏦',
    '',
    'Aku bantu catat pengeluaran harian & pantau budget.',
    '',
    '━━━━━━━━━━━━━━━━━━',
    '*1. INPUT CEPAT*',
    '━━━━━━━━━━━━━━━━━━',
    '',
    'Cukup ketik `nomor keterangan [budget]`:',
    '• `20 makan` → Rp20.000, catatan: "makan"',
    '• `15k kopi` → Rp15.000, catatan: "kopi"',
    '• `25 nasi padang makan` → Rp25.000, catatan "nasi padang", budget "makan"',
    '• `50 bensin operasional` → Rp50.000, catatan "bensin", budget "operasional"',
    '',
    'Aturan angka:',
    '• `20` → Rp20.000 (angka <100 otomatis x1000)',
    '• `20k` → Rp20.000',
    '• `20000` → Rp20.000',
    '',
    '━━━━━━━━━━━━━━━━━━',
    '*2. BIKIN BUDGET*',
    '━━━━━━━━━━━━━━━━━━',
    '',
    '`/buat <nama> <nominal> [period]`',
    '',
    'Period: `daily` (default), `monthly`, `yearly`',
    '',
    'Contoh:',
    '• `/buat jajan 50k`',
    '  => Budget jajan Rp50.000/hari',
    '• `/buat makan 100000`',
    '  => Budget makan Rp100.000/hari',
    '• `/buat operasional 300000 monthly`',
    '  => Budget operasional Rp300.000/bulan',
    '• `/buat listrik 1200000 yearly`',
    '  => Budget listrik Rp1.200.000/tahun',
    '',
    'Nama budget `daily`/`monthly`/`yearly` reserved.',
    '',
    '━━━━━━━━━━━━━━━━━━',
    '*3. CEK BUDGET*',
    '━━━━━━━━━━━━━━━━━━',
    '',
    '`/budget` => Lihat semua budget + sisa masing-masing',
    '`/hapus <nama>` => Hapus budget (contoh: /hapus jajan)',
    '',
    '━━━━━━━━━━━━━━━━━━',
    '*4. LAPORAN*',
    '━━━━━━━━━━━━━━━━━━',
    '',
    '`/today` => Ringkasan pengeluaran hari ini + sisa limit',
    '`/history` => Riwayat 7 hari terakhir',
    '`/limit [nominal]` => Set/lihat limit harian utama',
    '',
    '━━━━━━━━━━━━━━━━━━',
    '*5. LAINNYA*',
    '━━━━━━━━━━━━━━━━━━',
    '',
    '`/reset` => Hapus semua pengeluaran hari ini',
    '`/start` => Tampilkan pesan selamat datang',
    '`/help` => Panduan ini',
    '',
    '━━━━━━━━━━━━━━━━━━',
    '*CONTOH SKENARIO*',
    '━━━━━━━━━━━━━━━━━━',
    '',
    '1. Set limit: `/limit 50000`',
    '2. Buat budget: `/buat jajan 50k` dan `/buat operasional 300k monthly`',
    '3. Catat: `15 kopi jajan` => otomatis masuk budget "jajan"',
    '4. Catat: `50 bensin operasional` => otomatis masuk budget "operasional"',
    '5. Cek: `/budget` => lihat sisa jajan & operasional',
  ].join('\n');

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /limit <amount> - Set daily limit
bot.command('limit', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const text = ctx.message.text.replace('/limit', '').trim();

  if (!text) {
    await ctx.reply('Gunakan: /limit 50000');
    return;
  }

  const val = parseNominal(text);
  if (!val || val < 1000 || val > 10_000_000) {
    await ctx.reply('Nominal tidak valid. Contoh: /limit 50000 atau /limit 50k');
    return;
  }

  setDailyLimit(telegramId, val);
  await ctx.reply(`Limit harian diubah menjadi ${formatRupiah(val)}`);
});

// /buat <nama> <nominal> [period] - Create custom budget
bot.command('buat', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const text = ctx.message.text.replace('/buat', '').trim();

  if (!text) {
    await ctx.reply('Gunakan: /buat <nama> <nominal> [period]\nContoh: /buat jajan 50k\nAtau: /buat transport 200000 monthly');
    return;
  }

  // Parse: nama bisa 1 kata atau dipisah. ambil nomor dari kata terakhir atau kedua-terakhir
  const words = text.split(/\s+/);

  let period = 'daily';
  let name, nominalStr;

  if (['daily', 'monthly', 'yearly'].includes(words[words.length - 1])) {
    period = words.pop();
  }

  // Cari nominal di kata terakhir
  const lastWord = words[words.length - 1];
  const val = parseNominal(lastWord);

  if (!val) {
    await ctx.reply('Nominal tidak ditemukan. Contoh: /buat jajan 50k');
    return;
  }

  // Hapus kata nominal
  words.pop();
  name = words.join(' ');

  if (!name) {
    await ctx.reply('Nama budget tidak boleh kosong. Contoh: /buat jajan 50k');
    return;
  }

  if (val < 100 || val > 10_000_000) {
    await ctx.reply('Nominal harus antara Rp1.000 - Rp10.000.000');
    return;
  }

  try {
    createBudget(telegramId, name, val, period);
    const periodLabel = { daily: 'hari', monthly: 'bulan', yearly: 'tahun' }[period] || period;
    await ctx.reply(`Budget *${name}* dibuat: ${formatRupiah(val)}/${periodLabel} ✅`, { parse_mode: 'Markdown' });
  } catch (err) {
    if (err.message === 'Budget sudah ada') {
      await ctx.reply(`Budget "${name}" sudah ada. Gunakan /hapus ${name} dulu kalo mau ganti.`);
    } else {
      throw err;
    }
  }
});

// /budget - List all budgets
bot.command('budget', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const budgets = getBudgets(telegramId);

  if (budgets.length === 0) {
    await ctx.reply('Belum ada budget kustom. Buat dengan:\n`/buat jajan 50k`', { parse_mode: 'Markdown' });
    return;
  }

  let response = `*Budget kamu:*\n\n`;
  budgets.forEach((b) => {
    const range = getPeriodRange(b.period);
    const expenses = getBudgetExpenses(telegramId, b.id, range.start, range.end);
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const sisa = b.limit_amount - total;
    const periodLabel = { daily: 'hari', monthly: 'bulan', yearly: 'tahun' }[b.period] || b.period;
    const overLimit = total > b.limit_amount ? ' ⚠️ OVER!' : '';

    response += `*${b.name}*: ${formatRupiah(total)} / ${formatRupiah(b.limit_amount)}/${periodLabel}${overLimit}\n`;
    if (total <= b.limit_amount) {
      response += `  Sisa: ${formatRupiah(sisa)}\n`;
    }
    response += '\n';
  });

  await ctx.reply(response, { parse_mode: 'Markdown' });
});

// /hapus <nama> - Delete a budget
bot.command('hapus', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const text = ctx.message.text.replace('/hapus', '').trim();

  if (!text) {
    await ctx.reply('Gunakan: /hapus <nama>\nContoh: /hapus jajan');
    return;
  }

  const deleted = deleteBudget(telegramId, text);
  if (deleted) {
    await ctx.reply(`Budget "${text}" berhasil dihapus.`);
  } else {
    await ctx.reply(`Budget "${text}" tidak ditemukan.`);
  }
});

// /today - Daily summary
bot.command('today', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const user = getOrCreateUser(telegramId);
  const expenses = getTodayExpenses(telegramId);
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const sisa = user.daily_limit - total;

  if (expenses.length === 0) {
    await ctx.reply(`Belum ada pengeluaran hari ini. Limit: ${formatRupiah(user.daily_limit)}`);
    return;
  }

  let response = `*Pengeluaran hari ini:*\n\n`;
  expenses.forEach((e) => {
    const label = e.note || e.category || 'tanpa keterangan';
    const budgetTag = e.budget_name ? ` [${e.budget_name}]` : '';
    response += `• ${label}: ${formatRupiah(e.amount)}${budgetTag}\n`;
  });

  response += `\n*Total:* ${formatRupiah(total)}`;
  response += `\n*Sisa:* ${formatRupiah(sisa)}`;
  response += `\n*Limit:* ${formatRupiah(user.daily_limit)}`;

  if (total > user.daily_limit) {
    response += `\n\n⚠️ *Limit terlewati!* Dompet sedang mengalami critical damage. 💸`;
  }

  await ctx.reply(response, { parse_mode: 'Markdown' });
});

// /history - Weekly history
bot.command('history', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const user = getOrCreateUser(telegramId);
  const rows = getHistory(telegramId, 7);

  if (rows.length === 0) {
    await ctx.reply('Belum ada data pengeluaran.');
    return;
  }

  let response = `*7 hari terakhir:*\n\n`;
  rows.forEach((row) => {
    const dayName = getDayName(row.day);
    const total = row.total || 0;
    const overLimit = total > user.daily_limit ? ' ⚠️' : '';
    response += `${dayName}: ${formatRupiah(total)}${overLimit}\n`;
  });

  await ctx.reply(response, { parse_mode: 'Markdown' });
});

// /reset - Manual reset (delete today's expenses)
bot.command('reset', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const { getDatabase } = require('./database');
  const db = getDatabase();
  const user = getOrCreateUser(telegramId);
  const today = new Date();
  const startOfDay = toSqliteDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const endOfDay = toSqliteDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));

  db.prepare('DELETE FROM expenses WHERE user_id = ? AND created_at >= ? AND created_at < ?').run(user.id, startOfDay, endOfDay);
  await ctx.reply('Data pengeluaran hari ini telah direset. Semangat lagi! 💪');
});

// Handle text input (non-command) as expense
bot.on('text', async (ctx) => {
  // Ignore commands
  if (ctx.message.text.startsWith('/')) {
    return;
  }

  const telegramId = String(ctx.from.id);

  // Parse expense
  const parsed = parseExpense(ctx.message.text);
  if (!parsed) {
    await ctx.reply(
      'Format tidak dikenali. Contoh:\n`20 makan`\n`15k kopi`\n`20000 parkir`\n`15 bensin transport`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await sendExpenseResponse(ctx, parsed.amount, parsed.note, '', parsed.budget);
});

// Error handler
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
  ctx.reply('Maaf, terjadi error. Coba lagi ya.').catch(() => {});
});

// Start bot
function startBot() {
  console.log('HematBot is running...');
  bot.launch();

  // Graceful shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = { startBot, bot };

// If running directly
if (require.main === module) {
  startBot();
}