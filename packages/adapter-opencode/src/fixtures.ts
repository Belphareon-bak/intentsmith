import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Fake ACP agent, written to disk and spawned as a real process.
 *
 * This is a genuine child process speaking JSON-RPC over stdio, not a mock
 * object. That matters: the things Phase 3 must guarantee — process-group
 * cleanup, environment isolation, and that the worker's only inference path is
 * the gateway — are properties of a real process, and an in-memory double
 * would prove none of them.
 *
 * `pnpm verify` therefore needs no OpenCode installed, while still exercising
 * spawn, stdio framing, cancellation and termination for real.
 */

export type FakeAgentBehaviour =
  | 'success'
  | 'edits-file'
  | 'calls-gateway'
  | 'calls-ollama-directly'
  | 'requests-permission'
  // Offers a standing permission first, to prove IntentSmith never takes it.
  | 'offers-allow-always'
  // Asks permission, then writes only if the answer allows it, and never
  // answers the prompt until it hears back. Used to prove that a cancel or a
  // timeout with a permission outstanding produces no side effect.
  | 'waits-for-permission'
  | 'protocol-garbage'
  | 'stdout-pollution'
  | 'no-initialize'
  | 'duplicate-terminal'
  | 'hangs'
  | 'crashes'
  | 'ignores-cancel'
  // Deliberately hostile: echoes its gateway token everywhere it can reach.
  | 'leaks-token-stderr'
  | 'leaks-token-stdout'
  | 'leaks-token-permission'
  | 'foreign-session'
  | 'update-after-terminal'
  | 'unknown-stop-reason'
  | 'refusal'
  | 'max-tokens'
  | 'tool-call-success'
  | 'malformed-initialize'
  | 'stalls-initialize'
  | 'update-before-session';

export type FakeAgentOptions = {
  behaviour: FakeAgentBehaviour;
  /** Protocol version the fake advertises at initialize. */
  protocolVersion?: number;
  /** Relative path the `edits-file` behaviour writes inside the workspace. */
  editPath?: string;
  editContent?: string;
  /** Disable the workspace activity log when Git evidence itself is under test. */
  recordActivity?: boolean;
};

/**
 * Generates the fake agent script.
 *
 * Written as CommonJS so it runs under `node <file>` with no build step.
 */
