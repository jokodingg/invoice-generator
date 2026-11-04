import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHandler, createInvoiceStore } from "../server/app.mjs";

let dir;
let server;
let base;

async function start({ staticDir } = {}) {
  const store = createInvoiceStore(path.join(dir, "data", "invoices.json"));
  server = createServer(createHandler({ store, staticDir }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}

const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const invoice = (id, extra = {}) => ({ id, number: `INV-${id}`, items: [{ name: "Web", quantity: 1, price: 100 }], ...extra });

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "invoice-test-"));
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

test("health and empty list", async () => {
  await start();
  assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true });
  const response = await fetch(`${base}/api/invoices`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), []);
});

test("PUT creates, then updates the same id", async () => {
  await start();
  assert.equal((await fetch(`${base}/api/invoices/a1`, json("PUT", invoice("a1")))).status, 200);
  await fetch(`${base}/api/invoices/a1`, json("PUT", invoice("a1", { clientPhone: "0812" })));
  const list = await (await fetch(`${base}/api/invoices`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].clientPhone, "0812");
  const onDisk = JSON.parse(await readFile(path.join(dir, "data", "invoices.json"), "utf8"));
  assert.equal(onDisk[0].clientPhone, "0812");
});

test("PUT rejects bad input", async () => {
  await start();
  assert.equal((await fetch(`${base}/api/invoices/a1`, json("PUT", invoice("other")))).status, 400);
  assert.equal((await fetch(`${base}/api/invoices/a1`, json("PUT", { id: "a1" }))).status, 400);
  const notJson = await fetch(`${base}/api/invoices/a1`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal(notJson.status, 400);
  // text/plain is a "simple" cross-site request: refuse it so other sites cannot write.
  const plain = await fetch(`${base}/api/invoices/a1`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(invoice("a1")) });
  assert.equal(plain.status, 415);
  assert.deepEqual(await (await fetch(`${base}/api/invoices`)).json(), []);
});

test("DELETE removes and is idempotent", async () => {
  await start();
  await fetch(`${base}/api/invoices/a1`, json("PUT", invoice("a1")));
  assert.equal((await fetch(`${base}/api/invoices/a1`, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${base}/api/invoices/a1`, { method: "DELETE" })).status, 204);
  assert.deepEqual(await (await fetch(`${base}/api/invoices`)).json(), []);
});

test("import merges by id and skips invalid records", async () => {
  await start();
  await fetch(`${base}/api/invoices/a1`, json("PUT", invoice("a1")));
  const response = await fetch(`${base}/api/invoices/import`, json("POST", [invoice("a1", { paid: true }), invoice("b2"), { id: "bad" }]));
  assert.deepEqual(await response.json(), { imported: 2, total: 2 });
  const list = await (await fetch(`${base}/api/invoices`)).json();
  assert.equal(list.find((record) => record.id === "a1").paid, true);
});

test("parallel saves are all kept", async () => {
  await start();
  const ids = Array.from({ length: 20 }, (_, index) => `id${index}`);
  await Promise.all(ids.map((id) => fetch(`${base}/api/invoices/${id}`, json("PUT", invoice(id)))));
  const list = await (await fetch(`${base}/api/invoices`)).json();
  assert.deepEqual(list.map((record) => record.id).sort(), [...ids].sort());
});

test("a corrupt data file is never overwritten", async () => {
  await mkdir(path.join(dir, "data"));
  await writeFile(path.join(dir, "data", "invoices.json"), "{not json");
  await start();
  assert.equal((await fetch(`${base}/api/invoices`)).status, 500);
  assert.equal((await fetch(`${base}/api/invoices/a1`, json("PUT", invoice("a1")))).status, 500);
  assert.equal(await readFile(path.join(dir, "data", "invoices.json"), "utf8"), "{not json");
});

test("static files are served only inside the static folder", async () => {
  const site = path.join(dir, "site");
  await mkdir(site);
  await writeFile(path.join(site, "index.html"), "<h1>hi</h1>");
  await writeFile(path.join(dir, "secret.txt"), "secret");
  await start({ staticDir: site });
  const page = await fetch(`${base}/`);
  assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(await page.text(), "<h1>hi</h1>");
  assert.equal((await fetch(`${base}/..%2fsecret.txt`)).status, 404);
  assert.equal((await fetch(`${base}/missing.js`)).status, 404);
});

test("without a static folder only the API answers", async () => {
  await start();
  assert.equal((await fetch(`${base}/index.html`)).status, 404);
});
