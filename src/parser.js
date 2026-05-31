/**
 * Parse expense input from user.
 * Accepts formats:
 *   "20 makan"           -> { amount: 20000, note: "makan", budget: null }
 *   "20k kopi"           -> { amount: 20000, note: "kopi", budget: null }
 *   "20000 parkir"       -> { amount: 20000, note: "parkir", budget: null }
 *   "15"                 -> { amount: 15000, note: "", budget: null }
 *   "20 makan jajan"     -> { amount: 20000, note: "makan", budget: "jajan" }
 *   "15 bensin transport" -> { amount: 15000, note: "bensin", budget: "transport" }
 */

function parseExpense(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  text = text.trim();

  // Match: number (with optional 'k') followed by optional note and optional budget
  const match = text.match(/^(\d+)(k?)\s+(.+)$/i);
  const matchNoNote = text.match(/^(\d+)(k?)$/i);

  let amount, hasK;

  if (matchNoNote) {
    // Just a number: "15" or "20k"
    amount = parseInt(matchNoNote[1], 10);
    hasK = matchNoNote[2].toLowerCase() === 'k';
    return makeResult(amount, hasK, '', null);
  }

  if (!match) {
    return null;
  }

  amount = parseInt(match[1], 10);
  hasK = match[2].toLowerCase() === 'k';
  const rest = match[3].trim();

  // Split rest into words: last word might be a budget name
  const words = rest.split(/\s+/);

  // If there are 2+ words, last word could be a budget
  if (words.length >= 2) {
    const note = words.slice(0, -1).join(' ');
    const budget = words[words.length - 1];
    return makeResult(amount, hasK, note, budget);
  }

  // Single word after the number
  return makeResult(amount, hasK, words[0], null);
}

function makeResult(amount, hasK, note, budget) {
  if (hasK) {
    amount *= 1000;
  } else if (amount < 100) {
    amount *= 1000;
  }

  if (amount <= 0 || amount > 10_000_000) {
    return null;
  }

  return { amount, note, budget };
}

module.exports = { parseExpense };