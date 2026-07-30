// tests/e2e/_helpers.js — Shared E2E test infrastructure
// ══════════════════════════════════════════════════════════════════════════════

export {
  suite,
  test,
  testAsync,
  skip,
  assert,
  assertEqual,
  assertIncludes,
  assertMatch,
  assertThrows,
  summary,
} from '../harness.js';

import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

const PRIVATE_COMPONENT = '.intentsmith-artifacts';
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const MAX_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = parseBoundedInteger(
  process.env.INTENTSMITH_TEST_REQUEST_TIMEOUT_MS,
  MAX_REQUEST_TIMEOUT_MS,
  100,
  MAX_REQUEST_TIMEOUT_MS,
  'INTENTSMITH_TEST_REQUEST_TIMEOUT_MS',
);

const nodeFetch = globalThis.fetch;
const NodeWebSocket = globalThis.WebSocket;

if (typeof nodeFetch !== 'function' || typeof NodeWebSocket !== 'function') {
  throw new Error('E2E helpers require the built-in fetch and WebSocket APIs from Node.js 22');
}

function parseBoundedInteger(raw, fallback, min, max, label) {
  if (raw === undefined || raw === '') return fallback;
  if (!/^[0-9]+$/.test(String(raw))) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === '::1' || /^127(?:\.[0-9]{1,3}){3}$/.test(normalized);
}

function validateLoopbackBaseUrl(raw, source) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new Error(`${source} must be an absolute loopback HTTP URL`);
  }

  if (
    url.protocol !== 'http:'
    || !isLoopbackHostname(url.hostname)
    || !url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error(
      `${source} must be an explicit http://127.x.x.x:<port> or http://[::1]:<port> origin`,
    );
  }

  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${source} contains an invalid TCP port`);
  }
  return url.origin;
}

function pathHasPrivateComponent(candidate) {
  return path.resolve(candidate).split(path.sep).includes(PRIVATE_COMPONENT);
}

function isStrictChild(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function assertOwnedByCurrentUser(stat, label) {
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`${label} is not owned by the current user`);
  }
}

function resolvePrivateDirectory(envName) {
  const configured = process.env[envName];
  if (!configured) {
    throw new Error(`${envName} is required for runner-owned E2E filesystem effects`);
  }

  const absolute = path.resolve(configured);
  if (!pathHasPrivateComponent(absolute)) {
    throw new Error(`${envName} must be inside a ${PRIVATE_COMPONENT} directory`);
  }

  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${envName} must name an existing non-symlink directory`);
  }
  assertOwnedByCurrentUser(stat, envName);
  if ((stat.mode & 0o777) !== 0o700) {
    throw new Error(`${envName} must have mode 0700`);
  }

  const real = realpathSync(absolute);
  if (!pathHasPrivateComponent(real)) {
    throw new Error(`${envName} resolves outside a ${PRIVATE_COMPONENT} directory`);
  }
  return real;
}

