#!/usr/bin/env node
/**
 * evaluate-gaps.js
 * 
 * Pass 2 Step 9: Evaluate gap classification for signal incidents using
 * heuristic evaluator logic + deterministic decision table.
 * 
 * This script implements the three evaluator perspectives:
 * - Operator: Would the user find docs? (based on title/symptom vs doc titles)
 * - Engineer: What fixed it, could user self-resolve? (based on resolution text)
 * - Doc Author: Does relevant content exist? (based on doc file search)
 * 
 * Usage:
 *   node evaluate-gaps.js <runDir> <docsRepoPath>
 * 
 * Inputs:
 *   {runDir}/classified-incidents.json — theme classifications
 *   {runDir}/Incident-Extract-*.jsonl — incident data
 *   {docsRepoPath}/docs_external/ — documentation files
 * 
 * Outputs:
 *   {runDir}/classification-results.json — per-incident gap classifications
 */

const fs = require("fs");
const path = require("path");

// ============================================================
// DOC INDEX — build searchable index of documentation
// ============================================================

function buildDocIndex(docsPath) {
  const index = [];
  const extPath = path.join(docsPath, "docs_external");
  const intPath = path.join(docsPath, "docs_internal");
  
  function scanDir(dir, location) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith("_") && entry.name !== "obj" && entry.name !== "media") {
        scanDir(fullPath, location);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const content = fs.readFileSync(fullPath, "utf8").substring(0, 1000);
        const titleMatch = content.match(/title:\s*["']?([^"'\n]+)/i) || content.match(/^#\s+(.+)/m);
        const title = titleMatch ? titleMatch[1].trim() : entry.name.replace(".md", "");
        index.push({
          path: fullPath.replace(docsPath, "").replace(/\\/g, "/"),
          filename: entry.name.toLowerCase(),
          title: title.toLowerCase(),
          location
        });
      }
    }
  }
  
  scanDir(extPath, "external");
  scanDir(intPath, "internal");
  return index;
}

function searchDocs(docIndex, searchTerms) {
  const results = [];
  for (const term of searchTerms) {
    const tl = term.toLowerCase();
    for (const doc of docIndex) {
      if (doc.title.includes(tl) || doc.filename.includes(tl.replace(/\s+/g, "-"))) {
        if (!results.find(r => r.path === doc.path)) {
          results.push(doc);
        }
      }
    }
  }
  return results;
}

// ============================================================
// EVALUATOR: ENGINEER
// ============================================================

function evaluateEngineer(incident) {
  const resolution = (incident.ResolutionSummary || "").toLowerCase();
  const howFixed = (incident.HowFixed || "").toLowerCase();
  
  let resolutionType = "informational";
  let userCouldSelfResolve = "yes";
  
  // Mechanical indicators
  const mechanicalPatterns = ["deployed", "hotfix", "fixed in build", "config change", "code fix", 
    "restarted service", "patch", "backend", "escalated to engineering", "infrastructure"];
  const informationalPatterns = ["informed user", "provided steps", "user followed", "pointed to docs",
    "update client", "updated client", "user confirmed", "resolved after updating", "followed guidance",
    "re-enrolled", "re-enroll", "reinstall", "unplug", "restart", "reboot"];
  const manualPatterns = ["manual backend", "support team performed", "admin intervention",
    "queue reroute", "tenant cleanup", "permissioned action"];
  
  for (const p of mechanicalPatterns) {
    if (resolution.includes(p)) { resolutionType = "mechanical"; break; }
  }
  if (resolutionType !== "mechanical") {
    for (const p of manualPatterns) {
      if (resolution.includes(p)) { resolutionType = "manual_non_documentable"; break; }
    }
  }
  
  // Self-resolvability
  if (resolutionType === "mechanical") {
    userCouldSelfResolve = "no";
  } else if (resolutionType === "manual_non_documentable") {
    userCouldSelfResolve = "no";
  } else {
    const selfServicePatterns = ["update client", "updated client", "reinstall", "re-enroll",
      "unplug", "restart", "reboot", "followed", "user confirmed"];
    const needsSupportPatterns = ["worked with user", "contacted", "synced offline", "teams call"];
    
    let selfService = false;
    let needsSupport = false;
    for (const p of selfServicePatterns) if (resolution.includes(p)) selfService = true;
    for (const p of needsSupportPatterns) if (resolution.includes(p)) needsSupport = true;
    
    if (selfService && !needsSupport) userCouldSelfResolve = "yes";
    else if (needsSupport && !selfService) userCouldSelfResolve = "unclear";
    else userCouldSelfResolve = "yes";
  }
  
  const documentableAsSelfService = resolutionType === "informational" || 
    (resolutionType === "mechanical" && userCouldSelfResolve === "yes");
  const documentableAsEscalationGuidance = resolutionType === "manual_non_documentable";
  
  return {
    resolutionType,
    userCouldSelfResolve,
    operationalPath: {
      documentableAsSelfService,
      documentableAsEscalationGuidance
    }
  };
}

