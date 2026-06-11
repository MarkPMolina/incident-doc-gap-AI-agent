# Incident Doc Gap Analysis Workflow

## Error Handling — Halt on Failure

**Every step in this workflow is sequential and assumes the previous step succeeded.** If any step fails (API error, access denied, file not found, validation failure, etc.):

1. **Stop immediately.** Do not continue to the next step.
2. **Print a clear error message** explaining what failed, which step it occurred in, and any relevant error details (status code, message, path).
3. **Suggest remediation** if possible (e.g., "Refresh auth credentials", "Check incident API server is running", "Verify file path").
4. **Do not retry automatically.** Wait for the user to resolve the issue and explicitly re-run the workflow.

---

## Run Directory

Before beginning, create the run directory for this execution:

```
{WORKSPACE_ROOT}/incident-doc-gap/runs/{YYYYMMDD}-{HHMMSS}/
```

Use the current UTC date/time (e.g., `20260602-183000`). All artifacts for this run are written here. This ensures previous runs are never overwritten and can always be reviewed.

Define `{runDir}` = the path to this run directory for use in all subsequent steps.

After creating the folder, write a `run-status.json` file:

```json
{
  "created": "<ISO timestamp>",
  "reportStatus": "analyzed",
  "workflows": [
    { "name": "analyze", "status": "in_progress", "startedAt": "<ISO timestamp>", "completedAt": null }
  ]
}
```

### Report Lifecycle States

The `reportStatus` field tracks the report's progression through the full pipeline. Each workflow advances it:

| State | Set by | Meaning |
|-------|--------|---------|
| `analyzed` | analyze | Report generated, awaiting human review |
| `published` | publish | Branch pushed, drafts on shared site, tech review requested |
| `pr_created` | finalize | PR created and ready for review, feedback incorporated |
| `docs_merged` | user via finalize ("mark merged") | PR merged into docs repo master |

**Date-boundary rule:** The next analysis run's start date is derived from the most recent run whose `reportStatus` has reached `docs_merged`. Runs in earlier states do NOT advance the date boundary — if a run's PR is abandoned or never merged, the next analysis will re-cover that date range.

Set `completedAt` to the ISO timestamp when each workflow finishes. Subsequent workflows (publish, finalize) append entries to the `workflows` array and advance `reportStatus`.

---

## Pass 1 — Data Extraction (deterministic)

1. **Resolve the date range.** The start date for this run is the end date of the most recent run that has reached `docs_merged` status. Resolve using this priority:

   **Primary (local runs):** Scan `{WORKSPACE_ROOT}/incident-doc-gap/runs/` for run folders whose `run-status.json` has `"reportStatus": "docs_merged"`. Pick the one with the latest timestamp. Extract the end date from its report's Reproducibility Metadata table.

   **Fallback (shared document site):** If no local runs have `docs_merged` status (first run, or local history cleared), check the shared document site for the latest report whose status is `docs_merged`, and extract its end date.

   **Last resort (no reports found):** If BOTH local runs and shared site contain no `docs_merged` reports (e.g., first-ever run), prompt the user for a start date. Do not guess or use an arbitrary default.

   That end date is the **start date (inclusive)** for this run. The **end date (exclusive)** is today. Convert both to UTC. Print the resolved `startDateUtc` and `endDateUtc` before querying.

   **Important:** Runs in states earlier than `docs_merged` (`analyzed`, `published`, `pr_created`) do NOT advance the date boundary. If a prior run's PR was abandoned, this run will re-cover that date range.

   **Do not accept user-provided date ranges.** The date range is always derived from the most recent merged report. This ensures continuity — no gaps or overlaps between analysis cycles.

2. **Query all incidents.** Query configured teams by **exact team ID** — do not search by name or accept fuzzy matches:

   | Team Name | Team ID |
   |-----------|---------|
   | {TEAM_1_NAME} | **{TEAM_1_ID}** |
   | {TEAM_2_NAME} | **{TEAM_2_ID}** |
   | {TEAM_3_NAME} | **{TEAM_3_ID}** |

   **Validation gate:** After resolving team IDs, confirm that all configured IDs are present in the query plan. If any ID differs, **stop and report the mismatch**.

   **You must paginate to retrieve ALL incidents** — the incident API returns max 100 per request. Use pagination parameters to fetch subsequent pages until no more results are returned. Filter by `CreatedDate` within the resolved UTC date range. Include all incident states (Active, Mitigated, Resolved). Deduplicate by incident ID.

   **Fetching full incident details:** The search endpoint returns only summary fields. After collecting all incident IDs, use the batch-fetch script:

   ```powershell
   node "{WORKSPACE_ROOT}/incident-doc-gap/scripts/fetch-incident-details.js" "{runDir}"
   ```

   This script reads `{runDir}/incident-ids.txt` (one ID per line), calls the incident API sequentially with retry/resume support, and saves `{runDir}/incident-details-raw.json`. Save the deduplicated incident IDs to `{runDir}/incident-ids.txt` before running.

