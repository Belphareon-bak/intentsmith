// tests/e2e-loop.js — Continuous E2E Quality Loop Orchestrator
// ══════════════════════════════════════════════════════════════════════════════
// Runs E2E tests in cycles with GPU temperature monitoring, cooldown pauses,
// and structured result reporting. Designed for multi-day unattended operation.
//
// Usage:
//   node tests/e2e-loop.js [options]
//
// Options:
//   --cycles N         Number of cycles (0 = infinite, default: 0)
//   --tiers 1,2,3      Comma-separated tier list (default: 1,2,3)
//   --cool-between S   Seconds between test files (default: 5)
//   --cool-tier S      Seconds between tiers (default: 15)
//   --cool-cycle S     Seconds between cycles (default: 60)
//   --temp-max C       Max GPU temp before pausing (default: 78)
//   --temp-resume C    Resume temp after cooling (default: 68)
//   --temp-check-interval S  Check interval when cooling (default: 10)
//   --skip-smoke       Skip Tier 1 after first cycle
//   --report-dir DIR   Report output directory
//                      (default: .intentsmith-artifacts/e2e-loop)
// ══════════════════════════════════════════════════════════════════════════════

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const E2E_DIR = path.join(PROJECT_ROOT, 'tests', 'e2e');

// ── Argument Parsing ─────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    cycles: 0,
    tiers: [1, 2, 3],
    coolBetween: 5,
    coolTier: 15,
    coolCycle: 60,
    tempMax: 78,
    tempResume: 68,
    tempCheckInterval: 10,
    skipSmokeAfterFirst: false,
    reportDir: path.join(PROJECT_ROOT, '.intentsmith-artifacts', 'e2e-loop'),
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--cycles': opts.cycles = parseInt(args[++i], 10) || 0; break;
      case '--tiers': opts.tiers = args[++i].split(',').map(Number); break;
      case '--cool-between': opts.coolBetween = parseInt(args[++i], 10) || 5; break;
      case '--cool-tier': opts.coolTier = parseInt(args[++i], 10) || 15; break;
      case '--cool-cycle': opts.coolCycle = parseInt(args[++i], 10) || 60; break;
      case '--temp-max': opts.tempMax = parseInt(args[++i], 10) || 78; break;
      case '--temp-resume': opts.tempResume = parseInt(args[++i], 10) || 68; break;
      case '--temp-check-interval': opts.tempCheckInterval = parseInt(args[++i], 10) || 10; break;
      case '--skip-smoke': opts.skipSmokeAfterFirst = true; break;
      case '--report-dir': opts.reportDir = args[++i]; break;
    }
  }
  return opts;
}

// ── GPU Monitoring ───────────────────────────────────────────────────────────

function getGpuInfo() {
  try {
    const out = execSync(
      'nvidia-smi --query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw --format=csv,noheader,nounits',
      { timeout: 5000, encoding: 'utf8' }
    ).trim();
    const [temp, util, memUsed, memTotal, power] = out.split(',').map(s => parseFloat(s.trim()));
    return { temp, util, memUsed, memTotal, power, available: true };
  } catch {
    return { temp: 0, util: 0, memUsed: 0, memTotal: 0, power: 0, available: false };
  }
}

async function waitForGpuCooldown(opts) {
  const gpu = getGpuInfo();
  if (!gpu.available) return;
  if (gpu.temp <= opts.tempMax) return;

  console.log(`\n  ⏸  GPU ${gpu.temp}°C > ${opts.tempMax}°C — pausing for cooldown...`);
  while (true) {
    await sleep(opts.tempCheckInterval * 1000);
    const current = getGpuInfo();
    if (!current.available || current.temp <= opts.tempResume) {
      console.log(`  ▶  GPU ${current.temp}°C ≤ ${opts.tempResume}°C — resuming`);
      return;
    }
    console.log(`     GPU ${current.temp}°C — still cooling (target: ≤${opts.tempResume}°C)...`);
  }
}

// ── Test Discovery ───────────────────────────────────────────────────────────

const TIER_RANGES = {
  1: { min: 1, max: 25, label: 'Tier 1: API Smoke' },
  2: { min: 50, max: 69, label: 'Tier 2: LLM Quality' },
  3: { min: 70, max: 99, label: 'Tier 3: Semantic Quality' },
};

