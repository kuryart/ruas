// ── VCF Importer — Extism WASM plugin ───────────────────────────────────────
//
// Converts .vcf (vCard) contact files into Ruas-compatible Markdown contacts.
// Called by the Ruas host via the `dispatch("import", {vcf_dir, contacts_dir})`
// command. The host provides `host_read_dir`, `host_read_file`, `host_write_file`,
// `host_create_dir`, and `host_generate_uuid` functions.

use extism_pdk::*;
use serde::{Deserialize, Serialize};
use std::{cell::RefCell, collections::HashMap};

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct PluginInfo {
    id: String,
    name: String,
    version: String,
    description: String,
}

#[derive(Deserialize)]
struct DispatchInput {
    command: String,
    args: serde_json::Value,
    vault_path: String,
}

#[derive(Serialize)]
struct DispatchOutput {
    ok: Option<serde_json::Value>,
    err: Option<String>,
}

#[derive(Deserialize)]
struct ImportArgs {
    vcf_dir: String,
    contacts_dir: String,
}

// ── Host function imports (PDK 1.x) ───────────────────────────────────────
//
// The #[host_fn] macro generates unsafe wrappers. We call them directly
// via unsafe { } blocks — the unsafe is confined to the do_import function.

#[host_fn]
extern "ExtismHost" {
    fn host_read_dir(path: String) -> String;
    fn host_read_file(path: String) -> Vec<u8>;
    fn host_create_dir(path: String) -> ();
    fn host_generate_uuid() -> String;
    /// Receives JSON: {"path": "...", "content": "..."}
    fn host_write_file(json: String) -> ();
    /// Return current UTC timestamp as RFC 3339 string.
    fn host_system_time() -> String;
}

// ── PDK exports ────────────────────────────────────────────────────────────

#[plugin_fn]
pub fn info() -> FnResult<Json<PluginInfo>> {
    Ok(Json(PluginInfo {
        id: "com.ruas.vcf-importer".into(),
        name: "VCF Importer".into(),
        version: "0.1.0".into(),
        description: "Converts .vcf contact files to Ruas Markdown contacts.".into(),
    }))
}

#[plugin_fn]
pub fn capabilities() -> FnResult<Json<Vec<String>>> {
    Ok(Json(vec!["VaultWrite".into()]))
}

#[plugin_fn]
pub fn dispatch(input: String) -> FnResult<Json<DispatchOutput>> {
    let cmd: DispatchInput = match serde_json::from_str(&input) {
        Ok(c) => c,
        Err(e) => return Ok(Json(DispatchOutput { ok: None, err: Some(format!("invalid input: {e}")) })),
    };

    match cmd.command.as_str() {
        "import" => {
            let args: ImportArgs = match serde_json::from_value(cmd.args) {
                Ok(a) => a,
                Err(e) => return Ok(Json(DispatchOutput { ok: None, err: Some(format!("invalid args: {e}")) })),
            };
            match do_import(&args.vcf_dir, &args.contacts_dir, &unsafe { host_system_time() }.unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())) {
                Ok(count) => Ok(Json(DispatchOutput {
                    ok: Some(serde_json::json!({"imported": count})),
                    err: None,
                })),
                Err(e) => Ok(Json(DispatchOutput { ok: None, err: Some(e) })),
            }
        }
        other => Ok(Json(DispatchOutput { ok: None, err: Some(format!("unknown command: {other}")) })),
    }
}

#[plugin_fn]
pub fn on_vault_open(_vault_path: String) -> FnResult<String> {
    Ok(String::new())
}

#[plugin_fn]
pub fn on_vault_close(_vault_path: String) -> FnResult<()> {
    Ok(())
}

#[plugin_fn]
pub fn on_event(_input: String) -> FnResult<()> {
    Ok(())
}

// ── Fallback UUID generator (for when host_generate_uuid fails) ───────────

thread_local! {
    static ID_COUNTER: RefCell<u64> = RefCell::new(0);
}

fn fallback_id() -> String {
    ID_COUNTER.with(|c| {
        let mut n = c.borrow_mut();
        let id = format!("local-{:016x}", *n);
        *n += 1;
        id
    })
}

// ── Core import logic ──────────────────────────────────────────────────────

