# Map / society kit integration (planning)

Tavern already ships a **Maps** module: upload a background image, place pins, link pins to **Locations** elements (`web/src/components/MapCanvas.tsx`). That is lore-oriented charting, not a full cartography or society-simulation toolchain.

This doc tracks integrating a separate **map-making / society-building kit** once its source repo is linked into this workspace.

## What we need from you

1. **Repository URL** (Forgejo SSH, GitHub, or tarball) and default branch for the kit.
2. **Target UX**: embed inside Tavern as a new module, open in a side panel, or link out to a standalone tool?
3. **Data model**: should output become Tavern **elements** (locations, cultures, timeline events), binary **assets**, or a new module type?
4. **Crypto**: if projects use the client vault, whether kit artifacts must be encrypted like other project JSON/assets.

The kit is not in the public `MultiCelledShark` GitHub org from this agent’s search; homelab/Forgejo is the likely home.

## Suggested integration phases

### Phase A — Discovery (1–2 sessions)

- Clone the kit repo beside Tavern (or as a git submodule under `vendor/` — only if license allows).
- Inventory: stack (Rust/TS/WebGL/Tiled?), build commands, license, bundle size.
- Compare overlap with Tavern **Maps**, **Locations**, **Cultures**, **Systems**, **Timeline**.

### Phase B — Boundary

Pick one:

| Approach | Pros | Cons |
|----------|------|------|
| **Iframe / route** | Fast; kit stays independent | Auth, vault, and theming harder |
| **Library import** | Shared React shell | Must align with Tavern allowlist (`docs/SLIM_STACK.md`) |
| **Server-side bridge** | Can normalize to `IntermediateProject` | More Rust; kit must export JSON |

Default recommendation: **library or JSON bridge** so imports land in existing modules and `.tavern` backups stay coherent.

### Phase C — Tavern changes (sketch)

- New `ModuleType` (e.g. `cartography` / `society`) **or** extend `maps` metadata schema — decide after seeing kit output.
- API: reuse `POST /api/projects/{id}/assets` for tiles/images; extend element `metadata` for kit-specific blobs (keep under vault encryption rules).
- UI: module entry in `web/src/lib/moduleOrder.ts`, workspace branch in `ProjectWorkspace.tsx`.
- Import path: optional hook in `web/src/import/` or `tavern-import` if kit exports ZIP/JSON.

### Phase D — Production

- Feature-flag env `TAVERN_MAP_KIT=1` for staged rollout on `tav.pathsecho.quest`.
- Smoke: create chart → save → reload → export `.tavern` → second user with grant.

## Dependency / security gate (parallel track)

Before large UI integration, keep `./scripts/check-deps.sh` green on `master` (allowlist + `cargo deny` + `npm audit`). Recent work bumped **zip 9.x** (RUSTSEC-2026-0368/0369), **Vite 6.4.5+**, and pinned **Rust stable** via `rust-toolchain.toml`.

## Open questions

- Does the kit require WebGL, workers, or WASM that conflicts with Tavern CSP (`script-src 'self'`)?
- Offline-only vs needs external tile servers?
- Multiplayer / shared editing, or single-writer like the rest of Tavern?

Update this file when the kit repo is identified and Phase A inventory is done.
