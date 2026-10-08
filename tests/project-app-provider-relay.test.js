import './helpers/isolated-test-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable, Writable, PassThrough } from 'node:stream';
import { setImmediate as tick } from 'node:timers/promises';
import { createOwnedProviderRelay } from '../scripts/project-app-provider-relay.js';
import { drainOwnedGpuForTransition, finishOwnedGpuCleanup } from '../scripts/manual/run-fan-monitor-journey.mjs';

const completed = { requestClosed: true, responseClosed: true, handlerDone: true, cancelled: false };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function incoming() {
  const request = Readable.from([Buffer.from('{}')]);
  Object.assign(request, { complete: true, method: 'POST', url: '/api/chat', headers: {} });
  return request;
}
function outgoing() {
  const response = new Writable({ autoDestroy: false, write(_bytes, _encoding, done) { done(); } });
  response.writeHead = status => { response.statusCode = status; response.headersSent = true; };
  return response;
}
async function withRelay(handler, check) {
  const original = http.request, upstreams = [];
  http.request = (_options, onResponse) => {
    const request = new Writable({ autoDestroy: false, write(_bytes, _encoding, done) { done(); } });
    request.setTimeout = () => {};
    const response = new PassThrough({ autoDestroy: false });
    Object.assign(response, { statusCode: 200, headers: {} });
    upstreams.push({ request, response, onResponse }); return request;
  };
  const relay = createOwnedProviderRelay(handler);
  try {
    relay.server.emit('request', incoming(), outgoing()); await tick();
    await check(relay, upstreams[0]);
  } finally {
    http.request = original;
    for (const row of upstreams) { row.request.emit('close'); row.response.emit('close'); }
    await tick(); await relay.close();
  }
}
const options = { hostname: 'synthetic.invalid', path: '/api/chat' };
await test('legacy handler returning forward does not wait on its own handlerDone', async () => {
  let exchange;
  await withRelay((_in, _out, forward) => (exchange = forward(options, { payload: Buffer.from('{}') })), async (relay, row) => {
    assert.equal(typeof exchange.then, 'undefined'); assert.equal(typeof exchange.settled.then, 'function');
    row.onResponse(row.response); row.response.end('{}'); await tick();
    row.request.emit('close'); row.response.emit('close');
    assert.deepEqual(await exchange.settled, completed); assert.equal(relay.activeRequestCount, 0);
  });
});
await test('settlement requires response close, request close and returned handler', async () => {
  const handler = deferred(); let exchange, settled = false;
  await withRelay(async (_in, _out, forward) => {
    exchange = forward(options, { payload: Buffer.from('{}') });
    exchange.settled.then(() => { settled = true; }); await handler.promise;
  }, async (_relay, row) => {
    row.onResponse(row.response); row.response.end('{}'); await tick(); assert.equal(settled, false);
    row.request.emit('close'); await tick(); assert.equal(settled, false);
    row.response.emit('close'); await tick(); assert.equal(settled, false);
    handler.resolve(); assert.deepEqual(await exchange.settled, completed); assert.equal(settled, true);
  });
});
// Reentry oracle adapted from the independent C22 review reproduction (M1 worker).
await test('reentrant onError close shares one promise and one server close', async () => {
  let relay, closeCount = 0; const nested = [];
  await withRelay((_in, _out, forward) => forward(options, {
    payload: Buffer.from('{}'), onError: () => { nested.push(relay.close()); },
  }), async (actual) => {
    relay = actual; const original = relay.server.close.bind(relay.server);
    relay.server.close = (...args) => { closeCount++; return original(...args); };
    const first = relay.close(); assert.equal(relay.close(), first);
    await first; await Promise.all(nested); assert.ok(nested.length > 0);
    assert.equal(closeCount, 1); assert.ok(nested.every(promise => promise === first));
    assert.equal(relay.activeRequestCount, 0);
  });
});
await test('abort joins the physical exchange and marks its terminal cancelled', async () => {
  let exchange;
  await withRelay((_in, _out, forward) => (exchange = forward(options, { payload: Buffer.from('{}') })), async relay => {
    await relay.close(); assert.deepEqual(await exchange.settled, { ...completed, cancelled: true });
    assert.equal(relay.activeRequestCount, 0);
  });
});

