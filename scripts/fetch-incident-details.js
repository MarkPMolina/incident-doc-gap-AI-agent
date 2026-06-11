#!/usr/bin/env node
/**
 * fetch-incident-details.js
 * 
 * Batch-fetches full incident details from the incident management API.
 * Sequential with retry/resume support. Saves checkpoint every 50 records.
 * 
 * Usage:
 *   node fetch-incident-details.js <runDir>
 * 
 * Inputs:
 *   {runDir}/incident-ids.txt — one incident ID per line
 * 
 * Outputs:
 *   {runDir}/incident-details-raw.json — array of full incident detail objects
 * 
 * Environment:
 *   INCIDENT_API_ENDPOINT — base URL for the incident API
 *   INCIDENT_API_SCOPE — OAuth scope for token acquisition
 */

const { execSync } = require("child_process");
const https = require("https");
const fs = require("fs");
const path = require("path");

const INCIDENT_ENDPOINT = process.env.INCIDENT_API_ENDPOINT || "{INCIDENT_API_ENDPOINT}";
const INCIDENT_SCOPE = process.env.INCIDENT_API_SCOPE || "{INCIDENT_API_SCOPE}";

let tokenCache = { token: null, expiresAt: 0 };
let sessionId = null;
let requestId = 1;

function getAuthToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 300000) return tokenCache.token;
  const result = execSync(
    `az account get-access-token --scope "${INCIDENT_SCOPE}" --query "{token:accessToken,expires:expiresOn}" -o json`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
  );
  const parsed = JSON.parse(result);
  tokenCache.token = parsed.token;
  tokenCache.expiresAt = new Date(parsed.expires).getTime();
  return tokenCache.token;
}

function httpRequest(body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const token = getAuthToken();
    const url = new URL(INCIDENT_ENDPOINT);
    const payload = JSON.stringify(body);
    const headers = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Content-Length": Buffer.byteLength(payload),
      ...extraHeaders,
    };
    const req = https.request({ hostname: url.hostname, path: url.pathname, method: "POST", headers }, (res) => {
      let data = "";
      const sh = res.headers["mcp-session-id"];
      if (sh) sessionId = sh;
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 300)}`));
          return;
        }
        try {
          const content = data.replace(/^event: message\s*data: /s, "").trim();
          const json = JSON.parse(content);
          if (json.error) reject(new Error(json.error.message || JSON.stringify(json.error)));
          else resolve(json.result);
        } catch (e) {
          reject(new Error(`Parse error: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function ensureSession() {
  if (sessionId) return;
  console.log("  Initializing API session...");
  await httpRequest({ jsonrpc: "2.0", id: requestId++, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "batch-fetch", version: "1.0.0" } } });
  const h = sessionId ? { "Mcp-Session-Id": sessionId } : {};
  await httpRequest({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, h).catch(() => {});
  console.log(`  Session: ${sessionId}`);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchDetail(id) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const body = { jsonrpc: "2.0", id: requestId++, method: "tools/call", params: { name: "get_incident_details_by_id", arguments: { incidentId: String(id) } } };
      const headers = sessionId ? { "Mcp-Session-Id": sessionId } : {};
      const result = await httpRequest(body, headers);
      const content = result.content && result.content[0] && result.content[0].text;
      if (content) return JSON.parse(content);
      return result;
    } catch (e) {
      if (attempt === 2) { return { _error: true, id, message: e.message }; }
      // Reset session and retry with backoff
      sessionId = null;
      await delay(2000 * (attempt + 1));
      await ensureSession();
    }
  }
}

async function main() {
  const runDir = process.argv[2] || __dirname;
  const idsFile = path.join(runDir, "incident-ids.txt");
  const ids = fs.readFileSync(idsFile, "utf8").trim().split("\n").map(s => s.trim()).filter(Boolean);
  
  // Resume support: check for existing partial results
  const outPath = path.join(runDir, "incident-details-raw.json");
  let results = [];
  let doneIds = new Set();
  if (fs.existsSync(outPath)) {
    try {
      results = JSON.parse(fs.readFileSync(outPath, "utf8"));
      results.forEach(r => { if (r.id) doneIds.add(String(r.id)); });
      console.log(`Resuming: ${doneIds.size} already fetched`);
    } catch(e) {}
  }
  
  const remaining = ids.filter(id => !doneIds.has(id));
  console.log(`Fetching details for ${remaining.length} incidents (sequential, ${ids.length} total)...`);

  await ensureSession();
  
  let done = doneIds.size;
  let failed = 0;

  for (let i = 0; i < remaining.length; i++) {
    const r = await fetchDetail(remaining[i]);
    if (r && !r._error) {
      results.push(r);
    } else {
      failed++;
      if (r) console.log(`\n  FAILED ${remaining[i]}: ${r.message}`);
    }
    done++;
    if (done % 10 === 0) {
      process.stdout.write(`\r  Progress: ${done}/${ids.length} (${failed} failed)`);
      // Save checkpoint every 50
      if (done % 50 === 0) {
        fs.writeFileSync(outPath, JSON.stringify(results));
      }
    }
    // Small delay to avoid rate limiting
    await delay(200);
  }

  console.log(`\nDone. ${results.length} succeeded, ${failed} failed.`);
  fs.writeFileSync(outPath, JSON.stringify(results));
  console.log(`Saved to ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
