# M1 REVIEW GATE 1 — operátorský balík

## Verdikt

**CHANGES_REQUIRED / BLOCKED.** B1 je kompletní a B2 je PASS. B3 má zelenou
offline connector vrstvu, ale skutečný referenční GPU pilot je červený. B4 má
čtyři reviewované bezpečné checkpointy, ale nemůže pravdivě splnit přesný
terminal consumer, HTTP fallback authority ani atomickou empty-history obnovu
bez rozhodnutí operátora. Podle `docs/execution/m1-batch.md` se B5 před tímto
review nespouští.

Tento verdikt neznamená revert. Dosažené checkpointy jsou použitelné a zelené;
jen netvoří celý M1 exit.

## Identita kandidáta

- **větev:** `claude/gate1-mobile-app-progress-5sywlt`
- **výchozí SHA dávky:** `2a59637e806b1ec5dac6de35b970eee54e1764b0`
- **implementační tip před tímto packet commitem:** `a4067cd69399b7824b074461a91c601751bd9981`
- **review range:** `2a59637e806b1ec5dac6de35b970eee54e1764b0..a4067cd69399b7824b074461a91c601751bd9981`
- **počet commitů v range:** 20
- **push:** neproveden; operátor jej provede až po review

## Výsledek work packages

| WP | Stav | Co je skutečně hotové | Co brání přijetí |
|---|---|---|---|
| B1 `WP-M1-CONTRACT` | COMPLETE | provisional v1 pro Conversation, Model a CoreEvent; fail-closed validátory JS/TS | operátorské potvrzení DECIDE 001–002 |
| B2 `WP-M1-CHAT` | PASS, čeká na Gate 1 přijetí | persist-before-response, conversation isolation, exact HTTP adapter, scoped cancel, process-restart persistence | potvrzení DECIDE 003; globální HTTP/WS mutex je finding 005, ne skrytý claim |
| B3 `WP-M1-MODEL` | BLOCKED | exact fake-provider connector, auth/purpose/model binding, VRAM preflight, sanitizované terminal outcomes | odblokování BLOCK 006 a 009; potvrzení DECIDE 005, 007 a 008; nový GPU pilot podle přijatého profilu |
| B4 `WP-M1-STUDIO` | PARTIAL / BLOCKED | stable ID, scoped cancel, durable ACK validation, race-safe rehydrate, bounded reconnect | odblokování BLOCK 010–012; potvrzení DECIDE 013; skutečná B4 journey, fresh-clone parity a soak nebo jeho výslovné PARK schválení |

Autoritativní podrobnosti jsou v:

- `docs/execution/runs/wp-m1-contract-report.md`;
- `docs/execution/runs/wp-m1-chat-report.md`;
- `docs/execution/runs/wp-m1-model-report.md`;
- `docs/execution/runs/wp-m1-studio-report.md`.

## Rozhodovací fronta

| ID | Typ | Vzatý stav | Co má operátor udělat |
|---|---|---|---|
| 001 | DECIDE | partial tool data po selhání zůstává terminal `error` | potvrdit nebo změnit terminal union |
| 002 | DECIDE | late assistant po cancelu se odmítá | potvrdit nebo změnit single-terminal pravidlo |
| 003 | DECIDE | persist-then-respond | potvrdit; dnešní testy připínají fail-closed zápis |
| 004 | původní BLOCK, operátorem uzavřen | varianta C, cancel podle `conversationId` | potvrdit implementační uzavření; v2 `targetRequestId` zůstává odložený |
| 005 | DECIDE | žádný automatický model retry ve v1 | potvrdit nebo změnit policy |
| 006 | BLOCK mimo connector checkpoint | auto-rebind bez approval se neměnil | vybrat approval-gated variantu nebo vypnutí; L0 nelze obejít |
| 007 | DECIDE | `NONFIT` jen z důvěryhodných fyzických dat | potvrdit nebo změnit VRAM policy |
| 008 | DECIDE-AND-CONTINUE | role-purpose matrix a bounded parameters | potvrdit nebo upravit jediný adapter šev |
| 009 | BLOCK | 27B reference nesplnila 1 024 MiB post-load headroom | vybrat kontext/model/residency variantu; guard se nesmí oslabit |
| 010 | BLOCK | exact Studio terminal consumer se neimplementoval | vybrat protocol runtime delivery A/B/C, nebo přijmout odklad bez M1 exit |
| 011 | BLOCK | legacy HTTP send fallback zůstává bezpečnostně neuzavřený | zvolit vypnutí fallbacku nebo schválenou server effect authority |
| 012 | BLOCK | `200 []` nesmí smazat lokální snapshot | zvolit existence-aware route nebo atomický rehydrate snapshot |
| 013 | DECIDE | 12 bounded retries + visible exhaustion | potvrdit nebo zvolit infinite/manual-retry variantu |

Každý detail, varianta a konkrétní cena přepnutí je v odpovídajícím souboru
`docs/decisions/NNN-*.md`. Tento packet žádnou variantu dodatečně neschvaluje.

## Nezávislé findingy

- `docs/findings/001-m2-effect-authority-gaps.md` — read-only P1 call graph;
- `docs/findings/002-m1-vision-bypasses-model-connector.md`;
- `docs/findings/003-m1-vram-policy-is-duplicated.md`;
- `docs/findings/004-llm-auth-factory-capability-elevation.md`;
- `docs/findings/005-http-ws-conversation-mutex-is-local.md`.

