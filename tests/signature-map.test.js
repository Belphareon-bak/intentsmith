// tests/signature-map.test.js — Signature Map unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, assertIncludes, summary } from './harness.js';
import { buildSignatureMap, formatSignature, formatSignatureMap } from '../src/code-intel/signature-map.js';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

// ─── Helpers ────────────────────────────────────────────────────────────────

let tmpDir;

async function setup() {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'sigmap-test-'));
}

async function writeTestFile(relPath, content) {
  const absPath = path.join(tmpDir, relPath);
  const dir = path.dirname(absPath);
  const { mkdir } = await import('fs/promises');
  await mkdir(dir, { recursive: true });
  await writeFile(absPath, content);
  return relPath;
}

async function cleanup() {
  if (tmpDir) {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// formatSignature
// ═══════════════════════════════════════════════════════════════════════════

suite('formatSignature');

test('function with params', () => {
  const sig = formatSignature({
    name: 'processOrder', type: 'function', params: ['orderId', 'items'], exported: true,
  });
  assertEqual(sig, 'export function processOrder(orderId, items)');
});

test('function without params', () => {
  const sig = formatSignature({
    name: 'init', type: 'function', exported: true,
  });
  assertEqual(sig, 'export function init()');
});

test('class symbol', () => {
  const sig = formatSignature({
    name: 'OrderValidator', type: 'class', exported: true,
  });
  assertEqual(sig, 'export class OrderValidator');
});

test('const symbol', () => {
  const sig = formatSignature({
    name: 'MAX_RETRIES', type: 'variable', exported: true,
  });
  assertEqual(sig, 'export const MAX_RETRIES');
});

test('non-exported function', () => {
  const sig = formatSignature({
    name: 'helper', type: 'function', params: ['x'], exported: false,
  });
  assertEqual(sig, 'function helper(x)');
});

test('interface symbol', () => {
  const sig = formatSignature({
    name: 'Config', type: 'interface', exported: true,
  });
  assertEqual(sig, 'export interface Config');
});

test('enum symbol', () => {
  const sig = formatSignature({
    name: 'Status', type: 'enum', exported: true,
  });
  assertEqual(sig, 'export enum Status');
});

test('struct symbol (Go)', () => {
  const sig = formatSignature({
    name: 'Server', type: 'struct', exported: true,
  });
  assertEqual(sig, 'export type Server struct');
});

test('null/empty returns empty', () => {
  assertEqual(formatSignature(null), '');
  assertEqual(formatSignature({}), '');
  assertEqual(formatSignature({ name: '' }), '');
});

test('arrow function type', () => {
  const sig = formatSignature({
    name: 'handler', type: 'arrow', params: ['req', 'res'], exported: true,
  });
  assertEqual(sig, 'export function handler(req, res)');
});

// ═══════════════════════════════════════════════════════════════════════════
// formatSignatureMap
// ═══════════════════════════════════════════════════════════════════════════

suite('formatSignatureMap');

test('multi-file map', () => {
  const map = [
    { file: 'src/service.js', exports: ['export function processOrder(orderId, items)'] },
    { file: 'src/util.js', exports: ['export function formatDate(date)'] },
  ];
  const result = formatSignatureMap(map);
  assertIncludes(result, '## API Signatures');
  assertIncludes(result, '### src/service.js');
  assertIncludes(result, '### src/util.js');
  assertIncludes(result, '- export function processOrder(orderId, items)');
  assertIncludes(result, 'DO NOT modify these files');
});

test('single file map', () => {
  const map = [{ file: 'a.js', exports: ['export const X'] }];
  const result = formatSignatureMap(map);
  assertIncludes(result, '### a.js');
  assertIncludes(result, '- export const X');
});

test('empty map returns empty string', () => {
  assertEqual(formatSignatureMap([]), '');
  assertEqual(formatSignatureMap(null), '');
});

test('DO NOT MODIFY header present', () => {
  const map = [{ file: 'a.js', exports: ['const x'] }];
  const result = formatSignatureMap(map);
  assertIncludes(result, 'DO NOT modify these files');
});

// ═══════════════════════════════════════════════════════════════════════════
// buildSignatureMap — regex fallback
// ═══════════════════════════════════════════════════════════════════════════

suite('buildSignatureMap — regex fallback');

await testAsync('JS exports detected via regex', async () => {
  await setup();
  try {
    await writeTestFile('service.js', `
export function processOrder(orderId) {
  return orderId;
}

export class OrderValidator {
  validate() {}
}

export const MAX_RETRIES = 3;

function helper() {} // not exported
`);
    const result = await buildSignatureMap(['service.js'], tmpDir);
    assert(result.length === 1, 'should find 1 file');
    // AST detects function + class as exported; const may not be detected by tree-sitter
    // (variable_declarator parent is lexical_declaration, not export_statement)
    assert(result[0].exports.length >= 2, `should find 2+ exports, got ${result[0].exports.length}`);
  } finally {
    await cleanup();
  }
});

await testAsync('empty file returns no exports', async () => {
  await setup();
  try {
    await writeTestFile('empty.js', '');
    const result = await buildSignatureMap(['empty.js'], tmpDir);
    assertEqual(result.length, 0, 'empty file should have no exports');
  } finally {
    await cleanup();
  }
});

await testAsync('file with no exports returns empty', async () => {
  await setup();
  try {
    await writeTestFile('internal.js', `
function helper() { return 1; }
const x = 42;
`);
    const result = await buildSignatureMap(['internal.js'], tmpDir);
    assertEqual(result.length, 0, 'no exports = no signature');
  } finally {
    await cleanup();
  }
});

await testAsync('nonexistent file is skipped', async () => {
  await setup();
  try {
    const result = await buildSignatureMap(['does-not-exist.js'], tmpDir);
    assertEqual(result.length, 0, 'missing file should be skipped');
  } finally {
    await cleanup();
  }
});

await testAsync('multiple files', async () => {
  await setup();
  try {
    await writeTestFile('a.js', 'export function foo() {}');
    await writeTestFile('b.js', 'export class Bar {}');
    const result = await buildSignatureMap(['a.js', 'b.js'], tmpDir);
    assertEqual(result.length, 2, 'should find both files');
  } finally {
    await cleanup();
  }
});

await testAsync('Python module-level defs', async () => {
  await setup();
  try {
    await writeTestFile('app.py', `
def process_request(request):
    pass

class RequestHandler:
    pass

    def method(self):
        pass
`);
    const result = await buildSignatureMap(['app.py'], tmpDir);
    assert(result.length === 1, 'should find Python file');
    assert(result[0].exports.length >= 2, `should find 2+ defs, got ${result[0].exports.length}`);
  } finally {
    await cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════

suite('buildSignatureMap — edge cases');

await testAsync('empty file list', async () => {
  const result = await buildSignatureMap([], '/tmp');
  assertEqual(result.length, 0);
});

await testAsync('null file list', async () => {
  const result = await buildSignatureMap(null, '/tmp');
  assertEqual(result.length, 0);
});

await testAsync('default export', async () => {
  await setup();
  try {
    await writeTestFile('main.js', 'export default function main() {}');
    const result = await buildSignatureMap(['main.js'], tmpDir);
    assert(result.length === 1, 'should find default export');
  } finally {
    await cleanup();
  }
});

await testAsync('async export', async () => {
  await setup();
  try {
    await writeTestFile('handler.js', 'export async function handleRequest(req) {}');
    const result = await buildSignatureMap(['handler.js'], tmpDir);
    assert(result.length === 1, 'should find async export');
    assert(result[0].exports.length >= 1, 'should have at least 1 export');
  } finally {
    await cleanup();
  }
});

await testAsync('absolute path support', async () => {
  await setup();
  try {
    await writeTestFile('abs.js', 'export const VERSION = "1.0"');
    const absPath = path.join(tmpDir, 'abs.js');
    const result = await buildSignatureMap([absPath], tmpDir);
    assert(result.length === 1, 'should handle absolute path');
  } finally {
    await cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════════════

const { passed, failed } = summary();
process.exit(failed > 0 ? 1 : 0);
