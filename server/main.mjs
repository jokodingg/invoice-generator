// Starts the invoice API.
//   PORT        default 3100
//   HOST        default 127.0.0.1 (nginx in front; never expose this port directly)
//   DATA_DIR    default ./data, holds invoices.json
//   STATIC_DIR  optional; also serve the web app (local development)
import { createServer } from "node:http";
import path from "node:path";
import { createHandler, createInvoiceStore } from "./app.mjs";

const port = Number(process.env.PORT ?? 3100);
const host = process.env.HOST ?? "127.0.0.1";
const dataFile = path.join(path.resolve(process.env.DATA_DIR ?? "data"), "invoices.json");
const staticDir = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : null;

const server = createServer(createHandler({ store: createInvoiceStore(dataFile), staticDir }));
server.listen(port, host, () => {
  console.log(`Invoice API on http://${host}:${port} (data: ${dataFile})`);
});
