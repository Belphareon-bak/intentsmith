# Notifications System

> **v93** | 6 channels | ~2,000 lines | Trust-aware delivery with auto-mute

## Architecture

```
Domain Events (lifecycle, worker)
  ↓
NotificationEmitter — bridge events to pipeline
  ↓
NotificationPipeline — policy → route/buffer/drop
  ├─ NotificationPolicy — mute/cooldown/escalation/trust decisions
  ├─ NotificationRouter — channel registry + delivery
  │   ├─ EmailChannel (nodemailer SMTP)
  │   ├─ TelegramChannel (Bot API + feedback keyboard)
  │   ├─ PushChannel / NtfyChannel (ntfy.sh)
  │   ├─ WebhookChannel (HMAC-signed HTTP POST)
  │   └─ DesktopChannel (Electron Notification API via WS)
  └─ DigestAggregator — buffer for scheduled delivery
  ↓
TrustTracker — user feedback → auto-mute/degrade
```

## Channels

| Channel | Transport | Config Env Vars |
|---------|-----------|-----------------|
| email | nodemailer SMTP | `C3_SMTP_HOST`, `C3_SMTP_PORT`, `C3_SMTP_USER`, `C3_SMTP_PASS`, `C3_SMTP_FROM` |
| telegram | Bot API (native fetch) | `C3_TELEGRAM_BOT_TOKEN`, `C3_TELEGRAM_CHAT_ID` |
| push | ntfy.sh HTTP | `C3_NTFY_SERVER`, `C3_NTFY_TOPIC`, `C3_NTFY_TOKEN` |
| webhook | HMAC-signed HTTP POST | `C3_WEBHOOK_URL`, `C3_WEBHOOK_SECRET` |
| desktop | WS → Electron Notification | `C3_DESKTOP_NOTIFICATIONS` |
| in_app | Database only | — |

## Delivery Pipeline

```
Event arrives
  ↓
NotificationEmitter checks config (cached, TTL=10s)
  ↓
Pipeline.process(ctx, policyConfig)
  ↓
Policy.evaluate(ctx):
  ├─ Muted? → DROP (unless critical priority)
  ├─ Cooldown active? → DROP
  ├─ Body unchanged? → DROP (if suppress.if_unchanged)
  ├─ Trust override? → DIGEST or DROP
  ├─ Escalation check → bump priority if repeat_threshold met
  └─ Mode decision → IMMEDIATE / DIGEST / AUTO
  ↓
  IMMEDIATE → Router.send() → Channel.send()
  DIGEST    → DigestAggregator.add() → flush on schedule
  DROP      → log only
  ↓
Log to notification_log_v57
```

## Notification Context Shape

```javascript
{
  agent_id: string,              // 'lifecycle' | agent ID
  channel: string,               // target channel
  recipient: string,             // email / chat_id / topic / URL
  title: string,                 // subject line
  body: string,                  // message body
  priority: 'low'|'normal'|'high'|'critical',
  created_at: number,            // Date.now()
  reason: {
    trigger: string,             // 'milestone_pass', 'milestone_fail', ...
    source_type: string,         // 'lifecycle' | 'worker'
  },
  data: any                      // extra metadata
}
```

## Agent Notification Policy

Per-agent configuration (in agent definition):

```javascript
{
  notification_policy: {
    mode: 'immediate' | 'digest' | 'auto',
    digest_schedule: '0 18 * * *',      // cron expression
    suppress: {
      if_unchanged: true,               // skip if body hash matches
      cooldown_minutes: 30              // min time between notifications
    },
    escalation: {
      repeat_threshold: 3,              // escalate after N repeats
      window_minutes: 60,              // time window for counting
      escalate_to: 'high'             // target priority
    }
  }
}
```

## Trust System

User feedback (thumbs up/down) drives automatic channel degradation and muting.

### Thresholds

| Metric | Threshold | Action |
|--------|-----------|--------|
| useful ratio < 10% | `autoMuteThreshold` | Auto-mute for 7 days |
| useful ratio < 30% | `degradeToDigestThreshold` | Degrade to digest mode |
| no notifications in 14d | `silenceWarningDays` | Flag for review |
| min feedback required | `minFeedbackCount: 5` | No action below 5 feedback items |

### Feedback Flow

