import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createDependencyDownloader, installationUrl } from '../src/setup/dependency-download.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intentsmith-download-test-'));let counter = 0;
after(() => fs.rm(root, { recursive: true, force: true }));
function fixture({ addresses = [{ address: '93.184.216.34', family: 4 }], status = 200, headers = {}, body = 'package', check = () => {}, audit = () => {}, beforeConnect = () => {} } = {}) {
  const connections = [], events = [];
  const download = createDependencyDownloader({ resolve: async () => addresses, request(url, options, callback) {
    check(options);const req = new EventEmitter();
    req.end = () => options.lookup(url.hostname, {}, (error, address) => {
      if (error) return req.emit('error', error);
      connections.push(address);
      const response = new PassThrough();response.statusCode = status;response.headers = headers;
      callback(response);if (!response.destroyed) response.end(body);
    });return req;
  } });
  return { connections, events, run: () => download({ url: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz', destination: path.join(root, String(++counter)), maxBytes: 32,
    audit: (kind, detail) => { events.push({ kind, detail });audit(kind, detail); }, beforeConnect }) };
}
test('transport pins approved public address, disables redirects/compression/ambient credentials and returns real hash', async () => {
  const f = fixture({ check: options => { assert.equal(options.agent, false);assert.equal(options.rejectUnauthorized, true);assert.equal(options.autoSelectFamily, false);assert.deepEqual(options.headers, { 'Accept-Encoding': 'identity' }); } });
  const result = await f.run();assert.equal(result.bytes, 7);assert.equal(result.sha512.length, 128);assert.deepEqual(f.connections, ['93.184.216.34']);
  assert.equal(f.events.at(-1).kind, 'download_verified_transport');
});
test('any private DNS answer blocks before connecting, including mixed public/private responses', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fc00::1', '100.64.0.1']) {
    const f = fixture({ addresses: [{ address: '93.184.216.34', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }] });
    await assert.rejects(f.run(), /INSTALL_ADDRESS_DENIED/);assert.equal(f.connections.length, 0);
  }
});
test('redirect, non-200, compression and excessive content length are rejected', async () => {
  for (const options of [{ status: 301, headers: { location: 'https://elsewhere.example' } }, { status: 404 }, { headers: { 'content-encoding': 'gzip' } }, { headers: { 'content-length': '33' } }]) {
    const f = fixture(options);await assert.rejects(f.run(), /INSTALL_(?:RESPONSE_DENIED|DOWNLOAD_LIMIT)/);
    assert.equal(f.events.some(e => e.kind === 'download_verified_transport'), false);
  }
});
test('stream size overflow fails without a successful receipt', async () => {
  const f = fixture({ body: Buffer.alloc(33) });await assert.rejects(f.run(), /INSTALL_DOWNLOAD_LIMIT/);
  assert.equal(f.events.some(e => e.kind === 'download_verified_transport'), false);
});
test('authority is checked again after DNS; audit failure closes response instead of crashing server', async () => {
  let checks = 0;const f = fixture({ beforeConnect: () => { if (++checks > 1) throw Error('revoked'); } });
  await assert.rejects(f.run(), /revoked/);assert.equal(f.connections.length, 0);
  await assert.rejects(fixture({ audit: () => { throw Error('audit unavailable'); } }).run(), /audit unavailable/);
});
test('fixed source parser rejects equivalent but non-canonical URLs and source widening', () => {
  for (const value of ['http://registry.npmjs.org/a', 'https://registry.npmjs.org:443/a', 'https://user@registry.npmjs.org/a', 'https://registry.npmjs.org/a?token=x', 'https://registry.npmjs.org/a#x', 'https://registry.npmjs.org/../a', 'https://evil.example/a']) assert.throws(() => installationUrl(value));
});
