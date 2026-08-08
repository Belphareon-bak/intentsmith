#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFile,
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import {
  assert,
  assertEqual,
  assertIncludes,
  suite,
  summary,
  test,
  testAsync,
} from './harness.js';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import {
  ModelFailoverCandidateMeasurementError,
  parseModelFailoverMeasurementChildSummary,
  validateModelFailoverCandidateAcceptance,
  validateModelFailoverMeasurementChildResult,
} from '../scripts/run-model-failover-candidate-measurement.js';
import { canonicalizeModelFailoverContract } from '../src/upgrade/model-failover-proof-policy.js';

const REPOSITORY_ROOT = isolatedTestRuntime.repositoryRoot;
const PARENT_RELATIVE_PATH = 'scripts/run-model-failover-candidate-measurement.js';
const PARENT_PATH = path.join(REPOSITORY_ROOT, PARENT_RELATIVE_PATH);
const MODEL_NAME = 'fixture-model:latest';
const MODEL_DIGEST = '7'.repeat(64);
const CHILD_TIMEOUT_MS = 25_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const LONG_CREATIVE_RESPONSE = [
  'Robot Karel se v tiché kuchyni rozhodl naučit vařit polévku podle starého rodinného receptu a pečlivě si připravil zeleninu, koření i velký hrnec.',
  'Nejdřív mu mrkev padala na podlahu a cibuli krájel příliš pomalu, ale po každém pokusu upravil pohyb kovových prstů a zapisoval si, co fungovalo.',
  'Když se polévka začala vařit, Karel ochutnal výsledek elektronickým senzorem, přidal špetku soli a pozval všechny sousedy ke stolu.',
  'Od toho večera robot každý týden zkoušel nový recept, kuchyně voněla čerstvým jídlem a lidé se těšili, jaké překvapení pro ně zase připraví.',
].join(' ');

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to throw');
}

async function captureRejection(callback) {
  try {
    await callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to reject');
}

function assertParentError(error, expectedCode) {
  assert(
    error instanceof ModelFailoverCandidateMeasurementError,
    `Expected ModelFailoverCandidateMeasurementError, got ${error}`,
  );
  assertEqual(error.code, expectedCode);
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
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 1024 * 1024) throw new Error('Fixture request exceeded 1 MiB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
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
  ][index];
}

async function startFixtureProvider({
  duplicateCanonical = false,
  driftAtInventoryRequest = null,
  mutateSourceAtInventoryRequest = null,
  mutateExportAtInventoryRequest = null,
  mutatePrivateDirectoryAtInventoryRequest = null,
  mutatePrivateDirectoryTarget = null,
  sourceRoot = null,
} = {}) {
  const requests = [];
  let inventoryRequestCount = 0;
  let chatRequestCount = 0;
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && requestUrl.pathname === '/api/tags') {
        inventoryRequestCount++;
        requests.push({ route: 'GET /api/tags' });
        if (mutateSourceAtInventoryRequest === inventoryRequestCount) {
          await appendFile(path.join(sourceRoot, 'src/config.js'), '\n// tracked parent fixture drift\n');
        }
        if (mutateExportAtInventoryRequest === inventoryRequestCount) {
          const configPaths = await findNamedFiles(sourceRoot, 'config.js');
          const exportedConfig = configPaths.find(candidate => (
            candidate.includes(`${path.sep}model-failover-candidate-measurements${path.sep}`)
              && candidate.endsWith(`${path.sep}source${path.sep}src${path.sep}config.js`)
          ));
          assert(exportedConfig, 'Expected the exact-blob source export before mutation');
          await chmod(exportedConfig, 0o600);
          await appendFile(exportedConfig, '\n// exported source fixture drift\n');
          await chmod(exportedConfig, 0o400);
        }
        if (mutatePrivateDirectoryAtInventoryRequest === inventoryRequestCount) {
          const parentRoot = path.join(
            sourceRoot,
            '.intentsmith-artifacts/model-failover-candidate-measurements',
          );
          const parentNames = (await readdir(parentRoot))
            .filter(name => name.startsWith('parent-'));
          assertEqual(parentNames.length, 1);
          const runDirectory = path.join(parentRoot, parentNames[0]);
          const target = mutatePrivateDirectoryTarget === 'source'
            ? path.join(runDirectory, 'source')
            : mutatePrivateDirectoryTarget === 'artifactRoot'
              ? parentRoot
              : runDirectory;
          await chmod(target, 0o755);
        }
        const models = [{ name: MODEL_NAME, digest: `sha256:${MODEL_DIGEST}` }];
        if (duplicateCanonical) {
          models.push({ name: 'fixture-model', digest: `sha256:${'8'.repeat(64)}` });
        }
        if (driftAtInventoryRequest === inventoryRequestCount) {
          models.push({ name: 'inventory-drift:latest', digest: `sha256:${'9'.repeat(64)}` });
        }
        sendJson(response, 200, { models });
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api/chat') {
        const index = chatRequestCount++;
        await readJsonBody(request);
        requests.push({ route: 'POST /api/chat' });
        sendJson(response, 200, {
          message: { role: 'assistant', content: chatResponse(index) },
          done: true,
          eval_count: 7,
          prompt_eval_count: 3,
        });
        return;
      }
      requests.push({ route: `${request.method} ${requestUrl.pathname}` });
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

