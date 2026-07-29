/**
 * Real OpenCode probe against a run-scoped IntentSmith gateway.
 *
 * Not part of any test suite. Run manually with `tsx` during Phase 3
 * verification; the evidence it produces is summarized in
 * `docs/testing/phase-3-results.md`.
 *
 * Records no prompt text, no model output, no gateway token and no GPU UUID.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { OllamaProvider, fetchTransport } from '@intentsmith/adapter-ollama';
import { HardwareDirector } from '@intentsmith/hardware';
import { InferenceScheduler } from '@intentsmith/inference';

import { buildGateway } from '../src/gateway/gateway.js';
import { GatewayTokenStore } from '../src/gateway/token-store.js';

const PROBE = process.env.PROBE ?? '';
const OUT = process.env.OUT ?? '/tmp/gw-probe.json';
const BIN = `${PROBE}/pkg/node_modules/opencode-linux-x64/bin/opencode`;
const HOME = `${PROBE}/home`;
const CWD = `${PROBE}/fixture`;
const MODEL = process.env.PROBE_MODEL ?? 'qwen3:14b';
const TOKEN_ENV = 'INTENTSMITH_GATEWAY_TOKEN';
/** `--pure` is deliberately omitted: the config must stand on its own. */
const ACP_ARGV = ['acp', '--cwd', CWD];

type GatewayHit = { path: string; authorized: boolean; model?: string };

const gatewayHits: GatewayHit[] = [];
const ollamaHits: string[] = [];

const tokens = new GatewayTokenStore();
const provider = new OllamaProvider({
  endpoint: 'http://127.0.0.1:11434',
  transport: async (url, init) => {
    ollamaHits.push(url);
    return await fetchTransport(url, init);
  },
  timeouts: { connectMs: 10_000, firstByteMs: 180_000, idleMs: 180_000, overallMs: 420_000 },
});

const runtime = {
  core: {} as never,
  provider,
  scheduler: new InferenceScheduler({ maxConcurrent: 1 }),
  hardware: new HardwareDirector(),
  gatewayTokens: tokens,
  executionPolicy: 'cpu_allowed' as const,
  close: () => undefined,
};

const app = buildGateway({ runtime: runtime as never, tokens });
app.addHook('onRequest', async request => {
  gatewayHits.push({
    path: request.url,
    authorized: typeof request.headers.authorization === 'string',
  });
});
/** Captures the shape a real OpenAI-compatible client sends. */
const observedBodyKeys = new Set<string>();
const observedShape: Array<Record<string, unknown>> = [];
app.addHook('preValidation', async request => {
  const body = request.body as Record<string, unknown> | undefined;
  if (body && typeof body === 'object') {
    for (const key of Object.keys(body)) observedBodyKeys.add(key);
    if (observedShape.length < 2) {
      observedShape.push({
        model: body.model,
        stream: body.stream,
        max_tokens: body.max_tokens,
        top_p: body.top_p,
        stream_options: body.stream_options,
        tool_choice: body.tool_choice,
        toolsCount: Array.isArray(body.tools) ? body.tools.length : null,
        toolNames: Array.isArray(body.tools)
          ? body.tools.slice(0, 12).map(t => (t as { function?: { name?: string } })?.function?.name)
          : null,
        messageRoles: Array.isArray(body.messages)
          ? (body.messages as Array<{ role: string }>).map(m => m.role)
          : null,
      });
    }
    const last = gatewayHits.at(-1);
    if (last && typeof body.model === 'string') last.model = body.model;
  }
});

await app.listen({ host: '127.0.0.1', port: 0 });
const bound = app.server.address() as { port: number };
const baseUrl = `http://127.0.0.1:${bound.port}`;
const token = tokens.issue('run_probe', 'task_probe').value;

// Explicit configuration: exactly one provider, one model, one endpoint.
const configDir = path.join(HOME, 'config', 'opencode');
mkdirSync(configDir, { recursive: true });
const config = {
  $schema: 'https://opencode.ai/config.json',
  provider: {
    'intentsmith-local': {
      npm: '@ai-sdk/openai-compatible',
      name: 'IntentSmith Local Gateway',
      options: { baseURL: `${baseUrl}/v1`, apiKey: `{env:${TOKEN_ENV}}` },
      models: { [MODEL]: { name: MODEL } },
    },
  },
  model: `intentsmith-local/${MODEL}`,
  autoupdate: false,
  autoshare: false,
};
const configPath = path.join(configDir, 'opencode.json');
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

const childEnv: Record<string, string> = {
  PATH: '/usr/bin:/bin',
  HOME,
  XDG_CONFIG_HOME: `${HOME}/config`,
  XDG_DATA_HOME: `${HOME}/data`,
  XDG_CACHE_HOME: `${HOME}/cache`,
  XDG_STATE_HOME: `${HOME}/state`,
  TMPDIR: `${HOME}/tmp`,
  CI: '1',
  NO_COLOR: '1',
  [TOKEN_ENV]: token,
};
mkdirSync(`${HOME}/tmp`, { recursive: true });

