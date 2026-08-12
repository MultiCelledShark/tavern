# Tavern phased plan

## Done in scaffold

- [x] Cargo workspace (`tavern-core`, `tavern-db`, `tavern-import`, `tavern-export`, `tavern-server`)
- [x] Auth + project ACL
- [x] Panel engine + React shell
- [x] Manuscript TipTap editor
- [x] Manuscript TipTap → bespoke contentEditable (slim stack Phase 1) — see [SLIM_STACK.md](./SLIM_STACK.md)
- [x] v1 modules
- [x] Export + `.tavern` backup
- [x] Import scaffold (intermediate JSON / zip / opaque stubs)
- [x] Campfire **HTML Export Server** importer (`campfire_html`)
- [x] systemd unit + public deploy notes

## Deferred / won’t do

- [ ] ~~Real Campfire proprietary backup reverse-engineering (`.camp` / opaque desktop backups)~~ — **dropped**. Campfire only documents local project backup on the **desktop app** (`File → Download Project Backup`). Web/Android users don’t get that file; supported Campfire ingress is the HTML export path already implemented.

## In progress / next

- [x] UX polish (focus mode, responsive panel grid, image panel previews)
- [x] Asset upload UI for image panels (+ map backgrounds)
- [x] Interactive maps module (image + pins linked to locations)
- [x] Timeline module (dated events + detail panels)
- [x] Guided tutorial project (`POST /api/projects/tutorial`) + hover tips on shell controls
- [x] Collapsible workspace chrome + mobile/tablet drawer layout
- [x] Corkboard drag layout, inline rename, undo/redo/reset
- [x] Next module batch: Species, Cultures, Items, Arcs, Languages, Religions
- [x] Module batch: Research, Philosophies, Calendar
- [x] Slim stack Phases 0–1 (allowlist + TipTap removal) — [SLIM_STACK.md](./SLIM_STACK.md)
- [x] Slim stack Phase 2 (PanelGrid replaces react-grid-layout) — [SLIM_STACK.md](./SLIM_STACK.md)
- [x] Slim stack Phase 3 (bespoke relationship graph + corkboard drag perf) — [SLIM_STACK.md](./SLIM_STACK.md)
- [x] Slim stack Phase 4 (bespoke router, react-router removed) — [SLIM_STACK.md](./SLIM_STACK.md)
- [x] Slim stack Phase 5 (Campfire HTML without regex/once_cell) — [SLIM_STACK.md](./SLIM_STACK.md)
- [x] Slim stack Phase 6 (deny / npm audit / Renovate allowlist) — [SLIM_STACK.md](./SLIM_STACK.md)
- [ ] Optimization + bug-hunt passes before Debian cutover
- [ ] **Albion / Debian nginx cutover** — planned in [DEBIAN_CUTOVER.md](DEBIAN_CUTOVER.md); not executed yet. Keep the watch list there updated when deploy surface changes. Private host details → gitignored `docs/homelab.md` (see `homelab.md.example`).
