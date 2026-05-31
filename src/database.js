const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'hematbot.db');

/** Format Date ke format YYYY-MM-DD HH:MM:SS (kompatibel dengan SQLite CURRENT_TIMESTAMP) */
function toSqliteDate(date) {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

let db;

function getDatabase() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initializeSchema();
  }
  return db;
}

function initializeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE NOT NULL,
      name TEXT DEFAULT '',
      daily_limit INTEGER DEFAULT 50000,
      timezone TEXT DEFAULT 'Asia/Jakarta',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      limit_amount INTEGER NOT NULL,
      period TEXT NOT NULL DEFAULT 'daily',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      budget_id INTEGER,
      amount INTEGER NOT NULL,
      category TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (budget_id) REFERENCES budgets(id)
    );

    CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, created_at);
  `);

  // Migrasi schema lama: tambah kolom yang mungkin belum ada (tabel sudah exist dari versi sebelumnya)
  try { db.exec('ALTER TABLE expenses ADD COLUMN budget_id INTEGER REFERENCES budgets(id)'); } catch (e) {}
  try { db.exec('ALTER TABLE expenses ADD COLUMN budget_name TEXT DEFAULT ""'); } catch (e) {}

  // Index untuk budget_id harus dibuat SETELAH migrasi kolom
  db.exec('CREATE INDEX IF NOT EXISTS idx_expenses_budget ON expenses(budget_id, created_at)');
}

function getOrCreateUser(telegramId, name = '') {
  const db = getDatabase();
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (!user) {
    const info = db.prepare('INSERT INTO users (telegram_id, name) VALUES (?, ?)').run(telegramId, name);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  }
  return user;
}

function setDailyLimit(telegramId, limit) {
  const db = getDatabase();
  const user = getOrCreateUser(telegramId);
  db.prepare('UPDATE users SET daily_limit = ? WHERE id = ?').run(limit, user.id);
  return { ...user, daily_limit: limit };
}

function createBudget(telegramId, name, limit, period = 'daily') {
  const db = getDatabase();
  const user = getOrCreateUser(telegramId);
  try {
    const info = db.prepare('INSERT INTO budgets (user_id, name, limit_amount, period) VALUES (?, ?, ?, ?)').run(user.id, name, limit, period);
    return db.prepare('SELECT * FROM budgets WHERE id = ?').get(info.lastInsertRowid);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      throw new Error('Budget sudah ada');
    }
    throw err;
  }
}

function getBudgets(telegramId) {
  const db = getDatabase();
  const user = getOrCreateUser(telegramId);
  return db.prepare('SELECT * FROM budgets WHERE user_id = ? ORDER BY name ASC').all(user.id);
}

function getBudgetByName(telegramId, name) {
  const db = getDatabase();
  const user = getOrCreateUser(telegramId);
  return db.prepare('SELECT * FROM budgets WHERE user_id = ? AND name = ?').get(user.id, name);
}

function deleteBudget(telegramId, name) {
  const db = getDatabase();
  const user = getOrCreateUser(telegramId);
  const result = db.prepare('DELETE FROM budgets WHERE user_id = ? AND name = ?').run(user.id, name);
  return result.changes > 0;
}

function addExpense(telegramId, amount, category = '', note = '', budgetName = null) {
  const db = getDatabase();
  const user = getOrCreateUser(telegramId);

  let budgetId = null;
  if (budgetName) {
    const budget = getBudgetByName(telegramId, budgetName);
    if (budget) budgetId = budget.id;
  }

  const info = db.prepare('INSERT INTO expenses (user_id, budget_id, amount, category, note) VALUES (?, ?, ?, ?, ?)').run(user.id, budgetId, amount, category, note);
  return db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid);
}

function getTodayExpenses(telegramId) {
  const db = getDatabase();
  const user = getOrCreateUser(telegramId);
  const today = new Date();
  const startOfDay = toSqliteDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const endOfDay = toSqliteDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));

  return db.prepare(
    'SELECT e.*, b.name as budget_name FROM expenses e LEFT JOIN budgets b ON e.budget_id = b.id WHERE e.user_id = ? AND e.created_at >= ? AND e.created_at < ? ORDER BY e.created_at ASC'
  ).all(user.id, startOfDay, endOfDay);
}

function getTodayTotal(telegramId) {
  const expenses = getTodayExpenses(telegramId);
  return expenses.reduce((sum, e) => sum + e.amount, 0);
}

function getBudgetExpenses(telegramId, budgetId, periodStart, periodEnd) {
  const db = getDatabase();
  const user = getOrCreateUser(telegramId);
  return db.prepare(
    'SELECT * FROM expenses WHERE user_id = ? AND budget_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at ASC'
  ).all(user.id, budgetId, periodStart, periodEnd);
}

function getHistory(telegramId, days = 7) {
  const db = getDatabase();
  const user = getOrCreateUser(telegramId);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startStr = toSqliteDate(startDate);

  const rows = db.prepare(
    `SELECT DATE(created_at) as day, SUM(amount) as total
     FROM expenses
     WHERE user_id = ? AND created_at >= ?
     GROUP BY DATE(created_at)
     ORDER BY day ASC`
  ).all(user.id, startStr);

  return rows;
}

module.exports = {
  getDatabase,
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
};