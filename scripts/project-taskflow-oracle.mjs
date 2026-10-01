// Operator-owned focused oracle copied into a new private project before inference.
// Generated modules are loaded only in a child process or an isolated VM realm.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const ENTRY = 'src/index.mjs';
const ENV = { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' };

function child(argv) {
  const result = spawnSync(process.execPath, argv, {
    cwd: process.cwd(), env: ENV, encoding: 'utf8', timeout: 6000,
    maxBuffer: 65536, shell: false,
  });
  assert.equal(result.error, undefined, 'subject child must start and finish');
  assert.equal(result.signal, null, 'subject child must not die by signal');
  return result;
}

function completeJSON(commands) {
  const result = child([ENTRY, JSON.stringify(commands)]);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(result.stdout.trim(), JSON.stringify(value), 'one complete JSON result');
  return value;
}

const first = { id: 1, title: 'Write report', priority: 2, status: 'todo' };
const second = { id: 2, title: 'Fix login', priority: 3, status: 'todo' };
const third = { id: 3, title: 'Pay invoice', priority: 1, status: 'todo' };
const firstUpdated = { id: 1, title: 'Write final report', priority: 3, status: 'todo' };
const secondDoing = { id: 2, title: 'Fix login', priority: 3, status: 'doing' };
const secondDone = { id: 2, title: 'Fix login', priority: 3, status: 'done' };
const fourth = { id: 4, title: 'Archive notes', priority: 2, status: 'todo' };
const commands = [
  ['add', first.title, first.priority], ['add', second.title, second.priority],
  ['add', third.title, third.priority], ['list', { sort: 'priority' }],
  ['update', 1, { title: firstUpdated.title, priority: firstUpdated.priority }],
  ['transition', 2, 'doing'], ['list', { status: 'todo', sort: 'priority' }],
  ['transition', 2, 'done'], ['remove', 3], ['list'],
  ['add', fourth.title, fourth.priority], ['list'],
];
const expected = [
  first, second, third, [second, first, third], firstUpdated, secondDoing,
  [firstUpdated, third], secondDone, true, [firstUpdated, secondDone],
  fourth, [firstUpdated, secondDone, fourth],
];
assert.deepEqual(completeJSON(commands), expected, 'complete 12-command TaskFlow behavior');
assert.deepEqual(completeJSON([['list'], ['list', { status: 'done' }]]),
  [[], []], 'a fresh process starts empty');

const statusA = { id: 1, title: 'Investigate', priority: 2, status: 'todo' };
const statusB = { id: 2, title: 'Implement', priority: 3, status: 'todo' };
const statusDoing = { ...statusA, status: 'doing' };
const statusDone = { ...statusA, status: 'done' };
assert.deepEqual(completeJSON([
  ['add', statusA.title, statusA.priority], ['add', statusB.title, statusB.priority],
  ['transition', 1, 'doing'], ['list', { status: 'doing' }],
  ['transition', 1, 'done'], ['list', { status: 'done' }],
  ['list', { status: 'todo' }],
]), [statusA, statusB, statusDoing, [statusDoing], statusDone, [statusDone], [statusB]],
'doing and done filters must contain actual tasks');

const whitespaceInitial = { id: 1, title: '  draft  ', priority: 2, status: 'todo' };
const whitespaceTitle = { ...whitespaceInitial, title: '  final  ' };
const whitespacePriority = { ...whitespaceTitle, priority: 3 };
assert.deepEqual(completeJSON([
  ['add', whitespaceInitial.title, whitespaceInitial.priority],
  ['update', 1, { title: whitespaceTitle.title }],
  ['update', 1, { priority: whitespacePriority.priority }],
  ['list'],
]), [whitespaceInitial, whitespaceTitle, whitespacePriority, [whitespacePriority]],
'legal whitespace and single-field patches preserve untouched values');

const randomTitle = 'task_' + randomBytes(12).toString('hex');
const randomOther = 'other_' + randomBytes(12).toString('hex');
const varied = completeJSON([
  ['add', randomTitle, 2], ['add', randomOther, 3],
  ['transition', 1, 'doing'], ['list', { status: 'doing' }],
  ['update', 2, { priority: 1 }], ['list', { sort: 'priority' }],
]);
const randomFirst = { id: 1, title: randomTitle, priority: 2, status: 'todo' };
const randomSecond = { id: 2, title: randomOther, priority: 3, status: 'todo' };
assert.deepEqual(varied, [
  randomFirst, randomSecond, { ...randomFirst, status: 'doing' },
  [{ ...randomFirst, status: 'doing' }],
  { ...randomSecond, priority: 1 },
  [{ ...randomFirst, status: 'doing' }, { ...randomSecond, priority: 1 }],
], 'fresh unpredictable task values and priority order');

for (const invalid of [
  [['add', '', 2]], [['add', 3, 2]], [['add', 'x', 0]], [['add', 'x', 4]],
  [['add', 'x', 1.5]], [['add', 'x', '2']], [['add', 'x', 2], ['update', 1, {}]],
  [['add', 'x', 2], ['update', 1, { status: 'done' }]],
  [['add', 'x', 2], ['transition', 1, 'done']],
  [['add', 'x', 2], ['transition', 1, 'todo']],
  [['add', 'x', 2], ['remove', 9]],
  [['list', { other: true }]], [['list', { status: 'blocked' }]],
  [['add', 'x']], [['unknown']],
]) {
  assert.notEqual(child([ENTRY, JSON.stringify(invalid)]).status, 0,
    'invalid CLI command must fail');
}

// Generated code is never imported into this trusted Node realm. Only the
// declared pure module graph is linked inside a VM with no host callbacks.
const globals = Object.create(null);
globals.console = undefined;
const context = vm.createContext(globals, { codeGeneration: { strings: false, wasm: false } });
const modules = new Map();
function load(relative) {
  assert.ok(['src/store.js', 'src/query.js', 'src/validate.js'].includes(relative),
    'exact TaskFlow VM module graph');
  if (!modules.has(relative)) {
    modules.set(relative, new vm.SourceTextModule(fs.readFileSync(relative, 'utf8'), {
      context, identifier: relative,
      importModuleDynamically: () => { throw new Error('dynamic imports denied'); },
    }));
  }
  return modules.get(relative);
}
const store = load('src/store.js');
await store.link((specifier, importing) => {
  assert.equal(importing.identifier, 'src/store.js', 'query and validate have no imports');
  assert.ok(['./query.js', './validate.js'].includes(specifier), 'store dependency allowlist');
  return load(path.posix.join(path.posix.dirname(importing.identifier), specifier));
});
await store.evaluate({ timeout: 1000 });
assert.ok(modules.has('src/query.js') && modules.has('src/validate.js'),
  'store links both declared dependencies');
context.createBoard = store.namespace.createBoard;
context.select = modules.get('src/query.js').namespace.select;
for (const key of ['validateId', 'validatePatch', 'validateOptions']) {
  context[key] = modules.get('src/validate.js').namespace[key];
}
const evaluate = source => vm.runInContext(source, context, { timeout: 1000 });
for (const name of ['process', 'console', 'requ' + 'ire', 'Buffer', 'structuredClone', 'fetch', 'setTimeout']) {
  assert.equal(evaluate('typeof ' + name), 'undefined', name + ' absent from VM');
}

const directTitle = 'direct_' + randomBytes(12).toString('hex');
evaluate('globalThis.board=createBoard()');
const returned = evaluate('board.add(' + JSON.stringify(directTitle) + ',2)');
const firstList = evaluate('board.list()');
const secondList = evaluate('board.list()');
assert.notEqual(firstList, secondList, 'list arrays are independent');
assert.notEqual(firstList[0], secondList[0], 'list rows are independent');
assert.notEqual(returned, firstList[0], 'add result is a copy');
try { returned.title = 'corrupted return'; } catch { /* frozen independent copy is safe */ }
try { firstList[0].title = 'corrupted list'; } catch { /* frozen independent copy is safe */ }
assert.equal(secondList[0].title, directTitle, 'second snapshot stays unchanged');
assert.equal(evaluate('board.list()[0].title'), directTitle, 'stored row stays unchanged');

const before = JSON.stringify(evaluate('board.list()'));
for (const expression of ['0', '-1', '1.5', "'1'", '9007199254740992', 'NaN',
  'Infinity', '-Infinity']) {
  assert.throws(() => evaluate('validateId(' + expression + ')'),
    error => error?.name === 'TypeError', 'invalid positive-safe id ' + expression);
  assert.throws(() => evaluate('board.update(' + expression + ',{title:"changed"})'),
    'invalid id update fails');
  assert.equal(JSON.stringify(evaluate('board.list()')), before,
    'invalid id update leaves state unchanged');
}
for (const expression of ['{}', "{status:'done'}", "{title:'   '}",
  '{priority:1.5}', 'null', '[]', "'title'"]) {
  assert.throws(() => evaluate('validatePatch(' + expression + ')'),
    error => error?.name === 'TypeError', 'invalid patch ' + expression);
  assert.throws(() => evaluate('board.update(1,' + expression + ')'),
    'invalid patch update fails');
  assert.equal(JSON.stringify(evaluate('board.list()')), before,
    'invalid patch leaves state unchanged');
}
for (const expression of ["{status:'blocked'}", "{sort:'descending'}",
  '{other:true}', 'null', '[]', "'todo'"]) {
  assert.throws(() => evaluate('validateOptions(' + expression + ')'),
    error => error?.name === 'TypeError', 'invalid options ' + expression);
  assert.throws(() => evaluate('board.list(' + expression + ')'),
    'invalid options fail');
  assert.equal(JSON.stringify(evaluate('board.list()')), before,
    'invalid options leave state unchanged');
}
assert.throws(() => evaluate('board.transition(1,"done")'), 'skipped transition fails');
assert.equal(JSON.stringify(evaluate('board.list()')), before,
  'invalid transition leaves state unchanged');

const updated = evaluate('board.update(1,{title:"  changed  "})');
assert.equal(evaluate('board.list()[0].title'), '  changed  ', 'title bytes preserved');
assert.equal(evaluate('board.list()[0].priority'), 2, 'title-only patch preserves priority');
try { updated.title = 'tampered update result'; } catch { /* frozen independent copy is safe */ }
assert.equal(evaluate('board.list()[0].title'), '  changed  ', 'update result is independent');
evaluate('board.update(1,{priority:3})');
assert.equal(evaluate('board.list()[0].title'), '  changed  ', 'priority-only patch preserves title');
const transitioned = evaluate('board.transition(1,"doing")');
assert.equal(evaluate('board.list({status:"doing"}).length'), 1, 'nonempty doing filter');
try { transitioned.title = 'tampered transition result'; } catch { /* frozen independent copy is safe */ }
assert.equal(evaluate('board.list()[0].title'), '  changed  ', 'transition result is independent');
evaluate('board.transition(1,"done")');
assert.equal(evaluate('board.list({status:"done"}).length'), 1, 'nonempty done filter');
assert.throws(() => evaluate('board.transition(1,"doing")'), 'backward transition fails');
assert.throws(() => evaluate('board.transition(1,"done")'), 'same-state transition fails');
evaluate('board.remove(1)');
assert.equal(evaluate('board.list().length'), 0, 'remove changes stored state');
assert.equal(evaluate('board.add("after removal",1).id'), 2, 'ids are never recycled');

evaluate('globalThis.queryRows=['
  + '{id:9,title:"ninth",priority:2,status:"todo"},'
  + '{id:2,title:"second",priority:2,status:"doing"},'
  + '{id:7,title:"seventh",priority:3,status:"done"}]');
const priorityRows = evaluate('select(queryRows,{sort:"priority"})');
assert.deepEqual(Array.from(priorityRows, row => row.id), [7, 2, 9],
  'priority tie is ordered by id independent of input order');
assert.deepEqual(Array.from(evaluate('select(queryRows,{sort:"created"})'), row => row.id),
  [2, 7, 9], 'created order is by id independent of input order');
assert.deepEqual(Array.from(evaluate('queryRows'), row => row.id), [9, 2, 7],
  'query does not reorder the input array');
try { priorityRows[0].title = 'tampered'; } catch { /* frozen independent copy is safe */ }
assert.equal(evaluate('queryRows[2].title'), 'seventh', 'query returns row copies');

console.log('TASKFLOW_APP_ORACLE_PASS');
