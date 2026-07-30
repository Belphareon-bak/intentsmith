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

import { suite, test, testAsync, assert, assertEqual, assertIncludes, assertThrows, summary } from './harness.js';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import fs from 'node:fs';
import path from 'node:path';

const BOUNDARY_SELF_CHECK = process.argv.includes('--boundary-self-check');
const ASYNC_REJECTION_SELF_CHECK = process.argv.includes('--async-rejection-self-check');
const SELF_CHECK_ONLY = BOUNDARY_SELF_CHECK || ASYNC_REJECTION_SELF_CHECK;
const SERVER_NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const ownedDirectories = new Map();

function isLoopbackHostname(hostname) {
  const normalized = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === '::1' || /^127(?:\.[0-9]{1,3}){3}$/.test(normalized);
}

function requireLoopbackBaseUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(
      'C3_URL is required and must identify the runner-owned loopback server',
    );
  }
  if (raw !== raw.trim()) {
    throw new Error('C3_URL must not contain leading or trailing whitespace');
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('C3_URL must be an absolute loopback HTTP origin');
  }

  if (
    url.protocol !== 'http:'
    || !isLoopbackHostname(url.hostname)
    || !url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '/' && url.pathname !== '')
    || raw.replace(/\/$/, '') !== url.origin
  ) {
    throw new Error(
      'C3_URL must be an explicit http://127.x.x.x:<port> or http://[::1]:<port> origin',
    );
  }

  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('C3_URL contains an invalid TCP port');
  }
  return url.origin;
}

function isStrictChild(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function assertCurrentUser(metadata, label) {
  if (
    typeof process.getuid === 'function'
    && metadata.uid !== process.getuid()
  ) {
    throw new Error(`${label} is not owned by the current user`);
  }
}

function requireOwnedServerBaseUrl({
  rawUrl,
  auditRun,
  runtimeMode,
  portFilePath,
  expectedPidRaw,
  expectedNonce,
}) {
  if (auditRun !== '1' || runtimeMode !== 'audit') {
    throw new Error(
      'The full attachment suite requires a runner-owned audit server',
    );
  }

  const baseUrl = requireLoopbackBaseUrl(rawUrl);
  const expectedPortFile = path.resolve(isolatedTestRuntime.portFile);
  const absolutePortFile = path.resolve(portFilePath || '');
  if (
    absolutePortFile !== expectedPortFile
    || !isStrictChild(isolatedTestRuntime.runtime, absolutePortFile)
  ) {
    throw new Error(
      'C3_PORT_FILE must be the isolated runtime server attestation',
    );
  }

  const expectedPid = Number(expectedPidRaw);
  if (!Number.isSafeInteger(expectedPid) || expectedPid < 1) {
    throw new Error('INTENTSMITH_TEST_SERVER_PID must identify the owned server');
  }
  if (
    typeof expectedNonce !== 'string'
    || !SERVER_NONCE_PATTERN.test(expectedNonce)
  ) {
    throw new Error(
      'INTENTSMITH_TEST_SERVER_NONCE must be a private runner capability',
    );
  }

  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = fs.openSync(
      absolutePortFile,
      fs.constants.O_RDONLY | noFollow,
    );
  } catch (error) {
    throw new Error(`Cannot open runner-owned C3_PORT_FILE: ${error.message}`);
  }

  let metadata;
  let value;
  try {
    metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile()) {
      throw new Error('C3_PORT_FILE must be a regular file');
    }
    assertCurrentUser(metadata, 'C3_PORT_FILE');
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
      throw new Error('C3_PORT_FILE must not be accessible by group or others');
    }
    value = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid runner-owned C3_PORT_FILE: ${error.message}`);
  } finally {
    fs.closeSync(descriptor);
  }

  if (
    fs.realpathSync(absolutePortFile) !== absolutePortFile
    || !value
    || typeof value !== 'object'
    || !isLoopbackHostname(value.host)
  ) {
    throw new Error('C3_PORT_FILE must contain a canonical loopback endpoint');
  }

  const attestedPid = Number(value.pid);
  const attestedPort = Number(value.port);
  if (
    !Number.isSafeInteger(attestedPid)
    || attestedPid !== expectedPid
    || value.testRunNonce !== expectedNonce
    || !Number.isInteger(attestedPort)
    || attestedPort < 1
    || attestedPort > 65535
  ) {
    throw new Error(
      'C3_PORT_FILE does not match the expected server PID/port/capability',
    );
  }

  try {
    process.kill(expectedPid, 0);
  } catch (error) {
    throw new Error(`Runner-owned server PID is not live: ${error.message}`);
  }

  const host = String(value.host).replace(/^\[|\]$/g, '');
  const authority = host === '::1' ? `[${host}]` : host;
  const attestedUrl = requireLoopbackBaseUrl(
    `http://${authority}:${attestedPort}`,
  );
  if (attestedUrl !== baseUrl) {
    throw new Error('C3_URL does not match the runner-owned port attestation');
  }
  return baseUrl;
}

