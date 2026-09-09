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
const xdgConfigRoot = path.join(privateRoot, 'xdg-config');
const xdgCacheRoot = path.join(privateRoot, 'xdg-cache');
const xdgDataRoot = path.join(privateRoot, 'xdg-data');
const xdgStateRoot = path.join(privateRoot, 'xdg-state');
const npmCacheRoot = path.join(privateRoot, 'npm-cache');

for (const directory of [
  privateRoot,
  projectsRoot,
  runtimeRoot,
  homeRoot,
  tempRoot,
  xdgConfigRoot,
  xdgCacheRoot,
  xdgDataRoot,
  xdgStateRoot,
  npmCacheRoot,
]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

const baseEnv = {
  PATH: process.env.PATH,
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  NODE_ENV: 'test',
  NO_COLOR: '1',
  HOME: homeRoot,
  XDG_CONFIG_HOME: xdgConfigRoot,
  XDG_CACHE_HOME: xdgCacheRoot,
  XDG_DATA_HOME: xdgDataRoot,
  XDG_STATE_HOME: xdgStateRoot,
  TMPDIR: tempRoot,
  TMP: tempRoot,
  TEMP: tempRoot,
  npm_config_cache: npmCacheRoot,
  C3_AUDIT_RUN: '1',
  C3_DB_PATH: path.join(runtimeRoot, 'test.sqlite'),
  C3_PROJECTS_DIR: projectsRoot,
  C3_PORT_FILE: path.join(runtimeRoot, 'test.port'),
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

test('reports generation errors as FAILED before the completion marker', () => {
  const childSource = `
    import fs from 'fs';
    const harness = await import('./tests/e2e-harness.js');
    const projectPath = harness.resolveTestProjectPath('Generation-Failure');
    fs.mkdirSync(projectPath, { recursive: true });

    const projectId = Number(
      harness.projects.create.run('Generation-Failure', projectPath, 'failure contract').lastInsertRowid,
    );
    const lifecycleId = 'lc-generation-failure';
    const milestoneId = 'ms-generation-failure';
    harness.lifecycleRepo.save(lifecycleId, projectId, 'BUILD', null, {});
    harness.msRepo.addMilestone({
      id: milestoneId,
      lifecycle_id: lifecycleId,
      roadmap_version: 1,
      sequence: 1,
      title: 'Generation failure',
      description: 'Generation errors must fail closed',
      status: 'EXECUTING',
      dependencies: [],
      estimated_loc: 10,
      estimated_files: 1,
      estimated_complexity: 'LOW',
      local_plan: {
        files: [{ path: 'src/generated.js', purpose: 'Exercise the failure contract' }],
      },
      scope_files: ['src/generated.js'],
    });

    const executor = harness.createExecutor(projectPath, 'Node.js', {
      callLLM: async () => {
        throw new Error('synthetic generation failure');
      },
    });
    const result = await executor.start('Generate the planned file.', { milestoneId });
    if (result.state !== 'FAILED') {
      throw new Error('generation failure was reported as ' + result.state);
    }
    if (!result.error.includes('src/generated.js') ||
        !result.error.includes('synthetic generation failure')) {
      throw new Error('failure result lost actionable generation context');
    }
    console.log('GENERATION_FAILURE_RESULT ' + JSON.stringify(result));
  `;
  const result = runChild(childSource);

  assertEqual(result.signal, null, `child terminated by ${result.signal}`);
  assertEqual(result.status, 0, result.stderr || result.stdout);
  assertIncludes(result.stdout, '"state":"FAILED"');
  assert(
    !result.stdout.includes('[EXECUTOR] ─── ms-generation-failure complete ───'),
    'executor printed a completion marker after generation failed',
  );
});


test('rejects generated traversal, metadata and linked paths before any model call', () => {
  const childSource = `
    import fs from 'fs';
    import path from 'path';
    const harness = await import('./tests/e2e-harness.js');
    const guard = await import('./tests/helpers/isolated-test-db.js');
    const projectPath = guard.resolveIsolatedProjectPath('Generated-Containment');
    fs.mkdirSync(projectPath, { recursive: true });
    const sentinel = path.join(process.env.HOME, 'outside-generated.js');
    fs.writeFileSync(sentinel, 'UNCHANGED');
    fs.symlinkSync(process.env.HOME, path.join(projectPath, 'linked-directory'));
    fs.symlinkSync(sentinel, path.join(projectPath, 'linked-file.js'));
    fs.linkSync(sentinel, path.join(projectPath, 'hard-linked.js'));
    const badPaths = ['../sibling.js', '../../home/outside-generated.js', sentinel,
      '.git/hooks/pre-commit', 'linked-directory/outside-generated.js',
      'linked-file.js', 'hard-linked.js'];
    const projectId = Number(harness.projects.create.run(
      'Generated-Containment', projectPath, 'containment').lastInsertRowid);
    harness.lifecycleRepo.save('lc-containment', projectId, 'BUILD', null, {});
    let calls = 0;
    for (const [index, filePath] of badPaths.entries()) {
      const milestoneId = 'ms-containment-' + index;
      harness.msRepo.addMilestone({ id: milestoneId, lifecycle_id: 'lc-containment',
        roadmap_version: 1, sequence: index + 1, title: 'Containment', description: 'Containment',
        status: 'EXECUTING', dependencies: [], estimated_loc: 1, estimated_files: 1,
        estimated_complexity: 'LOW', local_plan: { files: [{ path: filePath }] },
        scope_files: [filePath] });
      const executor = harness.createExecutor(projectPath, 'Node.js', {
        callLLM: async () => { calls++; return { content: 'export const value = 1;' }; },
      });
      const result = await executor.start('Generate', { milestoneId });
      if (result.state !== 'FAILED') throw new Error('Unsafe generated path accepted: ' + filePath);
    }
    if (calls !== 0) throw new Error('Model called before generated path validation');
    if (fs.readFileSync(sentinel, 'utf8') !== 'UNCHANGED') throw new Error('Outside file changed');
    if (fs.existsSync(path.join(projectPath, '.git'))) throw new Error('Git metadata created');
    const good = guard.resolveIsolatedProjectFile(projectPath, 'src/allowed.js');
    fs.mkdirSync(path.dirname(good), { recursive: true });
    fs.writeFileSync(good, 'allowed');
    if (fs.readFileSync(good, 'utf8') !== 'allowed') throw new Error('Valid generated path failed');
    console.log('GENERATED_CONTAINMENT_PASS ' + badPaths.length);
  `;
  const result = runChild(childSource);
  assertEqual(result.signal, null, `child terminated by ${result.signal}`);
  assertEqual(result.status, 0, result.stderr || result.stdout);
  assertIncludes(result.stdout, 'GENERATED_CONTAINMENT_PASS 7');
});

test('rejects links introduced during generation or repair without changing outside bytes', () => {
  const childSource = `
    import fs from 'fs';
    import path from 'path';
    const harness = await import('./tests/e2e-harness.js');
    const guard = await import('./tests/helpers/isolated-test-db.js');
    const cases = ['file-link', 'parent-link', 'hard-link', 'repair-file-link',
      'repair-hard-link', 'repair-microtask-link'];
    for (const [index, kind] of cases.entries()) {
      const projectPath = guard.resolveIsolatedProjectPath('Async-Containment-' + index);
      fs.mkdirSync(projectPath, { recursive: true });
      const outside = path.join(process.env.HOME, 'outside-' + index);
      fs.mkdirSync(outside);
      const sentinel = path.join(outside, 'target.js');
      fs.writeFileSync(sentinel, 'UNCHANGED');
      const relative = kind === 'parent-link' ? 'linked/target.js' : 'target.js';
      const target = path.join(projectPath, relative);
      const projectId = Number(harness.projects.create.run(
        'Async-Containment-' + index, projectPath, 'containment').lastInsertRowid);
      const lifecycleId = 'lc-async-' + index;
      const milestoneId = 'ms-async-' + index;
      harness.lifecycleRepo.save(lifecycleId, projectId, 'BUILD', null, {});
      harness.msRepo.addMilestone({ id: milestoneId, lifecycle_id: lifecycleId,
        roadmap_version: 1, sequence: 1, title: 'Containment', description: 'Containment',
        status: 'EXECUTING', dependencies: [], estimated_loc: 1, estimated_files: 1,
        estimated_complexity: 'LOW', local_plan: { files: [{ path: relative }] },
        scope_files: [relative] });
      let calls = 0;
      const repairing = kind.startsWith('repair-');
      const executor = harness.createExecutor(projectPath, 'Node.js', {
        callLLM: async () => {
          calls++;
          await Promise.resolve();
          if (repairing && calls === 1) return { content: 'const broken = ;' };
          if (kind === 'repair-microtask-link') {
            queueMicrotask(() => queueMicrotask(() => {
              fs.unlinkSync(target);
              fs.symlinkSync(sentinel, target);
            }));
          } else if (kind === 'parent-link') {
            fs.symlinkSync(outside, path.dirname(target));
          } else {
            if (fs.existsSync(target)) fs.unlinkSync(target);
            if (kind.endsWith('hard-link')) fs.linkSync(sentinel, target);
            else fs.symlinkSync(sentinel, target);
          }
          return { content: 'const value = 1;' };
        },
      });
      const result = await executor.start('Generate', { milestoneId });
      if (result.state !== 'FAILED') throw new Error('Async link was accepted: ' + kind);
      if (calls !== (repairing ? 2 : 1)) throw new Error('Unexpected model retries: ' + kind);
      if (fs.readFileSync(sentinel, 'utf8') !== 'UNCHANGED') throw new Error('Outside bytes changed: ' + kind);
    }
    const goodProject = guard.resolveIsolatedProjectPath('Safe-Writer');
    fs.mkdirSync(goodProject);
    guard.writeIsolatedProjectFile(goodProject, 'src/allowed.js', 'long original content');
    const good = guard.writeIsolatedProjectFile(goodProject, 'src/allowed.js', 'ok');
    if (fs.readFileSync(good, 'utf8') !== 'ok') throw new Error('Valid overwrite failed');
    if ((fs.statSync(good).mode & 0o777) !== 0o600) throw new Error('Writer did not create a private file');
    console.log('ASYNC_GENERATED_CONTAINMENT_PASS ' + cases.length);
  `;
  const result = runChild(childSource);
  assertEqual(result.signal, null, `child terminated by ${result.signal}`);
  assertEqual(result.status, 0, result.stderr || result.stdout);
  assertIncludes(result.stdout, 'ASYNC_GENERATED_CONTAINMENT_PASS 6');
});

test('snippet and full-file repairs use the supplied writer and retain the default behavior', () => {
  const childSource = `
    import fs from 'fs';
    const { repairCode } = await import('./src/planner/code-cleaner.js');
    const guard = await import('./tests/helpers/isolated-test-db.js');
    const project = guard.resolveIsolatedProjectPath('Repair-Writer');
    fs.mkdirSync(project);
    let checked = 0;
    for (const tier of ['snippet', 'full-file']) {
      for (const custom of [false, true]) {
        const relative = tier + '-' + custom + '.js';
        const target = guard.writeIsolatedProjectFile(project, relative, 'const broken = ;');
        let writes = 0;
        const dependencies = custom ? { writeFile: (requested, content) => {
          if (requested !== target) throw new Error('Unexpected repair target');
          writes++;
          guard.writeIsolatedProjectFile(project, relative, content);
        } } : undefined;
        const result = await repairCode('const broken = ;',
          tier === 'snippet' ? target + ':1 SyntaxError' : 'SyntaxError without location',
          target, async () => ({ content: 'const repaired = true;' }), dependencies);
        if (!result.repaired || result.tier !== tier) throw new Error('Repair branch failed: ' + tier);
        if (writes !== (custom ? 1 : 0)) throw new Error('Repair bypassed its writer: ' + tier);
        if (fs.readFileSync(target, 'utf8') !== 'const repaired = true;') throw new Error('Repair bytes mismatch');
        checked++;
      }
    }
    console.log('REPAIR_WRITER_PASS ' + checked);
  `;
  const result = runChild(childSource);
  assertEqual(result.signal, null, `child terminated by ${result.signal}`);
  assertEqual(result.status, 0, result.stderr || result.stdout);
  assertIncludes(result.stdout, 'REPAIR_WRITER_PASS 4');
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
