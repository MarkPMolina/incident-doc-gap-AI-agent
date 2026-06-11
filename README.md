# Incident Documentation Gap Analysis Agent

An AI agent system for analyzing support incidents filed against infrastructure teams, identifying documentation gaps, and producing actionable reports with draft fixes.

> **Note:** Architecture inspired by work on internal incident management tooling. All proprietary content has been removed and replaced with generic examples.

## Overview

This agent automates a three-phase workflow:

1. **Analyze** — Query your incident management system for incidents across configured teams. Extract structured data with full DLP sanitization, classify all incidents into themes via a living taxonomy (with automated quality gate), evaluate each signal incident through 3 evaluator agents (operator, engineer, doc-author) using an evidence-facet architecture, classify gap types via deterministic decision table, produce draft fixes (standalone or augmentation patches), validate through 5 layers (overlap, clarity, cmdlet verification, instruction verification, evaluation), and generate a Doc Gap Report.

2. **Publish** — After human review and approval, push doc fixes to a documentation branch, upload everything to your team's shared document site, and post tech review requests. No PR is created at this stage.

3. **Finalize** — After the tech review period (5 business days), incorporate inline feedback from shared drafts into the branch, create a PR directly in "ready for review" state, and request approval.

### Architecture

The analyze workflow uses **sub-agents** for complex steps — their definitions live in `workflows/agents/` and are executed inline by the orchestrator (`analyze.md`):

| Sub-Agent | Phase | Purpose |
|-----------|-------|---------|
| `taxonomy-updater` | Classification | Proposes taxonomy changes (new themes, merges, splits, deprecations); pauses for user confirmation |
| `doc-coverage-scanner` | Classification | Searches documentation repo for existing content per theme; establishes baseline coverage (full/partial/none) before per-incident evaluation |
| `evaluator-operator` | Classification | Produces user-journey evidence: what did the user need, would they find docs? |
| `evaluator-engineer` | Classification | Produces resolution-mechanics evidence: what fixed it, could user self-resolve? |
| `evaluator-doc-author` | Classification | Produces content-coverage evidence: do docs exist, how complete are they? |
| `validator-overlap` | Validation | Assesses overlap at **resolution level**; deletes/rewrites drafts; emits micro-patches for unique error strings |
| `validator-cmdlet` | Validation | Verifies all cmdlet/tool references against documentation + source code |
| `validator-grounding` | Validation | Fact-checks target paths, headings, UIDs, and procedural claims |
| `validator-effectiveness` | Validation | Looks up motivating incidents via API; appends `## Reviewer Evaluation` verdicts |

**Evaluators** run in parallel per incident, producing structured evidence facets. The orchestrator applies a deterministic decision table to classify each incident into one of 6 gap types: `real_doc_gap`, `partial_doc_gap`, `discoverability_problem`, `engineering_fix`, `operational_gap`, `no_doc_action_needed`.

**Validators** are independent **mutating editors** — they modify/delete draft files directly. They have NO access to intermediate analysis artifacts (JSONL, classification JSONs) to prevent author-bias. They verify only against authoritative sources. Overlap is assessed at the resolution level: a new error string does NOT make a scenario "new" if the fix is already documented.

### Report Lifecycle

| State | Set by | Meaning |
|-------|--------|---------|
| `analyzed` | analyze | Report generated, awaiting human review |
| `published` | publish | Branch pushed, drafts on shared site, tech review requested |
| `pr_created` | finalize | PR created and ready for review |
| `docs_merged` | user via finalize ("mark merged") | PR merged into docs repo master |

Only `docs_merged` advances the date boundary for the next analysis cycle.

## Installation

```powershell
# Clone this repo into your workspace
git clone <your-repo-url> incident-doc-gap

# Run the installer
cd incident-doc-gap
.\setup.ps1
```

This installs:
- Agent files to your AI assistant's agents directory
- Creates memory directory for persistent configuration
- Creates `runs/` directory for per-run output

## Configuration

After installation, the agent's first-run setup will prompt you for:

- Documentation repo location (`{DOCS_REPO_ROOT}`)
- Source code repo location (`{SOURCE_REPO_ROOT}`)
- Workspace root (`{WORKSPACE_ROOT}`)
- Incident API server path (`{INCIDENT_API_SERVER_PATH}`)
- Shared document site URL (`{SHAREPOINT_URL}`)

See `memory/config.template.md` for the full configuration schema.

## Key Design Principles

### Validators are mutating editors, not reporters

Validation agents directly modify and delete draft files. They don't produce JSON artifacts or structured reports — the post-validation state of `doc-fix-drafts/` IS the source of truth. JSON artifacts for the report are generated AFTER validation from whatever survives.

### Information isolation prevents author-bias

