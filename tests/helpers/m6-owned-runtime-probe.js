import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const NETWORK_NAMESPACE_MARKER = 'INTENTSMITH_M6_LOOPBACK_NETNS_CHILD';
const LOOPBACK = '127.0.0.1';

function boundedOutput(value, chunk, limit = 2_000_000) {
  return `${value}${String(chunk)}`.slice(-limit);
}

function childExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

export async function reexecInLoopbackNetworkNamespace(entryUrl) {
  if (process.env[NETWORK_NAMESPACE_MARKER] === '1') return false;
  const child = spawn('unshare', [
    '--user',
    '--map-root-user',
    '--net',
    '--',
    process.execPath,
    fileURLToPath(entryUrl),
  ], {
    cwd: process.cwd(),
    env: { ...process.env, [NETWORK_NAMESPACE_MARKER]: '1' },
    stdio: 'inherit',
  });
  const result = await childExit(child);
  if (result.signal !== null || result.code !== 0) {
    const error = new Error(
      `M6 loopback network namespace child failed: ${result.signal || result.code}`,
    );
    error.code = 'M6_LOOPBACK_NAMESPACE_FAILED';
    throw error;
  }
  return true;
}

export function assertLoopbackNetworkNamespace() {
  if (process.env[NETWORK_NAMESPACE_MARKER] !== '1') {
    throw new Error('M6 runtime probe requires its owned Linux network namespace');
  }
  const configured = spawnSync('ip', ['link', 'set', 'lo', 'up'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (configured.error || configured.status !== 0) {
    throw new Error(
      `M6 runtime probe could not enable loopback: ${configured.error?.message || configured.stderr}`,
    );
  }
  const observed = spawnSync('ip', ['-j', 'address', 'show', 'up'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (observed.error || observed.status !== 0) {
    throw new Error(
      `M6 runtime probe could not inspect namespace: ${observed.error?.message || observed.stderr}`,
    );
  }
  const interfaces = JSON.parse(observed.stdout);
  if (!Array.isArray(interfaces)
    || interfaces.length !== 1
    || interfaces[0]?.ifname !== 'lo') {
    throw new Error('M6 runtime probe namespace exposes a non-loopback interface');
  }
  return Object.freeze({ interfaceNames: Object.freeze(['lo']) });
}

function safeServerEnvironment(runtime, adminToken) {
  const env = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'TZ']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return {
    ...env,
    HOME: runtime.home,
    XDG_CONFIG_HOME: runtime.xdgConfig,
    XDG_CACHE_HOME: runtime.xdgCache,
    XDG_DATA_HOME: runtime.xdgData,
    XDG_STATE_HOME: runtime.xdgState,
    TMPDIR: runtime.temp,
    TMP: runtime.temp,
    TEMP: runtime.temp,
    NODE_ENV: 'production',
    CI: '1',
    DOTENV_CONFIG_PATH: path.join(runtime.temp, 'missing.env'),
    DOTENV_CONFIG_QUIET: 'true',
    C3_ADMIN_TOKEN: adminToken,
    C3_HOST: LOOPBACK,
    C3_PORT: '0',
    C3_PORT_FILE: runtime.portFile,
    C3_DB_PATH: runtime.database,
    C3_PROJECTS_DIR: runtime.projects,
    INTENTSMITH_TEST_PROJECTS_DIR: runtime.projects,
    INTENTSMITH_TEST_ARTIFACT_DIR: runtime.artifacts,
    C3_CORS_ORIGINS: '',
    C3_ENABLE_AGENTS: 'false',
    C3_ENABLE_EXPERTISES: 'false',
    C3_ENABLE_LIFECYCLE: 'false',
    C3_ENABLE_COMFYUI: 'false',
    C3_ENABLE_AUTONOMY: 'false',
    C3_ENABLE_SKILLS: 'false',
    C3_ENABLE_TELEMETRY: 'false',
    C3_ENABLE_ONLINE_DISCOVERY: 'false',
    C3_MODEL_UNIVERSE_ENABLED: 'false',
    C3_MODEL_RUNTIME_GUARD_ENABLED: 'false',
    C3_LIFECYCLE_AUTO_COMMIT: 'false',
    C3_UPDATE_REPO: '',
    C3_TRACE: '0',
    C3_LOG_LEVEL: 'warn',
    OLLAMA_URL: 'http://127.0.0.1:9',
  };
}

async function waitForPortFile(child, portFile, output) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`M6 owned server exited during startup\n${output()}`);
    }
    try {
      const authority = JSON.parse(readFileSync(portFile, 'utf8'));
      if (authority.pid === child.pid
        && Number.isSafeInteger(authority.port)
        && authority.port >= 1
        && authority.port <= 65535
        && /^[A-Za-z0-9_-]{43}$/u.test(authority.localCapability || '')) {
        return Object.freeze({
          pid: authority.pid,
          port: authority.port,
          localCapability: authority.localCapability,
        });
      }
    } catch { /* server has not atomically published its authority yet */ }
    await delay(25);
  }
  throw new Error(`M6 owned server did not become ready\n${output()}`);
}

