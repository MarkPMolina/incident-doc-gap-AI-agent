# Incident Doc Gap Agent — ROI Analysis

## Executive Summary

The incident-doc-gap agent is an AI-assisted system that analyzes support incidents filed against infrastructure operations teams, identifies documentation gaps, and produces validated doc-fix drafts. It runs monthly at an operating cost of approximately 3.5 hours of FTE time.

The program breaks even if the resulting documentation prevents or materially shortens just 1–2 Sev3 incidents per month. Based on a human-calibrated sample and three months of volume-trend data, the plausible opportunity is larger — but prevention impact has not yet been directly measured and should be validated through ongoing observation.

---

## What the Agent Does

The incident-doc-gap agent automates a three-phase monthly workflow:

1. **Analyze** — Queries the incident management system for incidents across multiple operations teams. Extracts structured data, classifies incidents into recurring themes, evaluates each for documentation gaps via three independent evaluator perspectives, and produces validated doc-fix drafts.

2. **Publish** — After human review, pushes doc fixes to a documentation branch, uploads drafts for tech review, and posts review requests to team channels.

3. **Finalize** — Incorporates feedback, creates a pull request, and tracks through merge.

Each run processes approximately 350–680 total incidents, filtering to 240–290 "signal" incidents (excluding automated alerts and noise). Draft fixes pass through five independent validation layers before human review.

---

## Operating Cost

**Monthly cost:** 3–4 hours of FTE time.

This covers:
- Running the agent interactively (confirming taxonomy changes, reviewing flagged incidents)
- Reviewing drafted documentation for quality and accuracy
- Reviewing SME feedback during the tech review period (when received)
- Triggering publish and finalize workflows

**What is excluded:** Agent development and iteration costs (treated as sunk). SME tech review is requested but not consistently obtained; operating cost reflects actual practice.

**The honest counterfactual:** Without the agent, this work does not happen. No one was performing systematic monthly incident-to-documentation-gap analysis prior to the agent's deployment. The agent enables a new capability rather than accelerating an existing process.

> *Note: A fully manual equivalent of this workflow would require an estimated 40–80+ hours of analyst time — but this is academic, as such a process was never going to be resourced.*

---

## What It Produces

### Operational intelligence (independent of doc fixes)

Each run produces a **categorized breakdown of what is driving incident volume** across all teams. This gives team leads visibility into recurring incident patterns — which themes are growing, which are declining, and where engineering or documentation investment would have the most impact.

This theme analysis is a standalone deliverable. It does not require any documentation to be drafted or published to be valuable.

### Documentation gap identification and fixes

For themes where documentation gaps are confirmed:
- Standalone troubleshooting guides (new pages)
- Augmentation patches to existing documentation (targeted additions)
- Discoverability improvements (cross-links, metadata, error-message indexing)

Over three runs (covering a 3-month period), the agent has:
- Processed approximately 870 signal incidents
- Identified 16 recurring themes
- Produced draft fixes for 8 themes
- Published documentation improvements for 7 themes after validation

### Validation pipeline

Every draft passes through five independent validation layers:
1. **Overlap detection** — Verifies content doesn't duplicate existing docs (assessed at resolution level)
2. **Clarity pass** — Revises prose quality without changing technical content
3. **Cmdlet verification** — Confirms all referenced tools and commands exist in source
4. **Grounding verification** — Fact-checks paths, headings, and procedural claims
5. **Effectiveness evaluation** — Looks up motivating incidents and assesses whether the draft would address them

### Team coverage

| Team | Other doc-gap tooling | Agent role |
|------|----------------------|-----------|
| Operations Team A | None | Primary and only systematic doc-gap analysis |
| Operations Team B | None | Primary and only systematic doc-gap analysis |
| Operations Team C | Automated TSG generator | Supplemental — covers gaps the automated tool misses |

---

## Incident Burden Analysis

### Framework

Not all incidents impose equal operational burden. The analysis uses a composite score:

```
Incident_Burden = Severity_Weight × Time_Factor × Escalation_Factor
```

| Component | Method |
|-----------|--------|
| Severity weight | Sev1=10×, Sev2=4×, Sev3=1×, Sev4=0.5× |
| Time factor | Log-normalized hours from CreatedDate → MitigatedDate |
| Escalation factor | 1.0 (none), 1.5 (once), 2.0 (multiple bounces) |

### Baseline data (Month 3)

- 355 total incidents, 240 signal (68%)
- Severity distribution: 88% Sev3, 1.4% Sev2, 0.3% Sev1
- Overall median time-to-mitigate: 28.8 hours
- Sev3 median time-to-mitigate: 29.1 hours

