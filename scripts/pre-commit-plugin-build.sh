#!/usr/bin/env bash
# ── pre-commit: build plugins if source changed ─────────────────────────────
#
# Place this file at .git/hooks/pre-commit (or symlink it) to automatically
# rebuild WASM plugins when their Rust source changes.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
STAGED="$(git diff --cached --name-only)"

# Check if any plugin source files are staged.
PLUGIN_SRC_CHANGED=false
for f in $STAGED; do
    if [[ "$f" =~ ^plugins/[^/]+/src/ ]]; then
        PLUGIN_SRC_CHANGED=true
        break
    fi
done

if [ "$PLUGIN_SRC_CHANGED" = false ]; then
    exit 0
fi

echo ""
echo "┌─────────────────────────────────────────────────┐"
echo "│  Plugin source changed — rebuilding .wasm ...   │"
echo "└─────────────────────────────────────────────────┘"
echo ""

# Determine which plugins changed.
declare -A CHANGED_PLUGINS
for f in $STAGED; do
    if [[ "$f" =~ ^plugins/([^/]+)/ ]]; then
        CHANGED_PLUGINS["${BASH_REMATCH[1]}"]=1
    fi
done

for plugin in "${!CHANGED_PLUGINS[@]}"; do
    echo "Rebuilding $plugin..."
    (cd "$ROOT/plugins/$plugin" && cargo build --target wasm32-unknown-unknown --release) || {
        echo ""
        echo "ERROR: Failed to build plugin '$plugin'."
        echo "Run 'rustup target add wasm32-unknown-unknown' if you haven't already."
        exit 1
    }

    local wasm_name
    wasm_name="$(echo "$plugin" | tr '-' '_')"
    cp "$ROOT/plugins/$plugin/target/wasm32-unknown-unknown/release/${wasm_name}.wasm" \
       "$ROOT/plugins/$plugin/plugin.wasm"

    # Stage the rebuilt .wasm
    git add "$ROOT/plugins/$plugin/plugin.wasm"
    echo "  ✓ Staged $plugin/plugin.wasm"
done

echo ""
echo "✓ All plugins rebuilt. Continuing with commit..."
echo ""
