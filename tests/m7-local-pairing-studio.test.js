import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const studioPath = path.join(
  root,
  'intentsmith-ide/extensions/intentsmith-studio2/lib/browser/view/live-model.js',
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
  assert.match(source, /kind: 'pairing'/u);
  assert.match(source, /VPN runtime zatím není aktivní/u);
  assert.match(source, /issue: \(\) => this\.issuePairingClaim\(\)/u);
  assert.match(source, /Platnost párovacího kódu vypršela/u);
  assert.doesNotMatch(source, /port-forward|veřejný endpoint je aktivní/u);
});

test('pairing request sends only selected scopes to the exact local endpoint', () => {
  const method = methodSlice('issuePairingClaim', 'runLearningCommand');
  assert.match(method, /this\.fetchImpl\(base \+ '\/api\/m7\/remote\/pairing\/claims'/u);
  assert.match(method, /credentials: 'same-origin'/u);
  assert.match(method, /body: JSON\.stringify\(\{ scopes: requestedScopes \}\)/u);
  assert.doesNotMatch(method, /actorId|subjectId:|admin|authorization/u);
  assert.match(method, /AbortSignal\.timeout\(10_000\)/u);
});

test('success requires the exact claim contract, identity, scopes, URI and five-minute horizon', () => {
  const method = methodSlice('issuePairingClaim', 'runLearningCommand');
  for (const evidence of [
    "payload.contract !== 'M7LocalPairingClaim'",
    'payload.version !== 1',
    "payload.pairingUri !== 'intentsmith://pair?code=' + payload.claimCode",
    'JSON.stringify(payload.scopes) !== JSON.stringify(requestedScopes)',
    'expiresAtMs - Date.now() > 300_000',
  ]) assert.ok(method.includes(evidence), evidence);
  assert.match(method, /Object\.keys\(payload\)\.sort\(\)/u);
  assert.match(method, /setTimeout\(\(\) => \{/u);
  assert.match(method, /pairing\.claim = null/u);
  assert.match(source, /disabled: pairing\.status === 'loading' \|\| !!claim/u);
});

test('claim remains memory-only and errors do not expose server messages', () => {
  const method = methodSlice('issuePairingClaim', 'runLearningCommand');
  assert.doesNotMatch(method, /localStorage|sessionStorage|indexedDB|navigator\.clipboard/u);
  assert.doesNotMatch(method, /error\.message|payload\.error/u);
  assert.match(method, /M7_LOCAL_PAIRING_NOT_ACTIVE/u);
  assert.match(method, /M7_LOCAL_PAIRING_AUTH_REQUIRED/u);
});