function cleanupFixture(states) {
  let clock = 0, sample = -1, active, management = 0, releases = 0, files = 0;
  const model = 'fixture:1b', digest = 'a'.repeat(64);
  const daemon = { pid: 10, ppid: 1, uid: 997, startTicks: '1', argv: ['/owned/ollama', 'serve'] };
  const owner = { daemon, modelBlob: '/owned/blob', server: '/owned/server', discovery: ['/owned/ollama', 'gpu-discover'] };
  const worker = { pid: 20, ppid: 10, uid: 997, startTicks: '2', argv: [owner.server, '--model', owner.modelBlob] };
  const empty = { models: [], compute: [] }, resident = { models: [{ name: model, digest }], compute: [worker] };
  states = states ? states({ empty, resident, worker }) : [resident, empty, empty, empty];
  const lease = { lockPath: '/tmp/intentsmith-gpu-evaluation.lock', owner: { token: 'same-lease' }, release() { releases++; return true; } };
  const io = {
    now: () => clock, sleep: async ms => { clock += ms; }, lease: () => ({ token: 'same-lease' }),
    process: pid => pid === daemon.pid ? daemon : active.compute.find(row => row.pid === pid),
    compute: () => active.compute.map(row => `${row.pid}, controlled, 1`).join('\n'),
    api: async (route, body, control) => {
      control?.check(); management++;
      if (route === '/api/generate') { assert.deepEqual(body, { model, keep_alive: 0, stream: false }); return { done: true, done_reason: 'unload' }; }
      assert.equal(route, '/api/ps'); active = states[Math.min(++sample, states.length - 1)]; return { models: active.models };
    },
  };
  return { io, lease, args: { lease, owner, model, digest, loaded: true, signal: new AbortController().signal,
    deadlineAt: 600000, cleanupFiles: () => { files++; } }, counts: () => ({ management, releases, files, sample }) };
}
await test('transition waits before management, keeps lease and files; final cleanup alone releases', async () => {
  const fixture = cleanupFixture(), close = deferred();
  const pending = drainOwnedGpuForTransition({ ...fixture.args, exchangeSettled: close.promise }, fixture.io);
  await tick(); assert.deepEqual(fixture.counts(), { management: 0, releases: 0, files: 0, sample: -1 });
  close.resolve(completed); const transition = await pending;
  assert.equal(transition.status, 'PASS'); assert.equal(transition.emptySamples, 3);
  assert.equal(transition.leaseReleased, false); assert.equal(transition.leaseRetained, true);
  assert.equal(fixture.counts().releases, 0); assert.equal(fixture.counts().files, 0);
  const final = await finishOwnedGpuCleanup({ ...fixture.args, cleanupSettled: true }, fixture.io);
  assert.equal(final.status, 'PASS'); assert.equal(final.emptySamples, 3); assert.equal(final.leaseReleased, true);
  assert.equal(fixture.counts().releases, 1); assert.equal(fixture.counts().files, 1);
});
await test('cancelled exchange cannot authorize transition management', async () => {
  const fixture = cleanupFixture();
  await assert.rejects(drainOwnedGpuForTransition({ ...fixture.args, exchangeSettled: Promise.resolve({ ...completed, cancelled: true }) }, fixture.io));
  assert.equal(fixture.counts().management, 0); assert.equal(fixture.counts().releases, 0);
});
await test('unsettled application cannot trigger final cleanup management', async () => {
  const fixture = cleanupFixture();
  const result = await finishOwnedGpuCleanup({ ...fixture.args, cleanupSettled: false }, fixture.io);
  assert.equal(result.status, 'FAIL'); assert.equal(fixture.counts().management, 0); assert.equal(fixture.counts().releases, 0);
});
await test('UNKNOWN before unload is never owned or an empty observation', async () => {
  const fixture = cleanupFixture(({ resident }) => [{ ...resident, compute: [{ pid: 30, vanished: true }] }]);
  const result = await drainOwnedGpuForTransition({ ...fixture.args, exchangeSettled: Promise.resolve(completed) }, fixture.io);
  assert.equal(result.status, 'FAIL'); assert.equal(result.unloaded, false); assert.equal(result.emptySamples, 0);
  assert.equal(fixture.counts().releases, 0);
});
await test('UNKNOWN after unload resets the three-empty sequence without releasing transition lease', async () => {
  const fixture = cleanupFixture(({ resident, empty }) => [resident, empty, { models: [], compute: [{ pid: 30, vanished: true }] }, empty, empty, empty]);
  const result = await drainOwnedGpuForTransition({ ...fixture.args, exchangeSettled: Promise.resolve(completed) }, fixture.io);
  assert.equal(result.status, 'PASS'); assert.equal(result.observations.length, 6); assert.equal(result.emptySamples, 3);
  assert.equal(result.observations[2].compute[0].vanished, true); assert.equal(fixture.counts().releases, 0);
});
