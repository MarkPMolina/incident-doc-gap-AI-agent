#!/usr/bin/env python3
"""
convert-drafts-to-docx.py

Converts incident doc-gap draft .md files to properly formatted .docx files.
Fixes two recurring issues:
  1. Incident IDs from YAML frontmatter are rendered as clickable hyperlinks.
  2. Nested markdown code fences (````markdown blocks used for patch content)
     are unwrapped so their content renders as formatted text, not raw code.

Usage:
    python convert-drafts-to-docx.py <drafts-dir>

Requires: pandoc on PATH, PyYAML (pip install pyyaml)
"""

import os
import sys
import re
import subprocess
import tempfile

try:
    import yaml
except ImportError:
    print("Installing PyYAML...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pyyaml", "-q"])
    import yaml


# Configurable: set to your incident portal URL pattern
INCIDENT_PORTAL_URL = "{INCIDENT_PORTAL_URL}{}"


def extract_frontmatter(content):
    """Extract YAML frontmatter and return (metadata_dict, body_without_frontmatter)."""
    if not content.startswith("---"):
        return {}, content
    end = content.find("\n---", 3)
    if end == -1:
        return {}, content
    fm_text = content[3:end].strip()
    body = content[end + 4:].lstrip("\n")
    try:
        meta = yaml.safe_load(fm_text)
    except Exception:
        meta = {}
    return meta or {}, body


def build_incident_header(meta):
    """Build a markdown section with clickable incident links from frontmatter."""
    incidents = meta.get("motivated_by_icms", [])
    if not incidents:
        return ""

    lines = ["**Motivating Incidents:**\n"]
    for entry in incidents:
        inc_id = entry.get("id", "")
        url = entry.get("url", INCIDENT_PORTAL_URL.format(inc_id))
        lines.append(f"- [{inc_id}]({url})")
    lines.append("")
    return "\n".join(lines) + "\n"


def unwrap_markdown_fences(body):
    """
    Unwrap ````markdown ... ```` blocks so their content is treated as regular
    markdown (rendered with formatting) instead of as a code block.
    """
    pattern = r'^(`{4,})(?:markdown)?\s*\n(.*?)\n\1\s*$'
    result = re.sub(pattern, r'\2', body, flags=re.MULTILINE | re.DOTALL)
    return result


def make_incident_ids_clickable(body):
    """
    Find bare 9-digit incident IDs in the body text and make them clickable links.
    Skips IDs that are already inside a markdown link [...](url).
    """
    result = re.sub(
        r'(?<!\[)\b(\d{9})\b(?!\]\()',
        lambda m: f"[{m.group(1)}]({INCIDENT_PORTAL_URL.format(m.group(1))})",
        body
    )
    return result


def process_draft(md_path):
    """Process a single draft .md file and convert to .docx."""
    with open(md_path, "r", encoding="utf-8") as f:
        content = f.read()

    meta, body = extract_frontmatter(content)

    # Build the processed markdown
    title = meta.get("title", os.path.basename(md_path).replace(".md", ""))
    processed = f"# {title}\n\n"

    incident_header = build_incident_header(meta)
    if incident_header:
        processed += incident_header + "\n"

    body = unwrap_markdown_fences(body)
    body = make_incident_ids_clickable(body)
    processed += body

    # Write to temp file and convert with pandoc
    out_path = md_path.replace(".md", ".docx")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, encoding="utf-8") as tmp:
        tmp.write(processed)
        tmp_path = tmp.name

    try:
        result = subprocess.run(
            ["pandoc", tmp_path, "-o", out_path, "--from", "markdown", "--to", "docx"],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            print(f"  ERROR converting {os.path.basename(md_path)}: {result.stderr.strip()}")
            return False
        return True
    finally:
        os.unlink(tmp_path)


def main():
    if len(sys.argv) < 2:
        print("Usage: python convert-drafts-to-docx.py <drafts-dir>")
        sys.exit(1)

    drafts_dir = sys.argv[1]
    if not os.path.isdir(drafts_dir):
        print(f"Directory not found: {drafts_dir}")
        sys.exit(1)

    md_files = sorted(f for f in os.listdir(drafts_dir) if f.endswith(".md"))
    print(f"Converting {len(md_files)} drafts in {drafts_dir}")
    print()

    success = 0
    for md_file in md_files:
        md_path = os.path.join(drafts_dir, md_file)
        if process_draft(md_path):
            docx_name = md_file.replace(".md", ".docx")
            print(f"  OK {md_file} -> {docx_name}")
            success += 1
        else:
            print(f"  FAIL {md_file}")

    print(f"\nConverted {success}/{len(md_files)} files successfully.")


if __name__ == "__main__":
    main()
