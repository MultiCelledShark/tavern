#!/usr/bin/env bash
# Fail if Cargo / npm direct dependencies drift from docs/dependency-allowlist.json.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ALLOW="$ROOT/docs/dependency-allowlist.json"
PKG="$ROOT/web/package.json"
WS="$ROOT/Cargo.toml"

if ! command -v python3 >/dev/null; then
  echo "python3 required" >&2
  exit 1
fi

python3 - "$ALLOW" "$PKG" "$ROOT" <<'PY'
import json, sys, pathlib, re, tomllib

allow_path, pkg_path, root = map(pathlib.Path, sys.argv[1:4])
allow = json.loads(allow_path.read_text())
pkg = json.loads(pkg_path.read_text())
errors = []

# --- npm ---
npm = allow["npm"]
for section, key in (("dependencies", "allowed_dependencies"), ("devDependencies", "allowed_devDependencies")):
    allowed = set(npm[key])
    banned = set(npm.get("banned", []))
    actual = set((pkg.get(section) or {}).keys())
    unexpected = actual - allowed
    missing_ban = actual & banned
    if unexpected:
        errors.append(f"npm {section} not allowlisted: {sorted(unexpected)}")
    if missing_ban:
        errors.append(f"npm {section} contains banned packages: {sorted(missing_ban)}")

# --- rust workspace + crate Cargo.toml direct deps ---
rust_allowed = set(allow["rust"]["allowed_direct"]) | set(allow["rust"]["allowed_workspace_path"])
ws = tomllib.loads((root / "Cargo.toml").read_text())
declared = set(ws.get("workspace", {}).get("dependencies", {}).keys())
# Also scan each crate for non-workspace pins
for cargo in (root / "crates").glob("*/Cargo.toml"):
    data = tomllib.loads(cargo.read_text())
    for section in ("dependencies", "dev-dependencies", "build-dependencies"):
        for name, spec in (data.get(section) or {}).items():
            declared.add(name)

external = {n for n in declared if n not in allow["rust"]["allowed_workspace_path"]}
# workspace may still list crates we removed from allowlist (cookie, tower, tempfile)
unexpected_rust = external - rust_allowed
if unexpected_rust:
    errors.append(f"rust direct deps not allowlisted: {sorted(unexpected_rust)}")

# Baseline counts (informational)
print("dependency allowlist check")
print(f"  npm runtime: {sorted((pkg.get('dependencies') or {}).keys())}")
print(f"  npm dev:     {sorted((pkg.get('devDependencies') or {}).keys())}")
print(f"  rust external declared: {len(external)}")

if errors:
    print("FAILED:", file=sys.stderr)
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    sys.exit(1)
print("OK")
PY

if command -v cargo >/dev/null && cargo deny --version >/dev/null 2>&1; then
  echo "running cargo deny check..."
  (cd "$ROOT" && cargo deny check)
else
  echo "cargo-deny not installed; skipped (optional). Install: cargo install cargo-deny --locked"
fi
