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

**Try to delete later:** `regex`, `once_cell` (Campfire HTML), unused direct crates (`cookie`, `tower`, `tempfile` if unused).

**Hard deny:** extra web frameworks, alternate ORMs, drive-by utility crates, anything not on this list without an allowlist update.

Workspace path crates (`tavern-core`, `tavern-db`, `tavern-import`, `tavern-export`, `tavern-server`) are always allowed.

### Web — approved runtime deps

| Package | Why |
|---|---|
| `react` / `react-dom` | UI |
| `react-router-dom` | routing (optional Phase 4 removal) |

**Still allowed until later phases (scheduled removal):**

| Package | Remove in |
|---|---|
| `react-grid-layout` | Phase 2 (panel canvas) |
| `@xyflow/react` | Phase 3 (relationship graph) |

**Dev-only allow:** `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`, plus `@types/*` only while a runtime package that needs them remains.

**Hard deny:** `@tiptap/*`, `turndown`, and any new runtime package not listed above.

### Policy artifacts

| File | Role |
|---|---|
| [`dependency-allowlist.json`](./dependency-allowlist.json) | Machine-readable allow / phase-gated lists |
| [`../deny.toml`](../deny.toml) | `cargo-deny` advisories / bans / licenses |
| [`../scripts/check-dependency-allowlist.sh`](../scripts/check-dependency-allowlist.sh) | Fails if `package.json` / Cargo direct deps drift |

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

Replace `react-grid-layout` with CSS grid + pointer drag/resize.

**Touch:** `PanelCanvas.tsx`  
**Exit:** layout persist; grid-layout gone.

### Phase 3 — Relationship graph

Replace `@xyflow/react` with SVG/div pan-zoom graph.

**Touch:** `RelationshipGraph.tsx`  
**Exit:** create/select/undo links; XYFlow gone.

### Phase 4 — Router (optional)

Keep `react-router-dom` or replace with ~50 lines of path state in `App.tsx`.

### Phase 5 — Rust import diet

Replace `regex` / `once_cell` in Campfire parsing; drop confirmed-unused server crates. Defer `sqlx` → `rusqlite` unless there is a strong size reason.

### Phase 6 — Hardening (ongoing)

Vendoring/mirroring if needed; Renovate only for allowlisted packages; periodic `cargo deny` + audit on the small surface.

## Order

```text
0 freeze/allowlist → 1 TipTap out → 2 grid-layout out → 3 XYFlow out
                 → 4 router? → 5 Rust trim → 6 deny/audit cadence
```

## Baseline counts

Captured during Phase 0→1 on `auto/slim-stack-phase0-1-ecbe` (re-run `scripts/check-dependency-allowlist.sh` for live numbers):

| Layer | Before Phase 0 | After Phase 1 | Target after Phase 3 |
|---|---|---|---|
| Web runtime direct | 11 | **5** | 2–3 |
| Web lockfile packages | ~223 | **~154** | ~30–60 |
| Rust direct external | ~26 | **~23** | ~15–18 |
| Rust transitive | ~250 | ~250 | ~150–200 (tokio/sqlx dominate) |

Meaningful supply-chain shrink is mostly on the **npm** side. Rust stays chunky because tokio/sqlx are deep — that is the accepted trade.

## Status

| Phase | Status |
|---|---|
| 0 Freeze & baseline | done |
| 1 TipTap → bespoke editor | done |
| 2–6 | not started |
