#!/usr/bin/env node
/**
 * classify-themes.js
 * 
 * Pass 2 Step 8: Classify all incidents into themes using the two-pass,
 * context-weighted scoring procedure from theme-taxonomy.yml.
 * 
 * Usage:
 *   node classify-themes.js <runDir> <taxonomyPath>
 * 
 * Inputs:
 *   {runDir}/Incident-Extract-*.jsonl — sanitized incident dataset
 *   {taxonomyPath} — theme-taxonomy.yml
 * 
 * Outputs:
 *   {runDir}/classified-incidents.json — full classification results
 *   {runDir}/taxonomy-snapshot.yml — frozen copy of taxonomy used
 *   Prints quality gate results to stdout
 */

const fs = require("fs");
const path = require("path");

// ============================================================
// YAML PARSER (simple, handles our taxonomy format)
// ============================================================

function parseTaxonomy(yamlText) {
  const themes = [];
  const themeBlocks = yamlText.split(/\n  - slug: /).slice(1);
  
  for (const block of themeBlocks) {
    const theme = { slug: "", display_name: "", matching_signals: [], exclusion_signals: [] };
    
    // Extract slug
    const slugMatch = block.match(/^([\w-]+)/);
    if (slugMatch) theme.slug = slugMatch[1];
    
    // Extract display_name
    const nameMatch = block.match(/display_name:\s*"([^"]+)"/);
    if (nameMatch) theme.display_name = nameMatch[1];
    
    // Extract all matching signal keywords (flatten all sub-arrays)
    const keywords = [];
    const signalSection = block.match(/matching_signals:\s*\n([\s\S]*?)(?=\n    (?:exclusion_signals|boundary_notes|first_appeared|related_themes)|$)/);
    if (signalSection) {
      const matches = signalSection[1].matchAll(/["']([^"']+)["']/g);
      for (const m of matches) {
        keywords.push(m[1].toLowerCase());
      }
    }
    theme.matching_signals = keywords;
    
    // Extract exclusion signals
    const exclSection = block.match(/exclusion_signals:\s*\n([\s\S]*?)(?=\n    (?:boundary_notes|first_appeared|related_themes)|$)/);
    if (exclSection) {
      const matches = exclSection[1].matchAll(/- "([^"]+)"/g);
      for (const m of matches) {
        theme.exclusion_signals.push(m[1].toLowerCase());
      }
    }
    
    if (theme.slug) themes.push(theme);
  }
  
  return themes;
}

// ============================================================
// CLASSIFICATION ENGINE
// ============================================================

function scoreTheme(incident, theme, allThemes) {
  const title = (incident.Title || "").toLowerCase();
  const symptom = (incident.CustomerSymptom || "").toLowerCase();
  const secondary = ((incident.RootCauseSummary || "") + " " + (incident.ResolutionSummary || "")).toLowerCase();
  
  // Check exclusion: if title contains a keyword from this theme's exclusion_signals
  for (const excl of theme.exclusion_signals) {
    if (title.includes(excl)) return { score: 0, suppressed: true };
  }
  
  let titleScore = 0;
  let symptomScore = 0;
  let secondaryScore = 0;
  let matchedKeywords = [];
  
  for (const kw of theme.matching_signals) {
    if (title.includes(kw)) {
      titleScore += 3;
      matchedKeywords.push(`title:"${kw}"`);
    }
    if (symptom.includes(kw)) {
      symptomScore += 2;
      matchedKeywords.push(`symptom:"${kw}"`);
    }
    if (secondary.includes(kw)) {
      secondaryScore += 1;
      matchedKeywords.push(`secondary:"${kw}"`);
    }
  }
  
  const total = titleScore + symptomScore + secondaryScore;
  return { score: total, titleScore, symptomScore, secondaryScore, matchedKeywords, suppressed: false };
}

function classifyIncident(incident, themes) {
  // Pass A: Weighted scoring
  const scores = themes.map(theme => ({
    theme: theme.slug,
    ...scoreTheme(incident, theme, themes)
  })).filter(s => !s.suppressed && s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.titleScore - a.titleScore; // tie-break: prefer higher title score
    });
  
  if (scores.length > 0 && scores[0].score >= 1) {
    const ambiguous = scores.length > 1 && scores[0].score === scores[1].score;
    return {
      theme: scores[0].theme,
      score: scores[0].score,
      method: "pass_a",
      ambiguous,
      tiedWith: ambiguous ? scores[1].theme : null,
      topScores: scores.slice(0, 3).map(s => ({ theme: s.theme, score: s.score }))
    };
  }
  
  // Pass B: Flat scoring on full text (threshold >= 2)
  const fullText = [
    incident.Title, incident.CustomerSymptom,
    incident.RootCauseSummary, incident.ResolutionSummary,
    incident.Components
  ].join(" ").toLowerCase();
  
  const flatScores = themes.map(theme => {
    let score = 0;
    for (const kw of theme.matching_signals) {
      if (fullText.includes(kw)) score += 1;
    }
    return { theme: theme.slug, score };
  }).filter(s => s.score >= 2)
    .sort((a, b) => b.score - a.score);
  
  if (flatScores.length > 0) {
    const ambiguous = flatScores.length > 1 && flatScores[0].score === flatScores[1].score;
    return {
      theme: flatScores[0].theme,
      score: flatScores[0].score,
      method: "pass_b",
      ambiguous,
      tiedWith: ambiguous ? flatScores[1].theme : null,
      topScores: flatScores.slice(0, 3).map(s => ({ theme: s.theme, score: s.score }))
    };
  }
  
  // Unclassified
  return { theme: "unclassified", score: 0, method: "none", ambiguous: false, tiedWith: null, topScores: [] };
}