export async function startOwnedProductionServer({ root, runtime, adminToken }) {
  let output = '';
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: safeServerEnvironment(runtime, adminToken),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { output = boundedOutput(output, chunk); });
  child.stderr.on('data', chunk => { output = boundedOutput(output, chunk); });
  const authority = await waitForPortFile(child, runtime.portFile, () => output);
  return {
    child,
    authority,
    output: () => output,
  };
}

export async function stopOwnedProductionServer(server, timeoutMs = 30_000) {
  if (!server?.child || server.child.exitCode !== null || server.child.signalCode !== null) {
    return Object.freeze({ clean: server?.child?.exitCode === 0, forced: false });
  }
  server.child.kill('SIGTERM');
  const result = await Promise.race([
    childExit(server.child),
    delay(timeoutMs).then(() => null),
  ]);
  if (result === null) {
    server.child.kill('SIGKILL');
    await childExit(server.child);
    return Object.freeze({ clean: false, forced: true });
  }
  return Object.freeze({
    clean: result.code === 0 && result.signal === null,
    forced: false,
  });
}

export function createLoopbackAgent(maxSockets = 64) {
  return new http.Agent({ keepAlive: true, maxSockets, maxFreeSockets: maxSockets });
}

export function requestJson({ port, pathname, headers = {}, agent, timeoutMs = 10_000 }) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: LOOPBACK,
      port,
      method: 'GET',
      path: pathname,
      headers,
      agent,
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        raw += chunk;
        if (raw.length > 2_000_000) request.destroy(new Error('M6 response exceeded 2 MB'));
      });
      response.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* caller validates shape */ }
        resolve(Object.freeze({
          status: response.statusCode,
          json,
          raw,
          durationMs: performance.now() - started,
        }));
      });
    });
    request.once('error', reject);
    request.setTimeout(timeoutMs, () => request.destroy(new Error('M6 request timed out')));
    request.end();
  });
}

export function readProcessRssMiB(pid) {
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/mu);
  if (!match) throw new Error('M6 RSS measurement is unavailable');
  const value = Number(match[1]) / 1024;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('M6 RSS measurement is invalid');
  }
  return value;
}

export class LatencyHistogram {
  constructor(maximumMs = 10_000) {
    this.maximumMs = maximumMs;
    this.buckets = new Uint32Array(maximumMs + 2);
    this.count = 0;
    this.maximumObservedMs = 0;
  }

  add(value) {
    if (!Number.isFinite(value) || value < 0) throw new Error('invalid latency sample');
    const rounded = Math.ceil(value);
    const bucket = Math.min(this.maximumMs + 1, rounded);
    this.buckets[bucket] += 1;
    this.count += 1;
    this.maximumObservedMs = Math.max(this.maximumObservedMs, value);
  }

  percentile(percent) {
    if (this.count === 0) return null;
    const target = Math.max(1, Math.ceil(this.count * percent));
    let seen = 0;
    for (let index = 0; index < this.buckets.length; index += 1) {
      seen += this.buckets[index];
      if (seen >= target) return index;
    }
    return this.maximumMs + 1;
  }

  summary() {
    return Object.freeze({
      samples: this.count,
      p50Ms: this.percentile(0.50),
      p95Ms: this.percentile(0.95),
      p99Ms: this.percentile(0.99),
      maxMs: Math.ceil(this.maximumObservedMs),
    });
  }
}

export function encodeRuntimeReceipt(marker, receipt) {
  return `${marker}${Buffer.from(JSON.stringify(receipt), 'utf8').toString('base64url')}`;
}

export function exactCandidateSha() {
  let value = process.env.INTENTSMITH_TEST_SOURCE_REVISION;
  if (!value && process.env.INTENTSMITH_DIRECT_TEST_RUN === '1') {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!result.error && result.status === 0) value = result.stdout.trim();
  }
  if (!/^[a-f0-9]{40}$/u.test(value || '')) {
    throw new Error('M6 runtime probe requires an exact candidate SHA');
  }
  return value;
}
