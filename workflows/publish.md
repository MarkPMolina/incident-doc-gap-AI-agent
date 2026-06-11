# Incident Doc Gap Publish Workflow

## Error Handling — Halt on Failure

**Every step in this workflow is sequential and assumes the previous step succeeded.** If any step fails (API error, access denied, file not found, validation failure, etc.):

1. **Stop immediately.** Do not continue to the next step.
2. **Print a clear error message** explaining what failed, which step it occurred in, and any relevant error details.
3. **Suggest remediation** if possible.
4. **Do not retry automatically.** Wait for the user to resolve the issue and explicitly re-run the workflow.

## Resumability — Skip Completed Steps on Rerun

If publish is rerun after a mid-workflow failure, **check `run-status.json` for a partial `publish` entry** with per-step completion markers. Skip steps whose artifacts already exist:

| Step | How to detect prior completion |
|------|-------------------------------|
| 3 (Branch) | `publish.prBranch` is set AND branch exists on remote |
| 4 (Shared site drafts) | `publish.sharedDraftUrls` is non-empty |
| 5 (report links) | Report `.docx` hyperlinks already point to shared URLs |
| 6 (Shared site report) | `publish.reportUrl` is set |
| 7 (Team notification) | `publish.notificationIds` is non-empty |
| 8 (reminder) | `publish.calendarEventId` is set |

When skipping a step, print: `⏭️ Step {N} — already completed (reusing {artifact})`

---

This workflow is triggered **after** a Doc Gap Report and its associated doc fix drafts have been reviewed, approved, and are ready to publish. It handles:

1. Publishing doc fix drafts to the documentation repo (via branch)
2. Marking the report as "Published"
3. Uploading the report and drafts to the shared document site for team access
4. Posting tech review requests to team channels

## Prerequisites

- A completed analyze run in `incident-doc-gap/runs/{timestamp}/` containing:
  - A Doc Gap Report (`.docx`)
  - Doc fix drafts in a `doc-fix-drafts/` subfolder
  - A `run-status.json` with `"analyze"` in its workflows list
- The user has confirmed which drafts are approved for publishing

## Step 1 — Identify the run and drafts

1. List all run folders in `incident-doc-gap/runs/` sorted descending. For each, read `run-status.json` and display a summary:

   ```
   Available runs:
     [1] 20260601-093000 — Analyze ✓ | May 1 – Jun 1 | 12 drafts
     [2] 20260515-140000 — Analyze ✓, Publish ⚠️ (in_progress — resumable) | May 1 – May 15 | 8 drafts
   ```

   Only show runs whose `reportStatus` is `"analyzed"`, OR runs that have a publish workflow entry with `"status": "in_progress"` (resumable). If only one eligible run exists, present it and ask for confirmation. If none exist, stop and inform the user.

2. **Wait for user selection.** Do not auto-select.
3. Define `{runDir}` = path to the selected run folder.
4. List all `.md` draft files. Confirm with the user which drafts are approved for publishing (all, or a subset).

## Step 2 — Dry-run confirmation

Before any mutations, print a summary of everything that will happen:

```text
╔═══════════════════════════════════════════════════════╗
║  PUBLISH PLAN                                         ║
╠═══════════════════════════════════════════════════════╣
║  Run:        {runDir timestamp}                       ║
║  Date range: {Mon DD} – {Mon DD, YYYY}                ║
║  Drafts:     {N} approved                             ║
╠═══════════════════════════════════════════════════════╣
║  Actions:                                             ║
║  1. Push docs branch                                  ║
║     Branch: u/{alias}/doc-gap-fixes-{mon}-{mon}-{yr}  ║
║  2. Upload {N} draft .docx to shared site             ║
║  3. Update report links → shared URLs                 ║
║  4. Upload report to shared site                      ║
║  5. Post tech review to team ({N} channels)           ║
║  6. Set feedback reminder ({date})                    ║
║  7. Mark report as "Published"                        ║
╚═══════════════════════════════════════════════════════╝

Proceed? [Y/n]:
```

**Do NOT proceed without explicit user confirmation.**

## Step 3 — Push doc fixes to documentation branch

1. **Create a branch** in the documentation repo:
   ```
   u/<alias>/doc-gap-fixes-{mon}-{mon}-{year}
   ```

2. **Strip reviewer-only content from approved drafts.** Before processing, remove all reviewer-only material from each approved `.md` draft:
   - Delete everything from `<!-- REVIEWER ONLY: remove before publishing -->` through the end of the `## Reviewer Evaluation` section.
   - Remove the `evaluation:` block from YAML frontmatter if present.
   - **Validation:** After stripping, verify that no approved draft still contains `REVIEWER ONLY` or `## Reviewer Evaluation`.

3. **Branch on draft type.** Read the `draft_type` field from each draft's YAML frontmatter:

   ### 3a — Standalone drafts (`draft_type: standalone`)

   1. Read `target_location` from frontmatter — directory (relative to `{DOCS_REPO_ROOT}`) for placement.
   2. Read `toc_parent` — the `toc.yml` that should reference the new file.
   3. **Strip pipeline metadata** — remove all fields from YAML frontmatter except `uid`.
   4. Copy the cleaned draft into `{DOCS_REPO_ROOT}/{target_location}`.
   5. Add an entry in the appropriate `toc.yml`.

   ### 3b — Augmentation patches (`draft_type: augmentation_patch`)

   1. **Collect patches per target.** Group all patch files by `augments.target_path`.
   2. Verify each target file exists.
   3. **Flatten all patch blocks** — collect every `### Patch N` block with its `**Insert at:**` instruction.
   4. **Sort patches by target position (top-down)**, apply in **reverse order** (bottom-up) to avoid drift.
   5. Apply each patch based on its insertion directive (after heading, end of section, beginning of section).
   6. **Validate** — verify no content was inserted inside fenced code blocks or YAML frontmatter.

4. **Run documentation validation** on all modified and new files.

5. **Commit and push** the branch. Do NOT create a PR — the PR is created by the finalize workflow.

## Step 4 — Upload doc fix drafts to shared document site

1. Create a subfolder named `Doc Fix Drafts {Mon}-{Mon} {Year}`.
2. Upload the `.docx` versions of each approved draft.

## Step 5 — Update report draft links

Replace local file references in the report with URLs pointing to the shared document site copies.

## Step 6 — Upload the report

Upload the final report `.docx` to the shared document site root folder.

## Step 7 — Post tech review requests

Post a batched message per team channel with a table of drafts (linked title + summary + incident count). Include:
- Date range of the analysis
- Review deadline (5 business days)
- Instructions to add feedback as document comments

## Step 8 — Set feedback reminder

Create a calendar reminder for 5 business days from now to incorporate feedback.

## Step 9 — Mark report as published

Update `run-status.json`:
- Set `reportStatus` to `"published"`
- Add completion timestamp to the publish workflow entry
- Store branch name for finalize's use

## Step 10 — Store branch name

Store the documentation branch name in `run-status.json` as `publish.prBranch` for the finalize workflow to use.
