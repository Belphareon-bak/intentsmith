// Explicit amended operator oracle PROPOSAL before live freeze; not generated application code. Run only within the
// existing canonical process sandbox when evaluating model-produced sources.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt } from 'node:crypto';
import { verifyFanEntry } from './fan-monitor-entry-oracle.mjs';

export const CORE_GRAPH = Object.freeze({
  'src/readings.mjs': [], 'src/history.mjs': [],
  'src/monitor.mjs': ['./history.mjs', './readings.mjs'],
});
export const CLI_GRAPH = Object.freeze({ ...CORE_GRAPH,
  'src/cli.mjs': ['./monitor.mjs'],
  // Parse exact entry imports; evaluate entry only in actual sandbox children.
  'src/index.mjs': ['./cli.mjs', 'node:url'],
});

const SCENARIO = String.raw`
globalThis.calls={list:0,read:0,clock:0};
globalThis.now=7200000;
globalThis.tree={
  directories:{'/sys/class/hwmon':['hwmon8','hwmon2'],
    '/sys/class/hwmon/hwmon8':['fan2_input','fan1_input','temp1_input','fan_input'],
    '/sys/class/hwmon/hwmon2':['fan1_input']},
  files:{'/sys/class/hwmon/hwmon8/fan2_input':'0\n',
    '/sys/class/hwmon/hwmon8/fan1_input':'1357\n',
    '/sys/class/hwmon/hwmon2/fan1_input':'invalid'}
};
globalThis.reader={
  list(p){calls.list++;if(!Object.hasOwn(tree.directories,p))throw new Error('missing directory');return [...tree.directories[p]];},
  read(p){calls.read++;if(!Object.hasOwn(tree.files,p))throw new Error('missing file');return tree.files[p];}
};
globalThis.clock=()=>{calls.clock++;return now;};
`;

