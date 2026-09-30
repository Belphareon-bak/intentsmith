// A sealed evaluation clock, never a production setting. Whole panels must use
// the same reference; responses from a live-clock cohort cannot be spliced in.
import { clockSystemPrompt } from '../llm/clock-context.js';

const HEADER = '[Current clock — supplied by IntentSmith for this request]\n';
export function fixedCaptureClock(iso, timeZone = 'Europe/Prague') {
  const date = new Date(iso);
  if (!iso || !Number.isFinite(date.getTime()) || date.toISOString() !== iso)
    throw new Error('CAPTURE_CLOCK_INVALID');
  return { version: 'fixed-capture-clock.1', iso, timeZone,
    systemPrompt: clockSystemPrompt(date, timeZone), productionRealtime: false };
}

export function applyCaptureClock(body, clock) {
  if (!clock) return { body, originalClock: null };
  const expected = fixedCaptureClock(clock.iso, clock.timeZone);
  if (JSON.stringify(expected) !== JSON.stringify(clock)) throw new Error('CAPTURE_CLOCK_PLAN_DRIFT');
  const system = body?.messages?.[0];
  const boundary = system?.content?.indexOf('\n\n');
  if (system?.role !== 'system' || typeof system.content !== 'string' || !system.content.startsWith(HEADER) || boundary < HEADER.length)
    throw new Error('CAPTURE_CLOCK_SOURCE_MISSING');
  const originalClock = system.content.slice(0, boundary);
  // Only the trusted leading clock block changes. Neither historical messages
  // nor the actual user request are searched or replaced.
  return { body: { ...body, messages: [{ ...system,
    content: expected.systemPrompt + system.content.slice(boundary) }, ...body.messages.slice(1)] },
    originalClock };
}
