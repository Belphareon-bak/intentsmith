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
// This suite covers only background factual model discovery (L4). WhatLLM is
// now a discovery-order signal owned exclusively by the explicit/scheduled
// model-upgrade hunt; it must not return to UpgradeManager as a runtime quality
// authority. Explicit web tools, marketplace, agent sources/actions,
// notifications and remote Ollama are separate outbound capabilities and are
// not claimed by this test.
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
const hunt = readFileSync(path.join(ROOT, 'scripts/model-upgrade-hunt.js'), 'utf8');

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
  // UpgradeManager owns one background online-discovery block. Quality
  // enrichment and registry scoring were removed from this runtime path.
  const guardedBlocks = manager.match(
    /if \(opts\.fullCycle && config\.features\?\.onlineDiscovery[^)]*\)/g,
  ) || [];
  check(
    guardedBlocks.length === 1,
    `the sole background online-discovery path is gated (${guardedBlocks.length} gate)`,
  );

  check(
    !manager.includes('whatllm-client.js') && hunt.includes('whatllm-client.js'),
    'WhatLLM is hunt-only and cannot score inside the background UpgradeManager',
  );

  check(
    hunt.includes('const shortlist = (ONLY.length || INSTALLED_PANEL)')
      && hunt.includes("throw new Error('installed panel obsahuje nenainstalovaný artefakt')")
      && hunt.includes('ignoreHardwareBlocks: INSTALLED_PANEL'),
    'installed panel skips remote discovery, rejects remote artifacts and refreshes VRAM placement',
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
