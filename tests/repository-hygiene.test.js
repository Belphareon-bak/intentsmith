#!/usr/bin/env node
// Gate 0 tracked-file and reproducible-install guard. It never opens runtime data.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
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
assert.equal(
  trackedSet.has('c3-ide/applications/electron/c3-local-http-bootstrap.js'),
  true,
  'tracked C3 Studio local HTTP bootstrap is missing',
);
assert.equal(
  trackedSet.has('c3-ide/applications/electron/c3-local-access.js'),
  true,
  'tracked C3 Studio private local-access reader is missing',
);
assert.equal(
  trackedSet.has('c3-ide/applications/electron/c3-local-origin-normalizer.js'),
  true,
  'tracked C3 Studio opaque-origin normalizer is missing',
);
assert.equal(
  trackedSet.has('c3-ide/shared/legacy-local-object-url-cache.js'),
  true,
  'tracked legacy local media object-URL cache is missing',
);
assert.equal(
  trackedSet.has('c3-ide/extensions/c3-chat-panel/scripts/authoritative-lib-contract.cjs'),
  true,
  'tracked C3 Studio authoritative-lib contract is missing',
);
assert.equal(
  trackedSet.has('docs/archive/c3-studio/c3-chat-panel-ts-prototype/README.md'),
  true,
  'archived chat-panel prototype provenance is missing',
);
assert.equal(
  tracked.some(file => file.startsWith('c3-ide/extensions/c3-chat-panel/src/')),
  false,
  'stale chat-panel TypeScript must not remain in the active workspace',
);
assert.equal(
  trackedSet.has('c3-ide/extensions/c3-chat-panel/tsconfig.json'),
  false,
  'stale chat-panel TypeScript build config must not remain active',
);
assert.equal(
  trackedSet.has('c3-ide/lib/utils/cn.ts'),
  false,
  'orphaned chat-panel TypeScript support must not remain in generated lib',
);

