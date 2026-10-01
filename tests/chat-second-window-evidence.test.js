import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { CAPTURE_DIGEST, CAPTURE_MODEL } from '../scripts/provider-capture.js';
import { providerPromptText, validateSecondWindowEvidence } from '../scripts/chat-second-window-evidence.js';
import { FIRST_CODE, SECOND_CODE, FIRST_FACT, FINAL_QUESTION,
  secondWindowCase, secondWindowMessage, secondWindowSemanticQuality } from '../scripts/chat-second-window-values.js';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const sourceRevision = 'a'.repeat(40);
const projectA = { file: 'README-A.md', canary: 'ORION_A_FILE_391', rule: 'Piš čistý, čitelný kód' };
const projectB = { file: 'README-B.md', canary: 'LYRA_B_FILE_752',
  rule: 'Udržuj konzistenci postav a světa napříč celým textem' };

function row(label, user, content) {
  const messages = [{ role: 'system', content: `fixture ${label}` }, { role: 'user', content: user }];
  return { schemaVersion: 1, method: 'POST', path: '/api/chat', model: CAPTURE_MODEL,
    status: 200, done: true, doneReason: 'stop', stream: false,
    numCtx: 4096, numPredict: 512, promptEvalCount: 100,
    requestSha256: sha256(`request-${label}`), responseSha256: sha256(`response-${label}`),
    messages, terminal: { model: CAPTURE_MODEL, digest: CAPTURE_DIGEST,
      done: true, done_reason: 'stop', prompt_eval_count: 100,
      message: { role: 'assistant', content } } };
}

function receipt(rowValue) {
  return { requestSha256: rowValue.requestSha256, responseSha256: rowValue.responseSha256 };
}

