/**
 * Ollama-specific HTTP and DTO translation.
 *
 * Depends only on `@intentsmith/inference`. Nothing here reaches Core,
 * persistence, or the server, so the adapter stays replaceable.
 *
 * Offline test fixtures live in `./fixtures.js` and are deliberately not
 * re-exported here: they contain sample upstream payloads including a
 * cloud-backed entry whose `remote_host` is a real hostname, and nothing that
 * ships in the production surface should carry a non-local URL.
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
