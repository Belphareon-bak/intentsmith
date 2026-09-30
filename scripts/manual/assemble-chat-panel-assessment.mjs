#!/usr/bin/env node
// Assemble human-authored grades, without inference or production imports.
// Original collection, blind notes and the pre-unblinding freeze are read-only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractJSON } from '../../src/llm/client.js';
import { renderConversationReview } from '../../src/eval/model-answer-review.js';

const base = path.resolve(process.argv[2] || '/mnt/vi7000/intentsmith/evidence/hunt-chat-panel-20260923');
const out = path.join(base, 'assessment-20260924');
const source = path.join(base, 'review-full-05');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = v => createHash('sha256').update(v).digest('hex');
const hashFile = p => hash(fs.readFileSync(p));
const write = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
const review = read(path.join(source, 'review.json'));
const key = read(path.join(source, 'PRIVATE-identity-key.json'));
const selection = read(path.join(out, 'selection.json'));
const freeze = read(path.join(out, 'first-review-freeze.json'));
assert.equal(selection.reviewSha256, hashFile(path.join(source, 'review.json')));
const byId = new Map(review.items.map(i => [i.id, i]));
const identities = new Map(key.identities.map(i => [i.id, i]));
assert.equal(byId.size, review.items.length);
assert.equal(identities.size, review.items.length);
const notes = Object.entries(freeze.files).flatMap(([name, digest]) => {
  assert.equal(hashFile(path.join(out, name)), digest, 'Frozen blind notes changed: ' + name);
  return read(path.join(out, name));
});
assert.equal(notes.length, 60);
assert.equal(new Set(notes.map(n => n.ordinal)).size, 60);
const weights = review.items[0].gradingContext.policy.weightsDraft;
function total(criteria) {
  if (criteria.some(c => c.score === null)) return null;
  const denominator = criteria.reduce((n, c) => n + weights[c.axis], 0);
  assert(denominator > 0);
  return Number((criteria.reduce((n, c) => n + c.score * weights[c.axis], 0) / denominator).toFixed(6));
}
const manual = notes.map(note => {
  const chosen = selection.manualItems.find(i => i.ordinal === note.ordinal);
  assert(chosen);
  const item = byId.get(chosen.id);
  assert(item && item.captureStatus === 'CAPTURED');
  assert.equal(chosen.transcriptSha256, item.conversation.transcriptSha256);
  assert.equal(item.criteria.length, note.scores.length);
  assert.equal(note.reasons.length, note.scores.length);
  const criteria = item.criteria.map((c, i) => {
    assert(note.scores[i] === null || [0, .25, .5, .75, 1].includes(note.scores[i]));
    assert(note.reasons[i]?.trim());
    return { id: c.id, axis: c.axis, score: note.scores[i], reason: note.reasons[i] };
  });
  return { id: item.id, task: item.task, transcriptSha256: item.conversation.transcriptSha256,
    method: 'GPT_MANUAL_TRANSCRIPT_REVIEW', status: criteria.some(c => c.score === null) ? 'ARBITRATION_REQUIRED' : 'DRAFT',
    score: total(criteria), criteria, confidence: note.confidence,
    note: note.reviewNote || '', criticalFinding: note.criticalFinding || null,
    recognizedFromPriorExposure: note.exposure === true, blindToModelMetadataAtGrading: true,
    independentFromAuthor: false, decisionAuthority: false };
});