fn do_import(vcf_dir: &str, contacts_dir: &str, now: &str) -> Result<usize, String> {
    // Ensure output directory exists
    unsafe { host_create_dir(contacts_dir.to_string()) }
        .map_err(|e| format!("create_dir: {e}"))?;

    // List .vcf files
    let listing = unsafe { host_read_dir(vcf_dir.to_string()) }
        .map_err(|e| format!("read_dir: {e}"))?;
    let vcf_files: Vec<String> = listing
        .lines()
        .filter(|l| l.ends_with(".vcf") || l.ends_with(".VCF"))
        .map(|l| {
            if l.starts_with('/') { l.to_string() }
            else { format!("{}/{}", vcf_dir.trim_end_matches('/'), l) }
        })
        .collect();

    if vcf_files.is_empty() {
        return Err(format!("No .vcf files found in '{vcf_dir}'"));
    }

    let mut count = 0;

    for vcf_path in &vcf_files {
        let content = unsafe { host_read_file(vcf_path.to_string()) }
            .map_err(|e| format!("read_file {vcf_path}: {e}"))?;
        let text = String::from_utf8_lossy(&content);

        for contact in parse_vcards(&text) {
            let md = vcard_to_ruas_md(&contact, &now, contacts_dir)
                .map_err(|e| format!("generate markdown: {e}"))?;
            let json = serde_json::json!({ "path": md.path, "content": md.content });
            let payload = serde_json::to_string(&json).unwrap_or_default();
            unsafe { host_write_file(payload) }
                .map_err(|e| format!("write_file: {e}"))?;
            count += 1;
        }
    }

    Ok(count)
}

// ── Simple vCard parser (no external crate inside WASM) ─────────────────────

struct VCard {
    full_name: String,
    given: String,
    family: String,
    emails: Vec<(String, String)>,   // (type, value)
    phones: Vec<(String, String)>,
    addresses: Vec<HashMap<String, String>>,
    org: String,
    title: String,
    url: String,
    bday: String,
    note: String,
}

// ── Simple vCard parser (RFC 2426 / vCard 3.0) ──────────────────────────
//
// Handles:
//  - Folded lines (RFC 2426 §2.6): continuation lines starting with space/tab
//  - Apple-style grouped properties: itemN.TEL + itemN.X-ABLabel pairs
//  - Multiple TYPE= parameters (e.g. TYPE=INTERNET,TYPE=WORK)
//  - QUOTED-PRINTABLE encoding
//  - Escaped characters: \\n, \\,, \\;

