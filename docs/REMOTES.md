# Dual remotes

## Remotes

```bash
git remote add origin git@github.com:MultiCelledShark/tavern.git
# Homelab via SSH Host alias (see your ~/.ssh/config), e.g.:
git remote add forgejo forgejo:key/tavern.git
```

## Push order

1. `git push forgejo HEAD:master` — homelab OK
2. Sanitize checklist, then `git push origin HEAD:master`

## GitHub sanitization checklist

- [ ] No `.env`, `data/`, `*.db`, Campfire backups, `.tavern` story dumps
- [ ] No LAN IPs (`192.168.*`) in tracked files
- [ ] No real admin passwords
- [ ] Samples are synthetic only (`samples/sample_project.json`)
- [ ] Deploy docs use `example.com` placeholders (public README)

Homelab-specific notes belong in Forgejo wiki or gitignored `docs/homelab.md`.
