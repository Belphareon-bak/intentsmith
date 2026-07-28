/**
 * Minimal ACP client over JSON-RPC 2.0.
 *
 * ACP is JSON-RPC over stdio. IntentSmith implements the client directly rather
 * than adopting `@agentclientprotocol/sdk`; see ADR 0016. Every inbound message
 * is validated here regardless of transport, because the agent is an untrusted
 * external process.
 *
 * The framing is newline-delimited JSON, which is what OpenCode's documented
 * stdio mode uses. Content-Length framing is not implemented; if a probed build
 * turns out to require it, that is a documented change rather than a guess.
 */

export const ACP_PROTOCOL_VERSION = 1;

export type JsonRpcId = number | string;

export type AcpRequest = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type AcpNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
};

export type AcpResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type AcpInbound = AcpRequest | AcpNotification | AcpResponse;

export class AcpProtocolError extends Error {
  readonly code = 'ACP_PROTOCOL_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'AcpProtocolError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates one inbound JSON-RPC message.
 *
 * Anything that is not a well-formed request, notification or response is a
 * protocol error rather than something to interpret optimistically.
 */
export function parseInbound(raw: unknown): AcpInbound {
  if (!isRecord(raw)) throw new AcpProtocolError('Agent sent a message that is not a JSON object.');
  if (raw.jsonrpc !== '2.0') throw new AcpProtocolError('Agent sent a message without jsonrpc "2.0".');

  const hasId = raw.id !== undefined && raw.id !== null;
  const idValid = typeof raw.id === 'number' || typeof raw.id === 'string';

  if (typeof raw.method === 'string') {
    if (hasId) {
      if (!idValid) throw new AcpProtocolError('Agent sent a request with a non-scalar id.');
      return { jsonrpc: '2.0', id: raw.id as JsonRpcId, method: raw.method, params: raw.params };
    }
    return { jsonrpc: '2.0', method: raw.method, params: raw.params };
  }

  if (!hasId || !idValid) {
    throw new AcpProtocolError('Agent sent a response without a usable id.');
  }
  if (raw.error !== undefined) {
    if (!isRecord(raw.error) || typeof raw.error.code !== 'number' || typeof raw.error.message !== 'string') {
      throw new AcpProtocolError('Agent sent a malformed JSON-RPC error object.');
    }
    return {
      jsonrpc: '2.0',
      id: raw.id as JsonRpcId,
      error: { code: raw.error.code, message: raw.error.message, data: raw.error.data },
    };
  }
  return { jsonrpc: '2.0', id: raw.id as JsonRpcId, result: raw.result };
}

export type AcpTransport = {
  send(line: string): void;
  onLine(listener: (line: string) => void): () => void;
};

export type AcpClientOptions = {
  transport: AcpTransport;
  /** Milliseconds before an outstanding request is abandoned. */
  requestTimeoutMs?: number;
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Maximum bytes for a single inbound message. */
  maxMessageBytes?: number;
};

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const handle = setTimeout(fn, ms);
  handle.unref?.();
  return () => clearTimeout(handle);
};

/**
 * JSON-RPC client half of the ACP connection.
 *
 * Tracks outstanding requests, rejects duplicate response ids, and surfaces
 * agent-initiated requests (such as permission prompts) to a handler that Core
 * owns.
 */
export class AcpClient {
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, { resolve: (value: unknown) => void; reject: (error: unknown) => void; cancel: () => void }>();
  private readonly seenResponseIds = new Set<JsonRpcId>();
  private readonly detach: () => void;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private readonly requestTimeoutMs: number;
  private readonly maxMessageBytes: number;
  private closed = false;

  /** Called for agent-initiated requests. Must return a JSON-RPC result. */
  onRequest: (method: string, params: unknown) => Promise<unknown> = async () => {
    throw new AcpProtocolError('No request handler is installed.');
  };

  /** Called for agent notifications such as session/update. */
  onNotification: (method: string, params: unknown) => void = () => undefined;

  /** Called when the agent breaks the protocol. */
  onProtocolError: (error: AcpProtocolError) => void = () => undefined;

  constructor(private readonly options: AcpClientOptions) {
    this.schedule = options.schedule ?? defaultSchedule;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.maxMessageBytes = options.maxMessageBytes ?? 4 * 1024 * 1024;
    this.detach = options.transport.onLine(line => this.handleLine(line));
  }

  private handleLine(line: string): void {
    if (this.closed) return;
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    if (trimmed.length > this.maxMessageBytes) {
      this.onProtocolError(new AcpProtocolError('Agent sent a message larger than the allowed size.'));
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Stdout pollution: a non-JSON line means the agent is not speaking ACP.
      this.onProtocolError(new AcpProtocolError('Agent wrote a non-JSON line to stdout.'));
      return;
    }

    let message: AcpInbound;
    try {
      message = parseInbound(parsed);
    } catch (error) {
      this.onProtocolError(error instanceof AcpProtocolError ? error : new AcpProtocolError('Malformed agent message.'));
      return;
    }

    if ('method' in message && message.method !== undefined) {
      if ('id' in message && message.id !== undefined) {
        void this.dispatchRequest(message as AcpRequest);
        return;
      }
      this.onNotification(message.method, (message as AcpNotification).params);
      return;
    }

    const response = message as AcpResponse;
    if (this.seenResponseIds.has(response.id)) {
      this.onProtocolError(new AcpProtocolError(`Agent sent a duplicate response for id ${String(response.id)}.`));
      return;
    }
    const waiter = this.pending.get(response.id);
    if (!waiter) {
      this.onProtocolError(new AcpProtocolError(`Agent responded to unknown request id ${String(response.id)}.`));
      return;
    }
    this.seenResponseIds.add(response.id);
    this.pending.delete(response.id);
    waiter.cancel();
    if (response.error) {
      waiter.reject(new AcpProtocolError(`Agent returned an error: ${response.error.message}`));
      return;
    }
    waiter.resolve(response.result);
  }

  private async dispatchRequest(request: AcpRequest): Promise<void> {
    try {
      const result = await this.onRequest(request.method, request.params);
      this.write({ jsonrpc: '2.0', id: request.id, result });
    } catch (error) {
      this.write({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32_000, message: error instanceof Error ? error.message : 'Request rejected' },
      });
    }
  }

  private write(message: AcpResponse | AcpRequest | AcpNotification): void {
    if (this.closed) return;
    this.options.transport.send(`${JSON.stringify(message)}\n`);
  }

  /** Sends a request and resolves with its result. */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) throw new AcpProtocolError('ACP connection is closed.');
    const id = this.nextId++;
    return await new Promise<T>((resolve, reject) => {
      const cancel = this.schedule(() => {
        this.pending.delete(id);
        reject(new AcpProtocolError(`Agent did not answer "${method}" within the request timeout.`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, cancel });
      this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  /** Rejects every outstanding request and stops reading. */
  close(reason = 'ACP connection closed.'): void {
    if (this.closed) return;
    this.closed = true;
    this.detach();
    for (const [id, waiter] of this.pending) {
      this.pending.delete(id);
      waiter.cancel();
      waiter.reject(new AcpProtocolError(reason));
    }
  }
}

/** Splits a byte stream into newline-delimited strings, with a size cap. */
export class LineBuffer {
  private buffer = '';

  constructor(private readonly maxLineBytes = 4 * 1024 * 1024) {}

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      lines.push(this.buffer.slice(0, newline));
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > this.maxLineBytes) {
      this.buffer = '';
      throw new AcpProtocolError('Agent sent a line larger than the allowed size.');
    }
    return lines;
  }
}
