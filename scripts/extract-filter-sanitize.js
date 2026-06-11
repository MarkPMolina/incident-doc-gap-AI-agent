#!/usr/bin/env node
/**
 * extract-filter-sanitize.js
 * 
 * Pass 1 Step 3: Extract structured fields, apply deterministic noise-filtering,
 * and DLP-sanitize all text fields. Outputs JSONL.
 * 
 * Usage:
 *   node extract-filter-sanitize.js <runDir>
 * 
 * Inputs:
 *   {runDir}/incident-details-raw.json — array of raw incident detail objects
 * 
 * Outputs:
 *   {runDir}/Incident-Extract-{Mon}-{Mon}-{Year}.jsonl — sanitized JSONL dataset
 */

const fs = require("fs");
const path = require("path");

// ============================================================
// NOISE-FILTERING RULES (deterministic, first match wins)
// ============================================================

const MONITORING_PREFIXES = ["MDM-", "MDM_", "Log Alerts", "Log Analytics", "Passive Monitoring", "LocalActiveMonitoring"];
const ALERTING_SYSTEMS = ["AutoAlert", "HealthBot", "CertExpiryMonitor", "CertificateExpiryAlert", "Scheduled Query Rules", "Monitor Alert"];

function classifyNoise(incident) {
  // R1 — Noise flag
  if (incident.isNoise === true) return { signalClass: "noise", noiseRule: "R1" };

  const createdBy = incident.createdBy || "";

  // R2 — Monitoring prefix
  for (const prefix of MONITORING_PREFIXES) {
    if (createdBy.startsWith(prefix)) return { signalClass: "automated", noiseRule: "R2" };
  }

  // R3 — Alerting system
  for (const sys of ALERTING_SYSTEMS) {
    if (createdBy.includes(sys)) return { signalClass: "automated", noiseRule: "R3" };
  }

  // R4 — Service account CN
  if (createdBy.startsWith("CN=")) return { signalClass: "automated", noiseRule: "R4" };

  // R5 — Default: signal
  return { signalClass: "signal", noiseRule: "R5" };
}

// ============================================================
// DLP SANITIZATION PATTERNS
// ============================================================

function sanitizeText(text) {
  if (!text) return "";

  let s = text;

  // Strip HTML tags (mitigation steps may come as HTML)
  s = s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#\d+;/g, "");

  // Inline tokens/secrets (eyJ..., Bearer tokens, base64 blobs > 40 chars)
  s = s.replace(/\b(token|key|secret|password|bearer)\s*[:=]\s*["']?[A-Za-z0-9+/=_\-]{20,}["']?/gi, "[REDACTED]");
  s = s.replace(/eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*/g, "[REDACTED]");

  // SharedAccessKey, AccountKey, connection strings
  s = s.replace(/(SharedAccessKey|AccountKey|SharedAccessSignature)\s*=\s*[^\s;&"']+/gi, "$1=[REDACTED]");
  s = s.replace(/DefaultEndpointsProtocol=[^\s"']+/gi, "[REDACTED-CONNECTION-STRING]");

  // PII in error messages
  s = s.replace(/'(\[PII of type '[^']*'\])'/g, "'[REDACTED]'");
  s = s.replace(/'[A-Za-z0-9+/=]{40,}'/g, "'[REDACTED]'");

  // Long hex strings (>=40 chars, not incident IDs)
  s = s.replace(/\b[0-9a-f]{40,}\b/gi, "[HASH-REDACTED]");

  // GUIDs in free text (subscription/tenant/resource IDs)
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[GUID-REDACTED]");

  // Email addresses (keep internal service accounts)
  s = s.replace(/\b[A-Za-z0-9._%+\-]+@(?!your-org\.com\b)[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/gi, "[EMAIL-REDACTED]");

  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

// ============================================================
// FIELD EXTRACTION
// ============================================================

function extractFields(raw) {
  const { signalClass, noiseRule } = classifyNoise(raw);

  const record = {
    IncidentId: raw.id,
    IncidentUrl: `{INCIDENT_PORTAL_URL}${raw.id}`,
    TeamId: raw.owningTeamId,
    TeamName: raw.owningTeamName || "",
    Severity: raw.severity,
    Status: raw.state || "",
    CreatedDateUtc: raw.createdDate || "",
    MitigatedDateUtc: (raw.mitigateData && raw.mitigateData.mitigateTime) || raw.mitigateTime || "",
    ResolvedDateUtc: (raw.resolveData && raw.resolveData.resolveTime) || "",
    Title: sanitizeText(raw.title || ""),
    CustomerSymptom: sanitizeText(raw.summary || ""),
    RootCauseSummary: sanitizeText(raw.howFixed || ""),
    ResolutionSummary: sanitizeText(
      (raw.mitigateData && raw.mitigateData.mitigationSteps) || ""
    ),
    ErrorMessages: "",
    Components: (raw.tags || []).join(", "),
    CreatedBy: raw.createdBy || "",
    IsNoise: raw.isNoise || false,
    Environment: (raw.occuringLocation && raw.occuringLocation.environment) || "",
    SignalClass: signalClass,
    NoiseRule: noiseRule,
    TsgLink: raw.tsgLink || "",
    HowFixed: raw.howFixed || "",
  };

  return record;
}

// ============================================================
// MAIN
// ============================================================

function main() {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error("Usage: node extract-filter-sanitize.js <runDir>");
    process.exit(1);
  }

  const inputPath = path.join(runDir, "incident-details-raw.json");
  if (!fs.existsSync(inputPath)) {
    console.error(`Input not found: ${inputPath}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  console.log(`Loaded ${raw.length} raw incidents from ${inputPath}`);

  // Extract and classify
  const records = raw.map(extractFields);

  // Determine output filename from date range
  const dates = records.map(r => r.CreatedDateUtc).filter(Boolean).sort();
  const startMonth = dates[0] ? new Date(dates[0]).toLocaleString("en-US", { month: "short" }) : "Unknown";
  const endMonth = dates[dates.length - 1] ? new Date(dates[dates.length - 1]).toLocaleString("en-US", { month: "short" }) : "Unknown";
  const year = dates[0] ? new Date(dates[0]).getFullYear() : new Date().getFullYear();
  const outFilename = `Incident-Extract-${startMonth}-${endMonth}-${year}.jsonl`;
  const outPath = path.join(runDir, outFilename);

  // Write JSONL
  const lines = records.map(r => JSON.stringify(r));
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  console.log(`\nOutput: ${outPath}`);
  console.log(`  File size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);

  // Validation summary
  const teamCounts = {};
  const signalCounts = { signal: 0, automated: 0, noise: 0 };
  const ruleCounts = {};

  for (const r of records) {
    const key = `${r.TeamId} (${r.TeamName})`;
    teamCounts[key] = (teamCounts[key] || 0) + 1;
    signalCounts[r.SignalClass] = (signalCounts[r.SignalClass] || 0) + 1;
    ruleCounts[r.NoiseRule] = (ruleCounts[r.NoiseRule] || 0) + 1;
  }

  console.log(`\n--- Validation Summary ---`);
  console.log(`Total incidents: ${records.length}`);
  console.log(`\nBy team:`);
  for (const [k, v] of Object.entries(teamCounts)) console.log(`  ${k}: ${v}`);
  console.log(`\nSignal classification:`);
  for (const [k, v] of Object.entries(signalCounts)) console.log(`  ${k}: ${v}`);
  console.log(`\nNoise rule distribution:`);
  for (const [k, v] of Object.entries(ruleCounts).sort()) console.log(`  ${k}: ${v}`);
}

main();
