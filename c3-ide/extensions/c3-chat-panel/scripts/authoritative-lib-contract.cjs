#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const packageRoot = path.resolve(__dirname, '..');
const packageFile = path.join(packageRoot, 'package.json');
const requiredRuntimeFiles = Object.freeze([
  'lib/browser/agent-client.js',
  'lib/browser/agent-log-renderer.js',
  'lib/browser/chat-panel-module.js',
  'lib/browser/event-bus.js',
  'lib/browser/styles/c3-chat.css',
  'lib/browser/styles/c3-theme.css',
  'lib/browser/terminal-client.js',
  'lib/browser/ws-client.js',
]);
const forbiddenGeneratedSuffixes = Object.freeze([
  '.d.ts',
  '.map',
  '.tsbuildinfo',
]);

function fail(message) {
  throw new Error(`@c3/chat-panel authoritative lib contract: ${message}`);
}

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isSymbolicLink()) fail(`symlink is not allowed: ${absolute}`);
    if (entry.isDirectory()) files.push(...walkFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
    else fail(`unsupported filesystem entry: ${absolute}`);
  }
  return files;
}

function verify() {
  const manifest = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  if (manifest.main !== 'lib/browser/chat-panel-module.js') {
    fail('main must point to lib/browser/chat-panel-module.js');
  }
  if (
    !Array.isArray(manifest.theiaExtensions)
    || manifest.theiaExtensions.length !== 1
    || manifest.theiaExtensions[0]?.frontend !== 'lib/browser/chat-panel-module'
  ) {
    fail('Theia frontend must point to lib/browser/chat-panel-module');
  }
  if (Object.prototype.hasOwnProperty.call(manifest, 'typings')) {
    fail('typings must not advertise a declaration file that does not exist');
  }
  if (JSON.stringify(manifest.files) !== JSON.stringify(['lib', 'README.md', 'scripts'])) {
    fail('published files must be exactly lib, README.md and scripts');
  }

  for (const relative of requiredRuntimeFiles) {
    const absolute = path.join(packageRoot, relative);
    const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      fail(`required regular file is missing: ${relative}`);
    }
    if (stat.size === 0) fail(`required runtime file is empty: ${relative}`);
    if (relative.endsWith('.js')) {
      new vm.Script(fs.readFileSync(absolute, 'utf8'), { filename: relative });
    }
  }

  const libRoot = path.join(packageRoot, 'lib');
  for (const absolute of walkFiles(libRoot)) {
    const relative = path.relative(packageRoot, absolute);
    if (forbiddenGeneratedSuffixes.some(suffix => relative.endsWith(suffix))) {
      fail(`stale TypeScript output is not allowed in authoritative lib: ${relative}`);
    }
  }

  process.stdout.write(
    `@c3/chat-panel authoritative lib valid: ${requiredRuntimeFiles.length} required files\n`,
  );
}

const mode = process.argv[2] || 'verify';
try {
  verify();
  if (mode === 'preserve-clean') {
    process.stdout.write('clean is intentionally a no-op; authoritative lib was preserved\n');
  } else if (mode === 'reject-watch') {
    process.stderr.write(
      'package-level TypeScript watch is disabled; use the product-level Studio build\n',
    );
    process.exitCode = 2;
  } else if (mode !== 'verify') {
    fail(`unknown mode: ${mode}`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
