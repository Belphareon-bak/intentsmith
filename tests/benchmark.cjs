#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent Quality Benchmark — Deterministic LLM Quality Measurement
// ═══════════════════════════════════════════════════════════════════════════════
//
// Measures: score distribution, retry rate, drift, tail risk, bifurcation.
// 6 categories × N runs per query. Pure numbers, no feelings.
//
// SPUŠTĚNÍ:
//   node tests/benchmark.cjs                          # quick (N=3, all categories)
//   node tests/benchmark.cjs --runs 30                # full benchmark
//   node tests/benchmark.cjs --category SEARCH        # one category
//   node tests/benchmark.cjs --category SEARCH --runs 50 --save search.json
//   node tests/benchmark.cjs --query SEARCH:0 --runs 100  # bifurcation test
//   node tests/benchmark.cjs --verbose
//
// ═══════════════════════════════════════════════════════════════════════════════

const http = require('http');
const fs = require('fs');

// ─── Configuration ──────────────────────────────────────────────────────────

const C3_URL = process.env.C3_URL || 'http://127.0.0.1:3335';
const TIMEOUT_MS = parseInt(process.env.BENCH_TIMEOUT || '120000');
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
const SAVE_TO = process.argv.find((a, i) => process.argv[i - 1] === '--save');
const PAUSE_MS = parseInt(process.env.BENCH_PAUSE || '2000');

const runsIdx = process.argv.indexOf('--runs');
const NUM_RUNS = runsIdx >= 0 ? parseInt(process.argv[runsIdx + 1], 10) : 3;

const catIdx = process.argv.indexOf('--category');
const CATEGORY_FILTER = catIdx >= 0 ? process.argv[catIdx + 1].toUpperCase() : null;

// --query SEARCH:0 → run single query from category
const qIdx = process.argv.indexOf('--query');
const QUERY_FILTER = qIdx >= 0 ? process.argv[qIdx + 1] : null;

// ─── Test Matrix ────────────────────────────────────────────────────────────

