// Invoice history API. Stores every invoice in one JSON file.
// No dependencies: only Node's standard library.
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export function isInvoiceRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 100
    && Array.isArray(value.items);
}

export function createInvoiceStore(file) {
  async function read() {
    let raw;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    // A parse error throws on purpose: the file must be fixed by hand, never replaced with an empty list.
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error(`${file} does not contain a list`);
    return list.filter(isInvoiceRecord);
  }

  async function write(list) {
    await mkdir(path.dirname(file), { recursive: true });
    await copyFile(file, `${file}.bak`).catch((error) => { if (error.code !== "ENOENT") throw error; });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(list, null, 2)}\n`);
    await rename(temp, file); // atomic: readers see the old or the new file, never half of one
  }

  // Changes run one at a time, so two saves at once never lose each other.
  let queue = Promise.resolve();
  function change(mutate) {
    const run = queue.then(async () => {
      const list = await read();
      const result = mutate(list);
      await write(list);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    list: read,
    put: (record) => change((list) => {
      const index = list.findIndex((item) => item.id === record.id);
      if (index >= 0) list[index] = record;
      else list.unshift(record);
      return record;
    }),
    remove: (id) => change((list) => {
      const index = list.findIndex((item) => item.id === id);
      if (index >= 0) list.splice(index, 1);
    }),
    importMany: (records) => change((list) => {
      const byId = new Map(list.map((item) => [item.id, item]));
      records.forEach((record) => byId.set(record.id, record));
      list.splice(0, list.length, ...byId.values());
      return { imported: records.length, total: list.length };
    }),
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (body === undefined) {
    res.writeHead(status, headers).end();
    return;
  }
  res.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
}

async function readJsonBody(req) {
  // Requiring application/json forces a CORS preflight, so other websites cannot write here.
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "body too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "body is not valid JSON");
  }
}

async function handleApi(req, res, pathname, store) {
  if (pathname === "/api/health" && req.method === "GET") return send(res, 200, { ok: true });
  if (pathname === "/api/invoices" && req.method === "GET") return send(res, 200, await store.list());
  if (pathname === "/api/invoices/import" && req.method === "POST") {
    const records = await readJsonBody(req);
    if (!Array.isArray(records)) throw new HttpError(400, "body must be a list of invoices");
    return send(res, 200, await store.importMany(records.filter(isInvoiceRecord)));
  }
  const match = pathname.match(/^\/api\/invoices\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (req.method === "PUT") {
      const record = await readJsonBody(req);
      if (!isInvoiceRecord(record) || record.id !== id) throw new HttpError(400, "body must be an invoice with the id from the URL");
      return send(res, 200, await store.put(record));
    }
    if (req.method === "DELETE") {
      await store.remove(id);
      return send(res, 204);
    }
  }
  throw new HttpError(404, "not found");
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// Local development only. On the VPS, nginx serves the static files.
async function serveStatic(res, root, pathname) {
  const relative = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\]|\.\.([/\\]|$))+/, "");
  let file = path.join(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) throw new HttpError(404, "not found");
  if (file === root || pathname.endsWith("/")) file = path.join(file, "index.html");
  let body;
  try {
    body = await readFile(file);
  } catch {
    throw new HttpError(404, "not found");
  }
  res.writeHead(200, { "Content-Type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" }).end(body);
}

export function createHandler({ store, staticDir = null }) {
  const root = staticDir ? path.resolve(staticDir) : null;
  return async (req, res) => {
    try {
      const { pathname } = new URL(req.url, "http://localhost");
      if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname, store);
      if (root) return await serveStatic(res, root, pathname);
      throw new HttpError(404, "not found");
    } catch (error) {
      if (error instanceof HttpError) return send(res, error.status, { error: error.message });
      console.error(error);
      return send(res, 500, { error: "internal error" });
    }
  };
}
