# Slim stack — dependency allowlist & migration

Reference for keeping Tavern’s dependency surface small and intentional.
Goal: **hard dependency diet**, not a from-scratch rewrite of HTTP/crypto/SQLite.

Related: [PHASED_PLAN.md](./PHASED_PLAN.md).

## Principles

- Keep **crypto, DB, and HTTP runtime** as audited upstream crates — do not roll those yourself.
- Cut **UI libraries that pull large trees** (TipTap, XYFlow, react-grid-layout).
- Enforce with an **in-repo allowlist** + CI checks; new deps need a written exception.
- Migrate **feature by feature** so the app stays shippable after each phase.

## Allowlist (target)

### Rust — approved direct deps

| Crate | Why |
|---|---|
| `tokio` | async runtime |
| `axum` + `axum-extra` (cookie) | HTTP + sessions |
| `tower-http` (`trace` only) | request logging |
| `sqlx` (sqlite) | database |
| `serde` / `serde_json` | API / models |
| `uuid` | IDs |
| `chrono` | timestamps |
| `argon2` | password hashing |
| `sha2` / `rand` / `hex` | sessions / tokens |
| `rust-embed` | ship built UI |
| `tracing` / `tracing-subscriber` | logs |
| `anyhow` | error context |
| `zip` | backup import/export |
| `dotenvy` | config |
| `mime_guess` | asset content-types |

**Try to delete later:** unused direct crates if any creep back; defer `sqlx` → `rusqlite` unless size forces it.

**Hard deny:** extra web frameworks, alternate ORMs, drive-by utility crates, anything not on this list without an allowlist update.

Workspace path crates (`tavern-core`, `tavern-db`, `tavern-import`, `tavern-export`, `tavern-server`) are always allowed.

### Web — approved runtime deps

| Package | Why |
|---|---|
| `react` / `react-dom` | UI |

**Dev-only allow:** `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`.

**Hard deny:** `@tiptap/*`, `react-grid-layout`, `@xyflow/react`, `react-router-dom`, `turndown`, and any new runtime package not listed above.

### Policy artifacts

| File | Role |
|---|---|
| [`dependency-allowlist.json`](./dependency-allowlist.json) | Machine-readable allow / phase-gated lists |
| [`../deny.toml`](../deny.toml) | `cargo-deny` advisories / bans / licenses |
| [`../scripts/check-dependency-allowlist.sh`](../scripts/check-dependency-allowlist.sh) | Fails if `package.json` / Cargo direct deps drift |
| [`../scripts/check-deps.sh`](../scripts/check-deps.sh) | Full Phase 6 gate (allowlist + deny + npm audit) |
| [`../renovate.json`](../renovate.json) | Renovate limited to allowlisted packages |
| [`../.github/workflows/deps.yml`](../.github/workflows/deps.yml) | PR + weekly dependency gate |

PR rule: adding a dependency updates `dependency-allowlist.json` with a one-line justification.

## Migration phases

### Phase 0 — Freeze & baseline

1. Land this doc + allowlist + check script + `deny.toml`.
2. Delete already-unused web packages.
3. Trim unused Rust direct deps / `tower-http` features.
4. Record baseline counts (see below).

**Exit:** checks enforce “no surprise deps”; unused packages gone.

### Phase 1 — Manuscript editor (TipTap out)

Replace TipTap with a small contentEditable / source textarea using existing markdown helpers and wiki rewrite.

**Touch:** `web/src/components/ManuscriptEditor.tsx`
**Remove:** all `@tiptap/*`
**Exit:** write / save / source mode / quick links / wikilinks work; TipTap absent from lockfile.

### Phase 2 — Panel canvas layout

Replace `react-grid-layout` with CSS/absolute grid + pointer drag/resize (`PanelGrid`).

**Touch:** `PanelCanvas.tsx`, `PanelGrid.tsx`
**Exit:** layout persist; grid-layout gone.

### Phase 3 — Relationship graph

Replace `@xyflow/react` with SVG/div pan-zoom graph (`RelationshipGraph`).

**Touch:** `RelationshipGraph.tsx`
**Exit:** create/select/undo links; XYFlow gone.

Also: corkboard drag lag is unrelated to XYFlow — fixed by avoiding per-`dragover` React state churn and only persisting dirty cards.

### Phase 4 — Router

Replace `react-router-dom` with a tiny history API helper (`web/src/lib/router.tsx`).

**Touch:** `App.tsx`, `main.tsx`, `ProjectsPage`, `ProjectWorkspace`
**Exit:** login / projects / `/project/:id` navigation works; react-router gone.

### Phase 5 — Rust import diet

Replace `regex` / `once_cell` in Campfire parsing with hand-rolled `html_scan` helpers; drop unused workspace `thiserror`. Defer `sqlx` → `rusqlite` unless there is a strong size reason.

**Touch:** `crates/tavern-import` (`campfire_html.rs`, `html_scan.rs`), allowlist, workspace `Cargo.toml`
**Exit:** Campfire sample fixture still parses; no direct `regex` / `once_cell` deps.

### Phase 6 — Hardening

Land a repeatable dependency gate and keep the allowlist small:

1. `./scripts/check-deps.sh` — allowlist drift + `cargo deny check` + `npm audit` (moderate+)
2. `.github/workflows/deps.yml` — runs the gate on PRs/pushes and weekly
3. `renovate.json` — only opens update PRs for packages on `dependency-allowlist.json`
4. Optional vendoring notes for airgapped / Debian cutover builds (see below)

**Vendoring (optional, not in-tree by default):** when a build host cannot reach crates.io/npm:

```bash
# Rust — write vendor/ + .cargo/config.toml (do not commit unless cutover needs it)
mkdir -p .cargo
cargo vendor > .cargo/config.toml

# Web — prefer committing web/package-lock.json and using npm ci offline after a warm cache
cd web && npm ci --prefer-offline
```

For Debian cutover, prefer a trusted build host that runs `check-deps.sh` then ships `target/release/tavern` + recorded commit SHA (see [DEBIAN_CUTOVER.md](./DEBIAN_CUTOVER.md)).

**Cadence:** run `./scripts/check-deps.sh` before release builds; CI weekly cron catches advisory drift.

**Exit:** deny.toml valid on current cargo-deny; CI workflow present; Renovate scoped to allowlist; docs describe cadence/vendoring.

## Order

```text
0 freeze/allowlist → 1 TipTap out → 2 grid-layout out → 3 XYFlow out
                 → 4 router → 5 Rust trim → 6 deny/audit cadence
```

## Baseline counts

Captured after Phases 0–5 (re-run `./scripts/check-deps.sh` for live numbers):

| Layer | Before | After Phase 5 |
|---|---|---|
| Web runtime direct | 11 | **2** (`react`, `react-dom`) |
| Web lockfile packages | ~223 | **~71 audited** |
| Rust direct external | ~26 | **~20** |
| Rust transitive | ~250 | lower (no direct regex/once_cell) |

## Status

| Phase | Status |
|---|---|
| 0 Freeze & baseline | done |
| 1 TipTap → bespoke editor | done |
| 2 grid-layout → PanelGrid | done |
| 3 XYFlow → bespoke graph | done |
| 4 react-router → bespoke router | done |
| 5 Rust import diet (no regex/once_cell) | done |
| 6 Hardening (deny / audit / Renovate) | done |
