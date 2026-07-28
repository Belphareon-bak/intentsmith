/**
 * Tool-capable chat surface.
 *
 * `generate` is a prompt in and text out; it cannot express a conversation that
 * contains tool calls and tool results, so a worker that calls tools needs a
 * second, explicitly bounded surface rather than a reinterpretation of the
 * first. This one is still vendor-neutral: no Ollama field name and no OpenAI
 * field name appears in it.
 *
 * Nothing here executes anything. A tool call is data that travels back to the
 * worker, which is the only component allowed to run it, and only after its own
 * permission handling.
 */

export type ChatToolDefinition = {
  name: string;
  description?: string;
  /** JSON Schema for the tool's arguments, as advertised by the worker. */
  parameters: Record<string, unknown>;
};

/** A structured call the model asked for. Never parsed out of prose. */
export type ChatToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ChatToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

/**
 * How the model may use tools.
 *
 * `required` is deliberately absent: no observed worker asks for it, and an
 * unimplemented value must be refused rather than quietly downgraded to `auto`.
 */
export type ChatToolChoice = 'auto' | 'none';

export type ChatRequest = {
  modelId: string;
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
  toolChoice?: ChatToolChoice;
  maxOutputTokens?: number;
  temperature?: number;
  /**
   * Whether the model may emit a separate reasoning phase.
   *
   * Measured, not assumed: with thinking enabled `qwen3:14b` consumed its whole
   * output budget reasoning and produced no tool call at all, so this is a
   * per-model profile decision Core makes. See
   * `docs/testing/phase-3b-model-probe.md`.
   */
  think?: boolean;
  timeoutMs?: number;
};

export type ChatResult = {
  text: string;
  /** Structured calls only. Empty when the model just answered. */
  toolCalls: ChatToolCall[];
  finishReason: 'stop' | 'tool_calls';
  usage?: { promptTokens: number; completionTokens: number };
};

/**
 * Text patterns that look like a tool call but are not one.
 *
 * `qwen3-coder:30b` emitted `<function=list_files>` inside ordinary prose in six
 * probe responses. Parsing that would mean executing a side effect the model
 * never actually requested through the protocol, decided by a regular
 * expression over untrusted text. The patterns exist so the condition can be
 * *detected and refused*, never so it can be honoured.
 */
const PSEUDO_CALL_PATTERNS: RegExp[] = [
  /<function\s*=/i,
  /<tool_call\b/i,
  /<\|tool_call\|>/i,
  /^\s*```\s*(?:tool_call|function_call)\b/im,
];

/** True when assistant text contains something shaped like a call. */
export function containsTextualToolCall(text: string): boolean {
  return PSEUDO_CALL_PATTERNS.some(pattern => pattern.test(text));
}
