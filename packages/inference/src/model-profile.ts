/**
 * Per-model inference profiles.
 *
 * A profile is a Core decision backed by measurement, not a suggestion a worker
 * can talk IntentSmith out of. Every value here comes from the probe recorded in
 * `docs/testing/phase-3b-model-probe.md`; nothing is inherited from a model's
 * reputation or from what its name implies.
 *
 * The field that matters most is `toolProtocol`. Being fast, popular or
 * explicitly named after coding does not establish that a model emits
 * structured tool calls — one of the models measured here is the fastest of the
 * four and still writes calls as prose.
 */

/** Whether a model was observed to use the structured tool protocol. */
export type ToolProtocolStatus =
  /** Observed emitting structured tool calls. */
  | 'structured'
  /** Observed emitting call-shaped prose. Refused for tool use. */
  | 'quarantined'
  /** Never observed. Refused for tool use until it is. */
  | 'unobserved';

export type ModelProfile = {
  modelId: string;
  /** What this model is selected for. */
  role: 'fast' | 'deep' | 'coding-experimental' | 'quarantined-tools';
  /**
   * Explicit thinking decision, when one was measured.
   *
   * `false` is not a stylistic preference: with thinking enabled `qwen3:14b`
   * spent its entire output budget reasoning and emitted no tool call at all.
   * Absent means no decision was measured and the model's own default stands.
   */
  think?: boolean;
  maxOutputTokens: number;
  temperature: number;
  toolProtocol: ToolProtocolStatus;
  /** One line on where this profile's numbers come from. */
  evidence: string;
};

export const MODEL_PROFILES: Readonly<Record<string, ModelProfile>> = Object.freeze({
  'qwen3.5:27b': {
    modelId: 'qwen3.5:27b',
    role: 'deep',
    maxOutputTokens: 1024,
    temperature: 0,
    toolProtocol: 'structured',
    evidence: '30/30 tool-calling scenarios at 32.3 tok/s; most reliable universal local worker measured.',
  },
  'qwen3:14b': {
    modelId: 'qwen3:14b',
    role: 'fast',
    think: false,
    maxOutputTokens: 512,
    temperature: 0,
    toolProtocol: 'structured',
    evidence: '30/30 with think:false at 74.8 tok/s; 19/30 with thinking enabled, which is a configuration result.',
  },
  'devstral-small-2:24b': {
    modelId: 'devstral-small-2:24b',
    role: 'coding-experimental',
    maxOutputTokens: 1024,
    temperature: 0,
    toolProtocol: 'structured',
    evidence: 'Edits, path policy and recovery passed; command workflows need lifecycle-aware scoring.',
  },
  'qwen3-coder:30b': {
    modelId: 'qwen3-coder:30b',
    role: 'quarantined-tools',
    maxOutputTokens: 1024,
    temperature: 0,
    toolProtocol: 'quarantined',
    evidence: 'Fastest measured at 143 tok/s, but emitted <function=...> as text in six responses.',
  },
});

/**
 * Profile for a model IntentSmith has never measured.
 *
 * Plain inference is still allowed — that path has been safe since Phase 2 and
 * refusing it would break existing behaviour for no gain. Tool calling is not,
 * because there is no evidence the model speaks the protocol, and finding out
 * by letting it drive side effects is not a test anyone should run.
 */
export function unobservedProfile(modelId: string): ModelProfile {
  return {
    modelId,
    role: 'fast',
    maxOutputTokens: 512,
    temperature: 0,
    toolProtocol: 'unobserved',
    evidence: 'No probe evidence for this model.',
  };
}

export function resolveModelProfile(modelId: string): ModelProfile {
  return MODEL_PROFILES[modelId] ?? unobservedProfile(modelId);
}

/**
 * The settings actually used, after the profile has overruled the caller.
 *
 * A worker may ask; the profile decides. Sampling values are clamped rather
 * than accepted, and thinking is not negotiable at all, because a worker that
 * could re-enable it could silently disable this model's ability to call tools.
 */
export type EffectiveInferenceSettings = {
  modelId: string;
  role: ModelProfile['role'];
  maxOutputTokens: number;
  temperature: number;
  think?: boolean;
  toolProtocol: ToolProtocolStatus;
  /** Fields the caller asked for that the profile overruled. */
  overruled: string[];
};

export function applyModelProfile(
  profile: ModelProfile,
  requested: { maxOutputTokens?: number; temperature?: number; think?: boolean } = {},
): EffectiveInferenceSettings {
  const overruled: string[] = [];

  // A smaller budget is the caller's business; a larger one is not.
  const maxOutputTokens = Math.min(requested.maxOutputTokens ?? profile.maxOutputTokens, profile.maxOutputTokens);
  if (requested.maxOutputTokens !== undefined && requested.maxOutputTokens > profile.maxOutputTokens) {
    overruled.push('max_tokens');
  }

  let temperature = profile.temperature;
  if (requested.temperature !== undefined && requested.temperature !== profile.temperature) {
    // Temperature is recorded as overruled rather than blended: an approved
    // profile that drifts per request is not a profile.
    temperature = profile.temperature;
    overruled.push('temperature');
  }

  if (requested.think !== undefined && requested.think !== profile.think) overruled.push('think');

  return {
    modelId: profile.modelId,
    role: profile.role,
    maxOutputTokens,
    temperature,
    ...(profile.think === undefined ? {} : { think: profile.think }),
    toolProtocol: profile.toolProtocol,
    overruled,
  };
}
