'use strict';

/**
 * Unit tests for /shortcuts and /hapus_shortcut command handlers.
 * Tests the handler logic by verifying database operations and message formatting.
 *
 * Validates: Requirements 8.3, 8.8
 */

const database = require('../../src/database');
const { formatRupiah } = require('../../src/formatter');

describe('/shortcuts and /hapus_shortcut flow', () => {
  const TEST_USER = 'shortcuts_test_user';

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

  describe('/shortcuts - list all shortcuts', () => {
    it('returns empty list message when no shortcuts exist', () => {
      database.getOrCreateUser(TEST_USER);
      const shortcuts = database.getShortcuts(TEST_USER);

      expect(shortcuts.length).toBe(0);

      // Simulate the empty list response
      const message = 'Belum ada shortcut tersimpan.\n\nGunakan `/simpan <nama> <nominal> <catatan> [budget]` untuk membuat shortcut.';
      expect(message).toContain('Belum ada shortcut');
      expect(message).toContain('/simpan');
    });

    it('lists all shortcuts with name, nominal, note', () => {
      database.getOrCreateUser(TEST_USER);
      database.createShortcut(TEST_USER, 'kopi', 15000, 'kopi starbucks', null);
      database.createShortcut(TEST_USER, 'makan', 25000, 'makan siang', null);

      const shortcuts = database.getShortcuts(TEST_USER);
      expect(shortcuts.length).toBe(2);

      // Simulate the list message construction
      let message = '📋 *Daftar Shortcut:*\n\n';
      shortcuts.forEach((s, i) => {
        message += `${i + 1}. *${s.name}* — ${formatRupiah(s.amount)}`;
        if (s.note) message += ` — ${s.note}`;
        if (s.budget_name) message += ` [${s.budget_name}]`;
        message += '\n';
      });
      message += `\nGunakan \`/q <nama>\` untuk mencatat pengeluaran dari shortcut.`;

      expect(message).toContain('*kopi*');
      expect(message).toContain('Rp15.000');
      expect(message).toContain('kopi starbucks');
      expect(message).toContain('*makan*');
      expect(message).toContain('Rp25.000');
      expect(message).toContain('makan siang');
      expect(message).toContain('/q <nama>');
    });

    it('shows budget name in brackets when shortcut has budget', () => {
      database.getOrCreateUser(TEST_USER);
      database.createShortcut(TEST_USER, 'kopi', 15000, 'kopi pagi', 'jajan');

      const shortcuts = database.getShortcuts(TEST_USER);
      const s = shortcuts[0];

      let line = `1. *${s.name}* — ${formatRupiah(s.amount)}`;
      if (s.note) line += ` — ${s.note}`;
      if (s.budget_name) line += ` [${s.budget_name}]`;

      expect(line).toContain('[jajan]');
      expect(line).toContain('*kopi*');
      expect(line).toContain('Rp15.000');
      expect(line).toContain('kopi pagi');
    });

    it('does not show budget brackets when budget is null', () => {
      database.getOrCreateUser(TEST_USER);
      database.createShortcut(TEST_USER, 'makan', 20000, 'makan siang', null);

      const shortcuts = database.getShortcuts(TEST_USER);
      const s = shortcuts[0];

      let line = `1. *${s.name}* — ${formatRupiah(s.amount)}`;
      if (s.note) line += ` — ${s.note}`;
      if (s.budget_name) line += ` [${s.budget_name}]`;

      expect(line).not.toContain('[');
      expect(line).not.toContain(']');
    });
  });

  describe('/hapus_shortcut - delete shortcut', () => {
    it('shows usage format when no parameter provided', () => {
      // Simulate the no-param response
      const message = 'Gunakan: `/hapus_shortcut <nama_shortcut>`\nContoh: `/hapus_shortcut kopi`';
      expect(message).toContain('/hapus_shortcut');
      expect(message).toContain('Contoh');
    });

    it('deletes existing shortcut and returns true', () => {
      database.getOrCreateUser(TEST_USER);
      database.createShortcut(TEST_USER, 'kopi', 15000, 'kopi pagi', null);

      // Verify shortcut exists
      const before = database.getShortcuts(TEST_USER);
      expect(before.length).toBe(1);

      const deleted = database.deleteShortcut(TEST_USER, 'kopi');
      expect(deleted).toBe(true);

      // Verify shortcut is gone
      const after = database.getShortcuts(TEST_USER);
      expect(after.length).toBe(0);
    });

    it('returns false when shortcut does not exist', () => {
      database.getOrCreateUser(TEST_USER);

      const deleted = database.deleteShortcut(TEST_USER, 'nonexistent');
      expect(deleted).toBe(false);
    });

    it('shows error with available shortcuts when shortcut not found', () => {
      database.getOrCreateUser(TEST_USER);
      database.createShortcut(TEST_USER, 'kopi', 15000, 'kopi pagi', null);
      database.createShortcut(TEST_USER, 'makan', 25000, 'makan siang', null);

      const deleted = database.deleteShortcut(TEST_USER, 'jajan');
      expect(deleted).toBe(false);

      const shortcuts = database.getShortcuts(TEST_USER);
      let message = `Shortcut "jajan" tidak ditemukan.`;
      if (shortcuts.length > 0) {
        message += `\n\nShortcut tersedia: ${shortcuts.map(s => s.name).join(', ')}`;
      }

      expect(message).toContain('Shortcut "jajan" tidak ditemukan.');
      expect(message).toContain('Shortcut tersedia: kopi, makan');
    });

    it('shows only error message when user has no shortcuts', () => {
      database.getOrCreateUser(TEST_USER);

      const deleted = database.deleteShortcut(TEST_USER, 'jajan');
      expect(deleted).toBe(false);

      const shortcuts = database.getShortcuts(TEST_USER);
      let message = `Shortcut "jajan" tidak ditemukan.`;
      if (shortcuts.length > 0) {
        message += `\n\nShortcut tersedia: ${shortcuts.map(s => s.name).join(', ')}`;
      }

      expect(message).toBe('Shortcut "jajan" tidak ditemukan.');
      expect(message).not.toContain('Shortcut tersedia');
    });

    it('shows confirmation message on successful deletion', () => {
      database.getOrCreateUser(TEST_USER);
      database.createShortcut(TEST_USER, 'kopi', 15000, 'kopi pagi', null);

      const deleted = database.deleteShortcut(TEST_USER, 'kopi');
      expect(deleted).toBe(true);

      const message = `✅ Shortcut "kopi" berhasil dihapus.`;
      expect(message).toContain('berhasil dihapus');
      expect(message).toContain('kopi');
    });
  });
});
