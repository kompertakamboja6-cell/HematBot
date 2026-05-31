require('dotenv').config();
const { Telegraf } = require('telegraf');
const { parseExpense } = require('./parser');
const { formatRupiah, getDayName, getPeriodLabel } = require('./formatter');
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
  isOnboardingComplete,
  deleteExpenseById,
  getExpenseById,
  getShortcuts,
  deleteShortcut,
  createShortcut,
  countShortcuts,
  getShortcutByName,
  setNotificationEnabled,
  getNotificationSettings,
} = require('./database');
const { needsOnboarding, getWelcomeStep, handleLimitSet, handleBudgetStep, validateLimit } = require('./onboarding');
const { createConfirmation, resolveConfirmation, isValid } = require('./confirmation');
const { buildKeyboard, buildUndoKeyboard } = require('./keyboard');

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
  } else if (period === 'weekly') {
    const dayOfWeek = now.getDay(); // 0=Minggu, 1=Senin, ..., 6=Sabtu
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  } else if (period === 'monthly') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  } else if (period === 'yearly') {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear() + 1, 0, 1);
  }

  return { start: toSqliteDate(start), end: toSqliteDate(end) };
}

/** Helper: send expense response with overbudget warning and undo button */
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

  let response = `✅ Tercatat! *${formatRupiah(amount)}*`;

  if (note) {
    response += ` — ${note}`;
  }
  if (budget) {
    response += ` 📁 [${budget.name}]`;
  }

  response += `\n\n📊 *Ringkasan hari ini:*`;
  response += `\n• Total: ${formatRupiah(todayTotal)}`;
  response += sisa >= 0
    ? `\n• Sisa limit: ${formatRupiah(sisa)}`
    : `\n• Over limit: -${formatRupiah(Math.abs(sisa))}`;

  // Cek overbudget untuk budget spesifik kalo ada
  if (budget) {
    const range = getPeriodRange(budget.period);
    const budgetExpenses = getBudgetExpenses(telegramId, budget.id, range.start, range.end);
    const budgetTotal = budgetExpenses.reduce((s, e) => s + e.amount, 0);
    const budgetSisa = budget.limit_amount - budgetTotal;

    response += `\n\n📁 *Budget ${budget.name}:*`;
    response += `\n• Terpakai: ${formatRupiah(budgetTotal)} / ${formatRupiah(budget.limit_amount)}`;

    if (budgetTotal > budget.limit_amount) {
      response += `\n⚠️ *Budget ${budget.name} sudah melewati limit.* Gak apa-apa, besok bisa lebih dijaga ya! 💪`;
    } else {
      response += `\n• Sisa: ${formatRupiah(budgetSisa)}`;
    }
  }

  if (todayTotal > limit) {
    response += `\n\n⚠️ *Limit harian terlewati*\nHari ini: ${formatRupiah(todayTotal)} / ${formatRupiah(limit)}`;
    response += '\n\n_Tenang, ini pengingat supaya besok bisa lebih terkontrol._ Kamu pasti bisa! 💪';
  } else if (sisa <= 5000) {
    response += `\n\n💡 Sisa budget tinggal ${formatRupiah(sisa)}. Kamu sudah hampir di ujung limit — semangat hemat sampai akhir hari! 🌟`;
  }

  // Include undo keyboard
  const undoKeyboard = buildUndoKeyboard(expense.id, Date.now());

  await ctx.reply(response, { parse_mode: 'Markdown', ...undoKeyboard });

  // Create pending confirmation with 30s TTL for undo
  createConfirmation(telegramId, 'undo', { expenseId: expense.id, amount, note }, 30);
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
  const user = getOrCreateUser(telegramId, name);

  if (needsOnboarding(user)) {
    // New user: trigger onboarding flow
    const step = getWelcomeStep(telegramId, name);
    await ctx.reply(step.text, { parse_mode: 'Markdown' });
  } else {
    // Existing user: show welcome + active settings summary
    const budgets = getBudgets(telegramId);
    const budgetList = budgets.length > 0
      ? budgets.map(b => `• ${b.name}: ${formatRupiah(b.limit_amount)}`).join('\n')
      : 'Belum ada budget.';

    const msg = [
      `Hai ${name}! Senang ketemu lagi 👋`,
      '',
      'Ini ringkasan pengaturan kamu saat ini:',
      '',
      '💰 *Limit harian:*',
      `${formatRupiah(user.daily_limit)}`,
      '',
      `📋 *Budget:*\n${budgetList}`,
      '',
      'Langsung catat pengeluaran atau ketik `/help` kalau butuh panduan. Semangat hemat hari ini! 🌟',
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  }
});