// ============================================================
// QUALITY GATE
// ============================================================

function checkQualityGate(classifications, signalOnly) {
  const signalClassifications = classifications.filter(c => signalOnly.has(c.incidentId));
  const total = signalClassifications.length;
  
  // Ambiguity check
  const ambiguous = signalClassifications.filter(c => c.ambiguous);
  const ambiguityRate = ambiguous.length / total;
  
  // Unclassified check
  const unclassified = signalClassifications.filter(c => c.theme === "unclassified");
  const unclassifiedRate = unclassified.length / total;
  
  // Concentration check
  const themeCounts = {};
  for (const c of signalClassifications) {
    if (c.theme !== "unclassified") {
      themeCounts[c.theme] = (themeCounts[c.theme] || 0) + 1;
    }
  }
  const maxTheme = Object.entries(themeCounts).sort((a, b) => b[1] - a[1])[0];
  const concentrationRate = maxTheme ? maxTheme[1] / total : 0;
  
  const results = {
    passed: true,
    ambiguity: { count: ambiguous.length, total, rate: ambiguityRate, threshold: 0.10, passed: ambiguityRate < 0.10 },
    unclassified: { count: unclassified.length, total, rate: unclassifiedRate, threshold: 0.20, passed: unclassifiedRate <= 0.20 },
    concentration: { theme: maxTheme ? maxTheme[0] : "none", count: maxTheme ? maxTheme[1] : 0, total, rate: concentrationRate, threshold: 0.50, passed: concentrationRate <= 0.50 }
  };
  
  results.passed = results.ambiguity.passed && results.unclassified.passed && results.concentration.passed;
  return results;
}

// ============================================================
// MAIN
// ============================================================

function main() {
  const runDir = process.argv[2];
  const taxonomyPath = process.argv[3];
  
  if (!runDir || !taxonomyPath) {
    console.error("Usage: node classify-themes.js <runDir> <taxonomyPath>");
    process.exit(1);
  }
  
  // Find JSONL file
  const files = fs.readdirSync(runDir).filter(f => f.endsWith(".jsonl"));
  if (files.length === 0) { console.error("No JSONL file found in " + runDir); process.exit(1); }
  const jsonlPath = path.join(runDir, files[0]);
  
  // Load incidents
  const lines = fs.readFileSync(jsonlPath, "utf8").trim().split("\n");
  const incidents = lines.map(l => JSON.parse(l));
  console.log(`Loaded ${incidents.length} incidents from ${files[0]}`);
  
  // Load taxonomy
  const yamlText = fs.readFileSync(taxonomyPath, "utf8");
  const themes = parseTaxonomy(yamlText);
  console.log(`Loaded ${themes.length} themes from taxonomy`);
  
  // Copy taxonomy snapshot
  fs.copyFileSync(taxonomyPath, path.join(runDir, "taxonomy-snapshot.yml"));
  
  // Classify all incidents
  const signalIds = new Set(incidents.filter(i => i.SignalClass === "signal").map(i => i.IncidentId));
  
  const classifications = incidents.map(inc => {
    const result = classifyIncident(inc, themes);
    return {
      incidentId: inc.IncidentId,
      signalClass: inc.SignalClass,
      theme: result.theme,
      score: result.score,
      method: result.method,
      ambiguous: result.ambiguous,
      tiedWith: result.tiedWith,
      topScores: result.topScores
    };
  });
  
  // Quality gate (signal only)
  const gate = checkQualityGate(classifications, signalIds);
  
  // Print theme distribution
  const themeDist = {};
  const signalThemeDist = {};
  for (const c of classifications) {
    themeDist[c.theme] = (themeDist[c.theme] || 0) + 1;
    if (signalIds.has(c.incidentId)) {
      signalThemeDist[c.theme] = (signalThemeDist[c.theme] || 0) + 1;
    }
  }
  
  console.log("\n--- Theme Distribution (all incidents) ---");
  for (const [theme, count] of Object.entries(themeDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${theme}: ${count}`);
  }
  
  console.log("\n--- Theme Distribution (signal only) ---");
  for (const [theme, count] of Object.entries(signalThemeDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${theme}: ${count}`);
  }
  
  // Quality gate output
  console.log("\n--- Taxonomy Quality Gate ---");
  const a = gate.ambiguity;
  console.log(`  Ambiguous: ${a.count}/${a.total} (${(a.rate*100).toFixed(1)}%) — ${a.passed ? "✓ below" : "✗ ABOVE"} ${(a.threshold*100)}% threshold`);
  const u = gate.unclassified;
  console.log(`  Unclassified: ${u.count}/${u.total} (${(u.rate*100).toFixed(1)}%) — ${u.passed ? "✓ below" : "✗ ABOVE"} ${(u.threshold*100)}% threshold`);
  const co = gate.concentration;
  console.log(`  Largest theme: ${co.theme} — ${co.count}/${co.total} (${(co.rate*100).toFixed(1)}%) — ${co.passed ? "✓ below" : "✗ ABOVE"} ${(co.threshold*100)}% threshold`);
  console.log(`\n  Gate: ${gate.passed ? "✓ PASSED" : "✗ FAILED"}`);
  
  // Save results
  const outPath = path.join(runDir, "classified-incidents.json");
  fs.writeFileSync(outPath, JSON.stringify({ classifications, qualityGate: gate, themeDist, signalThemeDist }, null, 2));
  console.log(`\nSaved to ${outPath}`);
}

main();