fn parse_vcards(text: &str) -> Vec<VCard> {
    use std::collections::HashMap;

    // ── Pass 1: unfold lines ────────────────────────────────────────────
    let mut logical: Vec<String> = Vec::new();
    for raw_line in text.lines() {
        let trimmed = raw_line.trim_start().to_string();
        if trimmed.is_empty() { continue; }
        if raw_line.starts_with(|c: char| c == ' ' || c == '\t') {
            if let Some(last) = logical.last_mut() {
                last.push_str(&trimmed);
            }
        } else {
            logical.push(trimmed);
        }
    }

    // ── Pass 2: parse logical lines ─────────────────────────────────────
    let mut cards = Vec::new();
    let mut current: Option<VCard> = None;
    let mut in_vcard = false;
    let mut item_labels: HashMap<String, String> = HashMap::new();
    let mut last_item_id: Option<String> = None;

    for line in &logical {
        if line.eq_ignore_ascii_case("BEGIN:VCARD") {
            in_vcard = true;
            item_labels.clear();
            last_item_id = None;
            current = Some(VCard {
                full_name: String::new(), given: String::new(), family: String::new(),
                emails: vec![], phones: vec![], addresses: vec![],
                org: String::new(), title: String::new(), url: String::new(),
                bday: String::new(), note: String::new(),
            });
            continue;
        }
        if line.eq_ignore_ascii_case("END:VCARD") {
            if let Some(c) = current.take() { cards.push(c); }
            in_vcard = false;
            continue;
        }
        if !in_vcard || current.is_none() { continue; }

        let c = current.as_mut().unwrap();
        let (key, value) = match line.split_once(':') {
            Some((k, v)) => (k, v),
            None => continue,
        };

        let upper = key.to_uppercase();
        let (item_id, prop_without_item) = strip_item_prefix(&upper);

        // X-ABLABEL: associate with the item number
        if prop_without_item == "X-ABLABEL" {
            let tid = item_id.or(last_item_id.clone());
            if let Some(iid) = tid {
                item_labels.insert(iid, value.trim().to_string());
            }
            continue;
        }

        last_item_id = item_id.clone();
        let label = item_id.as_ref().and_then(|iid| item_labels.get(iid).cloned());

        let (prop, params) = if let Some((p, par)) = prop_without_item.split_once(';') {
            (p, Some(par))
        } else {
            (prop_without_item, None)
        };

        let val = if is_quoted_printable(params) {
            decode_qp(value.trim())
        } else {
            value.trim().to_string()
        };
        let val = unescape_vcard(&val);

        match prop {
            "FN" => c.full_name = val,
            "N" => {
                let parts: Vec<&str> = val.split(';').collect();
                c.family = parts.first().unwrap_or(&"").to_string();
                c.given = parts.get(1).unwrap_or(&"").to_string();
            }
            "EMAIL" => {
                let typ = label.unwrap_or_else(|| extract_types(params));
                c.emails.push((typ, val));
            }
            "TEL" => {
                let typ = label.unwrap_or_else(|| extract_types(params));
                c.phones.push((typ, val));
            }
            "ADR" => {
                let parts: Vec<&str> = val.split(';').collect();
                let mut adr = HashMap::new();
                let typ = label.unwrap_or_else(|| extract_types(params));
                adr.insert("type".into(), typ);
                if let Some(v) = parts.get(2) { if !v.is_empty() { adr.insert("street".into(), v.to_string()); } }
                if let Some(v) = parts.get(3) { if !v.is_empty() { adr.insert("city".into(), v.to_string()); } }
                if let Some(v) = parts.get(4) { if !v.is_empty() { adr.insert("region".into(), v.to_string()); } }
                if let Some(v) = parts.get(5) { if !v.is_empty() { adr.insert("code".into(), v.to_string()); } }
                if let Some(v) = parts.get(6) { if !v.is_empty() { adr.insert("country".into(), v.to_string()); } }
                if adr.len() > 1 { c.addresses.push(adr); }
            }
            "ORG" => c.org = val,
            "TITLE" => c.title = val,
            "URL" => c.url = val,
            "BDAY" => c.bday = val,
            "NOTE" => c.note = val,
            _ => {}
        }
    }

    cards
}

/// Strip "ITEM1." → (Some("ITEM1"), "TEL"), or return (None, key) unchanged.
fn strip_item_prefix(key: &str) -> (Option<String>, &str) {
    if let Some(rest) = key.strip_prefix("ITEM") {
        if let Some(i) = rest.find('.') {
            if i > 0 && rest[..i].chars().all(|c| c.is_ascii_digit()) {
                return (Some(format!("ITEM{}", &rest[..i])), &rest[i+1..]);
            }
        }
    }
    (None, key)
}

/// Collect all TYPE= values, joined by comma. Falls back to "other".
fn extract_types(params: Option<&str>) -> String {
    let types: Vec<&str> = params
        .iter()
        .flat_map(|p| p.split(';'))
        .filter(|seg| seg.len() > 5 && seg[..5].eq_ignore_ascii_case("TYPE="))
        .map(|seg| &seg[5..])
        .collect();
    if types.is_empty() { "other".into() } else { types.join(",").to_lowercase() }
}

fn extract_vcard_type(params: Option<&str>) -> String {
    extract_types(params)
}

fn is_quoted_printable(params: Option<&str>) -> bool {
    params.map_or(false, |p| {
        p.split(';').any(|seg| {
            seg.len() > 9 && seg[..9].eq_ignore_ascii_case("ENCODING=")
                && seg[9..].eq_ignore_ascii_case("QUOTED-PRINTABLE")
        })
    })
}

/// Decode QUOTED-PRINTABLE per RFC 2045 §6.7.
fn decode_qp(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let b = value.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'=' && i + 2 < b.len()
            && b[i+1].is_ascii_hexdigit() && b[i+2].is_ascii_hexdigit()
        {
            if let Ok(byte) = u8::from_str_radix(&value[i+1..i+3], 16) {
                out.push(byte as char);
                i += 3;
                continue;
            }
        }
        if b[i] == b'=' && i + 1 < b.len() && b[i+1] == b'\n' { i += 2; continue; } // soft break
        if b[i] == b'=' && i + 2 < b.len() && b[i+1] == b'\r' && b[i+2] == b'\n' { i += 3; continue; }
        out.push(b[i] as char);
        i += 1;
    }
    out
}