// /help - Help
bot.help(async (ctx) => {
  const msg = [
    '🏦 *Hai! Ini panduan lengkap HematBot*',
    '',
    'Aku teman kecilmu buat catat pengeluaran dan jaga budget tetap sehat. Yuk kenalan sama fitur-fiturnya!',
    '',
    '📝 *Catat Pengeluaran*',
    '',
    'Tinggal ketik angka + keterangan, langsung tercatat:',
    '• `20 makan` → Rp20.000, catatan "makan"',
    '• `15k kopi` → Rp15.000, catatan "kopi"',
    '• `25 nasi padang makan` → Rp25.000, catatan "nasi padang", masuk budget "makan"',
    '• `50 bensin transport` → Rp50.000, catatan "bensin", masuk budget "transport"',
    '',
    '💡 *Tips angka:*',
    '• `20` → otomatis jadi Rp20.000 (angka di bawah 100 dikali 1000)',
    '• `20k` → Rp20.000',
    '• `20000` → Rp20.000',
    '',
    '📊 *Bikin Budget*',
    '',
    'Atur limit pengeluaran per kategori:',
    '`/buat <nama> <nominal> [period]`',
    '',
    'Period yang tersedia: `daily` (harian), `weekly` (mingguan), `monthly` (bulanan), `yearly` (tahunan)',
    'Kalau nggak disebut, default-nya `daily`.',
    '',
    'Contoh:',
    '• `/buat jajan 50k` → Budget jajan Rp50.000/hari',
    '• `/buat makan 200k weekly` → Budget makan Rp200.000/minggu (Senin–Minggu)',
    '• `/buat transport 300k monthly` → Budget transport Rp300.000/bulan',
    '• `/buat listrik 1200k yearly` → Budget listrik Rp1.200.000/tahun',
    '',
    '⚠️ Nama `daily`, `weekly`, `monthly`, `yearly` nggak bisa dipakai sebagai nama budget ya.',
    '',
    '👀 *Cek & Kelola Budget*',
    '',
    '• `/budget` → Lihat semua budget dan sisa masing-masing',
    '• `/hapus <nama>` → Hapus budget (contoh: `/hapus jajan`)',
    '',
    '📈 *Laporan & Limit*',
    '',
    '• `/today` → Ringkasan pengeluaran hari ini + sisa limit',
    '• `/history` → Riwayat 7 hari terakhir',
    '• `/limit <nominal>` → Atur limit harian (contoh: `/limit 50k`)',
    '',
    '⚡ *Shortcut (Pengeluaran Cepat)*',
    '',
    '• `/simpan <nama> <nominal> <catatan> [budget]` → Simpan shortcut',
    '  Contoh: `/simpan kopi 15k kopi pagi jajan`',
    '• `/q <nama>` → Pakai shortcut (contoh: `/q kopi`)',
    '• `/shortcuts` → Lihat daftar shortcut',
    '',
    '🔧 *Lainnya*',
    '',
    '• `/reset` → Hapus semua pengeluaran hari ini',
    '• `/start` → Tampilkan pesan selamat datang',
    '• `/help` → Panduan ini',
    '',
    '🎯 *Contoh Alur Pemakaian*',
    '',
    '1️⃣ Atur limit harian: `/limit 100k`',
    '2️⃣ Bikin budget: `/buat jajan 50k` dan `/buat makan 200k weekly`',
    '3️⃣ Catat pengeluaran: `15 kopi jajan`',
    '4️⃣ Cek sisa budget: `/budget`',
    '5️⃣ Lihat ringkasan: `/today`',
    '',
    'Semoga membantu! Kalau bingung, ketik `/help` kapan aja ya 😊',
  ].join('\n');

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /limit <amount> - Set daily limit
bot.command('limit', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const text = ctx.message.text.replace('/limit', '').trim();

  if (!text) {
    await ctx.reply(
      '📝 Untuk set limit harian, ketik nominal setelah /limit.\n\n' +
      'Format: `/limit <nominal>`\n\n' +
      'Contoh:\n' +
      '• `/limit 50000` → Rp50.000/hari\n' +
      '• `/limit 50k` → Rp50.000/hari\n' +
      '• `/limit 100k` → Rp100.000/hari',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const val = parseNominal(text);

  // Check if user is in onboarding
  if (!isOnboardingComplete(telegramId)) {
    // Use onboarding validation and flow
    const validation = validateLimit(val);
    if (!validation.valid) {
      await ctx.reply(validation.error, { parse_mode: 'Markdown' });
      return;
    }

    const step = handleLimitSet(telegramId, val);
    const opts = { parse_mode: 'Markdown' };
    if (step.keyboard) {
      opts.reply_markup = step.keyboard.reply_markup;
    }
    await ctx.reply(step.text, opts);
    return;
  }

  // Normal flow for existing users
  if (!val || val < 1000 || val > 10_000_000) {
    await ctx.reply(
      '⚠️ Nominal yang kamu masukkan belum sesuai.\n\n' +
      'Rentang valid: *Rp1.000 – Rp10.000.000*\n\n' +
      'Contoh:\n' +
      '• `/limit 50000` → Rp50.000/hari\n' +
      '• `/limit 50k` → Rp50.000/hari',
      { parse_mode: 'Markdown' }
    );
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
    await ctx.reply(
      '📝 Untuk membuat budget, ketik nama, nominal, dan period (opsional).\n\n' +
      'Format: `/buat <nama> <nominal> [period]`\n\n' +
      'Contoh:\n' +
      '• `/buat jajan 50k` → Rp50.000/hari\n' +
      '• `/buat transport 200k weekly` → Rp200.000/minggu\n' +
      '• `/buat makan 500k monthly` → Rp500.000/bulan\n\n' +
      'Period tersedia: `daily` (default), `weekly`, `monthly`, `yearly`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Parse: nama bisa 1 kata atau dipisah. ambil nomor dari kata terakhir atau kedua-terakhir
  const words = text.split(/\s+/);

  let period = 'daily';
  let name, nominalStr;

  if (['daily', 'weekly', 'monthly', 'yearly'].includes(words[words.length - 1])) {
    period = words.pop();
  }

  // Cari nominal di kata terakhir
  const lastWord = words[words.length - 1];
  const val = parseNominal(lastWord);

  if (!val) {
    await ctx.reply(
      '🔢 Hmm, aku belum menemukan nominalnya.\n\n' +
      'Format: `/buat <nama> <nominal> [period]`\n\n' +
      'Contoh:\n' +
      '• `/buat jajan 50k`\n' +
      '• `/buat makan 100000`\n' +
      '• `/buat transport 200k weekly`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Hapus kata nominal
  words.pop();
  name = words.join(' ');

  if (!name) {
    await ctx.reply(
      '📛 Nama budget belum diisi nih.\n\n' +
      'Format: `/buat <nama> <nominal> [period]`\n\n' +
      'Contoh:\n' +
      '• `/buat jajan 50k`\n' +
      '• `/buat transport 200k weekly`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Reserved words cannot be used as budget names
  const reservedNames = ['daily', 'weekly', 'monthly', 'yearly'];
  if (reservedNames.includes(name.toLowerCase())) {
    await ctx.reply(
      `⚠️ Nama "${name}" tidak bisa dipakai karena sudah digunakan sebagai nama period.\n\n` +
      'Coba gunakan nama lain, misalnya:\n' +
      '• `/buat jajan 50k`\n' +
      '• `/buat makan 100k weekly`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (val < 100 || val > 10_000_000) {
    await ctx.reply(
      '⚠️ Nominal di luar rentang yang diperbolehkan.\n\n' +
      'Rentang valid: *Rp1.000 – Rp10.000.000*\n\n' +
      'Contoh:\n' +
      '• `/buat jajan 50k` → Rp50.000\n' +
      '• `/buat makan 500000` → Rp500.000',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  try {
    createBudget(telegramId, name, val, period);
    const periodLabel = getPeriodLabel(period);
    await ctx.reply(`Budget *${name}* dibuat: ${formatRupiah(val)}/${periodLabel} ✅`, { parse_mode: 'Markdown' });
  } catch (err) {
    if (err.message === 'Budget sudah ada') {
      await ctx.reply(
        `⚠️ Budget "*${name}*" sudah ada.\n\n` +
        'Kamu bisa:\n' +
        `• Hapus dulu dengan \`/hapus ${name}\`, lalu buat ulang\n` +
        '• Atau buat budget dengan nama lain',
        { parse_mode: 'Markdown' }
      );
    } else {
      throw err;
    }
  }
});

// /budget - List all budgets
bot.command('budget', async (ctx) => {
  const telegramId = String(ctx.from.id);
  await sendBudgetResponse(ctx, telegramId);
});

/** Helper: send /budget response (reused by menu callback) */
async function sendBudgetResponse(ctx, telegramId) {
  const budgets = getBudgets(telegramId);
  const keyboard = buildKeyboard('budget');

  if (budgets.length === 0) {
    await ctx.reply('📂 Belum ada budget yang dibuat nih.\n\nYuk mulai atur keuangan dengan:\n`/buat jajan 50k`', { parse_mode: 'Markdown', ...keyboard });
    return;
  }

  let response = `📊 *Daftar Budget Kamu*\n\n`;
  budgets.forEach((b) => {
    const range = getPeriodRange(b.period);
    const expenses = getBudgetExpenses(telegramId, b.id, range.start, range.end);
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const sisa = b.limit_amount - total;
    const periodLabel = getPeriodLabel(b.period);
    const overLimit = total > b.limit_amount ? ' ⚠️ Over!' : '';

    response += `💰 *${b.name}*: ${formatRupiah(total)} / ${formatRupiah(b.limit_amount)}/${periodLabel}${overLimit}\n`;
    if (total <= b.limit_amount) {
      response += `   Sisa: ${formatRupiah(sisa)}\n`;
    }
    response += '\n';
  });

  response += `Kelola budget: /buat atau /hapus`;

  await ctx.reply(response, { parse_mode: 'Markdown', ...keyboard });
}

// /hapus <nama> - Delete a budget (with confirmation)
bot.command('hapus', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const text = ctx.message.text.replace('/hapus', '').trim();

  if (!text) {
    await ctx.reply(
      '📝 Untuk menghapus budget, ketik nama budget setelah /hapus.\n\n' +
      'Format: `/hapus <nama>`\n\n' +
      'Contoh: `/hapus jajan`\n\n' +
      'Gunakan `/budget` untuk melihat daftar budget kamu.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const budget = getBudgetByName(telegramId, text);

  if (!budget) {
    // Budget not found: show error with list of available budgets
    const budgets = getBudgets(telegramId);
    let response = `🔍 Budget "${text}" tidak ditemukan.`;
    if (budgets.length > 0) {
      const names = budgets.map((b) => `• ${b.name}`).join('\n');
      response += `\n\nBudget yang tersedia:\n${names}\n\nContoh: \`/hapus ${budgets[0].name}\``;
    } else {
      response += '\n\nKamu belum punya budget. Buat dulu dengan `/buat <nama> <nominal>`';
    }
    await ctx.reply(response, { parse_mode: 'Markdown' });
    return;
  }

  // Budget exists: show confirmation with details
  const periodLabel = getPeriodLabel(budget.period);
  const confirmMsg = `Hapus budget *${budget.name}*?\n\nLimit: ${formatRupiah(budget.limit_amount)}/${periodLabel}\nPeriode: ${periodLabel}`;

  const keyboard = buildKeyboard('confirm_delete', { budgetName: budget.name });
  const sentMsg = await ctx.reply(confirmMsg, { parse_mode: 'Markdown', ...keyboard });

  // Create confirmation with 60s TTL
  const confirmationId = createConfirmation(telegramId, 'delete_budget', { budgetName: budget.name }, 60);

  // Set timeout to auto-cancel after 60s
  const timeoutTimer = setTimeout(async () => {
    try {
      const result = resolveConfirmation(confirmationId, false);
      // If result is null, it was already resolved (confirmed or cancelled by user)
      if (result === null) return;

      await ctx.telegram.editMessageReplyMarkup(
        sentMsg.chat.id,
        sentMsg.message_id,
        undefined,
        { inline_keyboard: [] }
      );
      await ctx.telegram.editMessageText(
        sentMsg.chat.id,
        sentMsg.message_id,
        undefined,
        `${confirmMsg}\n\n⏰ Konfirmasi kedaluwarsa. Penghapusan dibatalkan.`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      // Ignore errors (message may have been deleted, etc.)
    }
  }, 60000);

  if (timeoutTimer.unref) {
    timeoutTimer.unref();
  }

  // Store timeout reference for cleanup
  if (!ctx._hapusTimeouts) ctx._hapusTimeouts = new Map();
  ctx._hapusTimeouts.set(confirmationId, timeoutTimer);
});

// Handle /hapus confirmation callbacks (del:<budgetName>:yes / del:<budgetName>:no)
bot.action(/^del:(.+):(yes|no)$/, async (ctx) => {
  try {
    const telegramId = String(ctx.from.id);
    const budgetName = ctx.match[1];
    const confirmed = ctx.match[2] === 'yes';

    // Disable the inline keyboard
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (e) {
      // Ignore if already edited
    }

    if (confirmed) {
      // Confirm: delete the budget
      const deleted = deleteBudget(telegramId, budgetName);
      if (deleted) {
        await ctx.answerCbQuery('Budget berhasil dihapus');
        await ctx.editMessageText(`Budget *${budgetName}* berhasil dihapus. ✅`, { parse_mode: 'Markdown' });
      } else {
        await ctx.answerCbQuery('Budget tidak ditemukan');
        await ctx.editMessageText(`Budget "${budgetName}" tidak ditemukan atau sudah dihapus.`);
      }
    } else {
      // Cancel: show cancelled message
      await ctx.answerCbQuery('Penghapusan dibatalkan');
      await ctx.editMessageText(`Penghapusan budget *${budgetName}* dibatalkan. Data tetap aman. 👍`, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    console.error('Error handling del callback:', err);
    await ctx.answerCbQuery('Terjadi kesalahan. Silakan coba lagi.', { show_alert: true }).catch(() => {});
  }
});

// /menu - Show main menu with inline keyboard
bot.command('menu', async (ctx) => {
  const keyboard = buildKeyboard('menu');
  await ctx.reply('Pilih menu:', { ...keyboard });
});

// /today - Daily summary
bot.command('today', async (ctx) => {
  const telegramId = String(ctx.from.id);
  await sendTodayResponse(ctx, telegramId);
});

/** Helper: send /today response (reused by menu callback) */
async function sendTodayResponse(ctx, telegramId) {
  const user = getOrCreateUser(telegramId);
  const expenses = getTodayExpenses(telegramId);
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const sisa = user.daily_limit - total;
  const keyboard = buildKeyboard('today');

  if (expenses.length === 0) {
    await ctx.reply(`📋 Hari ini belum ada pengeluaran.\n\n💰 Limit harian kamu: ${formatRupiah(user.daily_limit)}\n\nCatat pengeluaran dengan ketik nominal dan keterangan, misal: \`25 makan siang\``, { parse_mode: 'Markdown', ...keyboard });
    return;
  }

  let response = `📋 *Pengeluaran Hari Ini*\n\n`;
  expenses.forEach((e) => {
    const label = e.note || e.category || 'tanpa keterangan';
    const budgetTag = e.budget_name ? ` [${e.budget_name}]` : '';
    response += `• ${label}: ${formatRupiah(e.amount)}${budgetTag}\n`;
  });

  response += `\n━━━━━━━━━━━━━━━━━━`;
  response += `\n💸 *Total:* ${formatRupiah(total)}`;
  response += sisa >= 0
    ? `\n💰 *Sisa:* ${formatRupiah(sisa)}`
    : `\n💰 *Over:* -${formatRupiah(Math.abs(sisa))}`;
  response += `\n📏 *Limit:* ${formatRupiah(user.daily_limit)}`;

  if (total > user.daily_limit) {
    response += `\n\n⚠️ *Limit harian terlewati* — tapi gak apa-apa, yang penting kamu tetap tracking. Besok semangat lagi! 💪`;
  }

  await ctx.reply(response, { parse_mode: 'Markdown', ...keyboard });
}

// /history - Weekly history
bot.command('history', async (ctx) => {
  const telegramId = String(ctx.from.id);
  await sendHistoryResponse(ctx, telegramId);
});

/** Helper: send /history response (reused by menu callback) */
async function sendHistoryResponse(ctx, telegramId) {
  const user = getOrCreateUser(telegramId);
  const rows = getHistory(telegramId, 7);
  const keyboard = buildKeyboard('history');

  if (rows.length === 0) {
    await ctx.reply('📅 Belum ada riwayat pengeluaran.\n\nMulai catat pengeluaran dan cek lagi nanti ya!', { ...keyboard });
    return;
  }

  let response = `📅 *Riwayat 7 Hari Terakhir*\n\n`;
  let weekTotal = 0;
  rows.forEach((row) => {
    const dayName = getDayName(row.day);
    const total = row.total || 0;
    weekTotal += total;
    const overLimit = total > user.daily_limit ? ' ⚠️' : '';
    response += `${dayName}: ${formatRupiah(total)}${overLimit}\n`;
  });

  response += `\n━━━━━━━━━━━━━━━━━━`;
  response += `\n💸 *Total 7 hari:* ${formatRupiah(weekTotal)}`;
  response += `\n📏 *Limit harian:* ${formatRupiah(user.daily_limit)}`;

  await ctx.reply(response, { parse_mode: 'Markdown', ...keyboard });
}

// /reset - Manual reset with confirmation flow
bot.command('reset', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const expenses = getTodayExpenses(telegramId);
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  if (expenses.length === 0) {
    await ctx.reply('Tidak ada pengeluaran hari ini yang bisa direset.');
    return;
  }

  // Create pending confirmation with 60s TTL
  const confirmationId = createConfirmation(telegramId, 'reset', { expenseCount: expenses.length, total }, 60);

  const message = `Kamu yakin mau reset data hari ini?\n\n📊 ${expenses.length} pengeluaran senilai ${formatRupiah(total)} akan dihapus.`;
  const keyboard = buildKeyboard('confirm_reset');

  const sent = await ctx.reply(message, {
    ...keyboard,
    parse_mode: 'Markdown',
  });

  // Set timeout to auto-cancel after 60s
  const timer = setTimeout(async () => {
    if (isValid(confirmationId)) {
      resolveConfirmation(confirmationId, false);
      try {
        await ctx.telegram.editMessageText(
          sent.chat.id,
          sent.message_id,
          undefined,
          `${message}\n\n⏰ Konfirmasi kedaluwarsa. Reset dibatalkan otomatis.`,
          { parse_mode: 'Markdown' }
        );
        await ctx.telegram.editMessageReplyMarkup(sent.chat.id, sent.message_id, undefined, { inline_keyboard: [] });
      } catch (e) {
        // Message may have already been edited
      }
    }
  }, 60000);

  if (timer.unref) timer.unref();

  // Store the confirmation context for callback handling
  if (!bot._resetConfirmations) bot._resetConfirmations = new Map();
  bot._resetConfirmations.set(confirmationId, { chatId: sent.chat.id, messageId: sent.message_id, timer });

  // Also map by telegramId for callback lookup
  if (!bot._resetByUser) bot._resetByUser = new Map();
  bot._resetByUser.set(telegramId, confirmationId);
});

// Handle reset:yes callback
bot.action('reset:yes', async (ctx) => {
  try {
    const telegramId = String(ctx.from.id);

    if (!bot._resetByUser) {
      await ctx.answerCbQuery('Konfirmasi tidak ditemukan.');
      return;
    }

    const confirmationId = bot._resetByUser.get(telegramId);
    if (!confirmationId) {
      await ctx.answerCbQuery('Konfirmasi tidak ditemukan.');
      return;
    }

    const result = resolveConfirmation(confirmationId, true);
    if (!result) {
      await ctx.answerCbQuery('Konfirmasi sudah kedaluwarsa.');
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch (e) {}
      return;
    }

    // Clear the timeout timer
    const confirmData = bot._resetConfirmations?.get(confirmationId);
    if (confirmData?.timer) clearTimeout(confirmData.timer);
    bot._resetConfirmations?.delete(confirmationId);
    bot._resetByUser.delete(telegramId);

    // Delete today's expenses
    const { getDatabase } = require('./database');
    const db = getDatabase();
    const user = getOrCreateUser(telegramId);
    const today = new Date();
    const startOfDay = toSqliteDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
    const endOfDay = toSqliteDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));

    db.prepare('DELETE FROM expenses WHERE user_id = ? AND created_at >= ? AND created_at < ?').run(user.id, startOfDay, endOfDay);

    // Disable keyboard and show success
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (e) {}

    await ctx.answerCbQuery('Reset berhasil!');
    await ctx.reply(`✅ ${result.data.expenseCount} pengeluaran hari ini berhasil dihapus. Semangat lagi! 💪`);
  } catch (err) {
    console.error('Error handling reset:yes callback:', err);
    await ctx.answerCbQuery('Terjadi kesalahan. Silakan coba lagi.', { show_alert: true }).catch(() => {});
  }
});

// Handle reset:no callback
bot.action('reset:no', async (ctx) => {
  try {
    const telegramId = String(ctx.from.id);

    if (!bot._resetByUser) {
      await ctx.answerCbQuery('Konfirmasi tidak ditemukan.');
      return;
    }

    const confirmationId = bot._resetByUser.get(telegramId);
    if (!confirmationId) {
      await ctx.answerCbQuery('Konfirmasi tidak ditemukan.');
      return;
    }

    const result = resolveConfirmation(confirmationId, false);
    if (!result) {
      await ctx.answerCbQuery('Konfirmasi sudah kedaluwarsa.');
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch (e) {}
      return;
    }

    // Clear the timeout timer
    const confirmData = bot._resetConfirmations?.get(confirmationId);
    if (confirmData?.timer) clearTimeout(confirmData.timer);
    bot._resetConfirmations?.delete(confirmationId);
    bot._resetByUser.delete(telegramId);

    // Disable keyboard and show cancel message
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (e) {}

    await ctx.answerCbQuery('Reset dibatalkan.');
    await ctx.reply('🔒 Reset dibatalkan. Data kamu tetap aman.');
  } catch (err) {
    console.error('Error handling reset:no callback:', err);
    await ctx.answerCbQuery('Terjadi kesalahan. Silakan coba lagi.', { show_alert: true }).catch(() => {});
  }
});

// /simpan <nama> <nominal> <catatan> [budget] - Save shortcut
bot.command('simpan', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const text = ctx.message.text.replace('/simpan', '').trim();

  if (!text) {
    await ctx.reply(
      '📝 Untuk menyimpan shortcut pengeluaran, isi nama, nominal, catatan, dan budget (opsional).\n\n' +
      'Format: `/simpan <nama> <nominal> <catatan> [budget]`\n\n' +
      'Contoh:\n' +
      '• `/simpan kopi 15k kopi pagi jajan`\n' +
      '• `/simpan parkir 5k parkir motor`\n\n' +
      'Setelah disimpan, gunakan `/q kopi` untuk catat pengeluaran cepat ☕',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const words = text.split(/\s+/);

  // Need at least: name, nominal, note (3 words minimum)
  if (words.length < 3) {
    await ctx.reply(
      '📝 Format belum lengkap. Butuh minimal: nama, nominal, dan catatan.\n\n' +
      'Format: `/simpan <nama> <nominal> <catatan> [budget]`\n\n' +
      'Contoh:\n' +
      '• `/simpan kopi 15k kopi pagi jajan`\n' +
      '• `/simpan parkir 5k parkir motor`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const name = words[0];
  const nominalStr = words[1];
  const nominal = parseNominal(nominalStr);

  if (!nominal) {
    await ctx.reply(
      '🔢 Nominal yang kamu masukkan belum valid.\n\n' +
      'Format: `/simpan <nama> <nominal> <catatan> [budget]`\n\n' +
      'Contoh nominal yang benar:\n' +
      '• `15k` → Rp15.000\n' +
      '• `50000` → Rp50.000\n' +
      '• `20` → Rp20.000\n\n' +
      'Contoh lengkap: `/simpan kopi 15k kopi pagi jajan`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (nominal < 1000 || nominal > 10_000_000) {
    await ctx.reply(
      '⚠️ Nominal di luar rentang yang diperbolehkan.\n\n' +
      'Rentang valid: *Rp1.000 – Rp10.000.000*\n\n' +
      'Contoh: `/simpan kopi 15k kopi pagi jajan`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Remaining words after name and nominal
  const remainingWords = words.slice(2);

  // Check if last word matches a user budget (optional budget param)
  const budgets = getBudgets(telegramId);
  const budgetNames = budgets.map(b => b.name.toLowerCase());
  let budgetName = null;
  let noteWords = remainingWords;

  if (remainingWords.length > 1) {
    const lastWord = remainingWords[remainingWords.length - 1];
    if (budgetNames.includes(lastWord.toLowerCase())) {
      // Last word matches a budget - use original case from budget
      const matchedBudget = budgets.find(b => b.name.toLowerCase() === lastWord.toLowerCase());
      budgetName = matchedBudget.name;
      noteWords = remainingWords.slice(0, -1);
    }
  }

  const note = noteWords.join(' ');

  if (!note) {
    await ctx.reply(
      '📝 Catatan belum diisi. Tambahkan keterangan setelah nominal.\n\n' +
      'Format: `/simpan <nama> <nominal> <catatan> [budget]`\n\n' +
      'Contoh: `/simpan kopi 15k kopi pagi jajan`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Check if shortcut already exists (for upsert message)
  const existing = getShortcutByName(telegramId, name);

  // Check shortcut limit (max 20) - only if creating new (not updating existing)
  if (!existing) {
    const count = countShortcuts(telegramId);
    if (count >= 20) {
      await ctx.reply(
        '📦 Kamu sudah punya 20 shortcut (batas maksimal).\n\n' +
        'Untuk menambah shortcut baru, hapus yang tidak terpakai dulu:\n' +
        '`/hapus_shortcut <nama>`\n\n' +
        'Contoh: `/hapus_shortcut kopi`\n\n' +
        'Gunakan `/shortcuts` untuk melihat daftar shortcut kamu.',
        { parse_mode: 'Markdown' }
      );
      return;
    }
  }

  // Upsert shortcut
  createShortcut(telegramId, name, nominal, note, budgetName);

  // Build confirmation message
  const action = existing ? 'diperbarui' : 'disimpan';
  let response = `✅ Shortcut *${name}* ${action}!\n\n`;
  response += `• Nominal: ${formatRupiah(nominal)}\n`;
  response += `• Catatan: ${note}\n`;
  if (budgetName) {
    response += `• Budget: ${budgetName}\n`;
  }
  response += `\nGunakan: \`/q ${name}\` untuk mencatat pengeluaran cepat.`;

  await ctx.reply(response, { parse_mode: 'Markdown' });
});

// /q <nama_shortcut> - Execute shortcut
bot.command('q', async (ctx) => {
  const text = ctx.message.text.replace('/q', '').trim();

  if (!text) {
    await ctx.reply(
      '📝 Untuk menggunakan shortcut, ketik nama shortcut setelah /q.\n\n' +
      'Format: `/q <nama_shortcut>`\n\n' +
      'Contoh: `/q kopi`\n\n' +
      'Gunakan `/shortcuts` untuk melihat daftar shortcut kamu.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const telegramId = String(ctx.from.id);
  const shortcut = getShortcutByName(telegramId, text);

  if (!shortcut) {
    const shortcuts = getShortcuts(telegramId);
    if (shortcuts.length > 0) {
      const list = shortcuts.map(s => `• \`${s.name}\``).join('\n');
      await ctx.reply(
        `🔍 Shortcut "${text}" tidak ditemukan.\n\n` +
        `Shortcut yang tersedia:\n${list}\n\n` +
        `Contoh: \`/q ${shortcuts[0].name}\``,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(
        `🔍 Shortcut "${text}" tidak ditemukan.\n\n` +
        'Kamu belum punya shortcut. Buat dulu dengan:\n' +
        '`/simpan <nama> <nominal> <catatan> [budget]`\n\n' +
        'Contoh: `/simpan kopi 15k kopi pagi jajan`',
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  await sendExpenseResponse(ctx, shortcut.amount, shortcut.note, '', shortcut.budget_name);
});

// /shortcuts - List shortcuts
bot.command('shortcuts', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const shortcuts = getShortcuts(telegramId);

  if (shortcuts.length === 0) {
    await ctx.reply(
      'Belum ada shortcut tersimpan.\n\nGunakan `/simpan <nama> <nominal> <catatan> [budget]` untuk membuat shortcut.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  let message = '📋 *Daftar Shortcut:*\n\n';
  shortcuts.forEach((s, i) => {
    message += `${i + 1}. *${s.name}* — ${formatRupiah(s.amount)}`;
    if (s.note) message += ` — ${s.note}`;
    if (s.budget_name) message += ` [${s.budget_name}]`;
    message += '\n';
  });

  message += `\nGunakan \`/q <nama>\` untuk mencatat pengeluaran dari shortcut.`;

  await ctx.reply(message, { parse_mode: 'Markdown' });
});

// /hapus_shortcut <nama> - Delete shortcut
bot.command('hapus_shortcut', async (ctx) => {
  const text = ctx.message.text.replace('/hapus_shortcut', '').trim();

  if (!text) {
    await ctx.reply(
      'Gunakan: `/hapus_shortcut <nama_shortcut>`\nContoh: `/hapus_shortcut kopi`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const telegramId = String(ctx.from.id);
  const deleted = deleteShortcut(telegramId, text);

  if (!deleted) {
    const shortcuts = getShortcuts(telegramId);
    let message = `Shortcut "${text}" tidak ditemukan.`;
    if (shortcuts.length > 0) {
      message += `\n\nShortcut tersedia: ${shortcuts.map(s => s.name).join(', ')}`;
    }
    await ctx.reply(message);
    return;
  }

  await ctx.reply(`✅ Shortcut "${text}" berhasil dihapus.`);
});

// /notif - Notification settings
bot.command('notif', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const text = ctx.message.text.replace('/notif', '').trim().toLowerCase();

  if (text === 'on') {
    setNotificationEnabled(telegramId, true);
    await ctx.reply('🔔 Ringkasan harian *diaktifkan*.\n\nKamu akan menerima ringkasan pengeluaran setiap hari pukul 21:00 WIB.', { parse_mode: 'Markdown' });
  } else if (text === 'off') {
    setNotificationEnabled(telegramId, false);
    await ctx.reply('🔕 Ringkasan harian *dinonaktifkan*.\n\nKamu tidak akan menerima ringkasan otomatis.', { parse_mode: 'Markdown' });
  } else {
    const settings = getNotificationSettings(telegramId);
    const status = settings.enabled ? 'Aktif ✅' : 'Nonaktif ❌';
    const msg = [
      '*Pengaturan Notifikasi*',
      '',
      `Status: ${status}`,
      `Waktu: ${settings.time} WIB`,
      '',
      'Gunakan:',
      '`/notif on` — aktifkan ringkasan harian',
      '`/notif off` — nonaktifkan ringkasan harian',
    ].join('\n');
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  }
});

// Handle text input (non-command) as expense
bot.on('text', async (ctx) => {
  // Handle unknown commands
  if (ctx.message.text.startsWith('/')) {
    await ctx.reply('Perintah tidak dikenali. Ketik /help untuk melihat daftar perintah yang tersedia.');
    return;
  }

  const telegramId = String(ctx.from.id);

  // Get user's budget list for context-aware parsing
  const budgets = getBudgets(telegramId);
  const budgetNames = budgets.map(b => b.name);

  // Parse expense with user's budget list
  const parsed = parseExpense(ctx.message.text, budgetNames);

  if (!parsed) {
    // Distinguish between out-of-range nominal and unrecognized format
    const text = ctx.message.text.trim();
    const outOfRangeMatch = text.match(/^(\d+)(k?)\s*/i);

    if (outOfRangeMatch) {
      // Input starts with a number pattern - check if it's out of range
      let testAmount = parseInt(outOfRangeMatch[1], 10);
      const hasK = outOfRangeMatch[2].toLowerCase() === 'k';
      if (hasK) {
        testAmount *= 1000;
      } else if (testAmount < 100) {
        testAmount *= 1000;
      }

      if (testAmount < 1000 || testAmount > 10_000_000) {
        await ctx.reply(
          'Nominal di luar rentang yang diperbolehkan.\nRentang valid: Rp1.000 - Rp10.000.000\n\nContoh: `20 makan` (= Rp20.000)',
          { parse_mode: 'Markdown' }
        );
        return;
      }
    }

    // Unrecognized format: show 2+ format examples
    await ctx.reply(
      'Format tidak dikenali. Contoh:\n`20 makan` → Rp20.000\n`15k kopi` → Rp15.000\n`20000 parkir` → Rp20.000',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Check if user intended a budget but it wasn't matched
  // This happens when parsed.budget is null but the last word of the input
  // could have been intended as a budget name (user has budgets)
  const inputText = ctx.message.text.trim();
  const inputWords = inputText.replace(/^(\d+)(k?)\s*/i, '').trim().split(/\s+/);
  const lastWord = inputWords.length > 1 ? inputWords[inputWords.length - 1] : null;

  if (parsed.budget === null && lastWord) {
    const isLastWordNumeric = /^\d+(k?)$/i.test(lastWord);
    if (!isLastWordNumeric) {
      if (budgetNames.length > 0) {
        // User has budgets but last word didn't match any: record without budget, list available
        await sendExpenseResponse(ctx, parsed.amount, parsed.note, '', null);
        const budgetList = budgetNames.map(n => `• ${n}`).join('\n');
        await ctx.reply(
          `ℹ️ Budget "${lastWord}" tidak ditemukan. Pengeluaran dicatat tanpa budget.\n\nBudget yang tersedia:\n${budgetList}`,
          { parse_mode: 'Markdown' }
        );
        return;
      } else {
        // User has no budgets: record without budget, show /buat guide
        await sendExpenseResponse(ctx, parsed.amount, parsed.note, '', null);
        await ctx.reply(
          `ℹ️ Belum ada budget yang dibuat. Pengeluaran dicatat tanpa budget.\n\nBuat budget dengan:\n\`/buat <nama> <nominal>\`\nContoh: \`/buat jajan 50k\``,
          { parse_mode: 'Markdown' }
        );
        return;
      }
    }
  }

  await sendExpenseResponse(ctx, parsed.amount, parsed.note, '', parsed.budget);
});

// Handle onboarding callback queries (onb:budget, onb:skip)
bot.action(/^onb:(.+)$/, async (ctx) => {
  try {
    const telegramId = String(ctx.from.id);
    const action = ctx.match[1]; // 'budget' or 'skip'

    let choice;
    if (action === 'budget') {
      choice = 'create';
    } else if (action === 'skip') {
      choice = 'skip';
    } else {
      await ctx.answerCbQuery('Aksi tidak dikenali.');
      return;
    }

    const step = handleBudgetStep(telegramId, choice);

    // Disable the inline keyboard on the original message
    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch (e) {
      // Ignore if message can't be edited
    }

    await ctx.answerCbQuery();
    await ctx.reply(step.text, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Error handling onb callback:', err);
    await ctx.answerCbQuery('Terjadi kesalahan. Silakan coba lagi.', { show_alert: true }).catch(() => {});
  }
});

// Handle undo callback (undo:<expenseId>)
bot.action(/^undo:(\d+)$/, async (ctx) => {
  const telegramId = String(ctx.from.id);
  const expenseId = parseInt(ctx.match[1], 10);
  const user = getOrCreateUser(telegramId);

  // Check if expense still exists
  const expense = getExpenseById(expenseId);

  if (!expense) {
    // Expense already deleted (double-undo)
    await ctx.answerCbQuery('Pengeluaran sudah dibatalkan sebelumnya.');
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (e) {}
    return;
  }

  // Check if expense belongs to this user
  if (expense.user_id !== user.id) {
    await ctx.answerCbQuery('Aksi tidak valid.');
    return;
  }

  // Check if undo is still within time limit (30s) by checking confirmation validity
  // We look for a valid confirmation for this user with matching expenseId
  // Since confirmations auto-expire after 30s, we check if the expense was created within 30s
  const expenseCreatedAt = new Date(expense.created_at + 'Z').getTime();
  const now = Date.now();
  const elapsed = now - expenseCreatedAt;

  if (elapsed > 30000) {
    // Undo expired
    await ctx.answerCbQuery('Waktu undo telah habis.');
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (e) {}
    await ctx.reply('⏰ Waktu undo telah habis. Gunakan /reset jika ingin menghapus pengeluaran hari ini.');
    return;
  }

  // Perform undo: delete expense and update total
  const deleted = deleteExpenseById(expenseId, user.id);

  if (!deleted) {
    // Should not happen, but handle gracefully (double-undo race condition)
    await ctx.answerCbQuery('Pengeluaran sudah dibatalkan sebelumnya.');
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (e) {}
    return;
  }

  // Get updated total
  const updatedTotal = getTodayTotal(telegramId);
  const noteLabel = expense.note || 'tanpa keterangan';

  // Remove undo button
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch (e) {}

  await ctx.answerCbQuery('Pengeluaran dibatalkan!');
  await ctx.reply(
    `↩️ ${formatRupiah(expense.amount)} (${noteLabel}) dibatalkan.\nTotal hari ini: ${formatRupiah(updatedTotal)}`,
    { parse_mode: 'Markdown' }
  );
});

// Handle menu callback queries (menu:today, menu:budget, menu:history, menu:help)
bot.action(/^menu:(.+)$/, async (ctx) => {
  const telegramId = String(ctx.from.id);
  const action = ctx.match[1];

  await ctx.answerCbQuery();

  switch (action) {
    case 'today':
      await sendTodayResponse(ctx, telegramId);
      break;
    case 'budget':
      await sendBudgetResponse(ctx, telegramId);
      break;
    case 'history':
      await sendHistoryResponse(ctx, telegramId);
      break;
    case 'help': {
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
        '',
        'Ketik /help untuk panduan lengkap.',
      ].join('\n');
      await ctx.reply(msg, { parse_mode: 'Markdown' });
      break;
    }
    default:
      await ctx.reply('Aksi tidak dikenali.');
  }
});

// Handle navigation callback queries (nav:today, nav:budget, nav:expense)
bot.action(/^nav:(.+)$/, async (ctx) => {
  const telegramId = String(ctx.from.id);
  const target = ctx.match[1];

  await ctx.answerCbQuery();

  switch (target) {
    case 'today':
      await sendTodayResponse(ctx, telegramId);
      break;
    case 'budget':
      await sendBudgetResponse(ctx, telegramId);
      break;
    case 'expense':
      await ctx.reply(
        'Catat pengeluaran dengan format:\n`<nominal> <catatan> [budget]`\n\nContoh: `20 makan` atau `15k kopi jajan`',
        { parse_mode: 'Markdown' }
      );
      break;
    default:
      await ctx.reply('Aksi tidak dikenali.');
  }
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

module.exports = { startBot, bot, getPeriodRange };

// If running directly
if (require.main === module) {
  startBot();
}