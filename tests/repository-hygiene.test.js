#!/usr/bin/env node
// Gate 0 tracked-file and reproducible-install guard. It never opens runtime data.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const listed = spawnSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
});

assert.equal(listed.error, undefined, String(listed.error));
assert.equal(listed.status, 0, listed.stderr);

const tracked = listed.stdout.split('\0').filter(Boolean);
const trackedSet = new Set(tracked);
for (const lockPath of [
  'package-lock.json',
  'c3-ide/yarn.lock',
  'requirements/pdf-export.lock',
]) {
  assert.equal(trackedSet.has(lockPath), true, `required dependency lock is not tracked: ${lockPath}`);
}
assert.equal(
  trackedSet.has('c3-ide/applications/electron/webpack.config.js'),
  true,
  'tracked C3 Studio webpack hardening config is missing',
);

const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const idePackage = JSON.parse(readFileSync(resolve(repoRoot, 'c3-ide/package.json'), 'utf8'));
const electronPackage = JSON.parse(readFileSync(
  resolve(repoRoot, 'c3-ide/applications/electron/package.json'),
  'utf8',
));
const installer = readFileSync(resolve(repoRoot, 'scripts/install.sh'), 'utf8');
const electronWebpack = readFileSync(
  resolve(repoRoot, 'c3-ide/applications/electron/webpack.config.js'),
  'utf8',
);
const ideLock = readFileSync(resolve(repoRoot, 'c3-ide/yarn.lock'), 'utf8');
assert.equal(rootPackage.packageManager, 'npm@10.9.4');
assert.equal(rootPackage.engines?.node, '>=22.0.0 <23');
assert.equal(idePackage.packageManager, 'yarn@1.22.22');
assert.equal(idePackage.engines?.node, '>=22.0.0 <23');
assert.equal(idePackage.resolutions?.['@vscode/ripgrep'], '1.18.0');
assert.equal(electronPackage.devDependencies?.['terser-webpack-plugin'], '5.3.17');
assert.equal(electronPackage.devDependencies?.webpack, '5.109.2');
assert.equal(electronPackage.devDependencies?.['webpack-cli'], '4.7.0');
for (const workspaceKind of ['applications', 'extensions']) {
  const workspaceRoot = resolve(repoRoot, 'c3-ide', workspaceKind);
  for (const workspaceName of readdirSync(workspaceRoot)) {
    const packagePath = resolve(workspaceRoot, workspaceName, 'package.json');
    if (!existsSync(packagePath)) {
      continue;
    }
    const workspacePackage = JSON.parse(readFileSync(packagePath, 'utf8'));
    for (const dependencySet of [
      workspacePackage.dependencies ?? {},
      workspacePackage.devDependencies ?? {},
    ]) {
      for (const [dependency, version] of Object.entries(dependencySet)) {
        if (dependency.startsWith('@theia/')) {
          assert.equal(
            version,
            '1.65.2',
            `${workspaceKind}/${workspaceName} drifts ${dependency} to ${version}`,
          );
        }
      }
    }
  }
}
assert.match(installer, /\bnpm ci\b/);
assert.match(installer, /yarn install --frozen-lockfile --non-interactive/);
assert.match(installer, /YARN_VERSION="\$\(cd c3-ide && yarn --version\)"/);
assert.match(installer, /\(cd c3-ide && yarn build /);
assert.match(installer, /c3-ide\/node_modules\/\.bin\/electron-rebuild/);
assert.match(installer, /find-git-repositories,drivelist,keytar,ssh2,cpu-features/);
assert.match(installer, /ELECTRON_RUN_AS_NODE=1/);
assert.match(installer, /ripgrep 15\.0\.0/);
assert.doesNotMatch(installer, /\bnpx\b/);
assert.doesNotMatch(installer, /npm install --legacy-peer-deps/);
assert.doesNotMatch(installer, /trying without/i);
assert.doesNotMatch(installer, /non-critical modules/i);
assert.doesNotMatch(installer, /ollama pull "\$PRIMARY" \|\|/);
assert.doesNotMatch(installer, /ollama pull "\$REASONING" \|\|/);
assert.match(electronWebpack, /@vscode\/ripgrep-\$\{process\.platform\}-\$\{arch\}/);
assert.match(electronWebpack, /configs\[2\]\.entry\.preload/);
assert.doesNotMatch(
  electronWebpack,
  /require\.resolve\([`'"]@vscode\/ripgrep\/bin\/rg/,
);
for (const platformPackage of [
  '@vscode/ripgrep-darwin-arm64@1.18.0',
  '@vscode/ripgrep-darwin-x64@1.18.0',
  '@vscode/ripgrep-linux-arm@1.18.0',
  '@vscode/ripgrep-linux-arm64@1.18.0',
  '@vscode/ripgrep-linux-ia32@1.18.0',
  '@vscode/ripgrep-linux-ppc64@1.18.0',
  '@vscode/ripgrep-linux-riscv64@1.18.0',
  '@vscode/ripgrep-linux-s390x@1.18.0',
  '@vscode/ripgrep-linux-x64@1.18.0',
  '@vscode/ripgrep-win32-arm64@1.18.0',
  '@vscode/ripgrep-win32-ia32@1.18.0',
  '@vscode/ripgrep-win32-x64@1.18.0',
]) {
  const escaped = platformPackage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    ideLock,
    new RegExp(`"${escaped}":\\n  version "1\\.18\\.0"\\n  resolved "[^"]+"\\n  integrity sha512-`),
  );
}
assert.doesNotMatch(ideLock, /1\.15\.14/);

const exactGeneratedLeaks = new Set([
  '.c3-backend.log.old',
  'login.html',
  'templates/admin/dashboard.html',
  'templates/products/detail.html',
  'tests/e2e-transcript-all-2026-04-13.md',
  'tests/test_auth.py',
  'tests/test_models.py',
  'tests/intent-classifier.test.js',
]);

const prohibited = tracked.filter(path => (
  exactGeneratedLeaks.has(path)
  || path.startsWith('projects/')
  || /^chats\/conv-[^/]+\/attachments\//i.test(path)
  || path.startsWith('docs/archive/conversations/')
  || path.startsWith('e2e-review/')
  || path.startsWith('test-reports/')
  || /^data\/.*\.(?:db(?:[.-].*)?|sql|malformed|pre-recover)$/i.test(path)
  || /^tests\/e2e-transcript-.*\.md$/i.test(path)
));

assert.deepEqual(
  prohibited,
  [],
  `tracked runtime/private/generated paths: ${prohibited.join(', ')}`,
);

console.log(`Repository hygiene guard passed (${tracked.length} tracked paths checked)`);
