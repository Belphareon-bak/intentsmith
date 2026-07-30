// Direct-run isolation bootstrap for root test programs.
//
// Registered audit execution already owns a private filesystem sandbox. In that
// mode this module validates and respects the injected paths. A raw
// `node tests/<program>.test.js` invocation receives its own atomically-created
// private root under the repository's ignored .intentsmith-artifacts tree.

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PRIVATE_COMPONENT = '.intentsmith-artifacts';
const REPOSITORY_ROOT = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
);
const DIRECT_RUN_ROOT = path.join(
  REPOSITORY_ROOT,
  PRIVATE_COMPONENT,
  'direct-tests',
);
const REQUIRED_AUDIT_ENV = [
  'HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'npm_config_cache',
  'C3_DB_PATH',
  'C3_PROJECTS_DIR',
  'INTENTSMITH_TEST_PROJECTS_DIR',
  'INTENTSMITH_TEST_ARTIFACT_DIR',
  'C3_PORT_FILE',
];

function isStrictChild(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function hasPrivateComponent(candidate) {
  return path.resolve(candidate).split(path.sep).includes(PRIVATE_COMPONENT);
}

function assertCurrentUser(stat, label) {
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`${label} is not owned by the current user`);
  }
}

function assertPrivateMode(stat, label) {
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} must not be accessible by group or other users`);
  }
}

function inspectPrivateDirectory(candidate, label, { requirePrivateComponent = true } = {}) {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new Error(`${label} is required`);
  }

  const absolute = path.resolve(candidate);
  if (requirePrivateComponent && !hasPrivateComponent(absolute)) {
    throw new Error(`${label} must be inside a ${PRIVATE_COMPONENT} directory`);
  }

  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must name an existing non-symlink directory`);
  }
  assertCurrentUser(stat, label);
  assertPrivateMode(stat, label);

  const canonical = realpathSync(absolute);
  if (canonical !== absolute) {
    throw new Error(`${label} must not traverse symbolic links`);
  }
  return canonical;
}

function ensureDirectDirectory(candidate, label) {
  const created = !existsSync(candidate);
  if (created) {
    mkdirSync(candidate, { mode: 0o700 });
  }

  const absolute = path.resolve(candidate);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must name a non-symlink directory`);
  }
  assertCurrentUser(stat, label);
  if (created) {
    chmodSync(absolute, 0o700);
  } else {
    assertPrivateMode(stat, label);
  }

  const canonical = realpathSync(absolute);
  if (canonical !== absolute) {
    throw new Error(`${label} must not traverse symbolic links`);
  }
  return canonical;
}

function assertPrivateFileParent(candidate, label) {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new Error(`${label} is required`);
  }
  if (!path.isAbsolute(candidate)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return inspectPrivateDirectory(path.dirname(candidate), `${label} parent`);
}

function resolveAuditRuntime() {
  const missing = REQUIRED_AUDIT_ENV.filter(
    key => typeof process.env[key] !== 'string' || process.env[key].trim() === '',
  );
  if (missing.length > 0) {
    throw new Error(
      `C3_AUDIT_RUN requires complete runner-owned isolation: ${missing.join(', ')}`,
    );
  }

  const temp = inspectPrivateDirectory(process.env.TMPDIR, 'TMPDIR');
  for (const key of ['TMP', 'TEMP']) {
    if (path.resolve(process.env[key]) !== temp) {
      throw new Error(`${key} must equal the runner-owned TMPDIR`);
    }
  }

  const artifacts = inspectPrivateDirectory(
    process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
    'INTENTSMITH_TEST_ARTIFACT_DIR',
  );
  const home = inspectPrivateDirectory(process.env.HOME, 'HOME');
  const xdgConfig = inspectPrivateDirectory(
    process.env.XDG_CONFIG_HOME,
    'XDG_CONFIG_HOME',
  );
  const xdgCache = inspectPrivateDirectory(
    process.env.XDG_CACHE_HOME,
    'XDG_CACHE_HOME',
  );
  const xdgData = inspectPrivateDirectory(
    process.env.XDG_DATA_HOME,
    'XDG_DATA_HOME',
  );
  const xdgState = inspectPrivateDirectory(
    process.env.XDG_STATE_HOME,
    'XDG_STATE_HOME',
  );
  const npmCache = inspectPrivateDirectory(
    process.env.npm_config_cache,
    'npm_config_cache',
  );
  if (!isStrictChild(artifacts, npmCache)) {
    throw new Error('npm_config_cache must be inside INTENTSMITH_TEST_ARTIFACT_DIR');
  }
  const projects = inspectPrivateDirectory(
    process.env.INTENTSMITH_TEST_PROJECTS_DIR,
    'INTENTSMITH_TEST_PROJECTS_DIR',
  );
  const configuredProjects = inspectPrivateDirectory(
    process.env.C3_PROJECTS_DIR,
    'C3_PROJECTS_DIR',
  );
  if (configuredProjects !== projects) {
    throw new Error('C3_PROJECTS_DIR must equal INTENTSMITH_TEST_PROJECTS_DIR');
  }

  assertPrivateFileParent(process.env.C3_DB_PATH, 'C3_DB_PATH');
  assertPrivateFileParent(process.env.C3_PORT_FILE, 'C3_PORT_FILE');

  return Object.freeze({
    mode: 'audit',
    repositoryRoot: REPOSITORY_ROOT,
    root: null,
    temp,
    runtime: path.dirname(process.env.C3_DB_PATH),
    projects,
    artifacts,
    home,
    xdgConfig,
    xdgCache,
    xdgData,
    xdgState,
    npmCache,
    database: process.env.C3_DB_PATH,
    portFile: process.env.C3_PORT_FILE,
  });
}

function safeProgramPrefix() {
  const entry = path.basename(process.argv[1] || 'node', path.extname(process.argv[1] || ''));
  const normalized = entry.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return (normalized || 'node').slice(0, 80);
}

function makePrivateChild(root, name) {
  const candidate = path.join(root, name);
  if (!isStrictChild(root, candidate)) {
    throw new Error(`Direct-run child escaped its private root: ${candidate}`);
  }
  mkdirSync(candidate, { mode: 0o700 });
  chmodSync(candidate, 0o700);
  return inspectPrivateDirectory(candidate, `direct-run ${name}`);
}

function removeDirectRuntime(root) {
  const directRoot = inspectPrivateDirectory(
    DIRECT_RUN_ROOT,
    'direct-run parent',
  );
  const absolute = path.resolve(root);
  if (!isStrictChild(directRoot, absolute)) {
    throw new Error(`Refusing to remove a path outside ${directRoot}: ${absolute}`);
  }

  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Refusing to remove a non-directory or symlink: ${absolute}`);
  }
  assertCurrentUser(stat, 'direct-run root');
  const canonical = realpathSync(absolute);
  if (canonical !== absolute || !isStrictChild(directRoot, canonical)) {
    throw new Error(`Refusing to remove an escaped direct-run root: ${absolute}`);
  }
  rmSync(canonical, { recursive: true, force: false, maxRetries: 2 });
}

