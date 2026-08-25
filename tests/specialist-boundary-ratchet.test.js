// M3 L0-8 specialist boundary — shared CI/runtime enforcement.

import './helpers/isolated-test-db.js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

import {
  scanSpecialistPackage,
} from '../src/specialists/specialist-boundary.js';
import { SpecialistLoader } from '../src/specialists/specialist-loader.js';
import * as codeReviewer from '../specialists/code-reviewer/index.js';
import {
  assert,
  assertEqual,
  suite,
  summary,
  test,
  testAsync,
} from './harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = path.join(ROOT, 'scripts', 'specialist-boundary-ratchet.mjs');
const ENGINE_VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
).version;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m3-boundary-'));

function write(relativePath, contents) {
  const destination = path.join(scratch, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
  return destination;
}

function manifest(id, additions = {}) {
  return {
    id,
    version: '1.0.0',
    name: `Fixture ${id}`,
    domain: 'test',
    type: 'utility',
    engine: '>=1.0.0',
    entry: './index.js',
    tools: [],
    expertises: [id],
    knowledge_packs: [],
    migrations: [],
    enabledByDefault: true,
    ...additions,
  };
}

function createPackage(id, files, manifestAdditions = {}) {
  const packageDir = path.join(scratch, id);
  write(`${id}/specialist.json`, `${JSON.stringify(manifest(id, manifestAdditions), null, 2)}\n`);
  for (const [relativePath, contents] of Object.entries(files)) {
    write(`${id}/${relativePath}`, contents);
  }
  return packageDir;
}

function runChecker(specialistsDir, extraArgs = []) {
  return spawnSync(process.execPath, [
    CHECKER,
    '--root', ROOT,
    '--specialists-dir', specialistsDir,
    ...extraArgs,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, C3_LOG_LEVEL: 'error' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE specialists (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      installed_at TEXT DEFAULT (datetime('now')),
      enabled_at TEXT,
      disabled_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE specialist_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      specialist_id TEXT NOT NULL,
      migration_name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now')),
      UNIQUE(specialist_id, migration_name)
    );
  `);
  return db;
}

function createRuntime() {
  const registrations = new Map();
  return {
    registerSpecialist(value) { registrations.set(value.id, value); },
    unregisterSpecialist(id) { registrations.delete(id); },
    isSpecialist(id) { return registrations.has(id); },
    getSpecialistIds() { return [...registrations.keys()]; },
    registrations,
  };
}

suite('M3 specialist boundary ratchet');

test('current tree scans every package and keeps JSDoc references informational', () => {
  const result = runChecker(path.join(ROOT, 'specialists'), ['--json']);
  assertEqual(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assertEqual(report.ok, true);
  assertEqual(report.packages, 5);
  assertEqual(report.violations.length, 0);
  assertEqual(report.errors.length, 0);
  assertEqual(report.typeReferences.length, 3);
  assertEqual(report.computedImports.length, 0);
  assert(report.scannedFiles > report.packages, 'scanner must inspect files beyond package entry points');
});

test('transitive non-entry import into src is an exact failing edge', () => {
  const coreUrl = pathToFileURL(path.join(ROOT, 'src', 'core', 'logger.js')).href;
  const packageDir = createPackage('transitive', {
    'index.js': "import './nested.js'; export function register() {}\n",
    'nested.js': `import '${coreUrl}';\n`,
  });
  const result = scanSpecialistPackage(packageDir, { projectRoot: ROOT });
  assertEqual(result.ok, false);
  assertEqual(result.violations.length, 1);
  assert(result.violations[0].file.endsWith('transitive/nested.js'));
  assertEqual(result.violations[0].kind, 'import');
  assertEqual(result.violations[0].specifier, coreUrl);
});

test('import, re-export, require and literal dynamic import are all executable edges', () => {
  const coreUrl = pathToFileURL(path.join(ROOT, 'src', 'core', 'logger.js')).href;
  const packageDir = createPackage('forms', {
    'index.js': [
      `import '${coreUrl}';`,
      `export { logger } from '${coreUrl}';`,
      `require('${coreUrl}');`,
      `import('${coreUrl}');`,
      'export function register() {}',
    ].join('\n'),
  });
  const result = scanSpecialistPackage(packageDir, { projectRoot: ROOT });
  assertEqual(result.violations.length, 4);
  assertEqual(new Set(result.violations.map((item) => item.kind)).size, 4);
});

test('JSDoc import into src is measured but does not fail runtime independence', () => {
  const coreUrl = pathToFileURL(path.join(ROOT, 'src', 'core', 'logger.js')).href;
  const packageDir = createPackage('jsdoc', {
    'index.js': `/** @param {import('${coreUrl}').logger} value */\nexport function register(value) {}\n`,
  });
  const result = scanSpecialistPackage(packageDir, { projectRoot: ROOT });
  assertEqual(result.ok, true);
  assertEqual(result.violations.length, 0);
  assertEqual(result.typeReferences.length, 1);
});

test('syntax errors fail closed as scan errors', () => {
  const packageDir = createPackage('broken-syntax', {
    'index.js': 'export function {\n',
  });
  const result = scanSpecialistPackage(packageDir, { projectRoot: ROOT });
  assertEqual(result.ok, false);
  assertEqual(result.errors.length, 1);
  assertEqual(result.errors[0].reason, 'javascript_parse_error');
});

test('computed and escaped module specifiers fail closed as unverifiable', () => {
  const packageDir = createPackage('unverifiable', {
    'index.js': [
      "const target = './local.js';",
      'import(target);',
      "import '..\\u002f..\\u002fsrc/core/logger.js';",
      'export function register() {}',
    ].join('\n'),
    'local.js': 'export const local = true;\n',
  });
  const result = scanSpecialistPackage(packageDir, { projectRoot: ROOT });
  assertEqual(result.ok, false);
  assertEqual(result.computedImports.length, 2);
  assertEqual(
    result.violations.filter((item) => item.reason === 'computed_import_unverifiable').length,
    2,
  );
});

test('CLI mutation probe exits non-zero and prints the exact nested edge', () => {
  const cliRoot = fs.mkdtempSync(path.join(scratch, 'cli-'));
  const packageDir = path.join(cliRoot, 'cli-violation');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'specialist.json'), JSON.stringify(manifest('cli-violation')));
  fs.writeFileSync(path.join(packageDir, 'index.js'), "import './nested.js'; export function register() {}\n");
  const coreUrl = pathToFileURL(path.join(ROOT, 'src', 'core', 'logger.js')).href;
  fs.writeFileSync(path.join(packageDir, 'nested.js'), `import '${coreUrl}';\n`);
  const result = runChecker(cliRoot);
  assertEqual(result.status, 1, result.stderr || result.stdout);
  assert(result.stdout.includes('SPECIALIST_BOUNDARY_FAIL'), result.stdout);
  assert(result.stdout.includes('cli-violation/nested.js:1 import'), result.stdout);
});

await testAsync('loader rejects violating package before install or migration', async () => {
  const loaderRoot = fs.mkdtempSync(path.join(scratch, 'loader-discovery-'));
  const id = 'blocked-before-install';
  const packageDir = path.join(loaderRoot, id);
  fs.mkdirSync(path.join(packageDir, 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'specialist.json'), JSON.stringify(manifest(id, {
    migrations: ['001_should_not_run'],
  })));
  const coreUrl = pathToFileURL(path.join(ROOT, 'src', 'core', 'logger.js')).href;
  fs.writeFileSync(path.join(packageDir, 'index.js'), `import '${coreUrl}'; export function register() {}\n`);
  fs.writeFileSync(
    path.join(packageDir, 'migrations', '001_should_not_run.js'),
    'export function up(db) { db.exec("CREATE TABLE forbidden_migration (id INTEGER)"); }\n',
  );

  const db = createDb();
  const runtime = createRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: loaderRoot,
    projectRoot: ROOT,
    engineVersion: ENGINE_VERSION,
  });
  await loader.boot();
  assertEqual(loader.getInstalled().length, 0);
  assertEqual(runtime.registrations.size, 0);
  assertEqual(loader.getBoundaryFailures().has(id), true);
  const migrationTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'forbidden_migration'",
  ).get();
  assertEqual(migrationTable, undefined);
  db.close();
});

await testAsync('loader re-scans immediately before first execution', async () => {
  const loaderRoot = fs.mkdtempSync(path.join(scratch, 'loader-enable-'));
  const id = 'changed-after-discovery';
  const packageDir = path.join(loaderRoot, id);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'specialist.json'), JSON.stringify(manifest(id)));
  fs.writeFileSync(
    path.join(packageDir, 'index.js'),
    `export function register(ctx) { ctx.runtime.registerSpecialist({ id: '${id}', tools: [] }); }\n`,
  );

  const db = createDb();
  const runtime = createRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: loaderRoot,
    projectRoot: ROOT,
    engineVersion: ENGINE_VERSION,
  });
  assertEqual(loader.discoverAll().length, 1);
  loader.installPending();

  const coreUrl = pathToFileURL(path.join(ROOT, 'src', 'core', 'logger.js')).href;
  fs.writeFileSync(path.join(packageDir, 'late.js'), `import '${coreUrl}';\n`);
  await loader.enableAll();
  assertEqual(runtime.registrations.size, 0);
  assertEqual(loader.getBoundaryFailures().has(id), true);
  db.close();
});

await testAsync('code-reviewer handlers execute without computed module imports', async () => {
  const handlers = new Map();
  const runtime = createRuntime();
  const codeReviewerManifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'specialists', 'code-reviewer', 'specialist.json'), 'utf8'),
  );
  await codeReviewer.register({
    runtime,
    manifest: codeReviewerManifest,
    logger: { warn() {}, info() {}, debug() {}, error() {} },
    registries: {
      toolExecutor: {
        register(id, handler) { handlers.set(id, handler); },
      },
    },
  });
  const analysis = await handlers.get('code-reviewer.analyze_code')({
    code: 'function execute(userInput) { return eval(userInput); }',
    focus: 'security',
  });
  const security = await handlers.get('code-reviewer.security_scan')({
    code: 'function execute(userInput) { return eval(userInput); }',
  });
  assertEqual(analysis.status, 'ok');
  assert(Array.isArray(analysis.data.findings));
  assertEqual(security.status, 'ok');
  assert(Array.isArray(security.data.vulnerabilities));
});

summary();
fs.rmSync(scratch, { recursive: true, force: true });
