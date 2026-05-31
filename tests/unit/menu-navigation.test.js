'use strict';

const { buildKeyboard } = require('../../src/keyboard');

describe('Menu and Navigation Keyboards (Task 7.5)', () => {
  describe('/menu command keyboard', () => {
    it('should produce inline keyboard with 4 menu buttons', () => {
      const kb = buildKeyboard('menu');
      const buttons = kb.reply_markup.inline_keyboard.flat();
      expect(buttons).toHaveLength(4);
      expect(buttons.map((b) => b.text)).toEqual([
        'Ringkasan Hari Ini',
        'Lihat Budget',
        'Riwayat 7 Hari',
        'Bantuan',
      ]);
    });

    it('should use menu:<action> callback data format', () => {
      const kb = buildKeyboard('menu');
      const data = kb.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
      expect(data).toEqual(['menu:today', 'menu:budget', 'menu:history', 'menu:help']);
    });
  });

  describe('/today navigation keyboard', () => {
    it('should produce 2 navigation buttons: Catat Pengeluaran, Lihat Budget', () => {
      const kb = buildKeyboard('today');
      const buttons = kb.reply_markup.inline_keyboard.flat();
      expect(buttons).toHaveLength(2);
      expect(buttons.map((b) => b.text)).toEqual(['Catat Pengeluaran', 'Lihat Budget']);
    });

    it('should use nav:<target> callback data format', () => {
      const kb = buildKeyboard('today');
      const data = kb.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
      expect(data).toEqual(['nav:expense', 'nav:budget']);
    });
  });

  describe('/budget navigation keyboard', () => {
    it('should produce 2 navigation buttons: Ringkasan Hari Ini, Catat Pengeluaran', () => {
      const kb = buildKeyboard('budget');
      const buttons = kb.reply_markup.inline_keyboard.flat();
      expect(buttons).toHaveLength(2);
      expect(buttons.map((b) => b.text)).toEqual(['Ringkasan Hari Ini', 'Catat Pengeluaran']);
    });

    it('should use nav:<target> callback data format', () => {
      const kb = buildKeyboard('budget');
      const data = kb.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
      expect(data).toEqual(['nav:today', 'nav:expense']);
    });
  });

  describe('/history navigation keyboard', () => {
    it('should produce 2 navigation buttons: Ringkasan Hari Ini, Lihat Budget', () => {
      const kb = buildKeyboard('history');
      const buttons = kb.reply_markup.inline_keyboard.flat();
      expect(buttons).toHaveLength(2);
      expect(buttons.map((b) => b.text)).toEqual(['Ringkasan Hari Ini', 'Lihat Budget']);
    });

    it('should use nav:<target> callback data format', () => {
      const kb = buildKeyboard('history');
      const data = kb.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
      expect(data).toEqual(['nav:today', 'nav:budget']);
    });
  });

  describe('expense success navigation keyboard', () => {
    it('should produce 2 buttons: Undo, Ringkasan Hari Ini', () => {
      const kb = buildKeyboard('expense', { expenseId: 42 });
      const buttons = kb.reply_markup.inline_keyboard.flat();
      expect(buttons).toHaveLength(2);
      expect(buttons.map((b) => b.text)).toEqual(['Undo', 'Ringkasan Hari Ini']);
    });

    it('should use undo:<id> and nav:today callback data format', () => {
      const kb = buildKeyboard('expense', { expenseId: 42 });
      const data = kb.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
      expect(data).toEqual(['undo:42', 'nav:today']);
    });
  });

  describe('Navigation callback data compliance', () => {
    it('all navigation callback data fits within 64 bytes', () => {
      const contexts = ['menu', 'today', 'budget', 'history'];
      for (const context of contexts) {
        const kb = buildKeyboard(context);
        const allData = kb.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
        for (const data of allData) {
          expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
        }
      }
    });

    it('expense navigation callback data fits within 64 bytes', () => {
      const kb = buildKeyboard('expense', { expenseId: 999999999 });
      const allData = kb.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
      for (const data of allData) {
        expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
      }
    });
  });
});