const CATEGORIES = {
  SEARCH: {
    label: 'Vyhledávání (Internet Search)',
    queries: [
      { q: 'Jaké jsou dnešní hlavní zprávy z České republiky?', expect: { minLen: 200, links: 2, cz: true } },
      { q: 'Co se děje na Ukrajině? Shrň aktuální situaci.', expect: { minLen: 300, links: 2, cz: true } },
      { q: 'Novinky ze světa technologií tento týden', expect: { minLen: 200, links: 2, cz: true } },
      { q: 'Najdi mi 3 inzeráty na použitou Škodu Octavia do 300 000 Kč', expect: { minLen: 200, links: 1, cz: true } },
      { q: 'Hledám pronájem bytu 2+1 v Brně do 15 000 Kč měsíčně', expect: { minLen: 200, links: 1, cz: true } },
      { q: 'Najdi mi 3 nabídky práce pro programátora v Praze', expect: { minLen: 200, links: 1, cz: true } },
      { q: 'Jaké jsou specifikace iPhone 16 Pro? Uveď zdroj.', expect: { minLen: 200, links: 1, cz: true } },
      { q: 'Porovnej parametry AMD Ryzen 7 9800X3D a Intel Core i7-14700K', expect: { minLen: 300, links: 1, cz: true } },
      { q: 'Jaká je spotřeba a výkon nové Škoda Enyaq Coupé RS?', expect: { minLen: 200, links: 1, cz: true } },
      { q: 'Jaká je aktuální cena Bitcoinu v korunách?', expect: { minLen: 100, links: 1, cz: true, number: true } },
    ],
  },
  FAKTA: {
    label: 'Fakta (Factual)',
    queries: [
      { q: 'Kolik je hodin?', expect: { number: true, cz: true } },
      { q: 'Jaký je dnes den a datum?', expect: { cz: true } },
      { q: 'Kdy bude příští úplněk?', expect: { cz: true } },
      { q: 'Jaký je aktuální kurz eura vůči koruně?', expect: { number: true, cz: true } },
      { q: 'Jaké je dnes počasí v Praze?', expect: { cz: true, minLen: 50 } },
      { q: 'Kdo je aktuální prezident České republiky?', expect: { cz: true, minLen: 100 } },
      { q: 'Kdo je Elon Musk a čím se proslavil?', expect: { cz: true, minLen: 200 } },
      { q: 'Kolik obyvatel má Česká republika?', expect: { number: true, cz: true } },
      { q: 'Kdy začíná astronomické léto 2025?', expect: { cz: true } },
      { q: 'Jaká je vzdálenost Země od Slunce?', expect: { number: true, cz: true } },
    ],
  },
  TECH: {
    label: 'Technická expertíza (Technical)',
    queries: [
      { q: 'Jak vytvořit mobilní aplikaci? Jaké jsou kroky a technologie?', expect: { minLen: 400, cz: true } },
      { q: 'Vysvětli mi rozdíl mezi REST a GraphQL API — kdy použít co?', expect: { minLen: 300, cz: true } },
      { q: 'Jak nastavit CI/CD pipeline pro Node.js projekt?', expect: { minLen: 300, cz: true } },
      { q: 'Jak zabezpečit webovou aplikaci proti nejčastějším útokům?', expect: { minLen: 300, cz: true } },
      { q: 'Jak funguje Docker a k čemu je dobrý?', expect: { minLen: 300, cz: true } },
      { q: 'Popiš architekturu microservices — výhody, nevýhody, kdy použít?', expect: { minLen: 300, cz: true } },
      { q: 'Python vs JavaScript — kdy použít který jazyk?', expect: { minLen: 300, cz: true } },
      { q: 'Porovnej PostgreSQL a MongoDB — výhody a nevýhody', expect: { minLen: 300, cz: true } },
      { q: 'Linux vs Windows pro vývojáře — co je lepší?', expect: { minLen: 300, cz: true } },
      { q: 'Porovnej React, Vue a Angular — který framework zvolit?', expect: { minLen: 300, cz: true } },
    ],
  },
  STRICT: {
    label: 'Striktní / Expert (Strict)',
    queries: [
      { q: 'Jak vypočítat DPH z částky 10 000 Kč? Ukaž postup.', expect: { number: true, cz: true, minLen: 100 } },
      { q: 'Jaké jsou povinnosti OSVČ při podání daňového přiznání?', expect: { cz: true, minLen: 200 } },
      { q: 'Co musí obsahovat pracovní smlouva podle zákoníku práce?', expect: { cz: true, minLen: 200 } },
      { q: 'Jaké jsou povinnosti firmy podle GDPR?', expect: { cz: true, minLen: 200 } },
      { q: 'Jak správně vystavit fakturu pro zahraniční odběratele v EU?', expect: { cz: true, minLen: 200 } },
    ],
  },
  MERGE: {
    label: 'Merge scénáře (Multi-domain)',
    queries: [
      { q: 'Chci rozjet e-shop — jakou technologii použít, jaké jsou daňové povinnosti a jak řešit marketing?', expect: { cz: true, minLen: 400 } },
      { q: 'Plánuji migraci firemních systémů do cloudu — jaké jsou náklady, bezpečnostní rizika a doporučené technologie?', expect: { cz: true, minLen: 400 } },
      { q: 'Chci vytvořit smart home systém — jaké IoT protokoly použít, jak řešit elektroinstalaci a zabezpečení?', expect: { cz: true, minLen: 300 } },
      { q: 'Jak napsat podnikatelský plán pro tech startup? Zahrň finance, technologii i právní aspekty.', expect: { cz: true, minLen: 400 } },
      { q: 'Porovnej self-hosted vs cloud hosting — náklady, bezpečnost, výkon a správa.', expect: { cz: true, minLen: 300 } },
    ],
  },
  EDGE: {
    label: 'Edge cases',
    queries: [
      { q: 'Ahoj', expect: { cz: true } },
      { q: 'To je zajímavé, řekni mi víc', expect: { cz: true } },
      { q: 'What is the capital of Czech Republic? Answer in Czech.', expect: { cz: true } },
      { q: 'Jak se řekne "database" česky a anglicky?', expect: { cz: true } },
      { q: 'Řekni mi vtip', expect: { cz: true } },
      { q: 'Shrň mi na 3 věty co je React', expect: { cz: true, minLen: 50 } },
      { q: 'a', expect: {} },
      { q: 'Jaký je nejlepší?', expect: { cz: true } },
      { q: 'Dobrý den, potřebuji pomoc s jednou věcí ale vlastně ne, děkuji', expect: { cz: true } },
      { q: 'Compare Docker and Kubernetes briefly. Odpověz česky.', expect: { cz: true, minLen: 100 } },
    ],
  },
};

