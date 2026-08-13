# Debian cutover plan (tracked, not executed yet)

Public checklist for moving Tavern from the current LAN/dev host onto a Debian server behind nginx. **Do not put real hostnames, LAN IPs, or cert paths in this file** — those belong in the Forgejo wiki or gitignored `docs/homelab.md`.

Status: **planned only**. Update this doc whenever app behavior changes the deploy surface.

## Goals

- Run `tavern` under systemd on Debian
- Terminate TLS at nginx; app listens on localhost only
- Preserve (or intentionally reset) project data and uploaded assets
- Keep GitHub free of homelab specifics

## Current deploy surface (what the app expects)

| Concern | Today | Cutover note |
|--------|--------|--------------|
| Binary | `cargo run -p tavern-server` embeds `web/dist` via rust-embed | Release build on a machine with Node (or use prebuilt `web/dist` in tree), then copy `/usr/local/bin/tavern` |
| Listen | `TAVERN_LISTEN` default `0.0.0.0:8084` | Prefer `127.0.0.1:8084` behind nginx |
| Data | `TAVERN_DATABASE_URL` (Postgres) + `TAVERN_DATA_DIR` for `projects/*/assets`, imports/exports | Dump/restore Postgres separately from the assets tree |
| Auth cookies | `TAVERN_COOKIE_SECURE`, `TAVERN_TRUST_PROXY` | Set both to `1` when HTTPS terminates at nginx |
| Uploads | `POST /api/projects/{id}/assets` (images ≤ 12MB) | nginx `client_max_body_size` must be ≥ 12MB (recommend 16m) |
| Export | pandoc optional for DOCX/EPUB/PDF | Install `pandoc` on the server if those formats matter |
| Unit | `deploy/debian/tavern.service` | `ReadWritePaths=/var/lib/tavern` already covers DB + assets |

## Phased cutover (when we execute)

### 0. Homelab sheet (private)

Fill `docs/homelab.md` (gitignored) or Forgejo wiki with:

- Debian host alias / SSH target
- Public hostname / TLS cert strategy
- nginx site name and upstream
- Whether to migrate existing `data/` or start fresh
- Backup location for `/var/lib/tavern`

### 1. Build artifact

On a build host (or CI):

1. `cd web && npm ci && npm run build && cd ..`
2. `cargo build -p tavern-server --release`
3. Record commit SHA on the binary host for rollback

Ship: `target/release/tavern` (or musl static build if preferred).

### 2. Debian host prep

1. Create system user `tavern`
2. `mkdir -p /var/lib/tavern && chown tavern:tavern /var/lib/tavern`
3. Install Postgres and create a `tavern` database/role
4. Install binary → `/usr/local/bin/tavern`
5. `/etc/tavern.env` from `.env.example`:
   - Strong `TAVERN_ADMIN_PASS`
   - `TAVERN_LISTEN=127.0.0.1:8084`
   - `TAVERN_DATA_DIR=/var/lib/tavern`
   - `TAVERN_DATABASE_URL=postgres://tavern:...@127.0.0.1:5432/tavern`
   - `TAVERN_COOKIE_SECURE=1`
   - `TAVERN_TRUST_PROXY=1`
6. Install unit from `deploy/debian/tavern.service`
7. Optional: `apt install pandoc`
8. `systemctl enable --now tavern` and hit `http://127.0.0.1:8084/api/health` on the host

### 3. Data migration (if keeping projects)

1. Stop writing on the old host (`systemctl stop` / stop tmux server)
2. Copy `data/` (or current `TAVERN_DATA_DIR`) → `/var/lib/tavern` preserving ownership (assets)
3. Restore Postgres (`pg_dump` / `pg_restore`) into the Debian database
4. Confirm `projects/*/assets` present and `TAVERN_DATABASE_URL` points at the restored DB
5. Start systemd unit; smoke-test login, an image panel, and a map background

### 4. nginx cutover

1. Add server block (see placeholders in `deploy/debian/README.md`)
2. Set `client_max_body_size 16m;` for asset uploads
3. Proxy headers: `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`
4. Enable site, reload nginx, verify HTTPS login + cookie session
5. Point DNS / LAN name at the Debian host
6. Decommission or firewall the old `:8084` listener

### 5. Rollback

1. Revert nginx upstream / DNS to previous host **or** restore previous `/usr/local/bin/tavern` + data tarball
2. Keep one dated tarball of `/var/lib/tavern` before each upgrade

## Watch list (update when code changes)

Add a line here if a PR changes deploy assumptions:

| Date / commit | Change | Deploy impact |
|---------------|--------|----------------|
| 2026-08-11 / UX+assets | Project asset uploads + maps/timeline | Need RW data dir, nginx body size ≥ 12MB, migrate `projects/*/assets` |
| (pending) | Debian cutover execution | — |

## Out of scope for this plan

- Kubernetes / multi-instance tavern (one app process is still the unit; Postgres is the catalog)
- Putting real Albion hostnames in the public repo
