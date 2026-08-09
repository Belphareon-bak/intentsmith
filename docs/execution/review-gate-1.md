# M1 REVIEW GATE 1 — operátorský balík

## Verdikt

**CHANGES_REQUIRED / BLOCKED.** B1 je kompletní a B2 je PASS. B3 má zelenou
offline connector vrstvu, ale skutečný referenční GPU pilot je červený. B4 má
reviewované stable-ID/scoped-cancel a reconnect guardy; z rehydrate checkpointu
jsou focused implementované serverová i klientská autorita 014/A včetně
úplného partition, rejectu, quarantine a bounded restore. Celá identity/history
obnova má nyní existence-aware route, post-review hardenovaného klienta i
společný DB-backed live wire přes produkční WS server a history route. B4 je
nadále BLOCKED na 010/A+, built journey, fresh-clone parity a soaku. 011/A HTTP
fallback authority je od
`2ead4662` focused PASS; B4
stále nemůže pravdivě splnit přesný terminal consumer ani atomickou
empty-history obnovu bez implementace ostatních potvrzených rozhodnutí. Operátor
2026-08-08 uzavřel celou
frontu 001–014; výběr variant ale sám nevytváří produktový důkaz. Podle
`docs/execution/m1-batch.md` se B5 před přijetím B2, B3 a B4 nespouští.

Tento verdikt neznamená revert. Přesně pojmenované přijaté části mají zelené
focused testy; nebezpečný partial-ACK/implicit-complement cleanup mezi ně
nepatří a netvoří celý M1 exit.

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
| B1 `WP-M1-CONTRACT` | COMPLETE, rozhodnutí potvrzena | provisional v1 pro Conversation, Model a CoreEvent; fail-closed validátory JS/TS | produkční partial-tool persistence se netvrdí; `persistPartialToolResults` zatím nemá konzumenta |
| B2 `WP-M1-CHAT` | PASS, operátorsky potvrzený směr | persist-before-response, conversation isolation, exact HTTP adapter, scoped cancel, process-restart persistence | globální HTTP/WS mutex je finding 005, ne skrytý claim |
| B3 `WP-M1-MODEL` | BLOCKED | exact fake-provider connector, auth/purpose/model binding, VRAM preflight, sanitizované terminal outcomes | implementovat 006/D+ po oddělených milnících; zavést společný profil 009 a provést nový skutečný T3 běh od 4096 |
| B4 `WP-M1-STUDIO` | PARTIAL / BLOCKED | stable ID, scoped cancel, bounded reconnect, 011/A WS-only `NOT_SENT`, serverová i klientská autorita 014/A, route+client 012/B a společný DB-backed live wire | dokončit 010/A+ a built journey, potom fresh-clone parity a bounded soak |

Autoritativní podrobnosti jsou v:

- `docs/execution/runs/wp-m1-contract-report.md`;
- `docs/execution/runs/wp-m1-chat-report.md`;
- `docs/execution/runs/wp-m1-model-report.md`;
- `docs/execution/runs/wp-m1-studio-report.md`.

## Rozhodovací fronta

| ID | Typ | Potvrzený stav | Co ještě chybí |
|---|---|---|---|
| 001 | DECIDE → A | terminal `error`, partial není assistant | implementace schématu hotová; produkční partial konzument neexistuje a netvrdí se |
| 002 | DECIDE → A | cancel je definitivní | implementace kontraktu hotová; built Studio consumer čeká na 010 |
| 003 | DECIDE → A | persist-then-respond | implementováno; 67–78 ms drží cíl 100 ms |
| 004 | BLOCK → C, potvrzeno | cancel podle `conversationId` | implementováno; v2 `targetRequestId` zůstává odložený |
| 005 | DECIDE → A | jeden provider attempt jen pro connector v1 | implementováno; legacy retry cesta beze změny |
| 006 | BLOCK → D+ | auditovaný dočasný local failover s opt-inem | nejdřív společná identity + delete/cleanup guard; potom desired/active persistence, pravdivý audit, verify a restore; L0-9 se zatím nemění |
| 007 | DECIDE → A | `NONFIT` jen z důvěryhodných fyzických dat | implementováno; produkční trusted metadata a GPU evidence zůstávají pod 009 |
| 008 | DECIDE → A | role-purpose matrix a bounded parameters | implementováno |
| 009 | BLOCK → A-4096 calibration | zachovat 27B/digest/1 GiB/100% residency/no fallback | společný runtime profil a nový skutečný sériový T3 běh; 4096 zatím není PASS |
| 010 | BLOCK → A+ | protocol `lib` untracked + generated prebuild + negotiated M1 wire/ledger | generated prebuild checkpoint implementován a mutačně připnut; chybí clean-clone build matrix, negotiated wire/ledger a built journey |
| 011 | BLOCK → A nyní / C v M2 | HTTP send fallback vypnout fail-closed | **implementováno na `2ead4662`**: tři call sites, `NOT_SENT`, phantom-ID guard a nulový-effect test; WS/HTTP parity je vědomě změněna |
| 012 | BLOCK → B | existence-aware history route | route, 53/53 klientský kontrakt i společný T25h DB-backed live wire implementovány; exact 200, 404+same-ID reuse, reject/timeout i reference/epoch race připnuty |
| 013 | DECIDE → A | 12 bounded retries + visible exhaustion | implementováno na client contract vrstvě; built journey chybí |
| 014 | BLOCK → A | úplný ACK partition nebo request-bound reject, nikdy partial/in-memory autorita | server/client focused implementace, restore clamp i společný DB-backed live wire hotové; built journey zůstává B4 podmínkou |

