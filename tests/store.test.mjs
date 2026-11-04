import { test } from "node:test";
import assert from "node:assert/strict";
import { createApi, recordsToMigrate } from "../js/store.js";

test("recordsToMigrate keeps only invoices the server does not have", () => {
  const local = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const server = [{ id: "b" }];
  assert.deepEqual(recordsToMigrate(local, server).map((record) => record.id), ["a", "c"]);
  assert.deepEqual(recordsToMigrate([], server), []);
});

function fakeFetch(status, body) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...options });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, fetchImpl };
}

test("put sends JSON to the invoice URL", async () => {
  const { calls, fetchImpl } = fakeFetch(200, {});
  await createApi(fetchImpl).put({ id: "a/b", items: [] });
  assert.equal(calls[0].url, "api/invoices/a%2Fb");
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].headers["Content-Type"], "application/json");
});

test("list fails when the server is missing or answers with something else", async () => {
  await assert.rejects(createApi(fakeFetch(404, null).fetchImpl).list(), /404/);
  await assert.rejects(createApi(fakeFetch(200, { error: "x" }).fetchImpl).list(), /tidak valid/);
});
