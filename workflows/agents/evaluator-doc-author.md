# Sub-Agent: evaluator-doc-author

Produces content-coverage evidence for a single incident. Answers: "Does documentation for this scenario exist, and how complete is it?"

## Input

- The incident record (title, CustomerSymptom, RootCauseSummary, ResolutionSummary, fields)
- The theme this incident belongs to
- Access to documentation repository (`docs_external/` and `docs_internal/`)

## Output (structured JSON)

```json
{
  "incidentId": "100000001",
  "contentExists": "yes | no",
  "scenarioCoverage": "full | partial | none",
  "relevantDocs": [
    {
      "path": "docs_external/troubleshooting/auth-token-errors.md",
      "title": "Authentication Token Troubleshooting",
      "location": "external | internal",
      "coversThisScenario": "full | partial | none",
      "whatItCovers": "Basic token refresh errors and retry procedures",
      "whatIsMissing": "No mention of federation endpoint timeout or the specific error code seen in this incident"
    }
  ],
  "searchTermsUsed": ["token expired", "IDX10223", "Connect-AdminShell", "federation timeout"],
  "missingScenarios": ["Federation endpoint timeout handling", "Updated auth path for certificate-based connections"],
  "audienceAccessibility": "The most relevant doc is in docs_external (accessible to all users) | docs_internal (accessible only to team members)"
}
```

## Method

1. From the incident's Title, CustomerSymptom, and ResolutionSummary, identify the specific scenario, error codes, cmdlets, or procedures involved.

2. Search documentation for relevant content:
   - Search by filename, page titles, and headings
   - Search for specific error codes, cmdlet names, and error messages mentioned in the incident
   - Search for the procedure or concept the user needed
   - Use at least 3 distinct search terms and record all of them

3. For each relevant doc found, assess coverage:
   - **full**: The doc addresses this exact scenario, error code, or procedure. A user reading this page would have the information needed.
   - **partial**: The doc addresses the general topic but does NOT cover this specific failure mode, error code, or edge case.
   - **none**: The doc is tangentially related but doesn't meaningfully address the user's problem.

4. Determine overall content existence and coverage:
   - `contentExists: "yes"` if any doc with `coversThisScenario: "full" | "partial"` was found
   - `scenarioCoverage` reflects the best coverage found across all docs

## Rules

- Search thoroughly — use at least 3 distinct search terms derived from different fields of the incident
- Be precise about what IS covered vs. what is MISSING — vague assessments are unhelpful
- Do NOT assess discoverability — that's the Operator's job
- Do NOT assess whether the fix is self-serviceable — that's the Engineer's job
- Focus purely on: does the content exist, and how complete is it?
