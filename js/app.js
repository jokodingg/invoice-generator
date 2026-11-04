import { calcTotals, nextInvoiceNumber } from "./calc.js";
import { invoicePdfTitle } from "./filename.js";

const $ = (id) => document.getElementById(id);
const DRAFT_KEY = "jkd-invoice:draft";
const HISTORY_KEY = "jkd-invoice:history";
const SHEET_WIDTH = 794;

const form = $("invoice-form");
const itemFields = $("item-fields");

// ---------- storage (localStorage can throw or be empty: always guarded) ----------

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const loadHistory = () => {
  const list = readJSON(HISTORY_KEY, []);
  return Array.isArray(list) ? list.filter(isInvoiceRecord) : [];
};
const saveHistory = (list) => writeJSON(HISTORY_KEY, list);

function isInvoiceRecord(value) {
  return value && typeof value === "object" && typeof value.id === "string" && Array.isArray(value.items);
}

// ---------- invoice state ----------

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function isoDate(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function blankInvoice(base = {}) {
  const today = new Date();
  return {
    id: newId(),
    number: nextInvoiceNumber(loadHistory().map((record) => record.number), today),
    date: isoDate(today),
    dueDate: isoDate(addDays(today, 14)),
    client: "",
    clientPhone: "",
    items: [{ name: "", quantity: 1, price: "" }],
    discountType: "percent",
    discountValue: "",
    depositPercent: base.depositPercent ?? 50,
    currency: base.currency ?? "IDR",
    bankName: base.bankName ?? "",
    accountNumber: base.accountNumber ?? "",
    accountHolder: base.accountHolder ?? "",
    paid: false,
    notes: "",
  };
}

let current = null;

function readForm() {
  const items = [...itemFields.querySelectorAll(".item-row")].map((row) => ({
    name: row.querySelector(".item-name").value,
    quantity: row.querySelector(".item-quantity").value,
    price: row.querySelector(".item-price").value,
  }));
  return {
    ...current,
    number: $("invoice-number").value.trim(),
    date: $("invoice-date").value,
    dueDate: $("due-date").value,
    client: $("client-name").value,
    clientPhone: $("client-phone").value,
    items,
    discountType: $("discount-type").value,
    discountValue: $("discount-value").value,
    depositPercent: $("deposit-percent").value,
    currency: $("currency").value,
    bankName: $("bank-name").value,
    accountNumber: $("account-number").value,
    accountHolder: $("account-holder").value,
    paid: $("paid").checked,
    notes: $("notes").value,
  };
}

function fillForm(invoice) {
  current = invoice;
  $("invoice-number").value = invoice.number ?? "";
  $("invoice-date").value = invoice.date ?? "";
  $("due-date").value = invoice.dueDate ?? "";
  $("client-name").value = invoice.client ?? "";
  $("client-phone").value = invoice.clientPhone ?? "";
  $("discount-type").value = invoice.discountType === "amount" ? "amount" : "percent";
  $("discount-value").value = invoice.discountValue ?? "";
  $("deposit-percent").value = invoice.depositPercent ?? 50;
  $("currency").value = invoice.currency === "USD" ? "USD" : "IDR";
  $("bank-name").value = invoice.bankName ?? "";
  $("account-number").value = invoice.accountNumber ?? "";
  $("account-holder").value = invoice.accountHolder ?? "";
  $("paid").checked = Boolean(invoice.paid);
  $("notes").value = invoice.notes ?? "";
  itemFields.replaceChildren();
  const items = invoice.items?.length ? invoice.items : [{ name: "", quantity: 1, price: "" }];
  items.forEach(addItemRow);
  render();
}

// ---------- item rows ----------

function addItemRow(item = { name: "", quantity: 1, price: "" }) {
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `
    <label class="item-name-label">Nama item<textarea class="item-name" rows="2" placeholder="Contoh: Website company profile"></textarea></label>
    <label>Qty<input class="item-quantity" type="number" min="0" step="any" /></label>
    <label>Harga satuan<input class="item-price" type="number" min="0" step="any" placeholder="0" /></label>
    <button class="remove-item" type="button" aria-label="Hapus item" title="Hapus item">&times;</button>`;
  row.querySelector(".item-name").value = item.name ?? "";
  row.querySelector(".item-quantity").value = item.quantity ?? 1;
  row.querySelector(".item-price").value = item.price ?? "";
  row.querySelector(".remove-item").addEventListener("click", () => {
    if (itemFields.children.length > 1) row.remove();
    else row.querySelectorAll("textarea, input").forEach((input) => { input.value = input.classList.contains("item-quantity") ? 1 : ""; });
    onChange();
  });
  itemFields.appendChild(row);
  return row;
}

// ---------- formatting ----------

function money(amount, currency) {
  const formatter = new Intl.NumberFormat(currency === "USD" ? "en-US" : "id-ID", { style: "currency", currency, maximumFractionDigits: 0 });
  return formatter.format(Number(amount) || 0).replace(/\s/g, "");
}

function parseDate(value) {
  const date = value ? new Date(`${value}T12:00:00`) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

const longDate = (date) => (date ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date) : "-");
const monthYear = (date) => (date ? new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(date) : "-");
const setText = (id, value, fallback = "-") => { $(id).textContent = String(value ?? "").trim() || fallback; };

// ---------- preview ----------

function render() {
  const invoice = readForm();
  const totals = calcTotals(invoice);
  const fmt = (amount) => money(amount, invoice.currency);

  const rows = invoice.items.map((item, index) => {
    const tr = document.createElement("tr");
    const quantity = Number(item.quantity) || 0;
    const price = Number(item.price) || 0;
    [`${index + 1}.`, item.name.trim() || "-", quantity || "-", fmt(price), fmt(quantity * price)].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });
    return tr;
  });
  $("preview-items").replaceChildren(...rows);

  const hasDiscount = totals.discount > 0;
  $("row-subtotal").hidden = !hasDiscount;
  $("row-discount").hidden = !hasDiscount;
  $("preview-subtotal").textContent = fmt(totals.subtotal);
  $("preview-discount").textContent = `-${fmt(totals.discount)}`;
  const percentLabel = invoice.discountType === "percent" ? ` (${Math.min(100, Number(invoice.discountValue) || 0)}%)` : "";
  $("preview-discount-label").textContent = `Discount${percentLabel}`;
  $("preview-total").textContent = fmt(totals.total);

  $("preview-deposit-percent").textContent = `${totals.depositPercent}%`;
  $("preview-remaining-percent").textContent = `${100 - totals.depositPercent}%`;
  $("preview-deposit-amount").textContent = fmt(totals.deposit);
  $("preview-remaining-amount").textContent = fmt(totals.remaining);

  const dueDate = parseDate(invoice.dueDate);
  setText("preview-client", invoice.client, "Nama klien");
  const clientPhone = (invoice.clientPhone ?? "").trim();
  $("preview-client-phone").hidden = !clientPhone;
  $("preview-client-phone").textContent = clientPhone;
  setText("preview-number", invoice.number);
  $("preview-date").textContent = longDate(parseDate(invoice.date));
  $("preview-due-date").textContent = longDate(dueDate).toUpperCase();
  $("preview-due-month").textContent = monthYear(dueDate).toUpperCase();

  setText("preview-bank", invoice.bankName, "[Nama bank]");
  setText("preview-account", invoice.accountNumber, "[Nomor rekening]");
  setText("preview-holder", invoice.accountHolder, "[Nama pemegang rekening]");

  $("paid-stamp").hidden = !invoice.paid;
  $("notes-block").hidden = !invoice.notes.trim();
  $("preview-notes").textContent = invoice.notes.trim();

  fitSheet();
}

