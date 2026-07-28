/**
 * Phase 3B contract spike: tool capability mediation.
 *
 * Decision gate, not a test. Run manually against the pinned real OpenCode
 * binary and a local Ollama. Proves on the wire whether OpenCode can be
 * mediated safely:
 *
 *   - does it ask permission before every side effect?
 *   - does a denial actually prevent the side effect?
 *   - is the permission payload structured enough to drive policy?
 *   - can the gateway translate an OpenAI tool request to Ollama /api/chat
 *     and hand the tool result back for the following turn?
 *
 * Records no prompt text, no model output, no token and no GPU identifier.
 * The gateway here executes nothing: it only translates the model protocol.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import Fastify from 'fastify';

const PROBE = process.env.PROBE ?? '';
const OUT = process.env.OUT ?? '/tmp/spike.json';
const BIN = `${PROBE}/pkg/node_modules/opencode-linux-x64/bin/opencode`;
const HOME = `${PROBE}/home`;
const CWD = `${PROBE}/fixture`;
const MODEL = 'qwen3:14b';
const TOKEN_ENV = 'INTENTSMITH_GATEWAY_TOKEN';
const OLLAMA = 'http://127.0.0.1:11434';

/** Denies every permission when true, to prove a denial blocks the effect. */
const DENY_ALL = process.env.DENY_ALL === '1';
/** File the model is asked to create, watched to detect a side effect. */
const TARGET_REL = 'src/created-by-worker.txt';

type Observation = {
  at: number;
  kind: string;
  detail?: unknown;
};

const timeline: Observation[] = [];
const note = (kind: string, detail?: unknown): void => {
  timeline.push({ at: Date.now(), kind, ...(detail === undefined ? {} : { detail }) });
};

const targetAbs = path.join(CWD, TARGET_REL);
const targetExists = (): boolean => existsSync(targetAbs);

// ---------------------------------------------------------------------------
// Spike gateway: translates OpenAI chat+tools onto Ollama /api/chat.
// It executes nothing. No shell, no filesystem, no outbound network beyond
// the local Ollama endpoint.
// ---------------------------------------------------------------------------
const token = `spike-token-${Math.random().toString(36).slice(2)}${'x'.repeat(16)}`;
const gatewayRequests: Array<{ toolCount: number; hasToolResult: boolean; messageRoles: string[] }> = [];
const gatewayResponses: Array<{ toolCallNames: string[] }> = [];
const rawToolCallSamples: Array<Record<string, unknown>> = [];
const advertisedToolSchemas: Array<Record<string, unknown>> = [];

const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });

app.addHook('onRequest', async (request, reply) => {
  const header = request.headers.authorization;
  if (header !== `Bearer ${token}`) {
    return reply.status(401).send({ error: { code: 'GATEWAY_TOKEN_INVALID', message: 'token required' } });
  }
  return undefined;
});

app.get('/v1/models', async () => ({
  object: 'list',
  data: [{ id: MODEL, object: 'model', owned_by: 'intentsmith-local' }],
}));

type ChatMessage = {
  role: string;
  content?: unknown;
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>;
  tool_call_id?: string;
};

