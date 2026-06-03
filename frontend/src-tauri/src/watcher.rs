use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use ruas_core::{ModuleEvent, ModuleRegistry};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Start a recursive file watcher on `vault_path`.
///
/// Translates `notify` events for `.md` files into `ModuleEvent`s and
/// dispatches them to all registered modules via the registry.
/// Returns the live watcher — drop it to stop watching.
pub fn start(
    vault_path: PathBuf,
    registry: Arc<Mutex<ModuleRegistry>>,
    app: tauri::AppHandle,
) -> Result<RecommendedWatcher, String> {
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();

    let mut watcher =
        notify::recommended_watcher(tx).map_err(|e| format!("watcher: {e}"))?;

    watcher
        .watch(&vault_path, RecursiveMode::Recursive)
        .map_err(|e| format!("watcher: watch failed: {e}"))?;

    let ignore_dir = vault_path.join(".ruas");
    let themes_dir = ignore_dir.join("themes");
    let snippets_dir = ignore_dir.join("snippets");

    std::thread::spawn(move || {
        use tauri::Emitter;
        for res in rx {
            let Event { kind, paths, .. } = match res {
                Ok(e) => e,
                Err(e) => {
                    log::warn!("watcher error: {e}");
                    continue;
                }
            };

            // User theme/snippet .css changed → tell the webview to re-inject.
            let appearance_changed = paths.iter().any(|p| {
                p.extension().and_then(|e| e.to_str()) == Some("css")
                    && (p.starts_with(&themes_dir) || p.starts_with(&snippets_dir))
            });
            if appearance_changed {
                let _ = app.emit("appearance-changed", ());
            }

            let md_paths: Vec<PathBuf> = paths
                .into_iter()
                .filter(|p| {
                    p.extension().and_then(|e| e.to_str()) == Some("md")
                        && !p.starts_with(&ignore_dir)
                })
                .collect();

            if md_paths.is_empty() {
                continue;
            }

            let reg = registry.lock().unwrap();
            for path in md_paths {
                let path_str = path.to_string_lossy().to_string();
                let evt = match &kind {
                    EventKind::Create(_) => ModuleEvent::FileCreated { path: path_str },
                    EventKind::Modify(_) => ModuleEvent::FileModified { path: path_str },
                    EventKind::Remove(_) => ModuleEvent::FileDeleted { path: path_str },
                    _ => continue,
                };
                reg.emit(&evt, &vault_path);
            }
        }
        log::info!("file watcher stopped for {}", vault_path.display());
    });

    Ok(watcher)
}
