#!/usr/bin/env node

// Handler adjacency must follow durable insertion order even when SQLite's
// second-precision timestamps tie across more than one context window.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import { suite, testAsync, summary } from './harness.js';

suite('Durable chat history order');

await testAsync('latest ten turns follow message IDs with twelve identical timestamps', async () => {
  assert(isolatedTestRuntime.database.includes('/.intentsmith-artifacts/'));
  const { db, conversations, messages } = await import('../src/db/database.js');
  const conversationId = `history-order-${randomBytes(8).toString('hex')}`;
  conversations.create.run(conversationId, null, 'owned history order', null);
  for (let index = 1; index <= 12; index += 1) {
    messages.add.run(conversationId, index % 2 ? 'user' : 'assistant',
      `turn-${index}`, 2, '{}');
  }
  db.prepare('UPDATE messages SET created_at = ? WHERE conversation_id = ?')
    .run('2099-01-01 00:00:00', conversationId);
  assert.deepEqual(messages.getLastN.all(conversationId, 10).map(row => row.content),
    Array.from({ length: 10 }, (_, index) => `turn-${index + 3}`));
  assert.deepEqual(messages.listRecentByConversation.all(conversationId, 5)
    .map(row => row.content),
  ['turn-12', 'turn-11', 'turn-10', 'turn-9', 'turn-8']);
}, 30_000);

summary();