app.post('/v1/chat/completions', async (request, reply) => {
  const body = request.body as {
    model: string;
    messages: ChatMessage[];
    tools?: Array<{ type?: string; function?: { name?: string; description?: string; parameters?: unknown } }>;
    tool_choice?: unknown;
    stream?: boolean;
    max_tokens?: number;
  };

  gatewayRequests.push({
    toolCount: body.tools?.length ?? 0,
    hasToolResult: body.messages.some(message => message.role === 'tool'),
    messageRoles: body.messages.map(message => message.role),
  });

  // Translate OpenAI -> Ollama /api/chat. `arguments` is an object upstream and
  // a JSON string in the OpenAI shape, so it is converted in both directions.
  const ollamaMessages = body.messages.map(message => {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      return {
        role: 'assistant',
        content: typeof message.content === 'string' ? message.content : '',
        tool_calls: message.tool_calls.map(call => ({
          function: {
            name: call.function?.name ?? '',
            arguments:
              typeof call.function?.arguments === 'string'
                ? (JSON.parse(call.function.arguments || '{}') as unknown)
                : (call.function?.arguments ?? {}),
          },
        })),
      };
    }
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''),
      };
    }
    return {
      role: message.role,
      content:
        typeof message.content === 'string'
          ? message.content
          : Array.isArray(message.content)
            ? (message.content as Array<{ text?: string }>).map(part => part.text ?? '').join('')
            : String(message.content ?? ''),
    };
  });

  const ollamaBody: Record<string, unknown> = {
    model: MODEL,
    stream: false,
    messages: ollamaMessages,
    options: { num_predict: Math.min(body.max_tokens ?? 512, 1024), temperature: 0 },
  };
  if (body.tools && body.tools.length > 0) {
    ollamaBody.tools = body.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.function?.name ?? '',
        description: tool.function?.description ?? '',
        parameters: tool.function?.parameters ?? { type: 'object', properties: {} },
      },
    }));
  }

  const upstream = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ollamaBody),
  });
  const payload = (await upstream.json()) as {
    message?: { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }> };
    prompt_eval_count?: number;
    eval_count?: number;
  };

  const toolCalls = (payload.message?.tool_calls ?? []).map((call, index) => ({
    id: call.id ?? `call_${index}`,
    type: 'function',
    function: {
      name: call.function?.name ?? '',
      // OpenAI requires a JSON *string* here.
      arguments: JSON.stringify(call.function?.arguments ?? {}),
    },
  }));
  gatewayResponses.push({ toolCallNames: toolCalls.map(call => call.function.name) });
  if (toolCalls.length > 0 && rawToolCallSamples.length < 3) {
    rawToolCallSamples.push({
      fromOllama: payload.message?.tool_calls,
      translated: toolCalls,
      finishReason: 'tool_calls',
    });
  }
  // Record the tool schema OpenCode advertised, so a mismatch is visible.
  if (body.tools && body.tools.length > 0 && advertisedToolSchemas.length === 0) {
    for (const tool of body.tools) {
      advertisedToolSchemas.push({ name: tool.function?.name, parameters: tool.function?.parameters });
    }
  }

  const created = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-${created}`;
  const content = payload.message?.content ?? '';
  const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';

  // OpenCode requests `stream: true`. A non-streamed body is silently unusable
  // to the AI SDK client, so the streaming shape must be produced properly,
  // including tool-call deltas.
  if (body.stream !== false) {
    reply.raw.setHeader('content-type', 'text/event-stream');
    reply.raw.setHeader('cache-control', 'no-store');
    const chunk = (delta: Record<string, unknown>, finish: string | null): void => {
      reply.raw.write(
        `data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model: body.model,
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`,
      );
    };

    chunk({ role: 'assistant' }, null);
    if (content.length > 0) chunk({ content }, null);
    for (const [index, call] of toolCalls.entries()) {
      chunk(
        {
          tool_calls: [
            {
              index,
              id: call.id,
              type: 'function',
              function: { name: call.function.name, arguments: call.function.arguments },
            },
          ],
        },
        null,
      );
    }
    chunk({}, finishReason);
    reply.raw.write(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model: body.model,
        choices: [],
        usage: {
          prompt_tokens: payload.prompt_eval_count ?? 0,
          completion_tokens: payload.eval_count ?? 0,
          total_tokens: (payload.prompt_eval_count ?? 0) + (payload.eval_count ?? 0),
        },
      })}\n\n`,
    );
    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();
    return reply;
  }

  return reply.send({
    id,
    object: 'chat.completion',
    created,
    model: body.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: payload.prompt_eval_count ?? 0,
      completion_tokens: payload.eval_count ?? 0,
      total_tokens: (payload.prompt_eval_count ?? 0) + (payload.eval_count ?? 0),
    },
  });
});

await app.listen({ host: '127.0.0.1', port: 0 });
const bound = app.server.address() as { port: number };
const baseUrl = `http://127.0.0.1:${bound.port}`;

// ---------------------------------------------------------------------------
// Isolated OpenCode runtime.
// ---------------------------------------------------------------------------
const configDir = path.join(HOME, 'config', 'opencode');
mkdirSync(configDir, { recursive: true });
mkdirSync(`${HOME}/tmp`, { recursive: true });
writeFileSync(
  path.join(configDir, 'opencode.json'),
  `${JSON.stringify(
    {
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
      // Force OpenCode to ask before every side-effecting tool. The default is
      // permissive, so relying on it would let a worker act unmediated.
      permission: {
        edit: 'ask',
        bash: 'ask',
        webfetch: 'ask',
        write: 'ask',
      },
      autoupdate: false,
      autoshare: false,
    },
    null,
    2,
  )}\n`,
);

const child = spawn(BIN, ['acp', '--cwd', CWD], {
  cwd: CWD,
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: true,
  env: {
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
  },
});
const stderrChunks: string[] = [];
child.stderr.on('data', chunk => stderrChunks.push(String(chunk)));