3. **Extract structured fields and classify signal vs. noise.** Use the extraction script:

   ```powershell
   node "{WORKSPACE_ROOT}/incident-doc-gap/scripts/extract-filter-sanitize.js" "{runDir}"
   ```

   This script reads `incident-details-raw.json`, applies noise-filtering rules R1-R5 deterministically, DLP-sanitizes all text fields, and outputs the JSONL file. After it completes successfully, **delete `incident-details-raw.json`** (no unsanitized data persisted to disk).

   The script extracts these fields into a flat dataset:
   - `IncidentId`, `IncidentUrl`, `TeamId`, `TeamName`, `Severity`, `Status`
   - `CreatedDateUtc`, `MitigatedDateUtc`, `ResolvedDateUtc`
   - `Title`, `CustomerSymptom`, `RootCauseSummary`, `ResolutionSummary`
   - `ErrorMessages`, `Components`, `CreatedBy`, `IsNoise`, `Environment`
   - `SignalClass` — one of `signal`, `automated`, or `noise`, assigned by the **deterministic noise-filtering rules** below

   **Noise-filtering rules (apply in order; first match wins):**

   | Rule | Condition | SignalClass |
   |------|-----------|-------------|
   | R1 — Noise flag | `IsNoise == true` | `noise` |
   | R2 — Monitoring prefix | `CreatedBy` starts with monitoring system prefixes (e.g., `MDM-`, `Log Alerts`, `LocalActiveMonitoring`) | `automated` |
   | R3 — Alerting system | `CreatedBy` contains alerting system identifiers | `automated` |
   | R4 — Service account | `CreatedBy` starts with `CN=` | `automated` |
   | R5 — Default | None of the above | `signal` |

   These rules must be applied **deterministically in Pass 1** — do not use LLM judgment for noise filtering. The JSONL output must include the `SignalClass` field and the rule ID that triggered it.

   **DLP-sensitive content sanitization:** Before saving, sanitize **all text fields** to prevent data exposure. Apply these redactions:

   | Pattern | Replacement |
   |---------|-------------|
   | Inline tokens, secrets, or base64 payloads | `[REDACTED]` |
   | Error codes referencing token content | Keep the error code, replace quoted PII with `'[REDACTED]'` |
   | Bare long hex strings (≥40 chars) | `[HASH-REDACTED]` |
   | Embedded connection strings or access keys | `[REDACTED]` |
   | Email addresses (except service accounts) | `[EMAIL-REDACTED]` |
   | User principal names in free text | `[UPN-REDACTED]` |
   | Subscription/tenant/resource IDs in free text | Keep field name, replace GUID with `[GUID-REDACTED]` |

   **No raw/unsanitized incident data is ever persisted to disk.**

4. **Save the dataset.** Save as a UTF-8 JSONL file (one JSON object per line) in `{runDir}` with the filename `Incident-Extract-{Mon}-{Mon}-{Year}.jsonl`.

5. **Validate and report.** After saving, print a validation summary:
   - Total incidents fetched (before dedup) and total after dedup
   - Count per team ID (with team name) — verify all configured team IDs are present
   - Pages fetched per team
   - Duplicate count removed
   - Date range used (UTC)
   - Signal/noise breakdown: count of `signal`, `automated`, and `noise` (with rule distribution)

---

## Pass 2 — Analysis & Classification

6. **Load the frozen dataset.** Read the JSONL file saved in Step 4. This is the single source of truth for all subsequent steps — do not re-query the incident API.

7. **Update the taxonomy.** Spawn the `taxonomy-updater` sub-agent (see `workflows/agents/taxonomy-updater.md`).

   ⏸️ **Human interaction point:** If the taxonomy-updater proposes changes, it presents them to the user and waits for confirmation before applying.

