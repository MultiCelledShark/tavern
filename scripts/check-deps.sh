#!/usr/bin/env bash
# Phase 6 dependency hardening gate.
# Runs allowlist drift check, cargo-deny, and npm audit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH:-}"

echo "== allowlist =="
"$ROOT/scripts/check-dependency-allowlist.sh"

echo "== cargo deny =="
if command -v cargo >/dev/null && cargo deny --version >/dev/null 2>&1; then
  (cd "$ROOT" && cargo deny check)
elif [[ "${REQUIRE_CARGO_DENY:-}" == "1" || "${CI:-}" == "true" ]]; then
  echo "cargo-deny required but not installed. Install: cargo install cargo-deny --locked" >&2
  exit 1
else
  echo "cargo-deny not installed; skipped (set REQUIRE_CARGO_DENY=1 to require)"
fi

echo "== npm audit =="
if command -v npm >/dev/null; then
  # Fail on moderate+; info/low stay informational for the tiny surface.
  (cd "$ROOT/web" && npm audit --audit-level=moderate)
else
  echo "npm not found; skipped"
fi

echo "deps check OK"
