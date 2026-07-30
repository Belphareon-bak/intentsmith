// Deterministic registry self-check for tests/e2e/_helpers.js.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function mode(filePath) {
  return fs.statSync(filePath).mode & 0o777;
}

function childImport(envOverrides) {
  const env = { ...process.env, ...envOverrides };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const h = await import('./tests/e2e/_helpers.js'); console.log(h.BASE_URL);",
    ],
    {
      cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'),
      env,
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
}

const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-helpers-check-'));
const artifactRoot = path.join(runRoot, '.intentsmith-artifacts', 'helpers-check');
const legacyTranscript = path.join(runRoot, 'legacy-transcript.md');
let server;

try {
  fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(artifactRoot, 0o700);

  server = http.createServer((request, response) => {
    if (request.url === '/slow') return;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, path: request.url }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;
  process.env.C3_URL = `http://127.0.0.1:${port}`;
  process.env.C3_TRANSCRIPT = legacyTranscript;
  process.env.INTENTSMITH_TEST_ARTIFACT_DIR = artifactRoot;
  process.env.INTENTSMITH_TEST_REQUEST_TIMEOUT_MS = '100';
  process.env.INTENTSMITH_TEST_SUITE_ID = 'helpers-self-check';

  const helpers = await import('./_helpers.js');
  ensure(helpers.BASE_URL === process.env.C3_URL, 'C3_URL was not preserved');
  ensure(
    helpers.WS_URL === `ws://127.0.0.1:${port}/c3/ws`,
    'WebSocket URL did not use the runner-owned port',
  );
  ensure(typeof WebSocket.prototype.on === 'function', 'Node WebSocket compatibility API missing');

  const json = await helpers.api('GET', '/api/health');
  ensure(json.status === 200 && json.data.ok === true, 'buffered JSON request failed');
  const raw = await helpers.apiRaw('GET', '/raw');
  ensure(raw.status === 200, 'buffered raw request lost status');
  ensure((await raw.json()).path === '/raw', 'buffered raw request lost body');

  let escapedOriginRejected = false;
  try {
    await helpers.api('GET', '//127.0.0.1:1/escape');
  } catch {
    escapedOriginRejected = true;
  }
  ensure(escapedOriginRejected, 'same-origin API boundary accepted an authority override');

  const timeoutStarted = Date.now();
  let timedOut = false;
  try {
    await helpers.apiRaw('GET', '/slow');
  } catch (error) {
    timedOut = error?.name === 'TimeoutError';
  }
  ensure(timedOut, 'request did not terminate through its bounded AbortController');
  ensure(Date.now() - timeoutStarted < 2000, 'bounded request timeout leaked or fired too late');

  helpers.transcriptSection('Private transcript');
  const transcriptDir = path.join(artifactRoot, 'transcripts');
  const transcriptPath = path.join(transcriptDir, 'helpers-self-check.md');
  ensure(fs.existsSync(transcriptPath), 'private transcript was not written');
  ensure(!fs.existsSync(legacyTranscript), 'legacy C3_TRANSCRIPT path was used');
  ensure(mode(transcriptDir) === 0o700, 'transcript directory mode is not 0700');
  ensure(mode(transcriptPath) === 0o600, 'transcript file mode is not 0600');

  const ownedTemp = helpers.makeOwnedTempDir('owned-fixture');
  ensure(mode(ownedTemp) === 0o700, 'owned temporary directory mode is not 0700');
  fs.writeFileSync(path.join(ownedTemp, 'fixture.txt'), 'owned');
  ensure(helpers.removeOwnedTempDir(ownedTemp) === true, 'owned temp removal did not run');
  ensure(!fs.existsSync(ownedTemp), 'owned temporary directory survived cleanup');

  let arbitraryRemovalRejected = false;
  try {
    helpers.removeOwnedTempDir(runRoot);
  } catch {
    arbitraryRemovalRejected = true;
  }
  ensure(arbitraryRemovalRejected, 'arbitrary recursive removal was accepted');

  for (const invalidUrl of [
    'https://127.0.0.1:4443',
    'http://example.com:3335',
    'http://127.0.0.1:3335/nested',
  ]) {
    const child = childImport({
      C3_URL: invalidUrl,
      C3_PORT: undefined,
      C3_PORT_FILE: undefined,
    });
    ensure(child.status !== 0, `unsafe C3_URL was accepted: ${invalidUrl}`);
  }

  const portFile = path.join(artifactRoot, 'runner.port');
  fs.writeFileSync(portFile, JSON.stringify({
    port,
    host: '127.0.0.1',
    pid: process.pid,
  }), { mode: 0o600 });
  const fromPortFile = childImport({
    C3_URL: undefined,
    C3_PORT: '0',
    C3_PORT_FILE: portFile,
  });
  ensure(
    fromPortFile.status === 0 && fromPortFile.stdout.includes(`http://127.0.0.1:${port}`),
    `private port-file resolution failed: ${fromPortFile.stderr}`,
  );

  console.log('E2E helper self-check: PASS');
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  fs.rmSync(runRoot, { recursive: true, force: true });
}