async function createCommittedCandidateClone(prefix) {
  const base = await mkdtemp(path.join(isolatedTestRuntime.artifacts, `${prefix}-`));
  await chmod(base, 0o700);
  const cloneRoot = path.join(base, 'candidate');
  execFileSync('git', [
    'clone',
    '--local',
    '--no-hardlinks',
    '--quiet',
    REPOSITORY_ROOT,
    cloneRoot,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  await copyFile(PARENT_PATH, path.join(cloneRoot, PARENT_RELATIVE_PATH));
  execFileSync('git', ['add', '--', PARENT_RELATIVE_PATH], {
    cwd: cloneRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  execFileSync('git', [
    '-c', 'user.name=IntentSmith Test',
    '-c', 'user.email=intentsmith-test@invalid.local',
    'commit', '--quiet', '-m', 'fixture: candidate parent source',
  ], { cwd: cloneRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  return cloneRoot;
}

function collectBounded(stream, child, label) {
  const chunks = [];
  let total = 0;
  let overflow = null;
  stream.on('data', chunk => {
    if (overflow) return;
    total += chunk.length;
    if (total > MAX_OUTPUT_BYTES) {
      overflow = new Error(`${label} exceeded ${MAX_OUTPUT_BYTES} bytes`);
      child.kill('SIGKILL');
      return;
    }
    chunks.push(Buffer.from(chunk));
  });
  return {
    value: () => Buffer.concat(chunks, total).toString('utf8'),
    overflow: () => overflow,
  };
}

async function runParentCli(sourceRoot, providerOrigin, {
  extraArgs = [],
  nodeArgs = [],
  nodeOptions = null,
  pathValue = process.env.PATH || '/usr/bin:/bin',
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      ...nodeArgs,
      path.join(sourceRoot, PARENT_RELATIVE_PATH),
      '--role', 'CHAT',
      '--proposed-model-name', MODEL_NAME,
      ...extraArgs,
    ], {
      cwd: sourceRoot,
      env: {
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        OLLAMA_URL: providerOrigin,
        PATH: pathValue,
        TZ: 'UTC',
        ...(nodeOptions === null ? {} : { NODE_OPTIONS: nodeOptions }),
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = collectBounded(child.stdout, child, 'parent stdout');
    const stderr = collectBounded(child.stderr, child, 'parent stderr');
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, CHILD_TIMEOUT_MS);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const outputError = stdout.overflow() || stderr.overflow();
      if (outputError) {
        reject(outputError);
        return;
      }
      if (timedOut) {
        reject(new Error(`Parent timed out after ${CHILD_TIMEOUT_MS}ms`));
        return;
      }
      resolve({ code, signal, stdout: stdout.value(), stderr: stderr.value() });
    });
  });
}

function parseOneLine(value) {
  assert(value.endsWith('\n'), `Expected LF-terminated output: ${value}`);
  const lines = value.slice(0, -1).split('\n');
  assertEqual(lines.length, 1);
  return JSON.parse(lines[0]);
}

async function findNamedFiles(root, name) {
  const found = [];
  const visit = async directory => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && entry.name === name) found.push(candidate);
    }
  };
  await visit(root);
  return found.sort();
}

let acceptedRun = null;
let acceptedReceipt = null;
let acceptedAuthority = null;

suite('M1 model failover candidate parent — derived measurement authority');

