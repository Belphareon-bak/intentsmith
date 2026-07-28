/**
 * `@intentsmith/inference` owns the provider port, its normalized types, the
 * local-only endpoint policy, remote-execution detection, and the provider
 * scheduler. It depends on no other IntentSmith package, so a concrete adapter
 * can implement the port without pulling in Core.
 */
export {
  PROVIDER_ERROR_CODES,
  ProviderError,
  isProviderErrorCode,
  normalizeProviderError,
  supportsToolCalling,
  type ToolCapableInferenceProvider,
  type GenerationRequest,
  type InferenceEvent,
  type InferenceProvider,
  type ModelDescriptor,
  type ModelExecution,
  type NormalizedProviderError,
  type ProviderCapabilities,
  type ProviderErrorCode,
  type ProviderHealth,
  type ProviderIdentity,
  type TokenUsage,
} from './provider.js';
export {
  containsTextualToolCall,
  type ChatMessage,
  type ChatRequest,
  type ChatResult,
  type ChatToolCall,
  type ChatToolChoice,
  type ChatToolDefinition,
} from './chat.js';
export {
  MODEL_PROFILES,
  THINKING_ENABLED_INVALID_PROFILE,
  applyModelProfile,
  resolveModelProfile,
  unobservedProfile,
  type EffectiveInferenceSettings,
  type ModelProfile,
  type ToolProtocolStatus,
} from './model-profile.js';
export {
  ALLOWED_REQUEST_HEADERS,
  DEFAULT_OLLAMA_ENDPOINT,
  assertLocalEndpoint,
  buildRequestHeaders,
  type EndpointPolicyResult,
} from './endpoint-policy.js';
export {
  REMOTE_MARKER_FIELDS,
  assertNotRemote,
  assessRemoteMarkers,
  type RemoteAssessment,
} from './remote-policy.js';
export { InferenceScheduler, type SchedulerOptions } from './scheduler.js';