/// Unescape vCard escapes: \\\\ → \\, \\n → newline, \\, → ,, \\; → ;
fn unescape_vcard(val: &str) -> String {
    let mut out = String::with_capacity(val.len());
    let b = val.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\\' && i + 1 < b.len() {
            i += 1;
            match b[i] {
                b'n' | b'N' => out.push('\n'),
                b',' | b';' | b'\\' => out.push(b[i] as char),
                _ => { out.push('\\'); out.push(b[i] as char); }
            }
        } else {
            out.push(b[i] as char);
        }
        i += 1;
    }
    out
}

struct GeneratedMd {
    path: String,
    content: String,
}

fn vcard_to_ruas_md(card: &VCard, now: &str, dir: &str) -> Result<GeneratedMd, String> {
    let given = if card.given.is_empty() { card.full_name.split_whitespace().next().unwrap_or("").to_string() } else { card.given.clone() };
    let family = if card.family.is_empty() {
        let parts: Vec<&str> = card.full_name.split_whitespace().collect();
        if parts.len() > 1 { parts.last().unwrap_or(&"").to_string() } else { String::new() }
    } else {
        card.family.clone()
    };

    let uid = unsafe { host_generate_uuid() }.unwrap_or_else(|_| fallback_id());

    let mut fm = serde_json::Map::new();
    fm.insert("uid".into(), serde_json::Value::String(uid));
    fm.insert("fn".into(), serde_json::Value::String(card.full_name.clone()));
    if !given.is_empty() { fm.insert("given-name".into(), serde_json::Value::String(given)); }
    if !family.is_empty() { fm.insert("family-name".into(), serde_json::Value::String(family)); }
    fm.insert("created".into(), serde_json::Value::String(now.to_string()));
    fm.insert("modified".into(), serde_json::Value::String(now.to_string()));

    if !card.emails.is_empty() {
        let emails: Vec<serde_json::Value> = card.emails.iter().map(|(t, v)| {
            serde_json::json!({ "type": t, "value": v })
        }).collect();
        fm.insert("email".into(), serde_json::Value::Array(emails));
    }
    if !card.phones.is_empty() {
        let phones: Vec<serde_json::Value> = card.phones.iter().map(|(t, v)| {
            serde_json::json!({ "type": t, "value": v })
        }).collect();
        fm.insert("tel".into(), serde_json::Value::Array(phones));
    }
    if !card.addresses.is_empty() {
        let adrs: Vec<serde_json::Value> = card.addresses.iter().map(|a| {
            let mut m = serde_json::Map::new();
            for (k, v) in a {
                m.insert(k.clone(), serde_json::Value::String(v.clone()));
            }
            serde_json::Value::Object(m)
        }).collect();
        fm.insert("adr".into(), serde_json::Value::Array(adrs));
    }
    if !card.org.is_empty() { fm.insert("org".into(), serde_json::Value::String(card.org.clone())); }
    if !card.title.is_empty() { fm.insert("title".into(), serde_json::Value::String(card.title.clone())); }
    if !card.url.is_empty() { fm.insert("url".into(), serde_json::Value::String(card.url.clone())); }
    if !card.bday.is_empty() { fm.insert("bday".into(), serde_json::Value::String(card.bday.clone())); }

    fm.insert("tags".into(), serde_json::json!(["contact", "imported"]));

    let yaml = serde_yaml::to_string(&serde_json::Value::Object(fm))
        .map_err(|e| format!("yaml error: {e}"))?;

    // Safe filename
    let filename = sanitize_filename(&card.full_name);
    let path = format!("{}/{}.md", dir.trim_end_matches('/'), filename);

    let mut content = format!("---\n{}---", yaml);
    if !card.note.is_empty() {
        content.push_str(&format!("\n\n{}", card.note));
    }
    content.push('\n');

    Ok(GeneratedMd { path, content })
}

fn sanitize_filename(name: &str) -> String {
    let safe: String = name.chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '_' || c == '-' { c } else { '_' })
        .collect();
    let trimmed = safe.trim();
    if trimmed.is_empty() { "unnamed".into() } else { trimmed.to_string() }
}
