#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  appendFile,
  chmod,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import {
  assert,
  assertEqual,
  suite,
  summary,
  test,
  testAsync,
} from './harness.js';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import { runMigrations } from '../src/db/migrate.js';

const REPOSITORY_ROOT = isolatedTestRuntime.repositoryRoot;
const MODEL_NAME = 'fixture-model:latest';
const MODEL_DIGEST = '7'.repeat(64);
const PROCESS_TIMEOUT_MS = 30_000;
const LONG_CREATIVE_RESPONSE = [
  'Robot Karel se v tiché kuchyni rozhodl naučit vařit polévku podle starého rodinného receptu a pečlivě si připravil zeleninu, koření i velký hrnec.',
  'Nejdřív mu mrkev padala na podlahu a cibuli krájel příliš pomalu, ale po každém pokusu upravil pohyb kovových prstů a zapisoval si, co fungovalo.',
  'Když se polévka začala vařit, Karel ochutnal výsledek elektronickým senzorem, přidal špetku soli a pozval všechny sousedy ke stolu.',
  'Od toho večera robot každý týden zkoušel nový recept, kuchyně voněla čerstvým jídlem a lidé se těšili, jaké překvapení pro ně zase připraví.',
].join(' ');

function chatResponse(index) {
  return [
    'Praha má bohaté dějiny a krásné památky. Český král zde založil významné město. Návštěvníci dodnes obdivují její věže a náměstí.',
    'ne',
    'Umělá inteligence je obor informatiky, který vytváří systémy schopné řešit úkoly vyžadující lidskou inteligenci.',
    'Toto je první zpráva, takže jsme se ještě o ničem nebavili.',
    'Vážený pane řediteli, dovoluji si Vás požádat o schůzku k projednání školního projektu. Prosím o sdělení vhodného termínu. S úctou, Jan Novák.',
    LONG_CREATIVE_RESPONSE,
    'Hello, how are you?',
    'Shakespeare',
  ][index];
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function startFixtureProvider() {
  const requests = [];
  let chatRequestCount = 0;
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && requestUrl.pathname === '/api/tags') {
        requests.push('GET /api/tags');
        sendJson(response, 200, {
          models: [{ name: MODEL_NAME, digest: `sha256:${MODEL_DIGEST}` }],
        });
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api/chat') {
        await readJsonBody(request);
        requests.push('POST /api/chat');
        sendJson(response, 200, {
          message: { role: 'assistant', content: chatResponse(chatRequestCount++) },
          done: true,
          eval_count: 7,
          prompt_eval_count: 3,
        });
        return;
      }
      sendJson(response, 404, { error: 'fixture route not found' });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    },
  };
}

function collect(stream) {
  const chunks = [];
  stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
  return () => Buffer.concat(chunks).toString('utf8');
}

async function runNode(cwd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = collect(child.stdout);
    const stderr = collect(child.stderr);
    const timer = setTimeout(() => child.kill('SIGKILL'), PROCESS_TIMEOUT_MS);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: stdout(), stderr: stderr() });
    });
  });
}

function parseOneLine(value) {
  assert(value.endsWith('\n'), `Expected one LF-terminated JSON line: ${value}`);
  const lines = value.slice(0, -1).split('\n');
  assertEqual(lines.length, 1);
  return JSON.parse(lines[0]);
}

