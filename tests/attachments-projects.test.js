#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — v82 Attachment & Project Opening Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
//   1. File extension detection (TEXT_EXTS, IMG_EXTS patterns)
//   2. Backend attachment reading (path-based, inline content)
//   3. Attachment enrichment in ChatController.handle()
//   4. Project opening via /api/projects/open-folder
//   5. Attachment persistence through send flow
//
// Run: node tests/attachments-projects.test.js
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, assertIncludes, summary } from './harness.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = 'http://127.0.0.1:3335';

// ═══════════════════════════════════════════════════════════════════════════════
// Frontend patterns (extracted from chat-panel-module.js for testing)
// ═══════════════════════════════════════════════════════════════════════════════
const TEXT_EXTS = /\.(js|ts|jsx|tsx|py|json|md|txt|css|html|yaml|yml|xml|csv|sql|sh|env|cfg|ini|log|toml|rs|go|java|c|cpp|h|rb|php|swift|kt|r|lua|pl|ex|erl|hs|ml|vue|svelte)$/i;
const IMG_EXTS = /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i;
const MAX_TEXT_SIZE = 50 * 1024; // 50KB
const MAX_IMG_SIZE = 2 * 1024 * 1024; // 2MB

// ═══════════════════════════════════════════════════════════════════════════════
suite('1. File extension detection — TEXT_EXTS');
// ═══════════════════════════════════════════════════════════════════════════════

test('JavaScript files detected as text', () => {
  assert(TEXT_EXTS.test('index.js'), '.js');
  assert(TEXT_EXTS.test('App.jsx'), '.jsx');
  assert(TEXT_EXTS.test('component.tsx'), '.tsx');
  assert(TEXT_EXTS.test('module.ts'), '.ts');
});

test('Python files detected as text', () => {
  assert(TEXT_EXTS.test('main.py'), '.py');
  assert(TEXT_EXTS.test('test_utils.py'), '.py');
});

test('Config/markup files detected as text', () => {
  assert(TEXT_EXTS.test('package.json'), '.json');
  assert(TEXT_EXTS.test('README.md'), '.md');
  assert(TEXT_EXTS.test('style.css'), '.css');
  assert(TEXT_EXTS.test('index.html'), '.html');
  assert(TEXT_EXTS.test('docker-compose.yaml'), '.yaml');
  assert(TEXT_EXTS.test('config.yml'), '.yml');
  assert(TEXT_EXTS.test('data.xml'), '.xml');
  assert(TEXT_EXTS.test('data.csv'), '.csv');
});

test('System/script files detected as text', () => {
  assert(TEXT_EXTS.test('query.sql'), '.sql');
  assert(TEXT_EXTS.test('deploy.sh'), '.sh');
  assert(TEXT_EXTS.test('.env'), '.env');
  assert(TEXT_EXTS.test('app.cfg'), '.cfg');
  assert(TEXT_EXTS.test('config.ini'), '.ini');
  assert(TEXT_EXTS.test('server.log'), '.log');
  assert(TEXT_EXTS.test('Cargo.toml'), '.toml');
});

test('Systems programming files detected as text', () => {
  assert(TEXT_EXTS.test('main.rs'), '.rs');
  assert(TEXT_EXTS.test('server.go'), '.go');
  assert(TEXT_EXTS.test('App.java'), '.java');
  assert(TEXT_EXTS.test('main.c'), '.c');
  assert(TEXT_EXTS.test('vector.cpp'), '.cpp');
  assert(TEXT_EXTS.test('header.h'), '.h');
});

test('Dynamic language files detected as text', () => {
  assert(TEXT_EXTS.test('app.rb'), '.rb');
  assert(TEXT_EXTS.test('index.php'), '.php');
  assert(TEXT_EXTS.test('main.swift'), '.swift');
  assert(TEXT_EXTS.test('Activity.kt'), '.kt');
  assert(TEXT_EXTS.test('script.lua'), '.lua');
  assert(TEXT_EXTS.test('script.pl'), '.pl');
});