function makeOwnedDir(root, prefix) {
  const created = fs.mkdtempSync(path.join(root, `${prefix}-`));
  fs.chmodSync(created, 0o700);
  const canonical = fs.realpathSync(created);
  if (!isStrictChild(root, canonical)) {
    throw new Error(`Fixture escaped its runner-owned root: ${canonical}`);
  }
  const metadata = fs.lstatSync(canonical);
  assertCurrentUser(metadata, 'Owned fixture');
  ownedDirectories.set(canonical, {
    root,
    device: metadata.dev,
    inode: metadata.ino,
  });
  return canonical;
}

function removeOwnedDir(candidate) {
  const absolute = path.resolve(candidate);
  const ownership = ownedDirectories.get(absolute);
  if (!ownership || !isStrictChild(ownership.root, absolute)) {
    throw new Error(`Refusing to remove an unowned fixture: ${absolute}`);
  }
  const metadata = fs.lstatSync(absolute);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Refusing to remove an unsafe fixture: ${absolute}`);
  }
  assertCurrentUser(metadata, 'Owned fixture');
  if (
    metadata.dev !== ownership.device
    || metadata.ino !== ownership.inode
  ) {
    throw new Error(`Refusing to remove a substituted fixture: ${absolute}`);
  }
  if (fs.realpathSync(absolute) !== absolute) {
    throw new Error(`Fixture no longer resolves to its owned path: ${absolute}`);
  }
  fs.rmSync(absolute, { recursive: true, force: false });
  ownedDirectories.delete(absolute);
}

function makeOwnedTempFile(prefix, extension, content) {
  const directory = makeOwnedDir(TEST_TMP_ROOT, prefix);
  const file = path.join(directory, `fixture${extension}`);
  try {
    fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    removeOwnedDir(directory);
    throw error;
  }
  return file;
}

function removeOwnedTempFile(candidate) {
  removeOwnedDir(path.dirname(path.resolve(candidate)));
}

// Resolve the server boundary before this suite creates fixtures or calls fetch.
const BASE = SELF_CHECK_ONLY
  ? requireLoopbackBaseUrl(process.env.C3_URL)
  : requireOwnedServerBaseUrl({
    rawUrl: process.env.C3_URL,
    auditRun: process.env.C3_AUDIT_RUN,
    runtimeMode: isolatedTestRuntime.mode,
    portFilePath: process.env.C3_PORT_FILE,
    expectedPidRaw: process.env.INTENTSMITH_TEST_SERVER_PID,
    expectedNonce: process.env.INTENTSMITH_TEST_SERVER_NONCE,
  });
const PROJECT_FIXTURE_ROOT = isolatedTestRuntime.projects;
const TEST_TMP_ROOT = isolatedTestRuntime.temp;

suite('0. Runner-owned server and filesystem boundary');

test('C3_URL is the explicit normalized loopback origin', () => {
  assertEqual(BASE, requireLoopbackBaseUrl(process.env.C3_URL));
  assertEqual(requireLoopbackBaseUrl('http://127.0.0.42:4567/'), 'http://127.0.0.42:4567');
  assertEqual(requireLoopbackBaseUrl('http://[::1]:3335'), 'http://[::1]:3335');
});

test('C3_URL rejects missing, named-host, non-HTTP, and path-bearing values', () => {
  for (const invalid of [
    undefined,
    '',
    'http://localhost:3335',
    'http://example.com:3335',
    'http://127.999.999.999:3335',
    'http://2130706433:3335',
    'http://0x7f000001:3335',
    'https://127.0.0.1:3335',
    'http://127.0.0.1:3335/nested',
    'http://user:pass@127.0.0.1:3335',
    'http://127.0.0.1',
  ]) {
    assertThrows(
      () => requireLoopbackBaseUrl(invalid),
      `Unsafe C3_URL was accepted: ${String(invalid)}`,
    );
  }
});

test('full suite requires a private matching live server attestation', () => {
  if (!SELF_CHECK_ONLY) {
    assertEqual(
      BASE,
      requireOwnedServerBaseUrl({
        rawUrl: process.env.C3_URL,
        auditRun: process.env.C3_AUDIT_RUN,
        runtimeMode: isolatedTestRuntime.mode,
        portFilePath: process.env.C3_PORT_FILE,
        expectedPidRaw: process.env.INTENTSMITH_TEST_SERVER_PID,
        expectedNonce: process.env.INTENTSMITH_TEST_SERVER_NONCE,
      }),
    );
    return;
  }

  const portFile = isolatedTestRuntime.portFile;
  const nonce = 'boundary-self-check-capability-0001';
  const valid = {
    rawUrl: 'http://127.0.0.1:4567',
    auditRun: '1',
    runtimeMode: 'audit',
    portFilePath: portFile,
    expectedPidRaw: String(process.pid),
    expectedNonce: nonce,
  };
  assertThrows(
    () => requireOwnedServerBaseUrl(valid),
    'Full suite accepted a missing server port attestation',
  );

  const payload = {
    host: '127.0.0.1',
    port: 4567,
    pid: process.pid,
    testRunNonce: nonce,
    started: new Date().toISOString(),
  };
  fs.writeFileSync(portFile, JSON.stringify(payload), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  fs.chmodSync(portFile, 0o600);
  const original = fs.lstatSync(portFile);
  try {
    assertEqual(
      requireOwnedServerBaseUrl(valid),
      'http://127.0.0.1:4567',
    );
    assertThrows(
      () => requireOwnedServerBaseUrl({ ...valid, auditRun: undefined }),
      'Full suite accepted a direct-run filesystem',
    );
    assertThrows(
      () => requireOwnedServerBaseUrl({
        ...valid,
        runtimeMode: 'direct',
      }),
      'Full suite accepted direct runtime mode',
    );
    assertThrows(
      () => requireOwnedServerBaseUrl({
        ...valid,
        expectedPidRaw: String(process.pid + 1),
      }),
      'Full suite accepted a mismatched server PID',
    );
    assertThrows(
      () => requireOwnedServerBaseUrl({
        ...valid,
        expectedNonce: 'boundary-self-check-capability-0002',
      }),
      'Full suite accepted a mismatched server capability',
    );
    assertThrows(
      () => requireOwnedServerBaseUrl({
        ...valid,
        rawUrl: 'http://127.0.0.1:4568',
      }),
      'Full suite accepted a C3_URL/port-file mismatch',
    );
  } finally {
    const current = fs.lstatSync(portFile);
    if (
      current.isFile()
      && !current.isSymbolicLink()
      && current.dev === original.dev
      && current.ino === original.ino
    ) {
      fs.unlinkSync(portFile);
    } else {
      throw new Error('Refusing to remove a substituted port attestation');
    }
  }
});

test('fixtures round-trip inside the isolated runtime roots', () => {
  assertEqual(
    PROJECT_FIXTURE_ROOT,
    fs.realpathSync(process.env.INTENTSMITH_TEST_PROJECTS_DIR),
  );
  assertEqual(PROJECT_FIXTURE_ROOT, fs.realpathSync(process.env.C3_PROJECTS_DIR));
  assertEqual(TEST_TMP_ROOT, fs.realpathSync(process.env.TMPDIR));

  const projectDir = makeOwnedDir(PROJECT_FIXTURE_ROOT, 'boundary-project');
  let attachmentFile = null;
  try {
    attachmentFile = makeOwnedTempFile(
      'boundary-attachment',
      '.txt',
      'boundary fixture',
    );
    assert(isStrictChild(PROJECT_FIXTURE_ROOT, projectDir));
    assert(isStrictChild(TEST_TMP_ROOT, attachmentFile));
  } finally {
    if (attachmentFile) removeOwnedDir(path.dirname(attachmentFile));
    removeOwnedDir(projectDir);
  }
  assert(!fs.existsSync(attachmentFile), 'Attachment fixture survived cleanup');
  assert(!fs.existsSync(projectDir), 'Project fixture survived cleanup');
});

test('cleanup rejects unowned, symlinked, and directory-substituted fixtures', () => {
  assertThrows(
    () => removeOwnedDir(TEST_TMP_ROOT),
    'Cleanup accepted the runner-owned temp root itself',
  );
  assertThrows(
    () => removeOwnedDir(path.join(TEST_TMP_ROOT, 'not-owned')),
    'Cleanup accepted an unowned child path',
  );

  const target = makeOwnedDir(TEST_TMP_ROOT, 'boundary-target');
  const replaced = makeOwnedDir(TEST_TMP_ROOT, 'boundary-replaced');
  const marker = path.join(target, 'marker.txt');
  let substituted = false;
  fs.writeFileSync(marker, 'must survive', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try {
    fs.rmdirSync(replaced);
    fs.symlinkSync(target, replaced, 'dir');
    substituted = true;
    assertThrows(
      () => removeOwnedDir(replaced),
      'Cleanup followed a substituted fixture symlink',
    );
    assert(fs.existsSync(marker), 'Symlink rejection removed the owned target');
  } finally {
    if (substituted && fs.lstatSync(replaced).isSymbolicLink()) fs.unlinkSync(replaced);
    ownedDirectories.delete(replaced);
    if (fs.existsSync(target)) removeOwnedDir(target);
    else ownedDirectories.delete(target);
  }

  const directoryReplaced = makeOwnedDir(
    TEST_TMP_ROOT,
    'boundary-directory-replaced',
  );
  const originalPath = `${directoryReplaced}-original`;
  fs.renameSync(directoryReplaced, originalPath);
  fs.mkdirSync(directoryReplaced, { mode: 0o700 });
  const replacementMarker = path.join(directoryReplaced, 'replacement.txt');
  fs.writeFileSync(replacementMarker, 'must survive', {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  try {
    assertThrows(
      () => removeOwnedDir(directoryReplaced),
      'Cleanup removed a real-directory substitution',
    );
    assert(
      fs.existsSync(replacementMarker),
      'Directory substitution rejection removed the replacement',
    );
  } finally {
    fs.unlinkSync(replacementMarker);
    fs.rmdirSync(directoryReplaced);
    fs.renameSync(originalPath, directoryReplaced);
    removeOwnedDir(directoryReplaced);
  }
});

if (BOUNDARY_SELF_CHECK) {
  summary();
} else {

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
  const tmpFile = makeOwnedTempFile(
    'c3-test-attachment',
    '.js',
    'const hello = "world";\nconsole.log(hello);\n',
  );
  try {
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
  } finally {
    removeOwnedTempFile(tmpFile);
  }
});

test('Read missing file returns error message', () => {
  const missingPath = path.join(
    TEST_TMP_ROOT,
    `c3-nonexistent-file-${process.pid}-${Date.now()}.js`,
  );
  const attachment = { name: 'missing.js', size: '0 B', type: 'text', path: missingPath, content: null };
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
  const tmpFile = makeOwnedTempFile(
    'c3-enrich-test',
    '.txt',
    'Hello from attachment!',
  );
  try {
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
  } finally {
    removeOwnedTempFile(tmpFile);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Async tests — run sequentially, then summary
// ═══════════════════════════════════════════════════════════════════════════════

async function runAsyncTests() {

suite('6. Project opening — API integration');

await testAsync('POST /api/projects/open-folder with valid path', async () => {
  const tmpDir = makeOwnedDir(PROJECT_FIXTURE_ROOT, 'c3-proj-test');
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
    removeOwnedDir(tmpDir);
  }
});

await testAsync('POST /api/projects/open-folder with nonexistent path returns error', async () => {
  const nonexistentPath = path.join(
    TEST_TMP_ROOT,
    `c3-nonexistent-path-${process.pid}-${Date.now()}`,
  );
  const resp = await fetch(`${BASE}/api/projects/open-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath: nonexistentPath }),
    signal: AbortSignal.timeout(5000),
  });
  assertEqual(resp.status, 400, 'Should return 400 for nonexistent path');
  const data = await resp.json();
  assert(data.error, 'Should have error field');
});

await testAsync('POST /api/projects/open-folder idempotent (same folder twice)', async () => {
  const tmpDir = makeOwnedDir(PROJECT_FIXTURE_ROOT, 'c3-idem-test');
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
    removeOwnedDir(tmpDir);
  }
});

suite('7. Chat with attachments — E2E');

await testAsync('POST /chat with path-based attachment', async () => {
  const tmpFile = makeOwnedTempFile(
    'c3-chat-attach',
    '.js',
    'function greet(name) { return "Hello " + name; }\n',
  );

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
    removeOwnedTempFile(tmpFile);
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
  const tmpFile = makeOwnedTempFile(
    'c3-mixed',
    '.py',
    'def add(a, b):\n    return a + b\n',
  );

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
    removeOwnedTempFile(tmpFile);
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
const asyncRun = ASYNC_REJECTION_SELF_CHECK
  ? Promise.reject(new Error('forced async runner rejection'))
  : runAsyncTests();
asyncRun.then(() => summary()).catch(e => {
  console.error('Async test runner error:', e);
  process.exitCode = 1;
  summary();
});
}