function fixture() {
  const rows = [];
  const turns = [];
  const firstRaw = secondWindowMessage(1, 1);
  const secondRaw = secondWindowMessage(2, 1);
  const firstProse = `Uživatel určil ${FIRST_CODE}. ${FIRST_FACT}.`;
  const firstText = `${firstProse}\n\n[Doslovné citace z uživatelských zpráv; nejsou tvrzením asistenta]\n{"source":"user","messageId":1,"quote":"Auditní kód je ${FIRST_CODE}."}`;
  const secondProse = `Uživatel určil ${FIRST_CODE} a ${SECOND_CODE}. ${FIRST_FACT}.`;
  const secondText = `${secondProse}\n\n[Doslovné citace z uživatelských zpráv; nejsou tvrzením asistenta]\n{"source":"user","messageId":1,"quote":"Auditní kód je ${FIRST_CODE}."}\n{"source":"user","messageId":12,"quote":"Nový auditní kód je ${SECOND_CODE}."}`;
  const bBefore = row('b-before', `project B ${projectB.file} ${projectB.canary} ${projectB.rule}`,
    JSON.stringify({ reply: projectB.canary, plan: null }));
  rows.push(bBefore);
  for (let turn = 1; turn <= 5; turn += 1) {
    const valueCase = secondWindowCase(1, turn);
    const question = secondWindowMessage(1, turn);
    const answer = JSON.stringify(valueCase.expected);
    const call = row(`one-${turn}`, `User: ${question}`, answer);
    rows.push(call);
    turns.push({ stage: 1, turn, question, expected: valueCase.expected,
      answer, qualityStatus: 'PASS', ...receipt(call) });
  }
  const firstSummary = row('first-summary', `${firstRaw}\nSouhrn:`, firstProse);
  rows.push(firstSummary);
  const bAfter = row('b-after', `project B ${projectB.file} ${projectB.canary} ${projectB.rule}`,
    JSON.stringify({ reply: projectB.canary, plan: null }));
  rows.push(bAfter);
  for (let turn = 1; turn <= 5; turn += 1) {
    const valueCase = secondWindowCase(2, turn);
    const question = secondWindowMessage(2, turn);
    const answer = JSON.stringify(valueCase.expected);
    const call = row(`two-${turn}`, `User: ${question}`, answer);
    rows.push(call);
    turns.push({ stage: 2, turn, question, expected: valueCase.expected,
      answer, qualityStatus: 'PASS', ...receipt(call) });
  }
  const secondSource = `[Předchozí souhrn]\n${firstProse}\n\n[Nové zprávy od posledního souhrnu]\n${secondRaw}\nSouhrn:`;
  const secondSummary = row('second-summary', secondSource, secondProse);
  rows.push(secondSummary);
  const bAfterSecond = row('b-after-second', `project B ${projectB.file} ${projectB.canary} ${projectB.rule}`,
    JSON.stringify({ reply: projectB.canary, plan: null }));
  rows.push(bAfterSecond);
  const finalAnswer = `${FIRST_CODE}, ${SECOND_CODE}; původně ruční revize bez změny souborů.`;
  const final = row('final', `[Souhrn předchozí konverzace]\n${secondText}\nUser: ${FINAL_QUESTION}`,
    finalAnswer);
  rows.push(final);
  const captureBytes = Buffer.from(`${rows.map(value => JSON.stringify(value)).join('\n')}\n`);
  const firstMessages = Array.from({ length: 5 }, (_, index) => [
    { id: index * 2 + 1, role: 'user',
      content: secondWindowMessage(1, index + 1), tokens: 430 },
    { id: index * 2 + 2, role: 'assistant',
      content: JSON.stringify(secondWindowCase(1, index + 1).expected), tokens: 430 },
  ]).flat();
  const postRestartMessages = Array.from({ length: 5 }, (_, index) => [
    { id: index * 2 + 12, role: 'user',
      content: secondWindowMessage(2, index + 1), tokens: 440 },
    { id: index * 2 + 13, role: 'assistant',
      content: JSON.stringify(secondWindowCase(2, index + 1).expected), tokens: 440 },
  ]).flat();
  const evidence = { schemaVersion: 1, status: 'PASS', mechanismStatus: 'PASS',
    semanticQuality: secondWindowSemanticQuality(turns, finalAnswer, [firstText, secondText]),
    sourceRevision, physicalProvider: true, model: CAPTURE_MODEL,
    installedDigest: CAPTURE_DIGEST, captureBytes: captureBytes.length,
    captureSha256: sha256(captureBytes), turns,
    projects: { a: projectA, b: projectB },
    projectB: { before: receipt(bBefore), afterRestart: receipt(bAfter),
      afterSecond: receipt(bAfterSecond) },
    first: { firstUserId: 1, upToMsgId: 8, rawTokens: 4300,
      messages: firstMessages, text: firstText, ...receipt(firstSummary) },
    restart: { beforePid: 111, afterPid: 222, firstSummary: firstText,
      firstUpToMsgId: 8, rawFirstUserRetained: true, messages: firstMessages },
    second: { secondUserId: 12, upToMsgId: 20, postRestartRawTokens: 4400,
      messages: [...firstMessages, ...postRestartMessages],
      text: secondText, ...receipt(secondSummary) },
    final: { question: FINAL_QUESTION, answer: finalAnswer, ...receipt(final) } };
  return { captureBytes, evidence, sourceRevision };
}

test('second-window source fixture has two disjoint user anchors and fixed arithmetic', () => {
  const first = secondWindowMessage(1, 1);
  const second = secondWindowMessage(2, 1);
  assert(first.includes(FIRST_CODE) && !first.includes(SECOND_CODE));
  assert(second.includes(SECOND_CODE) && !second.includes(FIRST_CODE));
  for (const stage of [1, 2]) {
    for (let turn = 1; turn <= 12; turn += 1) {
      const input = secondWindowMessage(stage, turn);
      const expected = secondWindowCase(stage, turn).expected;
      assert.equal(Number(input.match(new RegExp(`Záznam ${stage}\\.${turn}\\.1:.*?kalibrace (\\d+)`))?.[1]), expected.a);
      assert.equal(Number(input.match(new RegExp(`Záznam ${stage}\\.${turn}\\.24:.*?kalibrace (\\d+)`))?.[1]), expected.b);
      if (turn > 1) assert(!input.includes(FIRST_CODE) && !input.includes(SECOND_CODE));
    }
  }
});