// ============================================================
// EVALUATOR: DOC AUTHOR
// ============================================================

function evaluateDocAuthor(incident, docIndex) {
  const title = incident.Title || "";
  const symptom = incident.CustomerSymptom || "";
  const components = incident.Components || "";
  const theme = incident.theme || "";
  
  const searchTerms = [];
  
  // Extract keywords from title
  const titleWords = title.toLowerCase().split(/[\s\-_,;:]+/).filter(w => w.length > 3);
  if (components) searchTerms.push(...components.split(",").map(c => c.trim()).filter(Boolean));
  
  // Theme-based terms
  const themeTerms = {
    "authentication-failures": ["authentication", "token", "sign-in", "credential"],
    "api-rate-limits": ["rate limit", "throttle", "429", "batch"],
    "onboarding-setup": ["onboarding", "setup", "register", "provision"],
    "deployment-pipeline": ["deployment", "pipeline", "rollout", "release"],
  };
  
  if (themeTerms[theme]) searchTerms.push(...themeTerms[theme]);
  
  // Add specific error codes from title
  const errorMatch = title.match(/\b(IDX\d+|Error\s*code\s*\d+|0x[0-9a-f]+)\b/i);
  if (errorMatch) searchTerms.push(errorMatch[1]);
  
  // Search
  const results = searchDocs(docIndex, searchTerms.length > 0 ? searchTerms : titleWords.slice(0, 5));
  
  let contentExists = results.length > 0 ? "yes" : "no";
  let scenarioCoverage = "none";
  
  if (results.length > 0) {
    scenarioCoverage = "partial";
    const incidentLower = title.toLowerCase();
    for (const doc of results) {
      if (doc.title.includes("tsg") || doc.title.includes("troubleshoot")) {
        scenarioCoverage = "partial";
      }
    }
  }
  
  return {
    contentExists,
    scenarioCoverage,
    relevantDocs: results.slice(0, 3).map(r => ({ path: r.path, title: r.title, location: r.location }))
  };
}

// ============================================================
// EVALUATOR: OPERATOR
// ============================================================

function evaluateOperator(incident, docResults) {
  if (docResults.contentExists === "no") {
    return { userWouldFindDocs: "no" };
  }
  
  const title = (incident.Title || "").toLowerCase();
  const relevantDocs = docResults.relevantDocs || [];
  
  let matchQuality = 0;
  const titleWords = title.split(/[\s\-_,;:]+/).filter(w => w.length > 3);
  
  for (const doc of relevantDocs) {
    for (const word of titleWords) {
      if (doc.title.includes(word)) matchQuality++;
    }
  }
  
  if (matchQuality >= 3) return { userWouldFindDocs: "yes" };
  if (matchQuality >= 1) return { userWouldFindDocs: "partial" };
  return { userWouldFindDocs: "no" };
}

// ============================================================
// DECISION TABLE
// ============================================================

function applyDecisionTable(engineer, docAuthor, operator) {
  // Rule 1: manual_non_documentable and not documentable
  if (engineer.resolutionType === "manual_non_documentable" &&
      !engineer.operationalPath.documentableAsSelfService &&
      !engineer.operationalPath.documentableAsEscalationGuidance) {
    return "operational_gap";
  }
  
  // Rule 2: mechanical and user can't self-resolve
  if (engineer.resolutionType === "mechanical" && engineer.userCouldSelfResolve === "no") {
    return "engineering_fix";
  }
  
  // Rule 3: user could self-resolve or informational → check docs
  if (engineer.userCouldSelfResolve === "yes" || engineer.resolutionType === "informational") {
    if (docAuthor.contentExists === "no") return "real_doc_gap";
    if (docAuthor.contentExists === "yes" && docAuthor.scenarioCoverage === "partial") return "partial_doc_gap";
    if (docAuthor.contentExists === "yes" && docAuthor.scenarioCoverage === "full" && operator.userWouldFindDocs === "no") {
      return "discoverability_problem";
    }
    if (docAuthor.contentExists === "yes" && docAuthor.scenarioCoverage === "full" && operator.userWouldFindDocs === "yes") {
      return "no_doc_action_needed";
    }
    if (docAuthor.contentExists === "yes" && docAuthor.scenarioCoverage === "full" && operator.userWouldFindDocs === "partial") {
      return "discoverability_problem";
    }
  }
  
  // Rule 4: mechanical but user could self-resolve
  if (engineer.resolutionType === "mechanical" && engineer.userCouldSelfResolve === "yes") {
    return "partial_doc_gap";
  }
  
  // Rule 5: manual_non_documentable but escalation-guidable
  if (engineer.resolutionType === "manual_non_documentable" &&
      engineer.operationalPath.documentableAsEscalationGuidance) {
    return "operational_gap";
  }
  
  // Default
  if (engineer.userCouldSelfResolve === "unclear") return "partial_doc_gap";
  return "no_doc_action_needed";
}

// ============================================================
// MAIN
// ============================================================

