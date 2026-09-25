// Read-only review evidence, not a CHAT decision or a sample-size/power planner.
// node docs/review/evidence/2026-09-24-workflow-method-check.mjs [panel-root]
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { boundedGroupInterval } from '../../../src/eval/code-pilot-decision.js';

const base = process.argv[2] || '/mnt/vi7000/intentsmith/evidence/hunt-chat-panel-20260923';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = ['capture/plan.json', 'capture/events.jsonl', 'review-full-05/review.json',
  'review-full-05/PRIVATE-identity-key.json', 'assessment-20260924/assessment.json',
  'assessment-20260924/coverage.json', 'assessment-20260924/first-review-freeze.json'];
const hashes = () => Object.fromEntries(sources.map(p => [p, hash(readFileSync(`${base}/${p}`))]));
const before = hashes();
const json = p => JSON.parse(readFileSync(`${base}/${p}`, 'utf8'));
const review = json('review-full-05/review.json');
const identities = new Map(json('review-full-05/PRIVATE-identity-key.json').identities.map(x => [x.id, x]));
const assessment = json('assessment-20260924/assessment.json');
const coverage = json('assessment-20260924/coverage.json');
assert.deepEqual(assessment.coverage, coverage);
assert.equal(review.items.length, 1200);
assert.equal(identities.size, review.items.length);
assert.equal(coverage.wholePanelRankingAvailable, false);
const groups = new Map();
for (const item of review.items) {
  const identity = identities.get(item.id);
  assert(identity);
  const transcriptHash = hash(JSON.stringify(item.conversation.transcript));
  assert.equal(transcriptHash, item.conversation.transcriptSha256);
  const key = `${identity.model}|${item.task}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(item);
}
const triples = [...groups.values()].filter(xs => xs.length === 3 && xs.every(x => x.captureStatus === 'CAPTURED'));
const identical = triples.filter(xs => new Set(xs.map(x => x.conversation.transcriptSha256)).size === 1);
assert.equal(triples.length, 396);
assert.equal(identical.length, 25);
const at = (n, effect) => boundedGroupInterval(Array(n).fill(effect), 0.05);
const examples = [.08, .10, .17].map(effect => {
  // This function depends on the bounded mean and N, not empirical variance.
  // Holding the observed mean fixed is NOT a power calculation or a forecast.
  let lo = 1, hi = 10000;
  assert(at(hi, effect).lower > .04);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (at(mid, effect).lower > .04) hi = mid;
    else lo = mid + 1;
  }
  assert(at(lo, effect).lower > .04);
  if (lo > 1) assert(at(lo - 1, effect).lower <= .04);
  return { hypotheticalMeanDifference: effect, groups20: at(20, effect),
    firstNWithLowerAbove004AtExactlyThisObservedMean: lo, power: null };
});
const methodPath = new URL('../../../src/eval/code-pilot-decision.js', import.meta.url);
const contractPath = new URL('../../wp/WP-GPU-HUNT-EVALUATION-CONTRACT-20260918.md', import.meta.url);
const after = hashes();
assert.deepEqual(after, before);
console.log(JSON.stringify({ status: 'REPRODUCED_DESIGN_REVIEW_ONLY', decisionAuthority: false,
  inference: false, modelGradesChanged: false, powerAnalysisComplete: false,
  sourceHashes: before, originalSourcesUnchanged: true,
  method: { path: 'src/eval/code-pilot-decision.js', sha256: hash(readFileSync(methodPath)),
    function: 'boundedGroupInterval', alpha: .05, minimumBenefit: .04,
    acceptedChatMethod: false }, contractSha256: hash(readFileSync(contractPath)),
  capture: { items: review.items.length,
    declaredIndependenceGroups: new Set(review.items.map(x => x.independenceGroup)).size,
    groupIndependenceNotRevalidatedHere: true, completeTriples: triples.length,
    byteIdenticalTriples: identical.length, coverage },
  illustrations: examples, possibleLargeEffectAt20Groups: at(20, 1),
  limitations: [
    'Review lower bound +0.027 and 50-140 groups lack supplied paired grades, method and power assumptions; not reproduced.',
    'The illustrations do not estimate model quality or required sample size with a target power.',
    'Current partial grades and the Opus /72 selection are not a full accepted paired CHAT dataset.',
    'Synthetic mutations, translations and repeats do not establish new independent origins.',
  ] }, null, 2));
