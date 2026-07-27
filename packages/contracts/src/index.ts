import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const VERSION = '0.1.0';

const ISO_UTC_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const ABSOLUTE_PATH_PATTERN = '^/';

const StrictOptions = { additionalProperties: false } as const;

export const IdSchema = Type.String({ minLength: 1, maxLength: 160 });
export const IsoUtcSchema = Type.String({ pattern: ISO_UTC_PATTERN });

export const NormalizedErrorSchema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 80 }),
  message: Type.String({ minLength: 1, maxLength: 1000 }),
  retryable: Type.Boolean({ default: false }),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, StrictOptions);

export const RetryPolicySchema = Type.Object({
  maxAttempts: Type.Integer({ minimum: 1, maximum: 5 }),
  backoffMs: Type.Integer({ minimum: 0, maximum: 60_000 }),
}, StrictOptions);

export const NetworkPolicySchema = Type.Object({
  mode: Type.Union([Type.Literal('disabled'), Type.Literal('allowlist')]),
  allowlist: Type.Array(Type.String({ minLength: 1, maxLength: 255 }), { maxItems: 32 }),
}, StrictOptions);

export const ApprovalRuleSchema = Type.Object({
  action: Type.Union([
    Type.Literal('filesystem_write'),
    Type.Literal('shell'),
    Type.Literal('network'),
    Type.Literal('secrets'),
  ]),
  mode: Type.Union([Type.Literal('allow'), Type.Literal('require_approval'), Type.Literal('deny')]),
}, StrictOptions);

export const CapabilityEnvelopeSchema = Type.Object({
  fsReadRoots: Type.Array(Type.String({ pattern: ABSOLUTE_PATH_PATTERN, minLength: 1 }), { minItems: 1, maxItems: 16 }),
  fsWriteRoots: Type.Array(Type.String({ pattern: ABSOLUTE_PATH_PATTERN, minLength: 1 }), { maxItems: 16 }),
  allowedCommandFamilies: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 32 }),
  deniedCommandPatterns: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 64 }),
  network: NetworkPolicySchema,
  envAllowlist: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 64 }),
  secrets: Type.Union([Type.Literal('none'), Type.Literal('explicit_approval')]),
  processSpawning: Type.Union([Type.Literal('disabled'), Type.Literal('bounded')]),
  timeoutMs: Type.Integer({ minimum: 10, maximum: 600_000 }),
  maxActions: Type.Integer({ minimum: 0, maximum: 100 }),
  approvalRules: Type.Array(ApprovalRuleSchema, { maxItems: 32 }),
}, StrictOptions);

export const ProjectSchema = Type.Object({
  id: IdSchema,
  name: Type.String({ minLength: 1, maxLength: 120 }),
  rootPath: Type.String({ pattern: ABSOLUTE_PATH_PATTERN, minLength: 1 }),
  trustState: Type.Union([Type.Literal('trusted'), Type.Literal('untrusted')]),
  status: Type.Union([Type.Literal('active'), Type.Literal('archived')]),
  createdAt: IsoUtcSchema,
  updatedAt: IsoUtcSchema,
}, StrictOptions);

export const ArtifactRefSchema = Type.Object({
  id: IdSchema,
  kind: Type.Union([Type.Literal('file'), Type.Literal('diff'), Type.Literal('log'), Type.Literal('json')]),
  uri: Type.String({ minLength: 1, maxLength: 1000 }),
  sha256: Type.Optional(Type.String({ minLength: 64, maxLength: 64 })),
}, StrictOptions);

export const EvidenceSchema = Type.Object({
  id: IdSchema,
  kind: Type.Union([Type.Literal('test'), Type.Literal('lint'), Type.Literal('typecheck'), Type.Literal('worker'), Type.Literal('security')]),
  status: Type.Union([Type.Literal('pass'), Type.Literal('fail'), Type.Literal('blocked')]),
  summary: Type.String({ minLength: 1, maxLength: 1000 }),
  producedAt: IsoUtcSchema,
}, StrictOptions);

export const WorkerClaimSchema = Type.Object({
  status: Type.Union([Type.Literal('success'), Type.Literal('failure')]),
  summary: Type.String({ minLength: 1, maxLength: 1000 }),
}, StrictOptions);

