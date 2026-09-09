# Backend capability inventory

Status: STATIC_SOURCE_INVENTORY_NOT_SESSION_AVAILABILITY

Generated review input for mobile convergence, not an activation or authorization contract.
Desktop declarations cover literal /api and /m1 route-map keys in src/routes and src/server.js.
Dynamic handler registration, non-API aliases, comments that resemble keys, and WebSocket messages
are outside the guarantees of this lexical census. No live server or database is imported.
M7 HTTP routes are taken separately from the admission policy; invocation operations are
taken from the same requirements consumed by the M7 pipeline and checked against the native client.
remote-health.read is a public GET /remote/v1/health prerequisite, not one of the 17 native invocation operations.
The underlying requirements retain their own candidate stage. Availability and scopes must
still be validated against the actual server/session; desktop route existence grants no remote authority.

- Desktop route declarations: 242
- Legacy /m1 declarations: 0
- M7 HTTP routes: 7
- M7 invocation operations: 17
- Capability areas: approvals, conversations, events, notifications, projects, settings, stored_information
- Control-plane operations (not another capability): 3
- Desktop route digest: `d04ed0f8ca989a6f4502fe35f65882dcd1709ddabc5b8550caa4e9c62d3b157a`
- Combined inventory digest: `d98faa42a2f541b3c0eab05e47db1d4b16b49ea250377418a5656cdbbdf18c26`

Workers, specialists and device management have no M7 operation in this projection.
Their desktop route declarations must not be mistaken for a mobile capability.

## M7 transport

| Method | Path | Access |
|---|---|---|
| GET | `/remote/v1/health` | public_health |
| POST | `/remote/v1/invoke` | signed_invocation |
| POST | `/remote/v1/pairing/claim` | pairing_claim |
| POST | `/remote/v1/session/challenge` | signed_session_control |
| POST | `/remote/v1/session/open` | signed_session_control |
| POST | `/remote/v1/session/refresh` | signed_session_control |
| POST | `/remote/v1/session/revoke` | signed_session_control |

## M7 invocation operations

| Operation | Capability / version | Kind | Request → result | Required scopes |
|---|---|---|---|---|
| `approval.decide` | approvals / 1 | mutation | ApprovalDecisionCommand@1 → ApprovalDecisionResult@1 | write:approvals |
| `approval.list` | approvals / 1 | read | ApprovalListQuery@1 → ApprovalPage@1 | read:approvals |
| `conversation.execute` | conversations / 2 | command | ConversationCommand@1 → ConversationResult@1 | write:chat |
| `conversation.history` | conversations / 2 | read | ConversationHistoryQuery@1 → ConversationHistoryPage@1 | read:chat |
| `conversation.list` | conversations / 2 | read | ConversationListQuery@1 → ConversationPage@1 | read:chat |
| `notification.ack` | notifications / 1 | mutation | NotificationAckCommand@1 → NotificationAckResult@1 | write:notifications |
| `notification.list` | notifications / 1 | read | NotificationListQuery@1 → NotificationPage@1 | read:notifications |
| `operation.abandon` | m7-control-plane-prerequisite / 1 | mutation | OperationAbandonCommand@1 → OperationAbandonResult@1 | write:operations |
| `operation.get` | m7-control-plane-prerequisite / 1 | read | OperationLookupQuery@1 → OperationLookupResult@1 | read:operations |
| `operation.list` | m7-control-plane-prerequisite / 1 | read | OperationListQuery@1 → OperationPage@1 | read:operations |
| `project-context.query` | projects / 2 | read | RemoteProjectContextQuery@1 → ProjectContextSnapshot@1 | read:projects |
| `project.list` | projects / 2 | read | ProjectListQuery@1 → ProjectPage@1 | read:projects |
| `run-event.list` | events / 1 | read | RunEventQuery@1 → RunEventPage@1 | read:events |
| `settings.read` | settings / 1 | read | MobileSettingsQuery@1 → MobileSettingsSnapshot@1 | read:settings |
| `settings.update` | settings / 1 | mutation | MobileSettingUpdateCommand@1 → MobileSettingUpdateResult@1 | write:settings |
| `stored-information.append` | stored_information / 1 | mutation | StoredInformationAppendCommand@1 → StoredInformationAppendResult@1 | write:stored_information |
| `stored-information.list` | stored_information / 1 | read | StoredInformationListQuery@1 → StoredInformationPage@1 | read:stored_information |

