# Sub-Agent: taxonomy-updater

Updates or creates the theme taxonomy based on the current run's incident data. This is a living document that evolves each run — themes may be added, merged, split, or deprecated.

## Inputs

- `{runDir}/incident-extract.jsonl` — The frozen incident dataset from Pass 1
- `{WORKSPACE_ROOT}/incident-doc-gap/data/theme-taxonomy.yml` — The current canonical taxonomy (may not exist on first run)

## Outputs

- Updated `{WORKSPACE_ROOT}/incident-doc-gap/data/theme-taxonomy.yml` (version bumped, changeLog appended)
- `{runDir}/taxonomy-snapshot.yml` — Read-only snapshot of the taxonomy as used for this run

## Method

### 1. Load existing taxonomy

Read `data/theme-taxonomy.yml`. If it doesn't exist (first run), proceed to step 3 with an empty theme set.

### 2. Classify incidents against existing themes

Run the two-pass classification procedure (defined in the taxonomy file header) against the current taxonomy. Track:
- How many `signal` incidents each theme captured
- How many incidents remain `unclassified` after both passes
- Which themes captured zero incidents

### 3. Analyze for proposed changes

Based on the classification results, generate a numbered proposal list. Each proposal is one of:

- **[NEW]** — Propose a new theme if >5 unclassified incidents share a clear pattern in their Title + CustomerSymptom text (not just RootCause overlap). Include:
  - Proposed `slug`, `display_name`, `matching_signals`
  - Example incident IDs (up to 5)
  - Why no existing theme fits

- **[MERGE]** — Propose merging two themes if their incident sets significantly overlap (>30% of one theme's incidents also score highly for the other) and their `boundary_notes` can no longer clearly distinguish them.

- **[SPLIT]** — Propose splitting a theme if it captures a large, heterogeneous set where two distinct sub-patterns are visible.

- **[DEPRECATE]** — Propose deprecating a theme if it captured zero incidents in this run AND zero in the previous run.

If no changes are warranted, state "No taxonomy changes proposed" and skip to step 5.

### 4. Present proposal and get user confirmation

Present the numbered proposal list to the user:

```
Taxonomy Update Proposal ({N} changes):

  1. [NEW] "{display_name}" — {count} incidents match (e.g. {id1}, {id2})
     Signals: {top matching keywords}

  2. [MERGE] "{theme_a}" + "{theme_b}" → "{combined_name}"
     Reason: {overlap percentage}% incident overlap

  3. [DEPRECATE] "{theme_slug}" — zero incidents in last 2 runs
```

⏸️ **Wait for user confirmation.** The user may accept all, reject all, or selectively approve.

### 5. Apply approved changes

For each approved proposal:
- [NEW]: Add the new theme entry to the YAML
- [MERGE]: Combine matching_signals, update boundary_notes, mark old slug as deprecated
- [SPLIT]: Create two new entries, move matching_signals appropriately
- [DEPRECATE]: Add `deprecated: true` flag to the theme

Bump the version number and append to the changeLog.

### 6. Save and snapshot

- Write the updated taxonomy to `data/theme-taxonomy.yml`
- Copy to `{runDir}/taxonomy-snapshot.yml` (frozen for this run's reproducibility)

## Constraints

- Do NOT propose themes based solely on RootCause text overlap — themes must be distinguishable from the user's perspective (Title + CustomerSymptom)
- Do NOT rename existing slugs — they are stable identifiers referenced across reports
- Do NOT remove themes without deprecation (preserves historical references)