test('parent CLI accepts only role and proposed model while config owns provider', () => {
  const source = execFileSync(process.execPath, ['-e', `
    import { readFileSync } from 'node:fs';
    const source = readFileSync(${JSON.stringify(PARENT_PATH)}, 'utf8');
    process.stdout.write(source);
  `], { encoding: 'utf8' });
  assertIncludes(source, "path.join(sourceRoot, 'src/config.js')");
  assertIncludes(source, "'--proposed-model-name': 'proposedModelName'");
  assertIncludes(source, "const GIT_BINARY = '/usr/bin/git'");
  const parentCliFields = source.slice(
    source.indexOf('const CLI_FIELDS'),
    source.indexOf('const CANDIDATE_SOURCE_PATHS'),
  );
  assert(!parentCliFields.includes('digest'), 'Parent CLI must not accept a digest');
  assert(!parentCliFields.includes('provider'), 'Parent CLI must not accept provider authority');
  assertIncludes(source, "'--untracked-files=all'");
  assertIncludes(source, "'src',");
  assertIncludes(source, "'scripts',");
  assertIncludes(source, "'tests',");
  assertIncludes(source, "'package.json',");
  assertIncludes(source, "'--ignored=matching'");
  assertIncludes(source, 'scripts/run-model-failover-candidate-measurement.js');
  assertIncludes(source, 'expectedAcceptanceAuthority');
  assertIncludes(source, 'await validateModelFailoverCandidateAcceptance(');
  const childSpawn = source.slice(
    source.indexOf('const childResult = await spawnMeasurementChild'),
    source.indexOf('const expectedPins = Object.freeze'),
  );
  assertIncludes(childSpawn, 'sourceRoot: run.sourceExportRoot');
  const publication = source.slice(
    source.indexOf('const published = await writeImmutableAcceptance'),
    source.indexOf('return Object.freeze({', source.indexOf('const published =')),
  );
  assertIncludes(publication, 'requireCleanCandidateState(sourceState(sourceRoot)');
  assertIncludes(publication, 'await validateParentRunBoundary(sourceRoot, run)');
  assertIncludes(publication, 'await validateCandidateSourceExport(run.sourceExportRoot');
  const acceptanceWriter = source.slice(
    source.indexOf('async function writeImmutableAcceptance'),
    source.indexOf('export async function runModelFailoverCandidateMeasurement'),
  );
  const commitPointCheck = acceptanceWriter.indexOf('await beforePublish();');
  const hardLinkCommit = acceptanceWriter.indexOf('await link(temporaryPath, finalPath);');
  assert(
    commitPointCheck >= 0 && hardLinkCommit > commitPointCheck,
    'Commit-point validation must complete before the receipt hard-link publication',
  );
  assert(
    source.indexOf('requireCleanCandidateState(beforeSource)')
      < source.indexOf('await loadParentAuthorities(run.sourceExportRoot)'),
    'Product authorities must load only after candidate cleanliness is accepted',
  );
});

test('child summary parser rejects every non-authoritative process outcome', () => {
  const summary = {
    schemaVersion: 1,
    measurementStatus: 'COMPLETE',
    proofStatus: 'NOT_ISSUED',
    runId: '12345678-1234-4123-8123-123456789abc',
    artifactPath: '/owned/measurement.json',
    artifactSha256: 'a'.repeat(64),
    artifactByteLength: 42,
  };
  const valid = {
    code: 0,
    signal: null,
    stdoutBytes: Buffer.from(`${JSON.stringify(summary)}\n`),
    stderrBytes: Buffer.alloc(0),
  };
  assertEqual(parseModelFailoverMeasurementChildSummary(valid).runId, summary.runId);
  const mutations = [
    ['non-zero exit', current => { current.code = 1; }],
    ['signal', current => { current.signal = 'SIGKILL'; }],
    ['stderr', current => { current.stderrBytes = Buffer.from('warning\n'); }],
    ['extra stdout', current => { current.stdoutBytes = Buffer.from(`${JSON.stringify(summary)}\n{}\n`); }],
    ['missing newline', current => { current.stdoutBytes = Buffer.from(JSON.stringify(summary)); }],
    ['invalid UTF-8', current => { current.stdoutBytes = Buffer.from([0xc3]); }],
    ['unknown summary field', current => {
      current.stdoutBytes = Buffer.from(`${JSON.stringify({ ...summary, accepted: true })}\n`);
    }],
  ];
  for (const [label, mutate] of mutations) {
    const current = {
      ...valid,
      stdoutBytes: Buffer.from(valid.stdoutBytes),
      stderrBytes: Buffer.from(valid.stderrBytes),
    };
    mutate(current);
    const error = captureError(() => parseModelFailoverMeasurementChildSummary(current));
    assert(error instanceof ModelFailoverCandidateMeasurementError, label);
  }
});

