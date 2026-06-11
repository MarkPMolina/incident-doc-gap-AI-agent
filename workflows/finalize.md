# Incident Doc Gap Finalize Workflow

## Error Handling — Halt on Failure

**Every step in this workflow is sequential and assumes the previous step succeeded.** If any step fails (access denied, file not found, validation failure, merge conflict, etc.):

1. **Stop immediately.** Do not continue to the next step.
2. **Print a clear error message** explaining what failed, which step it occurred in, and any relevant error details.
3. **Suggest remediation** if possible.
4. **Do not retry automatically.** Wait for the user to resolve the issue and explicitly re-run.

---

This workflow is triggered **after** the tech review period has ended (typically 5 business days after publishing). It incorporates reviewer feedback from the shared drafts into the documentation branch, creates a PR, and requests approval.

## Prerequisites

- The publish workflow has already been run on this run (`reportStatus` is `published`)
- The tech review period has elapsed
- The documentation branch exists on the remote (pushed during publish)

## Step 1 — Identify the run and branch

1. Read config from the agent's configuration file.
2. List all run folders in `incident-doc-gap/runs/` sorted descending. For each, read `run-status.json` and display:

   ```
   Available runs:
     [1] 20260601-093000 — Status: published | May 1 – Jun 1 | 12 drafts
     [2] 20260415-140000 — Status: published | Apr 1 – Apr 15 | 8 drafts
   ```

   Only show runs whose `reportStatus` is `"published"`. Do not show runs already at `"pr_created"` or `"docs_merged"`.

   **Also handle "mark merged" requests:** If the user says "the PR merged" or "mark merged", show runs whose `reportStatus` is `"pr_created"`, then skip to the "Marking Docs Merged" section below.

3. **Wait for user selection.** Do not auto-select.
4. Define `{runDir}` = the selected run folder.
5. Read the `prBranch` field from the publish entry in `run-status.json`.
6. Verify the branch exists locally. If not, fetch and check it out.

## Step 2 — Retrieve feedback from shared drafts

1. Download each `.docx` draft from the shared document site subfolder.
2. Extract all inline comments (annotations) from each document.
3. For each comment, capture: the commented text (anchor), the comment body (feedback), the author.
4. Print a summary: number of comments per file, total comments found.
5. If zero comments, ask whether to proceed (mark PR ready with no changes) or stop.

## Step 3 — Incorporate feedback and validate

For each actionable comment:

1. Locate the corresponding section in the `.md` source file on the PR branch.
2. Apply the change (fix wording, add missing info, correct technical details).
3. If a comment is unclear or contradicts other feedback, flag it for the user and stop.

**Run validation unconditionally** (even if zero comments):

1. Run documentation repo validation (linting, ToC checks).
2. If validation fails, fix the issues before proceeding.

## Step 4 — Commit and push

1. Stage all modified `.md` files.
2. Commit with message: `Incorporate tech review feedback for {Mon}-{Mon} {Year} doc gap drafts`
3. Push the branch to the remote.

## Step 5 — Create PR (ready for review)

1. Create a PR targeting `master` from the branch, directly as **ready for review** (not draft).
2. Store the PR URL as `prUrl` in `run-status.json`.
3. Print the PR URL and confirm it's ready.

## Step 6 — Wait for clean build

⏸️ **Human interaction point.** The PR's CI pipeline must pass before requesting team review.

1. Inform the user: "The PR is created. Please check the build status. Once it builds cleanly, confirm here so I can post the approval request."
2. **Wait for user confirmation.**
3. If build errors are reported, work with the user to fix, push a new commit, and repeat.

## Step 7 — Post PR approval request

Post a message to the team channel asking for review and approval.

## Step 8 — Update status

Update `run-status.json`:
- Set `reportStatus` to `"pr_created"`
- Add completion timestamp to the finalize workflow entry

---

## Marking Docs Merged

After the PR merges, the user says "mark merged":

1. Verify the PR state shows as merged.
2. Advance `reportStatus` to `"docs_merged"`.
3. Re-upload the updated report to the shared document site (status now shows "Docs Merged").
4. Print confirmation: the date boundary has advanced — the next analysis cycle will start from this run's end date.
