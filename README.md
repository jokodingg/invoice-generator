# Jokoding Invoice

Invoice generator (HTML, CSS, ES modules, no build step) with a small Node API that stores invoice history on the server. Drafts stay in the browser's `localStorage`.

## Local development

```bash
npm run dev        # web app + API on http://localhost:8080, data in ./data/invoices.json
npm run dev:static # web app only (python3 http.server); history falls back to localStorage
npm test           # node --test tests/
```

## How history is stored

- The API (`server/`, Node 18+, no dependencies) keeps every invoice in one file: `invoices.json`. Each write is atomic, and the previous version is kept as `invoices.json.bak`.
- On load the app calls `api/invoices`. If the API answers, history is read from and saved to the server. Invoices still in the browser's `localStorage` are uploaded once, and a copy stays under `jkd-invoice:history-migrated`.
- If the API does not answer, the app falls back to `localStorage` and says so under "Riwayat invoice".

API: `GET /api/invoices`, `PUT /api/invoices/:id`, `DELETE /api/invoices/:id`, `POST /api/invoices/import`, `GET /api/health`. Write requests must send `Content-Type: application/json`.

## Assets

- `assets/logo.png`: Jokoding logo (transparent PNG).
- `assets/signature.png`: signature (transparent PNG). The file is optional. If it is missing, the signature area stays blank for a wet signature.

## Deploying to a VPS (Ubuntu/Debian)

Put the repository on the VPS (`git clone`, or `rsync` from your machine), then run from that folder.

**Without a domain (ngrok):**

```bash
sudo bash deploy/install.sh   # nginx on 127.0.0.1:8080 (change with WEB_PORT=9000 sudo -E bash ...)
ngrok http 8080               # point the tunnel at nginx, not at the API port
```

nginx listens on localhost only, so the tunnel is the only way in. ngrok already gives HTTPS.

**With your own domain:**

```bash
sudo bash deploy/install.sh invoice.yourdomain.com   # nginx on port 80, plus Let's Encrypt HTTPS
```

The script:

1. Installs nginx (and Node.js 24 from NodeSource, after asking, when Node 18+ is missing).
2. Copies the web app to `/var/www/jokoding-invoice` and the API to `/opt/jokoding-invoice`.
3. Installs the systemd service `jokoding-invoice` on `127.0.0.1:3100` (change with `PORT=3200 sudo -E bash ...`). Data goes to `/var/lib/jokoding-invoice/invoices.json`.
4. Asks for a username and password (nginx basic auth). The login is required: the ngrok URL is public, and the API returns client names, phone numbers and bank details.
5. Writes the nginx site from `deploy/nginx.conf` to `/etc/nginx/sites-available/invoice` (the old one is kept as `.bak-<date>`). With a domain, it also sets up or re-applies the Let's Encrypt certificate.

To update: `git pull`, then run the same install command again. Data and login are kept.

Useful commands:

```bash
journalctl -u jokoding-invoice -f                                   # API logs
sudo cp /var/lib/jokoding-invoice/invoices.json ~/invoices-$(date +%F).json  # backup
sudo rm /etc/nginx/.htpasswd-invoice && sudo bash deploy/install.sh  # reset login
```

**Backup (.json)** and **Restore** in the app still work and go through the server.