export const ApprovalRecordSchema = Type.Object({
  id: IdSchema,
  taskId: IdSchema,
  runId: Type.Optional(IdSchema),
  action: Type.String({ minLength: 1, maxLength: 120 }),
  decision: Type.Union([Type.Literal('approved'), Type.Literal('denied')]),
  decidedAt: IsoUtcSchema,
}, StrictOptions);

export const TaskStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('running'),
  Type.Literal('paused'),
  Type.Literal('passed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
]);

export const TaskRunStatusSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('paused'),
  Type.Literal('passed'),
  Type.Literal('failed'),
  Type.Literal('timeout'),
  Type.Literal('cancelled'),
]);

export const WorkerPreferenceSchema = Type.Object({
  kind: Type.Literal('fake'),
  scenario: Type.Union([
    Type.Literal('success'),
    Type.Literal('pauseable-success'),
    Type.Literal('failure'),
    Type.Literal('timeout'),
    Type.Literal('invalid-event'),
    Type.Literal('claim-without-evidence'),
    // Phase 1.1 adversarial scenarios for the shared worker contract suite.
    Type.Literal('event-after-terminal'),
    Type.Literal('two-terminal-events'),
    Type.Literal('failing-evidence'),
    Type.Literal('throwing'),
  ]),
}, StrictOptions);

export const TaskSchema = Type.Object({
  id: IdSchema,
  projectId: IdSchema,
  parentTaskId: Type.Optional(IdSchema),
  dependencyIds: Type.Array(IdSchema, { maxItems: 64 }),
  type: Type.Union([Type.Literal('plan'), Type.Literal('code'), Type.Literal('test'), Type.Literal('review'), Type.Literal('repair')]),
  goal: Type.String({ minLength: 1, maxLength: 2000 }),
  scope: CapabilityEnvelopeSchema,
  inputs: Type.Array(ArtifactRefSchema, { maxItems: 32 }),
  expectedOutputs: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 32 }),
  acceptanceCriteria: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 32 }),
  workerPreference: WorkerPreferenceSchema,
  timeoutMs: Type.Integer({ minimum: 10, maximum: 600_000 }),
  retryPolicy: RetryPolicySchema,
  status: TaskStatusSchema,
  latestRunId: Type.Optional(IdSchema),
  createdAt: IsoUtcSchema,
  updatedAt: IsoUtcSchema,
}, StrictOptions);

export const TaskRunSchema = Type.Object({
  id: IdSchema,
  taskId: IdSchema,
  attempt: Type.Integer({ minimum: 1, maximum: 100 }),
  status: TaskRunStatusSchema,
  startedAt: IsoUtcSchema,
  endedAt: Type.Optional(IsoUtcSchema),
}, StrictOptions);

export const TaskResultSchema = Type.Object({
  id: IdSchema,
  taskId: IdSchema,
  runId: IdSchema,
  workerClaim: Type.Optional(WorkerClaimSchema),
  actions: Type.Array(Type.Unknown(), { maxItems: 0 }),
  diffs: Type.Array(ArtifactRefSchema, { maxItems: 32 }),
  artifacts: Type.Array(ArtifactRefSchema, { maxItems: 32 }),
  deterministicEvidence: Type.Array(EvidenceSchema, { maxItems: 64 }),
  securityEvidence: Type.Array(EvidenceSchema, { maxItems: 64 }),
  governanceFindings: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 64 }),
  approvals: Type.Array(ApprovalRecordSchema, { maxItems: 32 }),
  unresolvedRisks: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 64 }),
  coreVerdict: Type.Union([Type.Literal('pass'), Type.Literal('fail'), Type.Literal('blocked'), Type.Literal('cancelled')]),
  createdAt: IsoUtcSchema,
}, StrictOptions);

const WorkerStartedEventSchema = Type.Object({
  type: Type.Literal('started'),
  runId: IdSchema,
  workerVersion: Type.String({ minLength: 1, maxLength: 120 }),
}, StrictOptions);

const WorkerEvidenceEventSchema = Type.Object({
  type: Type.Literal('evidence'),
  evidence: EvidenceSchema,
}, StrictOptions);

