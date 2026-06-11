# Architecture & Decision Walkthrough

## System Overview

An AI-powered multi-agent pipeline that analyzes support incidents filed against infrastructure teams, identifies documentation gaps, and produces publication-ready documentation fixes — all with human oversight at critical decision points.

The system processes hundreds of incidents per cycle, classifying each through parallel evaluator agents, applying a deterministic decision table, drafting fixes, and validating them through 5 independent validator agents before generating a formatted report.

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌───────────┐
│  Incident   │────▶│  Extraction  │────▶│  Taxonomy   │────▶│ Classify  │
│   API       │     │  + DLP       │     │  Updater    │     │  Themes   │
└─────────────┘     └──────────────┘     └──────────────┘     └─────┬─────┘
                                                                     │
┌─────────────────────────────────────────────────────────────────────┘
│
▼
┌───────────────────────────────────────────────┐
│  3 EVALUATOR AGENTS (parallel per incident)   │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Operator │ │ Engineer │ │  Doc Author  │  │
│  │(findable?)│ │ (fix?)   │ │(exists?)     │  │
│  └────┬─────┘ └────┬─────┘ └──────┬───────┘  │
│       └─────────────┼──────────────┘          │
│                     ▼                         │
│         ┌─────────────────────┐               │
│         │  DECISION TABLE     │               │
│         │  (deterministic)    │               │
│         └──────────┬──────────┘               │
└────────────────────┼──────────────────────────┘
                     │
                     ▼
┌───────────────────────────────────────────────┐
│  DRAFTING (content-gated)                     │
│  → standalone pages | augmentation patches    │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│  5 VALIDATOR AGENTS (sequential, mutating)    │
│  ┌─────────┐ ┌───────┐ ┌──────┐ ┌─────────┐ │
│  │ Overlap │ │Clarity│ │Cmdlet│ │Grounding│ │
│  └────┬────┘ └───┬───┘ └──┬───┘ └────┬────┘ │
│       └───────────┴────────┴──────────┘      │
│                    ▼                          │
│         ┌─────────────────────┐              │
│         │  Effectiveness      │              │
│         │  (skeptical judge)  │              │
│         └─────────────────────┘              │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │  REPORT + DOCX   │
              │  (final output)  │
              └──────────────────┘
