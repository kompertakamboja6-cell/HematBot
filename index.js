/**
 * HematBot - Telegram Budget Tracker
 * Bot budgeting tercepat untuk mencatat pengeluaran harian dalam <5 detik.
 */

const http = require('http');
const { startBot, bot } = require('./src/bot');
const { startScheduler } = require('./src/scheduler');

// Health check server untuk platform cloud (Koyeb, Railway, dll)
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('HematBot is running\n');
}).listen(PORT, () => {
  console.log(`Health check server listening on port ${PORT}`);
});

startBot();

// Start daily summary scheduler (sends notifications at 21:00 WIB)
startScheduler(bot);