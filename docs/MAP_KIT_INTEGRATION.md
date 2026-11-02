# Map / society kit integration (planning)

**Kit:** [Silent Cartographer](https://origin.cursor.com/mcs/silent-cartographer) — `https://origin.cursor.com/mcs/silent-cartographer.git` (Origin namespace `mcs/silent-cartographer`).

Tavern already ships a **Maps** module: upload a background image, place pins, link pins to **Locations** elements (`web/src/components/MapCanvas.tsx`). That is lore-oriented charting, not a full cartography or society-simulation toolchain. Silent Cartographer is the separate map-making / society-building kit to integrate here.

## Access (blocker for cloud agents)

This environment **cannot clone** the Origin repo yet (`origin auth status` → not authenticated; HTTPS/SSH clone prompts fail). To unblock Phase A:

1. **Grant the Cursor cloud agent** read access to `mcs/silent-cartographer` on Origin (same account/team that owns Tavern), **or**
2. **Mirror** the repo to Forgejo / a private GitHub repo the agent can reach, **or**
3. **Vendor a tarball** into the Tavern repo or attach a one-time export for inventory (only if you are OK with that surface).

After clone, target path: `vendor/silent-cartographer/` (gitignored or submodule — TBD).

## What we still need from you

1. **Default branch** and **license** (MIT-compatible with Tavern?).
2. **Target UX**: embed inside Tavern as a new module, open in a side panel, or link out to a standalone tool?
3. **Data model**: should Cartographer output become Tavern **elements** (locations, cultures, timeline events), binary **assets**, or a new module type?
4. **Crypto**: if projects use the client vault, whether kit artifacts must be encrypted like other project JSON/assets.

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

- Feature-flag env `TAVERN_SILENT_CARTOGRAPHER=1` (or `TAVERN_MAP_KIT=1`) for staged rollout on `tav.pathsecho.quest`.
- Smoke: create chart → save → reload → export `.tavern` → second user with grant.

## Dependency / security gate (parallel track)

Before large UI integration, keep `./scripts/check-deps.sh` green on `master` (allowlist + `cargo deny` + `npm audit`). Recent work bumped **zip 9.x** (RUSTSEC-2026-0368/0369), **Vite 6.4.5+**, and pinned **Rust stable** via `rust-toolchain.toml`.

## Open questions

- Does the kit require WebGL, workers, or WASM that conflicts with Tavern CSP (`script-src 'self'`)?
- Offline-only vs needs external tile servers?
- Multiplayer / shared editing, or single-writer like the rest of Tavern?

Update this file after Phase A inventory (stack, export format, overlap with Tavern modules).

## Phase A checklist (pending clone)

- [ ] Clone `mcs/silent-cartographer`
- [ ] README / build / test commands
- [ ] Output schema (JSON, GeoJSON, tiles, custom binary?)
- [ ] Runtime deps vs `docs/dependency-allowlist.json`
- [ ] Overlap matrix: Maps, Locations, Cultures, Timeline, Systems