const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const idePackage = JSON.parse(readFileSync(resolve(repoRoot, 'c3-ide/package.json'), 'utf8'));
const electronPackage = JSON.parse(readFileSync(
  resolve(repoRoot, 'c3-ide/applications/electron/package.json'),
  'utf8',
));
const chatPanelPackage = JSON.parse(readFileSync(
  resolve(repoRoot, 'c3-ide/extensions/c3-chat-panel/package.json'),
  'utf8',
));
const installer = readFileSync(resolve(repoRoot, 'scripts/install.sh'), 'utf8');
const electronWebpack = readFileSync(
  resolve(repoRoot, 'c3-ide/applications/electron/webpack.config.js'),
  'utf8',
);
const electronLocalHttpBootstrap = readFileSync(
  resolve(
    repoRoot,
    'c3-ide/applications/electron/c3-local-http-bootstrap.js',
  ),
  'utf8',
);
const electronLocalAccess = readFileSync(
  resolve(repoRoot, 'c3-ide/applications/electron/c3-local-access.js'),
  'utf8',
);
const electronLocalOriginNormalizer = readFileSync(
  resolve(repoRoot, 'c3-ide/applications/electron/c3-local-origin-normalizer.js'),
  'utf8',
);
const electronPreload = readFileSync(
  resolve(repoRoot, 'c3-ide/applications/electron/c3-preload.js'),
  'utf8',
);
const chatPanelRuntime = readFileSync(
  resolve(
    repoRoot,
    'c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js',
  ),
  'utf8',
);
const centerViewsRuntime = readFileSync(
  resolve(
    repoRoot,
    'c3-ide/extensions/c3-center-views/lib/browser/center-views-module.js',
  ),
  'utf8',
);
const localObjectUrlCache = readFileSync(
  resolve(repoRoot, 'c3-ide/shared/legacy-local-object-url-cache.js'),
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
assert.equal(chatPanelPackage.main, 'lib/browser/chat-panel-module.js');
assert.deepEqual(chatPanelPackage.theiaExtensions, [
  { frontend: 'lib/browser/chat-panel-module' },
]);
assert.deepEqual(chatPanelPackage.files, ['lib', 'README.md', 'scripts']);
assert.equal(Object.hasOwn(chatPanelPackage, 'typings'), false);
assert.equal(Object.hasOwn(chatPanelPackage, 'devDependencies'), false);
assert.deepEqual(chatPanelPackage.scripts, {
  build: 'node scripts/authoritative-lib-contract.cjs verify',
  watch: 'node scripts/authoritative-lib-contract.cjs reject-watch',
  clean: 'node scripts/authoritative-lib-contract.cjs preserve-clean',
});
assert.doesNotMatch(
  JSON.stringify(chatPanelPackage.scripts),
  /\b(?:tsc|rimraf|rm)\b/,
  'chat-panel package scripts must not compile over or delete authoritative lib',
);

const chatPanelRuntimeFiles = [
  'lib/browser/agent-client.js',
  'lib/browser/agent-log-renderer.js',
  'lib/browser/chat-panel-module.js',
  'lib/browser/event-bus.js',
  'lib/browser/styles/c3-chat.css',
  'lib/browser/styles/c3-theme.css',
  'lib/browser/terminal-client.js',
  'lib/browser/ws-client.js',
];
const chatPanelRoot = resolve(repoRoot, 'c3-ide/extensions/c3-chat-panel');
const authoritativeLibContract = resolve(
  chatPanelRoot,
  'scripts/authoritative-lib-contract.cjs',
);

function chatPanelRuntimeDigest() {
  const digest = createHash('sha256');
  for (const relative of chatPanelRuntimeFiles) {
    const absolute = resolve(chatPanelRoot, relative);
    const stat = lstatSync(absolute);
    assert.equal(stat.isFile(), true, `${relative} must remain a regular file`);
    assert.equal(stat.isSymbolicLink(), false, `${relative} must not be a symlink`);
    digest.update(relative);
    digest.update(String(stat.mode & 0o777));
    digest.update(readFileSync(absolute));
  }
  return digest.digest('hex');
}

for (const [mode, expectedStatus] of [
  ['verify', 0],
  ['preserve-clean', 0],
  ['reject-watch', 2],
]) {
  const before = chatPanelRuntimeDigest();
  const result = spawnSync(process.execPath, [authoritativeLibContract, mode], {
    cwd: chatPanelRoot,
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(
    result.status,
    expectedStatus,
    `authoritative-lib ${mode} failed: ${result.stderr || result.stdout}`,
  );
  assert.equal(
    chatPanelRuntimeDigest(),
    before,
    `authoritative-lib ${mode} modified committed runtime`,
  );
}

for (const retiredFixer of [
  'c3-ide/fix-extensions.sh',
  'c3-ide/fixes/apply-fixes.sh',
]) {
  const result = spawnSync('bash', [resolve(repoRoot, retiredFixer)], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 2, `${retiredFixer} must fail closed`);
  assert.match(result.stderr, /retired/i);
}
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
assert.match(installer, /export COREPACK_ENABLE_DOWNLOAD_PROMPT=0/);
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
assert.match(installer, /grep -Fqx -- "\$1"/);
assert.match(installer, /Unknown argument: \$arg/);
assert.match(electronWebpack, /@vscode\/ripgrep-\$\{process\.platform\}-\$\{arch\}/);
assert.match(electronWebpack, /configs\[2\]\.entry\.preload/);
assert.match(
  electronWebpack,
  /configs\[0\]\.entry\.bundle\s*=\s*\[\s*path\.resolve\(__dirname,\s*'c3-local-http-bootstrap\.js'\)/,
);
assert.match(
  electronWebpack,
  /nodeConfig\.config\.entry\['electron-main'\]\s*=\s*\[\s*path\.resolve\(__dirname,\s*'c3-local-origin-normalizer\.js'\)/,
);
assert.match(electronPreload, /require\('\.\/c3-local-access'\)/);
assert.match(electronPreload, /readLocalAccess\(\)/);
assert.match(electronLocalAccess, /fs\.constants\.O_NOFOLLOW/);
assert.match(electronLocalAccess, /\(stat\.mode\s*&\s*0o777\)\s*!==\s*0o600/);
assert.match(electronLocalOriginNormalizer, /Origin:\s*'null'/);
assert.match(electronLocalOriginNormalizer, /crypto\.timingSafeEqual/);
assert.match(electronLocalOriginNormalizer, /details\.resourceType\s*!==\s*'xhr'/);
assert.doesNotMatch(electronLocalOriginNormalizer, /console\./);
assert.match(
  electronLocalHttpBootstrap,
  /resolved\.url\.origin\s*===\s*access\.backendUrl/,
);
assert.match(
  electronLocalHttpBootstrap,
  /headers\.delete\(LEGACY_LOCAL_CAPABILITY_HEADER\)/,
);
assert.doesNotMatch(chatPanelRuntime, /\b_apiBase\b/);
assert.doesNotMatch(chatPanelRuntime, /window\._c3BackendUrl/);
assert.doesNotMatch(
  chatPanelRuntime,
  /src:\s*_backendBase\s*\+\s*['"]\/api\/media\/output/,
);
assert.doesNotMatch(
  centerViewsRuntime,
  /window\.open\(\s*['"]\/api\/media\/output/,
);
assert.doesNotMatch(
  centerViewsRuntime,
  /const thumbUrl\s*=\s*firstFile\s*\?\s*['"]\/api\/media\/output/,
);
assert.doesNotMatch(chatPanelRuntime, /_mediaObjectUrls|_mediaObjectLoads/);
assert.doesNotMatch(centerViewsRuntime, /_mmObjectUrls|_mmObjectUrlLoads/);
assert.match(
  chatPanelRuntime,
  /_mediaOutputCache\.load\(_mediaOutputTarget\(id,filename\)\)/,
);
assert.match(chatPanelRuntime, /_mediaOutputCache\.invalidateWhere/);
assert.match(chatPanelRuntime, /_mediaOutputCache\.retain\(activeTargets\)/);
assert.match(
  chatPanelRuntime,
  /C3Bus\.on\('comfyui:complete',function\(ev\)\{[\s\S]*?_mediaRevokeOutputUrls\(ev\.generationId\);[\s\S]*?MediaAPI\.loadData\(\);/,
);
assert.match(
  centerViewsRuntime,
  /this\._mmOutputCache\.load\(target\)/,
);
assert.match(centerViewsRuntime, /this\._mmOutputCache\.invalidateWhere/);
assert.match(centerViewsRuntime, /this\._mmOutputCache\.retain\(activeTargets\)/);
assert.match(
  centerViewsRuntime,
  /window\.C3Bus\.on\('comfyui:complete', function\(d\) \{[\s\S]*?self\._mmRevokeOutputUrls\(d\.generationId\);[\s\S]*?self\._mmFetchHistory\(\);/,
);
assert.match(centerViewsRuntime, /dispose\(\)\s*\{\s*this\._mmOutputCache\.clear\(\)/);
assert.match(centerViewsRuntime, /\?\s*h\('img',\s*\{\s*src:\s*thumbUrl/);
assert.match(chatPanelRuntime, /thumbUrl\s*\?\s*h\('img',\s*\{\s*src:\s*thumbUrl/);
assert.match(
  centerViewsRuntime,
  /_mmOpenFull\(gen\)[\s\S]*this\._mmOutputCache\.peek\(target\)[\s\S]*window\.open\(existing,[\s\S]*this\._mmEnsureOutputUrl\(gen\.id,\s*outputs\[0\]\)[\s\S]*pendingWindow\.location\.replace\(objectUrl\)/,
);
assert.match(localObjectUrlCache, /record\.active\s*&&\s*pending\.get\(key\)\s*===\s*record/);
assert.match(localObjectUrlCache, /record\.controller\.abort\(\)/);
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
