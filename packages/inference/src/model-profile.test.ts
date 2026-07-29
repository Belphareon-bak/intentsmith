import { describe, expect, it } from 'vitest';

import {
  MODEL_PROFILES,
  THINKING_ENABLED_INVALID_PROFILE,
  applyModelProfile,
  containsTextualToolCall,
  resolveModelProfile,
  unobservedProfile,
} from './index.js';

/**
 * Model profiles.
 *
 * A profile exists so a worker cannot argue with a measured decision, so the
 * tests are mostly about what a caller is *not* allowed to change.
 */

describe('profile resolution', () => {
  it('resolves a measured model to its recorded profile', () => {
    const profile = resolveModelProfile('qwen3:14b');
    expect(profile.think).toBe(false);
    expect(profile.status).toBe('PROVISIONAL');
    expect(profile.toolProtocol).toBe('structured');
    expect(profile.evidence).toMatch(/74\.8 tok\/s/);
  });

  it('treats an unmeasured model as unobserved rather than assuming it is fine', () => {
    const profile = resolveModelProfile('nobody-has-tried-this:8b');
    expect(profile.toolProtocol).toBe('unobserved');
    expect(profile.status).toBe('UNOBSERVED');
    expect(profile).toEqual(unobservedProfile('nobody-has-tried-this:8b'));
  });

  it('quarantines the model that wrote calls as prose, fast though it is', () => {
    expect(resolveModelProfile('qwen3-coder:30b').toolProtocol).toBe('quarantined');
  });

  it('gives every catalogued profile its evidence', () => {
    for (const [id, profile] of Object.entries(MODEL_PROFILES)) {
      expect(profile.modelId, id).toBe(id);
      expect(profile.status, id).toBe('PROVISIONAL');
      expect(profile.evidence.length, id).toBeGreaterThan(0);
      expect(profile.maxOutputTokens, id).toBeGreaterThan(0);
    }
  });

  it('preserves thinking-enabled qwen3:14b as an invalid negative fixture, never a selectable profile', () => {
    expect(THINKING_ENABLED_INVALID_PROFILE).toMatchObject({
      modelId: 'qwen3:14b',
      status: 'INVALID_NEGATIVE_FIXTURE',
      think: true,
      maxOutputTokens: 512,
    });
    expect(THINKING_ENABLED_INVALID_PROFILE.expectedFailure).toMatch(/no structured tool call/i);
    expect(Object.values(MODEL_PROFILES)).not.toContain(THINKING_ENABLED_INVALID_PROFILE);
    expect(resolveModelProfile('qwen3:14b').think).toBe(false);
  });
});

describe('profile authority', () => {
  const profile = resolveModelProfile('qwen3:14b');

  it('accepts a smaller output budget and refuses a larger one', () => {
    expect(applyModelProfile(profile, { maxOutputTokens: 128 })).toMatchObject({
      maxOutputTokens: 128,
      overruled: [],
    });
    const raised = applyModelProfile(profile, { maxOutputTokens: 100_000 });
    expect(raised.maxOutputTokens).toBe(512);
    expect(raised.overruled).toContain('max_tokens');
  });

  it('refuses a different temperature rather than blending it in', () => {
    const applied = applyModelProfile(profile, { temperature: 1.4 });
    expect(applied.temperature).toBe(0);
    expect(applied.overruled).toContain('temperature');
  });

  it('does not let a caller re-enable thinking', () => {
    const applied = applyModelProfile(profile, { think: true });
    expect(applied.think).toBe(false);
    expect(applied.overruled).toContain('think');
  });

  it('records nothing as overruled when the caller asks for what the profile says', () => {
    expect(applyModelProfile(profile, { temperature: 0, think: false, maxOutputTokens: 512 }).overruled).toEqual([]);
  });

  it('omits thinking entirely when no decision was measured', () => {
    const applied = applyModelProfile(resolveModelProfile('qwen3.5:27b'));
    expect('think' in applied).toBe(false);
  });
});

describe('textual tool-call detection', () => {
  it('recognizes the shapes that were actually observed', () => {
    expect(containsTextualToolCall('sure, let me look.\n<function=list_files>')).toBe(true);
    expect(containsTextualToolCall('<tool_call>{"name":"read"}')).toBe(true);
    expect(containsTextualToolCall('```tool_call\n{}\n```')).toBe(true);
  });

  it('leaves ordinary prose alone', () => {
    expect(containsTextualToolCall('The function reads a file and returns its contents.')).toBe(false);
    expect(containsTextualToolCall('')).toBe(false);
  });
});