// Scale the fixed-width A4 sheet down to the available width so mobile shows the same layout as the PDF.
function fitSheet() {
  const frame = $("sheet-frame");
  const sheet = $("invoice");
  const available = frame.parentElement.clientWidth - parseFloat(getComputedStyle(frame.parentElement).paddingLeft) * 2;
  const scale = Math.min(1, available / SHEET_WIDTH);
  sheet.style.transform = scale < 1 ? `scale(${scale})` : "";
  frame.style.height = scale < 1 ? `${sheet.offsetHeight * scale}px` : "";
  frame.style.width = scale < 1 ? `${SHEET_WIDTH * scale}px` : "";
}

// ---------- autosave + status ----------

let statusTimer;
function setStatus(message, tone = "") {
  const status = $("save-status");
  status.textContent = message;
  status.dataset.tone = tone;
  clearTimeout(statusTimer);
  if (tone) statusTimer = setTimeout(() => setStatus("Draft tersimpan otomatis"), 3500);
}

let draftTimer;
function onChange() {
  render();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (!writeJSON(DRAFT_KEY, readForm())) setStatus("Browser memblokir penyimpanan draft", "warn");
  }, 300);
}

// ---------- history ----------

function saveCurrent() {
  if (!form.reportValidity()) return;
  const invoice = { ...readForm(), savedAt: new Date().toISOString() };
  const history = loadHistory();
  const clash = history.find((record) => record.number === invoice.number && record.id !== invoice.id);
  if (clash && !confirm(`Nomor ${invoice.number} sudah dipakai invoice lain (${clash.client || "tanpa nama"}). Tetap simpan?`)) return;
  const index = history.findIndex((record) => record.id === invoice.id);
  if (index >= 0) history[index] = invoice;
  else history.unshift(invoice);
  if (!saveHistory(history)) return setStatus("Gagal menyimpan: penyimpanan browser penuh atau diblokir", "warn");
  current = invoice;
  writeJSON(DRAFT_KEY, invoice);
  renderHistory();
  setStatus(`Tersimpan: ${invoice.number}`, "ok");
}