**Finding: Sev3 incidents drive approximately 89% of total weighted benefit potential.** This confirms the inverse correlation between severity and documentation-addressability — the highest-severity incidents are almost always infrastructure failures where docs are irrelevant, while Sev3 incidents represent the recurring operational confusion where documentation helps most.

### Time-to-mitigate by theme

| Theme | N | Median TTM (hrs) | Docs published? |
|-------|---|------------------|-----------------|
| Approval Routing | 44 | 114.6 | After Month 2 |
| Cloud Access | 38 | 83.7 | After Month 1 |
| Account Provisioning | 8 | 74.1 | After Month 1 |
| Auth Enrollment | 24 | 23.1 | After Month 1 |
| Auth Sign-in | 18 | 20.9 | After Month 1 |
| Resource Management | 13 | 21.9 | No |
| Client Compatibility | 5 | 7.7 | After Month 1 |
| Certificate Rotation | 7 | 6.2 | After Month 1 |

Approval Routing and Cloud Access represent the highest time-burden themes. This data establishes a baseline for future comparison — longitudinal TTM tracking requires preserving incident data across runs.

---

## Evidence of Impact

### Volume trends across three periods

Four themes that received published documentation show monotonic volume decline:

| Theme | Month 1 | Month 2 | Month 3 | Total change |
|-------|---------|---------|---------|--------------|
| Auth Sign-in | 24 | 15 | 3 | −87% |
| Account Provisioning | 19 | 17 | 10 | −47% |
| Cloud Access | 34 | 26 | 23 | −32% |
| Parameter Procedures | 5 | 1 | 0 | −100% |

Three treated themes showed volume increases, explained by known external events:
- **Auth Enrollment** (17→45→27): Hardware version rollout introduced new enrollment errors
- **Certificate Rotation** (11→31→25): Certificate authority expiry event
- **Remote Access** (—→17→27): New deployment wave (no docs published for this theme)

**Interpretation:** These trends are consistent with the hypothesis that published documentation reduces repeat incidents in affected themes. They are not causal proof — confounders such as engineering fixes, seasonal variation, and regression to the mean have not been controlled for. They justify continued measurement.

### Human-calibrated preventability assessment

A random sample of 18 incidents from treated themes was assessed by the agent operator against published documentation:

| Category | Count | % |
|----------|-------|---|
| Engineering fix (docs irrelevant) | 9 | 50% |
| Docs already exist, user didn't search | 4 | 22% |
| Doc would have helped (confirmed gap) | 2 | 11% |
| Unclear (insufficient detail) | 2 | 11% |
| Doc would've helped but code fix makes it moot | 1 | 6% |

**Key findings:**
- Approximately 11% of treated-theme incidents are confirmed documentation-addressable in this small sample.
- 22% of incidents had docs that would have helped — but the user did not search before filing. This is not addressable by writing more documentation.
- 50% required engineering fixes regardless of documentation quality.

**Caveat:** This is a small-sample calibration (n=18), not a statistically robust estimate. It is used as a conservative directional input, not a precise conversion rate.

---

## Break-Even Analysis

### Responder time per incident

Based on input from an experienced on-call engineer: handling time ranges from 30–60 minutes for simpler incidents to 3–4+ hours for complex ones. A planning assumption of ~3 hours per Sev3 incident is used, acknowledging high variance.

### Calculation

| Input | Value | Source |
|-------|-------|--------|
| Signal incidents per month | ~240 | Month 3 run |
| Incidents in treated themes | ~108 | Keyword classification |
| Doc-addressable rate | ~11% | Human-calibrated sample (n=18) |
| Estimated addressable incidents | ~12 | 108 × 11% |
| Adoption discount | 50% | Conservative estimate (users must find and read docs) |
| Incidents plausibly prevented/shortened | ~6 | 12 × 50% |
| Responder time per incident | ~3 hrs | On-call engineer estimate (high variance) |
| **Estimated responder hours recovered** | **~18 hrs/month** | 6 × 3 |
| **Operating cost** | **~3.5 hrs/month** | FTE time |

### Break-even threshold

**The program breaks even if documentation improvements prevent or materially shorten approximately 1–2 Sev3 incidents per month.** At 3 hours of responder time per incident, even a single prevented incident roughly equals the monthly operating cost.

### Sensitivity

