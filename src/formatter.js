/**
 * Format amount to Indonesian Rupiah format.
 * Examples:
 *   5000   -> Rp5.000
 *   20000  -> Rp20.000
 *   150000 -> Rp150.000
 */

function formatRupiah(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return 'Rp0';
  }

  const num = Math.abs(amount);
  const formatted = num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `Rp${formatted}`;
}

function getDayName(dateStr) {
  const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const d = new Date(dateStr);
  return days[d.getDay()];
}

module.exports = { formatRupiah, getDayName };