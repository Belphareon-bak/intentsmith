import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { OllamaProvider, fetchTransport } from '@intentsmith/adapter-ollama';
import { HardwareDirector, applyExecutionPolicy, assessFit, redactHardwareProfile } from '@intentsmith/hardware';
import type { InferenceEvent } from '@intentsmith/inference';

/**
 * Optional real-Ollama verification suite.
 *
 * Never runs from `pnpm verify` or normal CI: `pnpm test:ollama` is a separate
 * command and this file is excluded from the default vitest project.
 *
 * It never pulls a model, never signs in, never uses an API key, and never
 * contacts ollama.com. A missing Ollama or a missing model is reported as
 * BLOCKED, never as PASS.
 *
 * No prompt text and no generated output is written to committed evidence.
 */

const OPT_IN = process.env.INTENTSMITH_RUN_REAL_OLLAMA === '1';
const MODEL = process.env.INTENTSMITH_OLLAMA_TEST_MODEL;
const ENDPOINT = process.env.INTENTSMITH_OLLAMA_ENDPOINT ?? 'http://127.0.0.1:11434';

/** A harmless fixed prompt. Deliberately trivial and never recorded. */
const PROMPT = 'Reply with the single word: ready';
const MAX_TOKENS = 16;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outputPath = path.join(repoRoot, 'artifacts', 'phase-2-ollama-suite.json');

type SuiteEvidence = Record<string, unknown> & { status: 'PASS' | 'FAIL' | 'BLOCKED' };

function record(evidence: SuiteEvidence): void {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
}

async function collect(stream: AsyncIterable<InferenceEvent>): Promise<InferenceEvent[]> {
  const events: InferenceEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

/**
 * The suite is skipped only when the operator did not opt in. Once opted in, a
 * missing daemon or model FAILS the run with a BLOCKED verdict recorded, so an
 * unavailable installation can never be mistaken for a pass.
 */
const maybe = OPT_IN ? describe : describe.skip;

maybe('real Ollama verification', () => {
  const provider = new OllamaProvider({ endpoint: ENDPOINT, transport: fetchTransport });

  it('records honest evidence for a real local generation', async () => {
    const started = new Date().toISOString();

    const health = await provider.health();
    if (health.status !== 'healthy') {
      record({
        status: 'BLOCKED',
        reason: 'Ollama is not reachable on the configured loopback endpoint.',
        detail: health.detail,
        endpoint: ENDPOINT,
        startedAt: started,
      });
      throw new Error(`BLOCKED: Ollama is not reachable at ${ENDPOINT}. Start it with "ollama serve".`);
    }

    if (!MODEL) {
      record({
        status: 'BLOCKED',
        reason: 'INTENTSMITH_OLLAMA_TEST_MODEL was not set.',
        startedAt: started,
      });
      throw new Error('BLOCKED: set INTENTSMITH_OLLAMA_TEST_MODEL to an already installed local model.');
    }

    const models = await provider.listModels();
    const target = models.find(model => model.id === MODEL);
    if (!target) {
      record({
        status: 'BLOCKED',
        reason: `Model "${MODEL}" is not installed locally. This suite never downloads models.`,
        availableModelCount: models.length,
        startedAt: started,
      });
      throw new Error(`BLOCKED: model "${MODEL}" is not installed. Install it yourself with "ollama pull ${MODEL}".`);
    }

    // A remote-backed model must never be accepted, even here.
    if (target.execution !== 'local') {
      record({
        status: 'FAIL',
        reason: `Model "${MODEL}" is not local (${target.execution}).`,
        startedAt: started,
      });
      throw new Error(`FAIL: model "${MODEL}" is remote-backed and must not be used.`);
    }

    const described = await provider.describeModel(MODEL);
    const hardware = await new HardwareDirector().profile();
    const decision = applyExecutionPolicy(assessFit(described, hardware), 'cpu_allowed');

    const before = Date.now();
    let firstTokenMs: number | undefined;
    let completionTokens = 0;
    let promptTokens = 0;
    let terminal: InferenceEvent | undefined;

    for await (const event of provider.generate({
      modelId: MODEL,
      prompt: PROMPT,
      maxOutputTokens: MAX_TOKENS,
      temperature: 0,
      stream: true,
    })) {
      if (event.type === 'token' && firstTokenMs === undefined) firstTokenMs = Date.now() - before;
      if (event.type === 'completed') {
        promptTokens = event.usage?.promptTokens ?? 0;
        completionTokens = event.usage?.completionTokens ?? 0;
        terminal = event;
      }
      if (event.type === 'failed') terminal = event;
    }
    const totalMs = Date.now() - before;

    // Cancellation must actually stop a real stream.
    const controller = new AbortController();
    let cancelObserved = false;
    const cancelEvents = collect(provider.generate({ modelId: MODEL, prompt: PROMPT, maxOutputTokens: 256 }, controller.signal));
    setTimeout(() => controller.abort(), 150);
    const cancelResult = await cancelEvents;
    const cancelLast = cancelResult.at(-1);
    if (cancelLast?.type === 'failed' && cancelLast.error.code === 'REQUEST_CANCELLED') cancelObserved = true;

    const loaded = await provider.loadedModels();

    const evidence: SuiteEvidence = {
      status: terminal?.type === 'completed' ? 'PASS' : 'FAIL',
      startedAt: started,
      completedAt: new Date().toISOString(),
      endpoint: ENDPOINT,
      ollamaVersion: health.detail,
      model: {
        id: described.id,
        digest: described.digest,
        family: described.family,
        parameterSizeLabel: described.parameterSizeLabel,
        quantization: described.quantization,
        contextTokens: described.contextTokens,
        artifactBytes: described.artifactBytes,
        execution: described.execution,
      },
      // GPU UUIDs are stripped before this is written.
      hardware: redactHardwareProfile(hardware),
      fit: {
        classification: decision.assessment.classification,
        confidence: decision.assessment.confidence,
        allowed: decision.allowed,
        reasonCodes: decision.assessment.reasonCodes,
      },
      performance: {
        timeToFirstTokenMs: firstTokenMs ?? null,
        totalMs,
        promptTokens,
        completionTokens,
        note: 'Performance is evidence, not a pass/fail gate.',
      },
      loadedModelsAfterRun: loaded.map(entry => ({ model: entry.model, sizeVramBytes: entry.sizeVramBytes })),
      cancellation: { requested: true, observed: cancelObserved },
      // Deliberately absent: the prompt text and the generated response.
      promptRecorded: false,
      responseRecorded: false,
    };
    record(evidence);

    expect(terminal?.type).toBe('completed');
    expect(completionTokens).toBeGreaterThan(0);
    expect(cancelObserved).toBe(true);
  }, 180_000);
});