Finding se nepřevádí na PASS jen proto, že jeho vlastník je pozdější WP.

## Gate 1 offline validace na `a4067cd6`

Všechny příkazy níže proběhly 2026-08-08 z čistého tracked stromu. GPU ani
externí síť se v této společné kontrole nepoužily.

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-chat-contract.test.js` | 18 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-contract.test.js` | 28 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-studio-client.test.js` | 25 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-gpu-pilot.test.js --self-check` | `SELF_CHECK_PASS`, bez provider/GPU effectu | 0 |
| `node tests/model-ctx.test.js` | 11 passed, 0 failed, 0 skipped | 0 |
| `node tests/llm-gateway-runtime-signal.test.js` | 7 passed, 0 failed, 0 skipped | 0 |
| `node tests/deterministic-answer-latency.test.js` | 3 passed, 0 failed | 0 |
| `node tests/confirmation-ownership.test.js` | 5 passed, 0 failed | 0 |
| `node tests/routes-smoke.test.js` | 109 passed, 0 failed | 0 |
| `timeout --signal=TERM --kill-after=10s 180s node tests/chat-persistence.test.js` | 35 passed, 0 failed | 0 |
| `node tests/ws-bridge.test.js` | 67 passed, 0 failed | 0 |

## Skutečný GPU výsledek, který se nesmí přepsat self-checkem

Registrovaný T3 pilot běžel z čistého SHA
`1f2993a4c76f0550eb0de6b47ae2adf1a8bbca05` přes audit runner. Výsledek byl
`FAIL`, 0 PASS / 1 FAIL / 0 TIMEOUT / 0 BLOCKED, exit 1. Selhala
post-load headroom podmínka; cleanup vrátil host do prázdného GPU/Ollama stavu.

- report: `.intentsmith-artifacts/test-runs/m1-b3-gpu-1f2993a4c76f/report.json`;
- report SHA-256: `eaa8a29e574ef300f6d5ecf632e8fd07d7a0487030f837eacc23b6e627a6b8aa`;
- inventory SHA-256: `e66f7fc56f66284c5653aaaa9e96fc52c29a378717f7e5dc39f627ad7661842d`;
- checkpoint SHA-256: `7a2319172e5b3e393c70b07968dc97365a6b72bee9838fdfd9c7fda043ccdcc6`.

Artefakty jsou lokální a ignorované; commitnutý trvalý záznam je
`docs/execution/runs/wp-m1-model-report.md` a rozhodnutí 009. Self-check v Gate
1 tabulce ověřuje jen bezpečnost test harnessu, nikoli GPU acceptance.

## Packet commit battery

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | valid, 364 programů, 8 exclusions, fingerprint `b45e4da20315bf8c5edd3e08f74c5c8a6f9925aa0026211c1f047ffbd27691ff` | 0 |
| `node tests/repository-hygiene.test.js` | 1476 tracked paths | 0 |
| `git diff --check` | bez chyb | 0 |
| `git diff --cached --check` | bez chyb | 0 |

## Commit range podle WP

- B1/P1: `93b76a78`, `b9c97ce4`, `86defcef`;
- B2: `71769051`, `5a95e1f7`, `f62f3fc5`, `eb01abb2`, `55c913d6`;
- B3 a accepted cancel dependency: `88b25966`, `af46bbf1`, `78e63f03`,
  `ec4008aa`, `1f2993a4`, `c901e767`, `b7d0dbf6`;
- B4: `50280fcd`, `d145e95e`, `446d197f`, `8e68a92e`, `a4067cd6`.

Přesný přehled pro review:

```bash
git log --reverse --stat \
  2a59637e806b1ec5dac6de35b970eee54e1764b0..a4067cd69399b7824b074461a91c601751bd9981
```

## Podmínky pokračování

1. Operátor projde rozhodnutí 001–013 najednou: potvrdí nebo přepne každý
   `DECIDE`, odblokuje každý `BLOCK` a potvrdí implementační uzavření 004.
   Dnešní fronta neobsahuje žádný formální `PARK`.
2. BLOCK 006 dostane approval-gated nebo vypnutou variantu slučitelnou s L0-9.
   BLOCK 009 dostane schválenou měřitelnou variantu; GPU pilot se zopakuje až
   nad novým commitnutým profilem a bez oslabení guardu.
3. BLOCK 010–012 se musí odblokovat a implementovat tak, aby B4 mohl být
   přijatý; ponechání 012 jako omezení znamená, že B4 zůstává blokovaný a B5
   nezačne.
4. Po odblokování B4 proběhne ještě před B5 skutečná Theia multi-panel/cancel/
   restart journey a fresh-clone parity. Bounded soak se buď provede na
   stabilním displeji, nebo jej operátor výslovně schválí jako `PARK` podle
   dávkového kontraktu. Dnešní `NOT RUN` není implicitní PARK.
5. Teprve po operátorském přijetí B2, B3 a B4 se spustí B5 `WP-M1-QUALITY`.
   B6 je až následná integrovaná exit demonstrace všech sedmi scénářů, nikoli
   náhrada za chybějící B4 journey.

Do té doby je správný další stav **čekat na REVIEW GATE 1**, ne spouštět B5.
