import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const studioPath = path.join(
  root,
  'c3-ide/extensions/c3-center-views/lib/browser/center-views-module.js',
);
const source = await readFile(studioPath, 'utf8');

function methodSlice(name, nextName) {
  const plainStart = source.indexOf(`  ${name}(`);
  const asyncStart = source.indexOf(`  async ${name}(`);
  const start = plainStart === -1 ? asyncStart : plainStart;
  assert.notEqual(start, -1, `${name} must exist`);
  const plainEnd = source.indexOf(`  ${nextName}(`, start + 1);
  const asyncEnd = source.indexOf(`  async ${nextName}(`, start + 1);
  const end = plainEnd === -1 ? asyncEnd : plainEnd;
  assert.notEqual(end, -1, `${nextName} must exist after ${name}`);
  return source.slice(start, end);
}

test('Studio exposes an explicit Remote Companion settings section with no public-ingress claim', () => {
  assert.match(source, /id: 'remote', icon: '📱', title: 'Remote Companion'/u);
  assert.match(source, /Telefon se připojuje pouze přes vaši VPN/u);
  assert.match(source, /Vytvořit 5min kód/u);
  assert.match(source, /Po prvním použití nebo po vypršení už nefunguje/u);
  assert.doesNotMatch(source, /port-forward|veřejný endpoint je aktivní/u);
});

test('pairing request sends only selected scopes to the exact local endpoint', () => {
  const method = methodSlice('_m7IssuePairingClaim', '_fetchGpuInfo');
  assert.match(method, /fetch\('\/api\/m7\/remote\/pairing\/claims'/u);
  assert.match(method, /credentials: 'same-origin'/u);
  assert.match(method, /body: JSON\.stringify\(\{ scopes: requestedScopes \}\)/u);
  assert.doesNotMatch(method, /actorId|subjectId:|admin|authorization/u);
  assert.match(method, /AbortSignal\.timeout\(10000\)/u);
});

test('success requires the exact claim contract, identity, scopes, URI and five-minute horizon', () => {
  const method = methodSlice('_m7IssuePairingClaim', '_fetchGpuInfo');
  for (const evidence of [
    "payload.contract !== 'M7LocalPairingClaim'",
    'payload.version !== 1',
    "payload.pairingUri !== 'intentsmith://pair?code=' + payload.claimCode",
    'JSON.stringify(payload.scopes) !== JSON.stringify(requestedScopes)',
    'expiresAtMs - Date.now() > 300000',
  ]) assert.ok(method.includes(evidence), evidence);
  assert.match(method, /Object\.keys\(payload\)\.sort\(\)/u);
  assert.match(method, /setTimeout\(\(\) => \{/u);
  assert.match(method, /this\._m7Pairing\.claim = null/u);
  assert.match(source, /disabled: pairing\.status === 'loading' \|\| claim !== null/u);
});

test('claim remains memory-only and errors do not expose server messages', () => {
  const method = methodSlice('_m7IssuePairingClaim', '_fetchGpuInfo');
  assert.doesNotMatch(method, /localStorage|sessionStorage|indexedDB|navigator\.clipboard/u);
  assert.doesNotMatch(method, /error\.message|payload\.error/u);
  assert.match(method, /M7_LOCAL_PAIRING_NOT_ACTIVE/u);
  assert.match(method, /M7_LOCAL_PAIRING_AUTH_REQUIRED/u);
});