export function fakeAgentSource(options: FakeAgentOptions): string {
  const protocolVersion = options.protocolVersion ?? 1;
  const editPath = options.editPath ?? 'src/answer.js';
  const editContent = options.editContent ?? 'module.exports = 4;\n';

  return `
'use strict';
const fs = require('fs');
const path = require('path');

const BEHAVIOUR = ${JSON.stringify(options.behaviour)};
const PROTOCOL_VERSION = ${protocolVersion};
const EDIT_PATH = ${JSON.stringify(editPath)};
const EDIT_CONTENT = ${JSON.stringify(editContent)};
const RECORD_ACTIVITY = ${options.recordActivity !== false};

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}

/**
 * Records what the agent did, into its own workspace.
 *
 * Deliberately not an environment variable: the isolated environment does not
 * forward one, and poking a hole in that isolation just to observe the test
 * would weaken the very thing under test. The workspace is the one place the
 * agent is legitimately allowed to write.
 */
const LOG_FILE = '.intentsmith-agent-activity.json';
function record(entry) {
  if (!RECORD_ACTIVITY) return;
  const target = path.join(process.cwd(), LOG_FILE);
  let log = [];
  try { log = JSON.parse(fs.readFileSync(target, 'utf8')); } catch { log = []; }
  log.push(entry);
  fs.writeFileSync(target, JSON.stringify(log, null, 2));
}

async function callInference(baseUrl, token, modelId) {
  const response = await fetch(baseUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'fixture prompt' }] }),
  });
  const body = await response.text();
  return { status: response.status, body: body.slice(0, 2000) };
}

let cancelled = false;

// Outgoing agent-initiated requests, awaiting the client's response.
const pending = new Map();
let nextRequestId = 9000;

/** Sends a request to the client and resolves when its response arrives. */
function request({ method, params }) {
  const requestId = (nextRequestId += 1);
  return new Promise(resolve => {
    pending.set(requestId, resolve);
    send({ jsonrpc: '2.0', id: requestId, method, params });
  });
}

async function handle(message) {
  const { id, method, params } = message;

  // A response to something this agent asked for.
  if (method === undefined && pending.has(id)) {
    const resolve = pending.get(id);
    pending.delete(id);
    resolve(message.result ?? null);
    return;
  }

  if (method === 'initialize') {
    if (BEHAVIOUR === 'no-initialize' || BEHAVIOUR === 'stalls-initialize') return;
    if (BEHAVIOUR === 'malformed-initialize') {
      // Answers, but with nothing usable: no protocolVersion at all.
      send({ jsonrpc: '2.0', id, result: { agentInfo: { name: 'broken' } } });
      return;
    }
    if (BEHAVIOUR === 'update-before-session') {
      // A session update before any session exists.
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 'not-yet-created', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'early' } } },
      });
    }
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: { image: false, audio: false, embeddedContext: true },
        },
        agentInfo: { name: 'fake-opencode', version: '0.0.0-fixture' },
      },
    });
    return;
  }

  if (method === 'session/new') {
    send({ jsonrpc: '2.0', id, result: { sessionId: 'fixture-session-1' } });
    // Observable milestone so a test can wait on the session existing rather
    // than on a fixed delay, which would make the result machine-dependent.
    record({ kind: 'session-created' });
    return;
  }

  if (method === 'session/cancel') {
    cancelled = true;
    if (BEHAVIOUR !== 'ignores-cancel') {
      send({ jsonrpc: '2.0', id, result: null });
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'fixture-session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'cancelled' } } } });
      send({ jsonrpc: '2.0', method: 'intentsmith/terminal', params: { outcome: 'cancelled' } });
    }
    return;
  }

  if (method === 'session/prompt') {
    if (BEHAVIOUR === 'hangs' || BEHAVIOUR === 'ignores-cancel') return;

    const TOKEN = process.env.INTENTSMITH_GATEWAY_TOKEN || '';

    // Each leak vector is a separate behaviour: stdout pollution now ends the
    // run immediately, so bundling them would mask the later ones.
    if (BEHAVIOUR === 'leaks-token-stderr') {
      process.stderr.write('debug: using api key ' + TOKEN + '\\n');
      // Also write it into a file it proposes, which IntentSmith does not control.
      try {
        fs.mkdirSync(path.join(process.cwd(), 'src'), { recursive: true });
        fs.writeFileSync(path.join(process.cwd(), 'src', 'leaked.js'), 'const key = "' + TOKEN + '";\\n');
      } catch (error) { void error; }
      record({ kind: 'leaked-to-stderr-and-file' });
      send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
      return;
    }

    if (BEHAVIOUR === 'leaks-token-stdout') {
      process.stdout.write('note: token=' + TOKEN + ' (not json)\\n');
      return;
    }

    if (BEHAVIOUR === 'leaks-token-permission') {
      send({
        jsonrpc: '2.0',
        id: 9002,
        method: 'session/request_permission',
        params: {
          sessionId: 'fixture-session-1',
          toolCall: { toolCallId: 'leak-1', title: 'write key ' + TOKEN, kind: 'edit', locations: [{ path: 'src/leaked.js' }] },
          options: [
            { optionId: 'allow', name: 'Allow ' + TOKEN, kind: 'allow_once' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
          ],
        },
      });
      return;
    }

    if (BEHAVIOUR === 'foreign-session') {
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'someone-elses-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'not yours' } } } });
      send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
      return;
    }

    if (BEHAVIOUR === 'update-after-terminal') {
      // Both lines in a single write, so they always arrive in one chunk.
      // Splitting them across writes would test the OS scheduler rather than
      // the adapter's ordering logic, and the trailing line could be lost to
      // process termination before it was ever read.
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } }) +
          '\\n' +
          JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'fixture-session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'late' } } } }) +
          '\\n',
      );
      return;
    }

    if (BEHAVIOUR === 'unknown-stop-reason') {
      send({ jsonrpc: '2.0', id, result: { stopReason: 'i_gave_up' } });
      return;
    }
    if (BEHAVIOUR === 'refusal') {
      send({ jsonrpc: '2.0', id, result: { stopReason: 'refusal' } });
      return;
    }
    if (BEHAVIOUR === 'max-tokens') {
      send({ jsonrpc: '2.0', id, result: { stopReason: 'max_tokens' } });
      return;
    }
    if (BEHAVIOUR === 'tool-call-success') {
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'fixture-session-1',
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-fixture-1',
            title: 'ran fixture tests',
            kind: 'execute',
            status: 'completed',
          },
        },
      });
      send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
      return;
    }

    if (BEHAVIOUR === 'crashes') { process.exit(3); }

    if (BEHAVIOUR === 'protocol-garbage') {
      process.stdout.write('{"jsonrpc":"2.0","id":\\n');
      return;
    }
    if (BEHAVIOUR === 'stdout-pollution') {
      process.stdout.write('warning: something unstructured\\n');
      send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
      return;
    }

    if (BEHAVIOUR === 'edits-file') {
      const target = path.join(process.cwd(), EDIT_PATH);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, EDIT_CONTENT);
      record({ kind: 'edit', path: EDIT_PATH });
    }

    if (BEHAVIOUR === 'calls-gateway') {
      const baseUrl = process.env.INTENTSMITH_GATEWAY_URL;
      const token = process.env.INTENTSMITH_GATEWAY_TOKEN;
      const modelId = process.env.INTENTSMITH_MODEL_ID;
      try {
        const outcome = await callInference(baseUrl, token, modelId);
        record({ kind: 'inference', via: 'gateway', status: outcome.status, sawToken: Boolean(token) });
      } catch (error) {
        record({ kind: 'inference-error', via: 'gateway', message: String(error && error.message) });
      }
    }

    if (BEHAVIOUR === 'calls-ollama-directly') {
      // A worker that tries to bypass the gateway. It must fail: nothing tells
      // it where Ollama is, and the sandbox/config never mention it.
      try {
        const response = await fetch('http://127.0.0.1:11434/api/tags');
        record({ kind: 'inference', via: 'ollama-direct', status: response.status });
      } catch (error) {
        record({ kind: 'inference-error', via: 'ollama-direct', message: String(error && error.message) });
      }
    }

    if (BEHAVIOUR === 'waits-for-permission') {
      const target = path.join(process.cwd(), EDIT_PATH);
      record({ kind: 'permission-requested', path: EDIT_PATH });
      // Deliberately never resolves the prompt on its own: the turn stays open
      // until IntentSmith cancels, times out, or answers.
      const answer = await request({
        method: 'session/request_permission',
        params: {
          sessionId: 'fixture-session-1',
          toolCall: {
            toolCallId: 'tool-1',
            title: 'Edit a file in the workspace',
            kind: 'edit',
            locations: [{ path: EDIT_PATH }],
            rawInput: { filepath: EDIT_PATH, diff: '@@ -0 +1 @@' },
          },
          options: [
            { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
          ],
        },
      });
      const optionId = answer && answer.outcome && answer.outcome.optionId;
      record({ kind: 'permission-answered', optionId: optionId || null });
      if (optionId === 'once') {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, EDIT_CONTENT);
        record({ kind: 'edit', path: EDIT_PATH });
      }
      send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
      return;
    }

    if (BEHAVIOUR === 'offers-allow-always') {
      send({
        jsonrpc: '2.0',
        id: 9001,
        method: 'session/request_permission',
        params: {
          sessionId: 'fixture-session-1',
          toolCall: {
            toolCallId: 'tool-1',
            title: 'Edit a file in the workspace',
            kind: 'edit',
            locations: [{ path: 'src/app.ts' }],
            rawInput: { filepath: 'src/app.ts', diff: '@@ -1 +1 @@' },
          },
          // Ordered so that a naive "first option starting with allow" pick
          // would hand the agent a standing permission.
          options: [
            { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
            { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
          ],
        },
      });
    }

    if (BEHAVIOUR === 'requests-permission') {
      send({
        jsonrpc: '2.0',
        id: 9001,
        method: 'session/request_permission',
        params: {
          sessionId: 'fixture-session-1',
          toolCall: { toolCallId: 'tool-1', title: 'Write outside workspace', kind: 'edit', locations: [{ path: '/etc/passwd' }] },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
          ],
        },
      });
      return;
    }

    if (BEHAVIOUR === 'duplicate-terminal') {
      send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
      send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
      return;
    }

    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'fixture-session-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'work done' } },
      },
    });
    send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
    return;
  }

  // A message with no method is a *response* to something this agent sent.
  // Replying to it would be a JSON-RPC error; only unknown *requests* get an
  // error back.
  if (method !== undefined && id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + String(method) } });
  }
}

let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk.toString('utf8');
  let newline = buffer.indexOf('\\n');
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) {
      let parsed;
      try { parsed = JSON.parse(line); } catch { parsed = null; }
      if (parsed) void handle(parsed);
    }
    newline = buffer.indexOf('\\n');
  }
});

// Stay alive until stdin closes or IntentSmith terminates the process. Merely
// resuming a pipe is not a portable keepalive: Node may leave the event loop
// before the first ACP request arrives on a fast host.
setInterval(() => {}, 1000);
process.stdin.resume();
`;
}

/** Filename the fake agent writes its activity log to, inside its workspace. */
export const FAKE_AGENT_LOG_FILE = '.intentsmith-agent-activity.json';

export type FakeAgent = {
  /** Absolute path to the generated script. */
  scriptPath: string;
  /** Reads what the agent recorded, from the workspace it ran in. */
  readLog(workspaceRoot: string): Array<Record<string, unknown>>;
  cleanup(): void;
};

/** Materializes a fake agent on disk. */
export function createFakeAgent(options: FakeAgentOptions): FakeAgent {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-fake-agent-'));
  const scriptPath = path.join(root, 'agent.cjs');
  writeFileSync(scriptPath, fakeAgentSource(options));

  return {
    scriptPath,
    readLog: workspaceRoot => {
      try {
        return JSON.parse(
          readFileSync(path.join(workspaceRoot, FAKE_AGENT_LOG_FILE), 'utf8'),
        ) as Array<Record<string, unknown>>;
      } catch {
        return [];
      }
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
