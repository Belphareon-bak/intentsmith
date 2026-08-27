#!/usr/bin/env node

// M6 release evidence: install and run the exact 136.0.0 application, create
// durable user data, then boot the candidate against the same SQLite database.
// This is deliberately an application journey, not a migration/model unit test.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  lstatSync,
  rmSync,
} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import {
  M6_CURRENT_VERSION as CURRENT_VERSION,
  M6_CURRENT_VERSION_MIGRATION_COUNT as CURRENT_MIGRATION_COUNT,
  M6_PREVIOUS_VERSION as PREVIOUS_VERSION,
  M6_PREVIOUS_VERSION_MIGRATION_COUNT as PREVIOUS_MIGRATION_COUNT,
  M6_PREVIOUS_VERSION_SHA as PREVIOUS_SHA,
  M6_RUNTIME_EVIDENCE_MARKER,
  M6_UPGRADE_CANARY,
} from '../contracts/m6/runtime-evidence-v1.js';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import {
  assertLoopbackNetworkNamespace,
  reexecInLoopbackNetworkNamespace,
} from './helpers/m6-owned-runtime-probe.js';

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const START_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;
const ownedChildren = new Set();

function bounded(value, chunk, limit = 2_000_000) {
  return (value + String(chunk)).slice(-limit);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || SOURCE_ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs || 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout.trim();
}

function git(cwd, args) {
  return run('git', args, { cwd });
}

function safeEnvironment(runtime, portFile) {
  const env = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'TZ']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return {
    ...env,
    HOME: runtime.home,
    XDG_CONFIG_HOME: runtime.xdgConfig,
    XDG_CACHE_HOME: runtime.xdgCache,
    XDG_DATA_HOME: runtime.xdgData,
    XDG_STATE_HOME: runtime.xdgState,
    TMPDIR: runtime.temp,
    TMP: runtime.temp,
    TEMP: runtime.temp,
    npm_config_cache: runtime.npmCache,
    PUPPETEER_SKIP_DOWNLOAD: 'true',
    NODE_ENV: 'test',
    CI: '1',
    DOTENV_CONFIG_PATH: path.join(runtime.root, 'no-dotenv-file'),
    DOTENV_CONFIG_QUIET: 'true',
    C3_HOST: '127.0.0.1',
    C3_PORT: '0',
    C3_PORT_FILE: portFile,
    C3_DB_PATH: runtime.database,
    C3_PROJECTS_DIR: runtime.projects,
    INTENTSMITH_TEST_PROJECTS_DIR: runtime.projects,
    INTENTSMITH_TEST_ARTIFACT_DIR: runtime.artifacts,
    C3_CORS_ORIGINS: 'http://localhost:3000',
    C3_ENABLE_AGENTS: 'false',
    C3_ENABLE_EXPERTISES: 'false',
    C3_ENABLE_LIFECYCLE: 'false',
    C3_ENABLE_COMFYUI: 'false',
    C3_ENABLE_AUTONOMY: 'false',
    C3_ENABLE_SKILLS: 'false',
    C3_ENABLE_TELEMETRY: 'false',
    C3_ENABLE_ONLINE_DISCOVERY: 'false',
    C3_MODEL_UNIVERSE_ENABLED: 'false',
    C3_MODEL_RUNTIME_GUARD_ENABLED: 'false',
    C3_LIFECYCLE_AUTO_COMMIT: 'false',
    C3_UPDATE_REPO: '',
    C3_TRACE: '0',
    C3_LOG_LEVEL: 'warn',
    OLLAMA_URL: 'http://127.0.0.1:9',
  };
}

