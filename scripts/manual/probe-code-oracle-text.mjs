// Falsification probes for the reviewed free-text oracle defects, without GPU.
// Captures current behaviour. A reproduced defect is NOT oracle acceptance.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { buildTests, loadFixtureTasks } from '../../src/eval/code-patch-suite.js';
import { applyAndTest } from '../../src/eval/code-patch-runner.js';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out' || !isAbsolute(args[1])) {
  console.error('Usage: node scripts/manual/probe-code-oracle-text.mjs --out /absolute/new-report.json');
  process.exit(2);
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const report = { schemaVersion: 1, sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  sourceHashes: Object.fromEntries(['../../src/eval/code-patch-runner.js', '../../src/eval/code-patch-suite.js',
    '../../src/eval/code-contract-check.mjs', '../../src/eval/code-suite-tasks.json'].map(file => [file,
      createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex')])),
  status: 'RUNNING', inference: false, productionImported: false, oracleAccepted: false, probes: [] };
writeFileSync(args[1], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const flush = () => writeFileSync(args[1], JSON.stringify(report, null, 2) + '\n');
const tests = buildTests(root, loadFixtureTasks(root, undefined, { includeNonActive: true }));
const confidence = tests.find(t => t.name === 'patch_90eff80ecb8a').prepare();
const cases = [
  ['gold', confidence.goldTexts, 1],
  ['equivalent-colon', confidence.goldTexts.map(c => c.replaceAll('jistota ${confidence}', 'jistota: ${confidence}')), 1],
  ['equivalent-inserted-word', confidence.goldTexts.map(c => c.replaceAll('jistota ${confidence}', 'jistota rozhodnutí: ${confidence}')), 1],
  // This carries the WHOLE exact API value and still explicitly contradicts it.
  ['contradictory-full-value', confidence.goldTexts.map(c => c.replaceAll('jistota ${confidence}', 'jistota ${confidence} neplatí; skutečná jistota je opačná')), 0],
];
for (const [name, codes, expected] of cases) {
  if (name !== 'gold' && JSON.stringify(codes) === JSON.stringify(confidence.goldTexts)) throw Error('PROBE_DID_NOT_MUTATE:' + name);
  const result = applyAndTest(root, confidence, codes);
  report.probes.push({ name, task: 'patch_90eff80ecb8a', expected, observed: result.score,
    valid: result.valid, outcome: result.outcome, agreesWithPublicContract: result.valid === true && result.score === expected,
    replacementSha256: createHash('sha256').update(JSON.stringify(codes)).digest('hex'),
    codes, result });
  flush(); console.log(name, result.valid, result.score, 'expected', expected);
}
const math = tests.find(t => t.name === 'patch_8b7557d1f9f5').prepare();
for (const [name, phrase, expected] of [['math-gold', null, 1], ['math-equivalent-explanation', 'a non-finite number', 1]]) {
  const codes = phrase == null ? math.goldTexts : math.goldTexts.map(c => c.replaceAll('not a finite number', phrase));
  if (phrase && JSON.stringify(codes) === JSON.stringify(math.goldTexts)) throw Error('PROBE_DID_NOT_MUTATE:' + name);
  const result = applyAndTest(root, math, codes);
  report.probes.push({ name, task: 'patch_8b7557d1f9f5', expected, observed: result.score,
    valid: result.valid, outcome: result.outcome, agreesWithPublicContract: result.valid === true && result.score === expected,
    replacementSha256: createHash('sha256').update(JSON.stringify(codes)).digest('hex'), codes, result });
  flush(); console.log(name, result.valid, result.score, 'expected', expected);
}
const api = 'nízká (jediná úloha)';
report.proposedIncludesCheck = { confidence: api, detail: `Neplatí ${api}; jistota je vysoká`,
  acceptedByIncludes: `Neplatí ${api}; jistota je vysoká`.includes(api), semanticallyConsistent: false };
report.status = report.probes.some(p => !p.agreesWithPublicContract) ? 'ORACLE_DEFECTS_REPRODUCED' : 'NO_DEFECT_REPRODUCED';
report.finishedAt = new Date().toISOString(); flush();
// This command reports failure of the oracle, not a green acceptance test.
if (report.status !== 'NO_DEFECT_REPRODUCED') process.exitCode = 1;