Každý detail, varianta a konkrétní cena přepnutí je v odpovídajícím souboru
`docs/decisions/NNN-*.md`. Tabulka zapisuje operátorskou volbu; stav WP se mění
až po implementaci a pojmenovaném důkazu.

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

## B4 follow-up 011/A na `2ead4662`

Commit `2ead4662e00d0b2e39bc03b9b2eb389e07be87e8` vypnul všechny tři
legacy HTTP send fallbacky a doplnil lokální `NOT_SENT` stav. Behaviorální
matice pinuje tři transportní failure režimy, effect-capable prompty, obě
skutečné gap volby, zachování draftu/attachments/timeline a nulový HTTP i
simulovaný downstream efekt. Identity prvního sendu se publikuje až po lokálním
WS enqueue; false ani throw nemohou vytvořit phantom ID pro pozdější rehydrate.

Path-scoped strom `src/`, `scripts/`, `tests/`, `c3-ide/` a decision 011 byl
pro tento SHA beze změny. Celý checkout obsahoval disjunktní chráněnou
governance dokumentaci a není proto vydáván za plně čistý.

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-studio-client.test.js` | 33 passed, 0 failed, 0 skipped | 0 |
| `node tests/ws-bridge.test.js` | 67 passed, 0 failed | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed, 0 skipped | 0 |
| `node tests/studio-cdp-evidence.test.js` | 59 passed, 0 failed, 0 skipped | 0 |
| `node tests/studio-electron-runner-contract.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | valid, 373 programů, fingerprint `72417b86…a4690` | 0 |
| `node tests/repository-hygiene.test.js` | 1502 tracked paths | 0 |

Tento follow-up uzavírá pouze 011/A. Následné focused checkpointy odstranily
async attachment race přes session/timeline/identity token; důkaz je ve
`docs/findings/009-studio-stale-attachment-send.md`. Durable retry ani globální
conversation mutex tím nevznikly. 014/A a 012/B jsou nyní focused hotové;
z 010/A+ zůstává clean-clone důkaz, negotiated wire a ledger, dále built
journey, fresh-clone parity a renderer soak.

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
| `node tests/repository-hygiene.test.js` | 1477 tracked paths | 0 |
| `git diff --check` | bez chyb | 0 |
| `git diff --cached --check` | bez chyb | 0 |

## Commit range podle WP

- B1/P1: `93b76a78`, `b9c97ce4`, `86defcef`;
- B2: `71769051`, `5a95e1f7`, `f62f3fc5`, `eb01abb2`, `55c913d6`;
- B3 a accepted cancel dependency: `88b25966`, `af46bbf1`, `78e63f03`,
  `ec4008aa`, `1f2993a4`, `c901e767`, `b7d0dbf6`;
- B4: `50280fcd`, `d145e95e`, `446d197f`, `8e68a92e`, `a4067cd6`,
  follow-up `2ead4662`.

Přesný přehled pro review:

```bash
git log --reverse --stat \
  2a59637e806b1ec5dac6de35b970eee54e1764b0..a4067cd69399b7824b074461a91c601751bd9981
```

## Podmínky pokračování

1. Operátorské volby 001–014 jsou zapsané; dnešní fronta neobsahuje formální
   `PARK`. Samotný zápis variant žádný BLOCK nezelená.
2. B3 pokračuje třemi oddělenými milníky: **B3-IDENTITY** sjednotí modelovou
   identitu a všechny delete/cleanup guardy a současný integrity check přepne
   na detection-only s nulovou mutací;
   **B3-PROFILE** zavede společný profil 009 a zopakuje GPU pilot od 4096;
   **B3-FAILOVER** teprve potom zavede opt-in desired/active stav s pravdivým
   auditem, verify, restartem a bezpečným restore. Opt-in autorita je JSON
   `user_settings.id=1` a každá chyba fail-close; L0-9 se změní až po důkazu.
3. 011/A, obě poloviny 014/A, obě poloviny 012/B i společný DB-backed live wire
   jsou focused PASS. Generated prebuild část 010/A+ je implementovaná;
   zbývající B4 pořadí pokračuje fresh-clone build důkazem, negotiated wire,
   terminal ledgerem a built journey. ACK vyžaduje durable store a matching reject končí okamžitě jako
   degraded. Pro M1 platí WS send + fail-closed `NOT_SENT`; HTTP send parity se
   vrací až nad M2 effect authority.
4. Po odblokování B4 proběhne ještě před B5 skutečná Theia multi-panel/cancel/
   restart journey a fresh-clone parity. Bounded soak se buď provede na
   stabilním displeji, nebo jej operátor výslovně schválí jako `PARK` podle
   dávkového kontraktu. Dnešní `NOT RUN` není implicitní PARK.
5. Teprve po operátorském přijetí B2, B3 a B4 se spustí B5 `WP-M1-QUALITY`.
   B6 je až následná integrovaná exit demonstrace všech sedmi scénářů, nikoli
   náhrada za chybějící B4 journey.

Do té doby je správný další stav **implementovat potvrzené Gate 1 follow-upy**,
ne spouštět B5. Gate 1 zůstává `CHANGES_REQUIRED / BLOCKED`.
