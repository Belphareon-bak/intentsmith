#!/usr/bin/env node
// Run from systemd --user to test the actual production launch context.
// A probe in an IDE can inherit a different AppArmor profile and falsely pass.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProcessSandboxProvider } from '../src/execution/process-sandbox-provider.js';
import { LINUX_BWRAP_READ_ONLY_PROFILE } from '../src/execution/process-supervisor-child.js';
import { computeM2ExecutionValueDigest } from '../contracts/m2/execution-v1.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intentsmith-sandbox-probe-'));
try {
  const environment = { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' };
  const argv = ['--disable-wasm-trap-handler', '--input-type=module', '-e',
    'import assert from "node:assert/strict";import "node:http";assert.equal(new WebAssembly.Memory({initial:1}).buffer.byteLength,65536);console.log("PROJECT_SANDBOX_PROBE_OK");'];
  const result = await createProcessSandboxProvider().run({ projectRoot: root, canonicalCwd: root,
    binary: process.execPath, argv, argvDigest: computeM2ExecutionValueDigest(argv),
    environment, environmentDigest: computeM2ExecutionValueDigest(environment),
    sandboxProfile: LINUX_BWRAP_READ_ONLY_PROFILE, timeoutMs: 10000, expectedExitCode: 0 }, {
    async recordSupervisorIdentity(identity) {
      const handle = await fs.open(path.join(root, 'supervisor.json'), 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(identity)); await handle.sync(); } finally { await handle.close(); }
      return { durable: true };
    },
  });
  const passed = result.terminalStatus === 'succeeded' && result.exitCode === 0
    && result.stdout.trim() === 'PROJECT_SANDBOX_PROBE_OK';
  console.log(JSON.stringify({ verdict: passed ? 'PASS' : 'BLOCKED',
    apparmor: (await fs.readFile('/proc/self/attr/current', 'utf8')).trim(),
    terminalStatus: result.terminalStatus, exitCode: result.exitCode,
    errorCode: result.errorCode, stdout: result.stdout, stderr: result.stderr,
    scope: 'Actual M2 process provider, isolated temporary fixture; no user project, DB or GPU.' }, null, 2));
  if (!passed) process.exitCode = 1;
} finally { await fs.rm(root, { recursive: true, force: true }); }