await testAsync('CLI rejects caller-supplied authority and inherited Node hooks before effects', async () => {
  const sourceRoot = await createCommittedCandidateClone('candidate-parent-cli-authority');
  const provider = await startFixtureProvider();
  try {
    const cases = [
      ['provider authority', { extraArgs: ['--provider-origin', provider.origin] }],
      ['digest authority', { extraArgs: ['--digest-sha256', MODEL_DIGEST] }],
      ['NODE_OPTIONS hooks', { nodeOptions: '--trace-warnings' }],
      ['direct Node flags', { nodeArgs: ['--trace-warnings'] }],
    ];
    for (const [label, options] of cases) {
      const result = await runParentCli(sourceRoot, provider.origin, options);
      assertEqual(result.code, 1, label);
      assertEqual(result.stdout, '', label);
      const failure = parseOneLine(result.stderr);
      assertEqual(
        failure.code,
        label === 'NODE_OPTIONS hooks' || label === 'direct Node flags'
          ? 'MODEL_CANDIDATE_MEASUREMENT_PARENT_RUNTIME_INVALID'
          : 'MODEL_CANDIDATE_MEASUREMENT_INPUT_INVALID',
        label,
      );
    }
    assertEqual(provider.requests.length, 0);
    assertEqual((await findNamedFiles(sourceRoot, 'acceptance.json')).length, 0);
    assertEqual((await findNamedFiles(sourceRoot, 'measurement.json')).length, 0);
  } finally {
    await provider.close();
  }
});

