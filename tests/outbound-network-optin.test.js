#!/usr/bin/env node
// Outbound network is opt-in
// ══════════════════════════════════════════════════════════════════════════════
//
// The product is local-first. Model discovery (L4), WhatLLM benchmark
// enrichment (L5) and registry verification are the only paths on which it
// contacts anything outside the machine, and they hang off a 24h full cycle
// that used to run with no way to switch it off.
//
// This suite is structural on purpose: it asserts the gate exists and defaults
// to off, which is checkable without a network and without a 24h wait.
//
// ══════════════════════════════════════════════════════════════════════════════

import './helpers/isolated-test-db.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
let fail = 0;
const failures = [];

function check(condition, label) {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; failures.push(label); console.error(`  ❌ ${label}`); }
}

const manager = readFileSync(path.join(ROOT, 'src/upgrade/upgrade-manager.js'), 'utf8');

async function main() {
  console.log('\n══ Outbound network is opt-in ══\n');

  // ── The flag defaults to off ───────────────────────────────────────────────
  delete process.env.C3_ENABLE_ONLINE_DISCOVERY;
  const { config: offByDefault } = await import(
    `${path.join(ROOT, 'src/config.js')}?fresh=${Date.now()}`
  );
  check(
    offByDefault.features.onlineDiscovery === false,
    'a clean environment does not contact anything outside the machine',
  );

  // ── And can be turned on deliberately ─────────────────────────────────────
  process.env.C3_ENABLE_ONLINE_DISCOVERY = 'true';
  const { config: turnedOn } = await import(
    `${path.join(ROOT, 'src/config.js')}?fresh=${Date.now()}-on`
  );
  delete process.env.C3_ENABLE_ONLINE_DISCOVERY;
  check(
    turnedOn.features.onlineDiscovery === true,
    'C3_ENABLE_ONLINE_DISCOVERY=true opts in',
  );

  // ── Every outbound caller sits behind the flag ────────────────────────────
  // The three call sites are L4 online discovery, L5 WhatLLM enrichment (both
  // inside the same guarded block) and the registry verify batch.
  const guardedBlocks = manager.match(
    /if \(opts\.fullCycle && config\.features\?\.onlineDiscovery[^)]*\)/g,
  ) || [];
  check(
    guardedBlocks.length >= 2,
    `online discovery and registry verify are both gated (${guardedBlocks.length} gates)`,
  );

  const whatllmLine = manager.split('\n').findIndex(l => l.includes('whatllm-client.js'));
  const l4GateLine = manager.split('\n').findIndex(
    l => /if \(opts\.fullCycle && config\.features\?\.onlineDiscovery/.test(l),
  );
  check(
    l4GateLine !== -1 && whatllmLine > l4GateLine,
    'WhatLLM enrichment sits inside the gated block, not beside it',
  );

  console.log(`\n══ RESULTS: ${pass} passed, ${fail} failed ══`);
  if (failures.length) {
    console.error('\n  FAILURES:');
    for (const f of failures) console.error(`    ❌ ${f}`);
  }
  console.log('');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(`\nFATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
