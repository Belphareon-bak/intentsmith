/**
 * Ollama-specific HTTP and DTO translation.
 *
 * Depends only on `@intentsmith/inference`. Nothing here reaches Core,
 * persistence, or the server, so the adapter stays replaceable.
 */
export {
  DEFAULT_TIMEOUTS,
  OllamaProvider,
  fetchTransport,
  type OllamaAdapterOptions,
  type OllamaResponse,
  type OllamaTimeouts,
  type OllamaTransport,
} from './adapter.js';
export {
  DEFAULT_NDJSON_LIMITS,
  readNdjson,
  type NdjsonLimits,
} from './ndjson.js';
export {
  extractContextLength,
  nsToMs,
  parseGenerateRecord,
  parseParameterBillions,
  parsePs,
  parseShow,
  parseTags,
  parseVersion,
  sanitize,
  type OllamaGenerateRecord,
  type OllamaShowResult,
  type OllamaTagEntry,
} from './dto.js';
