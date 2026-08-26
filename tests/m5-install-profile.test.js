import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = path.join(root, 'scripts', 'install.sh');

function executable(target, source) {
  writeFileSync(target, `#!/bin/sh\n${source}\n`, { mode: 0o700 });
  chmodSync(target, 0o700);
}

function fixture({ nodeVersion = '22.14.0', pdf = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'intentsmith-m5-install-'));
  const bin = path.join(directory, 'bin');
  const home = path.join(directory, 'home');
  const fonts = path.join(directory, 'fonts');
  mkdirSync(bin, { mode: 0o700 });
  mkdirSync(home, { mode: 0o700 });
  mkdirSync(fonts, { mode: 0o700 });
  executable(path.join(bin, 'node'), `if [ "${'$'}1" = "-v" ]; then echo v${nodeVersion}; fi; exit 0`);
  executable(path.join(bin, 'npm'), 'if [ "$1" = "-v" ]; then echo 10.9.4; fi; exit 0');
  executable(path.join(bin, 'yarn'), 'if [ "$1" = "--version" ]; then echo 1.22.22; fi; exit 0');
  if (pdf) {
    executable(path.join(bin, 'python3.12'), 'exit 0');
    for (const name of [
      'DejaVuSans.ttf',
      'DejaVuSans-Bold.ttf',
      'DejaVuSans-Oblique.ttf',
      'DejaVuSans-BoldOblique.ttf',
      'DejaVuSansMono.ttf',
    ]) writeFileSync(path.join(fonts, name), 'fixture');
  }
  return { directory, bin, home, fonts };
}

function verify(profile, options = {}) {
  const state = fixture(options);
  const result = spawnSync('/bin/bash', [
    installer,
    `--profile=${profile}`,
    '--minimal',
    '--verify-only',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: `${state.bin}:/usr/bin:/bin`,
      HOME: state.home,
      XDG_DATA_HOME: path.join(state.directory, 'data'),
      PYTHON3: options.pdf ? 'python3.12' : 'missing-python3.12',
      INTENTSMITH_PDF_FONT_DIR: state.fonts,
      TERM: 'dumb',
    },
  });
  rmSync(state.directory, { recursive: true, force: true });
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

test('core preflight succeeds without optional PDF and performs no mutation phase', () => {
  const result = verify('core');
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Prerequisite verification passed for core profile/);
  assert.match(result.output, /PDF export unavailable; core install remains supported/);
  assert.match(result.output, /No installs, builds, downloads or runtime probes were performed/);
  assert.doesNotMatch(result.output, /Running npm ci|Running frozen Yarn install|Installing hash-locked/);
});

test('full preflight fails closed when PDF prerequisites are absent', () => {
  const result = verify('full');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Full profile requires CPython 3\.12 venv support/);
  assert.match(result.output, /Prerequisite verification failed/);
});

test('full preflight succeeds with exact optional interpreter and font set', () => {
  const result = verify('full', { pdf: true });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Prerequisite verification passed for full profile/);
  assert.doesNotMatch(result.output, /PDF export unavailable/);
});

test('core profile does not weaken the Node 22 boundary', () => {
  const result = verify('core', { nodeVersion: '20.19.0' });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Node\.js v20\.19\.0 \(need 22\.x\)/);
});

test('unknown profile is rejected before any prerequisite probe', () => {
  const state = fixture();
  const result = spawnSync('/bin/bash', [installer, '--verify-only'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: `${state.bin}:/usr/bin:/bin`,
      HOME: state.home,
      INTENTSMITH_INSTALL_PROFILE: 'invented',
    },
  });
  rmSync(state.directory, { recursive: true, force: true });
  assert.equal(result.status, 2);
  assert.match(`${result.stdout}${result.stderr}`, /Unknown install profile: invented/);
});

test('run boundary treats missing PDF as optional and preserves a truthful install command', () => {
  const source = readFileSync(path.join(root, 'scripts', 'run.sh'), 'utf8');
  assert.match(source, /warn "Optional PDF export runtime unavailable; core features remain available"/);
  assert.match(source, /install\.sh --profile=full --minimal/);
  const pdfSource = readFileSync(path.join(root, 'src/chat/export/pdf-exporter.js'), 'utf8');
  assert.match(pdfSource, /Install it with: \$\{PDF_RUNTIME_INSTALL_COMMAND\}/);
  assert.match(pdfSource, /\.\/scripts\/install-pdf-runtime\.sh/);
});

test('legacy Docker disposition is inert by default and cannot widen the listener', () => {
  const dockerfile = readFileSync(path.join(root, 'docker', 'Dockerfile'), 'utf8');
  const compose = readFileSync(path.join(root, 'docker', 'docker-compose.yml'), 'utf8');
  assert.doesNotMatch(dockerfile, /npm ci[^\n]*\|\|[^\n]*npm install/);
  assert.doesNotMatch(`${dockerfile}\n${compose}`, /C3_HOST=0\.0\.0\.0/);
  assert.equal((compose.match(/profiles: \["unsupported"\]/g) || []).length, 3);
  assert.match(compose, /UNSUPPORTED LEGACY DISPOSITION/);
  assert.doesNotMatch(`${dockerfile}\n${compose}`, /\/api\/status/);
  assert.match(`${dockerfile}\n${compose}`, /\/api\/health/);
});

test('offline install is cache-only and skips the Ollama boundary', () => {
  const source = readFileSync(installer, 'utf8');
  assert.match(source, /npm ci --offline/);
  assert.match(source, /yarn install --frozen-lockfile --non-interactive --offline/);
  assert.match(source, /if \[ "\$OFFLINE" = true \]; then\n  export COREPACK_ENABLE_NETWORK=0/);
  assert.match(source, /Offline install: Ollama discovery and model operations skipped/);
  assert.doesNotMatch(source, /npm ci --offline[\s\S]{0,80}\|\|[\s\S]{0,80}npm ci/);
});