async function createCandidateClone() {
  const base = await mkdtemp(path.join(isolatedTestRuntime.artifacts, 'proof-issuer-candidate-'));
  await chmod(base, 0o700);
  const cloneRoot = path.join(base, 'candidate');
  execFileSync('git', [
    'clone', '--local', '--no-hardlinks', '--quiet', REPOSITORY_ROOT, cloneRoot,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  return cloneRoot;
}

async function createMigratedDatabase(name) {
  const databasePath = path.join(isolatedTestRuntime.temp, name);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  await runMigrations(db);
  return { db, databasePath };
}

async function runParent(cloneRoot, providerOrigin) {
  return runNode(cloneRoot, [
    'scripts/run-model-failover-candidate-measurement.js',
    '--role', 'CHAT',
    '--proposed-model-name', MODEL_NAME,
  ], {
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    OLLAMA_URL: providerOrigin,
    PATH: process.env.PATH || '/usr/bin:/bin',
    TZ: 'UTC',
  });
}

async function runIssuer(cloneRoot, acceptancePath, databasePath, extraArgs = []) {
  return runNode(cloneRoot, [
    'scripts/issue-model-failover-proof.js',
    '--acceptance', acceptancePath,
    '--db', databasePath,
    ...extraArgs,
  ], {
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: process.env.PATH || '/usr/bin:/bin',
    TZ: 'UTC',
  });
}

async function runIssuerWithClock(cloneRoot, acceptancePath, databasePath, nowMs) {
  const source = `
    import Database from 'better-sqlite3';
    import { createModelFailoverProofIssuer } from './scripts/issue-model-failover-proof.js';
    const db = new Database(process.env.TEST_DB_PATH);
    db.pragma('foreign_keys = ON');
    try {
      const issuer = createModelFailoverProofIssuer(db, {
        clock: () => Number(process.env.TEST_NOW_MS),
      });
      const result = await issuer.issue({ acceptancePath: process.env.TEST_ACCEPTANCE_PATH });
      process.stdout.write(JSON.stringify({ result }) + '\\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({ errorCode: error.code, message: error.message }) + '\\n');
    } finally {
      db.close();
    }
  `;
  return runNode(cloneRoot, ['--input-type=module', '--eval', source], {
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: process.env.PATH || '/usr/bin:/bin',
    TEST_ACCEPTANCE_PATH: acceptancePath,
    TEST_DB_PATH: databasePath,
    TEST_NOW_MS: String(nowMs),
    TZ: 'UTC',
  });
}

let fixture = null;

suite('M1 model failover proof issuer — artifact-bound PASS persistence');

test('issuer CLI exposes no caller-owned proof authority', () => {
  const source = execFileSync(process.execPath, ['-e', `
    const fs = require('node:fs');
    process.stdout.write(fs.readFileSync('scripts/issue-model-failover-proof.js', 'utf8'));
  `], { cwd: REPOSITORY_ROOT, encoding: 'utf8' });
  assert(source.includes("new Set(['--acceptance', '--db'])"));
  for (const forbidden of [
    '--role',
    '--suite',
    '--score',
    '--passed-count',
    '--ttl',
    '--now-ms',
    '--proof-id',
    '--digest',
    '--source-revision',
    '--contract-hash',
  ]) {
    assert(!source.includes(`'${forbidden}'`), forbidden);
  }
});

await testAsync('exact parent evidence issues one immutable A-bootstrap PASS proof', async () => {
  const cloneRoot = await createCandidateClone();
  const provider = await startFixtureProvider();
  const database = await createMigratedDatabase('proof-issuer-pass.sqlite');
  try {
    const parent = await runParent(cloneRoot, provider.origin);
    assertEqual(parent.code, 0);
    assertEqual(parent.signal, null);
    assertEqual(parent.stderr, '');
    const parentSummary = parseOneLine(parent.stdout);
    assertEqual(parentSummary.proofStatus, 'NOT_ISSUED');

    const issued = await runIssuer(
      cloneRoot,
      parentSummary.acceptancePath,
      database.databasePath,
    );
    assertEqual(issued.code, 0);
    assertEqual(issued.signal, null);
    assertEqual(issued.stderr, '');
    const issuedSummary = parseOneLine(issued.stdout);
    assertEqual(issuedSummary.proofStatus, 'PASS');
    assertEqual(issuedSummary.outcome, 'ISSUED');
    assertEqual(issuedSummary.role, 'CHAT');
    assertEqual(issuedSummary.modelName, MODEL_NAME);
    assertEqual(issuedSummary.modelDigestSha256, MODEL_DIGEST);

    const proof = database.db.prepare('SELECT * FROM model_failover_proofs').get();
    assertEqual(database.db.prepare('SELECT COUNT(*) AS count FROM model_failover_proofs').get().count, 1);
    assertEqual(database.db.prepare('SELECT COUNT(*) AS count FROM model_failover_proof_artifacts').get().count, 2);
    assertEqual(proof.proof_id, issuedSummary.proofId);
    assertEqual(proof.result, 'PASS');
    assertEqual(proof.score, 1);
    assertEqual(proof.required_score, 1);
    assertEqual(proof.passed_count, 8);
    assertEqual(proof.required_passed_count, 8);
    assertEqual(proof.total_count, 8);
    assertEqual(proof.expires_at_ms - proof.completed_at_ms, 604800000);
    assertEqual(proof.measurement_artifact_sha256, parentSummary.measurementArtifactSha256);
    assertEqual(proof.acceptance_artifact_sha256, parentSummary.acceptanceSha256);
    assertEqual(proof.source_revision, parentSummary.sourceRevision);
    assert(/^[a-f0-9]{64}$/.test(proof.role_contract_sha256));

    const replay = await runIssuer(
      cloneRoot,
      parentSummary.acceptancePath,
      database.databasePath,
    );
    assertEqual(replay.code, 0);
    assertEqual(parseOneLine(replay.stdout).outcome, 'ALREADY_ISSUED');
    assertEqual(database.db.prepare('SELECT COUNT(*) AS count FROM model_failover_proofs').get().count, 1);
    assertEqual(provider.requests.filter(route => route === 'GET /api/tags').length, 4);
    assertEqual(provider.requests.filter(route => route === 'POST /api/chat').length, 8);

    fixture = {
      cloneRoot,
      acceptancePath: parentSummary.acceptancePath,
      acceptance: JSON.parse(await readFile(parentSummary.acceptancePath, 'utf8')),
    };
  } finally {
    database.db.close();
    await provider.close();
  }
});

await testAsync('unknown CLI authority is rejected before proof persistence', async () => {
  assert(fixture, 'Positive issuer fixture must run first');
  const database = await createMigratedDatabase('proof-issuer-cli-reject.sqlite');
  try {
    const result = await runIssuer(
      fixture.cloneRoot,
      fixture.acceptancePath,
      database.databasePath,
      ['--now-ms', '1'],
    );
    assertEqual(result.code, 1);
    assertEqual(result.stdout, '');
    assertEqual(parseOneLine(result.stderr).code, 'MODEL_FAILOVER_PROOF_ISSUER_INPUT_INVALID');
    assertEqual(database.db.prepare('SELECT COUNT(*) AS count FROM model_failover_proofs').get().count, 0);
    assertEqual(database.db.prepare('SELECT COUNT(*) AS count FROM model_failover_proof_artifacts').get().count, 0);
  } finally {
    database.db.close();
  }
});

await testAsync('artifact mode drift and dirty committed source fail before DB effects', async () => {
  assert(fixture, 'Positive issuer fixture must run first');
  const modeDatabase = await createMigratedDatabase('proof-issuer-mode-reject.sqlite');
  try {
    await chmod(fixture.acceptancePath, 0o600);
    const modeResult = await runIssuer(
      fixture.cloneRoot,
      fixture.acceptancePath,
      modeDatabase.databasePath,
    );
    assertEqual(modeResult.code, 1);
    assertEqual(parseOneLine(modeResult.stderr).code, 'MODEL_FAILOVER_PROOF_ARTIFACT_METADATA_INVALID');
    assertEqual(modeDatabase.db.prepare('SELECT COUNT(*) AS count FROM model_failover_proof_artifacts').get().count, 0);
  } finally {
    await chmod(fixture.acceptancePath, 0o400);
    modeDatabase.db.close();
  }

  const dirtyDatabase = await createMigratedDatabase('proof-issuer-dirty-reject.sqlite');
  const configPath = path.join(fixture.cloneRoot, 'src/config.js');
  const originalConfig = await readFile(configPath);
  try {
    await appendFile(configPath, '\n// proof issuer dirty-source fixture\n');
    const dirtyResult = await runIssuer(
      fixture.cloneRoot,
      fixture.acceptancePath,
      dirtyDatabase.databasePath,
    );
    assertEqual(dirtyResult.code, 1);
    assertEqual(parseOneLine(dirtyResult.stderr).code, 'MODEL_FAILOVER_PROOF_SOURCE_DIRTY');
    assertEqual(dirtyDatabase.db.prepare('SELECT COUNT(*) AS count FROM model_failover_proof_artifacts').get().count, 0);
  } finally {
    await writeFile(configPath, originalConfig);
    dirtyDatabase.db.close();
  }
});

await testAsync('proof insert failure rolls both artifact metadata rows back', async () => {
  assert(fixture, 'Positive issuer fixture must run first');
  const database = await createMigratedDatabase('proof-issuer-rollback.sqlite');
  try {
    database.db.exec(`
      CREATE TRIGGER fixture_reject_proof_insert
      BEFORE INSERT ON model_failover_proofs
      BEGIN
        SELECT RAISE(ABORT, 'fixture proof insert rejection');
      END;
    `);
    const result = await runIssuer(
      fixture.cloneRoot,
      fixture.acceptancePath,
      database.databasePath,
    );
    assertEqual(result.code, 1);
    assertEqual(parseOneLine(result.stderr).code, 'MODEL_FAILOVER_PROOF_PERSISTENCE_FAILED');
    assertEqual(database.db.prepare('SELECT COUNT(*) AS count FROM model_failover_proofs').get().count, 0);
    assertEqual(database.db.prepare('SELECT COUNT(*) AS count FROM model_failover_proof_artifacts').get().count, 0);
  } finally {
    database.db.close();
  }
});

await testAsync('strict expiry rejects proof exactly at completedAt plus seven days', async () => {
  assert(fixture, 'Positive issuer fixture must run first');
  const measurementPath = path.join(
    fixture.cloneRoot,
    ...fixture.acceptance.measurement.artifactPath.split('/'),
  );
  const measurement = JSON.parse(await readFile(measurementPath, 'utf8'));
  const expiresAtMs = measurement.completedAtMs + 604800000;
  const database = await createMigratedDatabase('proof-issuer-expiry-edge.sqlite');
  try {
    const result = await runIssuerWithClock(
      fixture.cloneRoot,
      fixture.acceptancePath,
      database.databasePath,
      expiresAtMs,
    );
    assertEqual(result.code, 0);
    assertEqual(result.stderr, '');
    const outcome = parseOneLine(result.stdout);
    assertEqual(outcome.errorCode, 'MODEL_FAILOVER_PROOF_EVIDENCE_EXPIRED');
    assertEqual(database.db.prepare('SELECT COUNT(*) AS count FROM model_failover_proofs').get().count, 0);
    assertEqual(database.db.prepare('SELECT COUNT(*) AS count FROM model_failover_proof_artifacts').get().count, 0);
  } finally {
    database.db.close();
  }
});

summary();
