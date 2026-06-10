#!/usr/bin/env bash
# ── build-plugins.sh ─────────────────────────────────────────────────────────
#
# Builds all native WASM plugins from `plugins/*/` and copies the output
# `.wasm` files to their respective plugin directories (as `plugin.wasm`).
#
# Prerequisites:
#   rustup target add wasm32-unknown-unknown
#
# Usage:
#   ./scripts/build-plugins.sh          # build all plugins
#   ./scripts/build-plugins.sh vcf-importer  # build a specific plugin
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGINS_DIR="$(cd "$SCRIPT_DIR/../plugins" && pwd)"

build_one() {
    local plugin_dir="${1%/}"  # strip trailing slash
    local name
    name="$(basename "$plugin_dir")"

    echo "  Building $name..."

    # The crate name uses underscores instead of hyphens.
    local wasm_name
    wasm_name="$(echo "$name" | tr '-' '_')"

    (
        cd "$plugin_dir"

        cargo build --target wasm32-unknown-unknown --release

        # Plugin is excluded from workspace → target is local to the plugin dir.
        local src="$plugin_dir/target/wasm32-unknown-unknown/release/${wasm_name}.wasm"
        local dest="$plugin_dir/plugin.wasm"

        if [ ! -f "$src" ]; then
            echo "Error: .wasm not found at $src"
            exit 1
        fi

        cp "$src" "$dest"
        echo "    ✓ $dest"

        # Also copy to resources so `cargo run --bin Ruas` sees it
        local resources_dir
        resources_dir="$PLUGINS_DIR/../frontend/src-tauri/resources/plugins/$name"
        mkdir -p "$resources_dir"
        cp "$src" "$resources_dir/plugin.wasm"
        cp "$plugin_dir/manifest.json" "$resources_dir/manifest.json"
        echo "    ✓ $resources_dir/"
    )
}

echo "Building plugins..."
echo ""

if [ $# -gt 0 ]; then
    for plugin in "$@"; do
        if [ -d "$PLUGINS_DIR/$plugin" ]; then
            build_one "$PLUGINS_DIR/$plugin"
        else
            echo "Plugin '$plugin' not found in plugins/"
            exit 1
        fi
    done
else
    for dir in "$PLUGINS_DIR"/*/; do
        dir="${dir%/}"  # strip trailing slash
        if [ -f "${dir}/manifest.json" ] && [ -f "${dir}/Cargo.toml" ]; then
            build_one "$dir"
        fi
    done
fi

echo ""
echo "Done. Run 'git diff --stat plugins/' to see changes."
