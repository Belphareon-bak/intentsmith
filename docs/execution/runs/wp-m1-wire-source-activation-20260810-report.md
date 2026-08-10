# WP-M1 wire source activation — Review A evidence

integrationRef: integration/m1-consolidated-20260810
baseRevision: eb93d59bf8e143ee92149f61a8491fb3e26f9835
subjectHead: d2bb411d1f831525a5d3f6a6d591518196fb1d31
reviewA.verdict: PASS

## Rozsah

Subject aktivuje existující `m1-wire-v1` pouze v produkční server composition.
Nemění Studio, kanonický protokol, M1 adapter ani attachment kontrakty.
Required-offer zachovává legacy klienty bez nabídky M1.

Runtime policy používá přesně osm příloh, 1 MiB pro textovou položku, 5 MiB
pro obrazovou položku, 6 MiB aggregate limit a 12 MiB WebSocket frame limit.
Neplatná konfigurace končí vlastněným signálem `M1_WIRE_CONFIG_INVALID`
synchronně před DB, port-file, project a runtime efektem.

## Nezávislé Review A

Review ověřilo exact rozsah
`eb93d59bf8e143ee92149f61a8491fb3e26f9835..d2bb411d1f831525a5d3f6a6d591518196fb1d31`,
lineární DAG, shodu remote subjectu, čistý pracovní strom, exact čtrnácticestný
allowlist a nulovou změnu pod `c3-ide/**`, v kanonických M1 kontraktech,
`src/ws-bridge/protocol.js`, `src/ws-bridge/ws-server.js` a
`src/ws-bridge/session-adapter.js`.

Registry delta obsahuje právě
`IS-T1-TESTS-M1-WIRE-STARTUP-CONFIG-TEST`; všech 378 předchozích záznamů
zůstalo beze změny.

## Focused evidence

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-wire-startup-config.test.js` | 6 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/ws-bridge.test.js` | 91 passed, 0 failed | 0 |
| `node scripts/validate-test-registry.js --json` | 379 programů, 8 exclusions; fingerprint `9b2d51c4a7170e9ad28edb9454f5d08ed80d72d41c90c714007079bbf2473f13` | 0 |
| syntax checks dotčených JS souborů | valid | 0 |
| `git diff --check eb93d59bf8e143ee92149f61a8491fb3e26f9835..d2bb411d1f831525a5d3f6a6d591518196fb1d31` | bez whitespace chyb | 0 |

## Hranice tvrzení

Neběžel Electron journey, GPU, Ollama ani externí síť. Tento report potvrzuje
pouze source activation a synchronní fail-fast startup boundary. Gate 1 jako
celek zůstává `BLOCKED` do dokončení zbývající evidence.
