import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { assertRedacted, createRedactor } from '@intentsmith/worker-sdk';

export type CommandResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  pid: number;
  processGroupMembersAfterCleanup: number[];
  logsFlushed: true;
};

type Kill = (pid: number, signal: NodeJS.Signals | 0) => void;

export class OwnedProcessGroups {
  private readonly live = new Map<number, string>();

  constructor(private readonly kill: Kill = process.kill) {}

  register(pgid: number, sessionId: string): void {
    this.live.set(pgid, sessionId);
  }

  signal(pgid: number, sessionId: string, signal: NodeJS.Signals): boolean {
    if (this.live.get(pgid) !== sessionId) return false;
    try {
      this.kill(-pgid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    return true;
  }

  release(pgid: number, sessionId: string): void {
    if (this.live.get(pgid) === sessionId) this.live.delete(pgid);
  }

  /**
   * A group learned from a checkpoint belongs to a dead runner session. PID
   * reuse makes signalling it unsafe, so this operation is always a refusal.
   */
  signalRecoveredGroup(_pgid: number, _signal: NodeJS.Signals): false {
    return false;
  }

  members(pgid: number): number[] {
    try {
      this.kill(-pgid, 0);
      return [pgid];
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return [];
      if (code === 'EPERM') return [pgid];
      throw error;
    }
  }
}

export async function executeOwnedCommand(options: {
  command: readonly [string, ...string[]];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  terminationGraceMs?: number;
  stdoutPath: string;
  stderrPath: string;
  sessionId: string;
  secrets?: readonly string[];
  groups?: OwnedProcessGroups;
  spawnOptions?: Omit<SpawnOptionsWithoutStdio, 'cwd' | 'env' | 'detached' | 'stdio'>;
}): Promise<CommandResult> {
  await Promise.all([mkdir(dirname(options.stdoutPath), { recursive: true }), mkdir(dirname(options.stderrPath), { recursive: true })]);
  const groups = options.groups ?? new OwnedProcessGroups();
  const started = Date.now();
  const [program, ...args] = options.command;
  const child = spawn(program, args, {
    ...options.spawnOptions,
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (child.pid === undefined) throw new Error('Child process did not receive a PID.');
  const pgid = child.pid;
  groups.register(pgid, options.sessionId);

  const stdout = createWriteStream(options.stdoutPath, { flags: 'wx', mode: 0o600 });
  const stderr = createWriteStream(options.stderrPath, { flags: 'wx', mode: 0o600 });
  const stdoutDone = pipeline(child.stdout, stdout);
  const stderrDone = pipeline(child.stderr, stderr);
  let timedOut = false;
  let forced: NodeJS.Timeout | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    groups.signal(pgid, options.sessionId, 'SIGTERM');
    forced = setTimeout(
      () => groups.signal(pgid, options.sessionId, 'SIGKILL'),
      options.terminationGraceMs ?? 1_000,
    );
    forced.unref();
  }, options.timeoutMs);
  timeout.unref();

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolvePromise({ code, signal }));
  });
  clearTimeout(timeout);
  if (forced) clearTimeout(forced);
  await Promise.all([stdoutDone, stderrDone]);
  const redactor = createRedactor(options.secrets ?? []);
  for (const path of [options.stdoutPath, options.stderrPath]) {
    const value = redactor.text(await readFile(path, 'utf8'));
    assertRedacted(redactor, value, path);
    const temporary = `${path}.redacted-${process.pid}`;
    await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, path);
  }

  if (groups.members(pgid).length > 0) {
    groups.signal(pgid, options.sessionId, 'SIGKILL');
    const deadline = Date.now() + 2_000;
    while (groups.members(pgid).length > 0 && Date.now() < deadline) {
      await new Promise(resolvePromise => setTimeout(resolvePromise, 10));
    }
  }
  const members = groups.members(pgid);
  groups.release(pgid, options.sessionId);
  return {
    exitCode: exit.code,
    signal: exit.signal,
    timedOut,
    durationMs: Date.now() - started,
    pid: pgid,
    processGroupMembersAfterCleanup: members,
    logsFlushed: true,
  };
}
