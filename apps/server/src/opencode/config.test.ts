import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { OPENCODE_ENV, WorkerConfigError, readOpenCodeConfig, readWorkerSelection } from './config.js';

/**
 * Worker selection and the fail-closed configuration contract.
 *
 * The property under test is that nothing is guessed. An unknown selection is
 * an error rather than a silent fake, and a partially configured OpenCode path
 * refuses as a whole: every missing piece is one the authority stack needs, so
 * honouring the rest would leave a worker running with less mediation than the
 * operator believes.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function workspace(options: { git?: boolean } = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-config-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  if (options.git !== false) mkdirSync(path.join(root, '.git'));
  return root;
}

function gatesFile(content: unknown): string {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-gates-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'gates.json');
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

function completeEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    INTENTSMITH_WORKER: 'opencode',
    [OPENCODE_ENV.executable]: process.execPath,
    [OPENCODE_ENV.version]: 'opencode-ai/1.18.8',
    [OPENCODE_ENV.workspaceRoot]: workspace(),
    [OPENCODE_ENV.model]: 'qwen3:14b',
    [OPENCODE_ENV.gates]: gatesFile([
      { id: 'fixture', description: 'fixture gate', executable: process.execPath, args: ['-e', ''] },
    ]),
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

describe('worker selection', () => {
  it('defaults to the fake worker when nothing is set', () => {
    expect(readWorkerSelection({})).toBe('fake');
    expect(readWorkerSelection({ INTENTSMITH_WORKER: '' })).toBe('fake');
  });

  it('keeps the fake path explicit and deterministic', () => {
    expect(readWorkerSelection({ INTENTSMITH_WORKER: 'fake' })).toBe('fake');
  });

  it('selects opencode only when the operator asked for it', () => {
    expect(readWorkerSelection({ INTENTSMITH_WORKER: 'opencode' })).toBe('opencode');
  });

  it('refuses an unrecognized selection instead of falling back', () => {
    // A typo must not silently become the fake worker: a deployment that
    // believes it runs a real agent while a fake decides its verdicts is worse
    // than one that will not start.
    expect(() => readWorkerSelection({ INTENTSMITH_WORKER: 'OpenCode' })).toThrow(WorkerConfigError);
    expect(() => readWorkerSelection({ INTENTSMITH_WORKER: 'openhands' })).toThrow(/not a supported worker/);
  });
});

describe('opencode configuration', () => {
  it('accepts a complete configuration and derives the required gates from it', () => {
    const env = completeEnv();
    const config = readOpenCodeConfig(env);

    expect(config).toMatchObject({
      executable: process.execPath,
      expectedVersion: 'opencode-ai/1.18.8',
      modelId: 'qwen3:14b',
      args: [],
      requiredGateIds: ['fixture'],
    });
    expect(config.gates).toHaveLength(1);
  });

  it('reads fixed adapter arguments as a JSON array', () => {
    const config = readOpenCodeConfig(completeEnv({ [OPENCODE_ENV.args]: JSON.stringify(['--flag', 'value']) }));
    expect(config.args).toEqual(['--flag', 'value']);
  });

  it.each([
    OPENCODE_ENV.executable,
    OPENCODE_ENV.version,
    OPENCODE_ENV.workspaceRoot,
    OPENCODE_ENV.model,
    OPENCODE_ENV.gates,
  ])('fails closed when %s is missing', key => {
    expect(() => readOpenCodeConfig(completeEnv({ [key]: undefined }))).toThrow(WorkerConfigError);
    expect(() => readOpenCodeConfig(completeEnv({ [key]: undefined }))).toThrow(new RegExp(`${key} is required`));
  });

  it('reports every problem at once rather than one per restart', () => {
    let message = '';
    try {
      readOpenCodeConfig({ INTENTSMITH_WORKER: 'opencode' });
    } catch (error) {
      message = (error as Error).message;
    }
    for (const key of Object.values(OPENCODE_ENV)) {
      if (key === OPENCODE_ENV.args) continue;
      expect(message).toContain(key);
    }
  });

  it('rejects a workspace that is not a Git repository', () => {
    // Git is the only authoritative source of change evidence; without it a
    // code task could pass on the worker's word alone.
    expect(() => readOpenCodeConfig(completeEnv({ [OPENCODE_ENV.workspaceRoot]: workspace({ git: false }) }))).toThrow(
      /not a Git repository/,
    );
  });

  it('rejects a workspace path that does not exist', () => {
    expect(() => readOpenCodeConfig(completeEnv({ [OPENCODE_ENV.workspaceRoot]: '/nonexistent/intentsmith' }))).toThrow(
      /is not a directory/,
    );
  });

  it('rejects a relative workspace or executable path', () => {
    expect(() => readOpenCodeConfig(completeEnv({ [OPENCODE_ENV.workspaceRoot]: 'relative' }))).toThrow(
      /must be an absolute path/,
    );
    expect(() => readOpenCodeConfig(completeEnv({ [OPENCODE_ENV.executable]: 'opencode' }))).toThrow(
      /must be an absolute path/,
    );
  });

  it('rejects an executable that cannot be run', () => {
    const root = workspace();
    const file = path.join(root, 'not-executable');
    writeFileSync(file, '#!/bin/sh\n');
    chmodSync(file, 0o644);
    expect(() => readOpenCodeConfig(completeEnv({ [OPENCODE_ENV.executable]: file }))).toThrow(
      /is not an executable file/,
    );
    expect(() => readOpenCodeConfig(completeEnv({ [OPENCODE_ENV.executable]: root }))).toThrow(
      /is not an executable file/,
    );
  });

  it('rejects malformed adapter arguments', () => {
    expect(() => readOpenCodeConfig(completeEnv({ [OPENCODE_ENV.args]: 'not json' }))).toThrow(
      /must be a JSON array of strings/,
    );
    expect(() => readOpenCodeConfig(completeEnv({ [OPENCODE_ENV.args]: JSON.stringify([1, 2]) }))).toThrow(
      /must be a JSON array of strings/,
    );
  });

  it.each([
    ['a relative gates path', 'gates.json', /must be an absolute path/],
    ['an unreadable gates file', '/nonexistent/gates.json', /could not be read as JSON/],
  ])('rejects %s', (_label, value, pattern) => {
    expect(() => readOpenCodeConfig(completeEnv({ [OPENCODE_ENV.gates]: value }))).toThrow(pattern);
  });

  it.each([
    ['an empty gate list', [], /non-empty array of gate definitions/],
    ['a non-array gate file', { id: 'fixture' }, /non-empty array of gate definitions/],
    ['a non-object gate', ['fixture'], /is not an object/],
    ['a gate without an id', [{ description: 'x', executable: '/bin/true' }], /needs a non-empty "id"/],
    ['a gate without a description', [{ id: 'g', executable: '/bin/true' }], /needs a non-empty "description"/],
    [
      'a gate resolved through PATH',
      [{ id: 'g', description: 'd', executable: 'true' }],
      /needs an absolute "executable"/,
    ],
    [
      'a gate with non-string args',
      [{ id: 'g', description: 'd', executable: '/bin/true', args: [3] }],
      /"args" to be an array of strings/,
    ],
    [
      'a gate with non-integer exit codes',
      [{ id: 'g', description: 'd', executable: '/bin/true', passExitCodes: ['0'] }],
      /"passExitCodes" to be an array of integers/,
    ],
    [
      'duplicate gate ids',
      [
        { id: 'g', description: 'd', executable: '/bin/true' },
        { id: 'g', description: 'other', executable: '/bin/true' },
      ],
      /defined more than once/,
    ],
  ])('rejects %s', (_label, gates, pattern) => {
    expect(() => readOpenCodeConfig(completeEnv({ [OPENCODE_ENV.gates]: gatesFile(gates) }))).toThrow(pattern);
  });

  it('keeps operator-declared pass exit codes', () => {
    const config = readOpenCodeConfig(
      completeEnv({
        [OPENCODE_ENV.gates]: gatesFile([
          { id: 'g', description: 'd', executable: process.execPath, args: [], passExitCodes: [0, 2] },
        ]),
      }),
    );
    expect(config.gates[0]?.passExitCodes).toEqual([0, 2]);
  });
});