function createDirectRuntime() {
  process.umask(0o077);

  const artifactRoot = ensureDirectDirectory(
    path.join(REPOSITORY_ROOT, PRIVATE_COMPONENT),
    'repository artifact root',
  );
  const directRoot = ensureDirectDirectory(
    path.join(artifactRoot, 'direct-tests'),
    'direct-run parent',
  );
  if (directRoot !== DIRECT_RUN_ROOT) {
    throw new Error(`Unexpected direct-run root: ${directRoot}`);
  }

  const root = mkdtempSync(path.join(directRoot, `${safeProgramPrefix()}-`));
  chmodSync(root, 0o700);
  inspectPrivateDirectory(root, 'direct-run root');

  const temp = makePrivateChild(root, 'tmp');
  const runtime = makePrivateChild(root, 'runtime');
  const projects = makePrivateChild(root, 'projects');
  const artifacts = makePrivateChild(root, 'artifacts');
  const home = makePrivateChild(root, 'home');
  const xdgConfig = makePrivateChild(root, 'xdg-config');
  const xdgCache = makePrivateChild(root, 'xdg-cache');
  const xdgData = makePrivateChild(root, 'xdg-data');
  const xdgState = makePrivateChild(root, 'xdg-state');
  const npmCache = makePrivateChild(artifacts, 'npm-cache');
  const database = path.join(runtime, 'intentsmith-test.sqlite');
  const portFile = path.join(runtime, 'intentsmith.port');

  Object.assign(process.env, {
    HOME: home,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_CACHE_HOME: xdgCache,
    XDG_DATA_HOME: xdgData,
    XDG_STATE_HOME: xdgState,
    npm_config_cache: npmCache,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    NODE_ENV: 'test',
    C3_DB_PATH: database,
    C3_PROJECTS_DIR: projects,
    INTENTSMITH_TEST_PROJECTS_DIR: projects,
    INTENTSMITH_TEST_ARTIFACT_DIR: artifacts,
    C3_PORT: '0',
    C3_PORT_FILE: portFile,
    C3_LIFECYCLE_AUTO_COMMIT: 'false',
    C3_ENABLE_AUTONOMY: 'false',
    INTENTSMITH_DIRECT_TEST_RUN: '1',
  });

  let cleanupAttempted = false;
  let cleanupComplete = false;
  let cleanupError = null;
  const cleanupRequested = exitCode => (
    exitCode === 0
    && process.env.KEEP_TEST_RUNTIME !== '1'
    && process.env.KEEP_TEST_DB !== '1'
  );
  const cleanup = () => {
    if (cleanupAttempted) return cleanupComplete;
    cleanupAttempted = true;
    try {
      removeDirectRuntime(root);
      cleanupComplete = true;
    } catch (error) {
      cleanupError = error;
    }
    return cleanupComplete;
  };

  process.once('beforeExit', exitCode => {
    if (!cleanupRequested(exitCode)) return;
    if (!cleanup()) {
      process.exitCode = 1;
      process.stderr.write(
        `Failed to remove isolated test runtime ${root}: ${cleanupError.message}\n`,
      );
    }
  });

  process.once('exit', exitCode => {
    if (cleanupComplete) return;

    if (cleanupRequested(exitCode) && !cleanupAttempted) {
      if (!cleanup()) {
        process.exitCode = 1;
        process.stderr.write(
          `Failed to remove isolated test runtime ${root}: ${cleanupError.message}\n`,
        );
      }
      return;
    }

    if (cleanupError === null) {
      process.stderr.write(`Isolated test runtime preserved: ${root}\n`);
    }
  });

  return Object.freeze({
    mode: 'direct',
    repositoryRoot: REPOSITORY_ROOT,
    root,
    temp,
    runtime,
    projects,
    artifacts,
    home,
    xdgConfig,
    xdgCache,
    xdgData,
    xdgState,
    npmCache,
    database,
    portFile,
  });
}

process.umask(0o077);

export const isolatedTestRuntime = process.env.C3_AUDIT_RUN === '1'
  ? resolveAuditRuntime()
  : createDirectRuntime();