```

## Key Design Decisions

### Why multi-agent evaluation (not single-pass)?

A single LLM pass conflates three distinct questions: "Would the user find docs?", "Could they self-resolve?", and "Do docs already exist?" By splitting these into three specialized evaluators, each produces a focused evidence facet with a single axis of judgment. The orchestrator combines these mechanically via a decision table — no LLM judgment at the classification step. This produces consistent, auditable classifications.

### Why evidence-facet architecture (structured reasoning)?

Each evaluator outputs a JSON evidence facet with specific fields (not free-text opinions). This means:
- The decision table operates on discrete values (`userWouldFindDocs: "yes" | "no" | "partial"`)
- Disagreements are visible and traceable (you can see exactly which evaluator said what)
- The system can explain every classification decision by pointing to the evidence

### Why validators are mutating editors with information isolation?

Validators directly modify files rather than producing advisory reports because:
1. **No "recommendation fatigue"** — the system acts on its findings, not just reports them
2. **Information isolation** — validators have NO access to intermediate analysis (JSONL, evaluator output). They verify against authoritative sources only. This prevents confirmation bias — the validator can't be "primed" by seeing what the analysis thought.
3. **Composable pipeline** — each validator's output is the next validator's input. The final state of `doc-fix-drafts/` IS the validated result.

### Why resolution-level overlap (not topic-level)?

A naive overlap check would say "we already have a page about authentication" and delete the draft. But the draft might document a *specific resolution* (clear token cache after cert rotation) that doesn't appear anywhere in the existing auth page. The overlap validator identifies the **exact resolution action** each draft recommends and searches for *that same action* in existing docs. A new error string alone doesn't make a scenario "new" if the fix is already documented.

### Why content gates (no placeholder drafts)?

Early iterations produced stub documents ("INSERT CONTENT HERE", template structures without actual steps). These wasted validator time and polluted the report. The content gate ensures no file is created without real resolution steps — if there isn't enough signal in the incidents to write actionable content, the system correctly produces nothing rather than placeholder.

## Pipeline Stages (reference)

| Stage | Input | Output | Agent/Script |
|-------|-------|--------|-------------|
| 1. Extract | Incident API | JSONL (DLP-sanitized) | `fetch-incident-details.js` + `extract-filter-sanitize.js` |
| 2. Taxonomy | JSONL + existing taxonomy | Updated taxonomy | `taxonomy-updater` agent |
| 3. Classify | JSONL + taxonomy | `classified-incidents.json` | `classify-themes.js` |
| 4. Evaluate | Classified incidents + docs repo | `classification-results.json` | `evaluate-gaps.js` |
| 5. Draft | Classification results | `doc-fix-drafts/*.md` | Orchestrator |
| 6. Validate | Draft files + docs repo + source repo + API | Mutated draft files | 5 validator agents |
| 7. Report | Post-validation drafts + JSON artifacts | `.docx` report | `generate-report.py` |

### Decision Table (gap-type classification logic)

| Operator: Would find docs? | Engineer: Could self-resolve? | Doc Author: Content exists? | → Classification |
|:--:|:--:|:--:|:--|
| No | Yes | None | `real_doc_gap` |
| No | Yes | Partial | `partial_doc_gap` |
| Yes | Yes | Full | `discoverability_problem` |
| — | No (code fix) | — | `engineering_fix` |
| — | No (ops action) | — | `operational_gap` |
| Yes | — | Full | `no_doc_action_needed` |

## Walkthrough: Three Incidents Through the Pipeline

### Incident A: "User cannot authenticate after credential rotation"

**Demonstrates:** Happy path → `real_doc_gap` → standalone draft → survives all 5 validators

**The incident:** A team member rotated their certificate, then couldn't connect to the admin shell. Error: `IDX10223: Lifetime validation failed`. They filed a support ticket. The resolution was "clear token cache and reconnect" — a 30-second fix that took 2 days because no documentation mentioned it.

**Extraction (Stage 1):**
```json
{
  "IncidentId": "100000001",
  "Title": "Unable to authenticate after credential rotation — token cache stale",
  "CustomerSymptom": "After renewing certificate, Connect-AdminShell fails with IDX10223",
  "ResolutionSummary": "Informed user to clear token cache at %LOCALAPPDATA%\\App\\TokenCache and reconnect",
  "SignalClass": "signal",
  "NoiseRule": "R5"
}
```

**Classification (Stage 3):** Scores 8 for `authentication-failures` theme (title: "authenticate" +3, "token" +3; symptom: "IDX10223" +2). No exclusion signals. Assigned cleanly.

**Evaluation (Stage 4):**
- **Operator:** `userWouldFindDocs: "no"` — searching "IDX10223" or "token cache stale" returns no results in docs. The auth page exists but is titled "Getting Started with Authentication" — a user with an error code wouldn't find it.
- **Engineer:** `resolutionType: "informational"`, `userCouldSelfResolve: "yes"` — the fix is "clear cache and reconnect," which is entirely within the user's capability.
- **Doc Author:** `contentExists: "yes"`, `scenarioCoverage: "partial"` — the auth page covers initial setup but says nothing about cache invalidation after rotation.

**Decision table:** Operator=no, Engineer=yes, DocAuthor=partial → **`partial_doc_gap`**

**Drafting (Stage 5):** Produces an augmentation patch targeting the existing auth troubleshooting page. Two patches: one for "Token cache staleness after credential rotation" and one for "Certificate renewal failures (IDX10223)."

**Validation (Stage 6):**
- **Overlap validator:** Searches docs for "clear token cache" resolution. Not found anywhere. ✓ No overlap — draft unchanged.
- **Cmdlet validator:** Verifies `Connect-AdminShell` exists in source. ✓ Found.
- **Grounding validator:** Checks `%LOCALAPPDATA%\App\TokenCache` path. Can't verify exact path → replaces with `<token-cache-path>` placeholder + reviewer comment.
- **Effectiveness validator:** Looks up incident 100000001. Confirms: Proof 1 (needed new docs) ✓, Proof 2 (self-service fix confirmed) ✓, Proof 3 (draft contains the error code and fix) ✓. Disposition: **keep**.

**Output:** The draft survives with one reviewer comment on the cache path. See `example-run/doc-fix-drafts/auth-token-errors_patch.md`.

---

### Incident B: "API returns 429 during batch operations"

**Demonstrates:** `partial_doc_gap` → augmentation patch → overlap validator identifies existing content → trims draft to net-new resolution steps

**The incident:** An automation engineer's batch script hit rate limits. They filed a ticket asking "what are the limits?" The resolution was explaining the 100 req/min limit and providing a backoff pattern.

**Evaluation (Stage 4):**
- **Operator:** `userWouldFindDocs: "partial"` — the API reference page mentions rate limits exist but doesn't give the actual numbers or a backoff implementation.
- **Engineer:** `resolutionType: "informational"`, `userCouldSelfResolve: "yes"`
- **Doc Author:** `scenarioCoverage: "partial"` — rate limit concept documented, but specific limits and backoff patterns are missing.

**Decision table:** → **`partial_doc_gap`**

**Validation — key insight:** The overlap validator finds that the existing API reference page says "Rate limits apply. See HTTP 429 responses." This is conceptual overlap. But the *resolution* (specific backoff implementation with exponential retry) is NOT in existing docs. The validator keeps the draft but removes the "what are rate limits" explanation (already documented) and retains only the backoff implementation and specific limit numbers.

This demonstrates resolution-level overlap: the error message is "new" (429 with specific retry-after values) but what matters is whether the *fix* is already documented.

---

### Incident C: "Deployment fails in isolated region"

**Demonstrates:** Evaluator disagreement → decision table resolves to `operational_gap` → **no draft generated**

**The incident:** A deployment failed in a restricted network region. The user's deployment manifest was correct. The issue was a backend routing configuration that only a platform engineer could fix.

**Evaluation (Stage 4):**
- **Operator:** `userWouldFindDocs: "no"` — searching for the region-specific error returns nothing
- **Engineer:** `resolutionType: "mechanical"`, `userCouldSelfResolve: "no"` — the fix was a backend routing change by the platform team. The user has no access to perform this action.
- **Doc Author:** `contentExists: "no"` — no documentation for this region's specific routing requirements

**Decision table:** Engineer says can't self-resolve (backend action) → **`operational_gap`**

**Key insight:** The system knows when NOT to write documentation. Despite having a real gap (no docs exist) and a real user problem (couldn't find help), the correct answer is "this isn't a documentation problem." The user can't fix it themselves regardless of what docs say. Writing a page titled "Deployment in Isolated Regions" that ends with "contact platform team" is not useful documentation — it's a redirect that should be an error message improvement, not a doc page.

This is the hardest judgment call and the most impressive to demonstrate: the system correctly classifies this as an operational gap requiring an engineering fix (better error messages, automatic routing) rather than documentation.

## Validator Deep-Dive: Before & After

Here's how a draft enters validation and emerges changed.

**Input draft:** `auth-token-errors_patch.md` with 2 patches, 3 cmdlet references, and 1 file path claim.

| Validator | Action | Result |
|-----------|--------|--------|
| Overlap | Searched for "clear token cache" in 847 doc pages | No overlap found — unchanged |
| Clarity | Improved prose in 2 sentences | Minor rewording only |
| Cmdlet | Verified `Connect-AdminShell`, `Get-AuthToken` | Both confirmed in source ✓ |
| Grounding | Checked `%LOCALAPPDATA%\App\TokenCache` path | Path unverifiable → replaced with `<token-cache-path>` + reviewer comment |
| Effectiveness | Looked up 2 motivating incidents via API | Both pass all 3 proofs → disposition: keep |

**The draft survived** with one modification (cache path placeholder) and the reviewer evaluation table appended. The grounding validator's surgical edit preserved the entire resolution procedure while honestly marking what it couldn't verify — rather than deleting the whole section or leaving a potentially wrong path in place.

## Failure Modes (robustness)

| Scenario | System behavior |
|----------|----------------|
| Taxonomy quality gate fires (>20% unclassified) | Loops back to taxonomy-updater agent; proposes new themes; waits for user confirmation |
| Validator deletes a draft entirely | Orchestrator notes deletion in report; no draft appears in final output |
| All evaluators produce "unclear" | Classified as `human_review`; presented to user for manual classification |
| Content gate blocks drafting (insufficient signal) | Theme appears in report with "No draft — insufficient resolution signal" |
| Cmdlet validator finds hallucinated cmdlet in core step | Deletes that resolution step; if draft becomes empty, deletes file |
| Effectiveness validator gives "delete" disposition | Orchestrator removes draft; report shows "Deleted: insufficient motivation" |

---

*For the full output structure from an actual (sanitized) pipeline execution, see `example-run/`.*
