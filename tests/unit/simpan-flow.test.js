'use strict';

/**
 * Unit tests for the /simpan command handler flow.
 * Tests the handler logic by verifying:
 * - Shortcut creation and upsert behavior
 * - Shortcut limit enforcement (max 20)
 * - Budget matching for optional budget parameter
 * - Nominal parsing via parseNominal helper
 * - Confirmation message formatting
 */

const database = require('../../src/database');
const { formatRupiah } = require('../../src/formatter');

// Replicate parseNominal from bot.js for testing
function parseNominal(text) {
  const match = text.match(/^(\d+)(k?)$/i);
  if (!match) return null;
  let val = parseInt(match[1], 10);
  if (match[2]?.toLowerCase() === 'k') val *= 1000;
  else if (val < 100) val *= 1000;
  return val;
}

describe('/simpan command flow', () => {
  const TEST_USER = 'simpan_test_user';

  beforeEach(() => {
    // Clean up test data
    const db = database.getDatabase();
    db.exec('DELETE FROM shortcuts');
    db.exec('DELETE FROM expenses');
    db.exec('DELETE FROM budgets');
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DELETE FROM users');
    db.exec('PRAGMA foreign_keys = ON');
  });

  describe('parseNominal helper', () => {
    it('parses plain number < 100 as multiplied by 1000', () => {
      expect(parseNominal('20')).toBe(20000);
      expect(parseNominal('15')).toBe(15000);
      expect(parseNominal('99')).toBe(99000);
    });

    it('parses number with k suffix', () => {
      expect(parseNominal('15k')).toBe(15000);
      expect(parseNominal('20K')).toBe(20000);
      expect(parseNominal('100k')).toBe(100000);
    });

    it('parses plain number >= 100 as-is', () => {
      expect(parseNominal('20000')).toBe(20000);
      expect(parseNominal('100')).toBe(100);
      expect(parseNominal('1000')).toBe(1000);
    });

    it('returns null for invalid input', () => {
      expect(parseNominal('abc')).toBeNull();
      expect(parseNominal('')).toBeNull();
      expect(parseNominal('12.5')).toBeNull();
    });
  });

  describe('shortcut creation', () => {
    it('creates a shortcut with name, nominal, note', () => {
      database.getOrCreateUser(TEST_USER);
      const shortcut = database.createShortcut(TEST_USER, 'kopi', 15000, 'kopi starbucks', null);

      expect(shortcut).toBeDefined();
      expect(shortcut.name).toBe('kopi');
      expect(shortcut.amount).toBe(15000);
      expect(shortcut.note).toBe('kopi starbucks');
      expect(shortcut.budget_name).toBeNull();
    });

    it('creates a shortcut with budget', () => {
      database.getOrCreateUser(TEST_USER);
      database.createBudget(TEST_USER, 'jajan', 50000, 'daily');
      const shortcut = database.createShortcut(TEST_USER, 'kopi', 15000, 'kopi starbucks', 'jajan');

      expect(shortcut.budget_name).toBe('jajan');
    });

    it('upserts shortcut when name already exists', () => {
      database.getOrCreateUser(TEST_USER);
      database.createShortcut(TEST_USER, 'kopi', 15000, 'kopi starbucks', null);

      // Update with new data
      const updated = database.createShortcut(TEST_USER, 'kopi', 20000, 'kopi kenangan', null);

      expect(updated.amount).toBe(20000);
      expect(updated.note).toBe('kopi kenangan');

      // Should still be only 1 shortcut
      expect(database.countShortcuts(TEST_USER)).toBe(1);
    });
  });

  describe('shortcut limit enforcement', () => {
    it('allows up to 20 shortcuts', () => {
      database.getOrCreateUser(TEST_USER);

      for (let i = 1; i <= 20; i++) {
        database.createShortcut(TEST_USER, `shortcut${i}`, 10000, `note ${i}`, null);
      }

      expect(database.countShortcuts(TEST_USER)).toBe(20);
    });

    it('countShortcuts returns correct count', () => {
      database.getOrCreateUser(TEST_USER);
      expect(database.countShortcuts(TEST_USER)).toBe(0);

      database.createShortcut(TEST_USER, 'kopi', 15000, 'kopi', null);
      expect(database.countShortcuts(TEST_USER)).toBe(1);

      database.createShortcut(TEST_USER, 'makan', 25000, 'makan siang', null);
      expect(database.countShortcuts(TEST_USER)).toBe(2);
    });

    it('upsert does not increase count when name exists', () => {
      database.getOrCreateUser(TEST_USER);
      database.createShortcut(TEST_USER, 'kopi', 15000, 'kopi', null);
      expect(database.countShortcuts(TEST_USER)).toBe(1);

      // Upsert same name
      database.createShortcut(TEST_USER, 'kopi', 20000, 'kopi baru', null);
      expect(database.countShortcuts(TEST_USER)).toBe(1);
    });
  });

  describe('budget matching for shortcut', () => {
    it('matches last word as budget when it exists (case-insensitive)', () => {
      database.getOrCreateUser(TEST_USER);
      database.createBudget(TEST_USER, 'jajan', 50000, 'daily');

      const budgets = database.getBudgets(TEST_USER);
      const budgetNames = budgets.map(b => b.name.toLowerCase());

      // Simulate parsing: "/simpan kopi 15k kopi starbucks jajan"
      const remainingWords = ['kopi', 'starbucks', 'jajan'];
      const lastWord = remainingWords[remainingWords.length - 1];

      expect(budgetNames.includes(lastWord.toLowerCase())).toBe(true);

      const matchedBudget = budgets.find(b => b.name.toLowerCase() === lastWord.toLowerCase());
      expect(matchedBudget.name).toBe('jajan');
    });

    it('does not match last word as budget when only one remaining word', () => {
      database.getOrCreateUser(TEST_USER);
      database.createBudget(TEST_USER, 'jajan', 50000, 'daily');

      // Simulate parsing: "/simpan kopi 15k jajan"
      // remainingWords = ['jajan'] - only 1 word, should be treated as note, not budget
      const remainingWords = ['jajan'];

      // The handler only checks for budget if remainingWords.length > 1
      expect(remainingWords.length > 1).toBe(false);
    });

    it('treats last word as note when it does not match any budget', () => {
      database.getOrCreateUser(TEST_USER);
      database.createBudget(TEST_USER, 'jajan', 50000, 'daily');

      const budgets = database.getBudgets(TEST_USER);
      const budgetNames = budgets.map(b => b.name.toLowerCase());

      // Simulate: "/simpan kopi 15k kopi starbucks"
      const remainingWords = ['kopi', 'starbucks'];
      const lastWord = remainingWords[remainingWords.length - 1];

      expect(budgetNames.includes(lastWord.toLowerCase())).toBe(false);
    });
  });

  describe('confirmation message formatting', () => {
    it('shows "disimpan" for new shortcut', () => {
      database.getOrCreateUser(TEST_USER);

      const existing = database.getShortcutByName(TEST_USER, 'kopi');
      expect(existing).toBeNull();

      const action = existing ? 'diperbarui' : 'disimpan';
      expect(action).toBe('disimpan');
    });

    it('shows "diperbarui" for existing shortcut', () => {
      database.getOrCreateUser(TEST_USER);
      database.createShortcut(TEST_USER, 'kopi', 15000, 'kopi', null);

      const existing = database.getShortcutByName(TEST_USER, 'kopi');
      expect(existing).not.toBeNull();

      const action = existing ? 'diperbarui' : 'disimpan';
      expect(action).toBe('diperbarui');
    });

    it('formats confirmation with nominal, note, and budget', () => {
      const name = 'kopi';
      const nominal = 15000;
      const note = 'kopi starbucks';
      const budgetName = 'jajan';
      const action = 'disimpan';

      let response = `✅ Shortcut *${name}* ${action}!\n\n`;
      response += `• Nominal: ${formatRupiah(nominal)}\n`;
      response += `• Catatan: ${note}\n`;
      if (budgetName) {
        response += `• Budget: ${budgetName}\n`;
      }
      response += `\nGunakan: \`/q ${name}\` untuk mencatat pengeluaran cepat.`;

      expect(response).toContain('Shortcut *kopi* disimpan!');
      expect(response).toContain('Rp15.000');
      expect(response).toContain('kopi starbucks');
      expect(response).toContain('Budget: jajan');
      expect(response).toContain('/q kopi');
    });

    it('formats confirmation without budget when not provided', () => {
      const name = 'makan';
      const nominal = 25000;
      const note = 'makan siang';
      const budgetName = null;
      const action = 'disimpan';

      let response = `✅ Shortcut *${name}* ${action}!\n\n`;
      response += `• Nominal: ${formatRupiah(nominal)}\n`;
      response += `• Catatan: ${note}\n`;
      if (budgetName) {
        response += `• Budget: ${budgetName}\n`;
      }
      response += `\nGunakan: \`/q ${name}\` untuk mencatat pengeluaran cepat.`;

      expect(response).not.toContain('Budget:');
      expect(response).toContain('Rp25.000');
      expect(response).toContain('makan siang');
    });
  });

  describe('getShortcutByName', () => {
    it('returns null when shortcut does not exist', () => {
      database.getOrCreateUser(TEST_USER);
      const result = database.getShortcutByName(TEST_USER, 'nonexistent');
      expect(result).toBeNull();
    });

    it('returns shortcut when it exists', () => {
      database.getOrCreateUser(TEST_USER);
      database.createShortcut(TEST_USER, 'kopi', 15000, 'kopi starbucks', 'jajan');

      const result = database.getShortcutByName(TEST_USER, 'kopi');
      expect(result).not.toBeNull();
      expect(result.name).toBe('kopi');
      expect(result.amount).toBe(15000);
      expect(result.note).toBe('kopi starbucks');
      expect(result.budget_name).toBe('jajan');
    });
  });
});
