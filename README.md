# Jokoding Invoice

Static invoice generator (HTML, CSS, ES modules). No build step and no backend. Drafts and invoice history are stored in the browser's `localStorage`.

## Local development

ES modules do not load over `file://`, so serve the folder over HTTP:

```bash
npm run dev        # python3 -m http.server 8080, then open http://localhost:8080
npm test           # node --test tests/ (invoice math and numbering)
```

## Assets

- `assets/logo.png`: Jokoding logo (transparent PNG).
- `assets/signature.png`: signature (transparent PNG). The file is optional. If it is missing, the signature area stays blank for a wet signature.

## Deploying to a VPS

```bash
# from this folder, on your machine
rsync -avz --delete --exclude tests --exclude deploy --exclude package.json --exclude README.md \
  ./ user@your-vps:/var/www/jokoding-invoice/
```

Then install `deploy/nginx.conf`. The steps are in the comments at the top of that file.

## Data notes

- History exists only in the browser that saved it. Use **Backup (.json)** regularly and **Restore** on a new device.
- The site is public unless you enable `auth_basic` in the nginx config.
