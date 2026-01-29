// CRE v45.0 KOLO 5.4 — Creative Depth Scaling Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT:
// - Separate style (expert) from task depth
// - CreativeDepth: light | narrative | worldbuilding
// - Follow-up "alternative version" → automatically increases depth
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  CreativeDepth,
  CreativeTaskType,
  detectCreativeTaskType,
  CreativeDepthTracker,
  getCreativeDepthInstructions,
} from '../src/quality/creative-depth.js';

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Task Type Detection
// ════════════════════════════════════════════════════════════════════════════════

describe('Creative Depth: Task Type Detection', () => {
  it('detects poem requests', () => {
    assert.strictEqual(detectCreativeTaskType('Napiš mi básničku o jaru'), CreativeTaskType.POEM);
    assert.strictEqual(detectCreativeTaskType('Write a poem about love'), CreativeTaskType.POEM);
  });

  it('detects story requests', () => {
    assert.strictEqual(detectCreativeTaskType('Vymysli příběh o rytíři'), CreativeTaskType.STORY);
    assert.strictEqual(detectCreativeTaskType('Tell me a pohádka'), CreativeTaskType.STORY);
  });

  it('detects song requests', () => {
    assert.strictEqual(detectCreativeTaskType('Napiš text písně o lásce'), CreativeTaskType.SONG);
    assert.strictEqual(detectCreativeTaskType('Create a song about summer'), CreativeTaskType.SONG);
  });

  it('detects joke requests', () => {
    assert.strictEqual(detectCreativeTaskType('Řekni mi vtip'), CreativeTaskType.JOKE);
    assert.strictEqual(detectCreativeTaskType('Máš nějakou anekdotu?'), CreativeTaskType.JOKE);
  });

  it('detects idea/brainstorm requests', () => {
    assert.strictEqual(detectCreativeTaskType('Vymysli název pro firmu'), CreativeTaskType.IDEA);
    assert.strictEqual(detectCreativeTaskType('Navrhni logo'), CreativeTaskType.IDEA);
  });

  it('returns OTHER for non-creative queries', () => {
    assert.strictEqual(detectCreativeTaskType('Jaký je kurz dolaru?'), CreativeTaskType.OTHER);
    assert.strictEqual(detectCreativeTaskType('Explain quantum physics'), CreativeTaskType.OTHER);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Depth Tracker
// ════════════════════════════════════════════════════════════════════════════════

describe('Creative Depth: Tracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new CreativeDepthTracker();
  });

  it('starts at LIGHT depth', () => {
    assert.strictEqual(tracker.currentDepth, CreativeDepth.LIGHT);
  });

  it('escalates on "alternativa" request', () => {
    tracker.currentDepth = CreativeDepth.LIGHT;
    const result = tracker.processInput('Dej mi alternativu');

    assert.strictEqual(result.depth, CreativeDepth.NARRATIVE);
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.reason, 'escalation_requested');
  });

  it('escalates on "pokračuj" request', () => {
    tracker.currentDepth = CreativeDepth.LIGHT;
    const result = tracker.processInput('Pokračuj v příběhu');

    assert.strictEqual(result.depth, CreativeDepth.NARRATIVE);
  });

  it('escalates on "rozviň" request', () => {
    tracker.currentDepth = CreativeDepth.NARRATIVE;
    const result = tracker.processInput('Rozviň to více');

    assert.strictEqual(result.depth, CreativeDepth.WORLDBUILDING);
  });

  it('does not exceed WORLDBUILDING', () => {
    tracker.currentDepth = CreativeDepth.WORLDBUILDING;
    const result = tracker.processInput('Ještě víc, podrobněji');

    assert.strictEqual(result.depth, CreativeDepth.WORLDBUILDING);
    assert.strictEqual(result.changed, false);
  });

  it('reduces on "kratší" request', () => {
    tracker.currentDepth = CreativeDepth.NARRATIVE;
    const result = tracker.processInput('Zkrať to, kratší verze');

    assert.strictEqual(result.depth, CreativeDepth.LIGHT);
    assert.strictEqual(result.reason, 'reduction_requested');
  });

  it('does not go below LIGHT', () => {
    tracker.currentDepth = CreativeDepth.LIGHT;
    const result = tracker.processInput('Stručněji, kratší');

    assert.strictEqual(result.depth, CreativeDepth.LIGHT);
    assert.strictEqual(result.changed, false);
  });

  it('tracks escalation count', () => {
    tracker.processInput('Pokračuj');
    tracker.processInput('Ještě víc');

    assert.strictEqual(tracker.escalationCount, 2);
  });

  it('reset clears state', () => {
    tracker.processInput('Pokračuj');
    tracker.processInput('Pokračuj');
    tracker.reset();

    assert.strictEqual(tracker.currentDepth, CreativeDepth.LIGHT);
    assert.strictEqual(tracker.escalationCount, 0);
    assert.strictEqual(tracker.history.length, 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Depth Instructions
// ════════════════════════════════════════════════════════════════════════════════

describe('Creative Depth: Instructions', () => {
  it('LIGHT depth emphasizes brevity', () => {
    const instructions = getCreativeDepthInstructions(CreativeDepth.LIGHT);

    assert.ok(instructions.includes('Lehká'), 'Should mention light depth');
    assert.ok(instructions.includes('Krátk') || instructions.includes('jednoduch'), 'Should emphasize brevity');
  });

  it('NARRATIVE depth emphasizes structure', () => {
    const instructions = getCreativeDepthInstructions(CreativeDepth.NARRATIVE);

    assert.ok(instructions.includes('Narativní'));
    assert.ok(instructions.includes('začátek') || instructions.includes('struktur'));
  });

  it('WORLDBUILDING depth emphasizes detail', () => {
    const instructions = getCreativeDepthInstructions(CreativeDepth.WORLDBUILDING);

    assert.ok(instructions.includes('Worldbuilding'));
    assert.ok(instructions.includes('Detailní') || instructions.includes('Propracovan'));
  });

  it('includes task type when specified', () => {
    const instructions = getCreativeDepthInstructions(CreativeDepth.LIGHT, CreativeTaskType.POEM);

    assert.ok(instructions.includes('Báseň') || instructions.includes('poezie'));
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Synthesis Hints
// ════════════════════════════════════════════════════════════════════════════════

describe('Creative Depth: Synthesis Hints', () => {
  let tracker;

  beforeEach(() => {
    tracker = new CreativeDepthTracker();
  });

  it('returns current state as hints', () => {
    tracker.currentDepth = CreativeDepth.NARRATIVE;
    tracker.taskType = CreativeTaskType.STORY;
    tracker.escalationCount = 2;

    const hints = tracker.getSynthesisHints();

    assert.strictEqual(hints.creativeDepth, CreativeDepth.NARRATIVE);
    assert.strictEqual(hints.taskType, CreativeTaskType.STORY);
    assert.strictEqual(hints.escalationCount, 2);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Contract Invariants
// ════════════════════════════════════════════════════════════════════════════════

describe('Creative Depth: Contract Invariants', () => {
  it('INVARIANT: Depth levels are properly ordered', () => {
    const tracker = new CreativeDepthTracker();

    // Start at LIGHT
    assert.strictEqual(tracker.currentDepth, CreativeDepth.LIGHT);

    // Escalate to NARRATIVE
    tracker.processInput('Víc');
    assert.strictEqual(tracker.currentDepth, CreativeDepth.NARRATIVE);

    // Escalate to WORLDBUILDING
    tracker.processInput('Ještě víc');
    assert.strictEqual(tracker.currentDepth, CreativeDepth.WORLDBUILDING);

    // Reduce back
    tracker.processInput('Kratší');
    assert.strictEqual(tracker.currentDepth, CreativeDepth.NARRATIVE);
  });

  it('INVARIANT: Alternative request always escalates (if possible)', () => {
    const tracker = new CreativeDepthTracker();

    const alternativePatterns = [
      'Dej alternativu',
      'Jinou verzi',
      'Different version',
    ];

    for (const pattern of alternativePatterns) {
      tracker.reset();
      tracker.currentDepth = CreativeDepth.LIGHT;

      const result = tracker.processInput(pattern);

      assert.ok(
        result.depth === CreativeDepth.NARRATIVE || result.depth === CreativeDepth.WORLDBUILDING,
        `"${pattern}" should escalate depth`
      );
    }
  });

  it('INVARIANT: Task type detection is independent of depth', () => {
    const type1 = detectCreativeTaskType('Napiš básničku');
    const type2 = detectCreativeTaskType('Napiš delší básničku');
    const type3 = detectCreativeTaskType('Napiš krátkou básničku');

    assert.strictEqual(type1, CreativeTaskType.POEM);
    assert.strictEqual(type2, CreativeTaskType.POEM);
    assert.strictEqual(type3, CreativeTaskType.POEM);
  });
});

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE v45.0 KOLO 5.4 — Creative Depth Scaling Tests                          ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  CONTRACT:                                                                   ║
║  - Separate style (expert) from task depth                                   ║
║  - CreativeDepth: light | narrative | worldbuilding                          ║
║  - Follow-up "alternative" → increases depth                                 ║
║                                                                              ║
║  Depth is orthogonal to expert style (writer/analyst).                       ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