await testAsync('clean committed parent derives all five pins and emits immutable NOT_ISSUED receipt', async () => {
  const sourceRoot = await createCommittedCandidateClone('candidate-parent-pass');
  await writeFile(
    path.join(sourceRoot, 'docs/review/untracked-review-fixture.md'),
    'untracked review work must not affect the tracked source candidate\n',
  );
  const fakeBin = path.join(sourceRoot, 'fake-bin');
  const fakeGitSentinel = path.join(fakeBin, 'fake-git-was-executed');
  await mkdir(fakeBin, { mode: 0o700 });
  const fakeGit = path.join(fakeBin, 'git');
  await writeFile(fakeGit, [
    '#!/usr/bin/node',
    `require('node:fs').writeFileSync(${JSON.stringify(fakeGitSentinel)}, 'spoofed\\n');`,
    "process.stdout.write('spoofed\\n');",
    '',
  ].join('\n'));
  await chmod(fakeGit, 0o700);
  const provider = await startFixtureProvider();
  try {
    const result = await runParentCli(sourceRoot, provider.origin, {
      pathValue: `${fakeBin}:${process.env.PATH || '/usr/bin:/bin'}`,
    });
    assertEqual(result.code, 0);
    assertEqual(result.signal, null);
    assertEqual(result.stderr, '');
    const processSummary = parseOneLine(result.stdout);
    assertEqual(processSummary.acceptanceStatus, 'PARENT_PINS_VERIFIED');
    assertEqual(processSummary.measurementStatus, 'COMPLETE');
    assertEqual(processSummary.proofStatus, 'NOT_ISSUED');

    const acceptanceBytes = await readFile(processSummary.acceptancePath);
    const acceptanceText = new TextDecoder('utf-8', { fatal: true }).decode(acceptanceBytes);
    const acceptance = JSON.parse(acceptanceText);
    const receiptStructure = await validateModelFailoverCandidateAcceptance(acceptance);
    assertEqual(receiptStructure.valid, true);
    assertEqual(receiptStructure.validationScope, 'STRUCTURAL_ONLY');
    assertEqual(acceptanceText, canonicalizeModelFailoverContract(acceptance));
    assertEqual(acceptance.source.cleanBefore, true);
    assertEqual(acceptance.source.cleanAfter, true);
    assertEqual(acceptance.provider.origin, provider.origin);
    assertEqual(acceptance.candidate.digestSha256, MODEL_DIGEST);
    assertEqual(acceptance.measurement.validationScope, 'PARENT_PINS_VERIFIED');
    assertEqual(acceptance.effectBoundary.databaseWrites, 0);
    assertEqual(acceptance.effectBoundary.bindingWrites, 0);
    assertEqual(acceptance.effectBoundary.runtimeConfigWrites, 0);
    assertEqual(acceptance.effectBoundary.proofIssued, false);

    const acceptanceMetadata = await lstat(processSummary.acceptancePath);
    assertEqual(acceptanceMetadata.mode & 0o777, 0o400);
    assertEqual(acceptanceMetadata.nlink, 1);
    assertEqual(processSummary.acceptanceByteLength, acceptanceBytes.length);
    assertEqual(
      processSummary.acceptanceSha256,
      createHash('sha256').update(acceptanceBytes).digest('hex'),
    );
    assertEqual(
      processSummary.measurementArtifactSha256,
      acceptance.measurement.artifactSha256,
    );

    const artifactPath = path.join(sourceRoot, ...acceptance.measurement.artifactPath.split('/'));
    const artifactMetadata = await lstat(artifactPath);
    assertEqual(artifactMetadata.mode & 0o777, 0o400);
    assertEqual(artifactMetadata.nlink, 1);
    assertEqual(provider.requests.filter(entry => entry.route === 'GET /api/tags').length, 4);
    assertEqual(provider.requests.filter(entry => entry.route === 'POST /api/chat').length, 8);
    const fakeGitError = await captureRejection(() => lstat(fakeGitSentinel));
    assertEqual(fakeGitError.code, 'ENOENT');

    const childArtifactRoot = path.dirname(path.dirname(artifactPath));
    const childSummary = {
      schemaVersion: 1,
      measurementStatus: 'COMPLETE',
      proofStatus: 'NOT_ISSUED',
      runId: acceptance.measurement.runId,
      artifactPath,
      artifactSha256: acceptance.measurement.artifactSha256,
      artifactByteLength: acceptance.measurement.artifactByteLength,
    };
    acceptedRun = {
      sourceRoot,
      childArtifactRoot,
      artifactPath,
      result: {
        code: 0,
        signal: null,
        stdoutBytes: Buffer.from(`${JSON.stringify(childSummary)}\n`),
        stderrBytes: Buffer.alloc(0),
      },
      expectedPins: {
        role: acceptance.candidate.role,
        modelName: acceptance.candidate.requestedModelName,
        digestSha256: acceptance.candidate.digestSha256,
        providerOrigin: acceptance.provider.origin,
        sourceRevisionClaim: acceptance.source.revision,
      },
      expectedInventory: acceptance.provider.inventoryBefore,
      originalBytes: await readFile(artifactPath),
    };
    acceptedReceipt = acceptance;
    acceptedAuthority = {
      parentRunId: acceptance.parentRunId,
      sourceRevision: acceptance.source.revision,
      providerOrigin: acceptance.provider.origin,
      inventory: acceptance.provider.inventoryBefore,
      candidate: {
        role: acceptance.candidate.role,
        requestedModelName: acceptance.candidate.requestedModelName,
        observedModelName: acceptance.candidate.observedModelName,
        digestSha256: acceptance.candidate.digestSha256,
      },
      measurement: {
        runId: acceptance.measurement.runId,
        artifactPath: acceptance.measurement.artifactPath,
        artifactSha256: acceptance.measurement.artifactSha256,
        artifactByteLength: acceptance.measurement.artifactByteLength,
      },
    };
    const parentValidation = await validateModelFailoverCandidateAcceptance(
      acceptance,
      null,
      acceptedAuthority,
    );
    assertEqual(parentValidation.validationScope, 'PARENT_PINS_VERIFIED');
  } finally {
    await provider.close();
  }
});

