# Backend capability inventory

Status: generated, review input for MM2–MM4

This inventory is exhaustive for statically declared `/api` and `/m1` route-map
keys under `src/routes/**` and `src/mobile/handlers.js`. Dynamic behavior and
WebSocket message kinds require separate contract inventories.

- Routes: 248
- Existing mobile v1 routes: 24
- Legacy core routes: 224
- Reads / mutations: 113 / 135
- Routes mapping to the nine-domain RemoteCorePort candidate: 84
- Route digest: `a8b901d143f2f680d68e321d49e13ed99ecf86e32bdb1fb050614d491997293f`

## Domain counts

| Domain | Routes |
|---|---:|
| agents | 19 |
| approvals | 4 |
| autonomy | 4 |
| conversations | 23 |
| marketplace | 7 |
| media | 11 |
| notifications | 12 |
| operations | 3 |
| platform | 18 |
| projects | 31 |
| quality | 5 |
| security | 7 |
| settings | 12 |
| skills | 7 |
| specialists | 35 |
| storage | 1 |
| stored-information | 4 |
| system | 45 |

## Interpretation

- `legacy-core` means the capability exists on the broad desktop/core listener;
  it is not authority to expose it to a paired device.
- `mobile-v1` is the current exact allow-list, not a wildcard.
- `never-expose-admin` covers security-token and secret administration.
- `governed-effect-only` means a future mobile action must cross an effect and
  approval authority rather than proxy the workspace route.
- The JSON sibling is the line-by-line review artifact and is checked in tests.

## Complete route list

