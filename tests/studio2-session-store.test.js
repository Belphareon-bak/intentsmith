import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SessionStore, V1_KEY, V2_KEY } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/session-store.js');

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}
function test(name, fn) {
  fn();
  process.stdout.write(`PASS ${name}\n`);
}

test('migrates legacy sessions without writing over the classic snapshot', () => {
  const legacy = JSON.stringify({ sessionCount: 3, sessionActive: 2, sessions: [
    { convId: 'conv-a', label: 'A', recentMsgs: [{ role: 'user', text: 'A' }] },
    { convId: 'conv-b', label: 'B', m2Pending: { lifecycleId: 'l-1', planDigest: 'sha256:x' } },
    { convId: 'conv-c', label: 'C' },
  ] });
  const mem = storage({ [V1_KEY]: legacy });
  const store = new SessionStore(mem);
  assert.equal(mem.getItem(V1_KEY), legacy);
  assert.equal(JSON.parse(mem.getItem(V2_KEY)).version, 2);
  assert.equal(store.state.sessions.length, 3);
  assert.equal(store.focusedSession()._convId, 'conv-c');
  assert.deepEqual(store.state.sessions[1]._m2Pending, { lifecycleId: 'l-1', planDigest: 'sha256:x' });
});

test('six tabs in three columns swap an already visible session', () => {
  const mem = storage();
  const store = new SessionStore(mem);
  for (let i = 1; i < 6; i++) store.addSession({ label: `Session ${i + 1}`, convId: `conv-${i}` });
  assert.equal(store.state.sessions.length, 6);
  assert.equal(store.setColumnCount(3), true);
  const before = [...store.state.columns];
  assert.equal(store.selectInColumn(0, before[1]), true);
  assert.deepEqual(store.state.columns, [before[1], before[0], before[2]]);
  assert.equal(store.state.focusedColumn, 0);
  assert.equal(store.focusTab(before[2]), true);
  assert.equal(store.state.focusedColumn, 2);
  assert.equal(store.setColumnCount(4), false);
  const reboot = new SessionStore(mem);
  assert.deepEqual(reboot.state.columns, store.state.columns);
  assert.equal(reboot.state.sessions.length, 6);
});

test('closing a column leaves its live session and conversation identity intact', () => {
  const store = new SessionStore(storage());
  const first = store.state.sessions[0];
  first._convId = 'live-turn';
  const second = store.addSession({ convId: 'second-turn' });
  store.setColumnCount(2);
  assert.equal(store.closeColumn(1), true);
  assert.equal(store.state.sessions.length, 2);
  assert.equal(store.find(first.id)._convId, 'live-turn');
  assert.equal(store.find(second.id)._convId, 'second-turn');
  assert.equal(store.closeColumn(0), false);
});

test('invalid stored columns and duplicate IDs cannot restore ghost sessions', () => {
  const mem = storage({ [V2_KEY]: JSON.stringify({ version: 2, sessions: [
    { id: 'real', number: 1, convId: 'a' }, { id: 'real', number: 2, convId: 'b' },
  ], columns: ['ghost', 'real', 'real'], focusedColumn: 8, nextNumber: 0 }) });
  const store = new SessionStore(mem);
  assert.equal(store.state.sessions.length, 1);
  assert.deepEqual(store.state.columns, ['real']);
  assert.equal(store.state.focusedColumn, 0);
  assert.equal(store.state.nextNumber, 2);
});

test('opened and verified modified files survive a renderer restart per session', () => {
  const mem = storage();
  const store = new SessionStore(mem);
  store.state.sessions[0]._openedFiles = ['src/main.js'];
  store.state.sessions[0]._modifiedFiles = ['src/main.js'];
  store.state.sessions[0]._fileChanges = { 'src/main.js': { added: 2, removed: 1 } };
  const other = store.addSession();
  store.changed();
  const reboot = new SessionStore(mem);
  assert.deepEqual(reboot.state.sessions[0]._openedFiles, ['src/main.js']);
  assert.deepEqual(reboot.state.sessions[0]._modifiedFiles, ['src/main.js']);
  assert.deepEqual(reboot.state.sessions[0]._fileChanges['src/main.js'], { added: 2, removed: 1 });
  assert.deepEqual(reboot.find(other.id)._openedFiles, []);
});

test('uncertain delivery survives restart and never becomes success', () => {
  const mem = storage();
  const store = new SessionStore(mem);
  store.state.sessions[0].chat._delivery = { status: 'DELIVERY_UNKNOWN', text: 'uncertain' };
  store.changed();
  const reboot = new SessionStore(mem);
  assert.equal(reboot.state.sessions[0].chat._delivery.status, 'DELIVERY_UNKNOWN');
  assert.match(reboot.state.sessions[0].chat._delivery.text, /neopakuje automaticky/);
});
