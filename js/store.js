// Client for the invoice history API on the VPS (server/app.mjs).
// The URL is relative, so the app works at any domain or path.

export function createApi(fetchImpl = (...args) => globalThis.fetch(...args), base = "api/invoices") {
  async function call(method, suffix = "", body, timeoutMs = 10000) {
    const response = await fetchImpl(`${base}${suffix}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`server menjawab ${response.status}`);
    return response.status === 204 ? null : response.json();
  }

  return {
    async list() {
      const list = await call("GET", "", undefined, 5000);
      if (!Array.isArray(list)) throw new Error("respons server tidak valid");
      return list;
    },
    put: (record) => call("PUT", `/${encodeURIComponent(record.id)}`, record),
    remove: (id) => call("DELETE", `/${encodeURIComponent(id)}`),
    importMany: (records) => call("POST", "/import", records),
  };
}

// Invoices saved in this browser before the server existed, and not on the server yet.
export function recordsToMigrate(localList, serverList) {
  const onServer = new Set(serverList.map((record) => record.id));
  return localList.filter((record) => !onServer.has(record.id));
}
