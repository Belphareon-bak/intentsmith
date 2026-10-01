// Fixed second generated-project qualification. The operator freezes these
// bytes before inference; model output is limited to TASKFLOW_FILES.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ORACLE_BINARY, ORACLE_PATH, PROBE_PATH, VALIDATE_PATH, ENTRY_PATH,
  ENTRY_SOURCE, ENTRY_SHA256, sha256, policyForFrozenOracle,
} from './project-app-acceptance.js';

export const TASKFLOW_FILES = Object.freeze([
  { path: 'src/app.js', instruction: "Re-export run only from './cli.js' as the public entrypoint. No other imports. Do not execute commands or start a process at import time.", dependsOn: ['src/cli.js'] },
  { path: 'src/cli.js', instruction: "Import createBoard only from './store.js'; no other imports. Export run(commands): require an array; make a fresh board per call. Exact tuples: ['add',title,priority], ['update',id,patch], ['transition',id,status], ['remove',id], ['list'] or ['list',options]. Reject wrong arity/unknown operations. Dispatch in order and return one result per tuple: task copies for add/update/transition, true for remove, array for list. Never return only the last result.", dependsOn: ['src/store.js'] },
  { path: 'src/store.js', instruction: "Import only './validate.js' and './query.js'. Export createBoard() with add(title,priority), update(id,patch), transition(id,status), remove(id), list(options={}). add assigns never-reused ids 1,2,... and todo; update changes only supplied title/priority; transition only todo->doing or doing->done; remove existing id returns true. Validate all inputs/options; unknown ids or illegal transitions throw. Return independent task copies; list uses select. No other imports.", dependsOn: ['src/query.js', 'src/validate.js'] },
  { path: 'src/query.js', instruction: 'Export select(tasks,options). Filter by exact options.status when present. Default sort=created means id ascending; sort=priority means priority descending then id ascending. Return a new array of new plain {id,title,priority,status} records. Never mutate input array or rows. No imports.', dependsOn: [] },
  { path: 'src/validate.js', instruction: 'Export validateTitle, validatePriority, validateId, validateStatus, validatePatch, validateOptions; each throws TypeError on invalid input. No imports. Title is a nonblank string, stored without trimming; priority is an integer 1..3; id is a positive safe integer; status is todo|doing|done. Patch is a nonempty plain object with only title and/or priority; validate each present field. Options is a plain object with only optional status and sort=created|priority. Never coerce values.', dependsOn: [] },
]);

export const TASKFLOW_ORACLE_SOURCE = fs.readFileSync(new URL('./project-taskflow-oracle.mjs', import.meta.url), 'utf8');
export const TASKFLOW_ORACLE_SHA256 = sha256(TASKFLOW_ORACLE_SOURCE);
export const TASKFLOW_ORACLE_ARGV = Object.freeze(['--experimental-vm-modules', ORACLE_PATH]);
export const TASKFLOW_PROBE_SOURCE = `import { createBoard } from '../src/store.js';
const board = createBoard();
const row = board.add('probe', 2), before = board.list();
before[0].title = 'changed';
process.stdout.write(JSON.stringify({ row, after: board.list()[0] }) + '\\n');
`;
export const TASKFLOW_VALIDATE_SOURCE = `import { validateId } from '../src/validate.js';
const raw = process.argv[2];
const value = raw === 'NaN' ? NaN : raw === 'Infinity' ? Infinity : Number(raw);
validateId(value);
`;
export const TASKFLOW_PROBE_SHA256 = sha256(TASKFLOW_PROBE_SOURCE);
export const TASKFLOW_VALIDATE_SHA256 = sha256(TASKFLOW_VALIDATE_SOURCE);
export { policyForFrozenOracle, ENTRY_SOURCE, ENTRY_SHA256 };

export function taskflowBlueprint() {
  return {
    instruction: 'Build dependency-free in-memory TaskFlow JS. Tasks={id,title,priority,status}; priority 1..3; status todo|doing|done. run(commands) accepts exact tuples below, returns one result per tuple and uses a fresh board each call. An invalid command throws before changing its own state. Generate only five modules. In every generated module use only standard ECMAScript globals; no Node/Web host globals such as structuredClone, process, console or Buffer.',
    files: TASKFLOW_FILES.map(file => ({ ...file, dependsOn: [...file.dependsOn] })),
    focusedTest: {
      binary: ORACLE_BINARY, argv: [...TASKFLOW_ORACLE_ARGV],
      environment: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' }, timeoutMs: 30_000,
    },
    gitCommit: {
      message: 'Implement reviewed TaskFlow application',
      identity: {
        authorName: 'IntentSmith Qualification', authorEmail: 'qualification@example.invalid',
        authorDate: '2026-10-01T00:00:00Z', committerName: 'IntentSmith Qualification',
        committerEmail: 'qualification@example.invalid', committerDate: '2026-10-01T00:00:00Z',
      },
    },
  };
}

export function assertTaskFlowPreview(diff, projectRoot, readFile, exists) {
  const expected = TASKFLOW_FILES.map(file => file.path).sort();
  assert.deepEqual(diff.map(file => file.path).sort(), expected, 'preview covers exactly five generated targets');
  for (const row of diff) {
    assert.equal(typeof row.after?.content, 'string', row.path + ' complete after bytes');
    assert.ok(row.after.content.trim(), row.path + ' nonempty after bytes');
    assert.equal(exists(projectRoot, row.path), false, row.path + ' absent before approval');
  }
  for (const [relative, digest] of [
    [ORACLE_PATH, TASKFLOW_ORACLE_SHA256], [PROBE_PATH, TASKFLOW_PROBE_SHA256],
    [VALIDATE_PATH, TASKFLOW_VALIDATE_SHA256], [ENTRY_PATH, ENTRY_SHA256],
  ]) assert.equal(sha256(readFile(projectRoot, relative)), digest, relative + ' frozen bytes');
}

export const TASKFLOW_COMMANDS = Object.freeze([
  ['add', 'Write report', 2], ['add', 'Fix login', 3], ['add', 'Pay invoice', 1],
  ['list', { sort: 'priority' }], ['update', 1, { title: 'Write final report', priority: 3 }],
  ['transition', 2, 'doing'], ['list', { status: 'todo', sort: 'priority' }],
  ['transition', 2, 'done'], ['remove', 3], ['list'],
  ['add', 'Archive notes', 2], ['list'],
]);

export function assertTaskFlowCLIResults(rows) {
  const a = { id: 1, title: 'Write report', priority: 2, status: 'todo' };
  const b = { id: 2, title: 'Fix login', priority: 3, status: 'todo' };
  const c = { id: 3, title: 'Pay invoice', priority: 1, status: 'todo' };
  const au = { ...a, title: 'Write final report', priority: 3 };
  const bd = { ...b, status: 'doing' };
  const bx = { ...b, status: 'done' };
  const d = { id: 4, title: 'Archive notes', priority: 2, status: 'todo' };
  assert.deepEqual(rows, [a, b, c, [b, a, c], au, bd, [au, c], bx, true,
    [au, bx], d, [au, bx, d]], 'trusted 12-command TaskFlow output');
}