## Desktop route declarations — not M7 exposure

| Method | Path | Source |
|---|---|---|
| GET | `/api/agent-extensions` | src/routes/agents.js |
| POST | `/api/agent-extensions/:id/install` | src/routes/agents.js |
| DELETE | `/api/agent-extensions/:id/instances/:agentId` | src/routes/agents.js |
| DELETE | `/api/agent-extensions/instances/:agentId` | src/routes/agents.js |
| POST | `/api/agent-extensions/instances/:agentId/disable` | src/routes/agents.js |
| POST | `/api/agent-extensions/instances/:agentId/enable` | src/routes/agents.js |
| POST | `/api/agent-extensions/instances/:agentId/run` | src/routes/agents.js |
| GET | `/api/agents` | src/routes/agents.js |
| POST | `/api/agents` | src/routes/agents.js |
| DELETE | `/api/agents/:id` | src/routes/agents.js |
| GET | `/api/agents/:id` | src/routes/agents.js |
| PUT | `/api/agents/:id` | src/routes/agents.js |
| POST | `/api/agents/:id/disable` | src/routes/agents.js |
| POST | `/api/agents/:id/enable` | src/routes/agents.js |
| POST | `/api/agents/:id/run` | src/routes/agents.js |
| GET | `/api/agents/:id/runs` | src/routes/agents.js |
| POST | `/api/agents/build` | src/routes/agents.js |
| POST | `/api/agents/confirm` | src/routes/agents.js |
| POST | `/api/agents/dry-run` | src/routes/agents.js |
| POST | `/api/agents/refine` | src/routes/agents.js |
| GET | `/api/agents/schema` | src/routes/agents.js |
| GET | `/api/artifacts/:filename` | src/routes/projects.js |
| POST | `/api/attachments` | src/routes/projects.js |
| GET | `/api/attachments/:id` | src/routes/projects.js |
| GET | `/api/audit` | src/routes/misc.js |
| POST | `/api/autocomplete` | src/routes/misc.js |
| POST | `/api/autonomy/alerts/:id/acknowledge` | src/routes/autonomy.js |
| POST | `/api/autonomy/approve/:id` | src/routes/autonomy.js |
| POST | `/api/autonomy/reject/:id` | src/routes/autonomy.js |
| GET | `/api/autonomy/status` | src/routes/autonomy.js |
| POST | `/api/chat` | src/routes/chat.js |
| GET | `/api/chat/sessions` | src/routes/chat.js |
| DELETE | `/api/chat/sessions/:sessionId` | src/routes/chat.js |
| GET | `/api/chat/sessions/:sessionId` | src/routes/chat.js |
| GET | `/api/chat/sessions/stats` | src/routes/chat.js |
| DELETE | `/api/chat/specialist` | src/routes/chat.js |
| POST | `/api/chat/specialist` | src/routes/chat.js |
| POST | `/api/context` | src/routes/misc.js |
| GET | `/api/conversations` | src/routes/chat.js |
| POST | `/api/conversations` | src/routes/chat.js |
| DELETE | `/api/conversations/:id` | src/routes/chat.js |
| GET | `/api/conversations/:id` | src/routes/chat.js |
| PUT | `/api/conversations/:id` | src/routes/chat.js |
| PATCH | `/api/conversations/:id/archive` | src/routes/chat.js |
| POST | `/api/conversations/:id/assign` | src/routes/projects.js |
| GET | `/api/conversations/:id/messages` | src/routes/chat.js |
| PATCH | `/api/conversations/:id/restore` | src/routes/chat.js |
| DELETE | `/api/drafts` | src/routes/chat.js |
| GET | `/api/drafts` | src/routes/chat.js |
| POST | `/api/drafts` | src/routes/chat.js |
| GET | `/api/expertise-schema` | src/routes/expertises.js |
| POST | `/api/expertise-wizard/test-prompt` | src/routes/expertises.js |
| GET | `/api/expertises` | src/routes/expertises.js |
| POST | `/api/expertises` | src/routes/expertises.js |
| DELETE | `/api/expertises/:id` | src/routes/expertises.js |
| GET | `/api/expertises/:id` | src/routes/expertises.js |
| PUT | `/api/expertises/:id` | src/routes/expertises.js |
| POST | `/api/expertises/route` | src/routes/expertises.js |
| POST | `/api/export` | src/routes/chat.js |
| GET | `/api/extensions/expertises` | src/routes/expertises.js |
| DELETE | `/api/extensions/expertises/:id` | src/routes/expertises.js |
| POST | `/api/extensions/expertises/:id/disable` | src/routes/expertises.js |
| POST | `/api/extensions/expertises/:id/enable` | src/routes/expertises.js |
| POST | `/api/extensions/expertises/install` | src/routes/expertises.js |
| GET | `/api/features` | src/routes/misc.js |
| POST | `/api/features/:name` | src/routes/misc.js |
| POST | `/api/features/reset` | src/routes/misc.js |
| GET | `/api/feedback` | src/routes/misc.js |
| POST | `/api/feedback` | src/routes/misc.js |
| POST | `/api/feedback/:id/attach` | src/routes/misc.js |
| GET | `/api/health` | src/routes/misc.js, src/server.js |
| GET | `/api/license/status` | src/server.js |
| POST | `/api/lifecycle/change/approve` | src/routes/expertises.js |
| POST | `/api/lifecycle/change/propose` | src/routes/expertises.js |
| POST | `/api/lifecycle/change/reject` | src/routes/expertises.js |
| POST | `/api/lifecycle/milestone/approve` | src/routes/expertises.js |
| POST | `/api/lifecycle/milestone/blocked` | src/routes/expertises.js |
| POST | `/api/lifecycle/milestone/next` | src/routes/expertises.js |
| GET | `/api/lifecycle/resume` | src/routes/expertises.js |
| POST | `/api/lifecycle/review/acknowledge` | src/routes/expertises.js |
| POST | `/api/lifecycle/roadmap/approve` | src/routes/expertises.js |
| POST | `/api/lifecycle/spec/answer` | src/routes/expertises.js |
| POST | `/api/lifecycle/spec/approve` | src/routes/expertises.js |
| POST | `/api/lifecycle/start` | src/routes/expertises.js |
| GET | `/api/lifecycle/status` | src/routes/expertises.js |
| GET | `/api/logs` | src/routes/misc.js |
| GET | `/api/logs/export` | src/routes/misc.js |
| POST | `/api/m2/lifecycle/approve` | src/routes/m2-lifecycle.js |
| POST | `/api/m2/lifecycle/cancel` | src/routes/m2-lifecycle.js |
| POST | `/api/m2/lifecycle/prepare` | src/routes/m2-lifecycle.js |
| GET | `/api/m2/lifecycle/status` | src/routes/m2-lifecycle.js |
| GET | `/api/marketplace/catalog` | src/routes/marketplace.js |
| POST | `/api/marketplace/catalog/refresh` | src/routes/marketplace.js |
| POST | `/api/marketplace/export/:type/:id` | src/routes/marketplace.js |
| POST | `/api/marketplace/install/:type/:id` | src/routes/marketplace.js |
| GET | `/api/marketplace/installed` | src/routes/marketplace.js |
| DELETE | `/api/marketplace/installed/:type/:id` | src/routes/marketplace.js |
| POST | `/api/marketplace/update/:type/:id` | src/routes/marketplace.js |
| DELETE | `/api/media` | src/routes/media.js |
| POST | `/api/media/cancel` | src/routes/media.js |
| PUT | `/api/media/favorite` | src/routes/media.js |
| POST | `/api/media/generate` | src/routes/media.js |
| GET | `/api/media/health` | src/routes/media.js |
| GET | `/api/media/history` | src/routes/media.js |
| GET | `/api/media/models` | src/routes/media.js |
| POST | `/api/media/models/refresh` | src/routes/media.js |
| GET | `/api/media/output` | src/routes/media.js |
| GET | `/api/media/status` | src/routes/media.js |
| GET | `/api/media/vram` | src/routes/media.js |
| GET | `/api/memory` | src/routes/chat.js |
| POST | `/api/memory` | src/routes/chat.js |
| GET | `/api/merge-preview` | src/routes/expertises.js |
| POST | `/api/merge-preview` | src/routes/expertises.js |
| GET | `/api/notifications` | src/routes/agents.js |
| POST | `/api/notifications/:id/read` | src/routes/agents.js |
| GET | `/api/notifications/channels` | src/routes/notifications.js |
| GET | `/api/notifications/config` | src/routes/notifications.js |
| POST | `/api/notifications/config` | src/routes/notifications.js |
| GET | `/api/notifications/log` | src/routes/notifications.js |
| POST | `/api/notifications/read-all` | src/routes/agents.js |
| POST | `/api/notifications/send` | src/routes/notifications.js |
| POST | `/api/notifications/test` | src/routes/notifications.js |
| POST | `/api/notifications/verify` | src/routes/notifications.js |
| GET | `/api/projects` | src/routes/projects.js |
| POST | `/api/projects` | src/routes/projects.js |
| DELETE | `/api/projects/:id` | src/routes/projects.js |
| GET | `/api/projects/:id` | src/routes/projects.js |
| PUT | `/api/projects/:id` | src/routes/projects.js |
| PATCH | `/api/projects/:id/archive` | src/routes/projects.js |
| GET | `/api/projects/:id/conversations` | src/routes/projects.js |
| GET | `/api/projects/:id/lifecycle` | src/routes/projects.js |
| POST | `/api/projects/:id/lifecycle/bind` | src/routes/projects.js |
| GET | `/api/projects/:id/memory` | src/routes/projects.js |
| PUT | `/api/projects/:id/memory` | src/routes/projects.js |
| DELETE | `/api/projects/:id/memory/:key` | src/routes/projects.js |
| POST | `/api/projects/:id/readme` | src/routes/projects.js |
| PATCH | `/api/projects/:id/restore` | src/routes/projects.js |
| GET | `/api/projects/:id/roadmap` | src/routes/projects.js |
| GET | `/api/projects/:projectId/learning/proposals` | src/routes/learning.js |
| DELETE | `/api/projects/:projectId/learning/proposals/:proposalId` | src/routes/learning.js |
| GET | `/api/projects/:projectId/learning/proposals/:proposalId` | src/routes/learning.js |
| POST | `/api/projects/:projectId/learning/proposals/:proposalId/approve` | src/routes/learning.js |
| POST | `/api/projects/:projectId/learning/proposals/:proposalId/reject` | src/routes/learning.js |
| POST | `/api/projects/:projectId/learning/proposals/:proposalId/rollback` | src/routes/learning.js |
| POST | `/api/projects/:projectId/learning/proposals/:proposalId/weaken` | src/routes/learning.js |
| GET | `/api/projects/defaults` | src/routes/projects.js |
| POST | `/api/projects/lifecycle/start` | src/routes/projects.js |
| POST | `/api/projects/open-folder` | src/routes/projects.js |
| GET | `/api/quality/distribution` | src/routes/quality.js |
| GET | `/api/quality/project/:id` | src/routes/quality.js |
| GET | `/api/quality/report` | src/routes/quality.js |
| GET | `/api/quality/summary` | src/routes/quality.js |
| GET | `/api/quality/volatility/:id` | src/routes/quality.js |
| POST | `/api/reset` | src/routes/misc.js |
| GET | `/api/scheduler/status` | src/routes/agents.js |
| GET | `/api/security/audit` | src/routes/security.js |
| POST | `/api/security/privacy/history/attest` | src/routes/privacy.js |
| GET | `/api/security/privacy/remediation` | src/routes/privacy.js |
| POST | `/api/security/privacy/rotations/:categoryId/attest` | src/routes/privacy.js |
| GET | `/api/security/sessions` | src/routes/security.js |
| GET | `/api/security/tokens` | src/routes/security.js |
| POST | `/api/security/tokens` | src/routes/security.js |
| DELETE | `/api/security/tokens/:id` | src/routes/security.js |
| GET | `/api/security/webhook-secret` | src/routes/security.js |
| POST | `/api/security/webhook-secret` | src/routes/security.js |
| GET | `/api/settings` | src/routes/misc.js |
| POST | `/api/settings` | src/routes/misc.js |
| POST | `/api/settings/import` | src/routes/misc.js |
| GET | `/api/skills` | src/routes/skills.js |
| GET | `/api/skills/:id` | src/routes/skills.js |
| GET | `/api/skills/executions/:id` | src/routes/skills.js |
| POST | `/api/skills/executions/:id/cancel` | src/routes/skills.js |
| POST | `/api/skills/executions/:id/confirm` | src/routes/skills.js |
| POST | `/api/skills/executions/:id/resume` | src/routes/skills.js |
| POST | `/api/skills/reload` | src/routes/skills.js |
| POST | `/api/sources/inspect` | src/routes/agents.js |
| POST | `/api/sources/validate-condition` | src/routes/agents.js |
| POST | `/api/sources/validate-field` | src/routes/agents.js |
| GET | `/api/specialists` | src/routes/specialists.js |
| POST | `/api/specialists` | src/routes/specialists.js |
| DELETE | `/api/specialists/:id` | src/routes/specialists.js |
| GET | `/api/specialists/:id` | src/routes/specialists.js |
| POST | `/api/specialists/:id/disable` | src/routes/specialists.js |
| POST | `/api/specialists/:id/enable` | src/routes/specialists.js |
| GET | `/api/specialists/:id/expertises` | src/routes/specialists.js |
| POST | `/api/specialists/:id/expertises` | src/routes/specialists.js |
| DELETE | `/api/specialists/:id/expertises/:expertiseId` | src/routes/specialists.js |
| PATCH | `/api/specialists/:id/expertises/:expertiseId` | src/routes/specialists.js |
| POST | `/api/specialists/:id/install` | src/routes/specialists.js |
| GET | `/api/specialists/:id/integrity` | src/routes/specialists.js |
| POST | `/api/specialists/:id/update` | src/routes/specialists.js |
| POST | `/api/specialists/discover` | src/routes/specialists.js |
| GET | `/api/specialists/telemetry` | src/routes/specialists.js |
| GET | `/api/storage/info` | src/routes/misc.js |
| POST | `/api/system/backup` | src/routes/system.js |
| GET | `/api/system/backups` | src/routes/system.js |
| GET | `/api/system/catalog` | src/routes/system.js |
| POST | `/api/system/clean` | src/routes/system.js |
| GET | `/api/system/diagnostics` | src/routes/system.js |
| POST | `/api/system/drain` | src/routes/system.js |
| POST | `/api/system/governor/check` | src/routes/governor.js |
| GET | `/api/system/governor/proposals` | src/routes/governor.js |
| POST | `/api/system/governor/proposals/:id/approve` | src/routes/governor.js |
| POST | `/api/system/governor/proposals/:id/dismiss` | src/routes/governor.js |
| GET | `/api/system/governor/report` | src/routes/governor.js |
| GET | `/api/system/governor/status` | src/routes/governor.js |
| GET | `/api/system/gpu` | src/routes/system.js |
| POST | `/api/system/gpu/refresh` | src/routes/system.js |
| GET | `/api/system/info` | src/routes/system.js |
| DELETE | `/api/system/models` | src/routes/system.js |
| GET | `/api/system/models` | src/routes/system.js |
| GET | `/api/system/models/candidates` | src/routes/system.js |
| GET | `/api/system/models/check` | src/routes/system.js |
| GET | `/api/system/models/compatibility` | src/routes/system.js |
| GET | `/api/system/models/evaluations` | src/routes/system.js |
| GET | `/api/system/models/info` | src/routes/system.js |
| GET | `/api/system/models/overview` | src/routes/system.js |
| GET | `/api/system/models/policy` | src/routes/system.js |
| PUT | `/api/system/models/policy` | src/routes/system.js |
| POST | `/api/system/models/pull` | src/routes/system.js |
| GET | `/api/system/models/universe` | src/routes/system.js |
| GET | `/api/system/models/universe/:name` | src/routes/system.js |
| POST | `/api/system/restore` | src/routes/system.js |
| POST | `/api/system/shutdown-backup` | src/routes/system.js |
| GET | `/api/system/storage` | src/routes/system.js |
| GET | `/api/system/storage/settings` | src/routes/system.js |
| PUT | `/api/system/storage/settings` | src/routes/system.js |
| GET | `/api/system/upgrades` | src/routes/system.js |
| POST | `/api/system/upgrades/apply` | src/routes/system.js |
| GET | `/api/system/upgrades/bindings` | src/routes/system.js |
| POST | `/api/system/upgrades/check` | src/routes/system.js |
| GET | `/api/system/upgrades/discovered` | src/routes/system.js |
| POST | `/api/system/upgrades/rollback` | src/routes/system.js |
| POST | `/api/system/vacuum` | src/routes/system.js |
| POST | `/api/workspace/directory` | src/routes/projects.js |
| DELETE | `/api/workspace/file` | src/routes/projects.js |
| GET | `/api/workspace/file` | src/routes/projects.js |
| POST | `/api/workspace/file` | src/routes/projects.js |
| GET | `/api/workspace/git-status` | src/routes/projects.js |
| GET | `/api/workspace/ls` | src/routes/projects.js |
| PUT | `/api/workspace/rename` | src/routes/projects.js |
| GET | `/api/workspace/tree` | src/routes/projects.js |
