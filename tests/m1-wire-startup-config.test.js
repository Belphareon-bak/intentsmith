import { strict as assert } from 'node:assert';
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';

const ROOT = isolatedTestRuntime.repositoryRoot;
const MIB = 1024 * 1024;
const invalidCases = [
  ['unknown boolean', { C3_ENABLE_M1_WIRE: 'yes' }],
  ['nonpositive count', { C3_M1_ATTACHMENT_MAX_COUNT: '0' }],
  ['noninteger count', { C3_M1_ATTACHMENT_MAX_COUNT: '1.5' }],
  ['unsafe aggregate', {
    C3_M1_ATTACHMENT_MAX_AGGREGATE_BYTES: String(Number.MAX_SAFE_INTEGER + 1),
  }],
  ['aggregate below item cap', {
    C3_M1_ATTACHMENT_MAX_AGGREGATE_BYTES: String(4 * MIB),
  }],
  ['frame not above aggregate', {
    C3_M1_WIRE_MAX_FRAME_BYTES: String(6 * MIB),
  }],
];

let passed = 0;
for (const [name, override] of invalidCases) {
  const effects = path.join(
    isolatedTestRuntime.temp,
    `m1-wire-startup-${String(passed + 1).padStart(2, '0')}`,
  );
  mkdirSync(effects, { mode: 0o700 });

  const result = spawnSync(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      C3_HOST: '127.0.0.1',
      C3_CORS_ORIGINS: '',
      C3_DB_PATH: path.join(effects, 'c3.sqlite'),
      C3_PORT_FILE: path.join(effects, 'port.json'),
      C3_PROJECTS_DIR: path.join(effects, 'projects'),
      C3_ENABLE_AGENTS: 'false',
      C3_ENABLE_EXPERTISES: 'false',
      C3_ENABLE_LIFECYCLE: 'false',
      C3_ENABLE_COMFYUI: 'false',
      C3_ENABLE_ONLINE_DISCOVERY: 'false',
      C3_ENABLE_M1_WIRE: 'true',
      C3_MAX_TEXT_ATTACHMENT: String(MIB),
      C3_MAX_IMAGE_ATTACHMENT: String(5 * MIB),
      C3_M1_ATTACHMENT_MAX_COUNT: '8',
      C3_M1_ATTACHMENT_MAX_AGGREGATE_BYTES: String(6 * MIB),
      C3_M1_WIRE_MAX_FRAME_BYTES: String(12 * MIB),
      ...override,
    },
    encoding: 'utf8',
    timeout: 30_000,
    killSignal: 'SIGKILL',
  });

  assert.equal(result.error, undefined, `${name}: child must exit by policy rejection`);
  assert.notEqual(result.status, 0, `${name}: invalid startup policy must fail`);
  assert.match(
    result.stderr,
    /M1_WIRE_CONFIG_INVALID/,
    `${name}: rejection must use the owned configuration signal`,
  );
  assert.deepEqual(
    readdirSync(effects),
    [],
    `${name}: rejection must precede DB, port-file, project, and runtime effects`,
  );
  passed++;
  console.log(`  ✅ ${name}`);
}

console.log(`M1 wire startup config: ${passed} passed, 0 failed`);