function ensurePrivateChildDirectory(root, childName) {
  if (!SAFE_ID_RE.test(childName)) {
    throw new Error(`Unsafe private child directory name: ${childName}`);
  }
  const candidate = path.join(root, childName);
  if (!isStrictChild(root, candidate)) {
    throw new Error(`Private child directory escaped its owned root: ${candidate}`);
  }

  if (existsSync(candidate)) {
    const stat = lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Private child path is not a non-symlink directory: ${candidate}`);
    }
    assertOwnedByCurrentUser(stat, candidate);
  } else {
    mkdirSync(candidate, { mode: 0o700 });
  }
  chmodSync(candidate, 0o700);

  const real = realpathSync(candidate);
  if (!isStrictChild(root, real)) {
    throw new Error(`Private child directory resolves outside its owned root: ${candidate}`);
  }
  return real;
}

function readRunnerPortFile(filePath) {
  const absolute = path.resolve(filePath);
  if (!pathHasPrivateComponent(absolute)) {
    throw new Error(`C3_PORT_FILE must be inside a ${PRIVATE_COMPONENT} directory`);
  }

  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('C3_PORT_FILE must name an existing non-symlink regular file');
  }
  assertOwnedByCurrentUser(stat, 'C3_PORT_FILE');
  if ((stat.mode & 0o077) !== 0) {
    throw new Error('C3_PORT_FILE must not be accessible by group or other users');
  }

  const real = realpathSync(absolute);
  if (!pathHasPrivateComponent(real)) {
    throw new Error(`C3_PORT_FILE resolves outside a ${PRIVATE_COMPONENT} directory`);
  }

  let value;
  try {
    value = JSON.parse(readFileSync(real, 'utf8'));
  } catch (error) {
    throw new Error(`C3_PORT_FILE is not valid JSON: ${error.message}`);
  }
  if (!value || typeof value !== 'object' || !isLoopbackHostname(value.host)) {
    throw new Error('C3_PORT_FILE must identify a loopback host');
  }
  const port = parseBoundedInteger(value.port, null, 1, 65535, 'C3_PORT_FILE port');
  if (!Number.isSafeInteger(Number(value.pid)) || Number(value.pid) < 1) {
    throw new Error('C3_PORT_FILE must identify the runner-owned server PID');
  }

  const host = String(value.host).replace(/^\[|\]$/g, '');
  const authority = host === '::1' ? `[${host}]` : host;
  return validateLoopbackBaseUrl(`http://${authority}:${port}`, 'C3_PORT_FILE');
}

function resolveBaseUrl() {
  if (process.env.C3_URL) {
    return validateLoopbackBaseUrl(process.env.C3_URL, 'C3_URL');
  }

  if (process.env.C3_PORT && process.env.C3_PORT !== '0') {
    const port = parseBoundedInteger(process.env.C3_PORT, null, 1, 65535, 'C3_PORT');
    return `http://127.0.0.1:${port}`;
  }

  if (process.env.C3_PORT_FILE) {
    return readRunnerPortFile(process.env.C3_PORT_FILE);
  }

  throw new Error(
    'A runner-owned loopback endpoint is required via C3_URL, C3_PORT, or C3_PORT_FILE',
  );
}

export const BASE_URL = resolveBaseUrl();
export const WS_URL = `${BASE_URL.replace(/^http:/, 'ws:')}/c3/ws`;

function resolveApiUrl(apiPath) {
  if (
    typeof apiPath !== 'string'
    || !apiPath.startsWith('/')
    || apiPath.startsWith('//')
    || apiPath.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(apiPath)
  ) {
    throw new Error('E2E API paths must be same-origin absolute paths beginning with one slash');
  }

  const url = new URL(apiPath, `${BASE_URL}/`);
  if (url.origin !== BASE_URL) {
    throw new Error(`E2E API path escaped the runner-owned origin: ${apiPath}`);
  }
  return url;
}

async function fetchBuffered(method, apiPath, body, externalSignal, timeoutMs) {
  const url = resolveApiUrl(apiPath);
  const controller = new AbortController();
  const boundedTimeout = parseBoundedInteger(
    timeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    1,
    MAX_REQUEST_TIMEOUT_MS,
    'request timeout',
  );
  const abortFromCaller = () => {
    controller.abort(externalSignal.reason || new Error('E2E request aborted by caller'));
  };

  if (externalSignal) {
    if (
      typeof externalSignal.addEventListener !== 'function'
      || typeof externalSignal.aborted !== 'boolean'
    ) {
      throw new TypeError('signal must be an AbortSignal');
    }
    if (externalSignal.aborted) abortFromCaller();
    else externalSignal.addEventListener('abort', abortFromCaller, { once: true });
  }

  const timer = setTimeout(() => {
    const error = new Error(`E2E request timed out after ${boundedTimeout}ms`);
    error.name = 'TimeoutError';
    controller.abort(error);
  }, boundedTimeout);

  try {
    const options = {
      method,
      headers: {},
      signal: controller.signal,
    };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await nodeFetch(url, options);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
      bytes,
    };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', abortFromCaller);
  }
}

// ── HTTP Client ──────────────────────────────────────────────────────────────

/** Fetch + parse JSON. Throws on network error but NOT on non-2xx status. */
export async function api(method, apiPath, body, signal) {
  const result = await fetchBuffered(method, apiPath, body, signal);
  const text = new TextDecoder().decode(result.bytes);
  try {
    return {
      status: result.status,
      headers: result.headers,
      data: JSON.parse(text),
    };
  } catch {
    return {
      status: result.status,
      headers: result.headers,
      data: text,
    };
  }
}

