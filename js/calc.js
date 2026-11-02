// Pure invoice logic: no DOM, no storage. Tested in tests/calc.test.mjs.

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const NUMBER_PATTERN = /^INV-(\d+)\/JKD\/[IVX]+\/(\d{4})$/i;

export function toRoman(month) {
  return ROMAN[month - 1] ?? "";
}

export function formatInvoiceNumber(seq, date) {
  return `INV-${String(seq).padStart(3, "0")}/JKD/${toRoman(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function parseInvoiceNumber(value) {
  const match = String(value ?? "").trim().match(NUMBER_PATTERN);
  return match ? { seq: Number(match[1]), year: Number(match[2]) } : null;
}

export function nextInvoiceNumber(existingNumbers, date) {
  const year = date.getFullYear();
  const highest = existingNumbers
    .map(parseInvoiceNumber)
    .filter((parsed) => parsed && parsed.year === year)
    .reduce((max, parsed) => Math.max(max, parsed.seq), 0);
  return formatInvoiceNumber(highest + 1, date);
}

const nonNegative = (value) => Math.max(0, Number(value) || 0);
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export function calcTotals({ items, discountType, discountValue, depositPercent }) {
  const subtotal = items.reduce((sum, item) => sum + nonNegative(item.quantity) * nonNegative(item.price), 0);
  const rawDiscount = discountType === "amount" ? nonNegative(discountValue) : subtotal * clamp(discountValue, 0, 100) / 100;
  const discount = Math.round(Math.min(subtotal, rawDiscount));
  const total = Math.round(subtotal - discount);
  const percent = clamp(depositPercent, 0, 100);
  const deposit = Math.round(total * percent / 100);
  return { subtotal, discount, total, depositPercent: percent, deposit, remaining: total - deposit };
}
