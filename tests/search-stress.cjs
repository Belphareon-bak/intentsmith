#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH Determinism Stress Test — 50-run batch
// ═══════════════════════════════════════════════════════════════════════════════
//
// Runs the same SEARCH query N times against the live C3 backend and measures:
//   - Language quality (CZ diacritics, SK contamination)
//   - Link presence (≥2 source URLs)
//   - Response length consistency
//   - QGv2 severity/score distribution
//   - Overall pass rate and variance
//
// SPUŠTĚNÍ:
//   1. Spusť C3 backend:  node src/server.js
//   2. Spusť test:        node tests/search-stress.cjs
//   3. Volitelně:          node tests/search-stress.cjs --runs 20 --query "custom query"
//                          node tests/search-stress.cjs --verbose
//                          node tests/search-stress.cjs --save stress-baseline.json
//
// ═══════════════════════════════════════════════════════════════════════════════

const http = require('http');
const fs = require('fs');

// ─── Configuration ──────────────────────────────────────────────────────────

const C3_URL = process.env.C3_URL || 'http://127.0.0.1:3335';
const TIMEOUT_MS = parseInt(process.env.E2E_TIMEOUT || '120000');
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
const SAVE_TO = process.argv.find((a, i) => process.argv[i - 1] === '--save');
const PAUSE_MS = parseInt(process.env.STRESS_PAUSE || '2000'); // pause between runs

// Parse --runs N (default 50)
const runsIdx = process.argv.indexOf('--runs');
const NUM_RUNS = runsIdx >= 0 ? parseInt(process.argv[runsIdx + 1], 10) : 50;

// Parse --query "..."
const queryIdx = process.argv.indexOf('--query');
const TEST_QUERY = queryIdx >= 0
  ? process.argv[queryIdx + 1]
  : 'Jaké jsou dnešní hlavní zprávy z České republiky?';

// ─── HTTP Client ────────────────────────────────────────────────────────────

function chatRequest(message, sessionId) {
  return new Promise((resolve, reject) => {
    const sid = sessionId || `stress-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const data = JSON.stringify({ message, session_id: sid });
    const url = new URL('/chat', C3_URL);

    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: TIMEOUT_MS,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, body: json, sessionId: sid });
        } catch {
          resolve({ status: res.statusCode, body: null, raw: body, sessionId: sid });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout after ${TIMEOUT_MS}ms`)); });
    req.write(data);
    req.end();
  });
}

// ─── Quality checks ─────────────────────────────────────────────────────────

const CZ_DIACRITICS = /[áčďéěíňóřšťúůýž]/i;
const SK_MARKERS = /\b(sú|ktorý|ktorá|ktoré|pretože|ešte|veľmi|veľký|veľká|dôležit|tieto|alebo|ďalš|niekoľko|preto)\b/gi;

function analyzeResponse(text) {
  const checks = {
    length: text.length,
    hasCzDiacritics: CZ_DIACRITICS.test(text),
    linkCount: (text.match(/https?:\/\/\S+/g) || []).length,
    hasLinks: (text.match(/https?:\/\/\S+/g) || []).length >= 2,
    skMarkers: (text.match(SK_MARKERS) || []),
    skCount: (text.match(SK_MARKERS) || []).length,
    hasSources: /\*\*Zdroje:\*\*/i.test(text),
    wordCount: text.split(/\s+/).filter(w => w.length > 0).length,
  };

  // Pass criteria for SEARCH response:
  // 1. Has CZ diacritics (response is in Czech)
  // 2. Has ≥2 links (source URLs)
  // 3. Length > 200 chars (substantial content)
  // 4. No SK contamination (0 SK markers)
  checks.pass = checks.hasCzDiacritics
    && checks.hasLinks
    && checks.length > 200
    && checks.skCount === 0;

  return checks;
}

// ─── Statistics ──────────────────────────────────────────────────────────────

