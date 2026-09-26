import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FeedbackWorkspace } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/feedback-workspace');
const ok = body => ({ ok: true, status: 200, json: async () => body });

test('feedback sends an exact message, last answer and bounded attachment once', async () => {
  const calls = [];
  const workspace = new FeedbackWorkspace({ backendUrl: () => 'http://127.0.0.1:3335',
    version: () => '136.1.0', lastResponse: () => 'Last assistant answer',
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      calls.push([path, JSON.parse(options.body)]);
      if (path === '/api/feedback') return ok({ ok: true, id: 91 });
      if (path === '/api/feedback/91/attach') return ok({ ok: true, filename: 'screen.png' });
      throw Error('Unexpected ' + path);
    } });
  workspace.setCategory('ux'); workspace.setMessage('  Toto se špatně čte.  ');
  workspace.attachLast = true;
  assert.equal(await workspace.addFiles([{ name: 'screen.png', size: 3, type: 'image/png',
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }]), true);
  assert.equal(await workspace.send(), true);
  assert.deepEqual(calls.map(([path]) => path), ['/api/feedback', '/api/feedback/91/attach']);
  assert.deepEqual(calls[0][1], { category: 'ux', message: 'Toto se špatně čte.',
    version: '136.1.0', lastResponse: 'Last assistant answer' });
  assert.equal(calls[1][1].data, 'AQID');
  assert.equal(await workspace.send(), false);
  assert.equal(workspace.vm().files.length, 0);
});

test('feedback rejects oversized files and never repeats an uncertain submit', async () => {
  const calls = [];
  const workspace = new FeedbackWorkspace({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async (url, options) => { calls.push([url, options]); throw Error('Connection lost'); } });
  assert.equal(await workspace.addFiles([{ name: 'large.log', size: 2 * 1024 * 1024 + 1 }]), false);
  assert.equal(workspace.files.length, 0);
  workspace.setMessage('Chyba při odeslání');
  assert.equal(await workspace.send(), false);
  assert.equal(workspace.uncertain, true);
  assert.equal(await workspace.send(), false);
  assert.equal(calls.length, 1);
});