await testAsync('acceptance validator rejects forged status, pins, paths and effects', async () => {
  assert(acceptedReceipt, 'Positive acceptance fixture must run first');
  const mutations = [
    ['proof status', receipt => { receipt.proofStatus = 'PASS'; }],
    ['source cleanliness', receipt => { receipt.source.cleanAfter = false; }],
    ['inventory digest', receipt => { receipt.provider.inventoryBefore.sha256 = 'a'.repeat(64); }],
    ['candidate digest', receipt => { receipt.candidate.digestSha256 = 'b'.repeat(64); }],
    ['validation scope', receipt => { receipt.measurement.validationScope = 'SELF_ASSERTED'; }],
    ['artifact path escape', receipt => { receipt.measurement.artifactPath = '../../measurement.json'; }],
    ['database effect', receipt => { receipt.effectBoundary.databaseWrites = 1; }],
    ['timing', receipt => { receipt.durationMs += 1; }],
    ['unknown field', receipt => { receipt.accepted = true; }],
  ];
  for (const [label, mutate] of mutations) {
    const receipt = JSON.parse(JSON.stringify(acceptedReceipt));
    mutate(receipt);
    const error = await captureRejection(() => validateModelFailoverCandidateAcceptance(receipt));
    assert(error instanceof ModelFailoverCandidateMeasurementError, label);
  }
});

await testAsync('self-consistent receipt forgery remains structural without trusted parent pins', async () => {
  assert(acceptedReceipt && acceptedAuthority, 'Positive acceptance fixture must run first');
  const receipt = JSON.parse(JSON.stringify(acceptedReceipt));
  receipt.source.revision = 'a'.repeat(40);
  receipt.candidate.digestSha256 = 'b'.repeat(64);
  receipt.provider.inventoryBefore.models[0].digestSha256 = receipt.candidate.digestSha256;
  receipt.provider.inventoryAfter.models[0].digestSha256 = receipt.candidate.digestSha256;
  for (const inventory of [receipt.provider.inventoryBefore, receipt.provider.inventoryAfter]) {
    inventory.sha256 = createHash('sha256')
      .update(canonicalizeModelFailoverContract(inventory.models))
      .digest('hex');
  }
  receipt.measurement.artifactSha256 = 'c'.repeat(64);
  const structural = await validateModelFailoverCandidateAcceptance(receipt);
  assertEqual(structural.validationScope, 'STRUCTURAL_ONLY');
  const error = await captureRejection(() => validateModelFailoverCandidateAcceptance(
    receipt,
    null,
    acceptedAuthority,
  ));
  assertParentError(error, 'MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_AUTHORITY_MISMATCH');
});

await testAsync('parent artifact acceptance rejects mode drift, byte drift and a second artifact', async () => {
  assert(acceptedRun, 'Positive parent fixture must run first');
  const validate = () => validateModelFailoverMeasurementChildResult({
    sourceRoot: acceptedRun.sourceRoot,
    childArtifactRoot: acceptedRun.childArtifactRoot,
    result: acceptedRun.result,
    expectedPins: acceptedRun.expectedPins,
    expectedInventory: acceptedRun.expectedInventory,
  });
  assertEqual((await validate()).validation.validationScope, 'PARENT_PINS_VERIFIED');

  await chmod(acceptedRun.artifactPath, 0o600);
  let error = await captureRejection(validate);
  assertParentError(error, 'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_METADATA_INVALID');
  await chmod(acceptedRun.artifactPath, 0o400);

  await chmod(acceptedRun.artifactPath, 0o600);
  await writeFile(acceptedRun.artifactPath, Buffer.concat([acceptedRun.originalBytes, Buffer.from(' ')]));
  await chmod(acceptedRun.artifactPath, 0o400);
  error = await captureRejection(validate);
  assertParentError(error, 'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_DIGEST_INVALID');
  await chmod(acceptedRun.artifactPath, 0o600);
  await writeFile(acceptedRun.artifactPath, acceptedRun.originalBytes);
  await chmod(acceptedRun.artifactPath, 0o400);

  const extraDirectory = path.join(acceptedRun.childArtifactRoot, 'extra-run');
  await mkdir(extraDirectory, { mode: 0o700 });
  const extraPath = path.join(extraDirectory, 'measurement.json');
  await writeFile(extraPath, '{}', { mode: 0o400 });
  error = await captureRejection(validate);
  assertParentError(error, 'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_COUNT_INVALID');
  await unlink(extraPath);

  const hardLinkPath = path.join(acceptedRun.childArtifactRoot, 'measurement-hardlink.json');
  await link(acceptedRun.artifactPath, hardLinkPath);
  error = await captureRejection(validate);
  assertParentError(error, 'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_METADATA_INVALID');
  await unlink(hardLinkPath);

  const symlinkPath = path.join(acceptedRun.childArtifactRoot, 'artifact-symlink');
  await symlink(acceptedRun.artifactPath, symlinkPath);
  error = await captureRejection(validate);
  assertParentError(error, 'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID');
  await unlink(symlinkPath);

  await chmod(acceptedRun.childArtifactRoot, 0o755);
  error = await captureRejection(validate);
  assertParentError(error, 'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID');
  await chmod(acceptedRun.childArtifactRoot, 0o700);

  const childRunDirectory = path.dirname(acceptedRun.artifactPath);
  await chmod(childRunDirectory, 0o755);
  error = await captureRejection(validate);
  assertParentError(error, 'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID');
  await chmod(childRunDirectory, 0o700);

  const mismatchedInventory = JSON.parse(JSON.stringify(acceptedRun.expectedInventory));
  mismatchedInventory.sha256 = 'f'.repeat(64);
  error = await captureRejection(() => validateModelFailoverMeasurementChildResult({
    sourceRoot: acceptedRun.sourceRoot,
    childArtifactRoot: acceptedRun.childArtifactRoot,
    result: acceptedRun.result,
    expectedPins: acceptedRun.expectedPins,
    expectedInventory: mismatchedInventory,
  }));
  assertParentError(error, 'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_INVALID');
});