function makeRuntime() {
  const root = mkdtempSync(path.join(isolatedTestRuntime.temp, 'm6-upgrade-'));
  chmodSync(root, 0o700);
  const runtime = {
    root,
    home: path.join(root, 'home'),
    xdgConfig: path.join(root, 'xdg-config'),
    xdgCache: path.join(root, 'xdg-cache'),
    xdgData: path.join(root, 'xdg-data'),
    xdgState: path.join(root, 'xdg-state'),
    temp: path.join(root, 'tmp'),
    projects: path.join(root, 'projects'),
    artifacts: path.join(root, 'artifacts'),
    npmCache: isolatedTestRuntime.mode === 'direct'
      && process.env.INTENTSMITH_M6_UPGRADE_NPM_CACHE
      ? path.resolve(process.env.INTENTSMITH_M6_UPGRADE_NPM_CACHE)
      : isolatedTestRuntime.npmCache,
    database: path.join(root, 'upgrade.sqlite'),
    previousPortFile: path.join(root, 'previous.port'),
    currentPortFile: path.join(root, 'current.port'),
    previousClone: path.join(root, 'previous-source'),
  };
  for (const directory of [
    runtime.home,
    runtime.xdgConfig,
    runtime.xdgCache,
    runtime.xdgData,
    runtime.xdgState,
    runtime.temp,
    runtime.projects,
    runtime.artifacts,
  ]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  assert.ok(existsSync(runtime.npmCache), 'offline npm cache is unavailable');
  return runtime;
}

async function startServer(sourceRoot, runtime, portFile, label) {
  const nonce = `m6-upgrade-${label}-${randomBytes(12).toString('hex')}`;
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: sourceRoot,
    env: {
      ...safeEnvironment(runtime, portFile),
      INTENTSMITH_TEST_SERVER_NONCE: nonce,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ownedChildren.add(child);
  const state = {
    child,
    stdout: '',
    stderr: '',
    exitCode: null,
    signal: null,
    port: null,
    capability: null,
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { state.stdout = bounded(state.stdout, chunk); });
  child.stderr.on('data', chunk => { state.stderr = bounded(state.stderr, chunk); });
  child.once('exit', (code, signal) => {
    state.exitCode = code;
    state.signal = signal;
    ownedChildren.delete(child);
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (state.exitCode !== null || state.signal !== null) {
      throw new Error(`${label} server exited before ready: ${state.stderr.slice(-4_000)}`);
    }
    if (existsSync(portFile)) {
      try {
        const payload = JSON.parse(readFileSync(portFile, 'utf8'));
        if (
          payload.pid === child.pid
          && payload.testRunNonce === nonce
          && Number.isInteger(payload.port)
          && payload.port > 0
          && CAPABILITY_PATTERN.test(payload.localCapability || '')
        ) {
          state.port = payload.port;
          state.capability = payload.localCapability;
          return state;
        }
      } catch {
        // Atomic replacement can briefly expose no complete payload to a poller.
      }
    }
    await delay(25);
  }
  await stopServer(state);
  throw new Error(`${label} server readiness timeout`);
}

async function stopServer(state) {
  if (!state?.child || state.exitCode !== null || state.signal !== null) return;
  state.child.kill('SIGTERM');
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline && state.exitCode === null && state.signal === null) {
    await delay(25);
  }
  assert.notEqual(state.exitCode, null, `server ${state.child.pid} did not stop`);
  assert.equal(state.signal, null, `server stopped by ${state.signal}`);
  assert.equal(state.exitCode, 0, state.stderr.slice(-4_000));
}

function requestJson(server, method, pathname, body = null) {
  return new Promise((resolve, reject) => {
    const encoded = body === null ? null : JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1',
      port: server.port,
      path: pathname,
      method,
      headers: {
        'X-IntentSmith-Local-Capability': server.capability,
        ...(encoded === null ? {} : {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(encoded),
        }),
      },
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { raw = bounded(raw, chunk); });
      response.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* asserted by the caller */ }
        resolve({ statusCode: response.statusCode, json, raw });
      });
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('request timeout')));
    request.once('error', reject);
    if (encoded !== null) request.write(encoded);
    request.end();
  });
}

function migrationCount(databasePath) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count;
  } finally {
    database.close();
  }
}

function packageVersion(root) {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}

function databaseFileIdentity(databasePath) {
  const metadata = lstatSync(databasePath, { bigint: true });
  assert.equal(metadata.isFile(), true, 'upgrade database is not a regular file');
  return sha256(`m6-sqlite-file-v1\0${metadata.dev}\0${metadata.ino}`);
}

function projectMetadata(project, projectsRoot) {
  assert.equal(typeof project?.path, 'string', 'upgraded canary has no project path');
  const canonicalProjectsRoot = path.resolve(projectsRoot);
  const canonicalProjectPath = path.resolve(project.path);
  const relativeProjectPath = path.relative(canonicalProjectsRoot, canonicalProjectPath);
  assert.ok(
    relativeProjectPath !== ''
      && relativeProjectPath !== '..'
      && !relativeProjectPath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativeProjectPath),
    'upgraded canary escaped the owned projects root',
  );
  return JSON.parse(readFileSync(path.join(canonicalProjectPath, '.c3', 'project.json'), 'utf8'));
}

