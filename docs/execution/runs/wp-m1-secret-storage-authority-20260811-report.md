# WP-M1 secret-storage authority — Review A evidence

integrationRef: integration/m1-consolidated-20260810
baseRevision: a06a3abeceb022797e122a88cc96c96af5bce878
subjectHead: 27dd323e687a070ccb7001cbb65d634390a93c89
reviewA.verdict: PASS
reviewRange: a06a3abeceb022797e122a88cc96c96af5bce878..27dd323e687a070ccb7001cbb65d634390a93c89
setupP0Revision: 3bb35bbb32063dd058ab35872668d645fe9ff106
setupGovernanceMergeRevision: 3dc5ae6db1119f10ebc494f31d5aedd13ceb04b7

## Rozsah

WP026 sjednocuje notification credentials do jediné immutable startup autority
nad přesně 12 canonical environment klíči a odstraňuje ambientní runtime readery
i write settery těchto 12 owned credentials. Zachovává explicitní external
manual/AgentRunner delivery cesty a retiruje automatický `NotificationEmitter`
lifecycle/worker email bridge.
Status API je value-free, config POST je pre-parse `410` a Setup P0 chrání
canonical root `.env` strict auth i bounded no-follow writerem.

Source obsahuje offline census/plan/apply CLI, exact DB/Setup/env scrub
primitives a digest-bound Architect receipt applier. Přítomnost těchto částí
není tvrzením, že byla migrována operátorská data.

## Provenance a immutable subject

Promovaný governance base je
`a06a3abeceb022797e122a88cc96c96af5bce878`. Setup P0 commit
`3bb35bbb32063dd058ab35872668d645fe9ff106` byl do governance linie začleněn
normálním merge commitem `3dc5ae6db1119f10ebc494f31d5aedd13ceb04b7`;
jeho původní SHA zůstal ancestor. Review range od governance base k immutable
subjectu obsahuje přesně 34 povolených non-report cest a žádnou chráněnou
governance, registry, package nebo schema změnu.

Předchozí source kandidáty a jejich fail-fast či Review A odmítnutí jsou
pravdivě chronologicky zachované ve Findingu 011. Poslední remediation proti
odmítnutému `0f18136b6c3b0f2769db0388ce85c33bf57774f0` mění pouze
`docs/NOTIFICATIONS.md`, `docs/CHANGELOG.md` a Finding 011: dokumentace nyní
rozlišuje přítomnou C3 implementaci od neprovedeného operátorského migration
toku a od samostatné review/promotion evidence.

## Nezávislé Review A

Nezávislý read-only reviewer ověřil přesnou ancestry, clean/upstream stav,
34/34 allowlist, absenci tohoto reportu v subjectu, chráněné cesty a skutečný
runtime call graph. Canonical 12-key authority zachovává own-process precedence
včetně prázdné hodnoty; root-file fallback je exact, no-follow a startup-only.
Server i worker entrypoint používají stejný snapshot. Čtyři authority-backed
outbound kanály `email`, `telegram`, `push` a `webhook` skončí při chybějícím
credential/destination před network/transporter efektem; `desktop` zůstává
lokální a WP027 default-off. Webhook signer zůstává v souladu s WP028.

Setup effectful POSTy zůstávají za strict admin-token guardem a complete retry
odmítá durable completed state před zápisem. Notification config GET vrací jen
exact `{configured,source}` mapu a POST končí před parse. Offline CLI vyžaduje
explicitní absolute paths, kompletní digest-bound decisions, quiescence,
verified canonical/export readback a staged roll-forward; receipt applier
nepřenáší raw localStorage přes síť ani nemaže unknown data.

Reviewer behavior programy neopakoval. Ověřil jejich writer evidence na přesném
commitnutém a pushnutém subjectu, statické source hrany, syntax změněných JS,
range `diff-check` a finální clean stav.

## Focused evidence

| Kontrola | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-settings-notification-authority.test.js` | 4 passed, 0 failed | 0 |
| `node tests/m1-notification-credential-scope.test.js` | 2 passed, 0 failed | 0 |
| `node tests/m1-studio-client.test.js` | 128 passed, 0 failed | 0 |
| `node scripts/validate-test-registry.js --json` | 382 programů, 8 exclusions; fingerprint `571ae1a90a4246c7037d56fe5fb786beb4b5c4aae3e61f163d5b6ffe14341d71` | 0 |
| `node --check` nad změněnými JS soubory | bez chyb | 0 |
| range `git diff --check` a finální porcelain | bez chyb, clean | 0 |

Čtyřprogramový writer gate byl po poslední docs remediation spuštěn jednou nad
přesným immutable subjectem. Žádný jeho proces ani preserved test artifact po
úspěšném běhu nezůstal aktivní.

## Hranice tvrzení

Nebyl spuštěn žádný skutečný operátorský census, decisions plan, apply,
transfer, export, purge, scrub ani process-alias restart. Izolované testovací
fixtures nepoužily reálná uživatelská data. `tests/e2e/12-notifications.e2e.js`
zůstává `NOT RUN / BLOCKED`; Electron/build, GPU, Ollama, externí síť, skutečný
outbound, E2E13 Security a full-product test rovněž nebyly spuštěné.

WP026 PASS není release ani Gate 1 PASS. Finding 011 zůstává `OPEN`, Gate 1
zůstává `BLOCKED` a navazuje WP029. Standalone `chats/`, notification delivery
residualy a historická SQLite/WAL/backup data zůstávají explicitně mimo
privacy-erasure claim a čekají na přijaté navazující work packages včetně
M5-DATA.
candidateHead: f44350798d6f2a0c9d8fb00c19f436dfd4d173d9
reviewB.verdict: PASS