Validators have NO access to intermediate analysis data (JSONL, classified-incidents.json, classification-results.json). They verify against authoritative sources only (documentation repo, source code). This ensures independent assessment — the validator can't be "primed" by seeing what the earlier classification step thought.

### Resolution-level overlap assessment

The overlap validator doesn't match by topic or error string. It identifies the exact resolution action each draft recommends and searches for that same action in existing docs. A new error string alone does NOT make content "new" if the fix is already documented.

### Content gates prevent placeholder drafts

The drafting step must not create files without real resolution steps. No templates, no "insert content here," no stubs. If there isn't enough signal to draft real content, no file is created.

### Heading anchors only, never line numbers

All patch insertion instructions use heading-relative positioning (e.g., "Insert at: End of `## Common issues`"). This ensures multiple patches targeting the same page don't drift when applied.

## Usage

From your AI assistant CLI:

```
@incident-doc-gap           # Help and overview
@incident-doc-gap-analyze   # Run a new analysis
@incident-doc-gap-publish   # Publish an approved report
@incident-doc-gap-finalize  # Incorporate feedback and submit PR
```

### First Run

On first use, the analyze workflow will prompt you for workspace paths. These are saved to persistent configuration and reused for all future runs.

## Prerequisites

### API Access

The agents require access to your incident management system's API (authenticated).

### Tools

- **Node.js 18+** — runs extraction, classification, and evaluation scripts (no npm packages needed — all use native `fs`/`path`)
- **Python 3** with `python-docx` and `pyyaml` packages
- **pandoc** (for markdown → docx conversion)
- **CLI authentication** to your incident management API

### Scripts

The pipeline is orchestrated by the workflow prompt (`workflows/analyze.md`) which calls these scripts in sequence:

| Script | Step | Purpose |
|--------|------|---------|
| `fetch-incident-details.js` | 2 | Batch-fetches full incident details from incident API (sequential with retry/resume) |
| `extract-filter-sanitize.js` | 3 | Applies noise-filtering rules R1–R5 deterministically, DLP-sanitizes all text fields, outputs JSONL |
| `classify-themes.js` | 8 | Two-pass context-weighted classification (title +3, symptom +2, secondary +1) with exclusion suppression. Runs automated quality gate |
| `evaluate-gaps.js` | 9 | Heuristic 3-evaluator system + deterministic decision table. Produces theme rollup and avoidable estimates |
| `convert-drafts-to-docx.py` | 16 | Converts `.md` drafts to `.docx` with clickable incident hyperlinks and nested fence unwrapping |
| `generate-report.py` | 17 | Reads JSON artifacts and produces the final Doc Gap Report `.docx` with hyperlinked incidents, bookmarked themes, priority matrix |
| `post-review-requests.ps1` | Publish | Posts tech review requests to team channels (topic-based routing) |

#### Report Generator Usage

```powershell
python scripts/generate-report.py `
  --period "May-Jun 2026" `
  --start "2026-05-13" --end "2026-06-10" `
  --data-dir "path/to/run/folder" `
  --output-dir "path/to/run/folder"
```

Requires `theme-summary.json`, `gap-classification.json`, `priority-matrix.json`, and the JSONL file in `--data-dir`.

## Folder Structure

```
incident-doc-gap/
├── data/
│   └── theme-taxonomy.yml              # Canonical theme codebook (living document)
├── docs/
│   └── architecture-walkthrough.md     # Architecture & decision walkthrough
├── example-run/                        # Sanitized example pipeline output
│   ├── run-status.json
│   ├── classification-results.json
│   ├── priority-matrix.json
│   ├── theme-summary.json
│   ├── doc-fix-drafts/
│   └── theme-icms/
├── memory/
│   └── config.template.md              # Config template
├── scripts/
│   ├── fetch-incident-details.js       # Batch-fetch full incident details (retry/resume)
│   ├── extract-filter-sanitize.js      # Noise filtering (R1-R5) + DLP sanitization
│   ├── classify-themes.js              # Two-pass theme classification + quality gate
│   ├── evaluate-gaps.js                # 3-evaluator gap classification + decision table
│   ├── convert-drafts-to-docx.py       # .md→.docx with incident hyperlinks + fence unwrap
│   ├── generate-report.py              # .docx report from JSON artifacts
│   └── post-review-requests.ps1        # Team tech review posting script
├── runs/                               # Per-run output (gitignored)
│   └── {YYYYMMDD-HHMMSS}/             # Timestamped run folder
├── workflows/
│   ├── analyze.md                      # Analysis workflow (19 steps)
│   ├── publish.md                      # Publish workflow (10 steps)
│   ├── finalize.md                     # Finalize workflow (8 steps + mark-merged)
│   └── agents/                         # Sub-agent definitions
│       ├── taxonomy-updater.md
│       ├── doc-coverage-scanner.md
│       ├── evaluator-operator.md
│       ├── evaluator-engineer.md
│       ├── evaluator-doc-author.md
│       ├── validator-overlap.md
│       ├── validator-cmdlet.md
│       ├── validator-grounding.md
│       └── validator-effectiveness.md
├── setup.ps1                           # Installer
└── README.md                           # This file
```

