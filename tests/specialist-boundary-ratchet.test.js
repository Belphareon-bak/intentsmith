#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/specialist-boundary-ratchet.mjs');
const BASELINE = join(ROOT, 'tests/fixtures/specialist-boundary/baseline.json');
const artifactParent = process.env.INTENTSMITH_TEST_ARTIFACT_DIR
  && existsSync(process.env.INTENTSMITH_TEST_ARTIFACT_DIR)
  ? process.env.INTENTSMITH_TEST_ARTIFACT_DIR
  : tmpdir();
const scratch = mkdtempSync(join(artifactParent, 'specialist-boundary-ratchet-test-'));
let fixtureCounter = 0;
let passed = 0;
let failed = 0;
const failures = [];

function test(name, callback) {
  try {
    callback();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, message: error.stack || error.message });
    console.log(`  ❌ ${name}: ${error.message}`);
  }
}

function combined(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function assertStatus(result, status, label = '') {
  assert.equal(result.status, status, `${label}\n${combined(result)}`);
}

function assertIncludes(result, value) {
  assert.match(combined(result), new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
}

function write(target, value, mode = 0o644) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value, { encoding: 'utf8', mode });
}

function runCommand(command, args, cwd, env = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function run(repo, args = [], env = {}) {
  return runCommand(process.execPath, [join(repo, 'scripts/specialist-boundary-ratchet.mjs'), ...args], repo, env);
}

function git(repo, args) {
  const result = runCommand('git', ['-C', repo, ...args], repo);
  assertStatus(result, 0, `git ${args.join(' ')}`);
  return result.stdout.trim();
}

function commitAll(repo, message) {
  git(repo, ['add', '-A']);
  git(repo, [
    '-c', 'user.name=IntentSmith Boundary Test',
    '-c', 'user.email=boundary-test@invalid.local',
    'commit', '-q', '-m', message,
  ]);
  return git(repo, ['rev-parse', 'HEAD']);
}

function makeRepo(files, name = 'repo') {
  fixtureCounter += 1;
  const repo = join(scratch, `${String(fixtureCounter).padStart(2, '0')}-${name}`);
  mkdirSync(repo, { recursive: true });
  write(join(repo, 'package.json'), '{"type":"module"}\n');
  write(join(repo, 'tests/fixtures/specialist-boundary/.keep'), 'fixture parent\n');
  write(join(repo, 'src/expertises/core.js'), 'export const core = true;\n');
  write(join(repo, 'scripts/specialist-boundary-ratchet.mjs'), readFileSync(CHECKER, 'utf8'));
  for (const [path, value] of Object.entries(files)) write(join(repo, path), value);
  git(repo, ['init', '-q']);
  commitAll(repo, 'fixture scanner subject');
  return repo;
}

function bootstrap(repo, acceptances, owner = 'WP-M3-L0-8-INJECTION') {
  const args = ['--write-baseline'];
  for (const acceptance of acceptances) args.push('--accept-reference', acceptance);
  args.push('--owner', owner, '--expires-on-integration', owner);
  return run(repo, args);
}

function commitBaseline(repo) {
  assert.equal(existsSync(join(repo, 'tests/fixtures/specialist-boundary/baseline.json')), true);
  return commitAll(repo, 'fixture baseline issuance');
}

function computedSource({ anchor = 'path.join(__dirname, \'tools\')', call = 'toolsDir', filename = "'tool.js'" } = {}) {
  return `import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function buildToolDefinitions(toolsDir) {
  return [{ modulePath: path.join(toolsDir, ${filename}), functionName: 'run' }];
}
export async function register(input) {
  const toolsDir = ${anchor};
  const tools = buildToolDefinitions(${call});
  for (const tool of tools) {
    const mod = await import(tool.modulePath);
    await mod[tool.functionName]({});
  }
}
`;
}

console.log('\n═══ Specialist boundary ratchet ═════════════════════════');

try {
  test('help and invalid mode combinations are explicit', () => {
    const help = run(ROOT, ['--help']);
    assertStatus(help, 0);
    assertIncludes(help, '--require-clean');
    assertIncludes(help, '--expire-owner');
    assertIncludes(help, '2  invalid input');
    const invalid = run(ROOT, ['--require-clean', '--write-baseline']);
    assertStatus(invalid, 2);
    assertIncludes(invalid, 'mutually exclusive');
    const customBaseline = run(ROOT, ['--baseline', 'tests/fixtures/other.json']);
    assertStatus(customBaseline, 2);
    assertIncludes(customBaseline, 'unsupported argument: --baseline');
    const acceptance = 'runtime|specialists/alpha/index.js -> src/expertises/core.js|1';
    const wrongBootstrapOwner = run(ROOT, [
      '--write-baseline', '--accept-reference', acceptance,
      '--owner', 'WP-WRONG', '--expires-on-integration', 'WP-WRONG',
    ]);
    assertStatus(wrongBootstrapOwner, 2);
    assertIncludes(wrongBootstrapOwner, 'bootstrap owner and expiry must both equal');
    const mismatchedBootstrapOwner = run(ROOT, [
      '--write-baseline', '--accept-reference', acceptance,
      '--owner', 'WP-M3-L0-8-INJECTION', '--expires-on-integration', 'WP-WRONG',
    ]);
    assertStatus(mismatchedBootstrapOwner, 2);
    assertIncludes(mismatchedBootstrapOwner, 'bootstrap owner and expiry must both equal');
    const wrongExpiryOwner = run(ROOT, ['--write-baseline', '--expire-owner', 'WP-WRONG']);
    assertStatus(wrongExpiryOwner, 2);
    assertIncludes(wrongExpiryOwner, '--expire-owner must equal WP-M3-L0-8-INJECTION');
  });

  test('current repository census is recursive, exact, and computed imports are proven', () => {
    const clean = run(ROOT, ['--require-clean']);
    assert.doesNotMatch(combined(clean), /UNPROVEN_COMPUTED_IMPORT/u);

    const normal = run(ROOT);
    if (existsSync(BASELINE)) {
      const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
      const expectedReferences = baseline.exceptions
        .reduce((total, entry) => total + entry.count, 0);
      assertStatus(normal, 0);
      assertIncludes(normal, 'SPECIALIST_BOUNDARY_RATCHET_PASS');
      if (expectedReferences === 0) {
        assertStatus(clean, 0);
        assertIncludes(clean, 'packages=5 files=32 references=0');
        assert.doesNotMatch(combined(clean), /^REFERENCE /mu);
      } else {
        assert.equal(expectedReferences, 4, 'temporary baseline must pin exactly four references');
        assertStatus(clean, 1);
        assertIncludes(clean, 'packages=5 files=32 references=4');
        assertIncludes(clean, 'kind=runtime from=specialists/accountant-cz/adapters.js to=src/expertises/tool-adapter.js count=1');
        assertIncludes(clean, 'kind=jsdoc from=specialists/accountant-cz/knowledge/seed.js to=src/expertises/knowledge-base.js count=1');
        assertIncludes(clean, 'kind=jsdoc from=specialists/dummy-logger/index.js to=src/expertises/specialist-runtime.js count=2');
      }
    } else {
      assertStatus(clean, 1);
      assertIncludes(clean, 'packages=5 files=32 references=4');
      assertIncludes(clean, 'kind=runtime from=specialists/accountant-cz/adapters.js to=src/expertises/tool-adapter.js count=1');
      assertIncludes(clean, 'kind=jsdoc from=specialists/accountant-cz/knowledge/seed.js to=src/expertises/knowledge-base.js count=1');
      assertIncludes(clean, 'kind=jsdoc from=specialists/dummy-logger/index.js to=src/expertises/specialist-runtime.js count=2');
      assertStatus(normal, 2);
      assertIncludes(normal, 'TREE_READ_FAILED');
    }
  });

  test('static import, re-export, literal import(), require(), and JSDoc are counted', () => {
    const repo = makeRepo({
      'specialists/forms/index.js': `import { core } from '../../src/expertises/core.js';
export { core as exportedCore } from '../../src/expertises/core.js';
/** @type {import('../../src/expertises/core.js').core} */
export async function load() {
  await import('../../src/expertises/core.js');
  return require('../../src/expertises/core.js');
}
`,
    }, 'forms');
    const result = run(repo, ['--require-clean']);
    assertStatus(result, 1);
    assertIncludes(result, 'kind=runtime from=specialists/forms/index.js to=src/expertises/core.js count=4');
    assertIncludes(result, 'kind=jsdoc from=specialists/forms/index.js to=src/expertises/core.js count=1');
  });

  test('sixth package and nested .mjs/.cjs files are discovered without an entrypoint list', () => {
    const files = {};
    for (const name of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
      files[`specialists/${name}/index.js`] = `export const ${name} = true;\n`;
    }
    files['specialists/zeta/index.js'] = 'export const zeta = true;\n';
    files['specialists/zeta/lib/deep.mjs'] = "import '../../../src/expertises/core.js';\n";
    files['specialists/zeta/lib/worker.cjs'] = "require('../../../src/expertises/core.js');\n";
    const repo = makeRepo(files, 'recursive');
    const result = run(repo, ['--require-clean']);
    assertStatus(result, 1);
    assertIncludes(result, 'packages=6 files=8 references=2');
    assertIncludes(result, 'specialists/zeta/lib/deep.mjs');
    assertIncludes(result, 'specialists/zeta/lib/worker.cjs');
  });

  test('computed-package-local proof binds imports to the local builder and rejects authority drift', () => {
    const repo = makeRepo({
      'specialists/computed/index.js': computedSource(),
      'specialists/computed/tools/tool.js': 'export function run() { return true; }\n',
    }, 'computed');
    const sourcePath = join(repo, 'specialists/computed/index.js');
    const original = readFileSync(sourcePath, 'utf8');
    assertStatus(run(repo, ['--require-clean']), 0);

    write(sourcePath, computedSource({ anchor: "path.resolve(__dirname, 'tools')" }));
    const anchor = run(repo, ['--require-clean']);
    assertStatus(anchor, 2);
    assertIncludes(anchor, 'non-canonical assignment');

    write(sourcePath, computedSource({ call: 'input' }));
    const caller = run(repo, ['--require-clean']);
    assertStatus(caller, 2);
    assertIncludes(caller, 'every tool definition call');

    write(sourcePath, computedSource({ filename: 'input.filename' }));
    const filename = run(repo, ['--require-clean']);
    assertStatus(filename, 2);
    assertIncludes(filename, 'literal package-local');

    write(
      sourcePath,
      original.replace(
        '  const tools = buildToolDefinitions(toolsDir);',
        '  const tool = input;\n  await import(tool.modulePath);\n  const tools = buildToolDefinitions(toolsDir);',
      ),
    );
    const callerShadow = run(repo, ['--require-clean']);
    assertStatus(callerShadow, 2);
    assertIncludes(callerShadow, 'computed import is outside the canonical loader loop');

    write(
      sourcePath,
      original
        .replace('export async function register(input)', 'export async function register(tools)')
        .replace(
          '  const tools = buildToolDefinitions(toolsDir);',
          '  { const tools = buildToolDefinitions(toolsDir); }',
        ),
    );
    const callerScopeShadow = run(repo, ['--require-clean']);
    assertStatus(callerScopeShadow, 2);
    assertIncludes(callerScopeShadow, 'tools binding and loader loop must share the exact lexical scope');

    write(
      sourcePath,
      `${computedSource({ anchor: 'input.toolsDir' })}\n/* const toolsDir = path.join(__dirname, 'tools'); */\n`,
    );
    const decoy = run(repo, ['--require-clean']);
    assertStatus(decoy, 2);
    assertIncludes(decoy, 'non-canonical assignment');

    write(sourcePath, original);
    assertStatus(run(repo, ['--require-clean']), 0);
  });

  test('computed target symlink is rejected before import analysis can trust it', () => {
    const repo = makeRepo({
      'specialists/computed/index.js': computedSource(),
      'specialists/computed/tools/tool.js': 'export function run() { return true; }\n',
    }, 'computed-symlink');
    const target = join(repo, 'specialists/computed/tools/tool.js');
    unlinkSync(target);
    symlinkSync(join(repo, 'src/expertises/core.js'), target);
    const result = run(repo, ['--require-clean']);
    assertStatus(result, 2);
    assertIncludes(result, 'is a symlink');
  });

  test('template interpolation stays usable but cannot hide import or require expressions', () => {
    const repo = makeRepo({
      'specialists/alpha/index.js': 'export const label = `safe ${String(1)}`;\n',
    }, 'template-expression');
    const sourcePath = join(repo, 'specialists/alpha/index.js');
    assertStatus(run(repo, ['--require-clean']), 0);

    write(
      sourcePath,
      'export async function hidden() { return `${await import("../../src/expertises/core.js")}`; }\n',
    );
    const hiddenImport = run(repo, ['--require-clean']);
    assertStatus(hiddenImport, 2);
    assertIncludes(hiddenImport, 'UNPROVEN_TEMPLATE_IMPORT');

    write(
      sourcePath,
      'export function hidden() { return `${require("../../src/expertises/core.js")}`; }\n',
    );
    const hiddenRequire = run(repo, ['--require-clean']);
    assertStatus(hiddenRequire, 2);
    assertIncludes(hiddenRequire, 'UNPROVEN_TEMPLATE_IMPORT');
  });

  test('loader aliases and dynamic code compilation fail closed', () => {
    const repo = makeRepo({
      'specialists/alpha/index.js': 'export const alpha = true;\n',
    }, 'indirect-loader');
    const sourcePath = join(repo, 'specialists/alpha/index.js');

    const mutations = [
      ['const load = require; load("../../src/expertises/core.js");\n', 'UNPROVEN_COMPUTED_REQUIRE'],
      ['require.resolve("../../src/expertises/core.js");\n', 'UNPROVEN_COMPUTED_REQUIRE'],
      ['eval("require(\\"../../src/expertises/core.js\\")");\n', 'UNPROVEN_DYNAMIC_CODE'],
      ['new Function("return import(\\"../../src/expertises/core.js\\")");\n', 'UNPROVEN_DYNAMIC_CODE'],
      ["import { createRequire } from 'node:module';\n", 'UNPROVEN_DYNAMIC_CODE'],
      ["module['require']('../../src/expertises/core.js');\n", 'UNPROVEN_DYNAMIC_CODE'],
      [`globalThis['eval']('require("../../src/expertises/core.js")');\n`, 'UNPROVEN_DYNAMIC_CODE'],
    ];
    for (const [source, code] of mutations) {
      write(sourcePath, source);
      const result = run(repo, ['--require-clean']);
      assertStatus(result, 2);
      assertIncludes(result, code);
    }
  });

  test('file and data module URLs cannot bypass package-local resolution', () => {
    const repo = makeRepo({
      'specialists/alpha/index.js': 'export const alpha = true;\n',
    }, 'module-url');
    const sourcePath = join(repo, 'specialists/alpha/index.js');
    const internalUrl = pathToFileURL(join(repo, 'src/expertises/core.js')).href;

    write(sourcePath, `export const hidden = import(${JSON.stringify(internalUrl)});\n`);
    const fileUrl = run(repo, ['--require-clean']);
    assertStatus(fileUrl, 2);
    assertIncludes(fileUrl, 'UNPROVEN_MODULE_URL');

    write(sourcePath, "export const hidden = import('data:text/javascript,export default 1');\n");
    const dataUrl = run(repo, ['--require-clean']);
    assertStatus(dataUrl, 2);
    assertIncludes(dataUrl, 'UNPROVEN_MODULE_URL');
  });

  test('parse failure, unreadable file, unknown executable extension, and path escape fail closed', () => {
    const parseRepo = makeRepo({ 'specialists/alpha/index.js': 'export const = ;\n' }, 'parse');
    const parse = run(parseRepo, ['--require-clean']);
    assertStatus(parse, 2);
    assertIncludes(parse, 'SOURCE_PARSE_FAILED');

    const readRepo = makeRepo({ 'specialists/alpha/index.js': 'export const ok = true;\n' }, 'read');
    const unreadable = join(readRepo, 'specialists/alpha/index.js');
    chmodSync(unreadable, 0o000);
    const read = run(readRepo, ['--require-clean']);
    chmodSync(unreadable, 0o644);
    assertStatus(read, 2);
    assertIncludes(read, 'no readable permission bit');

    const extensionRepo = makeRepo({ 'specialists/alpha/hidden.jsx': 'export const hidden = true;\n' }, 'extension');
    const extension = run(extensionRepo, ['--require-clean']);
    assertStatus(extension, 2);
    assertIncludes(extension, 'UNKNOWN_EXECUTABLE_EXTENSION');

    const escapeRepo = makeRepo({ 'specialists/alpha/index.js': 'export const ok = true;\n' }, 'escape');
    symlinkSync(join(escapeRepo, 'src'), join(escapeRepo, 'specialists/alpha/escaped'));
    const escape = run(escapeRepo, ['--require-clean']);
    assertStatus(escape, 2);
    assertIncludes(escape, 'is a symlink');
  });

  test('transitive source outside the package entrypoint is scanned before runtime', () => {
    const repo = makeRepo({
      'specialists/alpha/index.js': "export { load } from './lib/load.js';\n",
      'specialists/alpha/lib/load.js': "import '../../../src/expertises/core.js';\nexport const load = true;\n",
    }, 'transitive');
    const result = run(repo, ['--require-clean']);
    assertStatus(result, 1);
    assertIncludes(result, 'from=specialists/alpha/lib/load.js to=src/expertises/core.js');
  });

  test('bootstrap writer requires every and only exact reference and refuses dirty trees', () => {
    const repo = makeRepo({
      'specialists/alpha/index.js': `import '../../src/expertises/core.js';
/** @type {import('../../src/expertises/core.js').core} */
export const alpha = true;
`,
    }, 'writer');
    const runtime = 'runtime|specialists/alpha/index.js -> src/expertises/core.js|1';
    const jsdoc = 'jsdoc|specialists/alpha/index.js -> src/expertises/core.js|1';

    const missing = bootstrap(repo, [runtime]);
    assertStatus(missing, 1);
    assertIncludes(missing, 'ACCEPTANCE_REQUIRED');

    const extra = bootstrap(repo, [runtime, jsdoc, 'runtime|specialists/alpha/extra.js -> src/expertises/core.js|1']);
    assertStatus(extra, 1);
    assertIncludes(extra, 'UNEXPECTED_ACCEPTANCE');

    const badCount = bootstrap(repo, [runtime.replace('|1', '|2'), jsdoc]);
    assertStatus(badCount, 1);
    assertIncludes(badCount, 'EXACT_ACCEPTANCE_REQUIRED');

    write(join(repo, 'dirty.txt'), 'dirty\n');
    const dirty = bootstrap(repo, [runtime, jsdoc]);
    assertStatus(dirty, 2);
    assertIncludes(dirty, 'BASELINE_WRITE_DIRTY_TREE');
    rmSync(join(repo, 'dirty.txt'));

    write(join(repo, '.gitignore'), 'specialists/alpha/ignored.js\n');
    commitAll(repo, 'fixture ignored-source policy');
    write(join(repo, 'specialists/alpha/ignored.js'), 'export const ignored = true;\n');
    const ignored = bootstrap(repo, [runtime, jsdoc]);
    assertStatus(ignored, 2);
    assertIncludes(ignored, 'writer rejects ignored relevant paths');
    rmSync(join(repo, 'specialists/alpha/ignored.js'));

    const written = bootstrap(repo, [runtime, jsdoc]);
    assertStatus(written, 0);
    assertIncludes(written, 'SPECIALIST_BOUNDARY_BASELINE_WRITTEN');
    commitBaseline(repo);
    const normal = run(repo);
    assertStatus(normal, 0);
    assertIncludes(normal, 'references=2 exceptions=2');
  });

  test('writer detects a specialist-tree mutation between scan and atomic write', () => {
    const repo = makeRepo({
      'specialists/alpha/index.js': "import '../../src/expertises/core.js';\n",
    }, 'writer-race');
    const wrapperDir = join(scratch, `${String(fixtureCounter).padStart(2, '0')}-git-wrapper`);
    mkdirSync(wrapperDir);
    const realGit = runCommand('sh', ['-lc', 'command -v git'], repo).stdout.trim();
    const wrapper = join(wrapperDir, 'git');
    write(wrapper, `#!/bin/sh
if [ "$1" = "-C" ] && [ "$3" = "status" ]; then
  count=0
  if [ -f "$IS_COUNTER" ]; then count=$(sed -n '1p' "$IS_COUNTER"); fi
  if [ "$count" -ge 1 ]; then printf '\\n// mutation during scan\\n' >> "$IS_MUTATE"; fi
  printf '%s\\n' "$((count + 1))" > "$IS_COUNTER"
fi
exec "$IS_REAL_GIT" "$@"
`, 0o755);
    const env = {
      PATH: `${wrapperDir}:${process.env.PATH}`,
      IS_REAL_GIT: realGit,
      IS_COUNTER: join(wrapperDir, 'counter'),
      IS_MUTATE: join(repo, 'specialists/alpha/index.js'),
    };
    const result = bootstrap(
      repo,
      ['runtime|specialists/alpha/index.js -> src/expertises/core.js|1'],
    );
    // The control run proves the fixture acceptance before the injected race.
    assertStatus(result, 0);
    rmSync(join(repo, 'tests/fixtures/specialist-boundary/baseline.json'));
    const raced = run(repo, [
      '--write-baseline',
      '--accept-reference', 'runtime|specialists/alpha/index.js -> src/expertises/core.js|1',
      '--owner', 'WP-M3-L0-8-INJECTION',
      '--expires-on-integration', 'WP-M3-L0-8-INJECTION',
    ], env);
    assertStatus(raced, 2);
    assertIncludes(raced, 'BASELINE_WRITE_DIRTY_TREE');
  });

  test('normal mode rejects count growth, removed exception, broad exception, and stale provenance', () => {
    const repo = makeRepo({
      'specialists/alpha/index.js': "import '../../src/expertises/core.js';\n",
    }, 'ratchet-drift');
    const acceptance = 'runtime|specialists/alpha/index.js -> src/expertises/core.js|1';
    assertStatus(bootstrap(repo, [acceptance]), 0);
    commitBaseline(repo);
    const sourcePath = join(repo, 'specialists/alpha/index.js');
    const baselinePath = join(repo, 'tests/fixtures/specialist-boundary/baseline.json');
    const source = readFileSync(sourcePath, 'utf8');
    const baseline = readFileSync(baselinePath, 'utf8');

    write(join(repo, '.gitignore'), 'specialists/alpha/ignored.txt\n');
    commitAll(repo, 'fixture ignored-source policy');
    write(join(repo, 'specialists/alpha/ignored.txt'), 'ignored relevant asset\n');
    const ignored = run(repo);
    assertStatus(ignored, 2);
    assertIncludes(ignored, 'relevant worktree path is dirty: !! specialists/alpha/ignored.txt');
    rmSync(join(repo, 'specialists/alpha/ignored.txt'));

    write(sourcePath, `${source}/** @type {import('../../src/expertises/core.js').core} */\n`);
    const growth = run(repo);
    assertStatus(growth, 1);
    assertIncludes(growth, 'ADDED jsdoc|specialists/alpha/index.js -> src/expertises/core.js|1');
    write(sourcePath, source);

    const parsed = JSON.parse(baseline);
    parsed.exceptions = [];
    write(baselinePath, `${JSON.stringify(parsed, null, 2)}\n`);
    const removed = run(repo);
    assertStatus(removed, 1);
    assertIncludes(removed, 'ADDED runtime|specialists/alpha/index.js -> src/expertises/core.js|1');

    parsed.exceptions = [{
      from: 'specialists/**',
      to: 'src/expertises/core.js',
      kind: 'runtime',
      count: 1,
      owner: 'WP-M3-L0-8-INJECTION',
      expiresOnIntegration: 'WP-M3-L0-8-INJECTION',
    }];
    write(baselinePath, `${JSON.stringify(parsed, null, 2)}\n`);
    const broad = run(repo);
    assertStatus(broad, 2);
    assertIncludes(broad, 'exact specialist/src code-file paths');

    parsed.exceptions = [{
      from: 'specialists/alpha/index.js',
      to: 'src/expertises/core.js',
      kind: 'runtime',
      count: 1,
      owner: 'WP-WRONG',
      expiresOnIntegration: 'WP-WRONG',
    }];
    write(baselinePath, `${JSON.stringify(parsed, null, 2)}\n`);
    const wrongOwner = run(repo);
    assertStatus(wrongOwner, 2);
    assertIncludes(wrongOwner, 'owner and expiry must both equal WP-M3-L0-8-INJECTION');
    write(baselinePath, baseline);

    write(sourcePath, `${source}// benign tree drift\n`);
    commitAll(repo, 'fixture specialist tree drift');
    const stale = run(repo);
    assertStatus(stale, 2);
    assertIncludes(stale, 'STALE_PROVENANCE');
  });

  test('baseline issuance topology rejects a later manual baseline rewrite', () => {
    const repo = makeRepo({
      'specialists/alpha/index.js': "import '../../src/expertises/core.js';\n",
    }, 'issuance');
    const acceptance = 'runtime|specialists/alpha/index.js -> src/expertises/core.js|1';
    assertStatus(bootstrap(repo, [acceptance]), 0);
    commitBaseline(repo);
    const baselinePath = join(repo, 'tests/fixtures/specialist-boundary/baseline.json');
    const parsed = JSON.parse(readFileSync(baselinePath, 'utf8'));
    write(baselinePath, `${JSON.stringify(parsed)}\n`);
    commitAll(repo, 'manual baseline rewrite');
    const result = run(repo);
    assertStatus(result, 2);
    assertIncludes(result, 'INVALID_BASELINE_ISSUANCE');
  });

  test('--require-clean ignores and preserves the baseline while enforcing zero references', () => {
    const repo = makeRepo({
      'specialists/alpha/index.js': "import '../../src/expertises/core.js';\n",
    }, 'require-clean');
    const acceptance = 'runtime|specialists/alpha/index.js -> src/expertises/core.js|1';
    assertStatus(bootstrap(repo, [acceptance]), 0);
    commitBaseline(repo);
    const baselinePath = join(repo, 'tests/fixtures/specialist-boundary/baseline.json');
    const before = readFileSync(baselinePath);
    assertStatus(run(repo, ['--require-clean']), 1);
    assert.deepEqual(readFileSync(baselinePath), before);
    write(join(repo, '.gitignore'), 'specialists/alpha/ignored.js\n');
    commitAll(repo, 'fixture ignored-source policy');
    write(join(repo, 'specialists/alpha/ignored.js'), 'export const ignored = true;\n');
    const ignored = run(repo, ['--require-clean']);
    assertStatus(ignored, 2);
    assertIncludes(ignored, 'UNTRACKED_SPECIALIST_SOURCE');
    rmSync(join(repo, 'specialists/alpha/ignored.js'));
    write(join(repo, 'specialists/alpha/index.js'), 'export const alpha = true;\n');
    assertStatus(run(repo, ['--require-clean']), 0);
    assert.deepEqual(readFileSync(baselinePath), before);
  });

  test('owner expiry requires exact owner and zero references, then issues an empty baseline', () => {
    const repo = makeRepo({
      'specialists/alpha/index.js': "import '../../src/expertises/core.js';\n",
    }, 'expiry');
    const owner = 'WP-M3-L0-8-INJECTION';
    const acceptance = 'runtime|specialists/alpha/index.js -> src/expertises/core.js|1';
    assertStatus(bootstrap(repo, [acceptance], owner), 0);
    commitBaseline(repo);

    const wrong = run(repo, ['--write-baseline', '--expire-owner', 'WP-WRONG']);
    assertStatus(wrong, 2);
    assertIncludes(wrong, '--expire-owner must equal WP-M3-L0-8-INJECTION');
    const remaining = run(repo, ['--write-baseline', '--expire-owner', owner]);
    assertStatus(remaining, 1);
    assertIncludes(remaining, 'OWNER_EXPIRY_VIOLATIONS_REMAIN');

    write(join(repo, 'specialists/alpha/index.js'), 'export const alpha = true;\n');
    commitAll(repo, 'remove specialist boundary reference');
    const expired = run(repo, ['--write-baseline', '--expire-owner', owner]);
    assertStatus(expired, 0);
    assertIncludes(expired, 'references=0 exceptions=0');
    commitAll(repo, 'issue empty specialist boundary baseline');
    const normal = run(repo);
    assertStatus(normal, 0);
    assertIncludes(normal, 'references=0 exceptions=0');
  });

  test('owner expiry rejects a manually rewritten input baseline', () => {
    const repo = makeRepo({
      'specialists/alpha/index.js': "import '../../src/expertises/core.js';\n",
    }, 'expiry-provenance');
    const owner = 'WP-M3-L0-8-INJECTION';
    const acceptance = 'runtime|specialists/alpha/index.js -> src/expertises/core.js|1';
    assertStatus(bootstrap(repo, [acceptance], owner), 0);
    commitBaseline(repo);

    const baselinePath = join(repo, 'tests/fixtures/specialist-boundary/baseline.json');
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    write(baselinePath, `${JSON.stringify(baseline)}\n`);
    commitAll(repo, 'manual valid baseline rewrite');
    write(join(repo, 'specialists/alpha/index.js'), 'export const alpha = true;\n');
    commitAll(repo, 'remove specialist reference after rewrite');

    const result = run(repo, ['--write-baseline', '--expire-owner', owner]);
    assertStatus(result, 2);
    assertIncludes(result, 'INVALID_BASELINE_ISSUANCE');
  });

  test('temporary mutation fails and exact byte restoration returns to the prior result', () => {
    const repo = makeRepo({ 'specialists/alpha/index.js': 'export const alpha = true;\n' }, 'mutation');
    const sourcePath = join(repo, 'specialists/alpha/index.js');
    const before = readFileSync(sourcePath);
    assertStatus(run(repo, ['--require-clean']), 0);
    write(sourcePath, "import '../../src/expertises/core.js';\n");
    const mutation = run(repo, ['--require-clean']);
    assertStatus(mutation, 1);
    assertIncludes(mutation, 'specialists/alpha/index.js');
    writeFileSync(sourcePath, before);
    assertStatus(run(repo, ['--require-clean']), 0);
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${'═'.repeat(70)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed, 0 skipped`);
console.log('═'.repeat(70));

if (failed > 0) {
  for (const failure of failures) console.error(`\n${failure.name}\n${failure.message}`);
  process.exitCode = 1;
}
