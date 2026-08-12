#!/usr/bin/env node

import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assert,
  assertEqual,
  suite,
  summary,
  testAsync,
} from './harness.js';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import { runMigrations } from '../src/db/migrate.js';

const REPOSITORY_ROOT = isolatedTestRuntime.repositoryRoot;
const PARENT_RELATIVE_PATH = 'scripts/run-model-failover-candidate-measurement.js';
const ISSUER_RELATIVE_PATH = 'scripts/issue-model-failover-proof.js';
const MODEL_NAME = 'fixture-model:latest';
const DIGEST_A = '7'.repeat(64);
const DIGEST_B = '8'.repeat(64);
const LONG_CREATIVE_RESPONSE = [
  'Robot Karel se v tiché kuchyni rozhodl naučit vařit polévku podle starého rodinného receptu a pečlivě si připravil zeleninu, koření i velký hrnec.',
  'Nejdřív mu mrkev padala na podlahu a cibuli krájel příliš pomalu, ale po každém pokusu upravil pohyb kovových prstů a zapisoval si, co fungovalo.',
  'Když se polévka začala vařit, Karel ochutnal výsledek elektronickým senzorem, přidal špetku soli a pozval všechny sousedy ke stolu.',
  'Od toho večera robot každý týden zkoušel nový recept, kuchyně voněla čerstvým jídlem a lidé se těšili, jaké překvapení pro ně zase připraví.',
].join(' ');

let candidateRoot;
let issuerModule;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function captureRejection(callback) {
  try {
    await callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to reject');
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function consumeJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1024 * 1024) throw new Error('Fixture request exceeded 1 MiB');
    chunks.push(chunk);
  }
  JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
}

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
  ][index % 8];
}

async function startFixtureProvider(initialDigest = DIGEST_A, { onInventory = null } = {}) {
  const requests = [];
  let digest = initialDigest;
  let chatIndex = 0;
  let inventoryIndex = 0;
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && requestUrl.pathname === '/api/tags') {
        inventoryIndex++;
        await onInventory?.(inventoryIndex);
        requests.push('GET /api/tags');
        sendJson(response, 200, {
          models: [{ name: MODEL_NAME, digest: `sha256:${digest}` }],
        });
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api/chat') {
        await consumeJson(request);
        requests.push('POST /api/chat');
        sendJson(response, 200, {
          message: { role: 'assistant', content: chatResponse(chatIndex++) },
          done: true,
          eval_count: 7,
          prompt_eval_count: 3,
        });
        return;
      }
      requests.push(`${request.method} ${requestUrl.pathname}`);
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
    setDigest(nextDigest) { digest = nextDigest; },
    close: async () => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    },
  };
}