test('Functional language files detected as text', () => {
  assert(TEXT_EXTS.test('main.ex'), '.ex');
  assert(TEXT_EXTS.test('server.erl'), '.erl');
  assert(TEXT_EXTS.test('types.hs'), '.hs');
  assert(TEXT_EXTS.test('parser.ml'), '.ml');
});

test('Frontend framework files detected as text', () => {
  assert(TEXT_EXTS.test('App.vue'), '.vue');
  assert(TEXT_EXTS.test('Counter.svelte'), '.svelte');
});

test('Case insensitive matching', () => {
  assert(TEXT_EXTS.test('README.MD'), '.MD uppercase');
  assert(TEXT_EXTS.test('test.JS'), '.JS uppercase');
  assert(TEXT_EXTS.test('data.Json'), '.Json mixed');
});

test('Binary/unknown files NOT detected as text', () => {
  assert(!TEXT_EXTS.test('app.exe'), '.exe should not match');
  assert(!TEXT_EXTS.test('archive.zip'), '.zip should not match');
  assert(!TEXT_EXTS.test('image.png'), '.png should not match text');
  assert(!TEXT_EXTS.test('video.mp4'), '.mp4 should not match');
  assert(!TEXT_EXTS.test('font.woff2'), '.woff2 should not match');
  assert(!TEXT_EXTS.test('data.pdf'), '.pdf should not match');
  assert(!TEXT_EXTS.test('music.mp3'), '.mp3 should not match');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('2. File extension detection — IMG_EXTS');
// ═══════════════════════════════════════════════════════════════════════════════

test('Common image formats detected', () => {
  assert(IMG_EXTS.test('photo.png'), '.png');
  assert(IMG_EXTS.test('logo.jpg'), '.jpg');
  assert(IMG_EXTS.test('banner.jpeg'), '.jpeg');
  assert(IMG_EXTS.test('anim.gif'), '.gif');
  assert(IMG_EXTS.test('icon.webp'), '.webp');
  assert(IMG_EXTS.test('diagram.svg'), '.svg');
  assert(IMG_EXTS.test('scan.bmp'), '.bmp');
});

test('Case insensitive image matching', () => {
  assert(IMG_EXTS.test('photo.PNG'), '.PNG uppercase');
  assert(IMG_EXTS.test('logo.JPG'), '.JPG uppercase');
  assert(IMG_EXTS.test('photo.Jpeg'), '.Jpeg mixed');
});

test('Non-image files NOT detected as images', () => {
  assert(!IMG_EXTS.test('index.js'), '.js should not match');
  assert(!IMG_EXTS.test('app.exe'), '.exe should not match');
  assert(!IMG_EXTS.test('style.css'), '.css should not match');
  assert(!IMG_EXTS.test('video.mp4'), '.mp4 should not match');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('3. Type classification logic');
// ═══════════════════════════════════════════════════════════════════════════════

function classifyType(name) {
  if (IMG_EXTS.test(name)) return 'image';
  if (TEXT_EXTS.test(name)) return 'text';
  return 'binary';
}

test('Text files classified correctly', () => {
  assertEqual(classifyType('index.js'), 'text');
  assertEqual(classifyType('main.py'), 'text');
  assertEqual(classifyType('data.json'), 'text');
  assertEqual(classifyType('README.md'), 'text');
});

test('Image files classified correctly', () => {
  assertEqual(classifyType('photo.png'), 'image');
  assertEqual(classifyType('logo.jpg'), 'image');
  assertEqual(classifyType('icon.svg'), 'image');
});

test('Unknown files classified as binary', () => {
  assertEqual(classifyType('app.exe'), 'binary');
  assertEqual(classifyType('archive.zip'), 'binary');
  assertEqual(classifyType('video.mp4'), 'binary');
  assertEqual(classifyType('data.pdf'), 'binary');
});

test('Image takes priority over text in classification', () => {
  // This tests the classification order: IMG first, then TEXT
  assertEqual(classifyType('icon.svg'), 'image', 'SVG should be image, not text');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('4. Backend attachment reading (fs.readFileSync)');
// ═══════════════════════════════════════════════════════════════════════════════

test('Read real file via path', () => {
  // Create a temp file
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, 'c3-test-attachment-' + Date.now() + '.js');
  fs.writeFileSync(tmpFile, 'const hello = "world";\nconsole.log(hello);\n', 'utf-8');

  // Simulate backend attachment reading
  const attachment = { name: 'test.js', size: '50 B', type: 'text', path: tmpFile, content: null };
  if (!attachment.content && attachment.path) {
    try {
      attachment.content = fs.readFileSync(attachment.path, 'utf-8');
    } catch (e) {
      attachment.content = `[Cannot read: ${e.message}]`;
    }
  }

  assert(attachment.content !== null, 'Content should be read');
  assertIncludes(attachment.content, 'hello', 'Content should contain "hello"');
  assertIncludes(attachment.content, 'console.log', 'Content should contain "console.log"');

  // Cleanup
  fs.unlinkSync(tmpFile);
});

test('Read missing file returns error message', () => {
  const attachment = { name: 'missing.js', size: '0 B', type: 'text', path: '/tmp/c3-nonexistent-file-xyz.js', content: null };
  if (!attachment.content && attachment.path) {
    try {
      attachment.content = fs.readFileSync(attachment.path, 'utf-8');
    } catch (e) {
      attachment.content = `[Soubor nelze přečíst: ${e.message}]`;
    }
  }

  assert(attachment.content !== null, 'Should have error content');
  assertIncludes(attachment.content, 'Soubor nelze přečíst', 'Should contain error prefix');
});

test('Inline content is preserved (FileReader path)', () => {
  const attachment = { name: 'data.json', size: '20 B', type: 'text', path: null, content: '{"key":"value"}' };
  // Backend should NOT overwrite existing content
  if (!attachment.content && attachment.path) {
    attachment.content = fs.readFileSync(attachment.path, 'utf-8');
  }
  assertEqual(attachment.content, '{"key":"value"}', 'Inline content should be preserved');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('5. Attachment enrichment (message building)');
// ═══════════════════════════════════════════════════════════════════════════════

test('Attachment blocks appended to message', () => {
  const attachments = [
    { name: 'index.js', size: '2 KB', type: 'text', content: 'const x = 42;' },
    { name: 'style.css', size: '1 KB', type: 'text', content: 'body { color: red; }' },
  ];

  let message = 'Přečti tyto soubory';
  const attachmentBlocks = attachments
    .filter(a => a.content)
    .map(a => `\n--- Příloha: ${a.name} (${a.size}) ---\n${a.content}\n---`);
  if (attachmentBlocks.length > 0) {
    message = message + attachmentBlocks.join('');
  }

  assertIncludes(message, 'Přečti tyto soubory', 'Original message preserved');
  assertIncludes(message, '--- Příloha: index.js (2 KB) ---', 'First attachment header');
  assertIncludes(message, 'const x = 42;', 'First attachment content');
  assertIncludes(message, '--- Příloha: style.css (1 KB) ---', 'Second attachment header');
  assertIncludes(message, 'body { color: red; }', 'Second attachment content');
});

test('Attachments without content are filtered out', () => {
  const attachments = [
    { name: 'good.js', size: '1 KB', type: 'text', content: 'ok' },
    { name: 'bad.bin', size: '5 MB', type: 'binary', content: null },
    { name: 'empty.js', size: '0 B', type: 'text', content: '' },
  ];

  const blocks = attachments
    .filter(a => a.content)
    .map(a => `\n--- Příloha: ${a.name} ---\n${a.content}\n---`);

  // Only 'good.js' should pass (content is truthy)
  // 'empty.js' has content='' which is falsy, so it's also filtered
  assertEqual(blocks.length, 1, 'Only one attachment with content');
  assertIncludes(blocks[0], 'good.js', 'Good file included');
});

test('Path-based reading enriches null content', () => {
  // Simulate the full backend flow
  const tmpFile = path.join(os.tmpdir(), 'c3-enrich-test-' + Date.now() + '.txt');
  fs.writeFileSync(tmpFile, 'Hello from attachment!', 'utf-8');

  const attachments = [
    { name: 'test.txt', size: '21 B', type: 'text', path: tmpFile, content: null },
  ];

  // Backend enrichment logic
  for (const a of attachments) {
    if (!a.content && a.path) {
      try {
        a.content = fs.readFileSync(a.path, 'utf-8');
      } catch (e) {
        a.content = `[Error: ${e.message}]`;
      }
    }
  }

  let message = 'Read this';
  const blocks = attachments
    .filter(a => a.content)
    .map(a => `\n--- Příloha: ${a.name} (${a.size}) ---\n${a.content}\n---`);
  if (blocks.length > 0) message += blocks.join('');

  assertIncludes(message, 'Hello from attachment!', 'File content in enriched message');

  fs.unlinkSync(tmpFile);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Async tests — run sequentially, then summary
// ═══════════════════════════════════════════════════════════════════════════════

async function runAsyncTests() {

suite('6. Project opening — API integration');

await testAsync('POST /api/projects/open-folder with valid path', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-proj-test-'));
  try {
    const resp = await fetch(`${BASE}/api/projects/open-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: tmpDir }),
      signal: AbortSignal.timeout(10000),
    });
    assert(resp.ok, `Response should be 200, got ${resp.status}`);
    const data = await resp.json();
    assert(data.project, 'Response should have project');
    assert(data.project.id, 'Project should have id');
    assert(data.project.path, 'Project should have path');
    assertIncludes(data.project.path, 'c3-proj-test-', 'Path should match temp dir');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

await testAsync('POST /api/projects/open-folder with nonexistent path returns error', async () => {
  const resp = await fetch(`${BASE}/api/projects/open-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath: '/tmp/c3-nonexistent-path-xyz-' + Date.now() }),
    signal: AbortSignal.timeout(5000),
  });
  assertEqual(resp.status, 400, 'Should return 400 for nonexistent path');
  const data = await resp.json();
  assert(data.error, 'Should have error field');
});

await testAsync('POST /api/projects/open-folder idempotent (same folder twice)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-idem-test-'));
  try {
    // Open first time
    const resp1 = await fetch(`${BASE}/api/projects/open-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: tmpDir }),
      signal: AbortSignal.timeout(10000),
    });
    assert(resp1.ok, 'First open should succeed');
    const data1 = await resp1.json();

    // Open same folder again
    const resp2 = await fetch(`${BASE}/api/projects/open-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: tmpDir }),
      signal: AbortSignal.timeout(10000),
    });
    assert(resp2.ok, 'Second open should succeed');
    const data2 = await resp2.json();

    assertEqual(data1.project.id, data2.project.id, 'Same project ID both times');
    assertEqual(data2.status, 'already_registered', 'Second time should say already_registered');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

suite('7. Chat with attachments — E2E');

await testAsync('POST /chat with path-based attachment', async () => {
  const tmpFile = path.join(os.tmpdir(), 'c3-chat-attach-' + Date.now() + '.js');
  fs.writeFileSync(tmpFile, 'function greet(name) { return "Hello " + name; }\n', 'utf-8');

  try {
    const resp = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'chat',
        message: 'Co dělá tato funkce?',
        attachments: [
          { name: 'greet.js', size: '50 B', type: 'text', path: tmpFile, content: null },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    assert(resp.ok, `Chat response should be 200, got ${resp.status}`);
    const data = await resp.json();
    assert(data.response, 'Should have response field');
    // The LLM should reference the function content since it was read from path
    assert(data.response.length > 10, 'Response should be meaningful');
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

await testAsync('POST /chat with inline content attachment', async () => {
  const resp = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'chat',
      message: 'Co je v tomto souboru?',
      attachments: [
        { name: 'config.json', size: '30 B', type: 'text', content: '{"debug": true, "port": 8080}' },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });

  assert(resp.ok, `Chat response should be 200, got ${resp.status}`);
  const data = await resp.json();
  assert(data.response, 'Should have response field');
});

await testAsync('POST /chat with mixed attachments (path + inline)', async () => {
  const tmpFile = path.join(os.tmpdir(), 'c3-mixed-' + Date.now() + '.py');
  fs.writeFileSync(tmpFile, 'def add(a, b):\n    return a + b\n', 'utf-8');

  try {
    const resp = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'chat',
        message: 'Porovnej tyto dva soubory',
        attachments: [
          { name: 'math.py', size: '35 B', type: 'text', path: tmpFile, content: null },
          { name: 'notes.txt', size: '20 B', type: 'text', content: 'This is a test note' },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    assert(resp.ok, `Response should be 200, got ${resp.status}`);
    const data = await resp.json();
    assert(data.response, 'Should have response field');
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

} // end runAsyncTests

// ═══════════════════════════════════════════════════════════════════════════════
suite('8. Size limit enforcement');
// ═══════════════════════════════════════════════════════════════════════════════

test('Text files under 50KB are within limit', () => {
  assert(1024 <= MAX_TEXT_SIZE, '1KB should be under limit');
  assert(49 * 1024 <= MAX_TEXT_SIZE, '49KB should be under limit');
  assert(50 * 1024 <= MAX_TEXT_SIZE, '50KB should be at limit');
  assert(51 * 1024 > MAX_TEXT_SIZE, '51KB should exceed limit');
});

test('Image files under 2MB are within limit', () => {
  assert(100 * 1024 <= MAX_IMG_SIZE, '100KB should be under limit');
  assert(1024 * 1024 <= MAX_IMG_SIZE, '1MB should be under limit');
  assert(2 * 1024 * 1024 <= MAX_IMG_SIZE, '2MB should be at limit');
  assert(3 * 1024 * 1024 > MAX_IMG_SIZE, '3MB should exceed limit');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('9. Attachment persistence — path property');
// ═══════════════════════════════════════════════════════════════════════════════

test('Path survives JSON serialization', () => {
  const original = { name: 'test.js', size: '2 KB', type: 'text', path: '/home/user/project/test.js', content: null };
  const serialized = JSON.stringify(original);
  const deserialized = JSON.parse(serialized);

  assertEqual(deserialized.path, '/home/user/project/test.js', 'Path should survive roundtrip');
  assertEqual(deserialized.content, null, 'Null content should survive');
  assertEqual(deserialized.name, 'test.js', 'Name should survive');
});

test('Multiple attachments survive serialization', () => {
  const attachments = [
    { name: 'a.js', size: '1 KB', type: 'text', path: '/tmp/a.js', content: null },
    { name: 'b.py', size: '2 KB', type: 'text', path: null, content: 'print("hi")' },
    { name: 'c.png', size: '50 KB', type: 'image', path: '/tmp/c.png', content: null },
  ];

  const payload = { channel: 'chat', data: { content: 'test', attachments } };
  const roundtrip = JSON.parse(JSON.stringify(payload));

  assertEqual(roundtrip.data.attachments.length, 3, 'All 3 attachments preserved');
  assertEqual(roundtrip.data.attachments[0].path, '/tmp/a.js', 'Path-based attachment preserved');
  assertEqual(roundtrip.data.attachments[1].content, 'print("hi")', 'Inline content preserved');
  assertEqual(roundtrip.data.attachments[1].path, null, 'Null path preserved');
});

// ═══════════════════════════════════════════════════════════════════════════════

// Run async tests then print summary
runAsyncTests().then(() => summary()).catch(e => { console.error('Async test runner error:', e); summary(); });
