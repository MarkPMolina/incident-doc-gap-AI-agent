# Sub-Agent: doc-coverage-scanner

Assesses documentation coverage for a single theme by searching the documentation repository. One instance is spawned per theme, running in parallel.

## Input

- The theme's `slug`, `display_name`, and `matching_signals` (from taxonomy)
- The list of signal incident titles and error messages for this theme (for targeted searching)
- Access to documentation repository (`{DOCS_REPO_ROOT}/docs_external/` and `docs_internal/`)

## Output (structured JSON)

```json
{
  "theme": "authentication-failures",
  "coverage": "full | partial | none",
  "relevantDocs": [
    {
      "path": "docs_external/troubleshooting/auth-token-errors.md",
      "title": "Authentication Token Troubleshooting",
      "uid": "auth-token-troubleshooting",
      "location": "external | internal",
      "coversSummary": "Covers basic token refresh errors and credential rotation procedures"
    }
  ],
  "coveredScenarios": [
    "Basic token refresh failures",
    "Credential rotation prerequisites"
  ],
  "uncoveredScenarios": [
    "Federation endpoint timeout handling",
    "Certificate chain validation errors in isolated environments"
  ],
  "searchTermsUsed": ["authentication failure", "token expired", "Connect-AdminShell", "IDX10223"],
  "notes": "Optional free-text for edge cases or caveats"
}
```

## Method

1. **Build search terms** from the theme's `matching_signals`:
   - All cmdlet names (exact match)
   - All error message strings (partial match)
   - Key component and keyword terms
   - Additionally, extract distinctive error messages and cmdlet names from the theme's incident titles

2. **Search documentation** using each search term:
   - Search file names and paths (glob)
   - Search page titles and headings (grep for `# ` lines)
   - Search page content for error codes, cmdlet references, and key phrases
   - Search both `docs_external/` and `docs_internal/`
   - Use at least 5 distinct search terms across different signal types

3. **For each relevant page found**, read the page content to understand:
   - What scenarios does it cover?
   - Does it address the specific error codes seen in this theme's incidents?
   - Does it provide actionable resolution steps (not just conceptual overview)?

4. **Assess overall coverage**:
   - **full**: Existing docs address ≥80% of the scenarios seen in this theme's incidents
   - **partial**: Some scenarios are documented but significant gaps exist
   - **none**: No existing documentation meaningfully addresses this theme's scenarios

## Constraints

- Do NOT assess gap type or recommend actions — that's the evaluators' job
- Focus purely on what documentation exists and what it covers
- Search thoroughly — use at least 5 distinct search terms
- Report only pages with genuine relevance (not tangentially related content)
