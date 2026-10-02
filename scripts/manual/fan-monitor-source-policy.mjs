// Scenario-specific qualification policy. Parse only; never evaluate subject text.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { observeM2Imports, readM2ImportObservation } from '../../src/lifecycle/m2-import-scanner.js';
const self = fileURLToPath(import.meta.url);
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const sorted = values => [...values].sort();
export const SUBJECT_IMPORTS = Object.freeze({
  'src/readings.mjs': Object.freeze([]),
  'src/history.mjs': Object.freeze([]),
  'src/monitor.mjs': Object.freeze(['./history.mjs', './readings.mjs']),
  'src/cli.mjs': Object.freeze(['./monitor.mjs']),
  'src/index.mjs': Object.freeze(['./cli.mjs', 'node:url']),
});
const TEST_BUILTINS = Object.freeze(['node:test', 'node:assert', 'node:assert/strict']);

export function assertProtectedSourceHashes(sources, frozen) {
  assert.ok(Object.keys(frozen).length >= 4, 'oracle, entry, operator wrapper, governance policy protected');
  for (const [relative, expected] of Object.entries(frozen)) {
    assert.ok(typeof sources[relative] === 'string', relative + ': protected complete contents required');
    assert.equal(sha(Buffer.from(sources[relative])), expected.startsWith('sha256:') ? expected : 'sha256:' + expected,
      relative + ': protected source differs');
  }
}

// This additional scenario rule narrows global product externalImports.
// It does not replace actual default M2 governance or grant an effect.
export async function assertFanSubjectSourcePolicy(sources, { phase }) {
  assert.ok(['core', 'cli'].includes(phase));
  const libs = Object.keys(SUBJECT_IMPORTS).slice(0, phase === 'core' ? 3 : 5);
  const tests = phase === 'core' ? ['test/acceptance.test.mjs'] : ['test/acceptance.test.mjs', 'test/cli.test.mjs'];
  const required = sorted([...libs, ...tests]);
  assert.deepEqual(sorted(Object.keys(sources)), required, 'complete exact subject graph including retained generated tests');
  const files = required.map(relative => {
    assert.equal(typeof sources[relative], 'string', relative + ': complete UTF-8 string');
    assert.ok(sources[relative].isWellFormed(), relative + ': well-formed UTF-8');
    const bytes = Buffer.from(sources[relative]); assert.ok(bytes.length <= 65536, relative + ': source byte bound');
    return { path: relative, extension: '.mjs', source: sources[relative], bytes: bytes.length, digest: sha(bytes) };
  });
  assert.ok(files.reduce((sum, file) => sum + file.bytes, 0) <= 262144, 'total source byte bound');
  const prepared = { ready: true, bindingDigest: sha(JSON.stringify(files.map(({ source, ...file }) => file))), files };
  const token = await observeM2Imports(prepared);
  const observation = readM2ImportObservation(token, prepared);
  assert.ok(observation && !observation.error, 'actual bounded scanner unavailable: ' + observation?.error);
  for (const file of observation.files) {
    assert.equal(file.complete, true, file.path + ': incomplete import observation ' + JSON.stringify(file.errors));
    assert.deepEqual(file.errors, []);
    if (libs.includes(file.path)) {
      assert.deepEqual(sorted(file.specifiers), sorted(SUBJECT_IMPORTS[file.path]), file.path + ': exact static subject graph');
    } else {
      for (const specifier of file.specifiers) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), specifier));
        assert.ok(TEST_BUILTINS.includes(specifier) || (specifier.startsWith('.') && libs.includes(target)),
          file.path + ': generated tests can import only test/assert or local subject, denied ' + specifier);
      }
    }
  }
  // The standard scanner observes literal dynamic imports as dependencies.
  // A separate bounded parse explicitly rejects even unreachable import(...).
  const syntax = spawnSync('/usr/bin/prlimit', [
    '--as=805306368', '--cpu=2', '--core=0', '--', process.execPath,
    '--max-old-space-size=128', '--jitless', '--no-warnings', '--expose-gc', self, '--syntax-only-child',
  ], { input: JSON.stringify(files), encoding: 'utf8', timeout: 5000, maxBuffer: 131072,
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' } });
  assert.equal(syntax.error, undefined, 'bounded syntax child error');
  assert.equal(syntax.signal, null, 'bounded syntax child killed');
  assert.equal(syntax.status, 0, 'static-only syntax denied: ' + syntax.stdout + syntax.stderr);
  const syntaxResult = JSON.parse(syntax.stdout);
  assert.equal(syntaxResult.status, 'STATIC_ONLY_PASS');
  assert.deepEqual(syntaxResult.files.map(file => file.path), required);
  return { status: 'SUBJECT_PER_PATH_STATIC_ONLY_PASS_NOT_APP_ACCEPTANCE', phase,
    sourceSetBinding: prepared.bindingDigest, sources: files.map(({ source, ...file }) => file),
    typedImportIdentity: observation.identity, syntax: syntaxResult };
}

async function syntaxChild() {
  const [{ default: Parser }, { default: JavaScript }] = await Promise.all([import('tree-sitter'), import('tree-sitter-javascript')]);
  const chunks = []; let inputBytes = 0;
  for await (const chunk of process.stdin) { inputBytes += chunk.length; assert.ok(inputBytes <= 524288); chunks.push(chunk); }
  const files = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.ok(Array.isArray(files) && files.length <= 7);
  const parser = new Parser(); parser.setLanguage(JavaScript);
  const checked = [];
  for (const file of files) {
    const tree = parser.parse(file.source); assert.equal(tree.rootNode.hasError, false, file.path + ': syntax');
    const stack = [[tree.rootNode, 0]]; let nodes = 0;
    while (stack.length) {
      const [node, depth] = stack.pop(); assert.ok(++nodes <= 50000 && depth <= 128, 'FAN_STATIC_AST_LIMIT');
      if (node.type === 'call_expression' && node.childForFieldName('function')?.type === 'import') {
        throw Error('FAN_DYNAMIC_IMPORT_DENIED:' + file.path);
      }
      for (const child of node.namedChildren) stack.push([child, depth + 1]);
    }
    checked.push({ path: file.path, digest: file.digest, nodes }); tree.delete?.();
  }
  console.log(JSON.stringify({ status: 'STATIC_ONLY_PASS', files: checked }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  assert.deepEqual(process.argv.slice(2), ['--syntax-only-child']);
  try { await syntaxChild(); } catch (error) { console.log(JSON.stringify({ status: 'STATIC_ONLY_FAIL', error: error.message })); process.exitCode = 1; }
}