async function prepareCandidate() {
  if (issuerModule) return issuerModule;
  const root = await mkdtemp(path.join(
    isolatedTestRuntime.artifacts,
    'proof-issuer-candidate-',
  ));
  await chmod(root, 0o700);
  candidateRoot = path.join(root, 'candidate');
  execFileSync('git', [
    'clone', '--local', '--no-hardlinks', '--quiet', REPOSITORY_ROOT, candidateRoot,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const relativePath of [PARENT_RELATIVE_PATH, ISSUER_RELATIVE_PATH]) {
    await copyFile(
      path.join(REPOSITORY_ROOT, relativePath),
      path.join(candidateRoot, relativePath),
    );
  }
  execFileSync('git', ['add', '--', PARENT_RELATIVE_PATH, ISSUER_RELATIVE_PATH], {
    cwd: candidateRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  execFileSync('git', [
    '-c', 'user.name=IntentSmith Test',
    '-c', 'user.email=intentsmith-test@invalid.local',
    'commit', '--allow-empty', '--quiet', '-m', 'fixture: exact proof issuer candidate',
  ], { cwd: candidateRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  issuerModule = await import(pathToFileURL(
    path.join(candidateRoot, ISSUER_RELATIVE_PATH),
  ).href);
  return issuerModule;
}

async function createMigratedDatabase(prefix) {
  const directory = await mkdtemp(path.join(isolatedTestRuntime.artifacts, `${prefix}-`));
  await chmod(directory, 0o700);
  const databasePath = path.join(directory, 'c3.sqlite');
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  await runMigrations(db);
  return { db, databasePath, directory };
}

function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function createTerminalNamespaceInterleave(database) {
  let databaseListChecks = 0;
  let rowsAtNamespaceCheck = null;
  let resolveMutation;
  let rejectMutation;
  const mutation = new Promise((resolve, reject) => {
    resolveMutation = resolve;
    rejectMutation = reject;
  });
  const facade = {
    get open() { return database.open; },
    get readonly() { return database.readonly; },
    get inTransaction() { return database.inTransaction; },
    prepare: (...args) => database.prepare(...args),
    exec: (...args) => database.exec(...args),
    pragma: (...args) => {
      const result = database.pragma(...args);
      if (args[0] === 'database_list' && ++databaseListChecks === 2) {
        rowsAtNamespaceCheck = count(database, 'main.model_failover_proofs');
        queueMicrotask(() => {
          try {
            const rowsAtMutation = count(database, 'main.model_failover_proofs');
            database.exec("ATTACH DATABASE ':memory:' AS late_fixture");
            resolveMutation(rowsAtMutation);
          } catch (error) {
            rejectMutation(error);
          }
        });
      }
      return result;
    },
  };
  return {
    facade,
    mutation,
    get rowsAtNamespaceCheck() { return rowsAtNamespaceCheck; },
  };
}

function seedDesiredBinding(database) {
  database.prepare(`
    INSERT INTO model_failover_events (
      event_id, event_type, role, binding_revision, actor, reason_code,
      policy_version, desired_model_name, desired_digest_sha256, created_at_ms
    ) VALUES ('proof-issuer-desired-event', 'DESIRED_OBSERVED', 'CHAT', 1,
      'user:proof-issuer-fixture', 'DESIRED_ARTIFACT_OBSERVED', 'd-plus-v1',
      ?, ?, 1000)
  `).run(MODEL_NAME, DIGEST_A);
  database.prepare(`
    INSERT INTO model_desired_bindings (
      role, model_name, canonical_name, digest_sha256, binding_revision,
      source, actor, observed_at_ms, updated_at_ms, last_event_id
    ) VALUES ('CHAT', ?, ?, ?, 1, 'LEGACY_OVERRIDE',
      'user:proof-issuer-fixture', 1000, 1000, 'proof-issuer-desired-event')
  `).run(MODEL_NAME, MODEL_NAME, DIGEST_A);
}

function bindingAuthoritySnapshot(database) {
  return JSON.stringify({
    desired: database.prepare(`
      SELECT * FROM model_desired_bindings ORDER BY role
    `).all(),
    events: database.prepare(`
      SELECT * FROM model_failover_events ORDER BY seq
    `).all(),
    state: database.prepare(`
      SELECT * FROM model_failover_state ORDER BY role
    `).all(),
  });
}

function assertOnlyExpectedProviderEffects(requests, runs = 1) {
  assertEqual(requests.filter(value => value === 'GET /api/tags').length, 4 * runs);
  assertEqual(requests.filter(value => value === 'POST /api/chat').length, 8 * runs);
  assertEqual(requests.length, 12 * runs);
}

async function withProviderOrigin(provider, callback) {
  const previous = process.env.OLLAMA_URL;
  process.env.OLLAMA_URL = provider.origin;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = previous;
  }
}

suite('M1 model failover proof issuer — durable evidence commit point');

await testAsync('issuer keeps its narrow input and both handoff plus live-policy rechecks', async () => {
  const source = await readFile(path.join(REPOSITORY_ROOT, ISSUER_RELATIVE_PATH), 'utf8');
  const inputBoundary = source.slice(
    source.indexOf('function requireInput(inputValue)'),
    source.indexOf('function parseCli(argv)'),
  );
  assert(inputBoundary.includes("['db', 'proposedModelName', 'role']"));
  for (const forbidden of [
    'acceptancePath',
    'artifactSha256',
    'issuedAtMs',
    'proofTtlMs',
    'target',
  ]) {
    assert(!inputBoundary.includes(forbidden), `Issuer input gained ${forbidden} authority`);
  }
  const issuance = source.slice(
    source.indexOf('export async function issueModelFailoverProof'),
    source.indexOf('function renderError(error)'),
  );
  assertEqual((issuance.match(/await handoff\.recheck\(\)/g) || []).length, 2);
  const livePolicy = source.slice(
    source.indexOf('function requireProjection(handoffResult, input)'),
    source.indexOf('function sameHandoff(left, right)'),
  );
  assert(livePolicy.includes('getModelFailoverMeasurementContract(input.role)'));
  assert(livePolicy.includes('assertModelFailoverProofIssuanceEnabled(input.role)'));
});

await testAsync('caller and database authority fail closed before provider effects', async () => {
  const issuer = await prepareCandidate();
  const provider = await startFixtureProvider();
  const migrated = await createMigratedDatabase('proof-issuer-authority');
  const memoryDb = new Database(':memory:');
  try {
    const cases = [
      ['caller path override', () => issuer.issueModelFailoverProof({
        db: migrated.db,
        role: 'CHAT',
        proposedModelName: MODEL_NAME,
        acceptancePath: '/tmp/caller-owned',
      }), 'MODEL_FAILOVER_PROOF_INPUT_INVALID'],
      ['caller hash authority', () => issuer.issueModelFailoverProof({
        db: migrated.db,
        role: 'CHAT',
        proposedModelName: MODEL_NAME,
        artifactSha256: DIGEST_A,
      }), 'MODEL_FAILOVER_PROOF_INPUT_INVALID'],
      ['caller time authority', () => issuer.issueModelFailoverProof({
        db: migrated.db,
        role: 'CHAT',
        proposedModelName: MODEL_NAME,
        issuedAtMs: Date.now(),
      }), 'MODEL_FAILOVER_PROOF_INPUT_INVALID'],
      ['caller TTL authority', () => issuer.issueModelFailoverProof({
        db: migrated.db,
        role: 'CHAT',
        proposedModelName: MODEL_NAME,
        proofTtlMs: 1,
      }), 'MODEL_FAILOVER_PROOF_INPUT_INVALID'],
      ['positional authority override', () => issuer.issueModelFailoverProof({
        db: migrated.db,
        role: 'CHAT',
        proposedModelName: MODEL_NAME,
      }, { expectedAuthority: {} }), 'MODEL_FAILOVER_PROOF_AUTHORITY_OVERRIDE_REJECTED'],
      ['memory database', () => issuer.issueModelFailoverProof({
        db: memoryDb,
        role: 'CHAT',
        proposedModelName: MODEL_NAME,
      }), 'MODEL_FAILOVER_PROOF_DATABASE_INVALID'],
      ['foreign keys disabled', async () => {
        migrated.db.pragma('foreign_keys = OFF');
        try {
          return await issuer.issueModelFailoverProof({
            db: migrated.db,
            role: 'CHAT',
            proposedModelName: MODEL_NAME,
          });
        } finally {
          migrated.db.pragma('foreign_keys = ON');
        }
      }, 'MODEL_FAILOVER_PROOF_FOREIGN_KEYS_REQUIRED'],
      ['nested transaction', async () => {
        migrated.db.exec('BEGIN IMMEDIATE');
        try {
          return await issuer.issueModelFailoverProof({
            db: migrated.db,
            role: 'CHAT',
            proposedModelName: MODEL_NAME,
          });
        } finally {
          if (migrated.db.inTransaction) migrated.db.exec('ROLLBACK');
        }
      }, 'MODEL_FAILOVER_PROOF_DATABASE_INVALID'],
      ['TEMP shadow namespace', async () => {
        migrated.db.exec('CREATE TEMP TABLE model_failover_proofs (proof_id TEXT)');
        try {
          return await issuer.issueModelFailoverProof({
            db: migrated.db,
            role: 'CHAT',
            proposedModelName: MODEL_NAME,
          });
        } finally {
          migrated.db.exec('DROP TABLE temp.model_failover_proofs');
        }
      }, 'MODEL_FAILOVER_PROOF_DATABASE_INVALID'],
      ['attached memory namespace', async () => {
        migrated.db.exec("ATTACH DATABASE ':memory:' AS foreign_fixture");
        try {
          return await issuer.issueModelFailoverProof({
            db: migrated.db,
            role: 'CHAT',
            proposedModelName: MODEL_NAME,
          });
        } finally {
          migrated.db.exec('DETACH DATABASE foreign_fixture');
        }
      }, 'MODEL_FAILOVER_PROOF_DATABASE_INVALID'],
    ];
    await withProviderOrigin(provider, async () => {
      for (const [label, operation, expectedCode] of cases) {
        const error = await captureRejection(operation);
        assertEqual(error.code, expectedCode, label);
      }
    });
    assertEqual(provider.requests.length, 0);
    assertEqual(count(migrated.db, 'model_failover_proof_artifacts'), 0);
    assertEqual(count(migrated.db, 'model_failover_proofs'), 0);
  } finally {
    memoryDb.close();
    migrated.db.close();
    await provider.close();
  }
});

await testAsync('one explicit action issues exact proof and a new digest gets a new proof', async () => {
  const issuer = await prepareCandidate();
  const provider = await startFixtureProvider(DIGEST_A);
  const migrated = await createMigratedDatabase('proof-issuer-happy');
  try {
    seedDesiredBinding(migrated.db);
    const bindingBefore = bindingAuthoritySnapshot(migrated.db);
    await withProviderOrigin(provider, async () => {
      const terminalInterleave = createTerminalNamespaceInterleave(migrated.db);
      const first = await issuer.issueModelFailoverProof({
        db: terminalInterleave.facade,
        role: 'CHAT',
        proposedModelName: MODEL_NAME,
      });
      assertEqual(
        terminalInterleave.rowsAtNamespaceCheck,
        0,
        'The terminal namespace check must happen before COMMIT',
      );
      assertEqual(
        await terminalInterleave.mutation,
        1,
        'No callback may interleave after the terminal namespace check and before COMMIT',
      );
      migrated.db.exec('DETACH DATABASE late_fixture');
      assertEqual(JSON.stringify(Object.keys(first).sort()), JSON.stringify([
        'expiresAtMs', 'proofId', 'status',
      ]));
      assertEqual(first.status, 'ISSUED');
      assert(first.proofId.startsWith('mfp-'));
      assert(!/(?:path|authority)/i.test(JSON.stringify(first)));

      provider.setDigest(DIGEST_B);
      const second = await issuer.issueModelFailoverProof({
        db: migrated.db,
        role: 'CHAT',
        proposedModelName: MODEL_NAME,
      });
      assertEqual(second.status, 'ISSUED');
      assert(first.proofId !== second.proofId, 'A changed digest must create a new proof');

      const proofRows = migrated.db.prepare(`
        SELECT proof_id, model_name, model_canonical_name, model_digest_sha256,
               result, expires_at_ms, created_at_ms
        FROM model_failover_proofs
        ORDER BY created_at_ms, proof_id
      `).all();
      const companionRows = migrated.db.prepare(`
        SELECT proof_id, source_revision, measurement_artifact_sha256,
               measurement_artifact_byte_length, acceptance_artifact_sha256,
               acceptance_artifact_byte_length, model_digest_sha256,
               acceptance_completed_at_ms, proof_ttl_ms, expires_at_ms, issued_at_ms
        FROM model_failover_proof_artifacts
        ORDER BY issued_at_ms, proof_id
      `).all();
      assertEqual(proofRows.length, 2);
      assertEqual(companionRows.length, 2);
      assertEqual(new Set(proofRows.map(row => row.model_digest_sha256)).size, 2);
      assert(proofRows.some(row => row.model_digest_sha256 === DIGEST_A));
      assert(proofRows.some(row => row.model_digest_sha256 === DIGEST_B));
      assert(proofRows.every(row => row.model_name === MODEL_NAME && row.result === 'PASS'));
      assert(companionRows.every(row => (
        row.expires_at_ms === row.acceptance_completed_at_ms + row.proof_ttl_ms
          && row.issued_at_ms < row.expires_at_ms
          && /^[a-f0-9]{40}$/.test(row.source_revision)
      )));
      const firstProof = proofRows.find(row => row.proof_id === first.proofId);
      const secondProof = proofRows.find(row => row.proof_id === second.proofId);
      assert(firstProof && secondProof, 'Both public proof IDs must resolve to durable rows');
      assertEqual(firstProof.model_digest_sha256, DIGEST_A);
      assertEqual(secondProof.model_digest_sha256, DIGEST_B);
      assertEqual(first.expiresAtMs, firstProof.expires_at_ms);
      assertEqual(second.expiresAtMs, secondProof.expires_at_ms);
      for (const proof of proofRows) {
        const companion = companionRows.find(row => row.proof_id === proof.proof_id);
        assert(companion, 'Every proof must have its exact evidence companion');
        assertEqual(proof.proof_id, `mfp-${companion.acceptance_artifact_sha256}`);
        assertEqual(companion.model_digest_sha256, proof.model_digest_sha256);
      }

      const store = path.join(
        `${migrated.databasePath}.artifacts`,
        'model-failover-proofs',
        'v1',
        'sha256',
      );
      const names = (await readdir(store)).sort();
      assertEqual(names.length, 4);
      for (const name of names) {
        assert(/^[a-f0-9]{64}\.json$/.test(name));
        const filePath = path.join(store, name);
        const [metadata, bytes] = await Promise.all([lstat(filePath), readFile(filePath)]);
        assertEqual(metadata.mode & 0o777, 0o400);
        assertEqual(metadata.nlink, 1);
        assertEqual(name, `${sha256(bytes)}.json`);
      }
      for (const companion of companionRows) {
        const measurementBytes = await readFile(path.join(
          store,
          `${companion.measurement_artifact_sha256}.json`,
        ));
        const acceptanceBytes = await readFile(path.join(
          store,
          `${companion.acceptance_artifact_sha256}.json`,
        ));
        assertEqual(measurementBytes.length, companion.measurement_artifact_byte_length);
        assertEqual(acceptanceBytes.length, companion.acceptance_artifact_byte_length);
      }
      assertEqual(bindingAuthoritySnapshot(migrated.db), bindingBefore);
    });
    assertOnlyExpectedProviderEffects(provider.requests, 2);
  } finally {
    migrated.db.close();
    await provider.close();
  }
});

await testAsync('connection authority drift after measurement blocks the ledger commit', async () => {
  const issuer = await prepareCandidate();
  const migrated = await createMigratedDatabase('proof-issuer-fk-drift');
  const provider = await startFixtureProvider(DIGEST_A, {
    onInventory: inventoryIndex => {
      if (inventoryIndex === 4) migrated.db.pragma('foreign_keys = OFF');
    },
  });
  try {
    const error = await withProviderOrigin(provider, () => captureRejection(() => (
      issuer.issueModelFailoverProof({
        db: migrated.db,
        role: 'CHAT',
        proposedModelName: MODEL_NAME,
      })
    )));
    assertEqual(error.code, 'MODEL_FAILOVER_PROOF_FOREIGN_KEYS_REQUIRED');
    assertEqual(count(migrated.db, 'model_failover_proof_artifacts'), 0);
    assertEqual(count(migrated.db, 'model_failover_proofs'), 0);
    assertOnlyExpectedProviderEffects(provider.requests);
  } finally {
    migrated.db.pragma('foreign_keys = ON');
    migrated.db.close();
    await provider.close();
  }
});

await testAsync('DB-derived store rejects a symlink and commits no ledger row', async () => {
  const issuer = await prepareCandidate();
  const provider = await startFixtureProvider();
  const migrated = await createMigratedDatabase('proof-issuer-symlink');
  const foreignDirectory = path.join(migrated.directory, 'foreign-store');
  await mkdir(foreignDirectory, { mode: 0o700 });
  await symlink(foreignDirectory, `${migrated.databasePath}.artifacts`);
  try {
    const error = await withProviderOrigin(provider, () => captureRejection(() => (
      issuer.issueModelFailoverProof({
        db: migrated.db,
        role: 'CHAT',
        proposedModelName: MODEL_NAME,
      })
    )));
    assertEqual(error.code, 'MODEL_FAILOVER_PROOF_STORE_INVALID');
    assertEqual(count(migrated.db, 'model_failover_proof_artifacts'), 0);
    assertEqual(count(migrated.db, 'model_failover_proofs'), 0);
    assertEqual((await readdir(foreignDirectory)).length, 0);
    assertOnlyExpectedProviderEffects(provider.requests);
  } finally {
    migrated.db.close();
    await provider.close();
  }
});

await testAsync('second insert failure rolls back both rows and preserves truthful orphan blobs', async () => {
  const issuer = await prepareCandidate();
  const provider = await startFixtureProvider();
  const migrated = await createMigratedDatabase('proof-issuer-rollback');
  migrated.db.exec(`
    CREATE TRIGGER proof_issuer_fixture_abort
    BEFORE INSERT ON model_failover_proofs
    BEGIN
      SELECT RAISE(ABORT, 'fixture proof insert failure');
    END;
  `);
  try {
    const error = await withProviderOrigin(provider, () => captureRejection(() => (
      issuer.issueModelFailoverProof({
        db: migrated.db,
        role: 'CHAT',
        proposedModelName: MODEL_NAME,
      })
    )));
    assertEqual(error.code, 'MODEL_FAILOVER_PROOF_DATABASE_COMMIT_FAILED');
    assertEqual(count(migrated.db, 'model_failover_proof_artifacts'), 0);
    assertEqual(count(migrated.db, 'model_failover_proofs'), 0);
    const store = path.join(
      `${migrated.databasePath}.artifacts`,
      'model-failover-proofs',
      'v1',
      'sha256',
    );
    const names = (await readdir(store)).sort();
    assertEqual(names.length, 2);
    for (const name of names) {
      const filePath = path.join(store, name);
      const [metadata, bytes] = await Promise.all([lstat(filePath), readFile(filePath)]);
      assertEqual(metadata.mode & 0o777, 0o400);
      assertEqual(metadata.nlink, 1);
      assertEqual(name, `${sha256(bytes)}.json`);
    }
    assertOnlyExpectedProviderEffects(provider.requests);

    migrated.db.exec('DROP TRIGGER proof_issuer_fixture_abort');
    const retry = await withProviderOrigin(provider, () => issuer.issueModelFailoverProof({
      db: migrated.db,
      role: 'CHAT',
      proposedModelName: MODEL_NAME,
    }));
    assertEqual(retry.status, 'ISSUED');
    assertEqual(count(migrated.db, 'model_failover_proof_artifacts'), 1);
    assertEqual(count(migrated.db, 'model_failover_proofs'), 1);
    assertOnlyExpectedProviderEffects(provider.requests, 2);
    assertEqual((await readdir(store)).length, 4);
  } finally {
    migrated.db.close();
    await provider.close();
  }
});

summary();
