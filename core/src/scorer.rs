// ── Smart search scorer (§5) ───────────────────────────────────────────────
///
/// Combines Tantivy BM25 scores with Frecency and Hierarchical Context to
/// produce a final ranking. Implements the Zoxide-inspired formula:
///
/// ```text
/// Score_Final = BM25_Score × times_opened × time_multiplier × context_multiplier
/// ```
///
/// ## Time Multiplier (§5.3.1)
/// Degraus temporais baseados no `last_access`:
///   - < 1 hora:   8x
///   - < 1 dia:    4x
///   - < 1 semana: 2x
///   - < 1 mês:    1x (neutro)
///   - > 1 mês:    0.5x (penalização leve)
///
/// ## Context Multiplier (§5.3.2)
/// Multiplicador hierárquico baseado na distância entre o diretório do
/// resultado e o diretório da última entidade selecionada:
///   - Nível 0 (mesmo dir):     16 >> 0 = 16x
///   - Nível 1 (pai/filho):     16 >> 1 = 8x
///   - Nível 2 (avô/neto):      16 >> 2 = 4x
///   - Nível 3:                 16 >> 3 = 2x
///   - Nível 4+ (sem relação):  16 >> 4 = 1x
///
/// ## Aging (§5.3.1)
/// When `SUM(times_opened) >= 10_000`, halve all values and zero those < 1.
use crate::index::{IndexManager, SearchResult};
use chrono::{DateTime, Duration, Utc};
use std::path::Path;

// ── Configuration ──────────────────────────────────────────────────────────

/// Maximum sum of `times_opened` before aging kicks in.
pub const FRECENCY_MAX_TOTAL: i64 = 10_000;

/// How many hits to fetch from Tantivy for re-scoring.
pub const RAW_HIT_LIMIT: usize = 50;

// ── Public API ─────────────────────────────────────────────────────────────

