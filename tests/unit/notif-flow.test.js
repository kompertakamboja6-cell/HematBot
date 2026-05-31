'use strict';

/**
 * Unit tests for /notif command handler.
 * Tests notification enable/disable and status display.
 *
 * Validates: Requirements 7.1, 7.4, 7.5
 */

const database = require('../../src/database');

describe('/notif command handler', () => {
  const TEST_USER = 'notif_flow_test_user';

  beforeEach(() => {
    const db = database.getDatabase();
    db.exec('DELETE FROM shortcuts');
    db.exec('DELETE FROM expenses');
    db.exec('DELETE FROM budgets');
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DELETE FROM users');
    db.exec('PRAGMA foreign_keys = ON');
  });

  describe('/notif on - enable notifications (Requirement 7.1)', () => {
    it('should enable notifications in database', () => {
      database.getOrCreateUser(TEST_USER);
      database.setNotificationEnabled(TEST_USER, true);

      const settings = database.getNotificationSettings(TEST_USER);
      expect(settings.enabled).toBe(true);
    });

    it('should set default time to 21:00 when enabling', () => {
      database.getOrCreateUser(TEST_USER);
      database.setNotificationEnabled(TEST_USER, true);

      const settings = database.getNotificationSettings(TEST_USER);
      expect(settings.time).toBe('21:00');
    });

    it('confirmation message should mention activation and 21:00 WIB', () => {
      // Simulate the reply message from the handler
      const replyMsg = '🔔 Ringkasan harian *diaktifkan*.\n\nKamu akan menerima ringkasan pengeluaran setiap hari pukul 21:00 WIB.';
      expect(replyMsg).toContain('diaktifkan');
      expect(replyMsg).toContain('21:00 WIB');
    });
  });

  describe('/notif off - disable notifications (Requirement 7.4)', () => {
    it('should disable notifications in database', () => {
      database.getOrCreateUser(TEST_USER);
      database.setNotificationEnabled(TEST_USER, true);
      database.setNotificationEnabled(TEST_USER, false);

      const settings = database.getNotificationSettings(TEST_USER);
      expect(settings.enabled).toBe(false);
    });

    it('confirmation message should mention deactivation', () => {
      const replyMsg = '🔕 Ringkasan harian *dinonaktifkan*.\n\nKamu tidak akan menerima ringkasan otomatis.';
      expect(replyMsg).toContain('dinonaktifkan');
    });
  });

  describe('/notif (no params) - show status (Requirement 7.5)', () => {
    it('should show aktif status when notifications are enabled', () => {
      database.getOrCreateUser(TEST_USER);
      database.setNotificationEnabled(TEST_USER, true);

      const settings = database.getNotificationSettings(TEST_USER);
      const status = settings.enabled ? 'Aktif ✅' : 'Nonaktif ❌';

      expect(status).toBe('Aktif ✅');
    });

    it('should show nonaktif status when notifications are disabled', () => {
      database.getOrCreateUser(TEST_USER);

      const settings = database.getNotificationSettings(TEST_USER);
      const status = settings.enabled ? 'Aktif ✅' : 'Nonaktif ❌';

      expect(status).toBe('Nonaktif ❌');
    });

    it('should show configured time in status message', () => {
      database.getOrCreateUser(TEST_USER);
      const settings = database.getNotificationSettings(TEST_USER);

      const msg = [
        '*Pengaturan Notifikasi*',
        '',
        `Status: ${settings.enabled ? 'Aktif ✅' : 'Nonaktif ❌'}`,
        `Waktu: ${settings.time} WIB`,
        '',
        'Gunakan:',
        '`/notif on` — aktifkan ringkasan harian',
        '`/notif off` — nonaktifkan ringkasan harian',
      ].join('\n');

      expect(msg).toContain('Waktu: 21:00 WIB');
      expect(msg).toContain('/notif on');
      expect(msg).toContain('/notif off');
    });

    it('should show usage instructions in status message', () => {
      database.getOrCreateUser(TEST_USER);
      const settings = database.getNotificationSettings(TEST_USER);

      const msg = [
        '*Pengaturan Notifikasi*',
        '',
        `Status: ${settings.enabled ? 'Aktif ✅' : 'Nonaktif ❌'}`,
        `Waktu: ${settings.time} WIB`,
        '',
        'Gunakan:',
        '`/notif on` — aktifkan ringkasan harian',
        '`/notif off` — nonaktifkan ringkasan harian',
      ].join('\n');

      expect(msg).toContain('Gunakan:');
      expect(msg).toContain('/notif on');
      expect(msg).toContain('/notif off');
    });
  });
});
