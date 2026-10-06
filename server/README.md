# Hosting Yuksalish Agro on your own server

The page is static, but shared saving ("Saqlash", section 14 history) needs a place to keep versions.
`server.mjs` is that place: a single-file Node.js server (Node 18+, no npm packages) that

- serves the project folder (`index.html`, images, `assets/plots.json`), and
- keeps saved versions as JSON files under `server/data/versions/`, exposed as `GET`/`POST …/api/versions`.

When `index.html` is opened from this server, the page finds the API next to itself and everyone who
can open the page can save and see every saved version. Inside claude.ai the page keeps using the
artifact database instead; opened as a plain file it stays local-only.

## Run locally

```sh
node server/server.mjs            # http://127.0.0.1:8787
PORT=9000 SAVE_KEY=secret node server/server.mjs
```

## Deploy on a VPS (nginx + systemd)

1. Copy the project to the server, for example `/var/www/yuksalish-agro`, and make sure
   `node --version` is 18 or newer. Give the service user write access to `server/data`:
   `sudo chown -R www-data:www-data /var/www/yuksalish-agro/server`.
2. Install the unit: `sudo cp server/yuksalish-agro.service /etc/systemd/system/`, edit the paths and the
   optional `SAVE_KEY`, then `sudo systemctl daemon-reload && sudo systemctl enable --now yuksalish-agro`.
   Check with `curl -s http://127.0.0.1:8787/api/versions`.
3. Add an nginx server block for the subdomain and reload nginx:

```nginx
server {
    listen 80;
    server_name reja.example.uz;          # your subdomain

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 1m;
    }

    gzip on;
    gzip_proxied any;
    gzip_types application/json text/html text/javascript text/css;
}
```

4. HTTPS: `sudo certbot --nginx -d reja.example.uz`.

## Settings (environment variables)

| Variable       | Default                | Meaning |
|----------------|------------------------|---------|
| `PORT`         | `8787`                 | listen port |
| `HOST`         | `127.0.0.1`            | bind address; keep it local and let nginx face the internet |
| `DATA_DIR`     | `<project>/server/data`| where versions are written |
| `SAVE_KEY`     | unset                  | if set, saving requires this key; the page asks for it once per browser. Unset means anyone who can open the page can save |
| `MAX_VERSIONS` | `2000`                 | refuse new saves above this count |

Built-in limits: one version is at most 256 KB, 10 saves per IP per minute, the page lists the newest
100 versions. The `server/` and `tools/` folders are never served, so saved data is not downloadable.

## Backup

Everything is in `server/data/versions/*.json`; copy that folder. Deleting a file removes that version.