test('captured physical receipt requires the exact recursive source, project isolation and recall', () => {
  const baseline = fixture();
  const validated = validateSecondWindowEvidence(baseline);
  assert.equal(validated.mechanismStatus, 'PASS');
  assert.equal(validated.semanticQuality, 'PASS');
  assert.equal(validated.providerRows, 16);
  assert.equal(secondWindowSemanticQuality(baseline.evidence.turns,
    baseline.evidence.final.answer,
    [baseline.evidence.first.text.replace(FIRST_FACT, ''), baseline.evidence.second.text]
  ).policyInBothSummaries, false,
  'an identifier quote must not cover loss of the original prose decision');
  const changed = mutator => {
    const copy = structuredClone(baseline);
    copy.captureBytes = Buffer.from(copy.captureBytes);
    mutator(copy);
    return copy;
  };
  assert.throws(() => validateSecondWindowEvidence(changed(x => {
    x.evidence.second.upToMsgId = x.evidence.first.upToMsgId;
  })), /boundary did not advance/);
  assert.throws(() => validateSecondWindowEvidence(changed(x => {
    x.evidence.restart.firstSummary = 'lost over restart';
  })), /summary changed over restart/);
  assert.throws(() => validateSecondWindowEvidence(changed(x => {
    x.evidence.second.postRestartRawTokens = 4095;
  })), /post-restart raw history|second raw token count differs/);
  assert.throws(() => validateSecondWindowEvidence(changed(x => {
    x.evidence.second.text = x.evidence.second.text.replace(FIRST_CODE, 'lost');
  })), /lost an anchor|second persisted summary differs/);
  assert.throws(() => validateSecondWindowEvidence(changed(x => {
    x.evidence.final.answer = FIRST_CODE;
  })), /semantic quality receipt|final HTTP answer/);
  const changedRows = mutator => {
    const copy = fixture();
    const rows = copy.captureBytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
    mutator(rows);
    copy.captureBytes = Buffer.from(`${rows.map(value => JSON.stringify(value)).join('\n')}\n`);
    copy.evidence.captureBytes = copy.captureBytes.length;
    copy.evidence.captureSha256 = sha256(copy.captureBytes);
    return copy;
  };
  assert.throws(() => validateSecondWindowEvidence(changedRows(rows => {
    rows.find(x => x.requestSha256 === baseline.evidence.second.requestSha256)
      .messages.at(-1).content = `[Předchozí souhrn]\n${FIRST_CODE}\n\n[Nové zprávy od posledního souhrnu]\n${secondWindowMessage(2, 1)}\nSouhrn:`;
  })), /exact previous summary prose/);
  assert.throws(() => validateSecondWindowEvidence(changedRows(rows => {
    const summary = rows.find(x => x.requestSha256 === baseline.evidence.first.requestSha256);
    summary.messages.at(-1).content = summary.messages.at(-1).content
      .replace('\nSouhrn:', ` ${projectB.canary}\nSouhrn:`);
  })), /leaked foreign project marker/);
  assert.throws(() => validateSecondWindowEvidence(changedRows(rows => {
    rows.find(x => x.requestSha256 === baseline.evidence.projectB.afterSecond.requestSha256)
      .messages.at(-1).content += FIRST_CODE;
  })), /leaked foreign project marker/);
  const projectJson = changedRows(rows => {
    const final = rows.find(x => x.requestSha256 === baseline.evidence.final.requestSha256);
    final.messages.at(-1).content = JSON.stringify({
      request: FINAL_QUESTION,
      history: [{ role: 'summary', content: baseline.evidence.second.text }],
      analysis: { excerpts: [{ text: projectA.canary }] },
    });
  });
  assert(providerPromptText(JSON.parse(projectJson.captureBytes.toString('utf8').trim()
    .split('\n').at(-1))).includes(baseline.evidence.second.text));
  assert.equal(validateSecondWindowEvidence(projectJson).mechanismStatus, 'PASS');
  assert.throws(() => validateSecondWindowEvidence(changedRows(rows => {
    const final = rows.find(x => x.requestSha256 === baseline.evidence.final.requestSha256);
    final.messages.at(-1).content = JSON.stringify({
      request: FINAL_QUESTION,
      history: [{ role: 'summary', content: baseline.evidence.second.text },
        { role: 'user', content: secondWindowMessage(1, 1) }],
    });
  })), /replayed original raw user message/);
});
