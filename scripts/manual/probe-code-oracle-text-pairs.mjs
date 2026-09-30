// Offline falsification of free-text checks. Never a model-scoring replay.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { buildTests, loadFixtureTasks } from '../../src/eval/code-patch-suite.js';
import { applyAndTest } from '../../src/eval/code-patch-runner.js';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out' || !isAbsolute(args[1])) {
  console.error('Usage: node scripts/manual/probe-code-oracle-text-pairs.mjs --out /absolute/new-report.json');
  process.exit(2);
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
// IDs refer to the frozen 154-site inventory from 2026-09-23. Equivalent
// examples preserve behavior; contradictions preserve the matched vocabulary.
const pairs = [
  { task: 'patch_90eff80ecb8a', siteIds: [123], name: 'threshold',
    from: 'nedosáhl prahu', positive: 'je pod požadovaným prahem',
    negative: 'překročil práh; není pravda, že nedosáhl prahu' },
  { task: 'patch_90eff80ecb8a', siteIds: [124], name: 'speed',
    from: '${ratio.toFixed(2)}× rychlejší', positive: '${ratio.toFixed(2)}krát rychlejší',
    negative: '${ratio.toFixed(2)}× pomalejší, nikoli rychlejší' },
  { task: 'patch_90eff80ecb8a', siteIds: [125], name: 'unmeasured-speed',
    from: 'rychlost není změřená', positive: 'měření rychlosti chybí',
    negative: 'rychlost je změřená; neplatí tvrzení, že rychlost není změřená' },
  { task: 'patch_8b7557d1f9f5', siteIds: [128], name: 'nonfinite',
    from: 'not a finite number', positive: 'a non-finite number',
    negative: 'finite; the statement "not a finite number" is false' },
  { task: 'patch_50584fdde027', siteIds: [138], name: 'vram-overflow',
    from: 'nevejde se do VRAM', positive: 'překračuje kapacitu grafické paměti',
    negative: 'vejde se celý na GPU; neplatí, že se nevejde se do VRAM' },
  { task: 'patch_e4407e5ef59d', siteIds: [81], name: 'empty-creative',
    from: 'Empty creative response', positive: 'No creative content was supplied',
    negative: 'Creative response is not empty; substantive content is present' },
  { task: 'patch_e4407e5ef59d', siteIds: [82], name: 'short-creative',
    from: 'Creative response too short:', positive: 'Creative response below minimum length:',
    negative: 'Creative response is not too short; its length is sufficient:' },
  { task: 'patch_e2414b1b4dd8', siteIds: [149], name: 'empty-file',
    from: 'File is empty', positive: 'File contains no content',
    negative: 'File is not empty; it contains executable code' },
  { task: 'patch_e2414b1b4dd8', siteIds: [150], name: 'missing-import',
    from: 'not found on disk', positive: 'absent from the filesystem',
    negative: 'present on disk; the assertion "not found" is false' },
];
const report = {
  schemaVersion: 1, status: 'RUNNING', inference: false, productionImported: false,
  oracleAccepted: false, modelReplay: false,
  scope: 'Original full isolated runner and original scoring configuration, gold replacements only.',
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  sourceHashes: Object.fromEntries(['scripts/manual/probe-code-oracle-text-pairs.mjs',
    'src/eval/code-patch-runner.js', 'src/eval/code-patch-suite.js', 'src/eval/code-suite-tasks.json',
    'src/eval/code-contract-check.mjs'].map(file => [file, hash(readFileSync(root + file))])),
  pairs, results: [],
};
writeFileSync(args[1], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const flush = () => writeFileSync(args[1], JSON.stringify(report, null, 2) + '\n');
const tests = buildTests(root, loadFixtureTasks(root, undefined, { includeNonActive: true }));
for (const taskName of [...new Set(pairs.map(p => p.task))]) {
  const task = tests.find(t => t.name === taskName).prepare();
  const gold = applyAndTest(root, task, task.goldTexts);
  const record = { task: taskName, gold, cases: [] };
  report.results.push(record); flush();
  // A failed reference cannot certify either direction of a score difference.
  if (gold.valid !== true || gold.score !== 1 || gold.timedOut) {
    record.status = 'REFERENCE_NOT_VALID'; flush(); continue;
  }
  for (const pair of pairs.filter(p => p.task === taskName)) {
    for (const kind of ['positive', 'negative']) {
      const codes = task.goldTexts.map(c => c.replaceAll(pair.from, pair[kind]));
      if (codes.every((c, i) => c === task.goldTexts[i])) throw Error('PROBE_DID_NOT_MUTATE:' + pair.name);
      const result = applyAndTest(root, task, codes);
      const evaluable = result.valid === true && !result.timedOut;
      // Negative prose must not earn complete correctness. We do not invent
      // a new partial score or rewrite any historical candidate grade.
      const agrees = evaluable && (kind === 'positive' ? result.score === gold.score : result.score < 1);
      record.cases.push({ name: pair.name, siteIds: pair.siteIds, kind,
        expectedRelation: kind === 'positive' ? 'equal_to_gold' : 'not_fully_correct',
        evaluable, agreesWithSemanticExpectation: agrees, result,
        replacementSha256: hash(JSON.stringify(codes)), codes });
      flush(); console.log(taskName, pair.name, kind, result.score, agrees ? 'AGREES' : 'DISAGREES');
    }
  }
  record.status = record.cases.some(c => !c.agreesWithSemanticExpectation) ? 'ORACLE_COUNTEREXAMPLES' : 'NO_COUNTEREXAMPLE';
}
report.status = report.results.some(r => r.status !== 'NO_COUNTEREXAMPLE')
  ? 'ORACLE_REVIEW_REQUIRED' : 'NO_COUNTEREXAMPLE_IN_PROBED_CASES';
report.finishedAt = new Date().toISOString(); flush();
if (report.status === 'ORACLE_REVIEW_REQUIRED') process.exitCode = 1;