function discoverTests(tiers) {
  const allFiles = fs.readdirSync(E2E_DIR)
    .filter(f => f.endsWith('.e2e.js'))
    .sort();

  const result = {};
  for (const tier of tiers) {
    const range = TIER_RANGES[tier];
    if (!range) continue;
    result[tier] = {
      label: range.label,
      files: allFiles.filter(f => {
        const num = parseInt(f.split('-')[0], 10);
        return num >= range.min && num <= range.max;
      }).map(f => path.join(E2E_DIR, f)),
    };
  }
  return result;
}

// ── Test Runner ──────────────────────────────────────────────────────────────

function runTestFile(filePath, timeoutMs = 300_000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const name = path.basename(filePath);
    let stdout = '';
    let stderr = '';

    const proc = spawn('node', [filePath], {
      cwd: PROJECT_ROOT,
      timeout: timeoutMs,
      env: { ...process.env, E2E_GPU_COOLDOWN: '3', E2E_LOOP: '1' },
    });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      // Parse test results from stdout
      const passed = (stdout.match(/✅/g) || []).length;
      let failed = (stdout.match(/❌/g) || []).length;
      const failures = [];
      for (const m of stdout.matchAll(/❌\s+(.+?)(?:\n|$)/g)) {
        failures.push(m[1].trim());
      }

      // HIGH fix: exitCode must factor into verdict.
      // If process crashed (non-zero exit) but harness reported 0 failures
      // (e.g. uncaught exception, timeout kill), count as 1 failure.
      const crashed = code !== 0 && code !== null && failed === 0 && passed === 0;
      const timedOut = code === null;
      if (crashed || timedOut) {
        failed = Math.max(failed, 1);
        const reason = timedOut
          ? `Process timed out (killed)`
          : `Process crashed with exit code ${code}`;
        if (!failures.length) failures.push(reason);
      }

      resolve({
        file: name,
        exitCode: code,
        passed,
        failed,
        failures,
        elapsed: parseFloat(elapsed),
        timedOut,
        stdout: stdout.slice(-3000), // keep last 3KB for debugging
        stderr: stderr.slice(-1000),
      });
    });

    proc.on('error', (err) => {
      resolve({
        file: name,
        exitCode: -1,
        passed: 0,
        failed: 1,
        failures: [`Process error: ${err.message}`],
        elapsed: ((Date.now() - start) / 1000),
        timedOut: false,
        stdout: '',
        stderr: err.message,
      });
    });
  });
}

// ── Reporting ────────────────────────────────────────────────────────────────

function generateReport(cycleNum, tierResults, cycleStart, opts) {
  const gpu = getGpuInfo();
  const cycleElapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);

  let totalPassed = 0;
  let totalFailed = 0;
  let totalFiles = 0;
  const allFailures = [];

  for (const [tier, results] of Object.entries(tierResults)) {
    for (const r of results) {
      totalPassed += r.passed;
      totalFailed += r.failed;
      totalFiles++;
      for (const f of r.failures) {
        allFailures.push({ tier: parseInt(tier), file: r.file, failure: f });
      }
    }
  }

  const report = {
    cycle: cycleNum,
    timestamp: new Date().toISOString(),
    duration_s: parseFloat(cycleElapsed),
    gpu: gpu.available ? { temp: gpu.temp, util: gpu.util, memUsed: gpu.memUsed, power: gpu.power } : null,
    summary: {
      files: totalFiles,
      passed: totalPassed,
      failed: totalFailed,
      passRate: totalFiles > 0 ? Math.round((totalPassed / (totalPassed + totalFailed)) * 1000) / 10 : 0,
    },
    tiers: {},
    failures: allFailures,
  };

  for (const [tier, results] of Object.entries(tierResults)) {
    const tp = results.reduce((s, r) => s + r.passed, 0);
    const tf = results.reduce((s, r) => s + r.failed, 0);
    report.tiers[tier] = {
      label: TIER_RANGES[tier]?.label || `Tier ${tier}`,
      files: results.length,
      passed: tp,
      failed: tf,
      passRate: (tp + tf) > 0 ? Math.round((tp / (tp + tf)) * 1000) / 10 : 0,
      results: results.map(r => ({
        file: r.file,
        passed: r.passed,
        failed: r.failed,
        elapsed: r.elapsed,
        timedOut: r.timedOut,
        failures: r.failures,
      })),
    };
  }

  return report;
}

