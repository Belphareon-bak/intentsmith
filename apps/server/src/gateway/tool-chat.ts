import {
  ProviderError,
  applyModelProfile,
  resolveModelProfile,
  type ChatMessage,
  type ChatResult,
  type ChatToolDefinition,
  type EffectiveInferenceSettings,
} from '@intentsmith/inference';

/**
 * OpenAI <-> IntentSmith translation for tool-calling turns.
 *
 * Pure functions only: nothing here opens a socket, touches a file or runs a
 * command. The gateway translates a protocol and never executes what the
 * protocol describes — a tool call leaves here as data, and the worker is the
 * only component allowed to act on it, after its own permission handling.
 *
 * Two shape differences from the spike are handled explicitly, because both
 * failed silently the first time they were met:
 *
 *  - Ollama reports tool arguments as an object; OpenAI requires a JSON string.
 *  - OpenCode asks for `stream: true`, and a non-streamed body is silently
 *    unusable to its client, which ends the turn with no error at all.
 */

/**
 * Bounds on a tool request.
 *
 * A worker advertises its whole toolset on every turn, so these caps decide how
 * much untrusted schema the gateway is willing to carry. The observed OpenCode
 * build sends ten tools; the limits leave room without leaving the door open.
 */
export const TOOL_LIMITS = {
  maxTools: 32,
  maxToolSchemaBytes: 16 * 1024,
  maxToolSchemaDepth: 12,
  maxMessages: 256,
  maxTotalToolBytes: 128 * 1024,
} as const;

export class ToolRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ToolRequestError';
  }
}

export type OpenAiToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: unknown };
};

export type OpenAiMessage = {
  role: string;
  content?: unknown;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
};

export type OpenAiTool = {
  type?: string;
  function?: { name?: string; description?: string; parameters?: unknown };
};

/** Depth of nested objects/arrays, used to bound schema recursion. */
function schemaDepth(value: unknown, depth = 0): number {
  if (depth > TOOL_LIMITS.maxToolSchemaDepth) return depth;
  if (Array.isArray(value)) {
    return value.reduce<number>((max, entry) => Math.max(max, schemaDepth(entry, depth + 1)), depth);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (max, entry) => Math.max(max, schemaDepth(entry, depth + 1)),
      depth,
    );
  }
  return depth;
}

/**
 * Validates and normalizes advertised tools.
 *
 * A tool whose schema is oversized, too deeply nested or missing a name is
 * refused for the whole request rather than dropped from it: a worker that
 * believes it advertised ten tools and got nine has been misled about what it
 * can do.
 */
export function normalizeTools(tools: OpenAiTool[]): ChatToolDefinition[] {
  if (tools.length > TOOL_LIMITS.maxTools) {
    throw new ToolRequestError(
      'TOOL_REQUEST_TOO_LARGE',
      `A request may advertise at most ${TOOL_LIMITS.maxTools} tools; this one advertises ${tools.length}.`,
    );
  }

  let totalBytes = 0;
  const seen = new Set<string>();

  return tools.map(tool => {
    if (tool.type !== undefined && tool.type !== 'function') {
      throw new ToolRequestError('TOOL_TYPE_UNSUPPORTED', `Tool type "${String(tool.type)}" is not supported.`);
    }
    const name = tool.function?.name;
    if (typeof name !== 'string' || name.length === 0) {
      throw new ToolRequestError('TOOL_REQUEST_INVALID', 'Every advertised tool requires a function name.');
    }
    if (seen.has(name)) {
      // Two tools of the same name make any later audit ambiguous about which
      // one was actually called.
      throw new ToolRequestError('TOOL_REQUEST_INVALID', `Tool "${name}" is advertised more than once.`);
    }
    seen.add(name);

    const parameters = tool.function?.parameters ?? { type: 'object', properties: {} };
    if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
      throw new ToolRequestError('TOOL_REQUEST_INVALID', `Tool "${name}" has a parameter schema that is not an object.`);
    }

    const bytes = Buffer.byteLength(JSON.stringify(parameters), 'utf8');
    if (bytes > TOOL_LIMITS.maxToolSchemaBytes) {
      throw new ToolRequestError(
        'TOOL_REQUEST_TOO_LARGE',
        `Tool "${name}" has a ${bytes}-byte schema, above the limit of ${TOOL_LIMITS.maxToolSchemaBytes}.`,
      );
    }
    totalBytes += bytes;
    if (totalBytes > TOOL_LIMITS.maxTotalToolBytes) {
      throw new ToolRequestError(
        'TOOL_REQUEST_TOO_LARGE',
        `Advertised tool schemas exceed ${TOOL_LIMITS.maxTotalToolBytes} bytes in total.`,
      );
    }
    if (schemaDepth(parameters) > TOOL_LIMITS.maxToolSchemaDepth) {
      throw new ToolRequestError(
        'TOOL_REQUEST_TOO_LARGE',
        `Tool "${name}" has a schema nested deeper than ${TOOL_LIMITS.maxToolSchemaDepth} levels.`,
      );
    }

    return {
      name,
      ...(typeof tool.function?.description === 'string' ? { description: tool.function.description } : {}),
      parameters: parameters as Record<string, unknown>,
    };
  });
}

function textContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  if (Array.isArray(content)) {
    // The OpenAI content-part form; only text parts carry meaning here.
    return (content as Array<{ text?: unknown }>)
      .map(part => (typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  throw new ToolRequestError('TOOL_REQUEST_INVALID', 'Message content must be text.');
}

/** Translates an OpenAI conversation, including tool turns, into the port shape. */
export function normalizeMessages(messages: OpenAiMessage[]): ChatMessage[] {
  if (messages.length > TOOL_LIMITS.maxMessages) {
    throw new ToolRequestError(
      'TOOL_REQUEST_TOO_LARGE',
      `A request may carry at most ${TOOL_LIMITS.maxMessages} messages; this one carries ${messages.length}.`,
    );
  }

  return messages.map(message => {
    switch (message.role) {
      case 'system':
      case 'user':
        return { role: message.role, content: textContent(message.content) };
      case 'assistant': {
        const calls = message.tool_calls ?? [];
        const toolCalls = calls.map(call => {
          const name = call.function?.name;
          if (typeof name !== 'string' || name.length === 0) {
            throw new ToolRequestError('TOOL_REQUEST_INVALID', 'An assistant tool call requires a function name.');
          }
          const raw = call.function?.arguments;
          let args: Record<string, unknown>;
          if (typeof raw === 'string') {
            try {
              const parsed: unknown = JSON.parse(raw.length === 0 ? '{}' : raw);
              if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                throw new Error('not an object');
              }
              args = parsed as Record<string, unknown>;
            } catch {
              throw new ToolRequestError(
                'TOOL_REQUEST_INVALID',
                `Tool call "${name}" carries arguments that are not a JSON object.`,
              );
            }
          } else if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
            args = raw as Record<string, unknown>;
          } else if (raw === undefined) {
            args = {};
          } else {
            throw new ToolRequestError(
              'TOOL_REQUEST_INVALID',
              `Tool call "${name}" carries arguments that are not a JSON object.`,
            );
          }
          return { id: call.id ?? 'call_0', name, arguments: args };
        });
        return {
          role: 'assistant' as const,
          content: textContent(message.content),
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        };
      }
      case 'tool': {
        if (typeof message.tool_call_id !== 'string' || message.tool_call_id.length === 0) {
          throw new ToolRequestError('TOOL_REQUEST_INVALID', 'A tool result requires tool_call_id.');
        }
        return { role: 'tool' as const, toolCallId: message.tool_call_id, content: textContent(message.content) };
      }
      default:
        throw new ToolRequestError('TOOL_REQUEST_INVALID', `Unsupported message role "${message.role}".`);
    }
  });
}

/**
 * Decides what the profile permits for a tool-calling turn.
 *
 * Refusing an unobserved or quarantined model here is the whole point of the
 * profile: the alternative is discovering how a model behaves by letting it
 * drive edits.
 */
export function assertToolCallingAllowed(modelId: string): EffectiveInferenceSettings {
  const profile = resolveModelProfile(modelId);
  if (profile.toolProtocol === 'quarantined') {
    throw new ToolRequestError(
      'MODEL_TOOL_PROTOCOL_QUARANTINED',
      `Model "${modelId}" is quarantined for tool use: ${profile.evidence}`,
    );
  }
  if (profile.toolProtocol === 'unobserved') {
    throw new ToolRequestError(
      'MODEL_TOOL_PROFILE_UNKNOWN',
      `Model "${modelId}" has no recorded tool-protocol evidence, so it may not be given tools.`,
    );
  }
  return applyModelProfile(profile, {});
}

/**
 * Converts a port result into the OpenAI response shape.
 *
 * Parallel calls are refused rather than truncated. Mediating two side effects
 * that arrived as one indivisible model turn would mean approving them together
 * or guessing an order, and neither is something Core can audit honestly.
 */
export function toOpenAiToolCalls(result: ChatResult): Array<{
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}> {
  if (result.toolCalls.length > 1) {
    throw new ProviderError(
      'MODEL_TOOL_PROTOCOL_ERROR',
      `The model requested ${result.toolCalls.length} tool calls in one turn; parallel tool calling is not supported.`,
    );
  }
  return result.toolCalls.map(call => ({
    id: call.id,
    type: 'function' as const,
    // OpenAI requires a JSON string here, where the port carries an object.
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }));
}
