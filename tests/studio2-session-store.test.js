import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SessionStore, V1_KEY, V2_KEY, sessionCloseBlock } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/session-store.js');

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
    { convId: 'conv-b', label: 'B', projectId: 2, m2Pending: { lifecycleId: 'l-1', planDigest: 'sha256:' + 'a'.repeat(64), origin: { surface: 'studio', sessionId: 'conv-b', conversationId: 'conv-b', projectId: 2 } } },
    { convId: 'conv-c', label: 'C' },
  ] });
  const mem = storage({ [V1_KEY]: legacy });
  const store = new SessionStore(mem);
  assert.equal(mem.getItem(V1_KEY), legacy);
  assert.equal(JSON.parse(mem.getItem(V2_KEY)).version, 2);
  assert.equal(store.state.sessions.length, 3);
  assert.equal(store.focusedSession()._convId, 'conv-c');
  assert.equal(store.state.sessions[1]._m2Pending.planDigest, 'sha256:' + 'a'.repeat(64));
  assert.equal(store.state.sessions[1]._m2Pending.origin.conversationId, 'conv-b');
});

test('five sessions in three columns swap an already visible session', () => {
  const mem = storage();
  const store = new SessionStore(mem);
  for (let i = 1; i < 5; i++) store.addSession({ label: `Session ${i + 1}`, convId: `conv-${i}` });
  assert.equal(store.state.sessions.length, 5);
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
  assert.equal(reboot.state.sessions.length, 5);
});

test('legacy editor and specialist workspace keep their original session owners and keys', () => {
  const sessions = JSON.stringify({ sessionActive: 2, sessions: [
    { convId: 'closed', closed: true }, { convId: 'project', projectId: 9 },
    { convId: 'specialist', specialistData: { id: 'accountant-cz' } }] });
  const editors = JSON.stringify({ version: 2, sessions: [
    { openFiles: [{ path: '/closed/private' }] },
    { openFiles: [{ path: '/project/notes.txt' }], activePath: '/project/notes.txt' }, { openFiles: [] }] });
  const workspaces = JSON.stringify({ 'accountant-cz': { files: ['ledger.txt'], conversations: [{ id: 'specialist' }] } });
  const memory = storage({ [V1_KEY]: sessions, 'intentsmith-editor-state': editors,
    'intentsmith-specialist-workspaces': workspaces });
  const store = new SessionStore(memory);
  assert.deepEqual(store.state.sessions[0]._legacyEditor, { paths: ['/project/notes.txt'], activePath: '/project/notes.txt' });
  assert.deepEqual(store.state.sessions[1]._focusFiles, ['ledger.txt']);
  assert.equal(store.focusedSession()._convId, 'specialist');
  assert.deepEqual(store.specialistFiles('accountant-cz'), ['ledger.txt']);
  assert.deepEqual(store.specialistFiles('unknown'), []);
  assert.equal(memory.getItem('intentsmith-editor-state'), editors);
  assert.equal(memory.getItem('intentsmith-specialist-workspaces'), workspaces);
  assert.equal(memory.getItem(V1_KEY), sessions);
  assert.deepEqual(new SessionStore(memory).state.sessions[0]._legacyEditor, store.state.sessions[0]._legacyEditor);
});

test('sixth session evicts only the oldest safe session hidden before opening', () => {
  const mem = storage();
  const store = new SessionStore(mem);
  const first = store.focusedSession();
  const second = store.addSession();
  const third = store.addSession();
  const fourth = store.addSession();
  const fifth = store.addSession();
  const hidden = store.state.sessions.filter(session => !store.state.columns.includes(session.id));
  assert.equal(hidden.length, 2);
  const oldestHidden = [...store.recent()].reverse().find(id => hidden.some(session => session.id === id));
  const otherHidden = hidden.find(session => session.id !== oldestHidden);
  const sixth = store.addSession({ label: 'Sixth' }, { canClose: session => session.id !== oldestHidden });
  assert.ok(sixth);
  assert.ok(store.find(oldestHidden));
  assert.equal(store.find(otherHidden.id), null);
  assert.equal(store.state.sessions.length, 5);
  assert.equal(store.state.columns.includes(sixth.id), true);
  assert.equal(new SessionStore(mem).state.sessions.length, 5);
});

test('all protected hidden sessions block opening without changing any session', () => {
  const store = new SessionStore(storage());
  for (let i = 0; i < 4; i++) store.addSession();
  const before = store.state.sessions.map(session => session.id);
  const columns = [...store.state.columns];
  assert.equal(store.addSession({}, { canClose: () => false }), null);
  assert.deepEqual(store.state.sessions.map(session => session.id), before);
  assert.deepEqual(store.state.columns, columns);
});

test('session close policy preserves active turns, approval, editor, drafts, attachments and terminal work', () => {
  const store = new SessionStore(storage());
  const session = store.focusedSession();
  assert.equal(sessionCloseBlock(session), null);
  for (const flags of [{ activeTurn: true }, { m2Busy: true }, { editorDirty: true },
    { terminalExecuting: true }, { state: { drafts: { [session.id]: 'Rozepsaná zpráva' } } },
    { state: { cmds: { [session.id]: 'npm test' } } }]) assert.ok(sessionCloseBlock(session, flags));
  session._m2Pending = { lifecycleId: 'pending' };
  assert.ok(sessionCloseBlock(session));
  session._m2Pending = null;
  session.chat.attachments.push({ name: 'notes.txt' });
  assert.ok(sessionCloseBlock(session));
  session.chat.attachments = [];
  session.chat._thinking = { text: 'pracuje' };
  assert.ok(sessionCloseBlock(session));
  session.chat._thinking = null;
  session.chat._delivery = { status: 'DELIVERY_UNKNOWN' };
  assert.ok(sessionCloseBlock(session));
  session.chat._delivery = null;
  assert.equal(sessionCloseBlock(session), null);
});

test('closing the last session keeps an empty workspace across restart', () => {
  const mem = storage();
  const store = new SessionStore(mem);
  store.closeSession(store.focusedSession().id);
  assert.equal(store.state.sessions.length, 0);
  assert.deepEqual(store.state.columns, []);
  assert.equal(new SessionStore(mem).state.sessions.length, 0);
  assert.ok(store.addSession());
  assert.equal(store.state.columns.length, 1);
});

test('unlimited legacy snapshot migrates to five without dropping visible or unresolved sessions', () => {
  const sessions = Array.from({ length: 6 }, (_, i) => ({ id: 's' + i, number: i + 1, convId: 'c' + i }));
  const seed = { version: 2, sessions, columns: ['s0', 's1', 's2'], used: ['s0', 's1', 's2', 's3', 's4', 's5'] };
  const store = new SessionStore(storage({ [V2_KEY]: JSON.stringify(seed) }));
  assert.equal(store.state.sessions.length, 5);
  assert.equal(store.find('s5'), null);
  assert.deepEqual(store.state.columns, ['s0', 's1', 's2']);
  seed.sessions = sessions.map(session => ({ ...session, delivery: { status: 'DELIVERY_UNKNOWN' } }));
  const protectedStore = new SessionStore(storage({ [V2_KEY]: JSON.stringify(seed) }));
  assert.equal(protectedStore.state.sessions.length, 6, 'uncertain work must not disappear during migration');
  assert.equal(protectedStore.canAddSession(), false);
  assert.equal(protectedStore.addSession(), null);
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
