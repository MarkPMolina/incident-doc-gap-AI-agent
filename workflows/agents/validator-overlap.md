# Sub-Agent: validator-overlap

Edits or deletes drafted documentation based on overlap with existing published content. This agent is a **mutating editor** — it modifies and removes files directly.

**One agent per draft.** The orchestrator spawns a separate instance of this agent for each draft file, running all instances in parallel. This ensures each draft gets a dedicated context window for thorough searching.

## Input

- Exactly **one** draft markdown file (from `{runDir}/doc-fix-drafts/`)
- Access to documentation repository (`{DOCS_REPO_ROOT}/docs_external/` and `docs_internal/`)
- No intermediate JSON files — work only from the draft itself

## Actions (not reports)

This agent edits files. It does NOT produce JSON artifacts or structured output files.

- **No overlap** → Leave the draft unchanged.
- **Partial overlap** → Remove content that duplicates existing published pages. Rewrite the draft as an augmentation patch targeting the most relevant existing page(s). Rename the file to `{theme-slug}_patch.md`.
- **Heavy overlap** → Delete the draft file entirely. The theme is a discoverability problem, not a doc gap.

## Method

1. **Extract search terms from the draft.** Read the draft and identify:
   - Symptom headings and error messages (exact strings)
   - Cmdlet names and tool references
   - Conceptual keywords
   - Any `augments:` or `xref:` references already in the draft

2. **Search documentation thoroughly for existing coverage.** For each search term:
   - **Filename search**: glob for files with related keywords in the name
   - **Content search**: grep for exact error messages, cmdlet names, and symptom descriptions
   - **Heading/UID search**: look for heading text and `uid` values indicating topical overlap
   - Search both `docs_external/` and `docs_internal/`

3. **Assess overlap at the RESOLUTION level, not just the topic level.** This is the critical step. For each scenario in the draft:
   a. Identify the **exact resolution action** the draft recommends (e.g., "update the client", "re-run enrollment", "close shells and reopen").
   b. Search existing pages for that same resolution action applied to the same or equivalent context.
   c. A scenario is overlapping if the existing docs already tell the user to do the same thing for the same problem — even if using different headings, error strings, or page locations.
   d. A new error string alone does NOT make a scenario "new" if the resolution is already documented.

4. **Act on the draft:**
   - **No content (placeholder)**: If the draft contains only placeholder text, **delete the file** regardless of overlap. This is a drafting error.
   - **No overlap**: The draft's resolution steps are genuinely not documented anywhere. Leave unchanged.
   - **Partial overlap**: Delete overlapping scenarios. Keep only scenarios whose resolution actions are genuinely new. If what remains is trivial, delete the file.
   - **Heavy overlap**: Delete the file. Print which file was deleted and why.
   - **Heavy overlap + unique error string**: Delete the draft, BUT emit a **micro-patch** file containing ONLY the error string + a cross-reference to the existing page that documents the resolution.

## Constraints

- Do NOT use intermediate analysis JSON files for context
- Assess overlap at the resolution level — not by topic, not by error string
- A new error message alone does NOT justify a full draft if the fix is already documented
- When converting to a patch, use heading-relative insertion points (never line numbers)
