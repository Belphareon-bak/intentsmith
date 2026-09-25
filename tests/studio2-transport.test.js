import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SessionStore } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/session-store.js');
const values = new Map();
const store = new SessionStore({ getItem: key => values.get(key) || null, setItem: (key,value) => values.set(key,value) });
const first = store.state.sessions[0];
const second = store.addSession();
const handlers = new Map();
const bus = {
  on(name, fn) { if (!handlers.has(name)) handlers.set(name,new Set()); handlers.get(name).add(fn); },
  off(name, fn) { handlers.get(name)?.delete(fn); },
  emit(name, event) { for (const fn of handlers.get(name) || []) fn(event); },
};
let sends = 0;
let destroys = 0;
const terminalFrames = [];
const fakeWS = { connect() {}, destroy() { destroys++; }, isReady: () => true, hasActiveM1Turn: () => false,
  sendChat() { sends++; return true; }, sendCancel: () => true,
  sendTerminal(command, session, index) { terminalFrames.push({ command, session, index }); return true; } };
const window = { IntentSmithWS: fakeWS };
const terminalModule = { exports: {} };
const terminalSource = readFileSync(new URL('../intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/terminal-client.js', import.meta.url),'utf8');
const context = vm.createContext({ window, Date, console, requestAnimationFrame() {}, IntentSmithBus: bus, IntentSmithWS: fakeWS });
Object.defineProperty(context, '_sessions', { get: () => window._sessions });
vm.runInContext(`(function(module,exports){${terminalSource}\n})`, context)(terminalModule, terminalModule.exports);
const source = readFileSync(new URL('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/transport-adapter.js', import.meta.url),'utf8');
const module = { exports: {} };
const mockRequire = name => {
  if (name.endsWith('/event-bus')) return { IntentSmithBus: bus };
  if (name.endsWith('/work-activity')) return { createActivity: id => ({id}), applyEvent() {}, finishActivity() {} };
  if (name.endsWith('/ws-client')) return {};
  if (name.endsWith('/terminal-client')) return terminalModule.exports;
  throw new Error(name);
};
vm.runInContext(`(function(require,module,exports){${source}\n})`, context)(mockRequire,module,module.exports);
const roots = new Map();
const workspace = { entry: session => ({ root: roots.get(session.id) || null }), async loadTree() { return false; } };
const adapter = new module.exports.TransportAdapter(store, workspace);
assert.equal(window._sessions.length, store.state.sessions.length);
first.chat._thinking = { text: 'Pracuji' };
bus.emit('ws:disconnected');
assert.equal(first.chat._delivery.status, 'DELIVERY_UNKNOWN');
assert.equal(second.chat._delivery, null);
assert.equal(adapter.send(first, 'Nevyžádané opakování'), false);
assert.equal(sends, 0);
assert.equal(adapter.acknowledgeUnknown(first), true);
assert.equal(adapter.send(first, 'Nový požadavek'), true);
assert.equal(sends, 1);
bus.emit('chat:terminal', { sessionIdx: 0, action: 'send', status: 'error', turnId: 't1',
  result: { error: { code: 'M1_CONNECTION_INTERRUPTED', message: 'Spojení přerušeno' } } });
assert.equal(first.chat._delivery.status, 'DELIVERY_UNKNOWN');
assert.equal(adapter.send(first, 'Další automatický pokus'), false);
assert.equal(sends, 1);
assert.equal(second.chat.msgs.length, 0);
roots.set(second.id, '/project/second');
second._projectId = 'project-second';
assert.equal(await adapter.sendTerminal(second, 'pwd'), true);
assert.deepEqual(terminalFrames.map(frame => frame.index), [1]);
assert.equal(terminalFrames[0].session, second);
assert.equal(window._intentsmith.getSessionRoot(1), '/project/second');
assert.equal(adapter.isTerminalExecuting(second), true);
store.closeSession(first.id);
assert.equal(window._sessions[0], first);
assert.equal(window._sessions[1], second);
assert.equal(window._sessionActive, 1);
bus.emit('terminal:output', { sessionIdx: 1, data: { type: 'exec_result', stdout: '/project/second', exitCode: 0 } });
assert.equal(adapter.isTerminalExecuting(second), false);
assert.match(second.term.map(entry => entry.text).join('\n'), /\/project\/second/);
assert.equal(first.term.length, 0);
assert.equal(await adapter.sendTerminal(second, 'echo still-running'), true);
assert.equal(adapter.isTerminalExecuting(second), true);
bus.emit('ws:disconnected');
assert.equal(adapter.isTerminalExecuting(second), false);
assert.match(second.term.at(-1).text, /NEZNÁMÝ VÝSLEDEK/);
assert.equal(second.term.some(entry => entry.text === '^C'), false);
assert.equal(terminalFrames.length, 2);
const third = store.addSession({ projectId: 'third' });
assert.equal(window._sessions[2], third);
assert.equal(await adapter.sendTerminal(third, 'pwd'), false);
assert.equal(terminalFrames.length, 2);
adapter.destroy();
assert.equal(destroys, 1);
assert.equal(handlers.get('chat:terminal').size, 0);
console.log('PASS uncertain M1 delivery, stable terminal routing after tab close, and project-root guard');
