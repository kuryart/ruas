use std::fs;
use std::path::Path;

fn main() {
    // Copy native plugin .wasm files into the Tauri resources directory
    // so they are embedded in the binary and available at runtime.
    let plugins_dir = Path::new("../../plugins");
    if plugins_dir.is_dir() {
        let resources_plugins = Path::new("resources/plugins");
        let _ = fs::create_dir_all(resources_plugins);

        if let Ok(entries) = fs::read_dir(plugins_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let manifest_path = path.join("manifest.json");
                let wasm_path = path.join("plugin.wasm");
                if !manifest_path.exists() || !wasm_path.exists() {
                    continue;
                }
                let name = path.file_name().unwrap().to_str().unwrap();
                let dest_dir = resources_plugins.join(name);
                let _ = fs::create_dir_all(&dest_dir);

                // Copy manifest.json
                if let Err(e) = fs::copy(&manifest_path, dest_dir.join("manifest.json")) {
                    eprintln!("build.rs: failed to copy manifest for '{}': {}", name, e);
                }
                // Copy plugin.wasm
                if let Err(e) = fs::copy(&wasm_path, dest_dir.join("plugin.wasm")) {
                    eprintln!("build.rs: failed to copy wasm for '{}': {}", name, e);
                }
                println!("cargo:rerun-if-changed=../../plugins/{}/plugin.wasm", name);
                println!("cargo:rerun-if-changed=../../plugins/{}/manifest.json", name);
            }
        }
    }

    tauri_build::build()
}
