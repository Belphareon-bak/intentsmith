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
const fakeWS = { connect() {}, destroy() { destroys++; }, isReady: () => true, hasActiveM1Turn: () => false,
  sendChat() { sends++; return true; }, sendCancel: () => true };
const window = { IntentSmithWS: fakeWS };
const source = readFileSync(new URL('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/transport-adapter.js', import.meta.url),'utf8');
const module = { exports: {} };
const mockRequire = name => {
  if (name.endsWith('/event-bus')) return { IntentSmithBus: bus };
  if (name.endsWith('/work-activity')) return { createActivity: id => ({id}), applyEvent() {}, finishActivity() {} };
  if (name.endsWith('/ws-client')) return {};
  throw new Error(name);
};
vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { window, Date, console })(mockRequire,module,module.exports);
const adapter = new module.exports.TransportAdapter(store);
assert.equal(window._sessions, store.state.sessions);
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
adapter.destroy();
assert.equal(destroys, 1);
assert.equal(handlers.get('chat:terminal').size, 0);
console.log('PASS uncertain delivery blocks silent retry and stays with the owning session');
