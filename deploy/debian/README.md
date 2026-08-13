# Deploying Tavern (Debian / systemd)

## Public checklist (safe for GitHub)

1. Build a static (or musl) release binary: `cargo build -p tavern-server --release`
2. Install binary as `/usr/local/bin/tavern`
3. Create user + data dir, e.g. `/var/lib/tavern` (assets only; Postgres holds the catalog)
4. Install env file from `.env.example` → `/etc/tavern.env` (strong admin password + `TAVERN_DATABASE_URL`)
5. Install `deploy/debian/tavern.service` → `/etc/systemd/system/tavern.service`
6. `systemctl enable --now tavern`
7. Put a reverse proxy in front (nginx/Caddy) with TLS; set `TAVERN_COOKIE_SECURE=1` and `TAVERN_TRUST_PROXY=1` when HTTPS terminates at the proxy
8. Optional: install `pandoc` for DOCX/EPUB/PDF export

Example nginx location (placeholders only):

```nginx
server {
  listen 443 ssl;
  server_name tavern.example.com;
  # ssl_certificate ...;
  location / {
    proxy_pass http://127.0.0.1:8084;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Homelab notes

Keep LAN IPs, hostnames, and domain-specific nginx snippets in your Forgejo wiki or a **gitignored** `docs/homelab.md` (start from `docs/homelab.md.example`). Do not push those details to GitHub.

For the tracked cutover sequence (build → systemd → data migrate → nginx → rollback), see [docs/DEBIAN_CUTOVER.md](../../docs/DEBIAN_CUTOVER.md). Update that watch list when uploads, listen defaults, or cookie/proxy env vars change.
