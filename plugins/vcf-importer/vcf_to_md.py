"""
vcf_to_md.py — VCF to Ruas Markdown Contacts Converter

Converts .vcf (vCard) files into Ruas-compatible .md contact files.

The output frontmatter follows the Ruas contact schema:
  - fn                          → full name
  - given-name, family-name     → split name
  - email: [{ type, value }]    → email addresses
  - tel: [{ type, value }]      → phone numbers
  - adr: [{ type, street, neighborhood, city, region, code, country }]
  - org, title, url, bday, note
  - tags: [string]
  - uid (auto-generated UUID)
  - created, modified (ISO 8601 timestamps)

Usage:
  python vcf_to_md.py <input_dir> <output_dir>

Example:
  python vcf_to_md.py ~/Downloads/vcf ~/ruas/contacts
"""

import vobject
import os
import glob
import uuid
from datetime import datetime, timezone
import yaml

# ── Helpers ─────────────────────────────────────────────────────────────────

def get_type_param(obj, default="other"):
    """Extract the TYPE parameter from a vCard property (e.g. WORK, HOME, CELL)."""
    try:
        types = obj.type_param
        return "".join(types).lower() if types else default
    except AttributeError:
        return default


def safe_filename(name: str) -> str:
    """Sanitize a name for use as a filename."""
    keep = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-")
    safe = "".join(c if c in keep else "_" for c in name)
    return safe.strip() or "unnamed"


def split_name(full_name: str) -> tuple[str, str]:
    """Split a full name into given-name and family-name."""
    parts = full_name.strip().split()
    if len(parts) == 0:
        return ("", "")
    if len(parts) == 1:
        return (parts[0], "")
    return (parts[0], parts[-1])


# ── Main converter ──────────────────────────────────────────────────────────

def convert_vcf_to_ruas(input_dir: str, output_dir: str) -> int:
    """
    Convert all .vcf files in `input_dir` to Ruas-compatible .md contact files
    in `output_dir`. Returns the number of contacts converted.
    """
    os.makedirs(output_dir, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()
    count = 0

    for vcf_file in glob.glob(os.path.join(input_dir, "*.vcf")):
        with open(vcf_file, "r", encoding="utf-8", errors="replace") as f:
            vcf_content = f.read()

        for vcard in vobject.readComponents(vcf_content):
            if vcard.name != "VCARD":
                continue

            full_name = getattr(vcard, "fn", None)
            if not full_name:
                continue

            name = str(full_name.value).strip()
            if not name:
                continue

            given, family = split_name(name)

            # ── Build Ruas-compatible frontmatter ────────────────────────
            fm: dict = {
                "uid": str(uuid.uuid4()),
                "fn": name,
                "given-name": given,
                "family-name": family,
                "created": now,
                "modified": now,
            }

            # Email addresses
            emails = []
            if hasattr(vcard, "email_list"):
                for email in vcard.email_list:
                    emails.append({
                        "type": get_type_param(email, "other"),
                        "value": str(email.value).strip(),
                    })
            if emails:
                fm["email"] = emails

            # Phone numbers
            phones = []
            if hasattr(vcard, "tel_list"):
                for tel in vcard.tel_list:
                    phones.append({
                        "type": get_type_param(tel, "other"),
                        "value": str(tel.value).strip(),
                    })
            if phones:
                fm["tel"] = phones

            # Addresses
            addresses = []
            if hasattr(vcard, "adr_list"):
                for adr in vcard.adr_list:
                    parts = adr.value
                    entry = {"type": get_type_param(adr, "other")}
                    for field, src in [
                        ("street", parts.street),
                        ("neighborhood", getattr(parts, "extended", None)),
                        ("city", parts.city),
                        ("region", parts.region),
                        ("code", parts.code),
                        ("country", parts.country),
                    ]:
                        val = str(src).strip() if src else ""
                        if val:
                            entry[field] = val
                    if len(entry) > 1:  # more than just "type"
                        addresses.append(entry)
            if addresses:
                fm["adr"] = addresses

            # Organization & title
            if hasattr(vcard, "org"):
                org_val = vcard.org.value
                if isinstance(org_val, list):
                    fm["org"] = ", ".join(str(x) for x in org_val if x)
                else:
                    fm["org"] = str(org_val).strip()

            if hasattr(vcard, "title"):
                fm["title"] = str(vcard.title.value).strip()

            # URL
            if hasattr(vcard, "url"):
                fm["url"] = str(vcard.url.value).strip()

            # Birthday
            if hasattr(vcard, "bday"):
                bday = vcard.bday.value
                if isinstance(bday, datetime):
                    fm["bday"] = bday.date().isoformat()
                elif hasattr(bday, "isoformat"):
                    fm["bday"] = bday.isoformat()
                else:
                    fm["bday"] = str(bday).strip()

            # Notes → body content
            body = ""
            if hasattr(vcard, "note"):
                body = str(vcard.note.value).strip()

            # Tags
            fm["tags"] = ["contact", "imported"]

            # ── Write .md file ───────────────────────────────────────────
            filename = safe_filename(name)
            md_path = os.path.join(output_dir, f"{filename}.md")

            # Avoid overwriting — append a suffix if file exists
            counter = 1
            while os.path.exists(md_path):
                md_path = os.path.join(output_dir, f"{filename}-{counter}.md")
                counter += 1

            yaml_str = yaml.dump(
                {k: v for k, v in fm.items() if v is not None},
                allow_unicode=True,
                sort_keys=False,
                default_flow_style=False,
            )

            content = f"---\n{yaml_str}---\n"
            if body:
                content += f"\n{body}\n"

            with open(md_path, "w", encoding="utf-8") as f:
                f.write(content)

            count += 1
            print(f"  ✓ {filename}.md")

    return count


# ── CLI entry point ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 3:
        print("Usage: python vcf_to_md.py <input_dir> <output_dir>")
        print("Example: python vcf_to_md.py ~/Downloads/contacts ~/ruas/contacts")
        sys.exit(1)

    input_dir = os.path.expanduser(sys.argv[1])
    output_dir = os.path.expanduser(sys.argv[2])

    if not os.path.isdir(input_dir):
        print(f"Error: input directory not found: {input_dir}")
        sys.exit(1)

    print(f"Converting .vcf files from {input_dir} → {output_dir} ...")
    print()

    try:
        count = convert_vcf_to_ruas(input_dir, output_dir)
        print()
        print(f"Done. {count} contact(s) converted.")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
