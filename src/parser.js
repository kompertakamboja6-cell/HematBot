/**
 * Parse expense input with budget-aware matching.
 * Accepts formats:
 *   "20 makan"           -> { amount: 20000, note: "makan", budget: null }
 *   "20k kopi"           -> { amount: 20000, note: "kopi", budget: null }
 *   "20000 parkir"       -> { amount: 20000, note: "parkir", budget: null }
 *   "15"                 -> { amount: 15000, note: "", budget: null }
 *   "20 makan jajan"     -> { amount: 20000, note: "makan", budget: "jajan" } (if "jajan" is in userBudgets)
 *   "15 bensin transport" -> { amount: 15000, note: "bensin", budget: "transport" } (if "transport" is in userBudgets)
 *
 * @param {string} text - Raw user input
 * @param {string[]} userBudgets - List of budget names owned by the user
 * @returns {{ amount: number, note: string, budget: string|null } | null}
 */
function parseExpense(text, userBudgets = []) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  text = text.trim();

  // Match: number (with optional 'k') followed by optional text
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

  // Split rest into words
  const words = rest.split(/\s+/);

  // Check if last word matches any entry in userBudgets (case-insensitive exact match)
  const lastWord = words[words.length - 1];
  const budgetMatch = userBudgets.find(
    (b) => b.toLowerCase() === lastWord.toLowerCase()
  );

  let note, budget;

  if (budgetMatch) {
    // Last word matches a budget
    budget = budgetMatch;
    note = words.slice(0, -1).join(' ');
  } else {
    // No match: all words are the note
    note = words.join(' ');
    budget = null;
  }

  // Truncate note to 100 characters
  if (note.length > 100) {
    note = note.substring(0, 100);
  }

  return makeResult(amount, hasK, note, budget);
}

function makeResult(amount, hasK, note, budget) {
  if (hasK) {
    amount *= 1000;
  } else if (amount < 100) {
    amount *= 1000;
  }

  if (amount < 1000 || amount > 10_000_000) {
    return null;
  }

  return { amount, note, budget };
}

module.exports = { parseExpense };
