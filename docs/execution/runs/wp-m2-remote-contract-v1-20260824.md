# WP-M2-REMOTE-CONTRACT-V1 — integrační evidence

- **oddíl:** M2 7/7
- **stav:** `IMPLEMENTATION_GREEN / REVIEW_REQUIRED`
- **candidate revision:** `a7d4ce3d8b7886e521f70f78e7a2ff262736b93a`
- **větev:** `codex/m2-integration-20260824`
- **push:** neproveden

Tento report nedokládá `PINNED_V1`, `REVIEW_PASSED` ani celý M2 PASS. Dokládá
source-bound implementačně zelený kandidát oddílu 7 před povinným Opus max
review. Účtový spend limit Opusu není verdict a nesmí se překládat na PASS.

## Dodaný řez

- exact `RemoteCorePortDescriptor`, `RemoteCoreHello` a
  `RemoteCoreNegotiation` v1 s canonical digesty, strict exact-key validací a
  explicitní port-version negotiation bez implicitního downgrade;
- přesně sedm capability tříd: projects, conversations, settings,
  stored information, approvals, notifications a events;
- per-capability compatibility s explicitními verzemi a povinnými contract a
  operations digesty pro jakoukoli budoucí available capability;
- fail-closed unavailable provider, který vystavuje pouze zmražené read-only
  metody `describe` a `negotiate` a pro každý požadavek vrací pravdivý typed
  denial místo prázdného úspěchu;
- negativní fyzická boundary: contract/provider nedosáhne na server, routes,
  DB, network ani WS; produkční server placeholder neimportuje a legacy
  listener zůstává přesně numeric `127.0.0.1`;
- threat model výslovně odkládá listener, pairing, authentication, device
  authority a mobilní runtime do M7; M5 nejprve dodá oddělený in-process core
  adaptér proti tomuto zmraženému portu.

## Focused evidence

| Sada | Výsledek |
|---|---:|
| `m2-remote-core-port-contract-v1` | 17/17 PASS |
| `m2-remote-core-port-boundary` | 10/10 PASS |

Nové focused sady mají dohromady 27/27 PASS. Relevantní existující regrese
`m1-contract`, `m2-effect-contract-v1`, `m2-lifecycle-contract-v1` a
`routes-smoke` mají dohromady 169/169 PASS. Všechny běhy byly offline, bez GPU,
Ollamy, Electronu, síťového listeneru a remote runtime.

## Strukturální evidence

- `module-boundary-ratchet`: 13/13 PASS; exact baseline zůstává 1 116 hran,
  3 cykly / 28 souborů;
- nové contract/provider moduly jsou fyzicky odpojené od produkčního serveru;
- registry: 428 runnable programů, 14 explicitních exclusions a 331 ACTIVE;
- registry fingerprint po připnutí `lastGreen` je
  `c487692dd5ccea126d3b858f4dcf207cc701e945c545ee2843c7227b946d4374`;
- `artifact-validation`: 154/154 PASS;
- celý deterministický `offline,database` gate se spustí až nad čistým
  evidence commitem a jeho skutečný verdict/counts/non-PASS set se sem doplní.

## Review

Lokální Claude Opus se spouští s `--model opus --effort max` v read-only plan
mode nad exact base/candidate rozsahem. Každé `CHANGES_REQUESTED` se opraví a
review zopakuje. Odpověď o vyčerpaném spend limitu je pouze
`REVIEW_BLOCKED_ACCOUNT_LIMIT`, nikoli review verdict.

## Přiznané limity

- V1 zmrazuje negotiation/security obálku a capability identity, nikoli
  payload schema dosud neimplementovaných M5 providerů.
- Tento řez neposkytuje žádnou remote authority, autentizaci ani transport.
- Legacy `/api/*` a `/c3/ws` jsou trusted-local compatibility plocha, nikdy
  implementace `RemoteCorePort`.
- M2 jako celek není dokončená, dokud všech sedm povinných Opus max reviews
  nevrátí explicitní `REVIEW_PASSED` a integrační closeout nezůstane bez nové
  produktové regrese.