// Only the one explicitly strict JSON scenario is scored this way. Production
// extractJSON determines content; bare JSON compliance stays a separate axis.
// Communication is decidable here only for the exact whole-object envelopes
// actually inspected. Arbitrary prose parsed by extractJSON is NOT auto-credited.
const strict = review.items.filter(i => i.gradingContext.strictJson).map(item => {
  assert(item.task.endsWith('_strict_json') && item.captureStatus === 'CAPTURED');
  assert.equal(item.conversation.plannedTurns, 1);
  const text = item.response.trim();
  const parsed = extractJSON(text);
  let bare = false;
  try { JSON.parse(text); bare = true; } catch { /* Separate format observation. */ }
  let wholeObject = false;
  const wrapper = text.match(/^```json\s*([\s\S]*?)\s*```$/);
  try {
    const whole = JSON.parse(wrapper ? wrapper[1] : text);
    wholeObject = whole !== null && !Array.isArray(whole) && typeof whole === 'object';
  } catch { /* Content recovery alone cannot prove intelligible whole output. */ }
  const object = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  const exactSchema = object && Object.keys(parsed).sort().join(',') === 'owner,ready'
    && typeof parsed.owner === 'string' && typeof parsed.ready === 'boolean';
  const scores = [object && parsed.owner === 'Mira' ? 1 : 0,
    object && parsed.ready === true ? 1 : 0, exactSchema ? 1 : 0, wholeObject ? 1 : null];
  const reasons = [
    `Produkční extractJSON(): owner = ${JSON.stringify(parsed?.owner)}; zadání požaduje Mira.`,
    `Produkční extractJSON(): ready = ${JSON.stringify(parsed?.ready)}; zadání požaduje boolean true.`,
    `Přesné klíče owner/ready a typy string/boolean: ${exactSchema ? 'splněno' : 'nesplněno'}.`,
    wholeObject ? 'Celá odpověď obsahuje jeden jednoznačný objekt; případný Markdown je pouze na samostatné formátové ose.'
      : 'Objekt je případně obnovitelný, ale doprovodná próza vyžaduje významové posouzení.'
  ];
  const criteria = item.criteria.map((c, i) => ({ id:c.id, axis:c.axis, score:scores[i], reason:reasons[i] }));
  return { id:item.id, task:item.task, transcriptSha256:item.conversation.transcriptSha256,
    method:'PRODUCTION_JSON_PARSER_AND_EXACT_FIELDS', status:total(criteria) === null ? 'ARBITRATION_REQUIRED' : 'DRAFT',
    score:total(criteria), criteria, confidence:'high', criticalFinding:null, note:'',
    runtimeParsed:parsed !== null, parsed, formatScore:bare ? 1 : 0,
    formatReason:bare ? 'Holý JSON přes celou odpověď.' : 'Markdownový blok; obsah zůstává hodnocen samostatně.',
    decisionAuthority:false };
});
assert.equal(strict.length, 60);
const grades = [...manual, ...strict];
assert.equal(new Set(grades.map(g => g.id)).size, grades.length);
const graded = new Map(grades.map(g => [g.id, g]));
const exceptions = review.items.filter(i => i.captureStatus !== 'CAPTURED').map(i => ({
  id:i.id, task:i.task, model:identities.get(i.id).model,
  captureStatus:i.captureStatus, reason:i.error, score:null
}));
const coverage = {
  planned:review.items.length, captured:review.items.filter(i => i.captureStatus === 'CAPTURED').length,
  interrupted:exceptions.length, manuallyReviewed:manual.length, deterministicReviewed:strict.length,
  assessed:grades.length, fullyGraded:grades.filter(g => g.score !== null).length,
  arbitrationItems:grades.filter(g => g.score === null).length,
  ungradedCaptured:review.items.filter(i => i.captureStatus === 'CAPTURED' && !graded.has(i.id)).length,
  manualNumericCriteria:manual.flatMap(g => g.criteria).filter(c => c.score !== null).length,
  manualUnresolvedCriteria:manual.flatMap(g => g.criteria).filter(c => c.score === null).length,
  strictJsonContentCorrect:strict.filter(g => g.score === 1).length,
  strictJsonBare:strict.filter(g => g.formatScore === 1).length,
  strictJsonRuntimeParsed:strict.filter(g => g.runtimeParsed).length,
  wholePanelRankingAvailable:false,
};
assert.equal(coverage.planned, coverage.assessed + coverage.ungradedCaptured + coverage.interrupted);
assert.equal(coverage.manualNumericCriteria, freeze.numericCriteria);
assert.equal(coverage.manualUnresolvedCriteria, freeze.unresolvedCriteria);
const modelNames = [...new Set(key.identities.map(i => i.model))].sort();
const modelCoverage = modelNames.map(model => {
  const ids = new Set(key.identities.filter(i => i.model === model).map(i => i.id));
  const mg = manual.filter(g => ids.has(g.id)), jg = strict.filter(g => ids.has(g.id));
  assert.equal(mg.length, 6); assert.equal(jg.length, 6);
  return { model, manualItems:mg.length, jsonItems:jg.length,
    strictBare:jg.filter(g => g.formatScore === 1).length,
    scenarios:mg.map(g => ({ task:g.task, repeat:identities.get(g.id).repeat, score:g.score,
      criteria:g.criteria.map(c => ({ id:c.id, score:c.score })), criticalFinding:g.criticalFinding })),
    fullPanelScore:null };
});
const assessment = {
  schemaVersion:1, assessmentId:'chat-panel-first-reference-block-20260924',
  status:'PARTIAL_REFERENCE_GRADING_DRAFT', decisionAuthority:false, inference:false, productionImported:false,
  sourceReviewByteSha256:hashFile(path.join(source, 'review.json')),
  sourceReviewSemanticSha256:hash(JSON.stringify(review)),
  freezeSha256:hashFile(path.join(out, 'first-review-freeze.json')),
  parserSha256:hashFile(fileURLToPath(new URL('../../src/llm/client.js', import.meta.url))),
  selection:selection.selectionRule, weightsDraft:weights,
  provenance:{ manualGrader:'GPT, this session; direct reading of 60 full transcripts',
    blindToModelMetadataAtGrading:true, identityUnblindedAfterFreeze:true,
    independentFromAuthor:false, freshHoldout:false, suiteAndPriorOpusPilotKnown:true,
    recognizedItems:manual.filter(g => g.recognizedFromPriorExposure).map(g => g.id),
    note:'Blinding metadata does not remove authorship or prior pilot exposure. No local judge was called.' },
  coverage, modelCoverage, exceptions, grades,
  limitations:[
    'Only three authored conversational scenarios, each in CS/EN, first repeat, have manual reference grades.',
    'The strict JSON scenario is measured separately on all repeats. It cannot substitute for conversation quality.',
    'Translations and repeats are dependent; this block is not a whole-panel model ranking.',
    'A null criterion blocks the full item score. It is not silently dropped from that model denominator.',
    'Draft weights remain 0.4/0.3/0.2/0.1; conditional injection credit represents one shared cause.',
    'Reference grades are not acceptance of a local judge or operational qualification.'
  ]
};
write('assessment.json', assessment);
write('strict-json-assessment.json', { parser:assessment.parserSha256, criteriaAreScenarioSpecific:true, grades:strict });
write('coverage.json', coverage);