/** Fetch returning a buffered Response (for status/header/body checks). */
export async function apiRaw(method, apiPath, body, signal) {
  const result = await fetchBuffered(method, apiPath, body, signal);
  const bodyAllowed = ![101, 204, 205, 304].includes(result.status);
  return new Response(bodyAllowed ? result.bytes : null, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
}

// ── Transcript Logging ───────────────────────────────────────────────────────

let _turnCounter = 0;

function resolveSuiteId() {
  const configured = process.env.INTENTSMITH_TEST_SUITE_ID;
  if (configured) {
    if (!SAFE_ID_RE.test(configured)) {
      throw new Error('INTENTSMITH_TEST_SUITE_ID contains unsafe path characters');
    }
    return configured;
  }

  const entrypoint = path.basename(process.argv[1] || 'e2e');
  const inferred = entrypoint.replace(/\.[^.]+$/, '');
  if (!SAFE_ID_RE.test(inferred)) {
    throw new Error(`Cannot derive a safe E2E suite id from ${entrypoint}`);
  }
  return inferred;
}

function resolveTranscriptPath() {
  if (!process.env.INTENTSMITH_TEST_ARTIFACT_DIR) return null;
  const artifactRoot = resolvePrivateDirectory('INTENTSMITH_TEST_ARTIFACT_DIR');
  const transcriptDir = ensurePrivateChildDirectory(artifactRoot, 'transcripts');
  const transcriptPath = path.join(transcriptDir, `${resolveSuiteId()}.md`);
  if (!isStrictChild(transcriptDir, transcriptPath)) {
    throw new Error('Transcript path escaped its runner-owned directory');
  }
  return transcriptPath;
}

function appendTranscript(text) {
  const transcriptPath = resolveTranscriptPath();
  if (!transcriptPath) return;

  const flags = (
    fsConstants.O_APPEND
    | fsConstants.O_CREAT
    | fsConstants.O_WRONLY
    | (fsConstants.O_CLOEXEC || 0)
    | (fsConstants.O_NOFOLLOW || 0)
  );
  const descriptor = openSync(transcriptPath, flags, 0o600);
  try {
    fchmodSync(descriptor, 0o600);
    writeSync(descriptor, text);
  } finally {
    closeSync(descriptor);
  }
}

/** Append a section header to this suite's private runner-owned transcript. */
export function transcriptSection(title) {
  if (!process.env.INTENTSMITH_TEST_ARTIFACT_DIR) return;
  appendTranscript(`\n## ${String(title)}\n\n`);
  _turnCounter = 0;
}

/** Internal: append one Q&A turn to this suite's private transcript. */
function transcriptTurn(prompt, response) {
  if (!process.env.INTENTSMITH_TEST_ARTIFACT_DIR) return;
  _turnCounter++;
  appendTranscript([
    `### Turn ${_turnCounter}`,
    '',
    '**Otázka:**',
    String(prompt).trim(),
    '',
    '**Odpověď:**',
    String(response).trim(),
    '',
    '---',
    '',
  ].join('\n'));
}

// ── Runner-owned filesystem helpers ─────────────────────────────────────────

const ownedTempDirectories = new Set();

/**
 * Create a private temporary directory under
 * INTENTSMITH_TEST_ARTIFACT_DIR/tmp. Only this process may later remove it.
 */
export function makeOwnedTempDir(prefix = 'e2e') {
  if (!SAFE_ID_RE.test(prefix)) {
    throw new Error('Temporary directory prefix contains unsafe path characters');
  }
  const artifactRoot = resolvePrivateDirectory('INTENTSMITH_TEST_ARTIFACT_DIR');
  const tempRoot = ensurePrivateChildDirectory(artifactRoot, 'tmp');
  const created = mkdtempSync(path.join(tempRoot, `${prefix}-`));
  chmodSync(created, 0o700);

  const real = realpathSync(created);
  if (!isStrictChild(tempRoot, real)) {
    throw new Error('Created temporary directory escaped its runner-owned root');
  }
  ownedTempDirectories.add(real);
  return real;
}

/**
 * Remove a temporary directory created by makeOwnedTempDir in this process.
 * Arbitrary paths, the temp root itself, and symlinks are rejected.
 */
export function removeOwnedTempDir(candidate) {
  const absolute = path.resolve(String(candidate));
  if (!ownedTempDirectories.has(absolute)) {
    throw new Error(`Refusing to remove a directory not owned by this helper: ${absolute}`);
  }

  const artifactRoot = resolvePrivateDirectory('INTENTSMITH_TEST_ARTIFACT_DIR');
  const tempRoot = ensurePrivateChildDirectory(artifactRoot, 'tmp');
  if (!isStrictChild(tempRoot, absolute)) {
    throw new Error(`Refusing to remove a path outside the runner-owned temp root: ${absolute}`);
  }

  if (!existsSync(absolute)) {
    ownedTempDirectories.delete(absolute);
    return false;
  }

  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Refusing to recursively remove a non-directory or symlink: ${absolute}`);
  }
  assertOwnedByCurrentUser(stat, absolute);
  const real = realpathSync(absolute);
  if (real !== absolute || !isStrictChild(tempRoot, real)) {
    throw new Error(`Refusing to remove a directory that resolves outside its owned root: ${absolute}`);
  }

  rmSync(absolute, { recursive: true, force: false, maxRetries: 2 });
  ownedTempDirectories.delete(absolute);
  return true;
}

// ── WebSocket Client ─────────────────────────────────────────────────────────

// The restored suites used the EventEmitter-style `.on()` method from `ws`.
// Keep that API while using Node 22's built-in EventTarget WebSocket.
if (typeof NodeWebSocket.prototype.on !== 'function') {
  Object.defineProperty(NodeWebSocket.prototype, 'on', {
    configurable: true,
    value(type, listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('WebSocket listener must be a function');
      }
      const adapted = type === 'message'
        ? event => listener(event.data)
        : type === 'error'
          ? event => listener(event.error || event)
          : event => listener(event);
      this.addEventListener(type, adapted);
      return this;
    },
  });
}

function websocketError(event, fallback) {
  if (event?.error instanceof Error) return event.error;
  return new Error(event?.message || fallback);
}

/** Creates a WS connection, performs hello handshake, resolves with client object. */
export function createWsClient(timeoutMs = 5000) {
  const handshakeTimeout = parseBoundedInteger(
    timeoutMs,
    5000,
    1,
    60_000,
    'WebSocket handshake timeout',
  );

  return new Promise((resolve, reject) => {
    const ws = new NodeWebSocket(WS_URL);
    const messages = [];
    const waiters = new Set();
    let handshakeComplete = false;
    let settled = false;

    const rejectWaiters = error => {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
      waiters.clear();
    };

    const closeSocket = () => {
      try {
        if (
          ws.readyState === NodeWebSocket.CONNECTING
          || ws.readyState === NodeWebSocket.OPEN
        ) {
          ws.close();
        }
      } catch {}
    };

    const handshakeTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      closeSocket();
      reject(new Error(`WS handshake timeout after ${handshakeTimeout}ms`));
    }, handshakeTimeout);

    const finishHandshake = () => {
      if (settled) return;
      settled = true;
      handshakeComplete = true;
      clearTimeout(handshakeTimer);
      resolve({
        ws,
        messages,
        send(data) {
          if (ws.readyState !== NodeWebSocket.OPEN) {
            throw new Error('WebSocket is not open');
          }
          ws.send(JSON.stringify(data));
        },
        waitForMessage(predicate, timeout = 10_000) {
          if (typeof predicate !== 'function') {
            return Promise.reject(new TypeError('WebSocket predicate must be a function'));
          }
          const messageTimeout = parseBoundedInteger(
            timeout,
            10_000,
            1,
            MAX_REQUEST_TIMEOUT_MS,
            'WebSocket message timeout',
          );

          try {
            const existing = messages.find(predicate);
            if (existing !== undefined) return Promise.resolve(existing);
          } catch (error) {
            return Promise.reject(error);
          }

          return new Promise((resolveMessage, rejectMessage) => {
            const waiter = {
              predicate,
              resolve: resolveMessage,
              reject: rejectMessage,
              timer: null,
            };
            waiter.timer = setTimeout(() => {
              waiters.delete(waiter);
              rejectMessage(new Error(`WS message timeout after ${messageTimeout}ms`));
            }, messageTimeout);
            waiters.add(waiter);
          });
        },
        close() {
          rejectWaiters(new Error('WebSocket client closed'));
          closeSocket();
        },
      });
    };

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        type: 'hello',
        protocolVersion: 1,
        features: ['chat', 'agent', 'status', 'control'],
      }));
    }, { once: true });

    ws.addEventListener('message', event => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (!handshakeComplete) {
        if (message.type === 'hello_ack') {
          finishHandshake();
        } else if (message.type === 'hello_reject') {
          if (settled) return;
          settled = true;
          clearTimeout(handshakeTimer);
          closeSocket();
          reject(new Error(`WS hello rejected: ${message.reason || 'unknown'}`));
        }
        return;
      }

      messages.push(message);
      for (const waiter of [...waiters]) {
        let matches;
        try {
          matches = waiter.predicate(message);
        } catch (error) {
          clearTimeout(waiter.timer);
          waiters.delete(waiter);
          waiter.reject(error);
          continue;
        }
        if (matches) {
          clearTimeout(waiter.timer);
          waiters.delete(waiter);
          waiter.resolve(message);
        }
      }
    });

    ws.addEventListener('error', event => {
      const error = websocketError(event, 'WebSocket error');
      if (!settled) {
        settled = true;
        clearTimeout(handshakeTimer);
        reject(error);
      }
      rejectWaiters(error);
    });

    ws.addEventListener('close', () => {
      const error = new Error('WebSocket closed');
      if (!settled) {
        settled = true;
        clearTimeout(handshakeTimer);
        reject(error);
      }
      rejectWaiters(error);
    }, { once: true });
  });
}

// ── Utilities ────────────────────────────────────────────────────────────────

/** Brief cooldown to avoid rate limiting in sequential runs. */
export function cooldown(ms = 1000) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let sequence = 0;
export function uniqueId(prefix = 'e2e') {
  return `${prefix}-${Date.now()}-${(++sequence).toString(36)}`;
}

/** Wait until the runner-owned server health endpoint responds. */
export async function waitForServer(timeoutMs = 30_000) {
  const timeout = parseBoundedInteger(
    timeoutMs,
    30_000,
    1,
    MAX_REQUEST_TIMEOUT_MS,
    'server wait timeout',
  );
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      const response = await fetchBuffered(
        'GET',
        '/api/health',
        undefined,
        undefined,
        Math.max(1, Math.min(1000, remaining)),
      );
      if (response.status >= 200 && response.status < 400) return true;
    } catch {}
    const delay = Math.min(300, Math.max(0, deadline - Date.now()));
    if (delay > 0) await cooldown(delay);
  }
  throw new Error(`Server not reachable at ${BASE_URL} after ${timeout}ms`);
}

// ── Tier 3: Semantic Helpers ─────────────────────────────────────────────────

export const LLM_TIMEOUT = 60_000;

/** GPU cooldown between LLM calls (seconds). Set via E2E_GPU_COOLDOWN env. */
const GPU_COOLDOWN_MS = parseBoundedInteger(
  process.env.E2E_GPU_COOLDOWN,
  3,
  0,
  60,
  'E2E_GPU_COOLDOWN',
) * 1000;

function extractConversationId(operation, status, data) {
  const conversationId = data?.id ?? data?.conversation?.id;
  if (typeof conversationId !== 'string' || conversationId.trim() === '') {
    throw new Error(`${operation} failed: ${status} response did not contain a conversation id`);
  }
  return conversationId;
}

function extractChatResponse(operation, status, data) {
  if (status !== 200) {
    throw new Error(`${operation} failed: ${status}`);
  }
  const response = data?.response;
  if (typeof response !== 'string' || response.trim() === '') {
    throw new Error(
      `${operation} failed: ${status} response did not contain a non-empty response`,
    );
  }
  return response;
}

/** Create a conversation and return its id. */
export async function createConv(title) {
  const { status, data } = await api('POST', '/api/conversations', {
    title: title || uniqueId('t3'),
    mode: 'chat',
  });
  if (status !== 200 && status !== 201) {
    throw new Error(`createConv failed: ${status}`);
  }
  return extractConversationId('createConv', status, data);
}

/**
 * Send message via /api/chat (session-based).
 * Returns { status, response, mode, confidence, metadata, intent, data }.
 */
export async function chatInConv(convId, message, opts = {}) {
  const { status, data } = await api('POST', '/api/chat', {
    conversation_id: convId,
    message,
    ...opts,
  });
  if (GPU_COOLDOWN_MS > 0) await cooldown(GPU_COOLDOWN_MS);
  const response = extractChatResponse('chatInConv', status, data);
  return {
    status,
    response,
    mode: data.mode,
    confidence: data.confidence,
    metadata: data.metadata,
    intent: data.metadata?.decision?.intent || data.metadata?.intent || null,
    data,
  };
}

/** Chat with a bounded AbortController timeout. Same return shape as chatInConv. */
export async function chatWithTimeout(convId, message, timeoutMs = 300_000) {
  const timeout = parseBoundedInteger(
    timeoutMs,
    300_000,
    1,
    MAX_REQUEST_TIMEOUT_MS,
    'chat timeout',
  );
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const error = new Error(`Chat request timed out after ${timeout}ms`);
    error.name = 'TimeoutError';
    controller.abort(error);
  }, timeout);
  try {
    const { status, data } = await api('POST', '/api/chat', {
      conversation_id: convId,
      message,
    }, controller.signal);
    if (GPU_COOLDOWN_MS > 0) await cooldown(GPU_COOLDOWN_MS);
    const response = extractChatResponse('chatWithTimeout', status, data);
    transcriptTurn(message, response);
    return {
      status,
      response,
      mode: data.mode,
      confidence: data.confidence,
      metadata: data.metadata,
      intent: data.metadata?.decision?.intent || data.metadata?.intent || null,
      data,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Create a project through the runner-owned server and verify its returned path. */
export async function createProject(name, description) {
  if (!SAFE_ID_RE.test(name)) {
    throw new Error('Project fixture name contains unsafe path characters');
  }
  const projectsRoot = resolvePrivateDirectory('INTENTSMITH_TEST_PROJECTS_DIR');
  const uniqueName = uniqueId(name);
  const { status, data } = await api('POST', '/api/projects', {
    name: uniqueName,
    description,
  });
  if (status !== 200 && status !== 201) {
    throw new Error(`createProject failed: ${status}`);
  }

  const project = data.project || data;
  if (!project?.path || !project?.id) {
    throw new Error('createProject response did not include a project id and path');
  }
  const projectPath = realpathSync(path.resolve(project.path));
  if (!isStrictChild(projectsRoot, projectPath)) {
    throw new Error(`Server returned a project outside the runner-owned root: ${projectPath}`);
  }
  return { id: project.id, path: projectPath };
}

/** Create a conversation bound to a project. */
export async function createProjectConv(projectId, title) {
  const { status, data } = await api('POST', '/api/conversations', {
    title: title || uniqueId('proj'),
    project_id: projectId,
    mode: 'chat',
  });
  if (status !== 200 && status !== 201) {
    throw new Error(`createProjectConv failed: ${status}`);
  }
  return extractConversationId('createProjectConv', status, data);
}

/** Fuzzy keyword check: at least minCount of keywords present (case-insensitive). */
export function hasKeywords(text, keywords, minCount = 1) {
  const lower = (text || '').toLowerCase();
  let count = 0;
  for (const keyword of keywords) {
    if (lower.includes(keyword.toLowerCase())) count++;
  }
  return count >= minCount;
}

/** Count Slovak contamination markers. */
export function countSlovakMarkers(text) {
  const markers = [
    /ľ/i, /ô/,
    /\bpäť\b/i, /\bpamäť/i, /\bsvät/i,
    /(?:^|\s)sú(?:\s|[.,!?]|$)/i,
    /(?:^|\s)ktorý/i, /(?:^|\s)pretože/i,
    /zaujímav/i, /(?:^|\s)ešte(?:\s|[.,!?]|$)/i,
    /výskum/i, /niekoľko/i, /spoloč/i, /infraštrukt/i,
    /povedať/i, /osobné/i, /(?:^|\s)prípad/i, /histór/i,
    /zdravotn[ií]c/i, /odvetv/i,
    /(?:^|\s)všetk[oiy]/i, /(?:^|\s)doska\b/i,
    /(?:^|\s)sa\s/i, /(?:^|\s)pri\s/i,
    /nejaký/i, /hranie/i, /ponúka/i, /(?:^|\s)podľa/i,
  ];
  let count = 0;
  for (const marker of markers) {
    if (marker.test(text)) count++;
  }
  return count;
}

/** Check if text contains Czech diacritics. */
export function hasCzechChars(text) {
  return /[ěščřžýáíéůúďťň]/i.test(text || '');
}

// ── Cleanup Helpers ──────────────────────────────────────────────────────────

export async function cleanupConversation(id) {
  try { await apiRaw('DELETE', `/api/conversations/${id}`); } catch {}
  try { await apiRaw('DELETE', `/api/conversations/${id}?hard=true`); } catch {}
}

export async function cleanupProject(id) {
  try { await apiRaw('DELETE', `/api/projects/${id}`); } catch {}
}

export async function cleanupAgent(id) {
  try { await apiRaw('DELETE', `/api/agents/${id}`); } catch {}
}
