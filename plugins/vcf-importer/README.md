# VCF Importer

Converts `.vcf` (vCard) contact files into Ruas-compatible Markdown contacts.

## Installation

1. Copy this directory to your vault's plugins folder:
   ```
   cp -r plugins/vcf-importer <vault>/.ruas/plugins/vcf-importer
   ```

2. Install Python dependencies:
   ```bash
   pip install vobject pyyaml
   ```

3. The plugin will appear in **Settings → Plugins → Community**.
   Enable it to acknowledge the plugin is active.

## Usage

Run the script manually from the terminal:

```bash
cd <vault>/.ruas/plugins/vcf-importer
python vcf_to_md.py ~/Downloads/contacts <vault>/contacts
```

- First argument: directory containing `.vcf` files
- Second argument: output directory (usually your vault's `contacts/` folder)

The script reads each `.vcf`, extracts name, phone, email, address, organization,
birthday, and notes — and writes a `.md` file with Ruas-compatible frontmatter
for each contact.

## Example

```bash
# Export your Google Contacts as .vcf, then:
python vcf_to_md.py ~/Downloads/google-contacts ~/ruas/contacts
```

After conversion, open the Ruas app — the new contacts will appear in the
Contacts module.

## Frontmatter format

Each output `.md` file has this structure:

```yaml
---
uid: 550e8400-e29b-41d4-a716-446655440000
fn: Alice Smith
given-name: Alice
family-name: Smith
email:
  - type: work
    value: alice@example.com
tel:
  - type: cell
    value: +1 555-0100
org: Acme Corp
title: Engineer
bday: 1990-05-15
tags:
  - contact
  - imported
created: "2025-01-01T00:00:00+00:00"
modified: "2025-01-01T00:00:00+00:00"
---

Optional note body text.
```

## Requirements

- Python 3.9+
- `vobject` — vCard parser (`pip install vobject`)
- `pyyaml` — YAML serializer (`pip install pyyaml`)