const child = spawn(BIN, ACP_ARGV, {
  cwd: CWD,
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: true,
  env: childEnv,
});
const stderrChunks: string[] = [];
child.stderr.on('data', chunk => stderrChunks.push(String(chunk)));

type Wire = { dir: 'out' | 'in' | 'in-raw'; m?: Record<string, unknown>; raw?: string };
const wire: Wire[] = [];
const pending = new Map<number, (m: Record<string, unknown>) => void>();
let buffer = '';

child.stdout.on('data', chunk => {
  buffer += String(chunk);
  let newline = buffer.indexOf('\n');
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf('\n');
    if (!line) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      wire.push({ dir: 'in-raw', raw: line.slice(0, 200) });
      continue;
    }
    wire.push({ dir: 'in', m: parsed });
    const id = parsed.id;
    if (typeof id === 'number' && pending.has(id)) {
      pending.get(id)?.(parsed);
      pending.delete(id);
    }
  }
});

let nextId = 0;
function send(method: string, params: unknown, timeoutMs = 300_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const message = { jsonrpc: '2.0', id, method, params };
    wire.push({ dir: 'out', m: message });
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify(message)}\n`);
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
  });
}
function notify(method: string, params: unknown): void {
  const message = { jsonrpc: '2.0', method, params };
  wire.push({ dir: 'out', m: message });
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

const out: Record<string, unknown> = {
  argv: ACP_ARGV,
  configPath,
  config,
  envKeys: Object.keys(childEnv).sort(),
  gatewayBaseUrl: baseUrl,
  requestedModel: MODEL,
};

try {
  const init = await send('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: 'IntentSmith', version: '0.1.0' },
  });
  out.initialize = init.result;

  const session = await send('session/new', { cwd: CWD, mcpServers: [] });
  const sessionResult = session.result as {
    sessionId: string;
    configOptions?: Array<{ id: string; currentValue: string }>;
  };
  out.sessionId = `${sessionResult.sessionId.slice(0, 8)}...`;
  out.effectiveModel = sessionResult.configOptions?.find(option => option.id === 'model')?.currentValue;

  const prompt = await send('session/prompt', {
    sessionId: sessionResult.sessionId,
    prompt: [{ type: 'text', text: 'Reply with exactly the word READY and nothing else.' }],
  });
  out.promptResult = prompt.result;
  out.stopReason = (prompt.result as { stopReason?: string } | undefined)?.stopReason;

  // Cancellation on a second turn, to observe the shape.
  const second = send('session/prompt', {
    sessionId: sessionResult.sessionId,
    prompt: [{ type: 'text', text: 'Count slowly from one to two hundred.' }],
  }, 60_000);
  await new Promise(resolve => setTimeout(resolve, 3000));
  notify('session/cancel', { sessionId: sessionResult.sessionId });
  out.cancelledTurn = await second.then(
    m => (m.result as { stopReason?: string } | undefined)?.stopReason ?? 'resolved',
    e => `rejected: ${String((e as Error).message)}`,
  );
} catch (error) {
  out.error = String((error as Error).message);
}

const updates = wire.filter(w => w.dir === 'in' && w.m?.method === 'session/update');
out.updateCount = updates.length;
out.updateKinds = [
  ...new Set(
    updates.map(u => {
      const params = u.m?.params as { update?: { sessionUpdate?: string } } | undefined;
      return params?.update?.sessionUpdate ?? 'unknown';
    }),
  ),
];
out.agentInitiatedRequests = [
  ...new Set(
    wire
      .filter(w => w.dir === 'in' && typeof w.m?.method === 'string' && w.m?.id !== undefined)
      .map(w => String(w.m?.method)),
  ),
];
out.rawNonJsonLines = wire.filter(w => w.dir === 'in-raw').length;
out.observedRequestBodyKeys = [...observedBodyKeys].sort();
out.observedRequestShape = observedShape;
out.gatewayHits = gatewayHits;
out.ollamaHits = ollamaHits;
out.stderrTail = stderrChunks.join('').slice(-2000);

// Token containment: the secret must appear nowhere we recorded.
const serialized = JSON.stringify({ ...out, wire });
out.tokenLeakedIntoEvidence = serialized.includes(token);
out.tokenInArgv = ACP_ARGV.some(arg => arg.includes(token));
out.tokenInConfigFile = JSON.stringify(config).includes(token);

// Revocation, then a post-run probe.
tokens.revokeRun('run_probe');
const afterRun = await fetch(`${baseUrl}/v1/models`, { headers: { authorization: `Bearer ${token}` } });
out.tokenStatusAfterRevoke = afterRun.status;

try {
  process.kill(-(child.pid ?? 0), 'SIGKILL');
} catch {
  // Already gone.
}
await app.close();
writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
process.exit(0);
