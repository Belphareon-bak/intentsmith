import type { InferenceEvent, ModelDescriptor } from '@intentsmith/inference';

/**
 * Inference, hardware and recovery CLI commands.
 *
 * The CLI is a client of IntentSmith Server and never talks to Ollama
 * directly, so the local-only endpoint policy and the remote-model rejection
 * cannot be bypassed by using the CLI instead of the API.
 */

export type InferenceTransport = {
  inferenceHealth(): Promise<unknown>;
  listModels(): Promise<{ models: ModelDescriptor[] }>;
  describeModel(modelId: string): Promise<ModelDescriptor>;
  assessModel(modelId: string, policy?: string): Promise<unknown>;
  hardware(): Promise<unknown>;
  recovery(): Promise<unknown>;
  /** Yields normalized events as the server streams NDJSON. */
  generate(
    body: { modelId: string; prompt: string; system?: string; maxOutputTokens?: number; stream?: boolean },
    signal: AbortSignal,
  ): AsyncIterable<InferenceEvent>;
};

/** Reads a prompt from stdin so it never appears in shell history. */
export async function readStdin(stream: AsyncIterable<Uint8Array> | NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

const GIB = 1024 ** 3;

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return 'unknown';
  return `${(bytes / GIB).toFixed(1)} GiB`;
}

export function formatModelList(models: ModelDescriptor[]): string {
  if (models.length === 0) return 'No local models. Install one with "ollama pull <model>".';
  return models
    .map(model => {
      const marker = model.execution === 'remote_forbidden' ? ' [REMOTE - BLOCKED]' : '';
      const size = formatBytes(model.artifactBytes);
      const params = model.parameterSizeLabel ?? 'unknown';
      return `${model.id}${marker}\n  family=${model.family} params=${params} quant=${model.quantization ?? 'unknown'} size=${size}`;
    })
    .join('\n');
}

export function formatModelDetail(model: ModelDescriptor): string {
  const lines = [
    `id:            ${model.id}`,
    `execution:     ${model.execution}${model.execution === 'remote_forbidden' ? ' (generation refused)' : ''}`,
    `family:        ${model.family}`,
    `parameters:    ${model.parameterSizeLabel ?? 'unknown'}`,
    `quantization:  ${model.quantization ?? 'unknown'}`,
    `context:       ${model.contextTokens ?? 'unknown'}`,
    `artifact size: ${formatBytes(model.artifactBytes)}`,
    `digest:        ${model.digest ?? 'unknown'}`,
  ];
  if (model.capabilities?.length) lines.push(`capabilities:  ${model.capabilities.join(', ')}`);
  if (model.executionReason) lines.push(`reason:        ${model.executionReason}`);
  return lines.join('\n');
}

export function formatAssessment(payload: unknown): string {
  const record = payload as {
    model?: { id?: string };
    decision?: {
      allowed?: boolean;
      policy?: string;
      errorCode?: string;
      reason?: string;
      assessment?: {
        classification?: string;
        confidence?: string;
        assumptions?: string[];
        warnings?: string[];
        reasonCodes?: string[];
      };
    };
  };
  const assessment = record.decision?.assessment;
  const lines = [
    `model:          ${record.model?.id ?? 'unknown'}`,
    `classification: ${assessment?.classification ?? 'unknown'}`,
    `confidence:     ${assessment?.confidence ?? 'unknown'}`,
    `policy:         ${record.decision?.policy ?? 'unknown'}`,
    `allowed:        ${record.decision?.allowed === true ? 'yes' : 'no'}`,
  ];
  if (record.decision?.reason) lines.push(`reason:         ${record.decision.reason}`);
  for (const assumption of assessment?.assumptions ?? []) lines.push(`assumption:     ${assumption}`);
  for (const warning of assessment?.warnings ?? []) lines.push(`warning:        ${warning}`);
  if (assessment?.reasonCodes?.length) lines.push(`codes:          ${assessment.reasonCodes.join(', ')}`);
  return lines.join('\n');
}

export function formatHardware(payload: unknown): string {
  const profile = payload as {
    system?: { os?: string; arch?: string; logicalCpuCount?: number; totalRamBytes?: number; availableRamBytes?: number };
    gpu?: { status?: string; vendor?: string; devices?: Array<Record<string, unknown>>; detail?: string };
    acceleratorState?: string;
    warnings?: string[];
  };
  const lines = [
    `os/arch:     ${profile.system?.os ?? '?'}/${profile.system?.arch ?? '?'}`,
    `cpus:        ${profile.system?.logicalCpuCount ?? 'unknown'}`,
    `ram:         ${formatBytes(profile.system?.totalRamBytes)} total, ${formatBytes(profile.system?.availableRamBytes)} available`,
    `accelerator: ${profile.acceleratorState ?? 'unknown'}`,
    `gpu probe:   ${profile.gpu?.status ?? 'unknown'}`,
  ];
  for (const device of profile.gpu?.devices ?? []) {
    lines.push(
      `  [${String(device.index)}] ${String(device.name)} vram=${formatBytes(device.totalVramBytes as number | undefined)} free=${formatBytes(device.freeVramBytes as number | undefined)}`,
    );
  }
  for (const warning of profile.warnings ?? []) lines.push(`warning:     ${warning}`);
  return lines.join('\n');
}

export function formatRecovery(payload: unknown): string {
  const summary = payload as {
    status?: string;
    recoveredRunCount?: number;
    affectedTaskIds?: string[];
    completedAt?: string;
    errorCode?: string;
  };
  const lines = [
    `status:    ${summary.status ?? 'unknown'}`,
    `recovered: ${summary.recoveredRunCount ?? 0} run(s)`,
    `tasks:     ${summary.affectedTaskIds?.length ?? 0}`,
    `at:        ${summary.completedAt ?? 'unknown'}`,
  ];
  if (summary.errorCode) lines.push(`error:     ${summary.errorCode}`);
  if ((summary.recoveredRunCount ?? 0) > 0) {
    lines.push('Interrupted runs were closed, not restarted. Start a new run explicitly if you want the work redone.');
  }
  return lines.join('\n');
}