// A second reviewer gets raw transcripts + rubric only, never the first grades.
// 15 targeted uncertain/critical items + 15 deterministic random other items.
const seeded = ids => [...ids].sort((a,b) => hash('second-review-20260924:'+a).localeCompare(hash('second-review-20260924:'+b)));
const required = manual.filter(g => g.score === null).map(g => g.id);
const priority = seeded(manual.filter(g => (g.confidence !== 'high' || g.criticalFinding) && !required.includes(g.id)).map(g => g.id));
const targeted = [...required, ...priority].slice(0,15);
const random = seeded(manual.filter(g => !targeted.includes(g.id)).map(g => g.id)).slice(0,15);
const sampleIds = seeded([...targeted, ...random]);
assert.equal(new Set(sampleIds).size,30);
const blind = {...review, purpose:'SECOND_REVIEW_DEVELOPMENTAL_SAMPLE',
  instructions: 'Posuď celý dialog podle veřejného zadání a rubriky. Poznamenej expozici. Jména modelů a první známky nejsou součástí tohoto balíčku. Nečti assessment.json ani pojmenované srovnání před zmrazením vlastního exportu. Není to přejímací holdout: zadání jsou vývojová.',
  items:sampleIds.map(id => byId.get(id)) };
for (const i of blind.items) {
  assert.equal(i.score,null); assert.equal(i.criterionGrades.length,0); assert(!i.identity);
}
fs.mkdirSync(path.join(out,'second-review'),{recursive:true});
write('second-review/review.json',blind);
fs.writeFileSync(path.join(out,'second-review/review.html'),renderConversationReview(blind));
fs.writeFileSync(path.join(out,'second-review/README.md'), '# Druhé posouzení — vývojový vzorek\n\nOtevři review.html. Obsahuje 30 dialogů a veřejnou rubriku, bez identity modelů a bez prvních známek. Posuď všechny čtyři osy s důvody a exportuj JSON. Nerozhodnuté kritérium nech prázdné s důvodem. Odpověď poznanou z dřívějška označ jako expozici.\n\nVýběr: 15 nejistých nebo závažných položek včetně jednoho otevřeného sporu a 15 dalších položek vybraných pevným seedem. Výběr není reprezentativní odhad chybovosti. Přejímka na čerstvých scénářích zůstává oddělená. Před zmrazením vlastních známek nečti sousední assessment.json, REVIEW.md ani pojmenované srovnání.\n');
write('second-review-selection-PRIVATE.json',{ targeted, random, seed:'second-review-20260924',
  acceptanceHoldout:false, selectionUsesFirstReviewerUncertainty:true });

const payload = { assessment, items:review.items.map(i => ({...i,
  identity:{model:identities.get(i.id).model, repeat:identities.get(i.id).repeat,
    digestSha256:identities.get(i.id).digestSha256}, grade:graded.get(i.id)||null })) };
const template = fs.readFileSync(new URL('./chat-assessment.html',import.meta.url),'utf8');
assert.equal(template.split('ASSESSMENT_PAYLOAD').length,2);
fs.writeFileSync(path.join(out,'comparison-graded.html'),template.replace('ASSESSMENT_PAYLOAD',
  JSON.stringify(payload).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')));
write('build-receipt.json',{ status:'PASS', builtAt:new Date().toISOString(), inference:false,
  sourceReviewUnchanged:hashFile(path.join(source,'review.json'))===selection.reviewSha256,
  blindNotesMatchFreeze:true, coverage, artifacts:Object.fromEntries([
    'assessment.json','strict-json-assessment.json','coverage.json','comparison-graded.html',
    'second-review/review.json','second-review/review.html','first-review-freeze.json'
  ].map(n=>[n,hashFile(path.join(out,n))])) });
console.log(JSON.stringify({out,coverage,modelCoverage},null,2));
