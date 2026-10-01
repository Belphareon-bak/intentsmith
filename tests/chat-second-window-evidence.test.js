import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { CAPTURE_DIGEST, CAPTURE_MODEL } from '../scripts/provider-capture.js';
import { providerPromptText, validateSecondWindowEvidence } from '../scripts/chat-second-window-evidence.js';
import { FIRST_CODE, SECOND_CODE, FIRST_FACT, FINAL_QUESTION, EXPECTED_FINAL_ANSWER,
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
  const finalAnswer = EXPECTED_FINAL_ANSWER;
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
  const persisted = (messages, index, priorCount = 0) => {
    const pair = { user: messages[index * 2], assistant: messages[index * 2 + 1] };
    return { http: structuredClone(pair), sqlite: structuredClone(pair),
      messageCount: priorCount + (index + 1) * 2 };
  };
  for (const turn of turns) {
    turn.persistence = persisted(turn.stage === 1 ? firstMessages : postRestartMessages,
      turn.turn - 1, turn.stage === 1 ? 0 : firstMessages.length);
  }
  const bQuestion = `Jaký stav má projekt podle ${projectB.file}? Uveď přesný projektový kód.`;
  const bPairs = Array.from({ length: 3 }, (_, index) => [
    { id: 101 + index * 2, role: 'user', content: bQuestion, tokens: 24 },
    { id: 102 + index * 2, role: 'assistant', content: projectB.canary, tokens: 24 },
  ]).flat();
  const finalMessages = [...firstMessages, ...postRestartMessages,
    { id: 22, role: 'user', content: FINAL_QUESTION, tokens: 24 },
    { id: 23, role: 'assistant', content: finalAnswer, tokens: 24 }];
  const evidence = { schemaVersion: 1, status: 'PASS', mechanismStatus: 'PASS',
    semanticQuality: secondWindowSemanticQuality(turns, finalAnswer, [firstText, secondText]),
    sourceRevision, physicalProvider: true, model: CAPTURE_MODEL,
    installedDigest: CAPTURE_DIGEST, captureBytes: captureBytes.length,
    captureSha256: sha256(captureBytes), turns,
    projects: { a: projectA, b: projectB },
    projectB: { before: { ...receipt(bBefore), question: bQuestion,
      answer: projectB.canary, persistence: persisted(bPairs, 0), messages: bPairs.slice(0, 2) },
    afterRestart: { ...receipt(bAfter), question: bQuestion,
      answer: projectB.canary, persistence: persisted(bPairs, 1), messages: bPairs.slice(0, 4) },
    afterSecond: { ...receipt(bAfterSecond), question: bQuestion,
      answer: projectB.canary, persistence: persisted(bPairs, 2), messages: bPairs } },
    first: { firstUserId: 1, upToMsgId: 8, rawTokens: 4300,
      messages: firstMessages, text: firstText, ...receipt(firstSummary) },
    restart: { beforePid: 111, afterPid: 222, firstSummary: firstText,
      firstUpToMsgId: 8, rawFirstUserRetained: true, messages: firstMessages },
    second: { secondUserId: 12, upToMsgId: 20, postRestartRawTokens: 4400,
      messages: [...firstMessages, ...postRestartMessages],
      text: secondText, ...receipt(secondSummary) },
    final: { question: FINAL_QUESTION, answer: finalAnswer, ...receipt(final),
      persistence: persisted(finalMessages, 10), messages: finalMessages } };
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

  // Red-first review findings: each mutation keeps an internally consistent
  // provider row and private receipt, but must never certify as semantic PASS.
  const wrongArithmetic = changedRows(rows => {
    const answer = JSON.stringify({ a: 73, b: 62, delta: 12, higher: 'A' });
    const call = rows.find(x => x.requestSha256 === baseline.evidence.turns[0].requestSha256);
    call.terminal.message.content = answer;
    call.responseSha256 = sha256(`wrong arithmetic ${answer}`);
  });
  const arithmeticRow = wrongArithmetic.captureBytes.toString('utf8').trim().split('\n')
    .map(line => JSON.parse(line)).find(x => x.requestSha256 === baseline.evidence.turns[0].requestSha256);
  wrongArithmetic.evidence.turns[0].answer = arithmeticRow.terminal.message.content;
  wrongArithmetic.evidence.turns[0].responseSha256 = arithmeticRow.responseSha256;
  assert.throws(() => validateSecondWindowEvidence(wrongArithmetic), /arithmetic|wrong values|quality/i);

  const foreignBAnswer = changedRows(rows => {
    const call = rows.find(x => x.requestSha256 === baseline.evidence.projectB.afterSecond.requestSha256);
    const answer = `${projectB.canary} ${projectA.canary}`;
    call.terminal.message.content = JSON.stringify({ reply: answer, plan: null });
    call.responseSha256 = sha256(`foreign B answer ${answer}`);
  });
  const foreignRow = foreignBAnswer.captureBytes.toString('utf8').trim().split('\n')
    .map(line => JSON.parse(line)).find(x => x.requestSha256 === baseline.evidence.projectB.afterSecond.requestSha256);
  foreignBAnswer.evidence.projectB.afterSecond.answer = JSON.parse(foreignRow.terminal.message.content).reply;
  foreignBAnswer.evidence.projectB.afterSecond.responseSha256 = foreignRow.responseSha256;
  assert.throws(() => validateSecondWindowEvidence(foreignBAnswer), /foreign|project A|leak/i);

  const fileChange = changedRows(rows => {
    const call = rows.find(x => x.requestSha256 === baseline.evidence.final.requestSha256);
    const answer = `${FIRST_CODE} | ${SECOND_CODE} | ruční revize se změnou souborů`;
    call.terminal.message.content = answer;
    call.responseSha256 = sha256(`file change ${answer}`);
  });
  const finalRow = fileChange.captureBytes.toString('utf8').trim().split('\n')
    .map(line => JSON.parse(line)).find(x => x.requestSha256 === baseline.evidence.final.requestSha256);
  fileChange.evidence.final.answer = finalRow.terminal.message.content;
  fileChange.evidence.final.responseSha256 = finalRow.responseSha256;
  // A forged PASS receipt must be recomputed from the captured answer.
  fileChange.evidence.semanticQuality = baseline.evidence.semanticQuality;
  assert.throws(() => validateSecondWindowEvidence(fileChange), /policy|negation|semantic|file change/i);

  // Provider and POST still agree, while both GET and SQLite persist the
  // same wrong assistant content. Snapshot-to-snapshot parity must not pass.
  const persistedWrongA = changed(x => {
    for (const messages of [x.evidence.first.messages, x.evidence.restart.messages,
      x.evidence.second.messages, x.evidence.final.messages]) {
      messages.find(message => message.id === 2).content = 'PERSISTED_WRONG_VALUE';
    }
    x.evidence.turns[0].persistence.http.assistant.content = 'PERSISTED_WRONG_VALUE';
    x.evidence.turns[0].persistence.sqlite.assistant.content = 'PERSISTED_WRONG_VALUE';
  });
  assert.throws(() => validateSecondWindowEvidence(persistedWrongA), /persisted|POST|assistant|answer/i);
  const storedOnlyA = changed(x => {
    for (const messages of [x.evidence.first.messages, x.evidence.restart.messages,
      x.evidence.second.messages, x.evidence.final.messages]) {
      messages.find(message => message.id === 2).content = 'PERSISTED_WRONG_VALUE';
    }
  });
  assert.throws(() => validateSecondWindowEvidence(storedOnlyA), /persisted|SQLite/i);
  const getOnlyA = changed(x => {
    x.evidence.turns[0].persistence.http.assistant.content = 'PERSISTED_WRONG_VALUE';
  });
  assert.throws(() => validateSecondWindowEvidence(getOnlyA), /persisted|POST|assistant|answer/i);
  const persistedWrongB = changed(x => {
    for (const receipt of [x.evidence.projectB.before, x.evidence.projectB.afterRestart,
      x.evidence.projectB.afterSecond]) {
      receipt.messages.find(message => message.id === 102).content = 'PERSISTED_WRONG_VALUE';
    }
    x.evidence.projectB.before.persistence.http.assistant.content = 'PERSISTED_WRONG_VALUE';
    x.evidence.projectB.before.persistence.sqlite.assistant.content = 'PERSISTED_WRONG_VALUE';
  });
  assert.throws(() => validateSecondWindowEvidence(persistedWrongB), /persisted|POST|assistant|answer/i);
  const missingRepeatedB = changed(x => {
    x.evidence.projectB.afterRestart.messages = structuredClone(x.evidence.projectB.before.messages);
    x.evidence.projectB.afterRestart.persistence = structuredClone(x.evidence.projectB.before.persistence);
  });
  assert.throws(() => validateSecondWindowEvidence(missingRepeatedB),
    /project B.*new user\/assistant pair|project B.*ordered/i);
  const persistedWrongFinal = changed(x => {
    x.evidence.final.messages.find(message => message.id === 23).content = 'PERSISTED_WRONG_VALUE';
    x.evidence.final.persistence.http.assistant.content = 'PERSISTED_WRONG_VALUE';
    x.evidence.final.persistence.sqlite.assistant.content = 'PERSISTED_WRONG_VALUE';
  });
  assert.throws(() => validateSecondWindowEvidence(persistedWrongFinal), /persisted|POST|assistant|answer/i);
});
