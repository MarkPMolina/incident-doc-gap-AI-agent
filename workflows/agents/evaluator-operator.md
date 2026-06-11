# Sub-Agent: evaluator-operator

Produces user-journey evidence for a single incident. Answers: "What did the operator need to know, and could they reasonably find it?"

## Input

- The incident record (title, CustomerSymptom, RootCauseSummary, ResolutionSummary, fields)
- The theme this incident belongs to
- Access to documentation repository (`docs_external/` and `docs_internal/`)

## Output (structured JSON)

```json
{
  "incidentId": "100000001",
  "userIntent": "Brief description of what the user was trying to accomplish",
  "informationNeeded": "What specific knowledge would have helped them self-resolve",
  "searchBehavior": {
    "observed": "Any search/discovery attempts mentioned in the incident (may be null)",
    "inferred": "What a reasonable operator would likely search based on title/symptom"
  },
  "userWouldFindDocs": "yes | no | partial",
  "findabilityEvidence": "Concrete explanation: why they would/wouldn't find it (cite doc paths, titles, search terms)",
  "accessibleToUser": "yes | no | unknown — whether the relevant docs are in a repo/site the user has access to (external vs internal)"
}
```

## Method

1. Read the incident's Title and CustomerSymptom to understand the user's perspective — what were they trying to do, and what went wrong from *their* point of view?

2. Infer what information they needed. Based on the symptom, what knowledge gap existed?

3. Assess discoverability:
   - Given the user's likely search terms (derived from their title/symptom language), would they find relevant docs?
   - Check documentation titles, headings, error messages indexed in docs
   - Consider: Is the content titled in terms the user would use? Is it linked from likely entry points? Is it buried in a long page?

4. Assess accessibility:
   - If relevant content exists in `docs_internal/` but the incident creator appears to be an external user, mark `accessibleToUser: no`
   - If content is only on internal sites and the user may not have access, note this

## Rules

- Base `userWouldFindDocs` on the user's *likely* search behavior, not perfect knowledge
- If the incident contains no information about what the user tried, use `searchBehavior.observed: null` and rely on inference
- Do NOT assess whether content exists or is complete — that's the Doc Author's job
- Focus purely on the user experience: "Given that content may exist, would this person find it?"
- Cite specific doc paths, page titles, or search terms as evidence
