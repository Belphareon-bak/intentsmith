# M7 remote health — 2026-08-29

**Stav:** `IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING /
PROVIDER_NOT_ACTIVE / TRANSPORT_ABSENT`

## Vazba

- vstupní evidence HEAD: `acebfc79dd4118984215b9a18a8ff1d32159893a`;
- exact product candidate: `f40c58e06449df04b0443cb327c1b27d9afa1fb0`;
- product tree: `fb71eeeb7c18641584fd65784780e2cd03784caf`;
- implementační commit: `a59bc68a`;
- census rebind commit: `f40c58e0`;
- branch: `codex/m7-mobile-contract-integration-20260829`, bez upstreamu;
- registry: 492 runnable, 398 ACTIVE / 79 BLOCKED / 15 HISTORICAL;
- registry fingerprint:
  `0f7c1dc10985d64278e894f75ca2a6a386e1c521fad12e0d5e6a5d36a5f97827`.

## Implementovaná hranice

`remote-health.read` používá existující candidate control-plane kontrakt a
transport-free adapter. Composition musí dodat explicitní `coreVersion`, clock
a 1–32 přesně pojmenovaných probe funkcí. Adapter nemá přístup k serveru,
listeneru, session, síti ani DB singletonu.

Snapshot je seřazený podle `componentId`, deeply frozen a validovaný stejným
providerem jako ostatní M7 operace. Throw se klasifikuje jako
`unavailable/PROBE_FAILED`, malformed observation jako
`unavailable/PROBE_INVALID`; interní error detail se nevynáší. Neplatný i
nereprezentovatelný čas vrací typed `REMOTE_HEALTH_CLOCK_INVALID` před prvním
probe call.

Control-plane descriptor se dál neinzeruje jako jedna ze sedmi remote
capabilities. Listener, session, pairing, transport a produkční composition
nejsou tímto řezem aktivované.

## Spuštěná evidence

| Hranice | Výsledek |
|---|---|
| remote-health adapter | `5/5 PASS` |
| in-process provider | `11/11 PASS` |
| mobile provider contract | `14/14 PASS` |
| nightly orchestrator self-test | `PASS` |
| module ratchet | `13/13 PASS`; 1 223 hran / 3 cykly / 28 souborů |
| artifact boundary | `158/158 PASS` |
| registry | valid; 492 runnable; exact fingerprint výše |
| souvislý offline+database gate | `332/332 PASS`; žádný non-PASS |

Zelený běh začal `2026-08-29T04:32:31.605Z`, skončil
`2026-08-29T04:36:15.812Z`, vrátil exit 0 a je vázaný na exact source
`f40c58e06449df04b0443cb327c1b27d9afa1fb0`.

Raw artefakty:

- report:
  `.intentsmith-artifacts/m7-remote-health-offline-database-final-20260829/2026-08-29T04-32-31-535Z/report.json`;
- report SHA-256:
  `3b5803d8a05e5abebd495e662f4e0614a53aabff8c85ab4ea88962dc700b817f`;
- inventory SHA-256:
  `90785122b606412877062e17f5e91b33557fde5c7be1c4dd21d32347f29ac90d`;
- inventory fingerprint:
  `8dbff91ce60f754e16ae11a7a6212b31688ca3b4965ba296bea56c48d7b635db`;
- options fingerprint:
  `9b0f5493445525ad6af6160e8903e9fb9a7cc39d9424cab67ddba788405ae59b`.

Běh použil existující izolovaný PDF runtime přes exact absolutní
`INTENTSMITH_PDF_PYTHON` a deklarované lokální toolchain allowlisty. Nepoužil
model, inference Ollamy, GPU, listener ani mobilní zařízení.

## Červená mezievidence

První souvislý běh na implementačním commitu `a59bc68a` skončil
`331 PASS / 1 FAIL`, verdict `FAIL`, exit 1. Artifact suite správně odmítla
o šest source a jeden testovací řádek zastaralý census, který vznikl poslední
edge-case opravou. Report SHA-256:
`470c15974e9d95f80a90d34cf85daee94c934e446337bdc8aee2d651a16e128b`.

`f40c58e0` upravil pouze přesný census z committed JavaScript bytes. Zelený
výsledek je nový celý běh, nikoliv přebarvení červeného reportu.

## Limity a review hranice

Probe výsledky jsou fixture evidence adapteru, nikoliv důkaz live produkčního
health. Composition bude muset pojmenovat skutečné komponenty a jejich
fail-closed status kódy; tento blok jí nedává síťovou ani DB autoritu.

Sondy běží sekvenčně a adapter sám nevlastní timeout. Deadline musí dodat
budoucí production composition bez oslabení truthfulness jednotlivých stavů.

Žádný live LLM/chat-quality, Ollama inference, fyzický GPU, pairing, device,
listener, signature, rotace, history rewrite, push, tag ani publish neproběhl.
Samostatný M6 24h soak běží nad starším exact kandidátem a jeho výsledek nebude
přenesen na tento SHA.

Nezávislé review je povinné. Tento report není M7 acceptance ani runtime
activation.
