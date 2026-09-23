// Observed host facts, never repository instructions or permission to execute.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';

const TOOL_NAMES = ['git', 'npm', 'python3', 'pip3', 'dotnet', 'cargo', 'go', 'cmake', 'make', 'bwrap', 'prlimit'];
let cached;

export async function inspectDevelopmentEnvironment({ refresh = false } = {}) {
  if (!refresh && cached && Date.now() - cached.observedAtMs < 30_000) return structuredClone(cached);
  let distribution = null;
  if (process.platform === 'linux') {
    try {
      const release = (await fs.readFile('/etc/os-release', 'utf8')).slice(0, 8192);
      distribution = release.match(/^PRETTY_NAME=["']?([^\n"']+)/m)?.[1] || null;
    } catch { /* Unavailable is a fact; do not infer a distribution. */ }
  }
  const directories = [...new Set([path.dirname(process.execPath), ...(process.env.PATH || '').split(path.delimiter)])]
    .filter(directory => path.isAbsolute(directory));
  const tools = {};
  for (const name of TOOL_NAMES) {
    tools[name] = null;
    for (const directory of directories) {
      try {
        const executable = await fs.realpath(path.join(directory, name));
        if (!(await fs.stat(executable)).isFile()) continue;
        await fs.access(executable, constants.X_OK);
        tools[name] = executable; break;
      } catch { /* Continue through the backend's actual PATH, not a guessed shell PATH. */ }
    }
  }
  cached = { observedAtMs: Date.now(), platform: process.platform, architecture: process.arch,
    kernel: os.release(), distribution, runtime: { node: process.versions.node, executable: process.execPath },
    shell: process.env.SHELL || null, tools,
    permissions: { uid: process.getuid?.() ?? null, automaticElevation: false },
    observation: 'Executable presence only; no commands executed. Host and project target may differ.' };
  return structuredClone(cached);
}

export async function developmentEnvironmentPrompt() {
  const observed = await inspectDevelopmentEnvironment();
  const available = Object.entries(observed.tools).filter(([, executable]) => executable).map(([name]) => name);
  return '\nBackend host (observed now): ' + JSON.stringify({
    os: observed.distribution || observed.platform, arch: observed.architecture, node: observed.runtime.node, tools: available,
  }) + '\nHost OS is not project target. Tool presence is not build proof. No sudo. Installs need a concrete plan and policy; project button Závislosti opens it.';
}
