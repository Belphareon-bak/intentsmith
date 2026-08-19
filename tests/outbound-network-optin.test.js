#!/usr/bin/env node
// Automatic online model discovery is gated and opt-out
// ══════════════════════════════════════════════════════════════════════════════
//
// The product is local-first. Since the operator decision of 2026-08-19
// (DIRECTION.md) that constraint is read as "nothing outside the machine is
// *required*", not "nothing outside the machine may be used": keeping the local
// model set current is a product goal, so discovery defaults ON and is switched
// off explicitly with C3_ENABLE_ONLINE_DISCOVERY=false.
//
// What still must hold, and is what this suite protects:
//   - a single switch turns every outbound discovery path off;
//   - every background caller sits behind that switch;
//   - the switch is honoured in both directions.
//
// This suite covers only background model discovery (L4), WhatLLM enrichment
// (L5) and registry verification. Explicit web tools, marketplace, agent
// sources/actions, notifications and remote Ollama are separate outbound
// capabilities and are not claimed by this test.
//
// Structural on purpose: checkable without a network and without a 24h wait.
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
  console.log('\n══ Automatic online model discovery is gated and opt-out ══\n');

  // ── The flag defaults to on ───────────────────────────────────────────────
  delete process.env.C3_ENABLE_ONLINE_DISCOVERY;
  const { config: onByDefault } = await import(
    `${path.join(ROOT, 'src/config.js')}?fresh=${Date.now()}`
  );
  check(
    onByDefault.features.onlineDiscovery === true,
    'a clean environment keeps model discovery enabled (operator decision 2026-08-19)',
  );

  // ── And can be turned off deliberately ────────────────────────────────────
  process.env.C3_ENABLE_ONLINE_DISCOVERY = 'false';
  const { config: turnedOff } = await import(
    `${path.join(ROOT, 'src/config.js')}?fresh=${Date.now()}-off`
  );
  delete process.env.C3_ENABLE_ONLINE_DISCOVERY;
  check(
    turnedOff.features.onlineDiscovery === false,
    'C3_ENABLE_ONLINE_DISCOVERY=false opts out',
  );

  // ── Only the exact string "false" opts out ────────────────────────────────
  // A typo must not silently disable discovery, and must not silently enable
  // it either — the switch has to mean one thing.
  process.env.C3_ENABLE_ONLINE_DISCOVERY = 'no';
  const { config: typo } = await import(
    `${path.join(ROOT, 'src/config.js')}?fresh=${Date.now()}-typo`
  );
  delete process.env.C3_ENABLE_ONLINE_DISCOVERY;
  check(
    typo.features.onlineDiscovery === true,
    'only the exact value "false" opts out',
  );

  // ── Every background discovery caller sits behind the flag ────────────────
  // The three discovery call sites are L4 online discovery, L5 WhatLLM
  // enrichment (inside the same guarded block) and the registry verify batch.
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