// ─── HTTP Client ────────────────────────────────────────────────────────────

function chatRequest(message, sessionId) {
  return new Promise((resolve, reject) => {
    const sid = sessionId || `bench-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout ${TIMEOUT_MS}ms`)); });
    req.write(data);
    req.end();
  });
}

// ─── Client-side Quality Analysis ───────────────────────────────────────────
// Mirrors QGv2 scoring logic but runs on the FINAL output (post-QG).
// Measures what the USER actually sees.

const CZ_DIACRITICS = /[áčďéěíňóřšťúůýž]/i;
const SK_MARKERS_RE = /(?:^|\s)(sú|ktorý|ktorá|ktoré|pretože|ešte|veľmi|veľký|veľká|dôležit|tieto|ďalš|niekoľko|preto|ľ)(?:\s|[.,;:!?]|$)/gi;
const ZOMBIE_RE = /^(Jako jazykový model|Jako AI|Jako umělá inteligence|Omlouvám se,?\s+(ale\s+)?(nemohu|nemůžu)|I apologize|As a language model|As an AI)/i;
const LINK_RE = /https?:\/\/\S+/g;

function analyzeResponse(text, expect) {
  const t = {
    length: text.length,
    wordCount: text.split(/\s+/).filter(w => w.length > 0).length,
    hasCzDiacritics: CZ_DIACRITICS.test(text),
    linkCount: (text.match(LINK_RE) || []).length,
    skMarkers: (text.match(SK_MARKERS_RE) || []).map(m => m.trim()),
    skCount: (text.match(SK_MARKERS_RE) || []).length,
    hasNumber: /\d/.test(text),
    isZombie: ZOMBIE_RE.test(text.substring(0, 300)),
    isSparse: text.replace(/[#*_~`>|]/g, '').replace(/\s+/g, ' ').trim().length < 20,
    hasSources: /\*\*Zdroje:\*\*/i.test(text),
  };

  // Compute client-side score (0-100, 0=perfect)
  let score = 0;
  if (t.isZombie) score += 40;
  if (t.isSparse) score += 35;
  if (t.skCount > 0) score += Math.min(20, t.skCount * 5);
  if (expect.cz && !t.hasCzDiacritics && text.length > 20) score += 15;
  if (expect.links && t.linkCount < expect.links) score += 20;
  if (expect.minLen && t.length < expect.minLen) score += 15;
  if (expect.number && !t.hasNumber) score += 10;
  t.score = Math.min(100, score);

  // Pass/fail
  t.pass = t.score < 20;

  return t;
}

// ─── Statistics ──────────────────────────────────────────────────────────────

function stats(values) {
  if (values.length === 0) return { n: 0, min: 0, max: 0, mean: 0, median: 0, stddev: 0, p95: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const p95idx = Math.min(n - 1, Math.floor(n * 0.95));
  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    mean: r2(mean),
    median,
    stddev: r2(Math.sqrt(variance)),
    p95: sorted[p95idx],
  };
}

function r2(v) { return Math.round(v * 100) / 100; }

// ─── Bifurcation Detection ──────────────────────────────────────────────────
// Detects bimodal score distribution (e.g., peak at 0-10 AND peak at 30-50).
// Uses gap analysis: if there's a gap of ≥10 points with no scores, and
// significant mass on both sides, it's bifurcated.

function detectBifurcation(scores) {
  if (scores.length < 10) return { bifurcated: false, reason: 'insufficient_data' };

  // Build histogram (buckets of 5)
  const buckets = {};
  for (const s of scores) {
    const b = Math.floor(s / 5) * 5;
    buckets[b] = (buckets[b] || 0) + 1;
  }

  const bucketKeys = Object.keys(buckets).map(Number).sort((a, b) => a - b);
  if (bucketKeys.length < 2) return { bifurcated: false, reason: 'single_cluster' };

  // Find gaps ≥ 10 points (2 empty buckets)
  for (let i = 0; i < bucketKeys.length - 1; i++) {
    const gap = bucketKeys[i + 1] - bucketKeys[i];
    if (gap >= 10) {
      // Check mass on both sides
      const leftMass = bucketKeys.slice(0, i + 1).reduce((s, k) => s + buckets[k], 0);
      const rightMass = bucketKeys.slice(i + 1).reduce((s, k) => s + buckets[k], 0);
      const minMass = Math.min(leftMass, rightMass);
      // Both sides need ≥ 20% of total
      if (minMass / scores.length >= 0.2) {
        return {
          bifurcated: true,
          gapStart: bucketKeys[i] + 5,
          gapEnd: bucketKeys[i + 1],
          leftPeak: bucketKeys[0] + '-' + (bucketKeys[i] + 4),
          rightPeak: bucketKeys[i + 1] + '-' + (bucketKeys[bucketKeys.length - 1] + 4),
          leftMass: r2(leftMass / scores.length * 100),
          rightMass: r2(rightMass / scores.length * 100),
        };
      }
    }
  }

  return { bifurcated: false, reason: 'no_significant_gap' };
}

// ─── Drift Cluster Detection ────────────────────────────────────────────────
// Same query producing wildly different scores = non-determinism.
// Flag if stddev > 15 or range > 40.

function detectDrift(scores) {
  const s = stats(scores);
  const range = s.max - s.min;
  return {
    drifting: s.stddev > 15 || range > 40,
    stddev: s.stddev,
    range,
    concern: s.stddev > 25 ? 'CRITICAL' : s.stddev > 15 ? 'HIGH' : range > 40 ? 'MODERATE' : 'NONE',
  };
}

// ─── Score Distribution Histogram ───────────────────────────────────────────

function scoreHistogram(scores) {
  const buckets = { '0 (clean)': 0, '1-10': 0, '11-20': 0, '21-30': 0, '31-50': 0, '51-70': 0, '71+': 0 };
  for (const s of scores) {
    if (s === 0) buckets['0 (clean)']++;
    else if (s <= 10) buckets['1-10']++;
    else if (s <= 20) buckets['11-20']++;
    else if (s <= 30) buckets['21-30']++;
    else if (s <= 50) buckets['31-50']++;
    else if (s <= 70) buckets['51-70']++;
    else buckets['71+']++;
  }
  return buckets;
}

// ─── Quality Thresholds ─────────────────────────────────────────────────────

const THRESHOLDS = {
  SEARCH: { passRate: 0.90, maxStddev: 8, maxLanguageDrift: 0.03, maxTailRisk: 0.05 },
  FAKTA:  { passRate: 0.85, maxStddev: 10, maxLanguageDrift: 0.05, maxTailRisk: 0.08 },
  TECH:   { passRate: 0.90, maxStddev: 8, maxLanguageDrift: 0.03, maxTailRisk: 0.05 },
  STRICT: { passRate: 0.85, maxStddev: 10, maxLanguageDrift: 0.05, maxTailRisk: 0.08 },
  MERGE:  { passRate: 0.80, maxStddev: 12, maxLanguageDrift: 0.05, maxTailRisk: 0.10 },
  EDGE:   { passRate: 0.70, maxStddev: 15, maxLanguageDrift: 0.10, maxTailRisk: 0.15 },
};

// ─── Main Runner ────────────────────────────────────────────────────────────

async function runBenchmark() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           C3-AGENT QUALITY BENCHMARK                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`  Server:     ${C3_URL}`);
  console.log(`  Runs/query: ${NUM_RUNS}`);
  console.log(`  Category:   ${CATEGORY_FILTER || 'ALL'}`);
  console.log(`  Query:      ${QUERY_FILTER || 'ALL'}`);
  console.log(`  Pause:      ${PAUSE_MS}ms`);
  console.log();

  // Verify server
  try {
    await chatRequest('ping', `bench-ping-${Date.now()}`);
    console.log('  Server: OK');
  } catch (err) {
    console.error(`  ❌ Server unreachable: ${err.message}`);
    console.error('     Start with: node src/server.js');
    process.exit(1);
  }
  console.log();

  const allTelemetry = [];
  const categoryResults = {};
  const startTime = Date.now();

  // Filter categories
  const categoriesToRun = CATEGORY_FILTER
    ? { [CATEGORY_FILTER]: CATEGORIES[CATEGORY_FILTER] }
    : CATEGORIES;

  if (CATEGORY_FILTER && !CATEGORIES[CATEGORY_FILTER]) {
    console.error(`  ❌ Unknown category: ${CATEGORY_FILTER}`);
    console.error(`     Available: ${Object.keys(CATEGORIES).join(', ')}`);
    process.exit(1);
  }

  for (const [catName, cat] of Object.entries(categoriesToRun)) {
    console.log(`═══ ${catName}: ${cat.label} ${'═'.repeat(Math.max(1, 50 - catName.length - cat.label.length))}`)
    console.log();

    const catTelemetry = [];

    // Filter queries
    let queriesToRun = cat.queries.map((q, i) => ({ ...q, idx: i }));
    if (QUERY_FILTER) {
      const [qCat, qIdx] = QUERY_FILTER.split(':');
      if (qCat.toUpperCase() === catName) {
        const idx = parseInt(qIdx, 10);
        if (idx >= 0 && idx < cat.queries.length) {
          queriesToRun = [{ ...cat.queries[idx], idx }];
        }
      } else {
        continue; // Skip this category
      }
    }

    for (const query of queriesToRun) {
      const qLabel = `${catName}:${query.idx}`;
      const qShort = query.q.length > 50 ? query.q.substring(0, 47) + '...' : query.q;
      console.log(`  [${qLabel}] "${qShort}"`);

      const runResults = [];

      for (let run = 0; run < NUM_RUNS; run++) {
        const sid = `bench-${catName}-${query.idx}-r${run}-${Date.now()}`;
        const runStart = Date.now();

        try {
          const res = await chatRequest(query.q, sid);
          const duration = Date.now() - runStart;
          const text = res.body?.response || res.body?.content || '';

          if (!text || text.length === 0) {
            const telemetry = {
              category: catName, queryIdx: query.idx, query: query.q,
              run, duration, score: 100, error: 'empty_response',
              length: 0, linkCount: 0, skCount: 0, pass: false,
            };
            runResults.push(telemetry);
            allTelemetry.push(telemetry);
            catTelemetry.push(telemetry);
            if (VERBOSE) console.log(`    r${run}: ❌ EMPTY (${duration}ms)`);
            continue;
          }

          const analysis = analyzeResponse(text, query.expect);
          const telemetry = {
            category: catName,
            queryIdx: query.idx,
            query: query.q,
            run,
            duration,
            score: analysis.score,
            length: analysis.length,
            wordCount: analysis.wordCount,
            linkCount: analysis.linkCount,
            skCount: analysis.skCount,
            skMarkers: analysis.skMarkers,
            hasCzDiacritics: analysis.hasCzDiacritics,
            hasNumber: analysis.hasNumber,
            isZombie: analysis.isZombie,
            isSparse: analysis.isSparse,
            hasSources: analysis.hasSources,
            pass: analysis.pass,
            model: res.body?.model,
          };

          runResults.push(telemetry);
          allTelemetry.push(telemetry);
          catTelemetry.push(telemetry);

          if (VERBOSE) {
            const icon = analysis.pass ? '✅' : '❌';
            console.log(`    r${run}: ${icon} score:${analysis.score} len:${analysis.length} links:${analysis.linkCount} sk:${analysis.skCount} (${duration}ms)`);
          }
        } catch (err) {
          const duration = Date.now() - runStart;
          const telemetry = {
            category: catName, queryIdx: query.idx, query: query.q,
            run, duration, score: 100, error: err.message,
            length: 0, linkCount: 0, skCount: 0, pass: false,
          };
          runResults.push(telemetry);
          allTelemetry.push(telemetry);
          catTelemetry.push(telemetry);
          if (VERBOSE) console.log(`    r${run}: ❌ ERROR: ${err.message}`);
        }

        if (run < NUM_RUNS - 1) await new Promise(r => setTimeout(r, PAUSE_MS));
      }

      // Per-query stats
      const scores = runResults.map(r => r.score);
      const s = stats(scores);
      const drift = detectDrift(scores);
      const passRate = runResults.filter(r => r.pass).length / runResults.length;
      const skRate = runResults.filter(r => r.skCount > 0).length / runResults.length;

      const bar = makeBar(passRate, 20);
      const driftFlag = drift.drifting ? ` ⚠DRIFT(σ=${drift.stddev})` : '';
      console.log(`    ${bar} ${r2(passRate * 100)}% pass  score: μ=${s.mean} σ=${s.stddev} [${s.min}-${s.max}]${driftFlag}`);

      if (scores.length >= 10) {
        const bif = detectBifurcation(scores);
        if (bif.bifurcated) {
          console.log(`    ⚠ BIFURCATION: ${bif.leftPeak} (${bif.leftMass}%) gap ${bif.gapStart}-${bif.gapEnd} ${bif.rightPeak} (${bif.rightMass}%)`);
        }
      }
      console.log();
    }

    // Per-category aggregate
    const catScores = catTelemetry.map(r => r.score);
    const catStats = stats(catScores);
    const catPassRate = catTelemetry.filter(r => r.pass).length / catTelemetry.length;
    const catSkRate = catTelemetry.filter(r => r.skCount > 0).length / (catTelemetry.filter(r => !r.error).length || 1);
    const catTailRisk = catTelemetry.filter(r => r.score > 50).length / catTelemetry.length;
    const threshold = THRESHOLDS[catName];

    categoryResults[catName] = {
      passRate: r2(catPassRate),
      scoreStats: catStats,
      skRate: r2(catSkRate),
      tailRisk: r2(catTailRisk),
      histogram: scoreHistogram(catScores),
      meetsThreshold: threshold ? {
        passRate: catPassRate >= threshold.passRate,
        stddev: catStats.stddev <= threshold.maxStddev,
        languageDrift: catSkRate <= threshold.maxLanguageDrift,
        tailRisk: catTailRisk <= threshold.maxTailRisk,
      } : null,
    };
  }

  const totalDuration = Date.now() - startTime;

  // ─── Summary ────────────────────────────────────────────────────────────────

  console.log();
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                      SUMMARY                               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();

  for (const [catName, cr] of Object.entries(categoryResults)) {
    const th = cr.meetsThreshold;
    const thresholdStr = th
      ? ` [${th.passRate ? '✓' : '✗'}pass ${th.stddev ? '✓' : '✗'}σ ${th.languageDrift ? '✓' : '✗'}SK ${th.tailRisk ? '✓' : '✗'}tail]`
      : '';
    const bar = makeBar(cr.passRate, 20);
    console.log(`  ${catName.padEnd(8)} ${bar} ${(cr.passRate * 100).toFixed(0)}% pass  μ=${cr.scoreStats.mean} σ=${cr.scoreStats.stddev} p95=${cr.scoreStats.p95} tail=${(cr.tailRisk * 100).toFixed(0)}%${thresholdStr}`);
  }

  console.log();
  console.log('  ─── Score Distribution (all runs) ─────────────────────────');
  const allScores = allTelemetry.map(r => r.score);
  const allHist = scoreHistogram(allScores);
  const allStats = stats(allScores);
  for (const [bucket, count] of Object.entries(allHist)) {
    const pct = allScores.length > 0 ? r2(count / allScores.length * 100) : 0;
    const bar = '█'.repeat(Math.round(pct / 2));
    console.log(`    ${bucket.padEnd(12)} ${String(count).padStart(4)} (${String(pct).padStart(5)}%) ${bar}`);
  }

  console.log();
  console.log('  ─── Tail Risk (score > 50) ────────────────────────────────');
  const tailRuns = allTelemetry.filter(r => r.score > 50);
  console.log(`    ${tailRuns.length}/${allTelemetry.length} runs (${r2(tailRuns.length / allTelemetry.length * 100)}%)`);
  if (tailRuns.length > 0 && tailRuns.length <= 20) {
    for (const t of tailRuns) {
      console.log(`    ${t.category}:${t.queryIdx} r${t.run} score:${t.score} ${t.error || ''} "${(t.query || '').substring(0, 40)}..."`);
    }
  } else if (tailRuns.length > 20) {
    // Group by category
    const tailByCat = {};
    for (const t of tailRuns) {
      tailByCat[t.category] = (tailByCat[t.category] || 0) + 1;
    }
    for (const [cat, count] of Object.entries(tailByCat)) {
      console.log(`    ${cat}: ${count} tail runs`);
    }
  }

  console.log();
  console.log('  ─── SK Contamination (post-QG residual) ───────────────────');
  const skRuns = allTelemetry.filter(r => r.skCount > 0 && !r.error);
  console.log(`    ${skRuns.length}/${allTelemetry.filter(r => !r.error).length} runs (${r2(skRuns.length / (allTelemetry.filter(r => !r.error).length || 1) * 100)}%)`);
  if (skRuns.length > 0) {
    const allSK = skRuns.flatMap(r => r.skMarkers || []);
    const freq = {};
    for (const w of allSK) freq[w.toLowerCase()] = (freq[w.toLowerCase()] || 0) + 1;
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log(`    Top: ${top.map(([w, c]) => `${w}(${c})`).join(', ')}`);
  }

  console.log();
  console.log('  ─── Zombie Responses ──────────────────────────────────────');
  const zombieRuns = allTelemetry.filter(r => r.isZombie);
  console.log(`    ${zombieRuns.length}/${allTelemetry.length} runs (${r2(zombieRuns.length / allTelemetry.length * 100)}%)`);

  console.log();
  console.log(`  Total: ${allTelemetry.length} runs in ${Math.round(totalDuration / 1000)}s (${r2(totalDuration / allTelemetry.length / 1000)}s/run avg)`);
  console.log();
  console.log('══════════════════════════════════════════════════════════════');

  // ─── Save ───────────────────────────────────────────────────────────────────

  if (SAVE_TO) {
    const output = {
      timestamp: new Date().toISOString(),
      config: { runs: NUM_RUNS, category: CATEGORY_FILTER, server: C3_URL },
      totalDuration,
      summary: categoryResults,
      allStats,
      telemetry: allTelemetry,
    };
    fs.writeFileSync(SAVE_TO, JSON.stringify(output, null, 2));
    console.log(`  Saved to: ${SAVE_TO}`);
  }

  // Exit code
  const overallPassRate = allTelemetry.filter(r => r.pass).length / allTelemetry.length;
  process.exit(overallPassRate >= 0.70 ? 0 : 1);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeBar(ratio, width) {
  const filled = Math.round(ratio * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

// ─── Run ────────────────────────────────────────────────────────────────────

runBenchmark().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
