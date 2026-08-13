# Tavern

Self-hosted writing and worldbuilding — modular story elements on a panel canvas, a Typora-like manuscript editor, multi-format export, and Campfire-oriented import.

Inspired by Campfire’s layout concepts; original code and UI. Not affiliated with Campfire Technology LLC.

## Features (v1)

- **Modules:** Manuscript, Characters, Encyclopedia, Relationships, Locations, Systems (Magic/Tech), Maps, Timeline, Species, Cultures, Items, Arcs, Languages, Religions, Research, Philosophies, Calendar
- **Panel engine:** attributes, text, list, stats, image, table, links — drag/resize canvas
- **Manuscript:** TipTap editor, source mode, corkboard, word goals, wiki-link helpers
- **Relationships:** React Flow graph backed by element links
- **Maps / Timeline:** image maps with location pins; chronological event rail
- **Export:** Markdown / DOCX / EPUB / PDF / HTML (via pandoc) + `.tavern` backups
- **Import:** Intermediate JSON, ZIP scans, Campfire HTML Export Server dumps; unknown binaries → encyclopedia stubs
- **Assets:** project image upload for panels and map backgrounds
- **Multi-user:** public signup with email verification, Argon2 sessions, project grants (owner / editor / viewer)

## Quick start

```bash
cp .env.example .env
# edit TAVERN_ADMIN_PASS (min 12 chars; not "admin")

docker compose up -d postgres
cd web && npm install && npm run build && cd ..
cargo run -p tavern-server
```

Open http://127.0.0.1:8084 and log in with `TAVERN_ADMIN_USER` / `TAVERN_ADMIN_PASS`. Writers can sign up once SMTP (or log-only mail) is configured — see `.env.example`.

Dev UI with HMR:

```bash
# terminal 1
cargo run -p tavern-server
# terminal 2
cd web && npm run dev
```

## Remotes

| Remote | URL | Notes |
|--------|-----|-------|
| `origin` | `git@github.com:MultiCelledShark/tavern.git` | Public — sanitize before push |
| `forgejo` | `forgejo:key/tavern.git` (SSH Host alias) | Homelab — set the real host in your local git remote |

See [docs/REMOTES.md](docs/REMOTES.md) for push workflow.

## Deploy

See [deploy/debian/README.md](deploy/debian/README.md). Debian/nginx cutover plan (not executed yet): [docs/DEBIAN_CUTOVER.md](docs/DEBIAN_CUTOVER.md).

## License

MIT
