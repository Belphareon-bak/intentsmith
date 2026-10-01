// Hunt display observation, never a model runner. ALL provider writes are denied.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {randomUUID} from 'node:crypto';
import { CONFIG, ROOT, sha, fileSha, save, inherited, sourceIdentity } from './common.mjs';
import { verifyPackageMembers } from './package-members.mjs';
import { OwnedRelayRequests } from './relay-owned.mjs';
import {launchOwnedNamespace} from './pid-namespace-supervisor.mjs';
process.umask(0o077);
const args = process.argv.slice(2);
assert.equal(args.length, 2, 'requires --run-readonly followed by NEW absolute output directory');
assert.equal(args[0], '--run-readonly');
const out = path.resolve(args[1]);
assert.equal(path.dirname(out), path.dirname(ROOT));
assert.equal(fs.existsSync(out), false, 'never overwrite a packet');
const identity = sourceIdentity();
const packageMembers = verifyPackageMembers(CONFIG.package, CONFIG.packageManifestSha256);
fs.mkdirSync(out, {mode: 0o700});
const result = {schemaVersion: 1, status: 'FAIL', scope: 'actual GPU capacity + installed metadata to packaged DOM; private DB has no accepted grade',
  backendSource: CONFIG.backendHead, packageSource: CONFIG.packageSource,
  startedUtc: new Date().toISOString(), source: identity, packageMembers,
  inferenceRequests: 0, roleActivation: 'PROHIBITED', gpuLeaseAcquired: false,
  foreignProcessesChanged: false, chat: 'NOT_RUN', modelQuality: 'NOT_RUN', releaseAccepted: false};