```
User 👍/👎 (Telegram keyboard or REST API)
  ↓
TrustTracker.recordFeedback(notificationId, isUseful)
  ↓
Calculate 30-day rolling metrics
  ↓
Evaluate auto-degradation:
  useful < 10% → auto-mute 7 days + send explanation
  useful < 30% → degrade to digest + send explanation
  recovered    → send recovery notification
```

**Invariants:**
- Auto-mute is NEVER silent — always sends explanation notification
- User can manually un-mute via `POST /api/trust/:agentId/unmute`
- Critical priority bypasses mute state

## Lifecycle Integration

Triggered from `src/planner/lifecycle-build.js`:

| Event | Description |
|-------|-------------|
| `milestone_pass` | Individual milestone PASSED |
| `milestone_fail` | Milestone BLOCKED (retries exhausted) |
| `milestone_blocked` | All pending milestones dependency-blocked |
| `lifecycle_complete` | All milestones done |

## Database Tables

### notification_log_v57

| Column | Type | Description |
|--------|------|-------------|
| agent_id | TEXT | Source agent |
| channel | TEXT | Delivery channel |
| recipient | TEXT | Target |
| title | TEXT | Subject |
| priority | TEXT | low/normal/high/critical |
| delivered | INTEGER | 0/1 |
| policy_decision | TEXT | immediate/digest/drop |
| error | TEXT | Error message |
| context_json | TEXT | Full context |
| useful | INTEGER | User feedback (NULL/0/1) |
| feedback_at | TEXT | When feedback given |

### notification_state_v57

| Column | Type | Description |
|--------|------|-------------|
| agent_id | TEXT PK | |
| muted_until | TEXT | ISO timestamp |
| last_sent_at | TEXT | ISO timestamp |
| escalation_counter | INTEGER | Repeat count |
| auto_mute_reason | TEXT | Why auto-muted |

### notification_digest_buffer_v57

Buffered notifications for scheduled digest delivery.

### notification_trust_actions_v57

Audit trail for auto-mute/degrade/recover/unmute actions.

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/notifications/config` | Get SMTP/email config (password masked) |
| `POST` | `/api/notifications/config` | Update config; invalidate cache |
| `GET` | `/api/notifications/channels` | List channels + configured status |
| `POST` | `/api/notifications/test` | Send test notification |
| `POST` | `/api/notifications/verify` | Verify channel connectivity |
| `GET` | `/api/notifications/log` | Recent delivery log (max 200) |
| `POST` | `/api/notifications/send` | Send manual notification |
| `POST` | `/api/notifications/:id/feedback` | Record user feedback |
| `GET` | `/api/trust/metrics` | All agent trust metrics |
| `GET` | `/api/trust/metrics/:agentId` | Single agent metrics |
| `POST` | `/api/trust/:agentId/unmute` | Manual unmute |
| `POST` | `/api/trust/:agentId/reset` | Reset feedback (dev) |

## Files

| File | Lines | Responsibility |
|------|-------|----------------|
| index.js | — | Factory functions + exports |
| service.js | — | NotificationRouter (channel registry + delivery) |
| pipeline.js | — | NotificationPipeline (policy + router + digest) |
| policy.js | — | NotificationPolicy (mute/escalation/suppress) |
| digest.js | — | DigestAggregator (buffer + flush) |
| emitter.js | — | NotificationEmitter (lifecycle/worker → pipeline) |
| trust.js | — | TrustTracker (feedback → auto-mute/degrade) |
| feedback.js | — | FeedbackHandler (Telegram keyboard + API) |
| trust-api.js | — | REST routes for trust metrics |
| db.js | — | Schema init (4 tables + indices) |
| channels/email.js | — | SMTP via nodemailer |
| channels/telegram.js | — | Telegram Bot API |
| channels/push.js | — | ntfy.sh HTTP |
| channels/ntfy.js | — | ntfy alternative implementation |
| channels/webhook.js | — | HMAC-signed HTTP POST (3x retry) |
| channels/desktop.js | — | Electron Notification via WS |

## Security

- Webhook: HMAC-SHA256 signature (`X-C3-Signature` header)
- Email: Password masked in API responses
- Database: Prepared statements (parameterized SQL)
- Rate limiting: Cooldown + escalation counter prevent spam
- Audit trail: All trust actions logged to `notification_trust_actions_v57`