## Workflow Details

### Analyze Workflow (19 steps)

**Pass 1 — Data Extraction**

1. Resolves date range from the latest `docs_merged` report (local runs first, shared site fallback, prompt only if nothing exists)
2. Queries incident system for all incidents (paginated) across configured teams
3. Extracts structured fields, classifies signal vs. noise, applies DLP sanitization to ALL text fields
4. Saves extraction as JSONL
5. Validates counts and proceeds to Pass 2

**Pass 2 — Analysis & Classification**

6. Reads the frozen JSONL dataset
7. Updates/builds the theme taxonomy via `taxonomy-updater` sub-agent
   - ⏸️ **Human interaction:** If taxonomy changes are proposed, the agent presents them and waits for user confirmation
8. Classifies ALL incidents into themes (signal + noise). Automated quality gate checks for ambiguity (≥10%), unclassified rate (>20%), and concentration (>50%) — loops back to taxonomy-updater if breached
9. Classifies gap type per signal incident via 3 evaluator agents + deterministic decision table
   - ⏸️ **Human interaction:** Any incidents classified as `human_review` are presented to the user

**Drafting & Validation**

10. Drafts doc fixes — two types: `augmentation_patch` (content merged into existing pages) and `standalone` (new pages). Content gate: no file is created without real resolution steps
11. Overlap validation — spawns fresh `validator-overlap` agent (no access to analysis artifacts). Assesses at **resolution level**
12. Clarity pass — auto-revises prose quality (constrained: no technical content changes)
13. Cmdlet verification — spawns fresh `validator-cmdlet` agent; confirms all referenced cmdlets exist in docs + source; prunes hallucinated ones
14. Grounding verification — spawns fresh `validator-grounding` agent; fact-checks target paths, headings, UIDs, and procedural claims
15. Effectiveness evaluation — spawns fresh `validator-effectiveness` agent; looks up motivating incidents via API; appends `## Reviewer Evaluation` verdict

**Output**

16. Converts markdown drafts to `.docx` via pandoc
17. Generates the Doc Gap Report from post-validation state
18. Purges intermediate files. Final deliverables: report .docx, JSONL, effectiveness-eval.json, run-status.json, and doc-fix-drafts/
19. Updates `run-status.json` with completion timestamp

⏸️ **Human interaction (post-workflow):** The human reviews the report and all drafts before triggering publish.

### Publish Workflow (10 steps)

1. Identifies the approved report and draft fixes from a completed run
2. ⏸️ **Dry-run confirmation** — prints a summary of all planned actions and waits for user approval
3. Creates a documentation branch and pushes doc fixes (reviewer-only content stripped; augmentation patches applied to target files; standalones have metadata stripped)
4. Uploads draft `.docx` files to shared document site subfolder with edit permissions
5. Updates the report's draft links to point to shared URLs
6. Uploads the final report to shared document site
7. Posts tech review requests to team channels (topic-based routing)
8. Creates calendar reminder (5 business days) to incorporate feedback
9. Marks the report as "Published" — only after all prior steps succeed
10. Stores branch name in `run-status.json` for finalize's use

### Finalize Workflow (8 steps + mark-merged)

1. Lists eligible runs (`published` status) and prompts user to select one
2. Retrieves inline comments from shared drafts
3. Incorporates actionable feedback into the branch `.md` files; runs validation unconditionally
4. Commits and pushes changes
5. Creates PR directly in "ready for review" state
6. ⏸️ **Waits for user to confirm build is green**
7. Posts PR approval request to team channel
8. Updates status to `pr_created`

**Mark Merged:** After the PR merges, user says "mark merged" → agent verifies PR state → advances to `docs_merged` → re-uploads report.

### Human Interaction Points (all workflows)

| Workflow | Step | Gate |
|----------|------|------|
| Analyze | 7 | Taxonomy change confirmation |
| Analyze | 9 | Human-review incident classification |
| Analyze | Post | Report/draft review before publish |
| Publish | 2 | Dry-run confirmation |
| Finalize | 1 | Run selection |
| Finalize | 3 | Ambiguous/contradictory feedback |
| Finalize | 6 | Build status confirmation |
| Finalize | Mark merged | PR merge confirmation |

## Further Reading

- See `docs/architecture-walkthrough.md` for a detailed explanation of how the system works, including traced walkthroughs of fictional incidents through the pipeline.
- See `example-run/` for actual pipeline output artifacts (sanitized).
