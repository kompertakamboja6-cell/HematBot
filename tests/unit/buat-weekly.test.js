'use strict';

/**
 * Unit tests for /buat command with weekly period.
 * Validates:
 * - Budget creation with period="weekly"
 * - Confirmation message shows "minggu" label
 * - Reserved word "weekly" rejected as budget name
 *
 * Validates: Requirements 1.1, 1.4
 */

const database = require('../../src/database');
const { formatRupiah, getPeriodLabel } = require('../../src/formatter');

// Replicate parseNominal from bot.js for testing
function parseNominal(text) {
  const match = text.match(/^(\d+)(k?)$/i);
  if (!match) return null;
  let val = parseInt(match[1], 10);
  if (match[2]?.toLowerCase() === 'k') val *= 1000;
  else if (val < 100) val *= 1000;
  return val;
}

/**
 * Simulate the /buat command handler logic.
 * Returns { success, reply, budget } or { success: false, reply }.
 */
function simulateBuatCommand(telegramId, inputText) {
  const text = inputText.replace('/buat', '').trim();

  if (!text) {
    return { success: false, reply: 'Gunakan: /buat <nama> <nominal> [period]\nContoh: /buat jajan 50k\nAtau: /buat transport 200000 monthly' };
  }

  const words = text.split(/\s+/);

  let period = 'daily';

  if (['daily', 'weekly', 'monthly', 'yearly'].includes(words[words.length - 1])) {
    period = words.pop();
  }

  const lastWord = words[words.length - 1];
  const val = parseNominal(lastWord);

  if (!val) {
    return { success: false, reply: 'Nominal tidak ditemukan. Contoh: /buat jajan 50k' };
  }

  words.pop();
  const name = words.join(' ');

  if (!name) {
    return { success: false, reply: 'Nama budget tidak boleh kosong. Contoh: /buat jajan 50k' };
  }

  const reservedNames = ['daily', 'weekly', 'monthly', 'yearly'];
  if (reservedNames.includes(name.toLowerCase())) {
    return { success: false, reply: `Nama "${name}" tidak bisa dipakai karena merupakan kata reserved untuk period. Pilih nama lain ya.` };
  }

  if (val < 100 || val > 10_000_000) {
    return { success: false, reply: 'Nominal harus antara Rp1.000 - Rp10.000.000' };
  }

  try {
    const budget = database.createBudget(telegramId, name, val, period);
    const periodLabel = getPeriodLabel(period);
    const reply = `Budget *${name}* dibuat: ${formatRupiah(val)}/${periodLabel} ✅`;
    return { success: true, reply, budget, period };
  } catch (err) {
    if (err.message === 'Budget sudah ada') {
      return { success: false, reply: `Budget "${name}" sudah ada. Gunakan /hapus ${name} dulu kalo mau ganti.` };
    }
    throw err;
  }
}

describe('/buat command with weekly period', () => {
  const TEST_USER = 'buat_weekly_test_user';

  beforeEach(() => {
    const db = database.getDatabase();
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DELETE FROM expenses');
    db.exec('DELETE FROM budgets');
    db.exec('DELETE FROM users');
    db.exec('PRAGMA foreign_keys = ON');
    database.getOrCreateUser(TEST_USER);
  });

  describe('/buat jajan 50k weekly', () => {
    it('creates budget with period="weekly"', () => {
      const result = simulateBuatCommand(TEST_USER, '/buat jajan 50k weekly');

      expect(result.success).toBe(true);

      // Verify in database
      const budget = database.getBudgetByName(TEST_USER, 'jajan');
      expect(budget).not.toBeNull();
      expect(budget.period).toBe('weekly');
      expect(budget.limit_amount).toBe(50000);
      expect(budget.name).toBe('jajan');
    });

    it('confirmation message contains "minggu"', () => {
      const result = simulateBuatCommand(TEST_USER, '/buat jajan 50k weekly');

      expect(result.success).toBe(true);
      expect(result.reply).toContain('minggu');
      expect(result.reply).toContain('Budget *jajan* dibuat');
      expect(result.reply).toContain('Rp50.000/minggu');
    });

    it('stores correct nominal (50k = 50000)', () => {
      const result = simulateBuatCommand(TEST_USER, '/buat jajan 50k weekly');

      expect(result.success).toBe(true);
      const budget = database.getBudgetByName(TEST_USER, 'jajan');
      expect(budget.limit_amount).toBe(50000);
    });
  });

  describe('reserved word rejection', () => {
    it('rejects "weekly" as budget name (/buat weekly 50k)', () => {
      const result = simulateBuatCommand(TEST_USER, '/buat weekly 50k');

      expect(result.success).toBe(false);
      expect(result.reply).toContain('reserved');
      expect(result.reply).toContain('weekly');
    });

    it('rejects "daily" as budget name', () => {
      const result = simulateBuatCommand(TEST_USER, '/buat daily 50k');

      expect(result.success).toBe(false);
      expect(result.reply).toContain('reserved');
    });

    it('rejects "monthly" as budget name', () => {
      const result = simulateBuatCommand(TEST_USER, '/buat monthly 50k');

      expect(result.success).toBe(false);
      expect(result.reply).toContain('reserved');
    });

    it('rejects "yearly" as budget name', () => {
      const result = simulateBuatCommand(TEST_USER, '/buat yearly 50k');

      expect(result.success).toBe(false);
      expect(result.reply).toContain('reserved');
    });
  });

  describe('period defaults and other periods', () => {
    it('defaults to daily when no period specified', () => {
      const result = simulateBuatCommand(TEST_USER, '/buat jajan 50k');

      expect(result.success).toBe(true);
      const budget = database.getBudgetByName(TEST_USER, 'jajan');
      expect(budget.period).toBe('daily');
    });

    it('confirmation shows "hari" for daily period', () => {
      const result = simulateBuatCommand(TEST_USER, '/buat jajan 50k daily');

      expect(result.success).toBe(true);
      expect(result.reply).toContain('hari');
    });

    it('confirmation shows "bulan" for monthly period', () => {
      const result = simulateBuatCommand(TEST_USER, '/buat jajan 50k monthly');

      expect(result.success).toBe(true);
      expect(result.reply).toContain('bulan');
    });
  });
});
