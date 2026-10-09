# Revize importů nového IDE backendu

WP-IDE-BACKEND-20261009. Implementační self-review; nezávislá revize a přejímka
zůstávají otevřené. Rebaseline je samostatný commit podle CONTRACT §11.

Před změnou: 1517 import hran. Nový stav: 1554, přidáno 42, odstraněno 5;
počet cyklů 3 a souborů v cyklech 28 se nezvyšuje. Seznam níže je výstup
ratchetu; rebaseline nesmí přijmout jinou hranu.

Důvody hran: routes skládají lokální auth, DB nastavení a funkční služby;
gateway a rozpočty chatu čtou jeden role connector; agent extensions používají
DB store bez spustitelného uploadu; SSH resolver zůstává uvnitř SCM;
notifikační síť jde výhradně přes deklarovanou outbound capability.
Odstraněné přímé čtení model-ctx nahrazuje gateway role connector, který
zachovává původní model-ctx strop a zapojuje menší nastavení konkrétní role.
Žádná nová hrana sama neuděluje oprávnění ani obchází approval.

Vývojová evidence: nové HTTP/restart, context/output wire, stale/rejected
identity, SSH rotation, Git read-only a M3/outbound negativní testy.
Výsledná fingerprint baseline připne přesný source revision/tree;
nejde o release gate ani nezávislou bezpečnostní certifikaci.

```text
ADDED src/chat/cre-decision.js -> src/llm/gateway.js
ADDED src/chat/file-save-plan.js -> src/llm/gateway.js
ADDED src/chat/handlers/decisions.js -> src/llm/gateway.js
ADDED src/chat/handlers/expertise.js -> src/llm/gateway.js
ADDED src/chat/handlers/specialist.js -> src/llm/gateway.js
ADDED src/extensions/agent-extension-service.js -> src/db/ide-store.js
ADDED src/llm/gateway.js -> src/llm/role-runtime-settings.js
ADDED src/llm/role-runtime-settings.js -> src/db/ide-store.js
ADDED src/llm/role-runtime-settings.js -> src/llm/model-ctx.js
ADDED src/llm/role-runtime-settings.js -> src/llm/model-runtime-profile.js
ADDED src/llm/role-runtime-settings.js -> src/upgrade/model-identity.js
ADDED src/routes/agents.js -> src/security/global-auth-policy.js
ADDED src/routes/ide-management.js -> src/db/ide-store.js
ADDED src/routes/ide-management.js -> src/llm/model-ctx.js
ADDED src/routes/ide-management.js -> src/llm/model-runtime-profile.js
ADDED src/routes/ide-management.js -> src/llm/role-runtime-settings.js
ADDED src/routes/ide-management.js -> src/network/outbound-policy.js
ADDED src/routes/ide-management.js -> src/scm/git-runner.js
ADDED src/routes/ide-management.js -> src/security/global-auth-policy.js
ADDED src/routes/ide-management.js -> src/system/ide-accounts.js
ADDED src/routes/ide-management.js -> src/system/ide-backups.js
ADDED src/routes/ide-management.js -> src/system/ide-external-signals.js
ADDED src/routes/ide-management.js -> src/system/ide-hunt-scheduler.js
ADDED src/routes/ide-management.js -> src/system/ide-storage.js
ADDED src/routes/system.js -> src/db/ide-store.js
ADDED src/routes/system.js -> src/system/ide-external-signals.js
ADDED src/scm/service.js -> src/scm/ssh-profile.js
ADDED src/scm/ssh-profile.js -> src/scm/git-runner.js
ADDED src/server.js -> src/db/ide-store.js
ADDED src/server.js -> src/routes/ide-management.js
ADDED src/server.js -> src/system/hunt-control.js
ADDED src/server.js -> src/system/ide-hunt-scheduler.js
ADDED src/system/ide-accounts.js -> src/db/ide-store.js
ADDED src/system/ide-backups.js -> src/core/db-backup.js
ADDED src/system/ide-backups.js -> src/db/data-retention.js
ADDED src/system/ide-backups.js -> src/db/ide-store.js
ADDED src/system/ide-external-signals.js -> src/db/ide-store.js
ADDED src/system/ide-external-signals.js -> src/llm/role-runtime-settings.js
ADDED src/system/ide-external-signals.js -> src/upgrade/model-identity.js
ADDED src/system/ide-hunt-scheduler.js -> src/db/ide-store.js
ADDED src/system/ide-hunt-scheduler.js -> src/llm/role-runtime-settings.js
ADDED src/system/ide-storage.js -> src/db/ide-store.js
REMOVED src/chat/file-save-plan.js -> src/llm/model-ctx.js
REMOVED src/chat/handlers/decisions.js -> src/llm/model-ctx.js
REMOVED src/chat/handlers/expertise.js -> src/llm/model-ctx.js
REMOVED src/chat/handlers/specialist.js -> src/llm/model-ctx.js
REMOVED src/chat/handlers/utils/file-explain.js -> src/llm/model-ctx.js
```
