// Shared oracle for the deterministic and opt-in physical-model M1 journeys.
// The expected values come from the fixture, never from a model response.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';

import { expectJson } from './chat-project-expertise-model-journey.js';

const pairs = [
  ['positive', 73, 62],
  ['negative', 17, 46],
  ['zero', 88, 88],
];

export const VALUE_CASES = Object.freeze(pairs.map(([label, first, second]) => Object.freeze({
  label,
  input: `Kontrolní případ ${label}: kalibrace A=${first}, kalibrace B=${second}. `
    + 'Urči podepsaný rozdíl A−B. Odpověz pouze jediným JSON objektem '
    + 's přesně těmito klíči: "a", "b", "delta", "higher"; '
    + 'číselné hodnoty musí být čísla, "higher" musí být "A", "B" nebo "equal".',
  expected: Object.freeze({ a: first, b: second, delta: first - second,
    higher: first > second ? 'A' : first < second ? 'B' : 'equal' }),
})));

export function makeValueCommand(conversationId, valueCase) {
  const nonce = randomBytes(6).toString('hex');
  return { contract: 'ConversationCommand', version: 1,
    requestId: `value-fidelity-${valueCase.label}-${nonce}`,
    conversationId, turnId: `value-fidelity-turn-${valueCase.label}-${nonce}`,
    action: 'send', input: valueCase.input };
}

export function assertExactValueAnswer(content, valueCase) {
  assert.equal(typeof content, 'string', `${valueCase.label}: answer must be text`);
  const trimmed = content.trim();
  assert(trimmed.startsWith('{') && trimmed.endsWith('}'),
    `${valueCase.label}: answer must be one JSON object without prose or markdown`);
  const parsed = JSON.parse(trimmed);
  assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed),
    `${valueCase.label}: answer must be one JSON object`);
  // JSON.parse keeps only the last occurrence of a duplicate member name.
  // Once the decoded values below are restricted to integers and A/B/equal,
  // every quoted token followed by a colon in the raw object is a member key.
  const rawMembers = [...trimmed.matchAll(/"(?:\\.|[^"\\])*"\s*:/gu)];
  assert.equal(rawMembers.length, 4,
    `${valueCase.label}: raw JSON must contain exactly four members, without duplicates`);
  assert.deepEqual(Object.keys(parsed).sort(), ['a', 'b', 'delta', 'higher'],
    `${valueCase.label}: answer keys changed`);
  for (const key of ['a', 'b', 'delta']) {
    assert(Number.isSafeInteger(parsed[key]), `${valueCase.label}: ${key} must be an integer`);
  }
  assert.deepEqual(parsed, valueCase.expected, `${valueCase.label}: wrong values or signed direction`);
  return parsed;
}

export function isAnswerRequest(request, valueCase) {
  if (!Array.isArray(request?.messages)) return false;
  const lastMessage = request.messages.at(-1);
  return lastMessage?.role === 'user'
    && typeof lastMessage.content === 'string'
    && (lastMessage.content === valueCase.input
      || lastMessage.content.endsWith(`User: ${valueCase.input}`));
}

export function assertFinalValueRequest(request, valueCase, expectedModel) {
  assert.equal(request.model, expectedModel, `${valueCase.label}: wrong model`);
  assert.equal(request.stream, false, `${valueCase.label}: streaming request`);
  assert(Number.isSafeInteger(request.options?.num_ctx)
    && request.options.num_ctx >= 512 && request.options.num_ctx <= 4096,
  `${valueCase.label}: missing or oversized context window`);
  assert(Number.isSafeInteger(request.options?.num_predict)
    && request.options.num_predict > 0
    && request.options.num_predict <= request.options.num_ctx,
  `${valueCase.label}: missing or oversized answer allowance`);
  assert(isAnswerRequest(request, valueCase),
    `${valueCase.label}: exact user data absent from final ANSWER provider prompt`);
  return request.messages.map(message => String(message.content || '')).join('\n');
}

export async function createValueConversation(product) {
  const created = await expectJson(product, 'POST', '/api/conversations', {
    title: `value-fidelity-${randomBytes(4).toString('hex')}`, mode: 'chat',
  }, 201);
  const id = created.conversation?.id;
  assert.equal(typeof id, 'string', 'M1 conversation ID missing');
  return id;
}

export async function assertDurableValueHistory(product, databasePath, conversationId, answers) {
  const http = await expectJson(product, 'GET',
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`, null, 200);
  assert(Array.isArray(http.messages), 'M1 HTTP history missing');
  assert.equal(http.messages.length, VALUE_CASES.length * 2,
    'M1 HTTP history lost a user or assistant turn');
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  let sqlite;
  try {
    sqlite = db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id ASC')
      .all(conversationId);
  } finally { db.close(); }
  assert.equal(sqlite.length, VALUE_CASES.length * 2,
    'SQLite lost a user or assistant turn');
  for (const [index, valueCase] of VALUE_CASES.entries()) {
    const expected = [
      { role: 'user', content: valueCase.input },
      { role: 'assistant', content: answers[index] },
    ];
    assert.deepEqual(sqlite.slice(index * 2, index * 2 + 2), expected,
      `${valueCase.label}: SQLite history differs from M1 turns`);
    assert.deepEqual(http.messages.slice(index * 2, index * 2 + 2)
      .map(({ role, content }) => ({ role, content })), expected,
    `${valueCase.label}: HTTP history differs from SQLite`);
  }
  return { httpMessages: http.messages.length, sqliteMessages: sqlite.length };
}