| Responder time assumption | Incidents needed to break even |
|---------------------------|-------------------------------|
| 1 hour/incident (low) | 3–4 incidents/month |
| 3 hours/incident (base) | 1–2 incidents/month |
| 4 hours/incident (high) | 1 incident/month |

The break-even threshold is low enough that the program is viable even under pessimistic assumptions about per-incident handling time.

### What this calculation does not include

- Value of theme identification / operational intelligence
- Prevention from docs not yet published (only counts currently treated themes)
- Shortened resolution time for incidents still filed but resolved faster
- Reduced escalation and team-bouncing
- Filer's own time saved (only responder time counted)

---

## Limitations and Known Weaknesses

### Self-referentiality

The agent identifies gaps, estimates preventability, drafts fixes, and validates them. Reported benefit potential is partly a function of the agent's own judgments. Human calibration (this analysis) provides an independent check, but some circularity is irreducible.

### Publication does not equal impact

A published document only creates value if the right person finds and trusts it at the right moment. We do not currently have access to documentation site page-view telemetry and cannot directly measure whether published docs are being read.

### "User didn't search" is not fixable by documentation

22% of sampled incidents fell into a category where relevant documentation existed and was findable, but the user simply did not attempt self-service before filing. No amount of additional documentation addresses this behavior.

### Limited data history

Three months of run data provides directional signals only. Statistical confidence in volume-reduction claims requires 9–12+ months of consistent measurement with stable taxonomy.

### Single-respondent time estimate

The 3-hour planning assumption comes from one on-call engineer. It is plausible and consistent with the median TTM data (29 hours includes wait time, not just active work), but has not been validated across multiple respondents.

---

## What Would Disprove This

The following observations would indicate the program is not delivering value:

- Treated themes show no volume decline after 6+ months of published documentation
- Human-calibrated doc-addressability rate drops below 5% with a larger sample
- Published docs receive zero or near-zero page views
- Responders report that published docs do not help with incoming incidents
- Resolution time for treated themes does not decrease relative to untreated themes

Continued measurement across these dimensions will either strengthen or invalidate the current directional findings.

---

## Future Measurement Opportunities

| Approach | Data needed | Timeline |
|----------|-------------|----------|
| Page-view telemetry | Access to documentation site analytics | Requires platform team support |
| Longitudinal volume tracking | 9–12 months of stable-taxonomy runs | Achievable within 1 year |
| Resolution-time before/after | Incident data preserved across all runs | Next run onward |
| Larger human-calibrated sample | 50–100 incidents assessed | 2–3 additional runs |
| Responder survey | Multi-respondent time estimates | Ad hoc |
| Incident closure tagging | "Doc used" / "doc missing" field | Requires process change |

---

## Appendix: Token Cost Analysis

### Estimated consumption per run

| Component | Effective tokens |
|-----------|-----------------|
| Analysis workflow (evaluators, validators, classification) | ~2,186,000 input |
| Output generation (drafts, report, validation) | ~375,000 output |
| **Total effective tokens per run** | **~2,561,000** |

The largest cost driver is the evaluator agents (3 per signal incident × ~200 incidents), comprising approximately 65% of the analysis workflow.

### Market vs. production cost

Token pricing from AI providers reflects strategic decisions (platform lock-in incentives, demand smoothing, margin) rather than pure production cost. Current market rates are likely subsidized to promote adoption.

### Break-even at various token cost levels

The relevant question is: what happens if token costs rise significantly as subsidies are removed?

| Assumed $/M tokens | Monthly token cost | Context |
|--------------------|-------------------|---------|
| $3.00 (current market, Sonnet-class) | $7.68 | Likely subsidized |
| $10.00 | $25.61 | Post-subsidy pricing |
| $25.00 | $64.03 | High-demand scenario |
| $50.00 | $128.05 | Compute-scarce scenario |
| $100.00 | $256.10 | Extreme case |

For comparison, a single prevented Sev3 incident saves approximately 3 hours of responder time. At any reasonable loaded hourly rate ($75–$150/hr), that's $225–$450 per prevented incident. The program plausibly prevents 6+ incidents/month.

**Even at $100/M tokens (33× current market rate), the monthly compute cost ($256) is less than the value of a single prevented incident.** Token cost does not become the binding constraint on ROI until prices reach levels far beyond any current projection — or until the benefit estimate is dramatically wrong.

### Why this matters outside large enterprises

Within large enterprises, token costs are effectively subsidized and invisible to most teams. Outside that context — or in a future where compute costs are accounted for more rigorously — the token analysis demonstrates that the program remains viable even at market rates. The break-even threshold in compute terms is extremely low.