function printCycleSummary(report) {
  const line = '═'.repeat(70);
  console.log(`\n${line}`);
  console.log(`  CYCLE ${report.cycle} — SUMMARY`);
  console.log(line);
  console.log(`  Duration: ${report.duration_s}s`);
  if (report.gpu) {
    console.log(`  GPU: ${report.gpu.temp}°C | ${report.gpu.util}% util | ${report.gpu.memUsed} MiB | ${report.gpu.power}W`);
  }
  console.log(`  Total: ${report.summary.passed} passed, ${report.summary.failed} failed (${report.summary.passRate}%)`);

  for (const [tier, data] of Object.entries(report.tiers)) {
    const icon = data.failed === 0 ? '✅' : '⚠ ';
    console.log(`    ${icon} ${data.label}: ${data.passed}/${data.passed + data.failed} (${data.passRate}%)`);
  }

  if (report.failures.length > 0) {
    console.log(`\n  Failures (${report.failures.length}):`);
    for (const f of report.failures.slice(0, 20)) {
      console.log(`    [T${f.tier}] ${f.file}: ${f.failure.substring(0, 120)}`);
    }
    if (report.failures.length > 20) {
      console.log(`    ... and ${report.failures.length - 20} more`);
    }
  }
  console.log(line + '\n');
}

