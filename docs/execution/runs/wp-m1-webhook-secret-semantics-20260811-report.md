# WP-M1 webhook secret semantics — Review A evidence

integrationRef: integration/m1-consolidated-20260810
baseRevision: ce7bc7f1c1e465cf2b7916655bdb0fa04ebf47ea
subjectHead: 6733cccb9048695401b582ab2fea2ff50756b501
reviewA.verdict: PASS

## Rozsah

WP028 převádí webhook HMAC secret na jedinou environment-owned startup
autoritu. Exact project-root `.env` se čte nezávisle na `cwd`, pre-load own
process hodnota má přesnou prioritu a jeden opaque frozen capability poskytuje
status i podpis produkčnímu serveru a worker entrypointu. WP nepřenáší,
nescrubuje ani nemaže historická data a nevytváří webhook support nebo delivery
claim.

## Nezávislé Review A

Review ověřilo exact jednocestný subject nad aktivačním base, čistý upstream
stav a přesně 14 allowlisted cest. Root reader kontroluje canonical root,
regular owner-owned exact-mode-0600 soubor, no-follow/nonblocking fd, stabilní
identity a bounded read před DB, listenerem nebo notification konstrukcí.
Process source vyhrává i jako own prázdná hodnota; jinak je source vždy
`ROOT_ENV_FILE`. Root-file webhook secret se nepropaguje do `process.env`.

Authority je frozen, brandovaná, null-prototype, neenumerovatelná a drží raw
secret pouze v closure. Security GET i default `WebhookChannel` používají
stejný startup snapshot; channel nemá raw ani ambientní secret fallback a při
unconfigured stavu skončí před `fetch`. Authenticated POST končí před parse,
DB, RNG i runtime efektem exact `410 CREDENTIAL_SOURCE_READ_ONLY`.

Studio Security povrch je GET-only, validuje exact dvouklíčový status a nemá
masked fragment, regenerate control ani POST. Legacy DB secret zůstává byteově
zachovaný a runtime jej ignoruje. Nevznikla nová interní `src/**` import hrana;
historická Security-to-repository writer hrana byla odstraněna.

## Focused evidence

| Kontrola | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-settings-notification-authority.test.js` | 4 passed, 0 failed | 0 |
| `node tests/m1-notification-credential-scope.test.js` | 2 passed, 0 failed | 0 |
| `node tests/m1-studio-client.test.js` | 128 passed, 0 failed | 0 |
| `node scripts/validate-test-registry.js --json` | 382 programů, 8 exclusions; fingerprint `571ae1a90a4246c7037d56fe5fb786beb4b5c4aae3e61f163d5b6ffe14341d71` | 0 |
| `node --check` nad 12 změněnými JS soubory | bez chyb | 0 |
| range `git diff --check` a finální porcelain | bez chyb, clean | 0 |

## Hranice tvrzení

Source změna BLOCKED `tests/e2e/13-security.e2e.js` je pouze mechanický contract
update; program nebyl spuštěn a neposkytuje runtime/E2E PASS. WP028 neřeší env
write, verified transfer, DB/localStorage scrub, webhook destination/retry,
standalone `chats/`, reset ani známé notification compatibility residualy.
Finding 011 zůstává `OPEN`, Gate 1 `BLOCKED` a pokračuje pořadí 026 → 029.
Electron/build, GPU, Ollama, outbound webhook, externí síť ani full-product test
nebyly spuštěné.
