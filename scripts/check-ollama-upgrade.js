#!/usr/bin/env node
// Metadata only: no install, restart, model download, GPU use or binding change.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { config } from '../src/config.js';
import { up as installAuditSchema } from '../src/db/migrations/2026_08_26_089_m5_outbound_audit.js';
import { createOutboundPolicy } from '../src/network/outbound-policy.js';
import { checkOllamaUpdate } from '../src/upgrade/ollama-update-check.js';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/check-ollama-upgrade.js [--json] [--state-dir=/absolute/path]\nDiscovery opt-out: C3_ENABLE_ONLINE_DISCOVERY=false. Never installs an update.');
  process.exit(0);
}
if (args.some(arg => arg !== '--json' && !arg.startsWith('--state-dir='))
  || args.filter(arg => arg.startsWith('--state-dir=')).length > 1) {
  console.error('Invalid arguments; use --help.');
  process.exit(2);
}
const stateDir = args.find(arg => arg.startsWith('--state-dir='))?.slice('--state-dir='.length)
  ?? join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'intentsmith/ollama-upgrade');
if (!isAbsolute(stateDir)) {
  console.error('State directory must be an absolute path.');
  process.exit(2);
}
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const database = new Database(join(stateDir, 'outbound-audit.sqlite'));
try {
  database.pragma('busy_timeout = 5000');
  database.transaction(() => installAuditSchema(database))();
  const policy = createOutboundPolicy({
    database,
    logger: { warn: (...values) => console.error(...values), error: (...values) => console.error(...values) },
    enabledSurfaces: { 'model-discovery': config.features.onlineDiscovery === true },
  });
  const result = await checkOllamaUpdate({
    enabled: config.features.onlineDiscovery === true,
    baseUrl: config.ollama?.baseUrl,
    localFetch: policy.fetch,
    releaseFetch: policy.ollamaReleaseFetch,
  });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  const temporary = join(stateDir, `latest.${randomUUID()}.tmp`);
  writeFileSync(temporary, json, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, join(stateDir, 'latest.json'));
  if (args.includes('--json')) process.stdout.write(json);
  else console.log(`Ollama: ${result.status}; installed=${result.installed?.version ?? 'unknown'}; upstream=${result.latest?.version ?? 'unknown'}; compatibility=${result.compatibility.status}. Report: ${join(stateDir, 'latest.json')}`);
  if (result.status === 'CHECK_FAILED') process.exitCode = 1;
} finally {
  database.close();
}
