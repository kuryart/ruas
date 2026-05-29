use serde::{Deserialize, Serialize};

// ── Contact field types ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactEmail {
    #[serde(rename = "type", default = "default_field_type")]
    pub field_type: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactPhone {
    #[serde(rename = "type", default = "default_field_type")]
    pub field_type: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContactAddress {
    #[serde(rename = "type", default = "default_field_type")]
    pub field_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub street: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
}

fn default_field_type() -> String {
    "other".to_string()
}

// ── Frontmatter (vCard-style) ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContactFrontmatter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    /// vCard FN (formatted/full name)
    #[serde(rename = "fn", skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    #[serde(rename = "given-name", skip_serializing_if = "Option::is_none")]
    pub given_name: Option<String>,
    #[serde(rename = "family-name", skip_serializing_if = "Option::is_none")]
    pub family_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<Vec<ContactEmail>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tel: Option<Vec<ContactPhone>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adr: Option<Vec<ContactAddress>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bday: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub photo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<String>,
}

impl ContactFrontmatter {
    pub fn display_name(&self) -> String {
        if let Some(n) = &self.full_name {
            return n.clone();
        }
        let g = self.given_name.as_deref().unwrap_or("");
        let f = self.family_name.as_deref().unwrap_or("");
        let combined = format!("{g} {f}").trim().to_string();
        if !combined.is_empty() {
            combined
        } else {
            "Unnamed".to_string()
        }
    }

    pub fn initials(&self) -> String {
        let name = self.display_name();
        name.split_whitespace()
            .filter_map(|w| w.chars().next())
            .take(2)
            .collect::<String>()
            .to_uppercase()
    }
}

// ── Contact ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub path: String,
    pub frontmatter: ContactFrontmatter,
    pub body: String,
}

/// Lightweight version for listing (avoids sending full body over IPC)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactMeta {
    pub path: String,
    pub display_name: String,
    pub initials: String,
    pub org: Option<String>,
    pub primary_email: Option<String>,
    pub tags: Option<Vec<String>>,
}

// ── Parse / serialize ──────────────────────────────────────────────────────

pub fn parse_contact(path: &str, content: &str) -> Result<Contact, String> {
    let (frontmatter, body) = split_frontmatter(content)?;
    Ok(Contact { path: path.to_string(), frontmatter, body })
}

pub fn serialize_contact(fm: &ContactFrontmatter, body: &str) -> Result<String, String> {
    let yaml = serde_yaml::to_string(fm)
        .map_err(|e| format!("YAML serialize error: {e}"))?;
    Ok(format!("---\n{yaml}---\n\n{body}"))
}

pub fn contact_to_meta(c: &Contact) -> ContactMeta {
    let primary_email = c.frontmatter.email.as_ref()
        .and_then(|v| v.first())
        .map(|e| e.value.clone());
    ContactMeta {
        path: c.path.clone(),
        display_name: c.frontmatter.display_name(),
        initials: c.frontmatter.initials(),
        org: c.frontmatter.org.clone(),
        primary_email,
        tags: c.frontmatter.tags.clone(),
    }
}

fn split_frontmatter(content: &str) -> Result<(ContactFrontmatter, String), String> {
    let s = content.trim_start();
    if !s.starts_with("---") {
        return Ok((ContactFrontmatter::default(), content.to_string()));
    }
    let rest = &s[3..];
    // allow both "\n---" and "\r\n---"
    let end = rest.find("\n---").ok_or("Unclosed frontmatter")?;
    let yaml = &rest[..end];
    let body = rest[end + 4..].trim_start_matches('\n').trim_start_matches('\r').to_string();
    let fm: ContactFrontmatter = serde_yaml::from_str(yaml)
        .map_err(|e| format!("YAML parse error: {e}"))?;
    Ok((fm, body))
}