/// Re-score Tantivy hits using the full smart formula.
///
/// `raw_hits` — results from Tantivy with `bm25_score` already populated.
/// `index` — libSQL index for batch-loading frecency stats.
/// `last_selected_path` — path of the last entity the user clicked on (for
///   context multiplier). May be `None` (no multiplier applied).
///
/// Returns the top `limit` hits sorted by `final_score` (descending).
pub fn apply_smart_scoring(
    mut raw_hits: Vec<SearchResult>,
    index: &IndexManager,
    last_selected_path: Option<&str>,
    limit: usize,
) -> Result<Vec<SearchResult>, String> {
    // 1. Batch-load frecency stats from libSQL
    let paths: Vec<String> = raw_hits.iter().map(|h| h.path.clone()).collect();
    let stats_map = index.get_batch_stats(&paths)?;
    // Build a HashMap for O(1) lookups.
    let stats: std::collections::HashMap<&str, (i64, Option<String>)> = stats_map
        .iter()
        .map(|(p, times, last)| (p.as_str(), (*times, last.clone())))
        .collect();

    let now = Utc::now();

    // 2. Resolve the context directory from the last selected entity.
    let context_dir = last_selected_path
        .map(|p| parent_dir(p))
        .flatten();

    // 3. Compute final scores
    for hit in &mut raw_hits {
        let (times_opened, last_access) = stats
            .get(hit.path.as_str())
            .cloned()
            .unwrap_or((0, None));

        let time_mult = compute_time_multiplier(last_access.as_deref(), now);
        let context_mult = compute_context_multiplier(&hit.path, context_dir.as_deref());

        hit.final_score = hit.bm25_score * (times_opened.max(1) as f64) * time_mult * context_mult;
    }

    // 4. Sort by final_score descending and truncate
    raw_hits.sort_by(|a, b| {
        b.final_score
            .partial_cmp(&a.final_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    raw_hits.truncate(limit);

    Ok(raw_hits)
}

/// Check and apply aging if total frecency exceeds `FRECENCY_MAX_TOTAL`.
/// Called after `record_access`. Returns `true` if aging was performed.
pub fn maybe_age_frecency(index: &IndexManager) -> Result<bool, String> {
    let total = index.get_total_frecency()?;
    if total >= FRECENCY_MAX_TOTAL {
        index.halve_all_frecency()?;
        log::info!(
            "[scorer] Aging triggered: total frecency {total} >= {FRECENCY_MAX_TOTAL}. \
             Halved all values."
        );
        return Ok(true);
    }
    Ok(false)
}

// ── Time multiplier ────────────────────────────────────────────────────────

fn compute_time_multiplier(last_access: Option<&str>, now: DateTime<Utc>) -> f64 {
    let Some(ts) = last_access else {
        return 0.5; // never accessed → penalize lightly
    };

    let Ok(last_dt) = DateTime::parse_from_rfc3339(ts) else {
        return 1.0; // unparseable → neutral
    };

    let elapsed = now.signed_duration_since(last_dt);

    // Degraus temporais (§5.3.1)
    if elapsed < Duration::hours(1) {
        8.0
    } else if elapsed < Duration::days(1) {
        4.0
    } else if elapsed < Duration::weeks(1) {
        2.0
    } else if elapsed < Duration::days(30) {
        1.0
    } else {
        0.5
    }
}

// ── Context multiplier ─────────────────────────────────────────────────────

/// Compute the hierarchical distance between two file paths.
/// Returns the multiplier as a float (16 >> distance).
fn compute_context_multiplier(hit_path: &str, context_dir: Option<&str>) -> f64 {
    let Some(ctx_dir) = context_dir else {
        return 1.0; // no context → neutral
    };

    let distance = dir_distance(hit_path, ctx_dir);
    let shifted = 16u32 >> (distance.min(4));
    shifted as f64
}

/// Count the number of directory levels between two paths.
/// 0 = same directory, 1 = parent/child, etc.
fn dir_distance(path_a: &str, path_b: &str) -> u32 {
    let a = Path::new(path_a);
    let b = Path::new(path_b);

    // Get the parent directory of path_a (file → its dir; dir → itself).
    let dir_a = if a.is_absolute() == b.is_absolute() {
        a.parent().unwrap_or(a)
    } else {
        a
    };

    let dir_b = if b.is_absolute() == a.is_absolute() {
        // b is already a directory path
        b
    } else {
        b
    };

    // Collect ancestors for both sides.
    let ancestors_a = ancestors(dir_a);
    let ancestors_b = ancestors(dir_b);

    // Find the lowest common ancestor (LCA).
    for (depth_a, anc_a) in ancestors_a.iter().enumerate() {
        for (depth_b, anc_b) in ancestors_b.iter().enumerate() {
            if anc_a == anc_b {
                return (depth_a + depth_b) as u32;
            }
        }
    }

    // No common ancestor found beyond root — max distance.
    4
}

/// Collect all ancestor directories from `path` up to the root.
/// The first element is `path` itself.
fn ancestors(path: &Path) -> Vec<std::path::PathBuf> {
    let mut result = Vec::new();
    let mut current = path.to_path_buf();
    loop {
        result.push(current.clone());
        match current.parent() {
            Some(parent) if parent != current => current = parent.to_path_buf(),
            _ => break,
        }
    }
    result
}

/// Extract the parent directory path from a file path.
fn parent_dir(file_path: &str) -> Option<String> {
    Path::new(file_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
}

// ── Module integration ─────────────────────────────────────────────────────

/// Convenience: run full smart search pipeline — Tantivy → libSQL stats →
/// scoring. This is the primary entry point called from `IndexManager::search`.
/// NOTE: This is a placeholder; actual integration happens when we refactor
/// `IndexManager::search` to accept a Tantivy handle.
pub fn search_with_scoring(
    _query: &str,
    _entity_filter: Option<&str>,
    _limit: usize,
    _last_selected_path: Option<&str>,
    _index: &IndexManager,
) -> Result<Vec<SearchResult>, String> {
    // This will be wired in Phase 4 (migrate search path to Tantivy).
    Err("Not yet wired — see index_worker.rs for Tantivy integration".to_string())
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Time multiplier ────────────────────────────────────────────────

    #[test]
    fn time_multiplier_less_than_1_hour() {
        let now = Utc::now();
        let recent = (now - Duration::minutes(30)).to_rfc3339();
        assert_eq!(compute_time_multiplier(Some(&recent), now), 8.0);
    }

    #[test]
    fn time_multiplier_less_than_1_day() {
        let now = Utc::now();
        let ts = (now - Duration::hours(5)).to_rfc3339();
        assert_eq!(compute_time_multiplier(Some(&ts), now), 4.0);
    }

    #[test]
    fn time_multiplier_less_than_1_week() {
        let now = Utc::now();
        let ts = (now - Duration::days(3)).to_rfc3339();
        assert_eq!(compute_time_multiplier(Some(&ts), now), 2.0);
    }

    #[test]
    fn time_multiplier_less_than_1_month() {
        let now = Utc::now();
        let ts = (now - Duration::days(15)).to_rfc3339();
        assert_eq!(compute_time_multiplier(Some(&ts), now), 1.0);
    }

    #[test]
    fn time_multiplier_more_than_1_month() {
        let now = Utc::now();
        let ts = (now - Duration::days(60)).to_rfc3339();
        assert_eq!(compute_time_multiplier(Some(&ts), now), 0.5);
    }

    #[test]
    fn time_multiplier_none_returns_penalty() {
        assert_eq!(compute_time_multiplier(None, Utc::now()), 0.5);
    }

    // ── Context multiplier ─────────────────────────────────────────────

    #[test]
    fn context_same_directory_gives_16x() {
        let ctx = Some("/vault/projects/rust/");
        let m = compute_context_multiplier("/vault/projects/rust/notes.md", ctx);
        assert_eq!(m, 16.0);
    }

    #[test]
    fn context_parent_child_gives_8x() {
        let ctx = Some("/vault/projects/");
        let m = compute_context_multiplier("/vault/projects/rust/notes.md", ctx);
        // projects/rust/notes.md → parent is projects/rust
        // LCA is projects/ → depth_a=1 (rust), depth_b=0 → total=1 → 16>>1 = 8
        assert_eq!(m, 8.0);
    }

    #[test]
    fn context_different_branches_gives_lower() {
        let ctx = Some("/vault/projects/rust/");
        // /vault/projects/python/app.md → ancestors: .../python, .../projects, ...
        // LCA is projects/ → depth_a=1 (python), depth_b=0 → total=1 → 8x
        let m = compute_context_multiplier("/vault/projects/python/app.md", ctx);
        assert_eq!(m, 8.0);
    }

    #[test]
    fn context_none_gives_neutral() {
        let m = compute_context_multiplier("/any/path.md", None);
        assert_eq!(m, 1.0);
    }

    #[test]
    fn context_unrelated_gives_1x() {
        let ctx = Some("/vault/notes/");
        let m = compute_context_multiplier("/other/root/file.md", ctx);
        assert_eq!(m, 1.0);
    }

    // ── dir_distance ───────────────────────────────────────────────────

    #[test]
    fn dir_distance_same_dir_is_zero() {
        assert_eq!(dir_distance("/a/b/c.md", "/a/b/d.md"), 0);
    }

    #[test]
    fn dir_distance_parent_child_is_one() {
        assert_eq!(dir_distance("/a/b/c.md", "/a/d.md"), 1);
    }
}
