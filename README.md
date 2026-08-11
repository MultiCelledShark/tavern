# Tavern

Self-hosted writing and worldbuilding — modular story elements on a panel canvas, a Typora-like manuscript editor, multi-format export, and Campfire-oriented import.

Inspired by Campfire’s layout concepts; original code and UI. Not affiliated with Campfire Technology LLC.

## Features (v1)

- **Modules:** Manuscript, Characters, Encyclopedia, Relationships, Locations, Systems (Magic/Tech)
- **Panel engine:** attributes, text, list, stats, image, table, links — drag/resize canvas
- **Manuscript:** TipTap editor, source mode, corkboard, word goals, wiki-link helpers
- **Relationships:** React Flow graph backed by element links
- **Export:** Markdown / DOCX / EPUB / PDF / HTML (via pandoc) + `.tavern` backups
- **Import:** Intermediate JSON, ZIP scans, opaque Campfire backups → encyclopedia stubs
- **Multi-user:** Argon2 sessions, project grants (owner / editor / viewer)

## Quick start

```bash
cp .env.example .env
# edit TAVERN_ADMIN_PASS (min 12 chars; not "admin")

cd web && npm install && npm run build && cd ..
cargo run -p tavern-server
```

Open http://127.0.0.1:8084 and log in with `TAVERN_ADMIN_USER` / `TAVERN_ADMIN_PASS`.

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

See [deploy/debian/README.md](deploy/debian/README.md).

## License

MIT