function main() {
  const runDir = process.argv[2];
  const docsPath = process.argv[3];
  
  if (!runDir || !docsPath) {
    console.error("Usage: node evaluate-gaps.js <runDir> <docsRepoPath>");
    process.exit(1);
  }
  
  // Load classified incidents
  const classData = JSON.parse(fs.readFileSync(path.join(runDir, "classified-incidents.json"), "utf8"));
  
  // Load JSONL
  const jsonlFiles = fs.readdirSync(runDir).filter(f => f.endsWith(".jsonl"));
  const incidents = fs.readFileSync(path.join(runDir, jsonlFiles[0]), "utf8")
    .trim().split("\n").map(l => JSON.parse(l));
  const incMap = {};
  incidents.forEach(i => { incMap[i.IncidentId] = i; });
  
  // Build doc index
  console.log("Building doc index...");
  const docIndex = buildDocIndex(docsPath);
  console.log(`  Indexed ${docIndex.length} docs`);
  
  // Get signal incidents with their theme assignments
  const signalClassifications = classData.classifications.filter(c => c.signalClass === "signal");
  console.log(`\nEvaluating ${signalClassifications.length} signal incidents...`);
  
  const results = [];
  const gapCounts = {};
  
  for (const cls of signalClassifications) {
    const inc = incMap[cls.incidentId];
    if (!inc) continue;
    
    inc.theme = cls.theme;
    
    const engineer = evaluateEngineer(inc);
    const docAuthor = evaluateDocAuthor(inc, docIndex);
    const operator = evaluateOperator(inc, docAuthor);
    const classification = applyDecisionTable(engineer, docAuthor, operator);
    
    gapCounts[classification] = (gapCounts[classification] || 0) + 1;
    
    results.push({
      incidentId: cls.incidentId,
      theme: cls.theme,
      gapClassification: classification,
      engineer,
      docAuthor: { contentExists: docAuthor.contentExists, scenarioCoverage: docAuthor.scenarioCoverage, docCount: docAuthor.relevantDocs.length },
      operator
    });
  }
  
  // Theme rollup
  const themeRollup = {};
  for (const r of results) {
    if (!themeRollup[r.theme]) {
      themeRollup[r.theme] = { classificationBreakdown: {}, draftScopeIncidents: [] };
    }
    const tr = themeRollup[r.theme];
    if (!tr.classificationBreakdown[r.gapClassification]) tr.classificationBreakdown[r.gapClassification] = [];
    tr.classificationBreakdown[r.gapClassification].push(r.incidentId);
    
    if (r.gapClassification === "real_doc_gap" || r.gapClassification === "partial_doc_gap") {
      tr.draftScopeIncidents.push(r.incidentId);
    }
  }
  
  // Determine primary classification per theme
  for (const [theme, data] of Object.entries(themeRollup)) {
    const docActionable = ["real_doc_gap", "partial_doc_gap", "discoverability_problem"];
    let primary = "no_doc_action_needed";
    for (const cls of docActionable) {
      if (data.classificationBreakdown[cls] && data.classificationBreakdown[cls].length > 0) {
        primary = cls;
        break;
      }
    }
    data.primaryClassification = primary;
  }
  
  // Avoidable estimates
  const avoidableRates = { real_doc_gap: 0.4, partial_doc_gap: 0.3, discoverability_problem: 0.2, engineering_fix: 0, operational_gap: 0, no_doc_action_needed: 0 };
  for (const [theme, data] of Object.entries(themeRollup)) {
    let avoidableSum = 0;
    for (const [cls, ids] of Object.entries(data.classificationBreakdown)) {
      avoidableSum += (avoidableRates[cls] || 0) * ids.length;
    }
    data.avoidableCount = Math.ceil(avoidableSum);
    data.totalIncidents = Object.values(data.classificationBreakdown).reduce((s, ids) => s + ids.length, 0);
  }
  
  // Print summary
  console.log("\n--- Gap Classification Summary ---");
  for (const [cls, count] of Object.entries(gapCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cls}: ${count}`);
  }
  
  console.log("\n--- Theme Rollup (draft scope) ---");
  const draftThemes = Object.entries(themeRollup)
    .filter(([_, d]) => d.draftScopeIncidents.length > 0)
    .sort((a, b) => b[1].draftScopeIncidents.length - a[1].draftScopeIncidents.length);
  
  for (const [theme, data] of draftThemes) {
    console.log(`  ${theme}: ${data.draftScopeIncidents.length} incidents in draft scope (${data.avoidableCount} avoidable)`);
  }
  
  console.log(`\n  Total themes needing drafts: ${draftThemes.length}`);
  console.log(`  Total incidents in draft scope: ${draftThemes.reduce((s, [_, d]) => s + d.draftScopeIncidents.length, 0)}`);
  
  // Save
  const outPath = path.join(runDir, "classification-results.json");
  fs.writeFileSync(outPath, JSON.stringify({ results, themeRollup, gapCounts }, null, 2));
  console.log(`\nSaved to ${outPath}`);
}

main();
