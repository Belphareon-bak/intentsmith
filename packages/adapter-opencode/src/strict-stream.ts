/**
 * Strict, bounded ACP transport stream.
 *
 * This replaces the SDK's `ndJsonStream`. That helper logs a parse failure with
 * `console.error` and drops the line, with no hook for the caller (verified in
 * `@agentclientprotocol/sdk@1.3.0`, `dist/stream.js`). Two consequences are
 * unacceptable here:
 *
 * - a worker that writes non-ACP output to stdout is not purely speaking the
 *   protocol, and IntentSmith must end that run rather than continue against a
 *   stream it cannot account for;
 * - the raw offending line reaches the real `console.error`, where it can carry
 *   a per-run gateway token straight into process output.
 *
 * The fix is a replacement rather than a wrapper around the SDK's logging. A
 * global `console.error` monkeypatch was rejected outright: it is process-wide
 * state, so two concurrent workers would share it and one worker's redaction
 * would silently apply to another's output.
 *
 * `ndJsonStream` returns `{ readable, writable }` of already-parsed message
 * objects, so producing that pair directly bypasses its parsing entirely. The
 * SDK never sees a malformed line because one never reaches it.
 */

export type StreamLimits = {
  /** Maximum bytes for a single line, including the newline. */
  maxLineBytes: number;
  /** Maximum bytes for the whole session's stdout. */
  maxTotalBytes: number;
};

export const DEFAULT_STREAM_LIMITS: StreamLimits = {
  maxLineBytes: 4 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
};

export type StreamViolation = {
  kind: 'malformed_json' | 'oversized_line' | 'non_object_message' | 'stream_too_large';
  /** Human-readable, already bounded. Never contains the offending payload. */
  message: string;
};

export type StrictStreamOptions = {
  /** Raw stdout chunks from the supervised process. */
  subscribe: (listener: (chunk: Buffer) => void) => () => void;
  /** Writes a serialized message to the process stdin. */
  write: (line: string) => void;
  limits?: Partial<StreamLimits>;
  /**
   * Called once, on the first violation. The run must end deterministically as
   * a protocol error; the stream also errors so the SDK stops immediately.
   */
  onViolation: (violation: StreamViolation) => void;
  /**
   * Observes every valid inbound message.
   *
   * The SDK performs `initialize` internally and does not expose the response,
   * so the transport is the honest place to capture what the agent actually
   * negotiated. Observation only: the message is passed through unchanged.
   */
  onInbound?: (message: unknown) => void;
};

export type StrictStream = {
  readable: ReadableStream<unknown>;
  writable: WritableStream<unknown>;
  /** Detaches from the process. Safe to call more than once. */
  close(): void;
};

function isRecord(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}

/**
 * Builds an ACP stream pair with per-instance state only.
 *
 * Everything here is scoped to one call, so two concurrent workers share no
 * buffers, no counters and no handlers.
 */
export function createStrictAcpStream(options: StrictStreamOptions): StrictStream {
  const limits = { ...DEFAULT_STREAM_LIMITS, ...options.limits };
  const decoder = new TextDecoder('utf-8');

  let buffer = '';
  let totalBytes = 0;
  let detach: (() => void) | undefined;
  let violated = false;
  let closed = false;

  let controllerRef: ReadableStreamDefaultController<unknown> | undefined;

  const fail = (violation: StreamViolation): void => {
    if (violated) return;
    violated = true;
    options.onViolation(violation);
    // Erroring the stream stops the SDK reading immediately, so no further
    // agent output is interpreted after the protocol was broken.
    try {
      controllerRef?.error(new Error(violation.message));
    } catch {
      // Already errored or closed.
    }
    detach?.();
    detach = undefined;
  };

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    if (trimmed.length > limits.maxLineBytes) {
      fail({ kind: 'oversized_line', message: 'Worker sent an ACP line larger than the allowed size.' });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Deliberately excludes the offending text: it is worker-controlled and
      // may contain the per-run token.
      fail({ kind: 'malformed_json', message: 'Worker wrote a line to stdout that is not valid JSON.' });
      return;
    }

    if (!isRecord(parsed)) {
      fail({
        kind: 'non_object_message',
        message: 'Worker sent a JSON line that is not an object or array.',
      });
      return;
    }

    options.onInbound?.(parsed);
    try {
      controllerRef?.enqueue(parsed);
    } catch {
      // The consumer went away; nothing further to do.
    }
  };

  const readable = new ReadableStream<unknown>({
    start(controller) {
      controllerRef = controller;
      detach = options.subscribe(chunk => {
        if (violated || closed) return;

        totalBytes += chunk.byteLength;
        if (totalBytes > limits.maxTotalBytes) {
          fail({ kind: 'stream_too_large', message: 'Worker stdout exceeded the allowed total size.' });
          return;
        }

        buffer += decoder.decode(chunk, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          handleLine(line);
          if (violated) return;
          newline = buffer.indexOf('\n');
        }

        // An unterminated line must not be able to grow without bound.
        if (buffer.length > limits.maxLineBytes) {
          fail({ kind: 'oversized_line', message: 'Worker sent an ACP line larger than the allowed size.' });
        }
      });
    },
    cancel() {
      detach?.();
      detach = undefined;
    },
  });

  const writable = new WritableStream<unknown>({
    write(message) {
      if (violated || closed) return;
      options.write(`${JSON.stringify(message)}\n`);
    },
  });

  return {
    readable,
    writable,
    close: () => {
      if (closed) return;
      closed = true;
      detach?.();
      detach = undefined;
      try {
        controllerRef?.close();
      } catch {
        // Already closed or errored.
      }
    },
  };
}
