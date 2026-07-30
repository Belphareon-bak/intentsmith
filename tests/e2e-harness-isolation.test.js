// Deterministic self-test for the real-model E2E harness containment boundary.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import { assert, assertEqual, assertIncludes, suite, summary, test } from './harness.js';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-e2e-isolation-'));
const privateRoot = path.join(runRoot, '.intentsmith-artifacts', 'e2e-isolation');
const projectsRoot = path.join(privateRoot, 'projects');
const runtimeRoot = path.join(privateRoot, 'runtime');
const homeRoot = path.join(privateRoot, 'home');
const tempRoot = path.join(privateRoot, 'tmp');

for (const directory of [privateRoot, projectsRoot, runtimeRoot, homeRoot, tempRoot]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

const baseEnv = {
  PATH: process.env.PATH,
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  NODE_ENV: 'test',
  NO_COLOR: '1',
  HOME: homeRoot,
  XDG_CONFIG_HOME: path.join(privateRoot, 'xdg-config'),
  XDG_CACHE_HOME: path.join(privateRoot, 'xdg-cache'),
  TMPDIR: tempRoot,
  C3_DB_PATH: path.join(runtimeRoot, 'test.sqlite'),
  INTENTSMITH_TEST_ARTIFACT_DIR: privateRoot,
  INTENTSMITH_TEST_PROJECTS_DIR: projectsRoot,
};

function runChild(source, env = baseEnv) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

suite('E2E harness private-root containment');

test('rejects an artifact root outside .intentsmith-artifacts', () => {
  const unsafeArtifactRoot = path.join(
    path.dirname(repoRoot),
    'intentsmith-e2e-public-artifacts',
  );
  const result = runChild(
    "await import('./tests/e2e-harness.js');",
    {
      ...baseEnv,
      INTENTSMITH_TEST_ARTIFACT_DIR: unsafeArtifactRoot,
    },
  );

  assert(result.status !== 0, 'unsafe artifact root was accepted');
  assertIncludes(
    `${result.stdout}\n${result.stderr}`,
    'must be inside a .intentsmith-artifacts directory',
  );
});

test('owns project cleanup and writes private transcripts', () => {
  const childSource = `
    import fs from 'fs';
    import path from 'path';
    const harness = await import('./tests/e2e-harness.js');
    const projectPath = harness.resolveTestProjectPath('Owned-Project');
    const expected = path.join(
      path.resolve(process.env.INTENTSMITH_TEST_PROJECTS_DIR),
      'Owned-Project',
    );
    if (projectPath !== expected) throw new Error('project path escaped owned root');
    fs.mkdirSync(projectPath, { recursive: true });
    fs.writeFileSync(path.join(projectPath, 'stale.txt'), 'stale');
    harness.initProjectDir(projectPath);
    if (fs.existsSync(path.join(projectPath, 'stale.txt'))) {
      throw new Error('owned stale file was not removed');
    }
    if (!fs.existsSync(path.join(projectPath, '.git'))) {
      throw new Error('owned project was not initialized');
    }
    let rejected = false;
    try {
      harness.resolveTestProjectPath('../escape');
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error('unsafe project name was accepted');
    const transcriptPath = harness.saveTestTranscript('isolation');
    console.log('ISOLATION_RESULT ' + JSON.stringify({ projectPath, transcriptPath }));
    process.exit(0);
  `;
  const result = runChild(childSource);

  assertEqual(result.signal, null, `child terminated by ${result.signal}`);
  assertEqual(result.status, 0, result.stderr || result.stdout);

  const resultLine = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith('ISOLATION_RESULT '));
  assert(resultLine, `missing child result: ${result.stdout}`);
  const childResult = JSON.parse(resultLine.slice('ISOLATION_RESULT '.length));

  assert(
    childResult.projectPath.startsWith(`${path.resolve(projectsRoot)}${path.sep}`),
    `project escaped owned root: ${childResult.projectPath}`,
  );
  assert(
    childResult.transcriptPath.startsWith(`${path.resolve(privateRoot)}${path.sep}`),
    `transcript escaped private root: ${childResult.transcriptPath}`,
  );
  assertEqual(fs.statSync(path.dirname(childResult.transcriptPath)).mode & 0o777, 0o700);
  assertEqual(fs.statSync(childResult.transcriptPath).mode & 0o777, 0o600);
});

process.on('exit', (code) => {
  if (code === 0) {
    fs.rmSync(runRoot, { recursive: true, force: true });
  } else {
    console.log(`E2E isolation evidence preserved at ${runRoot}`);
  }
});

const { failed } = summary();
process.exitCode ||= failed > 0 ? 1 : 0;