8. **Classify all incidents into themes.** Run the classification script:

   ```powershell
   node "{WORKSPACE_ROOT}/incident-doc-gap/scripts/classify-themes.js" "{runDir}" "{WORKSPACE_ROOT}/incident-doc-gap/data/theme-taxonomy.yml"
   ```

   **Quality gate:** After classification, check for:
   - Ambiguity rate ≥10% (incidents scoring within 1 point of two themes)
   - Unclassified rate >20%
   - Concentration >50% in a single theme

   If any gate is breached, loop back to the taxonomy-updater with the quality gate failure details.

9. **Classify gap types.** Run the evaluation script:

   ```powershell
   node "{WORKSPACE_ROOT}/incident-doc-gap/scripts/evaluate-gaps.js" "{runDir}" "{DOCS_REPO_ROOT}"
   ```

   This runs the 3-evaluator heuristic system and applies the deterministic decision table:

   | Operator says | Engineer says | Doc-Author says | → Classification |
   |---------------|---------------|-----------------|-----------------|
   | wouldn't find | could self-resolve | no content | `real_doc_gap` |
   | wouldn't find | could self-resolve | partial content | `partial_doc_gap` |
   | would find | could self-resolve | content exists | `discoverability_problem` |
   | — | can't self-resolve (code fix) | — | `engineering_fix` |
   | — | can't self-resolve (ops action) | — | `operational_gap` |
   | would find | — | full content | `no_doc_action_needed` |

   ⏸️ **Human interaction point:** Any incidents classified as `human_review` (insufficient evaluator signal) are presented to the user for manual classification.

---

## Drafting & Validation

10. **Draft doc fixes.** For each theme with actionable gap types (`real_doc_gap` or `partial_doc_gap`), produce draft documentation:

    - **`standalone`** — New page for themes with `real_doc_gap` where no existing doc covers the scenario
    - **`augmentation_patch`** — Content to merge into an existing page for `partial_doc_gap` themes

    **Content gate:** Do NOT create a file without real resolution steps. No templates, no "insert content here," no stubs. If there isn't enough signal to draft real content, skip the theme.

11. **Overlap validation.** Spawn a fresh `validator-overlap` agent per draft (see `workflows/agents/validator-overlap.md`). These run in parallel with NO access to analysis artifacts.

12. **Clarity pass.** Auto-revise prose quality across all surviving drafts. Constrained: no technical content changes allowed — only prose improvements (grammar, conciseness, structure).

13. **Cmdlet verification.** Spawn a fresh `validator-cmdlet` agent (see `workflows/agents/validator-cmdlet.md`). Confirms all referenced cmdlets/tools exist in the documentation repo and source code. Prunes hallucinated ones.

14. **Grounding verification.** Spawn a fresh `validator-grounding` agent (see `workflows/agents/validator-grounding.md`). Fact-checks target paths, headings, UIDs, and procedural claims against authoritative sources. Fixes in-place.

15. **Effectiveness evaluation.** Spawn a fresh `validator-effectiveness` agent (see `workflows/agents/validator-effectiveness.md`). Looks up motivating incidents via API, appends `## Reviewer Evaluation` verdict, marks drafts failing the bar with `needs_work: true` in frontmatter.

---

## Output

16. **Convert drafts to .docx.** Run the docx converter:

    ```powershell
    python "{WORKSPACE_ROOT}/incident-doc-gap/scripts/convert-drafts-to-docx.py" "{runDir}/doc-fix-drafts"
    ```

17. **Generate the Doc Gap Report.** Run the report generator:

    ```powershell
    python "{WORKSPACE_ROOT}/incident-doc-gap/scripts/generate-report.py" --period "{Mon}-{Mon} {Year}" --start "{startDateUtc}" --end "{endDateUtc}" --data-dir "{runDir}" --output-dir "{runDir}"
    ```

18. **Purge intermediate files.** Delete from `{runDir}`:
    - `classified-incidents.json`
    - `taxonomy-snapshot.yml`
    - `incident-ids.txt`

    Final deliverables in `{runDir}`: report .docx, JSONL, effectiveness-eval.json, run-status.json, and `doc-fix-drafts/`.

19. **Update run status.** Set `completedAt` in the analyze workflow entry and print a completion summary.

⏸️ **Human interaction (post-workflow):** The human reviews the report and all drafts before triggering publish.