const permissionPayloads: unknown[] = [];
const sessionUpdates: Array<{ kind: string; sample?: unknown }> = [];
let buffer = '';
const pending = new Map<number, (m: Record<string, unknown>) => void>();

function reply(id: unknown, result: unknown): void {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

child.stdout.on('data', chunk => {
  buffer += String(chunk);
  let newline = buffer.indexOf('\n');
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf('\n');
    if (!line) continue;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const method = message.method as string | undefined;

    if (method === 'session/request_permission') {
      // Snapshot the filesystem at the instant permission is asked.
      note('permission_request', { fileExistsNow: targetExists() });
      permissionPayloads.push(message.params);

      const params = message.params as {
        options?: Array<{ optionId: string; kind?: string; name?: string }>;
      };
      const options = params.options ?? [];
      const wanted = DENY_ALL
        ? options.find(option => option.kind?.startsWith('reject'))
        : options.find(option => option.kind?.startsWith('allow'));

      // Deliberate delay: if a side effect appears during it, the tool ran
      // before the answer.
      setTimeout(() => {
        note('permission_answer', { denied: DENY_ALL, fileExistsNow: targetExists() });
        reply(message.id, { outcome: { outcome: 'selected', optionId: wanted?.optionId ?? 'reject' } });
      }, 1500);
      continue;
    }

    if (method === 'session/update') {
      const params = message.params as { update?: { sessionUpdate?: string } } | undefined;
      const kind = params?.update?.sessionUpdate ?? 'unknown';
      sessionUpdates.push({
        kind,
        ...(sessionUpdates.filter(u => u.kind === kind).length === 0 ? { sample: params?.update } : {}),
      });
      if (kind === 'tool_call' || kind === 'tool_call_update') {
        note(`update:${kind}`, { fileExistsNow: targetExists() });
      }
      continue;
    }

    if (method !== undefined && message.id !== undefined) {
      // Unknown agent request: refuse rather than guess.
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unsupported' } })}\n`,
      );
      continue;
    }

    const id = message.id;
    if (typeof id === 'number' && pending.has(id)) {
      pending.get(id)?.(message);
      pending.delete(id);
    }
  }
});

let nextId = 0;
function send(method: string, params: unknown, timeoutMs = 300_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => reject(new Error(`timeout ${method}`)), timeoutMs);
  });
}

const out: Record<string, unknown> = { denyAll: DENY_ALL, targetRel: TARGET_REL };
try {
  await send('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: 'IntentSmith', version: '0.1.0' },
  });
  const session = await send('session/new', { cwd: CWD, mcpServers: [] });
  const sessionId = (session.result as { sessionId: string }).sessionId;

  note('prompt_start', { fileExistsNow: targetExists() });
  const prompt = await send(
    'session/prompt',
    {
      sessionId,
      prompt: [
        {
          type: 'text',
          text: process.env.SPIKE_TASK ?? `Create a file at ${TARGET_REL} containing exactly the word DONE. Use the write tool. Do not run any shell command.`,
        },
      ],
    },
    280_000,
  );
  out.stopReason = (prompt.result as { stopReason?: string } | undefined)?.stopReason;
  note('prompt_end', { fileExistsNow: targetExists() });
} catch (error) {
  out.error = String((error as Error).message);
  note('error', String((error as Error).message).slice(0, 200));
}

out.fileCreated = targetExists();
out.fileContent = targetExists() ? readFileSync(targetAbs, 'utf8').slice(0, 100) : null;
out.permissionRequestCount = permissionPayloads.length;
out.permissionPayloads = permissionPayloads.slice(0, 4);
out.sessionUpdateKinds = [...new Set(sessionUpdates.map(u => u.kind))];
out.sessionUpdateSamples = sessionUpdates.filter(u => u.sample).slice(0, 6);
out.gatewayRequests = gatewayRequests;
out.gatewayResponses = gatewayResponses;
out.rawToolCallSamples = rawToolCallSamples;
out.advertisedToolSchemas = advertisedToolSchemas;
out.timeline = timeline;
out.stderrTail = stderrChunks.join('').slice(-1500);
out.tokenLeaked = JSON.stringify({ permissionPayloads, sessionUpdates, timeline }).includes(token);

try {
  process.kill(-(child.pid ?? 0), 'SIGKILL');
} catch {
  // Already gone.
}
await app.close();
writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
process.exit(0);