const WorkerArtifactEventSchema = Type.Object({
  type: Type.Literal('artifact'),
  artifact: ArtifactRefSchema,
}, StrictOptions);

const WorkerCompletedEventSchema = Type.Object({
  type: Type.Literal('completed'),
  claim: WorkerClaimSchema,
}, StrictOptions);

const WorkerFailedEventSchema = Type.Object({
  type: Type.Literal('failed'),
  error: NormalizedErrorSchema,
}, StrictOptions);

export const WorkerEventSchema = Type.Union([
  WorkerStartedEventSchema,
  WorkerEvidenceEventSchema,
  WorkerArtifactEventSchema,
  WorkerCompletedEventSchema,
  WorkerFailedEventSchema,
]);

export const AuditEventSchema = Type.Object({
  id: IdSchema,
  projectId: Type.Optional(IdSchema),
  taskId: Type.Optional(IdSchema),
  runId: Type.Optional(IdSchema),
  type: Type.Union([
    Type.Literal('project.created'),
    Type.Literal('task.created'),
    Type.Literal('task.transition'),
    Type.Literal('task.invalid_transition'),
    Type.Literal('task.verdict'),
    Type.Literal('worker.event'),
    Type.Literal('worker.invalid_event'),
    Type.Literal('security.policy'),
  ]),
  message: Type.String({ minLength: 1, maxLength: 1000 }),
  data: Type.Record(Type.String(), Type.Unknown()),
  createdAt: IsoUtcSchema,
}, StrictOptions);

export const CreateProjectInputSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  rootPath: Type.String({ pattern: ABSOLUTE_PATH_PATTERN, minLength: 1 }),
  trustState: Type.Optional(Type.Union([Type.Literal('trusted'), Type.Literal('untrusted')])),
}, StrictOptions);

export const CreateTaskInputSchema = Type.Object({
  projectId: IdSchema,
  type: Type.Union([Type.Literal('plan'), Type.Literal('code'), Type.Literal('test'), Type.Literal('review'), Type.Literal('repair')]),
  goal: Type.String({ minLength: 1, maxLength: 2000 }),
  scope: CapabilityEnvelopeSchema,
  expectedOutputs: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 32 }),
  acceptanceCriteria: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 32 }),
  workerScenario: Type.Optional(WorkerPreferenceSchema.properties.scenario),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 10, maximum: 600_000 })),
}, StrictOptions);

export type NormalizedError = Static<typeof NormalizedErrorSchema>;
export type RetryPolicy = Static<typeof RetryPolicySchema>;
export type CapabilityEnvelope = Static<typeof CapabilityEnvelopeSchema>;
export type Project = Static<typeof ProjectSchema>;
export type ArtifactRef = Static<typeof ArtifactRefSchema>;
export type Evidence = Static<typeof EvidenceSchema>;
export type WorkerClaim = Static<typeof WorkerClaimSchema>;
export type ApprovalRecord = Static<typeof ApprovalRecordSchema>;
export type TaskStatus = Static<typeof TaskStatusSchema>;
export type TaskRunStatus = Static<typeof TaskRunStatusSchema>;
export type WorkerPreference = Static<typeof WorkerPreferenceSchema>;
export type Task = Static<typeof TaskSchema>;
export type TaskRun = Static<typeof TaskRunSchema>;
export type TaskResult = Static<typeof TaskResultSchema>;
export type WorkerEvent = Static<typeof WorkerEventSchema>;
export type AuditEvent = Static<typeof AuditEventSchema>;
export type CreateProjectInput = Static<typeof CreateProjectInputSchema>;
export type CreateTaskInput = Static<typeof CreateTaskInputSchema>;

export class ContractValidationError extends Error {
  readonly code = 'CONTRACT_VALIDATION_FAILED';
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join('; '));
    this.name = 'ContractValidationError';
    this.issues = issues;
  }
}

export function parseWithSchema<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (Value.Check(schema, value)) return value as Static<T>;
  const issues = [...Value.Errors(schema, value)].map(error => `${error.path || '/'} ${error.message}`);
  throw new ContractValidationError(issues);
}

export function isIsoUtc(value: string): boolean {
  return new RegExp(ISO_UTC_PATTERN).test(value);
}
