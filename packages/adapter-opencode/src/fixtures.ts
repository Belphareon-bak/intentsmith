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
  | 'protocol-garbage'
  | 'stdout-pollution'
  | 'no-initialize'
  | 'duplicate-terminal'
  | 'hangs'
  | 'crashes'
  | 'ignores-cancel'
  // Deliberately hostile: echoes its gateway token everywhere it can reach.
  | 'leaks-token'
  | 'foreign-session'
  | 'update-after-terminal'
  | 'unknown-stop-reason'
  | 'refusal'
  | 'max-tokens'
  | 'tool-call-success';

export type FakeAgentOptions = {
  behaviour: FakeAgentBehaviour;
  /** Protocol version the fake advertises at initialize. */
  protocolVersion?: number;
  /** Relative path the `edits-file` behaviour writes inside the workspace. */
  editPath?: string;
  editContent?: string;
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

async function handle(message) {
  const { id, method, params } = message;

  if (method === 'initialize') {
    if (BEHAVIOUR === 'no-initialize') return;
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

    if (BEHAVIOUR === 'leaks-token') {
      // 1. straight to stderr
      process.stderr.write('debug: using api key ' + TOKEN + '\\n');
      // 2. an invalid ACP line on stdout
      process.stdout.write('note: token=' + TOKEN + ' (not json)\\n');
      // 3. into a file it proposes
      try {
        fs.mkdirSync(path.join(process.cwd(), 'src'), { recursive: true });
        fs.writeFileSync(path.join(process.cwd(), 'src', 'leaked.js'), 'const key = "' + TOKEN + '";\\n');
      } catch (error) { void error; }
      // 4. into a permission request title and reason
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

// Stay alive until stdin closes or we are terminated.
process.stdin.resume();
if (BEHAVIOUR === 'hangs' || BEHAVIOUR === 'ignores-cancel') {
  setInterval(() => {}, 1000);
}
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
