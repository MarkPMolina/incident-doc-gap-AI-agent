# Sub-Agent: validator-cmdlet

Verifies that every PowerShell cmdlet, function, or tool name referenced in drafted documentation actually exists. **Mutating editor** — removes or rewrites content containing hallucinated cmdlets directly in the draft files.

## Input

- One or more draft markdown files (from `{runDir}/doc-fix-drafts/`)
- Access to documentation repository (`{DOCS_REPO_ROOT}/`)
- Access to source code repository (`{SOURCE_REPO_ROOT}/`)

## Actions (not reports)

This agent edits files. It does NOT produce JSON artifacts or structured output files.

For each hallucinated cmdlet found:
- **Supplemental check** (e.g., "optionally verify by running X") → delete that step; renumber remaining steps.
- **Core resolution step** (the fix depends on this cmdlet, no verified alternative exists) → delete the resolution steps that use it. Keep the scenario's symptom/cause and replace with generic guidance or escalation note.
- **Entire scenario depends on hallucinated cmdlet** → delete the scenario from the draft. If the draft becomes empty, delete the file.

## Method

1. **Extract cmdlet/tool names from the draft.** Identify anything matching:
   - PowerShell `Verb-Noun` naming pattern (e.g., `Get-AccessRequest`, `Set-RoleConfig`)
   - Known tool names used in resolution steps (e.g., `certutil`, `klist`, `dsregcmd`)
   - Function names in code blocks that aren't standard language constructs

2. **Verify each cmdlet against three sources** (a single hit in ANY source is sufficient):
   - **Documentation repo**: The cmdlet is documented in `docs_external/` or `docs_internal/`. Search filenames and file content.
   - **Source code**: The cmdlet/function exists in the source repository. Search for function definitions, cmdlet registrations, or help comments.
   - **Standard tooling**: It's a built-in Windows/PowerShell cmdlet (e.g., `Test-NetConnection`, `certutil`, `Get-ChildItem`, `Restart-Service`).

3. **For hallucinated cmdlets, edit the draft immediately** per the pruning rules above.

## Output

Print a brief summary when done (for the orchestrator's log):

```
Cmdlet Verification Complete
═══════════════════════════════════════════
auth-token-errors.md    │ 6 verified, 1 hallucinated (Clear-TokenCache → step removed)
remote-access.md        │ 4 verified, 0 hallucinated
deployment-pipeline.md  │ 3 verified, 2 hallucinated → scenario deleted, file deleted
═══════════════════════════════════════════
```

## Constraints

- Do NOT assume a cmdlet exists because it "sounds right" or follows naming conventions. Verify against actual sources.
- Do NOT use intermediate JSON files for context about what the draft "should" contain.
- Do NOT verify standard well-known OS commands (cd, mkdir, echo) — only PowerShell cmdlets and domain-specific tools.
