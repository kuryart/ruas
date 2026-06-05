/// Utilities for deriving safe, human-readable file names from entity titles.
///
/// Rules applied (compatible with Windows, macOS, and Linux):
/// - Forbidden chars (`/ \ : * ? " < > |` and control chars) → `_`
/// - Leading/trailing whitespace and dots stripped (Windows rejects them;
///   leading dots would create hidden files on Unix)
/// - Empty result after stripping → `"Untitled"`
/// - Maximum stem length: 200 chars (leaves room for ` (N)` suffix and `.md`)
///
/// These functions are pure and allocation-only — no I/O.
use std::path::Path;

const MAX_STEM_LEN: usize = 200;
const FORBIDDEN: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// Convert an arbitrary title string into a valid file-system stem (no extension).
///
/// ```
/// # use ruas_core::sanitize_filename;
/// assert_eq!(sanitize_filename("My Note"), "My Note");
/// assert_eq!(sanitize_filename("  "), "Untitled");
/// assert_eq!(sanitize_filename("A/B\\C:D"), "A_B_C_D");
/// assert_eq!(sanitize_filename("..."), "Untitled");
/// ```
pub fn sanitize_filename(title: &str) -> String {
    let sanitized: String = title
        .chars()
        .map(|c| if FORBIDDEN.contains(&c) || c.is_control() { '_' } else { c })
        .collect();

    // Trim leading/trailing whitespace and dots
    let trimmed = sanitized.trim_matches(|c: char| c == '.' || c == ' ');

    if trimmed.is_empty() {
        return "Untitled".to_string();
    }

    // Enforce maximum length (in chars, not bytes, to avoid splitting Unicode)
    if trimmed.chars().count() > MAX_STEM_LEN {
        trimmed.chars().take(MAX_STEM_LEN).collect::<String>().trim_end().to_string()
    } else {
        trimmed.to_string()
    }
}

/// Return a unique `"{stem}.md"` filename inside `dir`, appending ` (1)`,
/// ` (2)`, … until a non-existing name is found.
///
/// The check is case-insensitive on case-insensitive file systems only if the
/// OS reports the conflict via `Path::exists()`. On case-sensitive systems the
/// check is exact — matching the platform's actual behavior.
pub fn unique_filename(dir: &Path, stem: &str) -> String {
    let candidate = format!("{stem}.md");
    if !dir.join(&candidate).exists() {
        return candidate;
    }
    let mut n: u32 = 1;
    loop {
        let candidate = format!("{stem} ({n}).md");
        if !dir.join(&candidate).exists() {
            return candidate;
        }
        n += 1;
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // ── sanitize_filename ──────────────────────────────────────────────

    #[test]
    fn sanitize_normal_title() {
        assert_eq!(sanitize_filename("Minha Nota"), "Minha Nota");
    }

    #[test]
    fn sanitize_strips_leading_trailing_spaces() {
        assert_eq!(sanitize_filename("  Nota  "), "Nota");
    }

    #[test]
    fn sanitize_strips_leading_trailing_dots() {
        assert_eq!(sanitize_filename(".hidden"), "hidden");
        assert_eq!(sanitize_filename("trailing."), "trailing");
        assert_eq!(sanitize_filename("..double.."), "double");
    }

    #[test]
    fn sanitize_empty_title_returns_untitled() {
        assert_eq!(sanitize_filename(""), "Untitled");
        assert_eq!(sanitize_filename("   "), "Untitled");
        assert_eq!(sanitize_filename("..."), "Untitled");
    }

    #[test]
    fn sanitize_forbidden_chars_replaced_with_underscore() {
        assert_eq!(sanitize_filename("A/B\\C"), "A_B_C");
        assert_eq!(sanitize_filename("file:name"), "file_name");
        assert_eq!(sanitize_filename("A*B?C\"D<E>F|G"), "A_B_C_D_E_F_G");
    }

    #[test]
    fn sanitize_control_chars_replaced() {
        assert_eq!(sanitize_filename("a\tb"), "a_b");
        assert_eq!(sanitize_filename("a\nb"), "a_b");
    }

    #[test]
    fn sanitize_unicode_preserved() {
        assert_eq!(sanitize_filename("João Silva"), "João Silva");
        assert_eq!(sanitize_filename("Рус текст"), "Рус текст");
        assert_eq!(sanitize_filename("中文标题"), "中文标题");
    }

    #[test]
    fn sanitize_truncates_very_long_title() {
        let long = "a".repeat(300);
        let result = sanitize_filename(&long);
        assert!(result.chars().count() <= 200);
        assert!(!result.is_empty());
    }

    // ── unique_filename ────────────────────────────────────────────────

    #[test]
    fn unique_returns_plain_name_when_no_conflict() {
        let dir = TempDir::new().unwrap();
        assert_eq!(unique_filename(dir.path(), "Nota"), "Nota.md");
    }

    #[test]
    fn unique_appends_counter_on_conflict() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("Nota.md"), "").unwrap();
        assert_eq!(unique_filename(dir.path(), "Nota"), "Nota (1).md");
    }

    #[test]
    fn unique_increments_counter_until_free() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("Nota.md"), "").unwrap();
        fs::write(dir.path().join("Nota (1).md"), "").unwrap();
        fs::write(dir.path().join("Nota (2).md"), "").unwrap();
        assert_eq!(unique_filename(dir.path(), "Nota"), "Nota (3).md");
    }

    #[test]
    fn unique_untitled_deduplicates() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("Untitled.md"), "").unwrap();
        assert_eq!(unique_filename(dir.path(), "Untitled"), "Untitled (1).md");
    }
}