async function main() {
  const namespace = assertLoopbackNetworkNamespace();
  const candidateSha = git(SOURCE_ROOT, ['rev-parse', 'HEAD']);
  assert.match(candidateSha, SHA_PATTERN);
  if (process.env.INTENTSMITH_TEST_SOURCE_REVISION) {
    assert.equal(process.env.INTENTSMITH_TEST_SOURCE_REVISION, candidateSha);
  }
  assert.equal(packageVersion(SOURCE_ROOT), CURRENT_VERSION);

  const runtime = makeRuntime();
  let previousServer = null;
  let currentServer = null;
  try {
    run('git', [
      'clone',
      '--no-local',
      '--no-hardlinks',
      '--no-checkout',
      SOURCE_ROOT,
      runtime.previousClone,
    ], { cwd: runtime.root, timeoutMs: 120_000 });
    git(runtime.previousClone, ['checkout', '--detach', PREVIOUS_SHA]);
    assert.equal(git(runtime.previousClone, ['rev-parse', 'HEAD']), PREVIOUS_SHA);
    assert.equal(packageVersion(runtime.previousClone), PREVIOUS_VERSION);
    run('npm', ['ci', '--offline', '--no-audit', '--no-fund'], {
      cwd: runtime.previousClone,
      env: safeEnvironment(runtime, runtime.previousPortFile),
      timeoutMs: 900_000,
    });

    previousServer = await startServer(
      runtime.previousClone,
      runtime,
      runtime.previousPortFile,
      'previous',
    );
    const create = await requestJson(previousServer, 'POST', '/api/projects', {
      ...M6_UPGRADE_CANARY,
    });
    assert.equal(create.statusCode, 201, create.raw);
    assert.ok(Number.isSafeInteger(create.json?.id), create.raw);
    const canaryId = create.json.id;
    const beforeList = await requestJson(previousServer, 'GET', '/api/projects?status=all&limit=100');
    assert.equal(beforeList.statusCode, 200, beforeList.raw);
    assert.ok(beforeList.json.projects.some(project => project.id === canaryId));
    await stopServer(previousServer);
    previousServer = null;
    const previousMigrationCount = migrationCount(runtime.database);
    assert.equal(previousMigrationCount, PREVIOUS_MIGRATION_COUNT);
    const previousDatabaseFileIdentity = databaseFileIdentity(runtime.database);

    currentServer = await startServer(
      SOURCE_ROOT,
      runtime,
      runtime.currentPortFile,
      'candidate',
    );
    const afterList = await requestJson(currentServer, 'GET', '/api/projects?status=all&limit=100');
    assert.equal(afterList.statusCode, 200, afterList.raw);
    const upgradedCanary = afterList.json.projects.find(project => project.id === canaryId);
    assert.equal(upgradedCanary?.name, M6_UPGRADE_CANARY.name);
    assert.equal(upgradedCanary?.description, M6_UPGRADE_CANARY.description);
    const upgradedCanaryMetadata = projectMetadata(upgradedCanary, runtime.projects);
    assert.equal(upgradedCanaryMetadata.name, M6_UPGRADE_CANARY.name);
    assert.equal(upgradedCanaryMetadata.description, M6_UPGRADE_CANARY.description);
    assert.equal(upgradedCanaryMetadata.type, M6_UPGRADE_CANARY.type);
    await stopServer(currentServer);
    currentServer = null;
    const currentMigrationCount = migrationCount(runtime.database);
    assert.equal(currentMigrationCount, CURRENT_MIGRATION_COUNT);
    const currentDatabaseFileIdentity = databaseFileIdentity(runtime.database);
    assert.equal(
      currentDatabaseFileIdentity,
      previousDatabaseFileIdentity,
      'candidate did not upgrade the exact previous-version SQLite file',
    );

    const receipt = {
      contract: 'M6PreviousVersionUpgradeReceipt',
      version: 2,
      candidateSha,
      previousSha: PREVIOUS_SHA,
      previousVersion: PREVIOUS_VERSION,
      currentVersion: CURRENT_VERSION,
      databaseFileIdentitySha256: currentDatabaseFileIdentity,
      previousMigrationCount,
      currentMigrationCount,
      canary: {
        id: canaryId,
        name: upgradedCanary.name,
        description: upgradedCanaryMetadata.description,
        type: upgradedCanaryMetadata.type,
        survivedUpgrade: true,
      },
      previousServerCleanShutdown: true,
      currentServerCleanShutdown: true,
      networkScope: 'linux-user-network-namespace-loopback-only',
      namespaceInterfaces: [...namespace.interfaceNames],
      verdict: 'PASS',
    };
    process.stdout.write(
      `${M6_RUNTIME_EVIDENCE_MARKER}${Buffer.from(JSON.stringify(receipt)).toString('base64url')}\n`,
    );
  } finally {
    for (const server of [currentServer, previousServer]) {
      if (server) {
        try { await stopServer(server); } catch { /* preserve the original failure */ }
      }
    }
    for (const child of ownedChildren) {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }
    if (existsSync(runtime.root)) rmSync(runtime.root, { recursive: true, force: false });
  }
}

if (!(await reexecInLoopbackNetworkNamespace(import.meta.url))) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
