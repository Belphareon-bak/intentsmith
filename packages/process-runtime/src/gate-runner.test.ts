import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runGate, runGates, verdictFromGates, type GateDefinition } from './gate-runner.js';

/**
 * Deterministic gate runner.
 *
 * The gates run real processes, because "no shell" and "the worker cannot
 * change the command" are properties of an actual invocation.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'intentsmith-gate-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const env = { PATH: process.env.PATH ?? '/usr/bin:/bin' };

const passing: GateDefinition = {
  id: 'unit',
  description: 'fixture unit tests',
  executable: process.execPath,
  args: ['-e', 'process.stdout.write("ok"); process.exit(0);'],
};

const failing: GateDefinition = {
  id: 'unit',
  description: 'fixture unit tests',
  executable: process.execPath,
  args: ['-e', 'process.stderr.write("assertion failed"); process.exit(1);'],
};

describe('gate runner', () => {
  it('passes a gate that exits zero', async () => {
    const result = await runGate(passing, { cwd: tempDir(), env });
    expect(result.status).toBe('pass');
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTail).toContain('ok');
  });

  it('fails a gate that exits non-zero and keeps its output', async () => {
    const result = await runGate(failing, { cwd: tempDir(), env });
    expect(result.status).toBe('fail');
    expect(result.exitCode).toBe(1);
    expect(result.stderrTail).toContain('assertion failed');
  });

  it('blocks rather than throwing when the executable is missing', async () => {
    const result = await runGate(
      { ...passing, executable: path.join(tempDir(), 'nope') },
      { cwd: tempDir(), env },
    );
    // A gate that could not run is never a pass.
    expect(result.status).not.toBe('pass');
  });

  it('never uses a shell', async () => {
    const runner = vi.fn(async () => ({ code: 0, signal: null, stdout: '', stderr: '' }));
    await runGate(passing, { cwd: '/tmp', env, runner });
    const [executable, args] = runner.mock.calls[0] as unknown as [string, readonly string[]];
    expect(executable).toBe(process.execPath);
    // The argument vector is exactly what Core defined.
    expect(args).toEqual(passing.args);
    for (const arg of args) expect(typeof arg).toBe('string');
  });

  it('runs a gate with a fixed environment', async () => {
    const dir = tempDir();
    const outPath = path.join(dir, 'env.json');
    await runGate(
      {
        id: 'env',
        description: 'environment capture',
        executable: process.execPath,
        args: ['-e', `require('fs').writeFileSync(${JSON.stringify(outPath)}, JSON.stringify(process.env))`],
      },
      { cwd: dir, env: { ...env, GATE_MARKER: 'fixed' } },
    );
    const captured = JSON.parse(readFileSync(outPath, 'utf8')) as Record<string, string>;
    expect(captured.GATE_MARKER).toBe('fixed');
  });

  it('honours a custom pass exit code', async () => {
    const result = await runGate(
      { ...failing, passExitCodes: [1] },
      { cwd: tempDir(), env },
    );
    expect(result.status).toBe('pass');
  });

  it('bounds retained output', async () => {
    const result = await runGate(
      {
        id: 'noisy',
        description: 'floods stdout',
        executable: process.execPath,
        args: ['-e', 'process.stdout.write("y".repeat(50000));'],
      },
      { cwd: tempDir(), env },
    );
    expect(result.stdoutTail.length).toBeLessThanOrEqual(4100);
  });

  it('runs every gate rather than stopping at the first failure', async () => {
    const results = await runGates(
      [
        { ...failing, id: 'first' },
        { ...passing, id: 'second' },
      ],
      { cwd: tempDir(), env },
    );
    expect(results.map(result => result.id)).toEqual(['first', 'second']);
    expect(results[1]?.status).toBe('pass');
  });
});

describe('verdict from gates', () => {
  const result = (id: string, status: 'pass' | 'fail' | 'blocked') => ({
    id,
    description: id,
    status,
    exitCode: status === 'pass' ? 0 : 1,
    signal: null,
    durationMs: 1,
    stdoutTail: '',
    stderrTail: '',
  });

  it('passes only when every gate passes', () => {
    expect(verdictFromGates([result('a', 'pass'), result('b', 'pass')])).toBe('pass');
    expect(verdictFromGates([result('a', 'pass'), result('b', 'fail')])).toBe('fail');
  });

  it('never treats a blocked gate as a pass', () => {
    expect(verdictFromGates([result('a', 'pass'), result('b', 'blocked')])).toBe('blocked');
  });

  it('treats no gates as blocked rather than passing by default', () => {
    // Nothing verified is not the same as everything verified.
    expect(verdictFromGates([])).toBe('blocked');
  });

  it('a worker claim is not an input to the verdict', () => {
    // The signature takes gate results only; there is nowhere for a claim to go.
    const claimedSuccess = [result('unit', 'fail')];
    expect(verdictFromGates(claimedSuccess)).toBe('fail');
  });
});

describe('fixture repository shape', () => {
  it('a baseline gate fails before the change and passes after it', async () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    const testPath = path.join(dir, 'check.cjs');
    writeFileSync(
      testPath,
      [
        `const answer = require('./src/answer.js');`,
        `if (answer !== 4) { console.error('expected 4, got ' + answer); process.exit(1); }`,
        `console.log('ok');`,
      ].join('\n'),
    );
    const gate: GateDefinition = {
      id: 'fixture',
      description: 'fixture expectation',
      executable: process.execPath,
      args: [testPath],
    };

    // Baseline: the deliberately wrong answer must fail.
    writeFileSync(path.join(dir, 'src', 'answer.js'), 'module.exports = 3;\n');
    expect((await runGate(gate, { cwd: dir, env })).status).toBe('fail');

    // After the proposed change it must pass.
    writeFileSync(path.join(dir, 'src', 'answer.js'), 'module.exports = 4;\n');
    expect((await runGate(gate, { cwd: dir, env })).status).toBe('pass');
  });
});
