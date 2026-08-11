# Tavern phased plan

## Done in scaffold

- [x] Cargo workspace (`tavern-core`, `tavern-db`, `tavern-import`, `tavern-export`, `tavern-server`)
- [x] Auth + project ACL
- [x] Panel engine + React shell
- [x] Manuscript TipTap editor
- [x] v1 modules
- [x] Export + `.tavern` backup
- [x] Import scaffold (intermediate JSON / zip / opaque stubs)
- [x] Campfire **HTML Export Server** importer (`campfire_html`)
- [x] systemd unit + public deploy notes

## Deferred / won’t do

- [ ] ~~Real Campfire proprietary backup reverse-engineering (`.camp` / opaque desktop backups)~~ — **dropped**. Campfire only documents local project backup on the **desktop app** (`File → Download Project Backup`). Web/Android users don’t get that file; supported Campfire ingress is the HTML export path already implemented.

## Next

- [ ] Interactive maps / timeline modules
- [ ] Asset upload UI for image panels
- [ ] Albion nginx cutover