await testAsync('tracked candidate drift fails before provider or artifact effects', async () => {
  const sourceRoot = await createCommittedCandidateClone('candidate-parent-dirty');
  await appendFile(path.join(sourceRoot, 'package.json'), '\n');
  const provider = await startFixtureProvider();
  try {
    const result = await runParentCli(sourceRoot, provider.origin);
    assertEqual(result.code, 1);
    assertEqual(result.stdout, '');
    const failure = parseOneLine(result.stderr);
    assertEqual(failure.code, 'MODEL_CANDIDATE_MEASUREMENT_SOURCE_DIRTY');
    assertEqual(provider.requests.length, 0);
    assertEqual((await findNamedFiles(sourceRoot, 'acceptance.json')).length, 0);
    assertEqual((await findNamedFiles(sourceRoot, 'measurement.json')).length, 0);
  } finally {
    await provider.close();
  }
});

await testAsync('staged candidate drift fails before provider or artifact effects', async () => {
  const sourceRoot = await createCommittedCandidateClone('candidate-parent-staged');
  await appendFile(path.join(sourceRoot, 'tests/harness.js'), '\n// staged preflight drift\n');
  execFileSync('git', ['add', '--', 'tests/harness.js'], {
    cwd: sourceRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const provider = await startFixtureProvider();
  try {
    const result = await runParentCli(sourceRoot, provider.origin);
    assertEqual(result.code, 1);
    assertEqual(result.stdout, '');
    const failure = parseOneLine(result.stderr);
    assertEqual(failure.code, 'MODEL_CANDIDATE_MEASUREMENT_SOURCE_DIRTY');
    assertEqual(provider.requests.length, 0);
    assertEqual((await findNamedFiles(sourceRoot, 'acceptance.json')).length, 0);
    assertEqual((await findNamedFiles(sourceRoot, 'measurement.json')).length, 0);
  } finally {
    await provider.close();
  }
});

await testAsync('untracked runtime source fails while untracked docs remain outside the candidate', async () => {
  const sourceRoot = await createCommittedCandidateClone('candidate-parent-untracked-source');
  const provider = await startFixtureProvider();
  try {
    const fixtures = [
      ['untracked migration', 'src/db/migrations/2099_01_01_999_untracked_fixture.js'],
      ['untracked script', 'scripts/untracked-measurement-fixture.js'],
      ['untracked test', 'tests/untracked-measurement-fixture.test.js'],
      ['ignored runtime file', 'src/untracked-measurement-fixture.tmp'],
    ];
    for (const [label, relativePath] of fixtures) {
      const fixturePath = path.join(sourceRoot, ...relativePath.split('/'));
      await mkdir(path.dirname(fixturePath), { recursive: true });
      await writeFile(fixturePath, `throw new Error(${JSON.stringify(label)});\n`);
      const result = await runParentCli(sourceRoot, provider.origin);
      assertEqual(result.code, 1, label);
      assertEqual(result.stdout, '', label);
      const failure = parseOneLine(result.stderr);
      assertEqual(failure.code, 'MODEL_CANDIDATE_MEASUREMENT_SOURCE_DIRTY', label);
      await unlink(fixturePath);
    }
    assertEqual(provider.requests.length, 0);
    assertEqual((await findNamedFiles(sourceRoot, 'acceptance.json')).length, 0);
    assertEqual((await findNamedFiles(sourceRoot, 'measurement.json')).length, 0);
  } finally {
    await provider.close();
  }
});

await testAsync('ambiguous canonical inventory is rejected before child execution', async () => {
  const sourceRoot = await createCommittedCandidateClone('candidate-parent-ambiguous');
  const provider = await startFixtureProvider({ duplicateCanonical: true });
  try {
    const result = await runParentCli(sourceRoot, provider.origin);
    assertEqual(result.code, 1);
    const failure = parseOneLine(result.stderr);
    assertEqual(failure.code, 'MODEL_CANDIDATE_MEASUREMENT_CANDIDATE_AMBIGUOUS');
    assertEqual(provider.requests.length, 1);
    assertEqual((await findNamedFiles(sourceRoot, 'measurement.json')).length, 0);
  } finally {
    await provider.close();
  }
});

await testAsync('parent postflight rejects provider inventory drift without an acceptance receipt', async () => {
  const sourceRoot = await createCommittedCandidateClone('candidate-parent-inventory-drift');
  const provider = await startFixtureProvider({ driftAtInventoryRequest: 4 });
  try {
    const result = await runParentCli(sourceRoot, provider.origin);
    assertEqual(result.code, 1);
    const failure = parseOneLine(result.stderr);
    assertEqual(failure.code, 'MODEL_CANDIDATE_MEASUREMENT_INVENTORY_DRIFT');
    assertEqual((await findNamedFiles(sourceRoot, 'measurement.json')).length, 1);
    assertEqual((await findNamedFiles(sourceRoot, 'acceptance.json')).length, 0);
  } finally {
    await provider.close();
  }
});

await testAsync('parent postflight rejects tracked mutation performed during the child run', async () => {
  const sourceRoot = await createCommittedCandidateClone('candidate-parent-source-drift');
  const provider = await startFixtureProvider({
    mutateSourceAtInventoryRequest: 4,
    sourceRoot,
  });
  try {
    const result = await runParentCli(sourceRoot, provider.origin);
    assertEqual(result.code, 1);
    const failure = parseOneLine(result.stderr);
    assertEqual(failure.code, 'MODEL_CANDIDATE_MEASUREMENT_SOURCE_DIRTY');
    assertEqual((await findNamedFiles(sourceRoot, 'measurement.json')).length, 1);
    assertEqual((await findNamedFiles(sourceRoot, 'acceptance.json')).length, 0);
  } finally {
    await provider.close();
  }
});

await testAsync('parent postflight rejects drift in the exact-blob execution export', async () => {
  const sourceRoot = await createCommittedCandidateClone('candidate-parent-export-drift');
  const provider = await startFixtureProvider({
    mutateExportAtInventoryRequest: 4,
    sourceRoot,
  });
  try {
    const result = await runParentCli(sourceRoot, provider.origin);
    assertEqual(result.code, 1);
    const failure = parseOneLine(result.stderr);
    assertEqual(failure.code, 'MODEL_CANDIDATE_MEASUREMENT_SOURCE_EXPORT_INVALID');
    assertEqual((await findNamedFiles(sourceRoot, 'measurement.json')).length, 1);
    assertEqual((await findNamedFiles(sourceRoot, 'acceptance.json')).length, 0);
  } finally {
    await provider.close();
  }
});

await testAsync('parent postflight rejects private run and source-export directory drift', async () => {
  for (const target of ['artifactRoot', 'run', 'source']) {
    const sourceRoot = await createCommittedCandidateClone(`candidate-parent-${target}-mode-drift`);
    const provider = await startFixtureProvider({
      mutatePrivateDirectoryAtInventoryRequest: 4,
      mutatePrivateDirectoryTarget: target,
      sourceRoot,
    });
    try {
      const result = await runParentCli(sourceRoot, provider.origin);
      assertEqual(result.code, 1, target);
      const failure = parseOneLine(result.stderr);
      assertEqual(
        failure.code,
        'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID',
        target,
      );
      assertEqual((await findNamedFiles(sourceRoot, 'acceptance.json')).length, 0, target);
    } finally {
      await provider.close();
    }
  }
});

summary();