let server, child, socketRoot, cookie, supervisor, supervisorTimer, deadlineTimer, escalation;
let interrupted = null, childCompleted = false;
const nonce = randomUUID();
const requestAbort = reason => {
  if (interrupted) return;
  interrupted = reason; supervisor?.abort(reason);
};
const signalAbort = signal => requestAbort('HOST_' + signal);
const onTerm = () => signalAbort('SIGTERM'), onInt = () => signalAbort('SIGINT');
process.on('SIGTERM', onTerm); process.on('SIGINT', onInt);
const ownership = new OwnedRelayRequests();
const requests = [];
function privateXauthority() {
  const source = process.env.INTENTSMITH_STUDIO_XAUTHORITY || process.env.XAUTHORITY;
  const display = process.env.DISPLAY;
  assert.ok(display && source && path.isAbsolute(source));
  const entry = spawnSync('/usr/bin/xauth', ['-f', source, 'nlist', display], {encoding: null, timeout: 10_000});
  assert.equal(entry.status, 0); assert.ok(entry.stdout.length);
  cookie = path.join(out, 'Xauthority'); fs.closeSync(fs.openSync(cookie, 'wx', 0o600));
  const merge = spawnSync('/usr/bin/xauth', ['-f', cookie, 'nmerge', '-'], {input: entry.stdout, encoding: null, timeout: 10_000});
  assert.equal(merge.status, 0); fs.chmodSync(cookie, 0o600);
  return display;
}
try {
  const capture = path.join(out, 'capture');
  for (const name of ['', 'home', 'state', 'config', 'cache', 'data']) fs.mkdirSync(path.join(capture, name), {mode: 0o700});
  const captureEnv = {...inherited(), HOME: path.join(capture, 'home'), XDG_STATE_HOME: path.join(capture, 'state'),
    XDG_CONFIG_HOME: path.join(capture, 'config'), XDG_CACHE_HOME: path.join(capture, 'cache'), XDG_DATA_HOME: path.join(capture, 'data'),
    NODE_ENV: 'test', CI: '1', DOTENV_CONFIG_PATH: path.join(capture, 'no-dotenv')};
  const observed = spawnSync(CONFIG.node, [path.join(ROOT, 'gpu-capture.mjs'), CONFIG.backend, captureEnv.XDG_STATE_HOME],
    {cwd: CONFIG.backend, env: captureEnv, encoding: 'utf8', timeout: 20_000});
  fs.writeFileSync(path.join(out, 'gpu-capture.log'), observed.stderr || '', {mode: 0o600});
  assert.equal(observed.status, 0, 'canonical GPU capture failed');
  const gpu = JSON.parse(observed.stdout); save(out, 'GPU-OBSERVATION.json', gpu);
  assert.equal(interrupted, null, 'host interrupted before GUI side effects');
  const display = privateXauthority();
  socketRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'is-hunt-ro-')); fs.chmodSync(socketRoot, 0o700);
  const socket = path.join(socketRoot, 'metadata.sock');
  server = http.createServer((incoming, outgoing) => {
    const row = {at: new Date().toISOString(), method: incoming.method, path: incoming.url, upstreamCreated: false}; requests.push(row);
    // Exact GET strings only: NO body, NO queries, NO redirects, NO provider POST (including show/unload).
    if (incoming.method !== 'GET' || !CONFIG.allowedProviderReads.includes(incoming.url)
      || incoming.headers['transfer-encoding'] || Number(incoming.headers['content-length'] || 0) !== 0) {
      row.denied = true; outgoing.writeHead(403, {'Content-Type': 'application/json'});
      outgoing.end(JSON.stringify({code: 'READONLY_PROVIDER_DENY'})); incoming.resume(); return;
    }
    row.upstreamCreated = true;
    let ticket;
    const upstream = http.request({hostname: '127.0.0.1', port: 11434, path: incoming.url, method: 'GET'}, response => {
      ticket.attachResponse(response); row.status = response.statusCode;
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 16_000_000) upstream.destroy(Error('metadata limit')); else chunks.push(chunk); });
      response.once('end', () => {
        const raw = Buffer.concat(chunks); row.responseBytes = size; row.responseSha256 = sha(raw);
        row.complete = response.complete; row.finishedUtc = new Date().toISOString();
        if (response.statusCode === 200 && response.complete) {
          const filename = (incoming.url === '/api/tags' ? 'TAGS-' : 'VERSION-') + requests.indexOf(row) + '.json';
          fs.writeFileSync(path.join(out, filename), raw, {mode: 0o600}); row.responseFile = filename;
        }
      });
      outgoing.writeHead(response.statusCode, {'Content-Type': 'application/json'}); response.pipe(outgoing);
    });
    ticket = ownership.track(incoming, outgoing, upstream, error => { row.error = error.message; });
    upstream.setTimeout(10_000, () => upstream.destroy(Error('bounded metadata timeout')));
    upstream.on('error', error => { row.error = error.message; if (!outgoing.destroyed) { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); } });
    upstream.end();
  });
  await new Promise(resolve => server.listen(socket, resolve)); fs.chmodSync(socket, 0o600);
  assert.equal(interrupted, null, 'interrupted during metadata-listener await: never spawn namespace');
  save(out, 'INSIDE.json', {out, display, socket, nonce, parentNetns: String(fs.statSync('/proc/self/ns/net').ino),
    parentPidNamespace: fs.readlinkSync('/proc/self/ns/pid'),
    gpuInventoryFile: path.join(captureEnv.XDG_STATE_HOME, 'intentsmith/gpu-inventory.json'),
    gpuInventorySha256: fileSha(path.join(captureEnv.XDG_STATE_HOME, 'intentsmith/gpu-inventory.json'))});
  const launched = launchOwnedNamespace({out, nonce, isAborted: () => interrupted !== null});
  child = launched.child; supervisor = launched.supervisor;
  assert.ok(supervisor, 'namespace launcher unavailable');
  // Replayed cancellation is redundant with the synchronous launch guard, but
  // preserves any accepted interrupt as soon as the lifecycle owner exists.
  if (interrupted) supervisor.abort(interrupted);
  const poll = () => {try {supervisor.poll();} catch (error) {result.supervisorError = error.message; requestAbort('SUPERVISOR_IDENTITY_FAILED');}};
  supervisorTimer = setInterval(poll, 20);
  const output = {stdout: '', stderr: ''};
  child.stdout.on('data', chunk => { output.stdout = (output.stdout + chunk).slice(-200_000); });
  child.stderr.on('data', chunk => { output.stderr = (output.stderr + chunk).slice(-200_000); });
  const exit = await new Promise((resolve, reject) => {
    const escalate = () => {
      if (escalation) return;
      escalation = (async () => {
        await new Promise(resolve => setTimeout(resolve, 10_000));
        if (childCompleted) return;
        poll(); result.deadlineNamespaceCleanup = await supervisor.stop();
      })();
    };
    deadlineTimer = setTimeout(() => {result.deadline = true; requestAbort('HOST_DEADLINE_180_SECONDS'); escalate();}, 180_000);
    const abortCheck = setInterval(() => {if (interrupted) {clearInterval(abortCheck); escalate();}}, 30);
    child.once('error', reject); child.once('close', (code, signal) => resolve({code, signal}));
    child.once('close', () => {childCompleted = true; clearInterval(abortCheck);});
  });
  clearTimeout(deadlineTimer); result.child = exit;
  fs.writeFileSync(path.join(out, 'child.stdout.log'), output.stdout, {mode: 0o600});
  fs.writeFileSync(path.join(out, 'child.stderr.log'), output.stderr, {mode: 0o600});
  assert.equal(exit.code, 0); assert.equal(exit.signal, null); assert.equal(result.deadline, undefined); assert.equal(interrupted, null);
  const childResult = JSON.parse(fs.readFileSync(path.join(out, 'RESULT.json'))); assert.equal(childResult.status, 'PASS');
  const actualTags = requests.filter(row => row.path === '/api/tags' && row.upstreamCreated && row.complete && row.status === 200);
  assert.ok(actualTags.length, 'actual model metadata must have crossed the strict relay');
  const lastTags = JSON.parse(fs.readFileSync(path.join(out, actualTags.at(-1).responseFile)));
  assert.ok(lastTags.models.length); assert.equal(lastTags.models.some(m => m.name === CONFIG.roleSentinel), false);
  const overview = JSON.parse(fs.readFileSync(path.join(out, 'API-api-system-models-overview.json'))).body;
  const evaluations = JSON.parse(fs.readFileSync(path.join(out, 'API-api-system-models-evaluations.json'))).body;
  const inventoryKey = rows => rows.map(row => ({name: row.name.trim(), size: row.size,
    digest: (row.digestSha256 || row.digest || '').replace(/^sha256:/, '')})).sort((a, b) => a.name.localeCompare(b.name));
  const observedInventory = inventoryKey(overview.models);
  const matchingTags = actualTags.find(row => JSON.stringify(inventoryKey(JSON.parse(fs.readFileSync(path.join(out, row.responseFile))).models)) === JSON.stringify(observedInventory));
  assert.ok(matchingTags, 'overview sizes/digests must equal a captured complete actual installed-metadata read');
  for (const model of evaluations.models) {
    const installed = observedInventory.find(row => row.name === model.name); assert.ok(installed);
    assert.equal(model.digestSha256, installed.digest);
  }
  result.actualInventoryProof = {tagsResponseFile: matchingTags.responseFile, responseSha256: matchingTags.responseSha256,
    actualModelCount: observedInventory.length, overviewExactSizesDigests: true, evaluationsExactDigests: true};
  assert.equal(requests.some(row => row.upstreamCreated && row.method !== 'GET'), false);
  assert.equal(requests.some(row => row.upstreamCreated && !CONFIG.allowedProviderReads.includes(row.path)), false);
  result.status = 'PASS'; result.childResultSha256 = fileSha(path.join(out, 'RESULT.json'));
} catch (error) { result.error = String(error.stack || error); process.exitCode = 1; }
finally {
  clearTimeout(deadlineTimer); clearInterval(supervisorTimer);
  if (escalation) await escalation;
  if (supervisor) {
    try {supervisor.poll();} catch (error) {result.supervisorError = error.message;}
    result.ownedNamespaceCleanup = await supervisor.stop();
    result.innerFinallyAcknowledged = fs.existsSync(path.join(out, 'CLEANUP-ACK.json'))
      && JSON.parse(fs.readFileSync(path.join(out, 'CLEANUP-ACK.json'))).nonce === nonce;
    const completion = await supervisor.finish({interrupted,
      payloadStatus: result.supervisorError ? 'FAIL' : result.status,
      cleanupAcknowledged: result.innerFinallyAcknowledged});
    result.namespaceCompletion = completion;
    if (completion.status !== 'PASS' || result.supervisorError) result.status = 'FAIL';
  }
  result.interrupted = interrupted;
  if (interrupted) result.status = 'FAIL';
  const closed = server ? new Promise(resolve => server.close(() => resolve(true))) : Promise.resolve(true);
  server?.closeAllConnections(); result.upstreamDrain = await ownership.cancelAndSettle(10_000);
  let timer; result.relayClosed = await Promise.race([closed, new Promise(resolve => { timer = setTimeout(() => resolve(false), 10_000); })]); clearTimeout(timer);
  if (!result.upstreamDrain.settled || result.upstreamDrain.pending || !result.relayClosed) result.status = 'FAIL';
  if (cookie) fs.rmSync(cookie, {force: true}); result.privateXauthorityRemoved = !cookie || !fs.existsSync(cookie);
  if (socketRoot && result.relayClosed && result.upstreamDrain.pending === 0) fs.rmSync(socketRoot, {recursive: true, force: true});
  try { result.sourceUnchanged = JSON.stringify(sourceIdentity()) === JSON.stringify(identity); } catch (error) { result.sourceUnchanged = false; result.sourceError = error.message; }
  if (!result.sourceUnchanged || !result.privateXauthorityRemoved) result.status = 'FAIL';
  result.providerRequestCount = requests.length; result.providerWriteForwardedCount = requests.filter(row => row.upstreamCreated && row.method !== 'GET').length;
  result.inferenceRequests = requests.filter(row => row.upstreamCreated && ['/api/chat', '/api/generate'].includes(row.path)).length;
  result.deniedProviderWriteCount = requests.filter(row => row.denied && row.method !== 'GET').length;
  if (result.providerWriteForwardedCount || result.inferenceRequests) result.status = 'FAIL';
  result.endedUtc = new Date().toISOString(); save(out, 'PROVIDER-READS.json', requests); save(out, 'HOST-RESULT.json', result);
  if (result.status !== 'PASS') process.exitCode = 1;
  process.off('SIGTERM', onTerm); process.off('SIGINT', onInt);
  process.stdout.write(JSON.stringify({status: result.status, artifactRoot: out, inferenceRequests: 0}) + '\n');
}
