import { test } from "node:test";
import assert from "node:assert/strict";
import { invoicePdfTitle } from "../js/filename.js";

test("PDF title uses client name and invoice month/year", () => {
  assert.equal(invoicePdfTitle("Tiara Bimo", "2026-11-03"), "Invoice - Tiara Bimo - November 2026");
});

test("PDF title replaces filename-reserved characters", () => {
  assert.equal(invoicePdfTitle("Acme/Studio: Co.", "2026-01-15"), "Invoice - Acme-Studio- Co. - Januari 2026");
});

test("PDF title has a fallback for an empty client", () => {
  assert.equal(invoicePdfTitle("  ", "2026-07-15"), "Invoice - Tanpa Nama Klien - Juli 2026");
});