export async function verifyFanSources(sources, { phase = 'core' } = {}) {
  assert.ok(['core', 'cli'].includes(phase), 'known oracle phase');
  const graph = phase === 'core' ? CORE_GRAPH : CLI_GRAPH;
  const globals = Object.create(null);
  globals.console = undefined;
  const context = vm.createContext(globals, {
    codeGeneration: { strings: false, wasm: false },
  });
  const evaluate = source => vm.runInContext(source, context, { timeout: 1000 });
  const json = source => JSON.parse(evaluate('JSON.stringify(' + source + ')'));
  const modules = new Map();
  for (const [relative, dependencies] of Object.entries(graph)) {
    assert.equal(typeof sources[relative], 'string', relative + ': complete source');
    const module = new vm.SourceTextModule(sources[relative], {
      context, identifier: relative,
      importModuleDynamically: () => { throw new Error('FAN_ORACLE_DYNAMIC_IMPORT_DENIED'); },
    });
    assert.deepEqual([...module.dependencySpecifiers].sort(), dependencies,
      relative + ': exact declared static dependencies');
    modules.set(relative, module);
  }
  await modules.get(phase === 'core' ? 'src/monitor.mjs' : 'src/cli.mjs').link((specifier, from) => {
    assert.ok(graph[from.identifier].includes(specifier), 'declared local import');
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(from.identifier), specifier));
    assert.ok(modules.has(target), 'declared complete source target');
    return modules.get(target);
  });
  evaluate(SCENARIO);
  for (const parsedModule of modules.values()) {
    if (parsedModule.status === 'linked') await parsedModule.evaluate({ timeout: 1000 });
  }
  assert.deepEqual(json('calls'), { list: 0, read: 0, clock: 0 }, 'import does no reader/clock I/O');
  for (const name of ['process', 'require', 'console', 'Buffer', 'setTimeout', 'setInterval', 'fetch']) {
    assert.equal(evaluate('typeof ' + name), 'undefined', name + ': absent host capability');
  }
  context.parseRpm = modules.get('src/readings.mjs').namespace.parseRpm;
  context.readFans = modules.get('src/readings.mjs').namespace.readFans;
  context.retainHistory = modules.get('src/history.mjs').namespace.retainHistory;
  context.createMonitor = modules.get('src/monitor.mjs').namespace.createMonitor;
  for (const [raw, expected] of [['0\n', 0], [' 1357\n', 1357], ['9007199254740991', 9007199254740991]]) {
    assert.equal(evaluate('parseRpm(' + JSON.stringify(raw) + ')'), expected, 'parse valid RPM ' + raw);
  }
  for (const expression of ['""', '"  "', '"-1"', '"1.5"', '"12x"', '"Infinity"',
    '"9007199254740992"', '"1e3"', 'null', 'undefined', '1357', '{}']) {
    assert.equal(evaluate('parseRpm(' + expression + ')'), null, 'invalid RPM is missing: ' + expression);
  }
  const variedRpm = randomInt(2000, 9000);
  assert.equal(evaluate('parseRpm(' + JSON.stringify(String(variedRpm) + '\n') + ')'), variedRpm,
    'new valid RPM value is parsed');
  const variedRoot = '/virtual/' + randomBytes(6).toString('hex');
  const variedPath = variedRoot + '/hwmon9/fan3_input';
  evaluate('globalThis.variedTree=' + JSON.stringify({ directories: {
    [variedRoot]: ['hwmon9'], [variedRoot + '/hwmon9']: ['fan3_input'],
  }, files: { [variedPath]: String(variedRpm) + '\n' } }) + ';globalThis.variedReader={list:p=>variedTree.directories[p],read:p=>variedTree.files[p]}');
  assert.deepEqual(json('readFans(variedReader,' + JSON.stringify(variedRoot) + ')'),
    [{ id: variedPath, rpm: variedRpm }], 'new root and values follow reader input');
  const initial = [
    { id: '/sys/class/hwmon/hwmon2/fan1_input', rpm: null },
    { id: '/sys/class/hwmon/hwmon8/fan1_input', rpm: 1357 },
    { id: '/sys/class/hwmon/hwmon8/fan2_input', rpm: 0 },
  ];
  assert.deepEqual(json('readFans(reader)'), initial, 'nested sensor paths, deterministic order, zero and missing');
  assert.equal(evaluate('calls.read'), 3, 'only fanN_input files read, no temperature/invalid basename');
  evaluate("delete tree.files['/sys/class/hwmon/hwmon8/fan1_input']");
  assert.deepEqual(json('readFans(reader)'), initial.map(row => row.rpm === 1357 ? { ...row, rpm: null } : row),
    'a missing fan reading preserves its gap');
  evaluate("tree.directories['/sys/class/hwmon']=[]");
  assert.deepEqual(json('readFans(reader)'), [], 'no sensors yields empty readings');
  evaluate("delete tree.directories['/sys/class/hwmon']");
  assert.deepEqual(json('readFans(reader)'), [], 'root I/O outage yields empty readings');
  evaluate(SCENARIO);
  evaluate('globalThis.monitor=createMonitor({reader,clock})');
  assert.deepEqual(json('calls'), { list: 0, read: 0, clock: 0 }, 'constructor does no reader/clock I/O');
  assert.deepEqual(json('monitor.sample()'), { atMs: 7200000, sensors: initial }, 'actual first sampled result');
  assert.equal(evaluate('calls.clock'), 1, 'one clock call per sample');
  evaluate('globalThis.snapshot=monitor.history(); snapshot[0].sensors[1].rpm=999; snapshot.push({atMs:now,sensors:[]})');
  assert.deepEqual(json('monitor.history()'), [{ atMs: 7200000, sensors: initial }], 'history snapshots cannot mutate retained rows');
  evaluate("now=7200001;tree.files['/sys/class/hwmon/hwmon8/fan1_input']='0';monitor.sample()");
  assert.equal(json('monitor.history()').at(-1).sensors[1].rpm, 0, 'real zero RPM retained after normal reading');
  evaluate("now=7200002;delete tree.files['/sys/class/hwmon/hwmon8/fan1_input'];monitor.sample()");
  assert.equal(json('monitor.history()').at(-1).sensors[1].rpm, null, 'sensor outage creates history gap');
  evaluate('now=10800000');
  assert.equal(json('monitor.history()')[0].atMs, 7200000, 'exact one-hour boundary included');
  evaluate('now=10800001');
  assert.equal(json('monitor.history()')[0].atMs, 7200001, 'one millisecond older than one hour pruned');
  evaluate('now=14400003');
  assert.deepEqual(json('monitor.history()'), [], 'all expired samples pruned without new sampling');
  evaluate('globalThis.rows=[{atMs:0,sensors:[{id:"x",rpm:0}]},{atMs:1000,sensors:[]},{atMs:2000,sensors:[]}];globalThis.before=JSON.stringify(rows)');
  assert.deepEqual(json('retainHistory(rows,2000,2000,2)'), [
    { atMs: 1000, sensors: [] }, { atMs: 2000, sensors: [] },
  ], 'sample cap retains newest rows');
  assert.equal(evaluate('JSON.stringify(rows)'), evaluate('before'), 'retention does not mutate caller array');
  evaluate('globalThis.copy=retainHistory(rows,2000,2000,10);copy[0].sensors[0].rpm=999');
  assert.equal(evaluate('rows[0].sensors[0].rpm'), 0, 'retention deep-copies sensor rows');
  for (const [windowMs, maxSamples] of [[0, 1], [-1, 1], [3600001, 1], [1.5, 1], [1000, 0], [1000, -1], [1000, 10001], [1000, 1.5]]) {
    assert.throws(() => evaluate('createMonitor({reader,clock,windowMs:' + windowMs + ',maxSamples:' + maxSamples + '})'),
      'invalid history limits rejected');
  }
  for (const options of ['{}', '{reader}', '{clock}', '{reader,clock:0}']) {
    assert.throws(() => evaluate('createMonitor(' + options + ')'), 'reader and clock are required injections');
  }
  for (const nowValue of ['-1', '1.5', 'NaN', 'Infinity', 'undefined']) {
    assert.throws(() => evaluate('retainHistory([], ' + nowValue + ')'), 'invalid history clock rejected');
  }
  assert.deepEqual(json('retainHistory([{atMs:2001,sensors:[]}],2000)'), [], 'future samples excluded');
  evaluate('now=1000;globalThis.small=createMonitor({reader,clock,windowMs:1000,maxSamples:2});small.sample();now=1001;small.sample();now=1002;small.sample()');
  assert.deepEqual(json('small.history()').map(row => row.atMs), [1001, 1002], 'monitor applies bounded sample cap');
  evaluate('now=1001');
  assert.throws(() => evaluate('small.sample()'), 'backward clock sampling rejected');
  evaluate('now=1002');
  assert.deepEqual(json('small.history()').map(row => row.atMs), [1001, 1002], 'invalid sample leaves retained history unchanged');
  if (phase === 'cli') {
    context.run = modules.get('src/cli.mjs').namespace.run;
    evaluate(SCENARIO);
    const tree = JSON.parse(evaluate('JSON.stringify(tree)'));
    const commands = [['sample', 2000, tree], ['history', 2000], ['history', 3602001]];
    const output = json('run(' + JSON.stringify(commands) + ')');
    assert.deepEqual(output, [
      { atMs: 2000, sensors: initial }, [{ atMs: 2000, sensors: initial }], [],
    ], 'CLI uses injected frames, actual readings and advancing history clock');
    assert.deepEqual(json('run([["history",0]])'), [[]], 'fresh CLI invocation has no history');
    for (const expression of ['null', '{}', '1', '"history"']) {
      assert.throws(() => evaluate('run(' + expression + ')'), 'non-array commands rejected');
    }
    for (const options of ['null', '[]', '{windowMs:0}', '{maxSamples:0}']) {
      assert.throws(() => evaluate('run([], ' + options + ')'), 'invalid CLI options rejected');
    }
    for (const commands of [[['unknown']], [['sample']], [['history']], [['history', -1]],
      [['sample', 0, null]], [['history', '0']], [['sample', 0, tree, 'extra']]]) {
      assert.throws(() => evaluate('run(' + JSON.stringify(commands) + ')'), 'invalid tuple rejected');
    }
  }
  return { status: 'CPU_SUBJECT_ORACLE_PASS', phase, checkedPaths: Object.keys(graph),
    evaluatedPaths: [...modules.entries()].filter(([, module]) => module.status === 'evaluated').map(([relative]) => relative),
    subjectExecutionScope: 'restricted VM within required canonical OS process sandbox' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const phase = process.argv[2] ?? 'core';
  const graph = phase === 'core' ? CORE_GRAPH : CLI_GRAPH;
  const sources = Object.fromEntries(Object.keys(graph).map(relative => [relative, fs.readFileSync(relative, 'utf8')]));
  const result = await verifyFanSources(sources, { phase });
  if (phase === 'cli') result.entry = verifyFanEntry();
  process.stdout.write(JSON.stringify(result) + '\n');
}