function saveReport(report, reportDir) {
  fs.mkdirSync(reportDir, { recursive: true });
  const filename = `cycle-${String(report.cycle).padStart(4, '0')}-${Date.now()}.json`;
  const filepath = path.join(reportDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
  return filepath;
}

function saveSummaryLog(report, reportDir) {
  const summaryPath = path.join(reportDir, 'summary.log');
  const line = `[${report.timestamp}] Cycle ${report.cycle}: ${report.summary.passed}/${report.summary.passed + report.summary.failed} (${report.summary.passRate}%) | ${report.summary.failed} failures | ${report.duration_s}s | GPU: ${report.gpu?.temp ?? '?'}°C\n`;
  fs.appendFileSync(summaryPath, line);
}

// ── Failure Pattern Analyzer ─────────────────────────────────────────────────

function analyzeFailurePatterns(allReports) {
  if (allReports.length < 2) return null;

  // Track per-test stability
  const testHistory = {};
  for (const report of allReports) {
    for (const f of report.failures) {
      const key = `${f.file}::${f.failure.substring(0, 80)}`;
      if (!testHistory[key]) testHistory[key] = { count: 0, cycles: [] };
      testHistory[key].count++;
      testHistory[key].cycles.push(report.cycle);
    }
  }

  // Classify: persistent vs flaky.
  // With few cycles, require stricter threshold to avoid marking one-offs as persistent.
  // < 4 cycles: need > 66%; >= 4 cycles: need > 50%
  const persistentThreshold = allReports.length < 4 ? 0.67 : 0.5;
  const persistent = [];
  const flaky = [];
  for (const [key, data] of Object.entries(testHistory)) {
    const rate = data.count / allReports.length;
    if (rate > persistentThreshold) persistent.push({ test: key, rate, count: data.count });
    else flaky.push({ test: key, rate, count: data.count });
  }

  // Trend: is quality improving?
  const recent = allReports.slice(-3);
  const passRates = recent.map(r => r.summary.passRate);
  const trend = passRates.length >= 2
    ? passRates[passRates.length - 1] - passRates[0]
    : 0;

  return {
    persistent: persistent.sort((a, b) => b.count - a.count),
    flaky: flaky.sort((a, b) => b.count - a.count),
    trend: Math.round(trend * 10) / 10,
    trendLabel: trend > 1 ? 'improving' : trend < -1 ? 'declining' : 'stable',
  };
}

// ── Improvement Suggestion Engine ─────────────────────────────────────────────
// Maps test failures to C3 source files that are likely responsible.
// This is a heuristic mapping — not exhaustive but covers the main quality areas.

const FAILURE_TO_SOURCE = {
  // CRE intent classification failures
  'cre-intent': {
    files: ['src/chat/cre-decision.js', 'src/chat/cre-routing-patches.js'],
    area: 'CRE Intent Classification',
    hint: 'Check guard rules, intent patterns, and LLM prompt in cre-decision.js',
  },
  'intent': {
    files: ['src/chat/cre-decision.js', 'src/chat/cre-routing-patches.js'],
    area: 'CRE Intent Classification',
    hint: 'Intent misclassification — review guard priorities and LLM prompt',
  },
  // Language enforcement failures
  'SK markers': {
    files: ['src/chat/handlers/utils/language-enforcement.js', 'src/context/prompt-builder.js'],
    area: 'Language Enforcement',
    hint: 'Slovak contamination — strengthen CZ system prompt or post-processing',
  },
  'Czech': {
    files: ['src/chat/handlers/utils/language-enforcement.js', 'src/context/prompt-builder.js'],
    area: 'Language Enforcement',
    hint: 'Missing Czech output — check language detection and prompt language',
  },
  'CJK': {
    files: ['src/chat/handlers/utils/language-enforcement.js'],
    area: 'Language Enforcement',
    hint: 'CJK character contamination — add post-processing filter',
  },
  // Code generation quality
  'code': {
    files: ['src/chat/handlers/code-analysis.js', 'src/planner/code-cleaner.js'],
    area: 'Code Generation',
    hint: 'Code quality issues — check code prompt, temperature, fence stripping',
  },
  'function def': {
    files: ['src/chat/handlers/code-analysis.js'],
    area: 'Code Generation',
    hint: 'Missing function structure — check code prompt specificity',
  },
  'placeholder': {
    files: ['src/chat/handlers/code-analysis.js', 'src/planner/code-cleaner.js'],
    area: 'Code Generation',
    hint: 'Placeholder/TODO code generated — strengthen "complete code" prompt instruction',
  },
  // Response quality
  'too short': {
    files: ['src/chat/handlers/conversation.js', 'src/chat/handlers/pre-handler.js'],
    area: 'Response Quality',
    hint: 'Responses too short — check max_tokens/num_predict, context window',
  },
  'too long': {
    files: ['src/chat/handlers/conversation.js', 'src/chat/handlers/pre-handler.js'],
    area: 'Response Quality',
    hint: 'Responses too verbose — add length guidance to system prompt',
  },
  // JSON/metadata leaks
  'decision_type': {
    files: ['src/chat/handlers/conversation.js', 'src/chat/cre-decision.js'],
    area: 'Information Leak',
    hint: 'JSON metadata leaking into response — check response stripping logic',
  },
  'confidence': {
    files: ['src/chat/handlers/conversation.js'],
    area: 'Information Leak',
    hint: 'Confidence value leaking — check post-processing or prompt injection',
  },
  'system prompt': {
    files: ['src/chat/handlers/pre-handler.js', 'src/context/prompt-builder.js'],
    area: 'Prompt Injection',
    hint: 'System prompt leaked — strengthen injection defenses',
  },
  // Follow-up / context
  'follow-up': {
    files: ['src/chat/handlers/conversation.js', 'src/chat/handlers/lifecycle-handoff.js'],
    area: 'Context Retention',
    hint: 'Follow-up context lost — check conversation history injection, window size',
  },
  'context': {
    files: ['src/chat/handlers/conversation.js'],
    area: 'Context Retention',
    hint: 'Context not maintained — check history truncation, message persistence',
  },
  'isolation': {
    files: ['src/chat/handlers/conversation.js', 'src/chat/handlers/session-resume.js'],
    area: 'Session Isolation',
    hint: 'Cross-conversation contamination — check session state cleanup',
  },
  // Security
  'refus': {
    files: ['src/chat/handlers/pre-handler.js', 'src/context/prompt-builder.js'],
    area: 'Safety',
    hint: 'Harmful content not refused — strengthen safety instructions in system prompt',
  },
  // WebSocket
  'WS': {
    files: ['src/ws-bridge/ws-server.js'],
    area: 'WebSocket',
    hint: 'WebSocket issues — check handshake, message routing',
  },
  // Timeout
  'timeout': {
    files: ['src/llm/gateway.js'],
    area: 'Performance',
    hint: 'LLM timeout — check model latency, timeout settings, GPU load',
  },
  'timedOut': {
    files: ['src/llm/gateway.js'],
    area: 'Performance',
    hint: 'Test timed out — GPU may be overloaded or model too slow',
  },
};

function generateImprovementSuggestions(report) {
  const suggestions = new Map(); // area → { files, hints, failCount }

  for (const failure of report.failures) {
    const text = `${failure.file} ${failure.failure}`.toLowerCase();

    for (const [keyword, mapping] of Object.entries(FAILURE_TO_SOURCE)) {
      if (text.includes(keyword.toLowerCase())) {
        const key = mapping.area;
        if (!suggestions.has(key)) {
          suggestions.set(key, { area: key, files: new Set(mapping.files), hints: new Set(), failCount: 0 });
        }
        const entry = suggestions.get(key);
        for (const f of mapping.files) entry.files.add(f);
        entry.hints.add(mapping.hint);
        entry.failCount++;
      }
    }
  }

  // Sort by failure count DESC
  return [...suggestions.values()]
    .map(s => ({ ...s, files: [...s.files], hints: [...s.hints] }))
    .sort((a, b) => b.failCount - a.failCount);
}

function printImprovementSuggestions(suggestions) {
  if (suggestions.length === 0) return;
  console.log('\n  📋 Improvement Suggestions:');
  for (const s of suggestions.slice(0, 8)) {
    console.log(`    [${s.area}] (${s.failCount} failures)`);
    console.log(`      Files: ${s.files.join(', ')}`);
    for (const h of s.hints) {
      console.log(`      → ${h}`);
    }
  }
}

function saveImprovementLog(suggestions, reportDir, cycle) {
  if (suggestions.length === 0) return;
  const logPath = path.join(reportDir, 'improvements.log');
  const lines = [`\n[Cycle ${cycle} — ${new Date().toISOString()}]`];
  for (const s of suggestions) {
    lines.push(`  [${s.area}] ${s.failCount} failures → ${s.files.join(', ')}`);
    for (const h of s.hints) lines.push(`    → ${h}`);
  }
  fs.appendFileSync(logPath, lines.join('\n') + '\n');
}

// ── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function formatTime(date) {
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

// ── Server Health Check ──────────────────────────────────────────────────────

async function checkServer(baseUrl = 'http://127.0.0.1:3335') {
  try {
    const resp = await fetch(`${baseUrl}/api/health`);
    if (resp.ok) {
      const data = await resp.json();
      return { ok: true, version: data.version, llm: data.llm };
    }
    return { ok: false, error: `HTTP ${resp.status}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Main Loop ────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const allReports = [];

  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  E2E Quality Loop — Continuous Improvement Orchestrator');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`  Started: ${formatTime(new Date())}`);
  console.log(`  Cycles: ${opts.cycles === 0 ? 'infinite' : opts.cycles}`);
  console.log(`  Tiers: ${opts.tiers.join(', ')}`);
  console.log(`  GPU temp limit: ${opts.tempMax}°C (resume at ${opts.tempResume}°C)`);
  console.log(`  Cooldowns: ${opts.coolBetween}s between tests, ${opts.coolTier}s between tiers, ${opts.coolCycle}s between cycles`);
  console.log(`  Reports: ${opts.reportDir}`);

  // Pre-flight: server check
  const server = await checkServer();
  if (!server.ok) {
    console.error(`\n  ✗ Server not reachable: ${server.error}`);
    console.error('  Start the server: PORT=3335 node src/server.js');
    process.exit(1);
  }
  console.log(`  Server: v${server.version} | LLM: ${server.llm ? 'yes' : 'no'}`);

  // Pre-flight: GPU
  const gpu = getGpuInfo();
  if (gpu.available) {
    console.log(`  GPU: ${gpu.temp}°C | ${gpu.util}% util | ${gpu.memUsed}/${gpu.memTotal} MiB | ${gpu.power}W`);
  } else {
    console.log('  GPU: nvidia-smi not available (no temp monitoring)');
  }

  // Discover tests
  const testsByTier = discoverTests(opts.tiers);
  for (const [tier, data] of Object.entries(testsByTier)) {
    console.log(`  ${data.label}: ${data.files.length} files`);
  }
  console.log('══════════════════════════════════════════════════════════════════════\n');

  // Ensure report dir exists
  fs.mkdirSync(opts.reportDir, { recursive: true });

  let cycle = 0;
  const globalStart = Date.now();

  while (opts.cycles === 0 || cycle < opts.cycles) {
    cycle++;
    const cycleStart = Date.now();
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`  CYCLE ${cycle} — ${formatTime(new Date())}`);
    console.log(`${'─'.repeat(70)}`);

    const tierResults = {};

    for (const tier of opts.tiers) {
      // Skip smoke after first cycle if configured
      if (tier === 1 && cycle > 1 && opts.skipSmokeAfterFirst) {
        console.log(`\n  ⏭  Skipping ${TIER_RANGES[tier].label} (--skip-smoke)`);
        continue;
      }

      const tierData = testsByTier[tier];
      if (!tierData || tierData.files.length === 0) continue;

      console.log(`\n  ── ${tierData.label} (${tierData.files.length} files) ──`);
      tierResults[tier] = [];

      for (let i = 0; i < tierData.files.length; i++) {
        // GPU temp check before each test
        await waitForGpuCooldown(opts);

        const file = tierData.files[i];
        const name = path.basename(file);
        const progress = `[${i + 1}/${tierData.files.length}]`;

        process.stdout.write(`    ${progress} ${name} ...`);

        // Timeout: Tier 1 = 60s, Tier 2 = 600s (10 subtests × ~55s), Tier 3 = 1200s (multi-turn deep)
        const timeout = tier === 1 ? 60_000 : tier === 2 ? 600_000 : 1_200_000;
        const result = await runTestFile(file, timeout);
        tierResults[tier].push(result);

        const icon = result.failed === 0 ? '✅' : '❌';
        process.stdout.write(`\r    ${progress} ${name} ${icon} ${result.passed}/${result.passed + result.failed} (${result.elapsed}s)\n`);

        if (result.failures.length > 0) {
          for (const f of result.failures.slice(0, 3)) {
            console.log(`         └─ ${f.substring(0, 100)}`);
          }
          if (result.failures.length > 3) {
            console.log(`         └─ ... +${result.failures.length - 3} more`);
          }
        }

        // Cooldown between test files
        if (i < tierData.files.length - 1) {
          await sleep(opts.coolBetween * 1000);
        }
      }

      // Cooldown between tiers
      const nextTierIdx = opts.tiers.indexOf(tier) + 1;
      if (nextTierIdx < opts.tiers.length) {
        console.log(`\n  ⏸  Tier cooldown (${opts.coolTier}s)...`);
        await sleep(opts.coolTier * 1000);
      }
    }

    // Generate and save report
    const report = generateReport(cycle, tierResults, cycleStart, opts);
    allReports.push(report);

    const reportPath = saveReport(report, opts.reportDir);
    saveSummaryLog(report, opts.reportDir);
    printCycleSummary(report);
    console.log(`  Report: ${reportPath}`);

    // Improvement suggestions (every cycle)
    const suggestions = generateImprovementSuggestions(report);
    printImprovementSuggestions(suggestions);
    saveImprovementLog(suggestions, opts.reportDir, cycle);

    // Failure pattern analysis (after 2+ cycles)
    if (allReports.length >= 2) {
      const patterns = analyzeFailurePatterns(allReports);
      if (patterns) {
        console.log(`  Trend: ${patterns.trendLabel} (${patterns.trend > 0 ? '+' : ''}${patterns.trend}%)`);
        if (patterns.persistent.length > 0) {
          console.log(`  Persistent failures (${patterns.persistent.length}):`);
          for (const p of patterns.persistent.slice(0, 5)) {
            console.log(`    - ${p.test.substring(0, 100)} (${p.count}/${allReports.length} cycles)`);
          }
        }
      }
    }

    // Save aggregated patterns report
    if (allReports.length >= 2) {
      const patterns = analyzeFailurePatterns(allReports);
      if (patterns) {
        const patternsPath = path.join(opts.reportDir, 'failure-patterns.json');
        fs.writeFileSync(patternsPath, JSON.stringify({
          timestamp: new Date().toISOString(),
          totalCycles: allReports.length,
          ...patterns,
        }, null, 2));
      }
    }

    // Log total runtime
    const totalElapsed = ((Date.now() - globalStart) / 1000 / 60).toFixed(1);
    console.log(`  Total runtime: ${totalElapsed} min (${allReports.length} cycles)`);

    // Inter-cycle cooldown
    if (opts.cycles === 0 || cycle < opts.cycles) {
      console.log(`\n  ⏸  Cycle cooldown (${opts.coolCycle}s)...`);
      await sleep(opts.coolCycle * 1000);
    }
  }

  // Final summary
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('  E2E Quality Loop — FINAL SUMMARY');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`  Cycles completed: ${allReports.length}`);
  const totalRuntime = ((Date.now() - globalStart) / 1000 / 60).toFixed(1);
  console.log(`  Total runtime: ${totalRuntime} min`);

  if (allReports.length > 0) {
    const first = allReports[0];
    const last = allReports[allReports.length - 1];
    console.log(`  First cycle pass rate: ${first.summary.passRate}%`);
    console.log(`  Last cycle pass rate: ${last.summary.passRate}%`);
    console.log(`  Change: ${last.summary.passRate - first.summary.passRate > 0 ? '+' : ''}${(last.summary.passRate - first.summary.passRate).toFixed(1)}%`);
  }
  console.log('══════════════════════════════════════════════════════════════════════\n');

  const lastReport = allReports[allReports.length - 1];
  process.exit(lastReport && lastReport.summary.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
