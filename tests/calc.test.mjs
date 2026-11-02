import { test } from "node:test";
import assert from "node:assert/strict";
import { toRoman, formatInvoiceNumber, parseInvoiceNumber, nextInvoiceNumber, calcTotals } from "../js/calc.js";

test("toRoman converts months 1-12", () => {
  assert.equal(toRoman(1), "I");
  assert.equal(toRoman(4), "IV");
  assert.equal(toRoman(7), "VII");
  assert.equal(toRoman(9), "IX");
  assert.equal(toRoman(12), "XII");
});

test("formatInvoiceNumber pads sequence and uses roman month", () => {
  assert.equal(formatInvoiceNumber(1, new Date(2026, 6, 16)), "INV-001/JKD/VII/2026");
  assert.equal(formatInvoiceNumber(42, new Date(2026, 10, 2)), "INV-042/JKD/XI/2026");
  assert.equal(formatInvoiceNumber(1234, new Date(2027, 0, 1)), "INV-1234/JKD/I/2027");
});

test("parseInvoiceNumber reads sequence and year", () => {
  assert.deepEqual(parseInvoiceNumber("INV-007/JKD/XI/2026"), { seq: 7, year: 2026 });
  assert.deepEqual(parseInvoiceNumber(" inv-012/jkd/i/2027 "), { seq: 12, year: 2027 });
  assert.equal(parseInvoiceNumber("custom-number"), null);
  assert.equal(parseInvoiceNumber(""), null);
});

test("nextInvoiceNumber continues highest sequence of same year", () => {
  const date = new Date(2026, 10, 2);
  assert.equal(nextInvoiceNumber([], date), "INV-001/JKD/XI/2026");
  assert.equal(nextInvoiceNumber(["INV-003/JKD/VII/2026", "INV-009/JKD/X/2026", "INV-050/JKD/XII/2025", "random"], date), "INV-010/JKD/XI/2026");
  assert.equal(nextInvoiceNumber(["INV-050/JKD/XII/2025"], date), "INV-001/JKD/XI/2026");
});

const items = [{ quantity: 2, price: 500000 }, { quantity: 1, price: 250000 }];

test("calcTotals without discount", () => {
  const t = calcTotals({ items, discountType: "percent", discountValue: 0, depositPercent: 50 });
  assert.equal(t.subtotal, 1250000);
  assert.equal(t.discount, 0);
  assert.equal(t.total, 1250000);
  assert.equal(t.deposit, 625000);
  assert.equal(t.remaining, 625000);
  assert.equal(t.depositPercent, 50);
});

test("calcTotals with percent discount", () => {
  const t = calcTotals({ items, discountType: "percent", discountValue: 10, depositPercent: 50 });
  assert.equal(t.discount, 125000);
  assert.equal(t.total, 1125000);
  assert.equal(t.deposit, 562500);
});

test("calcTotals with amount discount clamps to subtotal", () => {
  assert.equal(calcTotals({ items, discountType: "amount", discountValue: 250000, depositPercent: 30 }).total, 1000000);
  const over = calcTotals({ items, discountType: "amount", discountValue: 9999999, depositPercent: 30 });
  assert.equal(over.discount, 1250000);
  assert.equal(over.total, 0);
});

test("calcTotals clamps percents and ignores bad numbers", () => {
  const t = calcTotals({ items: [{ quantity: "abc", price: 100 }, { quantity: 1, price: -50 }, { quantity: 3, price: 100 }], discountType: "percent", discountValue: 150, depositPercent: 130 });
  assert.equal(t.subtotal, 300);
  assert.equal(t.discount, 300);
  assert.equal(t.depositPercent, 100);
  const n = calcTotals({ items, discountType: "percent", discountValue: -5, depositPercent: -10 });
  assert.equal(n.discount, 0);
  assert.equal(n.depositPercent, 0);
  assert.equal(n.remaining, 1250000);
});

test("calcTotals rounds money to whole units", () => {
  const t = calcTotals({ items: [{ quantity: 1, price: 333333 }], discountType: "percent", discountValue: 0, depositPercent: 50 });
  assert.equal(t.deposit, 166667);
  assert.equal(t.deposit + t.remaining, t.total);
});