function computeStats(values) {
  if (values.length === 0) return { min: 0, max: 0, mean: 0, median: 0, stddev: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / sorted.length;
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Math.round(mean * 100) / 100,
    median,
    stddev: Math.round(Math.sqrt(variance) * 100) / 100,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        SEARCH DETERMINISM STRESS TEST                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`  Query:  "${TEST_QUERY}"`);
  console.log(`  Runs:   ${NUM_RUNS}`);
  console.log(`  Server: ${C3_URL}`);
  console.log(`  Pause:  ${PAUSE_MS}ms between runs`);
  console.log();

  // Verify server is reachable
  try {
    await chatRequest('test', `stress-ping-${Date.now()}`);
  } catch (err) {
    console.error(`❌ Cannot reach C3 server at ${C3_URL}: ${err.message}`);
    console.error('   Start it with: node src/server.js');
    process.exit(1);
  }

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < NUM_RUNS; i++) {
    const runNum = i + 1;
    const sid = `stress-${Date.now()}-r${runNum}`;
    const runStart = Date.now();

    try {
      const res = await chatRequest(TEST_QUERY, sid);
      const duration = Date.now() - runStart;
      const text = res.body?.response || res.body?.content || '';

      if (!text) {
        console.log(`  [${String(runNum).padStart(3)}/${NUM_RUNS}] ❌ Empty response (${duration}ms)`);
        results.push({ run: runNum, pass: false, error: 'empty', duration });
        continue;
      }

      const analysis = analyzeResponse(text);
      analysis.duration = duration;
      analysis.run = runNum;

      // Extract QG data if available
      if (res.body?.qualityGate) {
        analysis.qgSeverity = res.body.qualityGate.severity;
        analysis.qgScore = res.body.qualityGate.score;
        analysis.qgScoreRaw = res.body.qualityGate.scoreRaw;
        analysis.qgFixes = res.body.qualityGate.fixes;
      }

      results.push(analysis);

      const icon = analysis.pass ? '✅' : '❌';
      const issues = [];
      if (!analysis.hasCzDiacritics) issues.push('no-CZ');
      if (!analysis.hasLinks) issues.push(`links:${analysis.linkCount}`);
      if (analysis.skCount > 0) issues.push(`SK:${analysis.skCount}`);
      if (analysis.length <= 200) issues.push(`short:${analysis.length}`);
      const issueStr = issues.length > 0 ? ` [${issues.join(', ')}]` : '';
      const scoreStr = analysis.qgScore !== undefined ? ` score:${analysis.qgScore}/${analysis.qgScoreRaw || '?'}` : '';

      console.log(`  [${String(runNum).padStart(3)}/${NUM_RUNS}] ${icon} ${analysis.length} chars, ${analysis.linkCount} links, ${analysis.wordCount} words${scoreStr}${issueStr} (${duration}ms)`);

      if (VERBOSE && !analysis.pass) {
        console.log(`         Response: "${text.substring(0, 200)}..."`);
        if (analysis.skMarkers.length > 0) {
          console.log(`         SK markers: ${analysis.skMarkers.join(', ')}`);
        }
      }
    } catch (err) {
      const duration = Date.now() - runStart;
      console.log(`  [${String(runNum).padStart(3)}/${NUM_RUNS}] ❌ ERROR: ${err.message} (${duration}ms)`);
      results.push({ run: runNum, pass: false, error: err.message, duration });
    }

    // Pause between runs to avoid overloading
    if (i < NUM_RUNS - 1) {
      await new Promise(r => setTimeout(r, PAUSE_MS));
    }
  }

  const totalDuration = Date.now() - startTime;

  // ─── Aggregate stats ──────────────────────────────────────────────────────

  const passed = results.filter(r => r.pass);
  const failed = results.filter(r => !r.pass);
  const errors = results.filter(r => r.error);
  const valid = results.filter(r => !r.error);

  const lengths = valid.map(r => r.length);
  const linkCounts = valid.map(r => r.linkCount);
  const skCounts = valid.map(r => r.skCount);
  const durations = results.map(r => r.duration).filter(Boolean);
  const scores = valid.map(r => r.qgScore).filter(s => s !== undefined);

  const lengthStats = computeStats(lengths);
  const linkStats = computeStats(linkCounts);
  const durationStats = computeStats(durations);
  const scoreStats = computeStats(scores);

  // SK contamination rate
  const skContaminated = valid.filter(r => r.skCount > 0).length;
  // Missing links rate
  const noLinks = valid.filter(r => !r.hasLinks).length;

  console.log();
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log();
  console.log(`  Pass rate:       ${passed.length}/${results.length} (${Math.round(passed.length / results.length * 100)}%)`);
  console.log(`  Errors:          ${errors.length}`);
  console.log(`  Total time:      ${Math.round(totalDuration / 1000)}s`);
  console.log();
  console.log('  ─── Response Length ───────────────────────────────────────');
  console.log(`    Min: ${lengthStats.min}  Max: ${lengthStats.max}  Mean: ${lengthStats.mean}  Median: ${lengthStats.median}  StdDev: ${lengthStats.stddev}`);
  console.log();
  console.log('  ─── Link Count ───────────────────────────────────────────');
  console.log(`    Min: ${linkStats.min}  Max: ${linkStats.max}  Mean: ${linkStats.mean}  Median: ${linkStats.median}`);
  console.log(`    Missing links (< 2): ${noLinks}/${valid.length} (${valid.length > 0 ? Math.round(noLinks / valid.length * 100) : 0}%)`);
  console.log();
  console.log('  ─── SK Contamination ─────────────────────────────────────');
  console.log(`    Contaminated: ${skContaminated}/${valid.length} (${valid.length > 0 ? Math.round(skContaminated / valid.length * 100) : 0}%)`);
  if (skContaminated > 0) {
    const skAll = valid.filter(r => r.skCount > 0).flatMap(r => r.skMarkers);
    const skFreq = {};
    for (const w of skAll) { skFreq[w.toLowerCase()] = (skFreq[w.toLowerCase()] || 0) + 1; }
    const topSK = Object.entries(skFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log(`    Top SK words: ${topSK.map(([w, c]) => `${w}(${c})`).join(', ')}`);
  }
  console.log();
  console.log('  ─── Duration (ms) ────────────────────────────────────────');
  console.log(`    Min: ${durationStats.min}  Max: ${durationStats.max}  Mean: ${durationStats.mean}  Median: ${durationStats.median}`);
  console.log();
  if (scores.length > 0) {
    console.log('  ─── QGv2 Score ───────────────────────────────────────────');
    console.log(`    Min: ${scoreStats.min}  Max: ${scoreStats.max}  Mean: ${scoreStats.mean}  Median: ${scoreStats.median}`);
    // Score distribution buckets
    const buckets = { '0 (clean)': 0, '1-10': 0, '11-25': 0, '26-50': 0, '51+': 0 };
    for (const s of scores) {
      if (s === 0) buckets['0 (clean)']++;
      else if (s <= 10) buckets['1-10']++;
      else if (s <= 25) buckets['11-25']++;
      else if (s <= 50) buckets['26-50']++;
      else buckets['51+']++;
    }
    console.log(`    Distribution: ${Object.entries(buckets).map(([k, v]) => `${k}: ${v}`).join('  ')}`);
    console.log();
  }

  // ─── Failure breakdown ─────────────────────────────────────────────────────

  if (failed.length > 0) {
    console.log('  ─── Failure Reasons ──────────────────────────────────────');
    const reasons = { 'no-CZ': 0, 'missing-links': 0, 'sk-contamination': 0, 'too-short': 0, 'error': 0 };
    for (const r of failed) {
      if (r.error) reasons['error']++;
      else {
        if (!r.hasCzDiacritics) reasons['no-CZ']++;
        if (!r.hasLinks) reasons['missing-links']++;
        if (r.skCount > 0) reasons['sk-contamination']++;
        if (r.length <= 200) reasons['too-short']++;
      }
    }
    for (const [reason, count] of Object.entries(reasons)) {
      if (count > 0) console.log(`    ${reason}: ${count}`);
    }
    console.log();
  }

  console.log('══════════════════════════════════════════════════════════════════');

  // ─── Save results ──────────────────────────────────────────────────────────

  if (SAVE_TO) {
    const output = {
      timestamp: new Date().toISOString(),
      query: TEST_QUERY,
      numRuns: NUM_RUNS,
      totalDuration: totalDuration,
      passRate: passed.length / results.length,
      stats: { length: lengthStats, links: linkStats, duration: durationStats, score: scoreStats },
      skContaminationRate: valid.length > 0 ? skContaminated / valid.length : 0,
      missingLinksRate: valid.length > 0 ? noLinks / valid.length : 0,
      results: results,
    };
    fs.writeFileSync(SAVE_TO, JSON.stringify(output, null, 2));
    console.log(`  Saved to: ${SAVE_TO}`);
  }

  // Exit code: fail if pass rate < 80%
  const passRate = passed.length / results.length;
  process.exit(passRate >= 0.80 ? 0 : 1);
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
