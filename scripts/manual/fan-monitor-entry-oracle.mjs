// TRUSTED ORACLE PROPOSAL ONLY. Invoke for generated code solely inside the
// canonical M2 linux-bwrap-ro-v2 process sandbox. Nested children inherit its
// namespace/seccomp and remain in the supervisor's process group.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const ROOT = '/sys/class/hwmon';
const FAN1 = ROOT + '/hwmon1/fan1_input';
const FAN2 = ROOT + '/hwmon1/fan2_input';
const FAN3 = ROOT + '/hwmon2/fan1_input';
const tree = {
  directories: { [ROOT]: ['hwmon2', 'hwmon1'], [ROOT + '/hwmon1']: ['fan2_input', 'fan1_input'], [ROOT + '/hwmon2']: ['fan1_input'] },
  files: { [FAN1]: '1200\n', [FAN2]: '0\n', [FAN3]: 'invalid' },
};
const outage = { directories: tree.directories, files: { [FAN2]: '0', [FAN3]: 'invalid' } };
const empty = { directories: { [ROOT]: [] }, files: {} };
const normal = [{ id: FAN1, rpm: 1200 }, { id: FAN2, rpm: 0 }, { id: FAN3, rpm: null }];
const gap = [{ id: FAN1, rpm: null }, { id: FAN2, rpm: 0 }, { id: FAN3, rpm: null }];
const first = { atMs: 1000, sensors: normal };
const second = { atMs: 1001, sensors: gap };

export const ENTRY_CASES = Object.freeze({
  positive: [
    { id: 'mixed-order-boundaries', payload: { commands: [['history', 0], ['sample', 1000, tree], ['history', 1000], ['sample', 1001, outage], ['history', 3601000], ['history', 3601001], ['history', 3601002]] },
      expected: [[], first, [first], second, [first, second], [second], []] },
    { id: 'fresh-process', payload: { commands: [['history', 0]] }, expected: [[]] },
    { id: 'empty-commands', payload: { commands: [] }, expected: [] },
    { id: 'window-and-cap', payload: { commands: [['sample', 0, empty], ['sample', 1, empty], ['sample', 2, empty], ['history', 11], ['history', 12], ['history', 13]], options: { windowMs: 10, maxSamples: 2 } },
      expected: [{ atMs: 0, sensors: [] }, { atMs: 1, sensors: [] }, { atMs: 2, sensors: [] }, [{ atMs: 1, sensors: [] }, { atMs: 2, sensors: [] }], [{ atMs: 2, sensors: [] }], []] },
    { id: 'utf8-root', payload: { commands: [['sample', 7, { directories: { '/virtual/čtení': ['hwmon4'], '/virtual/čtení/hwmon4': ['fan9_input'] }, files: { '/virtual/čtení/hwmon4/fan9_input': ' 3210\n' } }]], options: { root: '/virtual/čtení' } },
      expected: [{ atMs: 7, sensors: [{ id: '/virtual/čtení/hwmon4/fan9_input', rpm: 3210 }] }] },
  ],
  negative: [
    { id: 'missing-json-arg', args: [] },
    { id: 'malformed-json', args: ['{'] },
    { id: 'null-payload', args: ['null'] },
    { id: 'array-payload', args: ['[]'] },
    { id: 'missing-commands', args: ['{}'] },
    { id: 'null-commands', args: ['{"commands":null}'] },
    { id: 'unknown-operation', args: ['{"commands":[["unknown",0]]}'] },
    { id: 'missing-sample-tree', args: ['{"commands":[["sample",0]]}'] },
    { id: 'extra-tuple-value', args: ['{"commands":[["history",0,"extra"]]}'] },
    { id: 'invalid-clock', args: ['{"commands":[["history",-1]]}'] },
    { id: 'invalid-tree', args: ['{"commands":[["sample",0,null]]}'] },
    { id: 'invalid-options', args: ['{"commands":[],"options":{"windowMs":0}}'] },
    { id: 'backward-clock', args: [JSON.stringify({ commands: [['sample', 1, empty], ['sample', 0, empty]] })] },
  ],
});

const ENVIRONMENT = Object.freeze({ LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' });
const IMPORT_MARKER = 'FAN_ENTRY_IMPORT_OK\n';

export function verifyFanEntry({ cwd = process.cwd() } = {}) {
  const observations = [];
  function child(id, argv) {
    const args = ['--disable-wasm-trap-handler', ...argv];
    const result = spawnSync(process.execPath, args, {
      cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 65536, env: ENVIRONMENT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const observation = { id, argv: args, exitCode: result.status, signal: result.signal,
      stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.code ?? null };
    observations.push(observation);
    assert.equal(observation.error, null, id + ': no launch/timeout/buffer error');
    assert.equal(observation.signal, null, id + ': normal exit');
    return observation;
  }
  const imported = child('entry-import-inert', ['--input-type=module', '-e',
    "import {run} from './src/index.mjs';if(typeof run!=='function')throw new Error('missing run export');process.stdout.write('FAN_ENTRY_IMPORT_OK\\n');"]);
  assert.equal(imported.exitCode, 0, 'entry import succeeds');
  assert.equal(imported.stdout, IMPORT_MARKER, 'entry import has no additional output');
  assert.equal(imported.stderr, '', 'entry import has no diagnostic side effects');
  for (const test of ENTRY_CASES.positive) {
    const observation = child(test.id, ['src/index.mjs', JSON.stringify(test.payload)]);
    assert.equal(observation.exitCode, 0, test.id + ': valid input succeeds');
    assert.equal(observation.stderr, '', test.id + ': no diagnostic side effects');
    assert.match(observation.stdout, /^[^\r\n]+\n$/, test.id + ': exactly one JSON result line');
    assert.deepEqual(JSON.parse(observation.stdout), test.expected, test.id + ': exact independent output');
  }
  for (const test of ENTRY_CASES.negative) {
    const observation = child(test.id, ['src/index.mjs', ...test.args]);
    assert.ok(Number.isInteger(observation.exitCode) && observation.exitCode !== 0,
      test.id + ': invalid input must exit nonzero');
    // Explicit proposal clarification: invalid input emits no result on stdout.
    // Diagnostic stderr wording is intentionally unconstrained.
    assert.equal(observation.stdout, '', test.id + ': no success result for invalid input');
  }
  return { status: 'FAN_ENTRY_ORACLE_PASS', positiveCases: ENTRY_CASES.positive.length,
    negativeCases: ENTRY_CASES.negative.length, importCases: 1, observations,
    boundary: 'required inherited canonical M2 process sandbox; reference-only CPU fixtures are not generated subjects' };
}