function renderHistory() {
  const history = loadHistory().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  $("history-count").textContent = history.length;
  $("history-empty").hidden = history.length > 0;
  const items = history.map((record) => {
    const li = document.createElement("li");
    li.className = "history-item";
    if (current && record.id === current.id) li.classList.add("active");

    const info = document.createElement("div");
    info.className = "history-info";
    const number = document.createElement("strong");
    number.textContent = record.number || "(tanpa nomor)";
    const meta = document.createElement("span");
    meta.textContent = `${record.client || "Tanpa nama klien"} · ${money(calcTotals(record).total, record.currency || "IDR")}`;
    info.append(number, meta);
    if (record.paid) {
      const badge = document.createElement("em");
      badge.className = "paid-badge";
      badge.textContent = "LUNAS";
      number.append(" ", badge);
    }

    const actions = document.createElement("div");
    actions.className = "history-actions";
    const button = (label, handler, extraClass = "") => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `mini-button ${extraClass}`.trim();
      el.textContent = label;
      el.addEventListener("click", handler);
      return el;
    };
    actions.append(
      button("Buka", () => { fillForm(structuredClone(record)); writeJSON(DRAFT_KEY, record); renderHistory(); setStatus(`Dibuka: ${record.number}`, "ok"); }),
      button("Duplikat", () => duplicate(record)),
      button("Hapus", () => removeRecord(record), "danger"),
    );
    li.append(info, actions);
    return li;
  });
  $("history-list").replaceChildren(...items);
}

function duplicate(record) {
  const fresh = blankInvoice(record);
  fillForm({ ...structuredClone(record), id: fresh.id, number: fresh.number, date: fresh.date, dueDate: fresh.dueDate, paid: false, savedAt: undefined });
  writeJSON(DRAFT_KEY, readForm());
  renderHistory();
  setStatus(`Duplikat dibuat: ${fresh.number} (belum disimpan)`, "ok");
}

function removeRecord(record) {
  if (!confirm(`Hapus invoice ${record.number} dari riwayat? Tindakan ini tidak bisa dibatalkan.`)) return;
  saveHistory(loadHistory().filter((item) => item.id !== record.id));
  renderHistory();
  setStatus(`Dihapus: ${record.number}`, "ok");
}

function exportHistory() {
  const blob = new Blob([JSON.stringify(loadHistory(), null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `jokoding-invoice-backup-${isoDate(new Date())}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function importHistory(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const incoming = JSON.parse(await file.text());
    if (!Array.isArray(incoming)) throw new Error("bukan daftar invoice");
    const valid = incoming.filter(isInvoiceRecord);
    const merged = new Map(loadHistory().map((record) => [record.id, record]));
    valid.forEach((record) => merged.set(record.id, record));
    saveHistory([...merged.values()]);
    renderHistory();
    setStatus(`Restore selesai: ${valid.length} invoice`, "ok");
  } catch (error) {
    setStatus(`File backup tidak valid (${error.message})`, "warn");
  }
}

// ---------- images ----------

function setupImage(imageId, placeholderId) {
  const image = $(imageId);
  image.addEventListener("load", () => { image.hidden = false; if (placeholderId) $(placeholderId).hidden = true; fitSheet(); });
  image.addEventListener("error", () => { image.hidden = true; if (placeholderId) $(placeholderId).hidden = false; });
  image.src = image.dataset.default; // set after listeners so a fast failure is never missed
}

// ---------- print ----------

function printInvoice() {
  if (!form.reportValidity()) return;
  const invoice = readForm();
  const previousTitle = document.title;
  document.title = invoicePdfTitle(invoice.client, invoice.date);
  window.addEventListener("afterprint", () => { document.title = previousTitle; }, { once: true });
  window.print();
}

// ---------- wire up ----------

form.addEventListener("input", onChange);
form.addEventListener("change", onChange);
form.addEventListener("submit", (event) => event.preventDefault());
$("add-item").addEventListener("click", () => { addItemRow().querySelector(".item-name").focus(); onChange(); });
$("auto-number").addEventListener("click", () => {
  const others = loadHistory().filter((record) => record.id !== current.id).map((record) => record.number);
  $("invoice-number").value = nextInvoiceNumber(others, parseDate($("invoice-date").value) ?? new Date());
  onChange();
});
$("new-invoice").addEventListener("click", () => {
  if (!confirm("Mulai invoice baru? Isian yang belum disimpan ke riwayat akan diganti.")) return;
  fillForm(blankInvoice(readForm()));
  writeJSON(DRAFT_KEY, readForm());
  renderHistory();
  setStatus("Invoice baru dibuat", "ok");
});
$("save-invoice").addEventListener("click", saveCurrent);
$("print-button").addEventListener("click", printInvoice);
$("export-history").addEventListener("click", exportHistory);
$("import-history").addEventListener("change", importHistory);
window.addEventListener("resize", fitSheet);
window.addEventListener("beforeprint", () => { $("invoice").style.transform = ""; $("sheet-frame").style.height = ""; $("sheet-frame").style.width = ""; });
window.addEventListener("afterprint", fitSheet);
document.fonts?.ready.then(fitSheet);

setupImage("logo-image", "logo-placeholder");
setupImage("signature-image");

const draft = readJSON(DRAFT_KEY, null);
fillForm(isInvoiceRecord(draft) ? draft : blankInvoice());
renderHistory();
