import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { selectFiles, prepare } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/attachments.js');

const session = { chat: { attachments: [] }, _lastAttachDir: '' };
let reads = 0;
const bridge = {
  async pickAttachmentFiles() { return { directory: '/opaque/dialog/dir', files: [
    { token: 'grant-text', name: 'report.txt', size: 5, type: 'text/plain' },
    { token: 'grant-img', name: 'chart.png', size: 3, type: 'image/png' },
    { token: 'grant-unsupported', name: 'app.exe', size: 2, type: 'application/octet-stream' },
    { token: 'grant-too-large', name: 'huge.pdf', size: 10 * 1024 * 1024 + 1, type: 'application/pdf' },
    { token: 'grant-refused', name: 'bad.md', size: 2, type: 'text/plain' },
  ] }; },
  readAttachmentBytes(token) {
    reads++;
    if (token === 'grant-refused') return { ok: false, code: 'M1_BRIDGE_READ_FAILED' };
    const bytes = token === 'grant-text' ? new TextEncoder().encode('hello') : Uint8Array.of(1, 2, 3);
    return { ok: true, bytes, size: bytes.length };
  },
};
const selected = await selectFiles(session, bridge, () => true);
assert.equal(selected.added.length, 2);
assert.equal(session.chat.attachments.length, 2);
assert.equal(reads, 3, 'unsupported and oversized descriptors are not read');
assert.equal(selected.refused.length, 3);
assert.equal(session.chat.attachments.every(item => !Object.hasOwn(item, 'path')), true);
const wire = await prepare(session.chat.attachments);
assert.deepEqual(wire.map(({ name, type }) => [name, type]), [['report.txt', 'text'], ['chart.png', 'image']]);
assert.equal(wire[0].content, 'hello');
assert.equal(wire[1].content, 'data:image/png;base64,AQID');
assert.equal(wire.every(item => !Object.hasOwn(item, 'path') && typeof item.content === 'string'), true);
assert.equal(JSON.stringify(wire).includes('opaque/dialog'), false, 'dialog directory must not enter M1 DTO');
assert.equal(session._lastAttachDir, '/opaque/dialog/dir');

const stale = { chat: { attachments: [] } };
const ignored = await selectFiles(stale, bridge, () => false);
assert.equal(ignored.added.length, 0);
assert.equal(stale.chat.attachments.length, 0);
assert.equal(await prepare([{ name: 'evil.exe', file: new File(['x'], 'evil.exe') }]).then(() => false, () => true), true);
assert.equal(await prepare(Array.from({ length: 6 }, () => session.chat.attachments[0])).then(() => false, () => true), true);
console.log('PASS pathless one-use bridge selection, refusal, and inline M1 attachment preparation');