| Route | Domain | Exposure | RemoteCorePort feature | Mobile policy |
|---|---|---|---|---|
| `GET /api/agents` | agents | legacy-core | workers.read | mobile-mirror-candidate |
| `POST /api/agents` | agents | legacy-core | — | mobile-mirror-candidate |
| `DELETE /api/agents/:id` | agents | legacy-core | — | mobile-mirror-candidate |
| `GET /api/agents/:id` | agents | legacy-core | workers.read | mobile-mirror-candidate |
| `PUT /api/agents/:id` | agents | legacy-core | — | mobile-mirror-candidate |
| `POST /api/agents/:id/disable` | agents | legacy-core | workers.toggle | mobile-mirror-candidate |
| `POST /api/agents/:id/enable` | agents | legacy-core | workers.toggle | mobile-mirror-candidate |
| `POST /api/agents/:id/run` | agents | legacy-core | — | mobile-mirror-candidate |
| `GET /api/agents/:id/runs` | agents | legacy-core | workers.read | mobile-mirror-candidate |
| `POST /api/agents/build` | agents | legacy-core | — | mobile-mirror-candidate |
| `POST /api/agents/confirm` | agents | legacy-core | — | mobile-mirror-candidate |
| `POST /api/agents/dry-run` | agents | legacy-core | — | mobile-mirror-candidate |
| `POST /api/agents/refine` | agents | legacy-core | — | mobile-mirror-candidate |
| `GET /api/agents/schema` | agents | legacy-core | workers.read | mobile-mirror-candidate |
| `GET /api/approvals` | approvals | legacy-core | approvals.read | mobile-mirror-candidate |
| `POST /api/approvals/:id/decide` | approvals | legacy-core | approvals.decide | mobile-mirror-candidate |
| `GET /api/artifacts/:filename` | projects | legacy-core | — | mobile-mirror-candidate |
| `POST /api/attachments` | projects | legacy-core | — | mobile-mirror-candidate |
| `GET /api/attachments/:id` | projects | legacy-core | — | mobile-mirror-candidate |
| `GET /api/audit` | platform | legacy-core | — | conditional-or-desktop-only |
| `POST /api/autocomplete` | platform | legacy-core | — | conditional-or-desktop-only |
| `POST /api/autonomy/alerts/:id/acknowledge` | autonomy | legacy-core | — | conditional-or-desktop-only |
| `POST /api/autonomy/approve/:id` | autonomy | legacy-core | — | conditional-or-desktop-only |
| `POST /api/autonomy/reject/:id` | autonomy | legacy-core | — | conditional-or-desktop-only |
| `GET /api/autonomy/status` | autonomy | legacy-core | — | conditional-or-desktop-only |
| `POST /api/context` | platform | legacy-core | — | conditional-or-desktop-only |
| `GET /api/conversations` | conversations | legacy-core | conversations.read | mobile-mirror-candidate |
| `POST /api/conversations` | conversations | legacy-core | conversations.create | mobile-mirror-candidate |
| `DELETE /api/conversations/:id` | conversations | legacy-core | conversations.archive | mobile-mirror-candidate |
| `GET /api/conversations/:id` | conversations | legacy-core | conversations.read | mobile-mirror-candidate |
| `PUT /api/conversations/:id` | conversations | legacy-core | conversations.update | mobile-mirror-candidate |
| `PATCH /api/conversations/:id/archive` | conversations | legacy-core | conversations.archive | mobile-mirror-candidate |
| `POST /api/conversations/:id/assign` | conversations | legacy-core | conversations.create | mobile-mirror-candidate |
| `GET /api/conversations/:id/messages` | conversations | legacy-core | conversations.read | mobile-mirror-candidate |
| `PATCH /api/conversations/:id/restore` | conversations | legacy-core | conversations.archive | mobile-mirror-candidate |
| `DELETE /api/drafts` | conversations | legacy-core | — | mobile-mirror-candidate |
| `GET /api/drafts` | conversations | legacy-core | — | mobile-mirror-candidate |
| `POST /api/drafts` | conversations | legacy-core | — | mobile-mirror-candidate |
| `GET /api/expertise-schema` | platform | legacy-core | — | conditional-or-desktop-only |
| `POST /api/expertise-wizard/test-prompt` | platform | legacy-core | — | conditional-or-desktop-only |
| `GET /api/expertises` | specialists | legacy-core | — | mobile-mirror-candidate |
| `POST /api/expertises` | specialists | legacy-core | — | mobile-mirror-candidate |
| `DELETE /api/expertises/:id` | specialists | legacy-core | — | mobile-mirror-candidate |
| `GET /api/expertises/:id` | specialists | legacy-core | — | mobile-mirror-candidate |
| `PUT /api/expertises/:id` | specialists | legacy-core | — | mobile-mirror-candidate |
| `POST /api/expertises/route` | specialists | legacy-core | — | mobile-mirror-candidate |
| `POST /api/export` | conversations | legacy-core | — | mobile-mirror-candidate |
| `GET /api/features` | settings | legacy-core | — | mobile-mirror-candidate |
| `POST /api/features/:name` | settings | legacy-core | — | mobile-mirror-candidate |
| `POST /api/features/reset` | settings | legacy-core | — | mobile-mirror-candidate |
| `GET /api/feedback` | platform | legacy-core | — | conditional-or-desktop-only |
| `POST /api/feedback` | platform | legacy-core | — | conditional-or-desktop-only |
| `POST /api/feedback/:id/attach` | platform | legacy-core | — | conditional-or-desktop-only |
| `GET /api/health` | platform | legacy-core | — | conditional-or-desktop-only |
| `POST /api/chat` | conversations | legacy-core | conversations.send | mobile-mirror-candidate |
| `GET /api/chat/sessions` | conversations | legacy-core | conversations.read | mobile-mirror-candidate |
| `DELETE /api/chat/sessions/:sessionId` | conversations | legacy-core | conversations.archive | mobile-mirror-candidate |
| `GET /api/chat/sessions/:sessionId` | conversations | legacy-core | conversations.read | mobile-mirror-candidate |
| `GET /api/chat/sessions/stats` | conversations | legacy-core | conversations.read | mobile-mirror-candidate |
| `DELETE /api/chat/specialist` | conversations | legacy-core | conversations.archive | mobile-mirror-candidate |
| `POST /api/chat/specialist` | conversations | legacy-core | conversations.create | mobile-mirror-candidate |
| `POST /api/lifecycle/change/approve` | specialists | legacy-core | — | mobile-mirror-candidate |
| `POST /api/lifecycle/change/propose` | specialists | legacy-core | — | mobile-mirror-candidate |
| `POST /api/lifecycle/change/reject` | specialists | legacy-core | — | mobile-mirror-candidate |
| `POST /api/lifecycle/milestone/approve` | specialists | legacy-core | — | mobile-mirror-candidate |
| `POST /api/lifecycle/milestone/blocked` | specialists | legacy-core | — | mobile-mirror-candidate |
| `POST /api/lifecycle/milestone/next` | specialists | legacy-core | — | mobile-mirror-candidate |
| `GET /api/lifecycle/resume` | specialists | legacy-core | — | mobile-mirror-candidate |
| `POST /api/lifecycle/review/acknowledge` | specialists | legacy-core | — | mobile-mirror-candidate |
| `POST /api/lifecycle/roadmap/approve` | specialists | legacy-core | — | mobile-mirror-candidate |
| `POST /api/lifecycle/spec/answer` | specialists | legacy-core | — | mobile-mirror-candidate |
| `POST /api/lifecycle/spec/approve` | specialists | legacy-core | — | mobile-mirror-candidate |
| `POST /api/lifecycle/start` | specialists | legacy-core | — | mobile-mirror-candidate |
| `GET /api/lifecycle/status` | specialists | legacy-core | — | mobile-mirror-candidate |
| `GET /api/logs` | platform | legacy-core | — | conditional-or-desktop-only |
| `GET /api/logs/export` | platform | legacy-core | — | conditional-or-desktop-only |
| `GET /api/marketplace/catalog` | marketplace | legacy-core | — | conditional-or-desktop-only |
| `POST /api/marketplace/catalog/refresh` | marketplace | legacy-core | — | conditional-or-desktop-only |
| `POST /api/marketplace/export/:type/:id` | marketplace | legacy-core | — | conditional-or-desktop-only |
| `POST /api/marketplace/install/:type/:id` | marketplace | legacy-core | — | conditional-or-desktop-only |
| `GET /api/marketplace/installed` | marketplace | legacy-core | — | conditional-or-desktop-only |
| `DELETE /api/marketplace/installed/:type/:id` | marketplace | legacy-core | — | conditional-or-desktop-only |
| `POST /api/marketplace/update/:type/:id` | marketplace | legacy-core | — | conditional-or-desktop-only |
| `DELETE /api/media` | media | legacy-core | — | conditional-or-desktop-only |
| `POST /api/media/cancel` | media | legacy-core | — | conditional-or-desktop-only |
| `PUT /api/media/favorite` | media | legacy-core | — | conditional-or-desktop-only |
| `POST /api/media/generate` | media | legacy-core | — | conditional-or-desktop-only |
| `GET /api/media/health` | media | legacy-core | — | conditional-or-desktop-only |
| `GET /api/media/history` | media | legacy-core | — | conditional-or-desktop-only |
| `GET /api/media/models` | media | legacy-core | — | conditional-or-desktop-only |
| `POST /api/media/models/refresh` | media | legacy-core | — | conditional-or-desktop-only |
| `GET /api/media/output` | media | legacy-core | — | conditional-or-desktop-only |
| `GET /api/media/status` | media | legacy-core | — | conditional-or-desktop-only |
| `GET /api/media/vram` | media | legacy-core | — | conditional-or-desktop-only |
| `GET /api/memory` | stored-information | legacy-core | storedInformation.read | mobile-mirror-candidate |
| `POST /api/memory` | stored-information | legacy-core | storedInformation.write | mobile-mirror-candidate |
| `GET /api/merge-preview` | specialists | legacy-core | — | mobile-mirror-candidate |
| `POST /api/merge-preview` | specialists | legacy-core | — | mobile-mirror-candidate |
| `GET /api/notifications` | notifications | legacy-core | notifications.read | mobile-mirror-candidate |
| `POST /api/notifications/:id/read` | notifications | legacy-core | notifications.ack | mobile-mirror-candidate |
| `GET /api/notifications/config` | notifications | legacy-core | notifications.read | mobile-mirror-candidate |
| `POST /api/notifications/config` | notifications | legacy-core | notifications.ack | mobile-mirror-candidate |
| `GET /api/notifications/channels` | notifications | legacy-core | notifications.read | mobile-mirror-candidate |
| `GET /api/notifications/log` | notifications | legacy-core | notifications.read | mobile-mirror-candidate |
| `POST /api/notifications/read-all` | notifications | legacy-core | notifications.ack | mobile-mirror-candidate |
| `POST /api/notifications/send` | notifications | legacy-core | notifications.ack | mobile-mirror-candidate |
| `POST /api/notifications/test` | notifications | legacy-core | notifications.ack | mobile-mirror-candidate |
| `POST /api/notifications/verify` | notifications | legacy-core | notifications.ack | mobile-mirror-candidate |
| `GET /api/projects` | projects | legacy-core | projects.read | mobile-mirror-candidate |
| `POST /api/projects` | projects | legacy-core | projects.create | mobile-mirror-candidate |
| `DELETE /api/projects/:id` | projects | legacy-core | projects.archive | mobile-mirror-candidate |
| `GET /api/projects/:id` | projects | legacy-core | projects.read | mobile-mirror-candidate |
| `PUT /api/projects/:id` | projects | legacy-core | projects.update | mobile-mirror-candidate |
| `PATCH /api/projects/:id/archive` | projects | legacy-core | projects.archive | mobile-mirror-candidate |
| `GET /api/projects/:id/conversations` | projects | legacy-core | projects.read | mobile-mirror-candidate |
| `GET /api/projects/:id/lifecycle` | projects | legacy-core | projects.read | mobile-mirror-candidate |
| `POST /api/projects/:id/lifecycle/bind` | projects | legacy-core | projects.create | mobile-mirror-candidate |
| `GET /api/projects/:id/memory` | projects | legacy-core | projects.read | mobile-mirror-candidate |
| `PUT /api/projects/:id/memory` | projects | legacy-core | projects.update | mobile-mirror-candidate |
| `DELETE /api/projects/:id/memory/:key` | projects | legacy-core | projects.archive | mobile-mirror-candidate |
| `POST /api/projects/:id/readme` | projects | legacy-core | projects.create | mobile-mirror-candidate |
| `PATCH /api/projects/:id/restore` | projects | legacy-core | projects.archive | mobile-mirror-candidate |
| `GET /api/projects/:id/roadmap` | projects | legacy-core | projects.read | mobile-mirror-candidate |
| `GET /api/projects/defaults` | projects | legacy-core | projects.read | mobile-mirror-candidate |
| `POST /api/projects/lifecycle/start` | projects | legacy-core | projects.create | mobile-mirror-candidate |
| `POST /api/projects/open-folder` | projects | legacy-core | projects.create | mobile-mirror-candidate |
| `GET /api/quality/distribution` | quality | legacy-core | — | conditional-or-desktop-only |
| `GET /api/quality/project/:id` | quality | legacy-core | — | conditional-or-desktop-only |
| `GET /api/quality/report` | quality | legacy-core | — | conditional-or-desktop-only |
| `GET /api/quality/summary` | quality | legacy-core | — | conditional-or-desktop-only |
| `GET /api/quality/volatility/:id` | quality | legacy-core | — | conditional-or-desktop-only |
| `POST /api/reset` | platform | legacy-core | — | conditional-or-desktop-only |
| `GET /api/security/audit` | security | legacy-core | — | never-expose-admin |
| `GET /api/security/sessions` | security | legacy-core | — | never-expose-admin |
| `GET /api/security/tokens` | security | legacy-core | — | never-expose-admin |
| `POST /api/security/tokens` | security | legacy-core | — | never-expose-admin |
| `DELETE /api/security/tokens/:id` | security | legacy-core | — | never-expose-admin |
| `GET /api/security/webhook-secret` | security | legacy-core | — | never-expose-admin |
| `POST /api/security/webhook-secret` | security | legacy-core | — | never-expose-admin |
| `GET /api/settings` | settings | legacy-core | settings.read | mobile-mirror-candidate |
| `POST /api/settings` | settings | legacy-core | settings.write | mobile-mirror-candidate |
| `GET /api/settings/backup` | settings | legacy-core | settings.read | mobile-mirror-candidate |
| `POST /api/settings/import` | settings | legacy-core | settings.write | mobile-mirror-candidate |
| `POST /api/settings/reset` | settings | legacy-core | settings.write | mobile-mirror-candidate |
| `GET /api/settings/v2` | settings | legacy-core | settings.read | mobile-mirror-candidate |
| `PUT /api/settings/v2` | settings | legacy-core | settings.write | mobile-mirror-candidate |
| `GET /api/scheduler/status` | platform | legacy-core | — | conditional-or-desktop-only |
| `GET /api/skills` | skills | legacy-core | — | conditional-or-desktop-only |
| `GET /api/skills/:id` | skills | legacy-core | — | conditional-or-desktop-only |
| `GET /api/skills/executions/:id` | skills | legacy-core | — | conditional-or-desktop-only |
| `POST /api/skills/executions/:id/cancel` | skills | legacy-core | — | conditional-or-desktop-only |
| `POST /api/skills/executions/:id/confirm` | skills | legacy-core | — | conditional-or-desktop-only |
| `POST /api/skills/executions/:id/resume` | skills | legacy-core | — | conditional-or-desktop-only |
| `POST /api/skills/reload` | skills | legacy-core | — | conditional-or-desktop-only |
| `POST /api/sources/inspect` | agents | legacy-core | — | mobile-mirror-candidate |
| `POST /api/sources/validate-condition` | agents | legacy-core | — | mobile-mirror-candidate |
| `POST /api/sources/validate-field` | agents | legacy-core | — | mobile-mirror-candidate |
| `GET /api/specialists` | specialists | legacy-core | specialists.read | mobile-mirror-candidate |
| `POST /api/specialists` | specialists | legacy-core | — | mobile-mirror-candidate |
| `GET /api/specialists/:id` | specialists | legacy-core | specialists.read | mobile-mirror-candidate |
| `POST /api/specialists/:id/disable` | specialists | legacy-core | specialists.toggle | mobile-mirror-candidate |
| `POST /api/specialists/:id/enable` | specialists | legacy-core | specialists.toggle | mobile-mirror-candidate |
| `GET /api/specialists/:id/expertises` | specialists | legacy-core | specialists.read | mobile-mirror-candidate |
| `POST /api/specialists/:id/expertises` | specialists | legacy-core | — | mobile-mirror-candidate |
| `DELETE /api/specialists/:id/expertises/:expertiseId` | specialists | legacy-core | — | mobile-mirror-candidate |
| `PATCH /api/specialists/:id/expertises/:expertiseId` | specialists | legacy-core | — | mobile-mirror-candidate |
| `GET /api/specialists/:id/integrity` | specialists | legacy-core | specialists.read | mobile-mirror-candidate |
| `POST /api/specialists/:id/update` | specialists | legacy-core | — | mobile-mirror-candidate |
| `POST /api/specialists/discover` | specialists | legacy-core | — | mobile-mirror-candidate |
| `GET /api/specialists/telemetry` | specialists | legacy-core | specialists.read | mobile-mirror-candidate |
| `GET /api/storage/info` | storage | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/backup` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/backups` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/catalog` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/clean` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/drain` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/governor/check` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/governor/proposals` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/governor/proposals/:id/approve` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/governor/proposals/:id/dismiss` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/governor/report` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/governor/status` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/gpu` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/gpu/refresh` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/info` | system | legacy-core | — | conditional-or-desktop-only |
| `DELETE /api/system/models` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/models` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/models/compatibility` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/models/check` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/models/info` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/models/overview` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/models/pull` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/models/settings` | system | legacy-core | — | conditional-or-desktop-only |
| `PUT /api/system/models/settings` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/models/universe` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/models/universe/:name` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/models/validate` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/models/validate` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/models/validate-all` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/models/validation-scores` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/proposals` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/proposals/:id/dismiss` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/shutdown-backup` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/storage` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/storage/settings` | system | legacy-core | — | conditional-or-desktop-only |
| `PUT /api/system/storage/settings` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/upgrades` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/upgrades/apply` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/upgrades/bindings` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/upgrades/discovered` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/upgrades/check` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/upgrades/recommendations` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/upgrades/recovery/rollback` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/upgrades/rollback` | system | legacy-core | — | conditional-or-desktop-only |
| `GET /api/system/upgrades/scoring` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/system/vacuum` | system | legacy-core | — | conditional-or-desktop-only |
| `POST /api/workspace/directory` | projects | legacy-core | — | governed-effect-only |
| `DELETE /api/workspace/file` | projects | legacy-core | — | governed-effect-only |
| `GET /api/workspace/file` | projects | legacy-core | — | governed-effect-only |
| `POST /api/workspace/file` | projects | legacy-core | — | governed-effect-only |
| `GET /api/workspace/git-status` | projects | legacy-core | — | governed-effect-only |
| `GET /api/workspace/ls` | projects | legacy-core | — | governed-effect-only |
| `PUT /api/workspace/rename` | projects | legacy-core | — | governed-effect-only |
| `GET /api/workspace/tree` | projects | legacy-core | — | governed-effect-only |
| `GET /m1/approvals` | approvals | mobile-v1 | approvals.read | mobile-mirror-candidate |
| `POST /m1/approvals/:id/decide` | approvals | mobile-v1 | approvals.decide | mobile-mirror-candidate |
| `GET /m1/capabilities` | platform | mobile-v1 | — | conditional-or-desktop-only |
| `GET /m1/conversations` | conversations | mobile-v1 | conversations.read | mobile-mirror-candidate |
| `GET /m1/conversations/:id` | conversations | mobile-v1 | conversations.read | mobile-mirror-candidate |
| `GET /m1/devices` | platform | mobile-v1 | — | conditional-or-desktop-only |
| `POST /m1/devices/:id/revoke` | platform | mobile-v1 | — | conditional-or-desktop-only |
| `GET /m1/health` | platform | mobile-v1 | — | conditional-or-desktop-only |
| `POST /m1/chat` | conversations | mobile-v1 | conversations.send | mobile-mirror-candidate |
| `GET /m1/memory` | stored-information | mobile-v1 | storedInformation.read | mobile-mirror-candidate |
| `POST /m1/memory` | stored-information | mobile-v1 | storedInformation.write | mobile-mirror-candidate |
| `GET /m1/notifications` | notifications | mobile-v1 | notifications.read | mobile-mirror-candidate |
| `POST /m1/notifications/ack` | notifications | mobile-v1 | notifications.ack | mobile-mirror-candidate |
| `GET /m1/operations` | operations | mobile-v1 | — | mobile-mirror-candidate |
| `GET /m1/operations/:operationId` | operations | mobile-v1 | — | mobile-mirror-candidate |
| `POST /m1/operations/:operationId/abandon` | operations | mobile-v1 | — | mobile-mirror-candidate |
| `POST /m1/pair/claim` | platform | mobile-v1 | — | conditional-or-desktop-only |
| `GET /m1/projects` | projects | mobile-v1 | projects.read | mobile-mirror-candidate |
| `GET /m1/projects/:id` | projects | mobile-v1 | projects.read | mobile-mirror-candidate |
| `GET /m1/settings` | settings | mobile-v1 | settings.read | mobile-mirror-candidate |
| `PUT /m1/settings` | settings | mobile-v1 | settings.write | mobile-mirror-candidate |
| `GET /m1/specialists` | specialists | mobile-v1 | specialists.read | mobile-mirror-candidate |
| `GET /m1/workers` | agents | mobile-v1 | workers.read | mobile-mirror-candidate |
| `PUT /m1/workers/:id/enabled` | agents | mobile-v1 | workers.toggle | mobile-mirror-candidate |
