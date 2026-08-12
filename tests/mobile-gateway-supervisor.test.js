// Owned-listener supervisor, exercised against the real gateway process.
// ==============================================================================
//
// The other mobile suites build the listener in-process, which cannot catch
// anything that only happens when `node src/mobile-gateway.js` actually runs:
// a broken import, migrations that never execute, a readiness line that is
// never printed, a process that ignores SIGTERM.
//
// This suite is also the demonstration that a "server" test does not have to be
// BLOCKED.  The registry blocks suites that need a listener they do not own; by
// owning the process, the port, and the database, this suite removes the
// dependency instead of pretending it is satisfied.
//
// ==============================================================================

import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';

import { startOwnedServer, withOwnedServer } from './helpers/server-supervisor.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

console.log('\n=== Owned gateway supervisor ===');

const ENTRY = 'src/mobile-gateway.js';

await test('the gateway process starts and reports an OS-assigned port', async () => {
  await withOwnedServer({ entry: ENTRY, env: { C3_MOBILE_UI: 'off' } }, async server => {
    assert.ok(Number.isInteger(server.port) && server.port > 0, 'a real port must be reported');
    assert.notEqual(server.port, 3336, 'the default port must not be used — suites would collide');
    assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  });
});

await test('the supervised gateway answers on its reported port', async () => {
  await withOwnedServer({ entry: ENTRY, env: { C3_MOBILE_UI: 'off' } }, async server => {
    const response = await fetch(`${server.baseUrl}/m1/health`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.status, 'ok');
  });
});

await test('migrations run inside the supervised process', async () => {
  await withOwnedServer({ entry: ENTRY, env: { C3_MOBILE_UI: 'off' } }, async server => {
    assert.ok(existsSync(server.dbPath), 'the isolated database must be created');
    // A 401 rather than a 500 proves api_tokens exists and was queried.
    const response = await fetch(`${server.baseUrl}/m1/conversations`, {
      headers: { authorization: 'Bearer c3_nope' },
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'token_invalid');
  });
});

await test('each supervised server is isolated from the next', async () => {
  const first = await startOwnedServer({ entry: ENTRY, env: { C3_MOBILE_UI: 'off' } });
  const second = await startOwnedServer({ entry: ENTRY, env: { C3_MOBILE_UI: 'off' } });
  try {
    assert.notEqual(first.port, second.port, 'two owned servers must not share a port');
    assert.notEqual(first.dbPath, second.dbPath, 'two owned servers must not share a database');
  } finally {
    await first.stop();
    await second.stop();
  }
});

await test('teardown stops the process and the port stops answering', async () => {
  const server = await startOwnedServer({ entry: ENTRY, env: { C3_MOBILE_UI: 'off' } });
  const { baseUrl } = server;
  assert.equal((await fetch(`${baseUrl}/m1/health`)).status, 200);

  await server.stop();

  await assert.rejects(
    () => fetch(`${baseUrl}/m1/health`),
    'the listener must be gone after teardown, or suites leak processes',
  );
});

await test('stop is idempotent', async () => {
  const server = await startOwnedServer({ entry: ENTRY, env: { C3_MOBILE_UI: 'off' } });
  await server.stop();
  await server.stop();
  passed === passed; // reaching here without throwing is the assertion
});

await test('teardown runs even when the body throws', async () => {
  let captured = null;
  await assert.rejects(
    () => withOwnedServer({ entry: ENTRY, env: { C3_MOBILE_UI: 'off' } }, async server => {
      captured = server.baseUrl;
      throw new Error('deliberate failure');
    }),
    /deliberate failure/,
  );
  assert.ok(captured, 'the server should have started');
  await assert.rejects(() => fetch(`${captured}/m1/health`), 'a throwing suite must not leak the listener');
});

await test('the supervisor refuses to bind a non-loopback host', async () => {
  await assert.rejects(
    () => startOwnedServer({ entry: ENTRY, host: '0.0.0.0' }),
    /non-loopback/,
  );
});

await test('the pairing kill switch is off in a default supervised process', async () => {
  await withOwnedServer({ entry: ENTRY, env: { C3_MOBILE_UI: 'off' } }, async server => {
    const response = await fetch(`${server.baseUrl}/m1/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'anything-at-all-here-1234' }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'pairing_disabled');
  });
});

console.log(`\nOwned gateway supervisor: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
