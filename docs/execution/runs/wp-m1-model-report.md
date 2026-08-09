# WP-M1-MODEL — průběžný report

- **stav WP:** B3-IDENTITY + B3-PROFILE READY; B3-FAILOVER storage, manual
  repository, application-state schema, společný manual runtime cutover a
  finalize recovery FRESH-CLONE VERIFIED; detection-only coordinator je
  FRESH-CLONE VERIFIED na `1823e9a4`; C2b gateway + binding jsou FRESH-CLONE VERIFIED na `cfcb63dd`,
  celý C2 však zůstává PARTIAL; nový referenční GPU běh 009, proof issuer a
  automatic failover activation zůstávají BLOCKED; offline connector READY
- **poslední ověřený source SHA:**
  `be4f2175d472f24b98970d046697a0a2a6b21e5a`
- **base SHA:** `55c913d6f3cb2354b6447d10ff304e9d0323b1c3`
- **zapisující větev:** `claude/gate1-mobile-app-progress-5sywlt`
- **GPU/Ollama v checkpointech 1–2:** NOT RUN
- **neplánovaný modelový proces při checkpointu 3:** PARTIAL / NOT EVIDENCE
- **registrovaný GPU pilot v checkpointu 5:** FAIL / stav bezpečně obnoven
- **push:** neproveden podle dávkového kontraktu

## Checkpoint 1 — pravdivý fake-provider gateway

Implementována oddělená policy cesta `callWithPolicy()` pro connector v1.
Vynucuje jeden provider pokus, validní auth/capability a přesnou korelaci
`requestId/conversationId/turnId/callerRole/modelRole/purpose`. Caller role se
odvozuje z auth tokenu; podvržená nebo objektová korelace skončí před provider
effectem. Empty/whitespace, malformed JSON/payload, HTTP 404/500/503, refused
socket a queue timeout mají rozdílné bezpečné typy. Prompt, system prompt,
messages, token, raw provider body ani stack se do auditu tohoto boundary
nezapisují.

Semafor nyní odebere přesně zrušeného waitera; jeho timer/listener se uklidí a
slot nepřejde na již settled entry. Upstream timeout čekající ve frontě se
eviduje jako timeout, ne jako user cancel. Úspěch i runtime evidence nesou
sanitizovanou korelaci.

## Ověření checkpointu

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check src/llm/gateway.js` | syntax valid | 0 |
| `node --check tests/m1-model-contract.test.js` | syntax valid | 0 |
| `node tests/m1-model-contract.test.js` | 11 passed, 0 failed, 0 skipped | 0 |
| `node tests/llm-gateway-runtime-signal.test.js` | 7 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/capability-02-cre-behaviours.test.js` | 10 passed, 0 failed | 0 |
| `node tests/model-ctx.test.js` | 6 passed, 0 failed, 0 skipped | 0 |
| `node tests/model-universe-store.test.js` | 18 passed, 0 failed, 0 skipped | 0 |
| `node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | 362 programů, 8 exclusions, fingerprint `e3036487a71d3be0d0e9c463b17c0233b0d28ff4be6f8436ab49322df4ac5f15` | 0 |
| `node tests/repository-hygiene.test.js` | 1457 tracked paths | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

První běh `node tests/artifact-validation.test.js` skončil 150 passed / 1 failed,
exit 1, protože README po přidání sady uvádělo správný celkový počet 362, ale
stale dílčí počet `264 ACTIVE`. Po opravě na registry-odvozených `265 ACTIVE`
odhalil druhý běh jinou 150/1 chybu: negativní drift test sám natvrdo nahrazoval
starou hodnotu `264`, takže už žádnou mutaci neprovedl. Test nyní odvozuje
ACTIVE počet z registru a mění jej o jedna; konečný běh je 151/0, exit 0.

### Negativní mutační kontrola

Dočasná jediná mutace změnila striktní výběr neprázdného výstupu na prosté
`candidates[0]`. `node tests/m1-model-contract.test.js` pak skončil
**10 passed / 1 failed, exit 1** přesně v aserci empty/whitespace fail-closed.
Mutace byla vrácena přesným patchem, zachovaný failure artifact byl přesunut do
koše a čistý běh se vrátil na 11/11, exit 0.

## Checkpoint 2 — offline VRAM klasifikace před efektem

`fitsVram()` vrací přesně `fit | nonfit | unknown`. Fyzický `nonfit` smí
vzniknout jen z explicitního trusted footprintu a validní celkové GPU kapacity;
modelový tag jako `:7b` není důkaz velikosti. Chybějící footprint, nedostupné či
rozbité pozorování a dočasně nízká volná paměť jsou rozlišené důvody `unknown`.

`callWithPolicy()` validuje `num_ctx` a odmítá request-level pokus podvrhnout
VRAM policy. Preflight probíhá před providerem i semaforovým slotem, respektuje
cancel/deadline a odečte svůj čas z provider budgetu. Známý `nonfit` končí
`MODEL_VRAM_NON_FIT` bez `fetch`, call counteru a success/runtime signálu.
`unknown` je auditovaný a pokračuje, aby chybějící telemetrie nebo legitimní
model swap nevytvořily falešný hard failure.

První nezávislé read-only review vrátilo `CHANGES_REQUIRED`: request mohl
podvrhnout observer, name-only Q4 odhad tvořil fyzický `NONFIT` a preflight byl
za převzetím slotu. Všechny tři P1 byly před checkpointem odstraněny. Doplněny
byly i negativní hrany pro reserved override, invalidní `num_ctx`, throwing
observer/property accessor a pre-abort bez jediného observer/provider callu.
Druhé review našlo globální footprint bez vazby na model, nevalidovaný
cache-derived `num_ctx` a chybějící regresi cancel/timeout přímo během
preflightu. Footprint je nyní lookup přes přesnou normalizovanou identitu
modelu, model i efektivní kontext mají omezený syntax/range a never-resolving
observer pinuje obě terminační cesty bez provideru nebo semaforového slotu.
Následný prototype-boundary probe ještě prokázal rozdíl mezi preflightem a
provider payloadem u zděděných options. Boundary nyní vyžaduje plain own-key
record, jednou jej snapshotuje a validovaný model/`num_ctx` forwarduje
explicitně; negativní `Object.create(proto)` fixture končí před observerem i
providerem.

Konečné read-only re-review po těchto opravách: **READY**, P0/P1/P2 žádné.
Reviewer znovu ověřil model-keyed mismatch, prototype fixture, cache-derived
kontext, obě preflight terminační cesty a focused výsledky 11/0, 16/0, 7/0 a
78/0. GPU ani Ollama při review spuštěny nebyly.

### Focused ověření checkpointu 2

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check src/llm/gateway.js` | syntax valid | 0 |
| `node --check src/llm/model-ctx.js` | syntax valid | 0 |
| `node --check tests/m1-model-contract.test.js` | syntax valid | 0 |
| `node --check tests/model-ctx.test.js` | syntax valid | 0 |
| `node tests/model-ctx.test.js` | 11 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-contract.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `node tests/llm-gateway-runtime-signal.test.js` | 7 passed, 0 failed, 0 skipped | 0 |
| `node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/capability-02-cre-behaviours.test.js` | 10 passed, 0 failed | 0 |
| `node tests/model-universe-store.test.js` | 18 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | 362 programů, 8 exclusions, fingerprint `e3036487a71d3be0d0e9c463b17c0233b0d28ff4be6f8436ab49322df4ac5f15` | 0 |
| `node tests/repository-hygiene.test.js` | 1462 cest | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

Dočasná jediná mutace vypnula větev
`vramFit.state === VramFitState.NONFIT`. Model contract pak skončil
**15 passed / 1 failed, exit 1** přesně na scénáři, který požaduje terminální
`MODEL_VRAM_NON_FIT` před provider efektem. Zachovaný izolovaný test runtime byl
po skončení procesu a kontrole otevřených handle přesunut do koše, mutace byla
vrácena přesným patchem a aktuální čistý běh skončil 16/16, exit 0.

## Checkpoint 3 — ModelRequest/ModelResult adaptér a auth provenance

`executeM1ModelRequest()` nyní konzumuje connector v1 bez změny jeho schématu.
Payload se před první asynchronní hranicí hluboce snapshotuje, takže pozdější
mutace ID nebo vnořených parametrů nerozdělí provider audit a terminální result.
`callerRole` v payloadu není autorita: adaptér vyžaduje samostatný process-local
token vydaný `createAuthToken()`, svázaný s rolí a přesnou trojicí
`requestId/conversationId/turnId`. Chybějící, zkopírovaný, cizí nebo nadlimitní
token skončí před providerem.

Auth tokeny jsou evidované privátním `WeakSet`; vnější token,
`allowedCapabilities` i `auditContext` jsou zmrazené. Prototype role
`toString`/`constructor`, ručně sestavený, spread i structured-clone token jsou
neplatné. Token expiry po zahájení autorizovaného effectu nezruší pravdivou
terminální atribuci; adaptér uchová roli ověřenou před efektem.

Explicitní `(callerRole, purpose) -> capability` matice zachovává lifecycle
code/review cesty a současně odmítá neznámé kombinace. `modelRole` je oddělená
deployment vazba a pro `D1/D2/CODE/R1/R2/CHAT` vždy vybírá přesně
`config.models[modelRole]`. Request nesmí přepsat model, capability, korelaci,
messages, retry, auth, signal ani VRAM policy. `maxTokens` nezvýší limit role;
gateway použije minimum requestu a vydaného tokenu. Každý validní request má
právě jeden redigovaný `M1_MODEL_RESULT` audit bez promptu, system promptu,
parameters nebo tokenu. Neočekávaná provider exception se do standardního logu
zapisuje pouze bezpečným error code, nikoli raw message.

První read-only review adaptéru našlo zvýšení role limitu přes request,
nedostatečné mapování code/review capability, queue timeout vedený jako error a
padělatelné auth objekty; vše bylo opraveno. Druhé review prokázalo dvě P1:
TOCTOU mutaci request identity a razení autority ze self-asserted `callerRole`.
Adaptér proto snapshotuje vlastní kopii a token již nerazí. Následné probes
našly ztrátu caller attribution po expiraci během effectu, raw exception message
ve standardním logu a netypovaný runtime signal; i tyto hrany jsou nyní
negativně připnuté. Konečný read-only re-review: **READY**, bez zbývajícího
P0/P1/P2. Reviewer znovu spustil focused offline cesty, ověřil counterfeit
`AbortSignal`, všechny terminální audit families a žádný GPU/Ollama proces
nespustil.

### Focused ověření checkpointu 3

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check src/llm/auth-types.js` | syntax valid | 0 |
| `node --check src/llm/cre-bridge.js` | syntax valid | 0 |
| `node --check src/llm/gateway.js` | syntax valid | 0 |
| `node --check tests/m1-model-contract.test.js` | syntax valid | 0 |
| `node tests/m1-model-contract.test.js` | 28 passed, 0 failed, 0 skipped | 0 |
| `node tests/llm-gateway-runtime-signal.test.js` | 7 passed, 0 failed, 0 skipped | 0 |
| `node tests/model-ctx.test.js` | 11 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/capability-02-cre-behaviours.test.js` | 10 passed, 0 failed | 0 |
| `node tests/context-compact-model-ctx.test.js` | 1 passed, 0 failed, 0 skipped | 0 |
| `node tests/workflow.test.js` | 42 passed, 0 failed, 0 skipped | 0 |
| `node tests/architect-smoke.test.js` | 35 passed, 0 failed, 0 skipped | 0 |
| `node tests/routes-smoke.test.js` | 109 passed, 0 failed, 0 skipped | 0 |
| `node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed, 0 skipped | 0 |
| `node tests/model-universe-store.test.js` | 18 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | 362 programů, 8 exclusions, fingerprint `e3036487a71d3be0d0e9c463b17c0233b0d28ff4be6f8436ab49322df4ac5f15` | 0 |
| `node tests/repository-hygiene.test.js` | 1464 cest | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

Široká offline baterie běžela ve čtyřech paralelních skupinách `core`,
`legacy`, `surface` a `evidence`; všechny čtyři skupiny skončily exit 0.
`workflow-orchestrator.test.js` byl po kontrole registru správně vyřazen:
profil `model`, `network: loopback`, `ollama: true`.

Po rozšíření audit helperu proběhl jeden meziběh 27 passed / 1 failed, exit 1.
Produkt správně redigoval unsupported `VISION` model role na `null`, zatímco
nový test helper chybně očekával raw `VISION`. Opravena byla pouze expectation
helperu, ne produkční větev; izolovaný failure artifact byl po kontrole otevřených
handle přesunut do koše. Následující běhy jsou 28/0.

Negativní mutační kontrola dočasně vypnula jediný guard, který odmítá auth token
nad limitem role. `node tests/m1-model-contract.test.js` pak skončil
**27 passed / 1 failed, exit 1** přesně na očekávání
`MODEL_AUTHORIZATION_INVALID`; zvýšený token místo toho došel do policy cesty a
vrátil generic failure. Guard byl vrácen přesným patchem, zachovaný runtime po
kontrole handle přesunut do koše a čistý běh se vrátil na 28/28, exit 0.

### Neplánovaný modelový běh — není evidence

Při výběru legacy regresí byl chybně spuštěn řetězec
`node tests/workflow.test.js && node tests/workflow-orchestrator.test.js && node tests/architect-smoke.test.js`.
První sada dokončila 42/0; druhá obsahuje sekci `Start (real LLM)` a sáhla na
sdílenou Ollamu dřív, než proběhl povinný GPU snapshot. Read-only kontrola v tu
chvíli ukázala `deepseek-r1-32b:latest`, 21 GB, 100 % GPU, context 8192.
Přesně identifikované testovací PID už při pokusu o `SIGINT` neexistovaly;
Ollama ani model nebyly zastaveny. Orchestrace neuchovala konečný exit ani úplný
output, proto se běh **nezapočítává**, nic netvrdí o GPU acceptance a nebude
opakován bez bezpečného snapshotu a registrovaného T3 příkazu.

## Rozhodnutí a findingy — stav po REVIEW GATE 1

- `docs/decisions/005-m1-model-retry-policy.md` — operátor potvrdil A, jeden
  pokus pouze pro connector v1;
- `docs/decisions/006-m1-model-auto-rebind-l0.md` — operátor schválil D+;
  B3-IDENTITY je implementované bez auto mutace; oddělený desired/active
  failover, opt-in, pravdivý audit, verify a restore zůstávají otevřené;
- `docs/decisions/007-m1-vram-nonfit-policy.md` — operátor potvrdil A, pouze
  trusted fyzický `NONFIT` se odmítne před efektem;
- `docs/decisions/008-m1-model-adapter-authority.md` — operátor potvrdil A,
  explicitní role-purpose matice, samostatný auth token a parametrický allowlist;
- `docs/decisions/009-m1-gpu-headroom.md` — operátor schválil variantu A a
  `4096` jako první kalibrační kandidát při zachování 27B/digestu, 1 GiB,
  100% residency a zákazu fallbacku; nový skutečný T3 běh ještě neproběhl;
- `docs/findings/002-m1-vision-bypasses-model-connector.md` — vision direct
  fetch je PENDING-OWNER, protože B1 connector nenese image schema;
- `docs/findings/003-m1-vram-policy-is-duplicated.md` — startup, media VRAM
  manager a request preflight zatím nemají jednoho vlastníka footprintu.
- `docs/findings/004-llm-auth-factory-capability-elevation.md` — process-local
  token nejde padělat, ale trusted factory zatím zachovává legacy capability
  override mimo default role;
- `docs/findings/006-model-cleanup-bypasses-registry-guard.md` — canonical
  list-time klasifikace je opravená, ale chatový direct delete má stále závod
  assign-versus-delete a čeká na vlastníka mimo schválený identity scope;
- `docs/findings/007-model-cleanup-timestamp-ordering.md` — age-based cleanup
  porovnává produkční SQLite čas s ISO cutoffem lexikograficky; na stejném dni
  může čerstvější usage vyhodnotit jako starší.

## Zbývá v WP

1. B3-PROFILE: `src/llm/model-runtime-profile.js` pro model/digest/context/
   headroom/residency/fallback sdílený produktem, compaction a T3 pilotem;
2. sériový GPU run na skutečné Ollamě od `num_ctx=4096`, včetně cold/warm,
   classify a mid-generation cancel; před během musí bezpečný snapshot potvrdit
   nulovou potřebu pull/delete/rebind a prázdný sdílený GPU stav;
3. B3-FAILOVER: navazující persistentní část 006/D+ nad JSON
   `user_settings.id=1`, desired/active/audit migrací a vlastním důkazem; až
   potom případná změna L0-9;
4. společně vlastněný cleanup follow-up pro atomickou autoritu z findingu 006
   a numerické timestamp porovnání z findingu 007;
5. konečný read-only review, focused baterie a uzavření WP.

## Checkpoint 4 — registrovaný bezpečný T3 GPU pilot (zatím NOT RUN)

Host snapshot před vytvořením pilotu ukázal jednu RTX 3090 s 24 576 MiB,
23 119 MiB volnými, žádný proces v NVIDIA compute seznamu a prázdné
`ollama ps`. Připnutý `qwen3.5:27b` s digestem
`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`
je už nainstalovaný. Snapshot proto nevyžaduje pull, delete, model rebind ani
zastavení sdílené Ollamy.

Nová sada `tests/m1-model-gpu-pilot.test.js` je registrovaná jako T3/model a
smí běžet pouze audit runnerem s `--suite
IS-T3-TESTS-M1-MODEL-GPU-PILOT-TEST --concurrency=1 --timeout-minutes=15` a
explicitně povolenými lokálními prerekvizitami `ollama,gpu`. Před prvním
provider efektem fail-closed
ověří přesný loopback endpoint, source SHA, model/digest, prázdnou rezidenci,
nulový compute seznam, minimálně 20 128 MiB volné VRAM a idle gateway se
soubežností jedna. Nikdy nevolá pull/delete/stop/unload/rebind.

„Cold“ zde znamená přesně: cílový model před prvním connector requestem není v
`/api/ps`, compute seznam je prázdný a jeho načtení vznikne až jako běžný efekt
prvního requestu. Není to změna `config.models` ani administrativní rebind.
Protože načtení přesto mění sdílený GPU stav, pilot po posledním requestu čeká
nejvýše sedm minut na přirozené Ollama expiry a PASS dovolí jen po návratu k
prázdnému `/api/ps`, prázdnému compute seznamu a GPU paměti v původním
headroomu. Nikdy stav neobnovuje příkazem stop/unload. Neobnovení je typovaný
failure, ne důvod stav potichu ponechat. Přirozené expiry není garantovaná
cleanup operace: běh proto patří pouze do operátorem vyhrazeného GPU okna. Při
neobnovení suite zachová v privátním artefaktu poslední sanitizovaný stav
rezidence a VRAM pro následné rozhodnutí operátora; sama Ollamu nezastaví ani
model neodstraní.

Pilot změří skutečný cold answer, warm answer, JSON classification,
mid-generation cancel, přesný model/`num_ctx`, VRAM před/peak/po a jeden
terminální audit na request. Cancel nespouští pevný časovač: čeká na čtvrtý
provider request, aktivní Ollama compute proces a naměřenou GPU utilizaci
alespoň `max(80 %, baseline + 30 procentních bodů)`. Teprve pak pošle abort.
Report rozlišuje požadovaný 100ms sampling interval od skutečného průměrného
intervalu. Ukládá jen hash a délku odpovědí, ne jejich obsah, prompt ani auth
token; vlastněný artefakt má mód `0600`.

Každý provider request má limit 45 sekund. Nejhorší povolená cesta jsou tři
úspěšné requesty, jeden aktivně rušený request a sedmiminutové pozorování
přirozeného obnovení: samotný provider+restore budget je nejvýše 600 sekund;
preflight, post-observation a zápis evidence kryje celkový 900sekundový limit
vynucený výše uvedeným kanonickým příkazem.
Preflight blocker vrací ze samotné sady exit `2` a verdict `BLOCKED`; pokud jej
spustí audit runner, runner tento nenaplněný povinný běh správně vykáže jako
auditní `FAIL`, nikoli jako zelený nebo splněný `BLOCKED` výsledek.

Produkční preflight bez důvěryhodného `modelWeightsMb + kvMbPer1k` zůstane v
pilotním reportu výslovně `UNKNOWN/VRAM_FOOTPRINT_UNKNOWN`. Skutečné úspěšné
načtení modelu není zpětně vydáváno za důkaz, že metadata byla známá před
efektem. Tím zůstává první bod seznamu výše otevřený, i když reálný GPU běh
později prokáže chování na tomto stroji.

Tento checkpoint zatím GPU ani Ollamu nespustil. Offline `--self-check`
validuje parsery a negativní safety matrix bez provider nebo GPU effectu;
skutečný příkaz a výsledky budou doplněny až po commitu sady, aby audit runner
vázal evidence na čistý source SHA.

### Ověření scaffold checkpointu

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check tests/m1-model-gpu-pilot.test.js` | syntax valid | 0 |
| `node tests/m1-model-gpu-pilot.test.js --self-check` | `SELF_CHECK_PASS`, žádný provider/GPU effect | 0 |
| `node tests/m1-model-contract.test.js` | 28 passed, 0 failed, 0 skipped | 0 |
| `node tests/model-ctx.test.js` | 11 passed, 0 failed, 0 skipped | 0 |
| `node tests/llm-gateway-runtime-signal.test.js` | 7 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | 363 programů, 8 exclusions, fingerprint `01fba11724f59652ca443fade2cc3d1942839deb03db0473edee38b287edec21` | 0 |
| `node tests/repository-hygiene.test.js` | 1 467 trackovaných cest po stagingu nové sady | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

Read-only host check navíc potvrdil Ollama `0.17.7`, prázdné `ollama ps`,
prázdný NVIDIA compute seznam a absenci explicitního systemd override pro
`OLLAMA_KEEP_ALIVE`, `OLLAMA_MAX_LOADED_MODELS` a `OLLAMA_NUM_PARALLEL`.
Přirozené obnovení se přesto nepředpokládá jako úspěch: suite na něj čeká a
měří jej, jinak skončí červeně.

## Checkpoint 5 — první registrovaný GPU běh je červený

Kanonický běh z čistého commitu:

```text
node scripts/nightly-audit.js \
  --suite=IS-T3-TESTS-M1-MODEL-GPU-PILOT-TEST \
  --allow-blocker=ollama,gpu \
  --concurrency=1 \
  --timeout-minutes=15 \
  --deadline-hours=1 \
  --fail-fast \
  --run-id=m1-b3-gpu-1f2993a4c76f \
  --out-dir=.intentsmith-artifacts/test-runs
```

| Důkaz | Výsledek |
|---|---|
| source SHA | `1f2993a4c76f0550eb0de6b47ae2adf1a8bbca05` |
| registry fingerprint | `01fba11724f59652ca443fade2cc3d1942839deb03db0473edee38b287edec21` |
| runner | `FAIL`, 0 PASS / 1 FAIL / 0 TIMEOUT / 0 BLOCKED, exit `1` |
| trvání | 330 451 ms |
| fáze | `post-run-observation` |
| přesná třída z diagnostického hashe | `post-call GPU headroom is unsafe`; po loadu méně než 1 024 MiB volné VRAM |
| přirozené obnovení | 302 759 ms, 61 pollů, 0 loaded modelů, 0 compute procesů, 23 165 MiB volné VRAM |
| runner report SHA-256 | `eaa8a29e574ef300f6d5ecf632e8fd07d7a0487030f837eacc23b6e627a6b8aa` |
| suite log SHA-256 | `c7e6f72f846d47804a8548fa105af2dc0721c92d10eb11cc894edf0910bac9bd` |
| privátní suite artefakt SHA-256 | `dfa139c999167426dd1fc30de18ca0534020c8052daee1b66c898607ff38014f` |

Artefakty zůstávají v ignorovaném vlastněném adresáři
`.intentsmith-artifacts/test-runs/m1-b3-gpu-1f2993a4c76f/`; do commitu se
nepřidávají. Bezprostřední následná host kontrola znovu potvrdila prázdné
`ollama ps`, žádný compute proces a 23 160 MiB volné VRAM. Sdílený stav tedy
nezůstal změněný.

Výsledek se neopravuje oslabením 1GiB aserce ani nezdokumentovanou změnou
modelu/contextu. Operátor následně schválil variantu A se společným runtime
profilem a `4096` pouze jako prvním kalibračním kandidátem. GPU část B3 zůstává
blokovaná do implementace profilu a nového skutečného T3 běhu; offline
fake-provider a connector část zůstává ověřená. Následná úprava sady pouze doplňuje typovaný failure
`GPU_PILOT_POST_CALL_HEADROOM_UNSAFE` a sanitizovanou post-load observaci, aby
případný schválený další běh uchoval přesnou hodnotu místo samotného hashe.

### Ověření červeného evidence checkpointu

GPU pilot nebyl znovu spuštěn; níže jsou pouze offline kontroly evidence guardu
a nezměněných connector kontraktů.

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check tests/m1-model-gpu-pilot.test.js` | syntax valid | 0 |
| `node tests/m1-model-gpu-pilot.test.js --self-check` | `SELF_CHECK_PASS`, včetně přesného headroom failure typu | 0 |
| `node tests/m1-model-contract.test.js` | 28 passed, 0 failed, 0 skipped | 0 |
| `node tests/model-ctx.test.js` | 11 passed, 0 failed, 0 skipped | 0 |
| `node tests/llm-gateway-runtime-signal.test.js` | 7 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | 363 programů, 8 exclusions, fingerprint `01fba11724f59652ca443fade2cc3d1942839deb03db0473edee38b287edec21` | 0 |
| `node tests/repository-hygiene.test.js` | 1 468 trackovaných cest po stagingu decision záznamu | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

## Checkpoint 6 — kanonická presence identita a detection-only integrity

Nový `src/upgrade/model-identity.js` zavádí jedinou konzervativní identitu pro
binding/presence safety. Bare `name` a implicitní `name:latest` jsou stejné bez
ohledu na case a vnější whitespace; explicitní jiné tagy, dash/colon rodinné
varianty a quantization varianty zůstávají různé. Provider effect i audit dál
zachovávají exact observed/requested name. Name-only validation metadata je
výslovně `artifactVerified: false`; digest-bound autorita nevznikla.

Stejnou identitu nyní používají role a validating guard, overview,
deterministicky nejnovější validation alias, agregovaný usage, recommendation,
registry delete/auto-clean, validation queue, `getUnusedOldModels()`, relevantní
upgrade-manager joins a direct system-route fallback. Dříve reprodukovaný
bound `identity-fixture` versus installed/requested
`identity-fixture:latest` už skončí před provider delete.

`checkBindingIntegrity()` je nově čistý detektor: vrací schéma 1,
`COMPLETE | INCONCLUSIVE` a `DETECTED | PROPOSED` findings. Skutečně missing
role s lokálně nainstalovaným kandidátem vrátí jeho exact name a digest, ale
provede přesně nula assign, override a broadcast efektů. Prázdný modelový
inventář je `OLLAMA_UNAVAILABLE_OR_EMPTY / INCONCLUSIVE`, nikoli uninstall
evidence.

Read-only call graph současně našel residual mimo povolené cesty:
`src/chat/handlers/pre-handler.js:model_cleanup` používá unused seznam, ale
maže vlastním provider callem. Aliasový false-delete je opraven při klasifikaci;
závod mezi seznamem a novým bindingem zůstává. Je zaevidovaný jako
`docs/findings/006-model-cleanup-bypasses-registry-guard.md` a tento checkpoint
proto netvrdí atomickou bezpečnost všech delete cest.

Nezávislý review navíc reprodukoval retention residual: produkční SQLite
`used_at` a ISO cutoff se porovnávají jako řetězce a na stejném kalendářním dni
mohou obrátit časové pořadí. Je oddělený jako `finding 007`; canonical alias
test nyní používá produkční SQLite timestamp, ale záměrně netvrdí opravu cutoff
policy.

### Focused a povinné ověření checkpointu 6

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check src/upgrade/model-identity.js` | syntax valid | 0 |
| `node --check src/upgrade/model-registry.js` | syntax valid | 0 |
| `node --check src/upgrade/upgrade-manager.js` | syntax valid | 0 |
| `node --check src/routes/system.js` | syntax valid | 0 |
| `node --check tests/m1-model-identity.test.js` | syntax valid | 0 |
| `node tests/m1-model-identity.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-contract.test.js` | 28 passed, 0 failed, 0 skipped | 0 |
| `node tests/model-upgrade.test.js` | 58 passed, 0 failed, 0 skipped | 0 |
| `node tests/upgrade-apply.test.js` | 32 passed, 0 failed, 0 skipped | 0 |
| `node tests/upgrade-flow.test.js` | 28 passed, 0 failed, 0 skipped | 0 |
| `node tests/model-upgrade-phase2.test.js` | 108 passed, 0 failed, 0 skipped | 0 |
| `node tests/model-upgrade-phase3.test.js` | 68 passed, 0 failed, 0 skipped | 0 |
| `node tests/validation-suites.test.js` | 73 passed, 0 failed, 0 skipped | 0 |
| `node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed, 0 skipped | 0 |
| `node tests/routes-smoke.test.js` | 109 passed, 0 failed | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | 365 programů, 8 exclusions, fingerprint `25babf6224c53a34d81822e8c039b7e062e118cd3d34c7aaee8b07c8eb38abb0` | 0 |
| `node tests/repository-hygiene.test.js` | 1 481 trackovaných cest po explicitním stagingu | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

### Mutační signál

Sedm samostatných minimálních mutací proběhlo pouze v pracovním stromu a bylo přesně
vrácené před čistým během:

- canonical comparator nahrazený exact string rovností: **5 passed / 9 failed**,
  exit `1`; zčervenaly binding, overview, auto-clean, route, filtering,
  apply i integrity;
- znovuzavedený `assignModel()` v integrity candidate větvi:
  **13 passed / 1 failed**, exit `1`, přesně na nulové mutaci;
- odstraněný vnější auto-clean binding guard: **13 passed / 1 failed**,
  exit `1`, protože bound alias došel do `deleteModel()` callu;
- jednostranná canonicalizace vnějšího auto-clean guardu po review:
  **15 passed / 1 failed**, exit `1`, na opačném `:latest` → bare směru;
- jednostranný validating guard ve stejné auto-clean hranici:
  **15 passed / 1 failed**, exit `1`, protože reverse-validating alias došel k
  delete callu;
- broadcast vložený pouze do `DETECTED` větve bez kandidáta:
  **15 passed / 1 failed**, exit `1`, na nulové mutaci;
- odstraněný stabilní source-model tie-break při stejném validation timestampu:
  **15 passed / 1 failed**, exit `1`, na nezávislosti vůči pořadí DB řádků.

Po prvních třech návratech skončila tehdejší čistá sada 14/0; po review doplnila
obousměrné hranice, `DETECTED` a tie-order důkaz a finální čistá sada skončila
16/0. GPU ani Ollama tento checkpoint nespustil.

## Checkpoint 7 — commitnutelný runtime profil pro kalibraci 4096

Nový `src/llm/model-runtime-profile.js` je exaktní sedmipoložkový policy
artefakt. Váže `qwen3.5:27b`, jeho schválený digest, kalibrační
`contextWindowTokens=4096`, 1 024 MiB headroom, 100% GPU residency a
`fallbackPolicy=forbid`. Neobsahuje odhad vah ani KV cache, a proto sám
neautorizuje fyzický `FIT` nebo GPU PASS.

`model-ctx.js` používá profil jako default před dokončením asynchronní startup
inicializace a jako strop cache. Request jej může snížit; jiný model profil
nedědí. Legacy gateway i `callWithPolicy()` používají stejný resolver, takže
tentýž omezený kontext jde do M1 VRAM preflightu i provider wire. Test používá
trusted footprint hranici, na níž 4096 projde, zatímco raw 8192 je fyzický
`NONFIT`; tím nepinuje jen výsledný JSON body.

Conversation compaction vytvoří jeden zmrazený budget a předá jej celé
operaci. Tentýž snapshot řídí threshold, safety truncation, model a explicitní
provider `num_ctx` i post-compaction fill. Test během `getAllTurns()` změní
globální summary model a prokazuje, že pozdější fáze autoritu znovu nečtou.
Media VRAM manager může cache po snapshotu bezpečnostně snížit; tento residual
je oddělený ve findingu 003 a budoucí oprava má compaction zrušit/retrynout,
nikoli obejít nižší cap.

T3 pilot nyní před prvním modelovým efektem pinuje profil, runtime CHAT binding
i exaktní registry kontrakt. Provider-effect flag vzniká až na validním
`POST /api/chat`, ne před preflightem. Jedna acceptance funkce vyžaduje
post-call headroom, minimum všech 100ms monitorovaných vzorků a residency v
exaktním rozsahu 100–100 %. Sanitizované `monitoredMinimumFreeMiB`,
`postCallFreeMiB` a allocation vstupy se zapisují i do failure reportu. Nový
GPU/Ollama běh tento checkpoint **nespustil**; 4096 zůstává NOT RUN
kalibrační kandidát a autoritativní 8192 FAIL se nemění.

### Focused offline ověření checkpointu 7

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check src/llm/model-runtime-profile.js` | syntax valid | 0 |
| `node --check src/llm/model-ctx.js` | syntax valid | 0 |
| `node --check src/llm/gateway.js` | syntax valid | 0 |
| `node --check src/chat/context-compact.js` | syntax valid | 0 |
| `node --check tests/m1-model-gpu-pilot.test.js` | syntax valid | 0 |
| `node tests/model-ctx.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `node tests/context-compact-model-ctx.test.js` | 2 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-contract.test.js` | 29 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-gpu-pilot.test.js --self-check` | `SELF_CHECK_PASS`, žádný provider/GPU effect | 0 |
| `node tests/llm-gateway-runtime-signal.test.js` | 7 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | 365 programů, 8 exclusions, fingerprint `25babf6224c53a34d81822e8c039b7e062e118cd3d34c7aaee8b07c8eb38abb0` | 0 |
| `node tests/repository-hygiene.test.js` | 1 482 trackovaných cest po explicitním stagingu | 0 |
| `node tests/nightly-audit-runner-self-test.js` | `nightly audit runner self-test: PASS` | 0 |
| `node tests/nightly-orchestrator-self-test.js` | známý release-policy drift: deterministic registry obsahuje non-active/optional sady | 1 |
| `git diff --check` | bez whitespace chyb | 0 |

### Mutační signál checkpointu 7

Každá mutace byla po běhu přesně vrácena před čistou baterií:

- profilový kontext `4096 → 8192`: `11 passed / 5 failed`, exit `1`;
- odstraněný cap legacy gateway: `28 passed / 1 failed`, exit `1`;
- raw policy kontext použitý ve VRAM preflightu: `28 passed / 1 failed`, exit
  `1` na trusted FIT/NONFIT hranici;
- návrat statických `32768` zvlášť do compaction truncation a post-fill:
  pokaždé `1 passed / 1 failed`, exit `1`;
- pozdní nové načtení summary modelu místo snapshotu: `1 passed / 1 failed`,
  exit `1` na modelovém race fixture;
- odstraněná kontrola monitorovaného minima: pilot self-check exit `1` s
  přesným `monitored-headroom` guard failure;
- odstraněná failure observation z typované GPU chyby: pilot self-check exit
  `1`, protože přesné monitorované minimum zmizelo;
- odstraněný jeden initial-safety reason: pilot self-check exit `1`, protože
  exact seřazená množina důvodů nesouhlasila.

Nezávislý read-only diff review po doplnění failure evidence, doslovných schema
pinů a summary-model race vrátil `UPDATED PASS`. Během práce se objevil cizí
untracked `docs/review/2026-08-08-MODULE-INDEPENDENCE.md`; vlastnictví je
`UNKNOWN`, soubor nebyl čten ani změněn a z B3 checkpointu je explicitně
vyloučen.

## Checkpoint 8 — fail-closed JSON settings authority pro B3-FAILOVER

Nový `src/db/user-settings.js` odděluje platný JSON dokument od missing,
malformed a DB-error stavu. Modelový opt-in je `true` pouze při literal boolean
`models.autoFailoverEnabled: true`; všechny ostatní stavy jsou typované a
default-off. `updateModelSettings()` používá jednu SQLite transakci, zachovává
neznámé klíče a odmítne přepsat poškozený dokument. Checkpoint nemění
`config.models`, nevolá provider, pull, delete ani scheduler.

Read-only call-graph audit současně potvrdil, že plná aktivace ještě nemá
poctivý kontrakt: generický `/api/settings` může mimo helper nahradit celý
dokument a existující role score nemá digest. Tyto dvě hranice jsou zapsané v
rozhodnutí 006 a checkpoint je nevydává za vyřešené.

### Focused ověření checkpointu 8

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-model-settings.test.js` | 14 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --write-doc` | 366 programů, fingerprint `f98e730c8688ad36f3fd9c922e426122b4a035debbd78814589e3f3ea028364a` | 0 |

Širší focused baterie po opravě reviewerem nalezené sibling-invalid chyby:
schema migrations `28/0`, model identity `16/0`, artifact validation `151/0`,
registry valid a `git diff --check`, vše exit `0`. Minimální mutace, která při
neplatném `autoCleanupDays` ponechala dříve načtené
`autoFailoverEnabled:true`, skončila `11 passed / 1 failed`, exit `1`; selhal
přesně nový fail-closed test. Mutace byla vrácena a čistá focused sada znovu
skončila `14/0`. GPU ani Ollama se v tomto checkpointu nespouštějí.

Nezávislý read-only review vrátil pro tento prerequisite checkpoint `PASS`.
Před finálním během zachytil kromě sibling-invalid chyby také nepravdivé
obalení updater chyb jako DB failure a test, který pouze tvrdil restart nad
stejnou in-memory connection. Finální verze rozlišuje updater, serialization,
DB read/write i unexpected transaction chyby, skutečně zavře a znovu otevře
file-backed SQLite a pinuje `BEGIN IMMEDIATE`. Review výslovně nepotvrdilo celý
D+ failover; legacy whole-document writery zůstávají otevřenou hranicí.

## Checkpoint 9 — fail-closed storage schema pro B3-FAILOVER

Migrace 046 vytváří čtyři oddělené persistentní kontrakty: versioned desired
binding, incident projection s nezávislým `row_version`, append-only
digest-bound role-suite proof a append-only event audit. SQL constrainty
odmítají neznámé role, nekanonický digest, neinteger revision, role/suite
nesoulad, výsledek pod deklarovanými PASS prahy a active failover bez čerstvého
proofu shodného v roli, canonical modelu, digestu a policy. Totéž chrání
append-only `verified` audit; projection nemůže ukazovat na event jiné role,
revision, episode, row version nebo stavu. `active_event_id` drží skutečný
terminal activation/reapply audit i v době, kdy `last_event_id` sleduje
pozdější claim; claim event bez odpovídajícího claim tuple DB odmítne. Terminal
event navíc vyžaduje živý claim stejné role, revision, episode, operation,
policy, časového okna a bez přeskočení `row_version`. Druhý běh všech 48
migrací je no-op se shodným schema snapshotem.

Tento checkpoint **neimplementuje** repository ani runtime state machine.
Neprokazuje stale-CAS přes dvě SQLite connections, claim recovery, skutečnou
modelovou validaci, scheduler, restore ani startup rehydrate. Žádný runtime
modul nové tabulky nekonzumuje; failover zůstává default-off a L0-9 beze změny.

### Focused ověření checkpointu 9

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-model-failover-schema.test.js` | 9 passed, 0 failed, 0 skipped | 0 |
| `node tests/schema-migrations.test.js` | 28 passed, 0 failed; 48 migrací | 0 |
| `node scripts/validate-test-registry.js --write-doc` | 367 programů, fingerprint `9574f104464c9fd403367c295831a95a64c38754d6f8c0ed67d10e1b5e85f340` | 0 |

Nová suite běží na skutečném file-backed SQLite v izolovaném artifact rootu,
nikoli jen na mocku. GPU ani Ollama se v tomto checkpointu nespouštějí. Cizí
untracked `docs/review/2026-08-08-MODULE-INDEPENDENCE.md` zůstává vlastnictví
`UNKNOWN`, nebyl čten ani změněn a není součástí commitu.

První nezávislý read-only review vrátil `CHANGES_REQUIRED`: schema připouštělo
ručně označený `0/6 PASS`, špatnou suite, expirovaný/policy-mismatched proof a
append-only `verified` event s proofem cizí role. Oprava přidala role→suite
vazbu, explicitní score/count prahy, čas/policy kontroly, obsahové proof triggery
pro activation/reapply/restore a vazby projection→audit. Tři cílené mutace po
jedné odstranily count práh, rozšířily CHAT suite o vision a odstranily role
match z verified-event triggeru; každá skončila `7 passed / 1 failed`, exit `1`,
a byla před čistým během přesně vrácena.

Druhý review odhalil, že samotný `last_event_id` mohl active projection ukotvit
v neterminálním `ACTIVATION_CLAIMED` eventu a že `activated_at_ms` nebyl svázán
s časem proofu. Oprava oddělila autoritativní `active_event_id`, váže jej na
obsahově shodný `ACTIVATED/REAPPLIED` event a dovolí claim jako poslední audit
jen se shodným state claim tuple. Negativní test nyní samostatně odmítá pozdní
activation time i claim event bez claimu. Pozitivní round-trip současně provádí
platný `REAPPLY` claim, nový fresh proof a terminal `REAPPLIED` bez přepsání
původního času aktivace. Následný audit doplnil desired-binding join přímo do
`ACTIVATED/REAPPLIED` proof triggeru, takže ani osamocený `verified` event
nemůže nést cizí desired model, digest nebo revision.

Třetí adversarial review našel, že úspěšný terminal event šlo zapsat bez
předchozího claimu. Nový terminal-claim trigger proto přijme `ACTIVATED`,
`REAPPLIED` nebo `RESTORED` pouze nad živým matching claimem. Focused důkaz
odmítá chybějící claim, cizí operation, expirovaný claim i přeskočenou verzi;
pozitivně provádí ACTIVATE, REAPPLY a RESTORE. Neúspěšný claim-event + state
update běží v testu v jedné transakci a ověřuje nulový osiřelý audit po
rollbacku. Produkční repository s `BEGIN IMMEDIATE`, dvěma connections a
skutečným CAS zůstává dalším checkpointem, nikoli tvrzením tohoto schématu.

Finální dva nezávislé read-only průchody na shodných SHA-256
`4c9ce64c…a56d81` (migrace) a `24ceb1a0…b5cc2` (test) vrátily `PASS` pouze pro
storage kontrakt; oba znovu naměřily `9/0`, exit `0`. Cílená mutation kontrola
potom dočasně odstranila vazbu terminal eventu na `claim_operation_id`.
Focused sada zčervenala přesně na wrong-operation aserci: `8 passed / 1 failed`,
exit `1`. Guard byl přesným patchem vrácen, dva vlastněné failure artifact
adresáře byly odstraněny a čistý běh skončil znovu `9/0`, exit `0`.

## Checkpoint 10 — inertní repository a claim CAS pro B3-FAILOVER

Nový `src/upgrade/model-failover.js` přidává storage-only repository nad
migrací 046. Umí observačně zapsat config/legacy desired binding, založit první
incident a přidělit časově omezený `ACTIVATE`, `RESTORE` nebo `REAPPLY` claim.
Repository vlastní clock, episode/event/operation identity i claim token; caller
se je nemůže pokusit podstrčit. Každá mutace běží v `BEGIN IMMEDIATE` a auditní
event s projekcí tvoří jednu transakci.

Skutečný worker race používá dvě nezávislé `better-sqlite3` connections nad
stejným file-backed DB. V obou řízených pořadích vznikl právě jeden vítěz,
právě jeden `MODEL_FAILOVER_STALE_STATE` loser, nula `SQLITE_BUSY` výsledků a
právě jeden claim event. Samostatný trigger shodil claim state update až po
vložení eventu; další dva triggery samostatně odmítly desired a detection
projekci. Všechny tři rollbacky ponechaly nulový orphan audit. Skutečný close
a reopen potvrdil persistenci desired, incident a redigovaných claim metadata.

Reviewerem nalezené authority mezery byly před checkpointem zavřeny:

- `USER_APPLY` a `USER_ROLLBACK` failují jako neimplementovaný manual seam,
  protože bez jedné override+desired+supersede transakce by audit nebyl pravdivý;
- opakovaná detection s claimem nebo cizí policy se nevydává za idempotentní;
- busy, identity collision, storage-contract violation a corrupt event JSON
  mají oddělené typované chyby;
- claim CAS v `WHERE` pinuje revision, episode, row version, state,
  `active_failover`, policy a absenci claimu;
- změna observační autority config↔legacy zvýší desired revision, i když se
  canonical jméno a digest nezmění.

### Hranice checkpointu 10

Repository není importované žádným runtime modulem a neprovádí modelový, síťový,
Ollama, GPU, config ani broadcast efekt. Neexistuje proof creation/validation,
terminal activation nebo restore, manual supersede, claim renew/reclaim,
runtime apply, opt-in consumer, startup rehydrate ani scheduler. Pětiminutový
lease není finální modelová policy a repository se nesmí připojit k dlouhému
proof runneru před recovery checkpointem. Restart test dokládá persistenci, ne
obnovu vlastnictví rozpracovaného claimu. L0-9 se nemění.

### Focused ověření checkpointu 10

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-model-failover-repository.test.js` | 11 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-failover-schema.test.js` | 9 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-settings.test.js` | 14 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-identity.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `node tests/schema-migrations.test.js` | 28 passed, 0 failed; 48 migrací | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node tests/repository-hygiene.test.js` | 1 488 trackovaných cest | 0 |
| `node scripts/validate-test-registry.js --write-doc` | 368 programů, fingerprint `ed1565a94d902224f08a87c8d37e8381ca65d7f3e1365e3e02334d5d79a1ad16` | 0 |
| `node scripts/validate-test-registry.js --json` | valid; 368 programů; 8 exclusions; stejný fingerprint | 0 |
| `node --check src/upgrade/model-failover.js` | bez syntax chyby | 0 |
| `node --check tests/m1-model-failover-repository.test.js` | bez syntax chyby | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

Dvě jednotlivé mutace prokázaly citlivost evidence. Nahrazení
`transaction.immediate()` deferred voláním shodilo přesně mode-pin test
(`8/1`, exit `1`). Odstranění stale-row prechecku shodilo worker race i
two-snapshot test (`7/2`, exit `1`) a změnilo loser výsledek na nepravdivý
`CLAIM_HELD`. Obě mutace byly přesným patchem vráceny; čistý běh skončil
`9/0`, exit `0`; po doplnění busy/identity/corrupt-storage a samostatných
desired/detection rollback důkazů skončila finální focused sada `11/0`, exit
`0`.

GPU ani Ollama se v tomto checkpointu nespouštějí. Kanonický T3 běh na 4096
zůstává samostatně blokovaný požadavkem runneru na čistý porcelain, protože
cizí untracked `docs/review/2026-08-08-MODULE-INDEPENDENCE.md` má vlastnictví
`UNKNOWN`. Soubor nebyl čten, změněn ani zahrnut do tohoto checkpointu.

## Checkpoint 11 — auditované uvolnění expirovaného claimu

Nová migrace 047 přidává DB trigger pro `CLAIM_EXPIRED`. Event lze vložit jen
pro přesnou desired revision, episode, row version, operation, policy, stav a
digest existujícího claimu a pouze při `createdAt > claimExpiresAt`. Rovnost na
expiry hranici je tedy dál živý claim. Repository metoda `expireClaim()` vloží
event a plným CAS vyčistí operation, token, kind, start i expiry v jedné
`BEGIN IMMEDIATE` transakci. Failure po vložení eventu rollbackne event i stav.

Přesné opakování vrátí `ALREADY_EXPIRED` bez nového auditního záznamu; reuse
stejného operation s jiným claim kindem není vydán za retry. Caller nemůže
podstrčit clock, event, operation authority ani token. Read API, audit details
a typovaná chyba token neobsahují. Po uvolnění lze na novém row version použít
existující `claimOperation()`; starý token ani starý snapshot už autoritu
nemají.

Skutečný race používá dva worker thready, dvě nezávislé WAL connections a
bariéru po načtení shodného `rowVersion=2`. Výsledkem je přesně jeden
`EXPIRED`, jeden `ALREADY_EXPIRED`, jeden společný expiry event a žádný
`MODEL_FAILOVER_DB_BUSY`. Expirace a následný nový claim jsou vědomě dvě
transakce: po crashi může projection zůstat bez claimu a v nové soutěži může
vyhrát jiný worker. Evidence proto netvrdí atomický same-worker reclaim.

### Hranice checkpointu 11

Repository stále není připojené k runtime. Checkpoint neprovádí provider,
Ollama, GPU, config, override, broadcast, terminal activation, restore ani
scheduler efekt. RESTORE/REAPPLY expiry dostanou vlastní aktivní-state fixture
až s terminal writerem. Read-only call-graph audit současně prokázal, že
legacy validation cache nemůže vydat D+ PASS proof: nemá roli, digest, policy,
contract hash, immutable run ani inventory snapshots a neexistuje schválený
suite-level práh. Rozhodnutí 015 proto volí vratný measurement-only default a
blokuje jen proof issuance/terminal activation do schválení prahů a TTL.

### Focused ověření checkpointu 11

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-model-failover-repository.test.js` | 14 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-failover-schema.test.js` | 10 passed, 0 failed, 0 skipped | 0 |
| `node tests/schema-migrations.test.js` | 28 passed, 0 failed; 49 migrací | 0 |
| `node tests/m1-model-settings.test.js` | 14 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-identity.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node tests/repository-hygiene.test.js` | 1 490 trackovaných cest | 0 |
| `node scripts/validate-test-registry.js --json` | valid; 368 programů; 8 exclusions; fingerprint `ed1565a9…1ad16` | 0 |
| `node --check src/upgrade/model-failover.js` | bez syntax chyby | 0 |
| `node --check src/db/migrations/2026_08_08_047_model_failover_claim_expiry.js` | bez syntax chyby | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

Test-truth audit nejprve prokázal tři zelené mutace. Po doplnění jednotlivých
authority-field asercí, přesných trigger-field negativních případů a
claim-free/non-expiry row fixture už všechny zčervenají: změna strict expiry
`<` na `<=` dává schema `9/1`, odstranění zákazu caller `claimToken` dává
repository `13/1` a odstranění vazby idempotentního retry na konkrétní
`CLAIM_EXPIRED` event dává repository `13/1`; všechny tři příkazy končí exit
`1`. První diagnostický pokus byl omylem piped do `tail` bez `pipefail`, takže
shell vydal nepravdivý exit `0`; tento výsledek nebyl přijat jako evidence a
všechny mutace byly znovu spuštěné s `set -o pipefail`. Guardy byly přesnými
patchi vrácené, čistá focused sada skončila `14/0` a `10/0`, exit `0`, a pět
přesně identifikovaných mutation failure artifact adresářů bylo odstraněno.

Nezávislý read-only review před posledním test-truth doplněním nenašel
data-integrity blocker a samostatně reprodukoval repository `13/0`, schema
`10/0`, migration `28/0` se 49 migracemi, syntax i diff check. Cizí untracked
`docs/review/2026-08-08-MODULE-INDEPENDENCE.md` zůstává `UNKNOWN`, nebyl čten,
změněn ani zahrnut. GPU, Ollama a síť se nespouštějí.

## Checkpoint 12 — fail-closed measurement policy pro B3-FAILOVER

Nový `src/upgrade/model-failover-proof-policy.js` je inertní, jediná
measurement autorita pro budoucí isolated runner. Pinuje raw-byte SHA-256 i
délku `model-profiles.js` a `validation-suites.js`, znovu odvozuje přesných 7
rolí, 5 suit a 36 ordered test IDs a odmítá jednostranný role/suite drift.
Contract používá verzovaný `sorted-key-json-utf8-v1`; řadí objektové klíče,
zachovává pořadí polí a fail-closed odmítá ztrátové nebo vykonávané hodnoty.

Varianty 015/A i 015/B mají připravený stabilní šev: jeden globální proof TTL a
role-specific score/count prahy. Vratný default C drží issuance vypnuté a
všech 15 hodnot `null`. Guard kromě explicitního `true` vyžaduje score v
`(0,1]`, kladný count v rozsahu konkrétní suite, kladný integer TTL a explicitně
vyčištěný blocking reason. Role
measurement hash není pojmenovaný ani použitelný jako `role_contract_sha256` a
nemůže vytvořit proof, terminal transition ani runtime efekt.

Policy není modelový běh. Legacy reasoning prompt používá `Math.random()`,
sampling není seedovaný, prompt/grade funkce jsou v dlouho žijícím procesu
mutable a partial cancel aggregate může tvrdit plný total. Navazující runner
proto musí běžet v čerstvém child procesu, zachytit skutečné prompty, options a
ordered výsledky, zkontrolovat source i inventory digest před/po a uložit
immutable measurement artifact. Oddělený proof writer jej smí později svázat
s proofem teprve po schválení acceptance policy; terminal writer musí navíc
znovu ověřit aktuální policy/version/hash. DB trigger tuto živou autoritu sám
nezná.

### Focused ověření checkpointu 12

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-model-failover-proof-policy.test.js` | 9 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-failover-repository.test.js` | 14 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-failover-schema.test.js` | 10 passed, 0 failed, 0 skipped | 0 |
| `node tests/schema-migrations.test.js` | 28 passed, 0 failed; 49 migrací | 0 |
| `node tests/m1-model-settings.test.js` | 14 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-identity.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node tests/repository-hygiene.test.js` | 1 492 trackovaných cest | 0 |
| `node scripts/validate-test-registry.js --json` | valid; 369 programů; 8 exclusions; fingerprint `94d0e298…1c50d` | 0 |
| `node tests/nightly-audit-runner-self-test.js` | `nightly audit runner self-test: PASS` | 0 |
| `node tests/nightly-orchestrator-self-test.js` | očekávaný vývojový drift: deterministic registry obsahuje non-active/optional sady | 1 |
| `node --check src/upgrade/model-failover-proof-policy.js` | bez syntax chyby | 0 |
| `node --check tests/m1-model-failover-proof-policy.test.js` | bez syntax chyby | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

První artifact-validation běh pravdivě zčervenal `150/1`, exit `1`, protože
README po registraci nové ACTIVE sady ještě uvádělo `271` místo `272`. Po
opravě odvozeného počtu skončil čistý rerun `151/0`, exit `0`. Historický Gate
0 pin v nightly orchestrátoru se neměnil: podle vývojového kontraktu není
aktuální registry fingerprint release autoritou a self-test má zůstat červený,
dokud samostatný release WP pravdivě nezapečetí jeho prerekvizity.

Tři jednotlivé mutation kontroly byly spuštěné s `pipefail`: jednobytový drift
expected source hashe dal `2/7`, odstranění recursive key sort `1/8` a vyřazení
issuance guardu `8/1`; všechny skončily exit `1`. Každá mutace byla přesným
patchem vrácena a čistá sada poté skončila `9/0`, exit `0`. Čtyři přesně
identifikované failure artifact adresáře byly přesunuty do koše; produktová
data se nemažou.

Nezávislý read-only design review po opravách znovu spustil focused sadu i
registry validator a checkpoint označil za strukturálně přijatelný pouze jako
measurement-only. GPU, Ollama, server ani síť se nespouštěly. Cizí untracked
`docs/review/2026-08-08-MODULE-INDEPENDENCE.md` nebyl změněn ani staged. Široký
`rg docs` ale omylem vypsal jeden jeho odpovídající řádek; tato read-only
hranice byla porušena a další příkazy už používají jen explicitně jmenované
vlastněné cesty.

## Checkpoint 13 — izolovaný measurement-only role runner

Nový `scripts/run-model-failover-measurement.js` spustí právě jednu roli a
její policy-odvozenou ordered suite v samostatném Node procesu. Nevolá legacy
`ValidationRunner`: prompt factory každé definice zavolá jednou, uloží skutečný
request i plnou terminální odpověď a matematický `_expected` znovu sváže s
vylosovanými operandy. Provider smí být jen exact
`http://127.0.0.1:<port>`; jediné povolené efekty jsou dva
`GET /api/tags`, jeden `POST /api/chat` na každý test a zápis do privátního
artifact rootu.

Child odmítne každý neznámý startup environment klíč i libovolný
`process.execArgv`, poté přepíše runtime na pevný allowlist. Response musí být
validní UTF-8 a kanonický `/api/chat` objekt s `role: assistant`, `done: true`,
bez top-level `error`; raw response, counters a content jsou vzájemně svázané.
Před i po suite se znovu odvodí policy a celý kanonický inventory snapshot;
kandidát musí mít právě jednu canonical identity a stejný exact digest.

Artefakt se nejprve zapíše, nastaví na `0400`, fsyncne a byteově přečte ze
staging inode. Parent summary se flushne před publikací a poslední autoritativní
fallible operací je non-clobber hard link na `measurement.json`. Parent smí
artifact přijmout jen při společné shodě exit `0`, one-line summary, souboru,
hashe a pinované validace; samotná existence souboru není úspěch.
Strukturální validace hlásí `STRUCTURAL_ONLY`; teprve
exaktní pětice parent pinů včetně `sourceRevisionClaim` vrátí
`PARENT_PINS_VERIFIED`. Ani perfektní fake-provider výsledek nevydává PASS:
stav zůstává `NOT_ISSUED`, bez DB, proof, binding nebo broadcast autority.

### Focused a navazující offline ověření checkpointu 13

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-model-failover-measurement.test.js` | 9 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-failover-parent-acceptance.test.js` | 15 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node tests/repository-hygiene.test.js` | 1 497 trackovaných cest | 0 |
| `node scripts/validate-test-registry.js --json` | valid; 371 programů; fingerprint `6e8d9c11…56a53` | 0 |
| stejný focused test, pět dalších po sobě jdoucích běhů před posledním hardeningem | každý 8 passed, 0 failed; následně přibyl UTF-8 test | 0 |
| `node tests/m1-model-failover-proof-policy.test.js` | 9 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-failover-repository.test.js` | 14 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-failover-schema.test.js` | 10 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-settings.test.js` | 14 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-identity.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-contract.test.js` | 29 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node tests/repository-hygiene.test.js` | 1 492 trackovaných cest | 0 |
| `node scripts/validate-test-registry.js --json` | valid; 370 programů; 8 exclusions; fingerprint `8b3c0f76…afe195c` | 0 |
| `node tests/nightly-audit-runner-self-test.js` | `nightly audit runner self-test: PASS` | 0 |
| `node tests/nightly-orchestrator-self-test.js` | očekávaný vývojový drift: `deterministic registry contains non-active or optional suites` | 1 |
| `node --check scripts/run-model-failover-measurement.js` | bez syntax chyby | 0 |
| `node --check tests/m1-model-failover-measurement.test.js` | bez syntax chyby | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

Read-only review nejprve vrátilo `CHANGES_REQUIRED`: našlo prompt a inventory
provenance, kontaminaci přes `NODE_OPTIONS`/přímé Node flagy, nevěrné UTF-8
dekódování a chybu po publikačním bodu. Po opravách a nových negativních
testech skončil focused re-review **READY**, bez P0/P1/P2.

Test-truth kontrola prokázala tři samostatné mutační signály. Odstranění vazby
prompt provenance skončilo `8/1`, vypnutí fatal UTF-8 dekodéru skončilo `8/1`
a odstranění kontroly `process.execArgv` skončilo `8/1`; všechny tři příkazy
měly exit `1`. Guardy byly přesnými patchi vrácené a čistý rerun skončil
`9/0`, exit `0`. Tři přesně identifikované privátní failure artifact adresáře
vlastněné tímto během neměly hlášený otevřený handle a byly přesunuty do koše;
`lsof` současně upozornil, že jeho výpis může být neúplný kvůli nesouvisejícím
Docker mountům. Produktová ani cizí data se nemažou.

### Pravdivé omezení

- Loopback provider i jeho hlášený digest jsou v tomto checkpointu
  parent-selected vstup. Fake provider může lhát; proto artifact nesmí vydat
  proof a budoucí issuer musí mít vlastní provider autoritu.
- Dvě inventory momentky nedokazují, že mutable tag nezměnil obsah mezi
  jednotlivými chat requesty. Digest-bound proof/issuer musí tuto mezeru zavřít.
- Runtime network wrapper omezuje `fetch`; přímé `node:http`, `node:net` nebo
  subprocess efekty budoucích transitive modulů musí zůstat samostatně
  source-pinned a testované.
- Zachycený fail před publikačním bodem může zanechat privátní prázdný run
  adresář, ne finální soubor. Abrupt kill po hard-link commit pointu může
  zanechat neakceptovaný `measurement.json`; proto je exit `0` povinnou
  součástí parent kontraktu. Bounded cleanup je pozdější provozní krok.
- Skutečný T3/GPU/Ollama běh nebyl spuštěn. Auditní runner právem
  vyžaduje čistý porcelain, který nyní blokuje chráněný cizí untracked
  dokument; hranice se neobchází.

Cizí `docs/review/2026-08-08-MODULE-INDEPENDENCE.md` zůstal nedotčený a
nebude zahrnut do checkpoint commitu. GPU, sdílená Ollama, produktový server
ani externí síť nebyly spuštěné.

## Checkpoint 14 — kandidátní parent acceptance bez proof autority

Nový `scripts/run-model-failover-candidate-measurement.js` přijímá pouze roli a
požadované modelové jméno. Provider origin odvozuje z
`config.ollama.baseUrl`; exact observed jméno, canonical identitu a digest ze
striktního `/api/tags`. Caller nemůže dodat provider, digest ani source SHA.
Git běží přes pevné `/usr/bin/git`, ne přes zděděný `PATH`.

Source guard odmítá staged, tracked, untracked i ignorované položky pod
`src/`, `scripts/`, `tests/` a změnu `package.json`. Untracked dokumentace je
z kandidátního scope vynechaná. Konkrétní regresní fixture potvrzuje, že i
untracked migrace objevitelná přes `readdirSync()` běh zastaví před providerem;
další fixture totéž dokládá pro ignorovaný `tests/*.tmp` soubor. Samostatná
mutační kontrola bez `--ignored=matching` tuto ochranu zčervenala.
Po preflightu parent vytvoří privátní export jedenácti přesných mode-100644
blobů kandidátního HEAD. Policy a child se načtou z tohoto exportu, ne ze
živého worktree; před i po měření a znovu těsně před publikací se kontrolují
jeho přesné soubory, hashe, módy, ownership a link count.

Child je přijat pouze při exit `0`, bez signálu a stderr, s jedinou one-line
summary a jediným regular mode-0400 `measurement.json`. Parent znovu ověří
byte length, SHA-256, exact artifact path, inventory před/po a všech pět pinů.
Samostatný receipt má exact-key validator s negativními mutacemi statusu,
source, inventory, candidate digestu, path, timing a effect boundary. Bez
nezávisle předaných parent pinů vrací pouze `STRUCTURAL_ONLY`; self-consistent
forgery source, inventory, candidate digestu a artifact SHA proti původním
parent pinům zčervená. Parent run i source-export root se znovu ověřují po child
procesu a těsně před publikací; focused fixture mění mód celého artifact rootu,
parent runu, source-export rootu i exact child run directory. Statický wiring
guard pinuje spuštění child z HEAD exportu a obsah commit-point callbacku.
Publikace je non-clobber, po odstranění staging linku vyžaduje `nlink=1`,
finální read-back a directory fsync. CLI důkaz navíc váže oba reportované SHA
na skutečné receipt/measurement bytes a odmítá `NODE_OPTIONS` i přímý Node flag.

Výsledek zůstává `NOT_ISSUED`. Tento checkpoint neobsahuje GPU/Ollama
kvalifikaci, proof, DB, binding, config ani broadcast writer. Odmítnutí
`NODE_OPTIONS` je precondition před efekty vlastněnými parentem; nejde o OS
sandbox ani zpětný důkaz, že cizí preload před startem Node nic nevykonal.
Stejně tak `externalNetwork:false` vyjadřuje deklarovanou a source-pinned effect
boundary tohoto přesného exportu, nikoli OS-level zákaz budoucího přímého
`node:http`, `node:net` nebo subprocess efektu. Takové rozšíření import closure
musí zčervenat source pin a vyžaduje nové review i negativní důkaz.

Read-only review současně potvrdil čtyři legacy vady mimo tento inertní
checkpoint: netransakční apply/rollback, předčasné `verified=1`, nepravdivou
chatovou zprávu o ověření a HTTP-only `model_changed`. Jsou explicitně vedené
ve finding 008 s vlastníkem `WP-M1-MODEL / B3-FAILOVER runtime integration` a
termínem před M1 acceptance. Navazující manual storage/repository seam už od
prvního commitu musí držet `verified=0` bez verifikace a append-only rollback,
ale nesmí být vydán za opravu legacy runtime cesty.

Focused běh před širší validační baterií skončil
`tests/m1-model-failover-parent-acceptance.test.js` **15/0**, exit `0`.
Registr po přidání sady obsahuje **371** programů a fingerprint
`6e8d9c111f4b6d70678404fb74e7ef9664dfb07132189f83d4246fd607856a53`.
Skutečný T3/GPU/Ollama běh nebyl spuštěn.

### Širší offline ověření checkpointu 14

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-model-failover-parent-acceptance.test.js` | 15 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-failover-measurement.test.js` | 9 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-failover-proof-policy.test.js` | 9 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-failover-repository.test.js` | 14 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-failover-schema.test.js` | 10 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-settings.test.js` | 14 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-identity.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-model-contract.test.js` | 29 passed, 0 failed, 0 skipped | 0 |
| `node tests/schema-migrations.test.js` | 28 passed, 0 failed; 49 migrací | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node tests/repository-hygiene.test.js` | 1 494 trackovaných cest | 0 |
| `node scripts/validate-test-registry.js --json` | valid; 371 programů; 8 exclusions; fingerprint `6e8d9c11…56a53` | 0 |
| `node tests/nightly-audit-runner-self-test.js` | `nightly audit runner self-test: PASS` | 0 |
| `node tests/nightly-orchestrator-self-test.js` | očekávaný vývojový drift: `deterministic registry contains non-active or optional suites` | 1 |
| `node --check scripts/run-model-failover-candidate-measurement.js` | syntax valid | 0 |
| `node --check tests/m1-model-failover-parent-acceptance.test.js` | syntax valid | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

Nezávislý read-only reviewer dal tomuto inertnímu checkpointu
`APPROVE / READY TO COMMIT`, P0=0 a P1=0. Zapsal jeden neblokující P2:
v tomto okamžiku commitnutý child writer fsyncnul svůj directory před finálním
hardlinkem, nikoli znovu po něm. Následná validace chybějící artifact fail-closed
odmítla, ale crash-durability child publication nebyla stejně silná jako u
parent receipt. Následující checkpoint tento P2 uzavírá bez změny
`NOT_ISSUED` hranice.

Druhý nezávislý test-truth re-audit rovněž skončil `APPROVED`: reprodukoval
15/0 a potvrdil červený signál pro export wiring, commit-point ordering,
`process.execArgv`, summary SHA, trusted-authority projection i hardlink guard.
Tři LOW hardening reziduály zůstávají explicitní: rozdělit kombinovanou
self-consistent forgery na per-field mutace, svázat i tři convenience pole CLI
summary a v pozitivní fixture nezávisle porovnat každý export s `git show`.
Čtvrtý původní bod — lexikálně pinovat `chmod(0400)` před file fsync — uzavírá
checkpoint 15. Žádný zbývající bod nemění aktuální `NOT_ISSUED` výsledek ani
neblokuje tento checkpoint.

Jedenáct přesně pojmenovaných test-owned adresářů této sady bylo po kontrole
vlastníka a módu přesunuto do systémového koše, nikoli nevratně smazáno.
`lsof` nehlásil otevřený handle, ale jeho výpis mohl být neúplný kvůli
nesouvisejícím Docker mountům. Produktová ani cizí data nebyla dotčena.

## Checkpoint 15 — durable namespace child measurement artifactu

Child writer nyní po non-clobber hardlink publication odstraní staging jméno a
teprve poté znovu fsyncne run directory. `chmod(0400)` zůstává před file fsync;
hardlink, autoritativní unlink i post-link directory fsync mají staticky
zapinované pořadí. Pozitivní fixture navíc vyžaduje finální `nlink=1`.

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-model-failover-measurement.test.js` | 9 passed, 0 failed, 0 skipped | 0 |

Změna nevolá GPU, Ollamu, produktový server ani externí síť a nevydává proof.

Při širokém hledání B3 přes glob `docs/review/2026-08-08-*` se omylem vypsalo
pět odpovídajících řádků z chráněného
`docs/review/2026-08-08-MODULE-INDEPENDENCE.md`. Soubor nebyl upraven, staged
ani dále čten; navazující dotazy jej explicitně vylučují. Jde o přiznané
porušení read-only hranice, ne o změnu cizí práce.

## Checkpoint 16 — append-only manual binding storage lineage

Migrace 048 přidává pouze storage autoritu pro budoucí
`USER_APPLY/USER_ROLLBACK`. Operation journal nese request key, exact
předchozí a cílovou name/canonical/digest identitu, očekávanou a commitnutou
revision, aktéra, policy a shodný append-only `DESIRED_CHANGED` event. Každá
operace je pevně `NOT_VERIFIED` a `NOT_APPLIED`; žádný proof sloupec ani runtime
efekt neexistuje. Rollback je nový řádek s přímým odkazem na jediný apply a
další manual apply musí uvést operaci, která vytvořila aktuální revision.

Migrace fail-close odmítne preexistující manual projection bez doložitelné
operation lineage. Manual projection nelze zapsat bez odpovídajícího eventu a
journalu, přehrát starou operation nad novější revision, přepsat manual source
na legacy authority, smazat ani nahradit přes SQLite `INSERT OR REPLACE` při
výchozím `recursive_triggers=0`. Incident-shaped row/episode/details audit se
odmítne. DETECTED, aktivně claimnutý i ACTIVATED incident blokuje manual
operation, dokud repository neumí atomický `SUPERSEDED_BY_USER`; nevznikne ani
orphan intent. UPDATE/DELETE journalu se odmítá a transaction failure nenechá
event, operation ani projection orphan. `model_overrides`, `upgrade_history`,
runtime config, provider, HTTP/chat a broadcast zůstaly nedotčené.

Tento checkpoint proto **neopravuje** legacy `applyUpgrade()` ani
`rollbackUpgrade()`. Finding 008 zůstává `OPEN / ASSIGNED`: manual repository
API, atomický `SUPERSEDED_BY_USER` přechod a sjednocení skutečného HTTP/chat
provozu jsou další samostatné kroky s termínem před M1 acceptance.

### Focused a širší offline ověření

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `C3_LOG_LEVEL=error node tests/m1-model-binding-storage.test.js` | 11 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-failover-schema.test.js` | 10 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-failover-repository.test.js` | 14 passed, 0 failed, 0 skipped; manual repository guard zůstává zavřený | 0 |
| `C3_LOG_LEVEL=error node tests/schema-migrations.test.js` | 28 passed, 0 failed; 50 migrací | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node tests/repository-hygiene.test.js` | 1 499 staged/tracked cest | 0 |
| `node scripts/validate-test-registry.js --json` | valid; 372 programů; 8 exclusions; fingerprint `15763d7a…1651bed` | 0 |
| syntax obou nových JS souborů | bez chyby | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

Devět cílených mutací prokázalo test truth:

| Odstraněná garance | Mutační výsledek | Exit |
|---|---:|---:|
| pevné `NOT_VERIFIED` | 10 passed / 1 failed | 1 |
| exact rollback lineage | 10 passed / 1 failed | 1 |
| manual projection vyžaduje operation journal | 9 passed / 2 failed | 1 |
| další manual apply vyžaduje exact predecessor | 10 passed / 1 failed | 1 |
| exact `OLD → NEW` blokuje stale replay | 10 passed / 1 failed | 1 |
| manual source nemůže uniknout do legacy authority | 10 passed / 1 failed | 1 |
| incident guard před operation journalem | 10 passed / 1 failed | 1 |
| manual audit odmítá incident row/episode/details | 10 passed / 1 failed | 1 |
| manual projection nelze obejít přes `INSERT OR REPLACE` | 10 passed / 1 failed | 1 |

Po každé mutaci byl přesný guard vrácen přesným patchem; finální čistý focused
focused běh skončil 11/0. Čtyři přesně identifikované zachované artifact
adresáře z očekávaně červených mutací byly po ověření odstraněny; jiné soubory
se nemažou. GPU, Ollama, produktový server ani externí síť nebyly spuštěny.
Tři cizí untracked soubory v `docs/review/` a cizí
`docs/decisions/016-migration-identity-guard.md` nebyly upraveny ani zahrnuty.

## Checkpoint 17 — schema autorita pro manual incident supersede

Commit `63e86293b5b72e4d2e58d2267cf5f149af93c262` přidal migraci 049 a
uzavřel první krok `WP-M1-BINDING-REPOSITORY`. Manual apply/rollback lze nad
přesným `DETECTED` nebo live `ACTIVATE`-claimed incidentem commitnout pouze
společně s desired změnou, auditním `SUPERSEDED_BY_USER` a terminálním CAS.
Event i projekce znovu ověřují původní lineage; `RESTORED` a
`SUPERSEDED_BY_USER` jsou neměnné. `RESTORED` se záměrně nedá retireovat.

Negativní aserce vlastní stabilní identifikátory guardů a mají pozitivní
protějšky. Při implementaci čtyři cílené mutace samostatně odstranily state-lineage guard,
event-lineage guard, terminal immutability a actor-whitespace guard. Každá
mutace skončila přesně jedním selháním (`15/1`, exit `1`); po vrácení guardu
focused storage sada skončila `16/0`, exit `0`. Raw příkazy a výstupy mutací
nebyly zachované a v tomto evidence kroku se znovu nespouštěly; reprodukovaná
je čistá focused sada níže.

Migrační preflight už nebyl budoucím kritériem: `ROADMAP.md` §5 jej převedla
do doloženého minulého času a přímo odkazuje na
[`rozhodnutí 016`](../../decisions/016-migration-identity-guard.md).

## Checkpoint 18 — atomický manual binding repository

Commit `515fb6f7409ea9ca916f88c1785a4ec032c3121b` uzavřel druhý krok
`WP-M1-BINDING-REPOSITORY`. `recordUserBindingApply()` a
`recordUserBindingRollback()` mají exact input allowlist a jediný top-level
`BEGIN IMMEDIATE` commit point přes event, append-only operation, desired
revision a případný incident supersede. Request-key replay je idempotentní i po
restartu; rollback je nový přímý reversal, nikdy `DELETE` lineage.

Výstup zůstává pravdivě `PENDING_MANUAL / NOT_VERIFIED / NOT_APPLIED`.
Repository nevytváří proof, `model_overrides`, runtime config ani broadcast.
Aktivní incident vrací typovaný runtime-coordinator blocker s rolí, epizodou a
stavem. `FAILED` a `RESTORED` blocker navíc nesou `activeFailover` a
`failurePhase`. Failure injection po retirementu u apply i rollback obnoví
celý authority snapshot.

Při implementaci čtyři repository mutace prokázaly samostatný červený signál: odstranění exact
input allowlistu skončilo `13/1`, odstranění `FAILED` guardu `13/1`, odstranění
terminal retirementu `13/1` a odstranění top-level transakce `9/5`; všechny
mutace měly exit `1`. Po přesném vrácení změn skončil focused test `14/0`,
exit `0`. Raw příkazy a výstupy mutací nebyly zachované a v tomto evidence
kroku se znovu nespouštěly; reprodukovaná čistá sada níže je proto silnější
důkaz současného stavu než historický popis mutací.

### Reprodukce na source SHA 515fb6f7

Následující příkazy byly po commitu znovu spuštěné 2026-08-09 nad
`515fb6f7409ea9ca916f88c1785a4ec032c3121b`. Cizí změny byly pouze v
`docs/**`; žádný test nepoužil GPU, Ollamu, produktový server ani externí síť.

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `C3_LOG_LEVEL=error node tests/schema-migrations.test.js` | 36 passed, 0 failed; 51 migrací | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-storage.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-repository.test.js` | 14 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-failover-schema.test.js` | 10 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-failover-repository.test.js` | 14 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-failover-parent-acceptance.test.js` | 15 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | valid; 373 programů; 8 exclusions; fingerprint `72417b86ac74930fd35e2f3916e88fd5d483e8e7ee56ded3909f49fe489a4690` | 0 |
| `node tests/repository-hygiene.test.js` | 1 502 trackovaných cest | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

Clean-clone kontrola stejného source SHA navíc reprodukovala binding repository
`14/0`, parent acceptance `15/0`, artifact validation `151/0`, registry
fingerprint výše a hygiene nad 1 502 cestami; po odstranění testovacího
`node_modules` symlinku zůstal clone čistý. První parent-acceptance fixture nad
již shodnými source bloby neuměla vytvořit odlišný kandidátní commit. Oprava
použila skutečný `git commit --allow-empty`; nemění source piny a rerun skončil
`15/0`, exit `0`.

### Procesní odchylky a čas

- Přesný aktivní start obou kroků ani operátorský čas nebyly zachyceny;
  nevymýšlejí se zpětně. Gitové dokončení je doložené časy commitů:
  checkpoint 17 `2026-08-09T00:24:33+02:00`, checkpoint 18
  `2026-08-09T00:31:50+02:00`.
- Tento report nebyl omylem aktualizovaný ve stejných dvou produktových
  commitech. Doplňuje jej proto samostatný evidence commit bez změny produktu.
- `ROADMAP.md` §5 byla výslovně vlastněná tímto WP. Commity ale současně
  aktualizovaly `SYSTEM-MAP.md`, decision/finding a ve druhém kroku `README.md`,
  přestože specifické pilotní zadání tyto globální dokumenty po dobu překryvu
  zmrazilo. Historie se nepřepisuje; odchylka je zde explicitní. Nebyl změněn
  `CONTRACT.md` §6, `ROADMAP.md` §12, žádný `docs/wp/**` ani zmrazený
  `docs/review/2026-08-08-*` soubor.
- **Integrační dispozice 2026-08-09:** obsah změn `SYSTEM-MAP.md`, rozhodnutí,
  findingu a `README.md` byl po skončení překryvu znovu porovnán se skutečným
  repository kontraktem a je přijat `ACCEPTED_WITH_PROCESS_DEVIATION`. Historie
  se nepřepisuje: odchylka nemění produktový connector ani měřený checkpoint,
  ale není precedentem pro obcházení hard allowlistu. Vlastníkem uzavření je
  hlavní integrační vlastník; termín byl tento evidence follow-up před dalším
  B3 runtime checkpointem.
- Šest cizích pilotních/governance souborů v pracovním stromu zůstalo
  nedotčených a nevstupuje do tohoto reportu ani commitu. Push nebyl proveden.

### Výsledek pod-WP

`WP-M1-BINDING-REPOSITORY`: **PASS / technicky dokončeno** na source SHA
`515fb6f7409ea9ca916f88c1785a4ec032c3121b`. Celý `WP-M1-MODEL` a Gate 1
zůstávají **BLOCKED**: chybí proof issuer/persistence, terminal
activation/restore, runtime apply, startup rehydrate, scheduler, nový skutečný
GPU běh a rozhodnutí 015 o prazích a proof TTL. Legacy finding 008 zůstává
`OPEN / ASSIGNED`; tento inertní repository checkpoint jej nevydává za opravu.

## Checkpoint 19 — pravdivý manual application-state journal

Migrace 050 zavádí append-only journal skutečných `RUNTIME_APPLY`,
`STARTUP_REHYDRATE`, `VERIFICATION` a `NOTIFICATION` výsledků. Úspěšný runtime
výsledek zapisuje override jako neověřený; `verified=1` vznikne teprve po
úspěšné exact-digest probe aktuální runtime generace. Legacy override hodnoty
se při migraci zachovají, ale stav se pravdivě demotuje na
`LEGACY_UNVERIFIED`. Migrace odmítne falešnou verification method, nesoulad
raw/canonical identity, opakovaný terminál, starou runtime generaci, přepis či
smazání journalu a legacy writer nad manual lineage.

Repository přidává vlastněné recordery a odvozené stavy
`PENDING/APPLIED_PENDING_VERIFICATION/VERIFIED/FAILED`. Fixed operation journal
z checkpointu 16 se záměrně nemění a zůstává `NOT_VERIFIED/NOT_APPLIED`;
aplikační skutečnost je samostatná append-only vrstva. Startup rehydrate otevírá
novou verifikační generaci, úspěšná notification je globálně nejvýše jednou na
durable operation a failure lze auditovaně opakovat. Transaction failure vrací
attempt, override i history společně.

Legacy `upgrade-manager.js` po detekci migrace 050 typovaně odmítne apply i
rollback ještě před providerem, runtime configem a DB efektem. Před 050 zůstává
kompatibilní, ale už netvrdí `verified=true` bez provedené probe a chatová
formulace rozlišuje ověřený a čekající stav. Tento checkpoint proto bezpečně
uzavírá starý writer; společná application service a user journey přijdou v
dalším commitu a Finding 008 zůstává `OPEN / ASSIGNED`.

### Focused ověření před commitem

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `C3_LOG_LEVEL=error node tests/schema-migrations.test.js` | 38 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-storage.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-repository.test.js` | 22 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-failover-schema.test.js` | 10 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/upgrade-apply.test.js` | 33 passed, 0 failed; proces doběhl po uvolnění existujícího timeru | 0 |
| syntax všech změněných JS souborů | bez chyby | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

Negativní mutace dočasně změnila vlastněnou verification method z
`OLLAMA_CHAT_EXACT_DIGEST_V1` na `FAKE_PROBE`. Repository sada zčervenala
`18 passed / 4 failed`, exit `1`; po přesném vrácení změny skončila `22/0`,
exit `0`. Mutace nezůstala v pracovním stromu.

Jeden ručně zadaný příkaz `node tests/model-failover.test.js` skončil exit `1`
na `MODULE_NOT_FOUND`, protože takový test v repozitáři neexistuje. Nešlo o
registrovanou ani WP předepsanou sadu a výsledek není produktové selhání; je
zapsaný jako chyba výběru příkazu. GPU, Ollama, produktový server ani externí
síť nebyly spuštěny.

## Checkpoint 20 — jeden manual binding runtime commit point

Migrace 051 uzavírá runtime generaci: úspěšný startup rehydrate blokuje další
apply stejné operation, non-retryable runtime failure vyžaduje novou manual
operation a skutečný `runtime_changed` rozlišuje změnu od no-opu. Repository
proto zapisuje `upgrade_history` pouze pro skutečný runtime přechod a při
neúspěšném rehydrate zachová starší legacy či manual authority.

Nová `ModelBindingApplication` vlastní strict exact-digest provider, durable
intent, runtime CAS/kompenzaci, append-only apply/rollback, startup rehydrate,
commit-layer `model_changed` a následnou verifikaci. Migrace 052 připíná exact
immutable pull intent před prvním provider efektem a jeho typovaný terminální
výsledek. Provider authority zahrnuje kanonický loopback origin, user actora,
request key, účel, expected binding revision a exact target. Živý provider
effect drží pětiminutový lease obnovovaný po minutě; druhá SQLite connection jej
nepřevezme. Striktně expirovaný recovery claim zvýší fencing revision a stale
worker už nemůže zapsat terminal outcome. Claim je unikátní pro roli a
canonical target v rámci jednoho přesného provider originu; alias originy a
direct pull zatím sdílenou autoritu nemají. DB-assigned command sequence
připíná no-op frontier a append-only junction uzavírá celý terminální prefix.
Pending nebo neuzavřený success blokuje jiný apply, rollback i observable
desired transition; přesné provider dokončení a current-binding no-op jsou
jediné closure cesty podle 018/Q5/A. DB trigger navíc vynutí úplnou
provider→binding lineage. HTTP, chat a
`ModelRegistry` předávají pouze uživatelský záměr; caller nemůže dodat actor,
request key, digest ani verification truth. Server ji vytvoří před LLM
provozem, starý `loadPersistedOverrides()` nevolá a všechny veřejné manual
entrypointy používají stejnou instanci. Startup používá jeden immutable
inventory snapshot, obnoví poslední platný manual override před vyhodnocením
novějšího nedokončeného intentu a exact probe spouští sériově až po listen.
Pomocný `LEGACY_BASELINE_RECOVERY` nikdy nevydá HTTP acceptance; `200 started`
vznikne až po durable `USER_APPLY_TARGET` nebo binding operation. Provider
status se koreluje s aktuální desired revision a nezobrazuje historický
`RECONCILED_ABSENT` jako failure novějšího bindingu.

Focused acceptance používá skutečné migrace, SQLite repository, skutečný
`UpgradeManager` runtime port a test-owned loopback Ollama protokol. Loopback
ověřuje exact `tags → chat → tags`, bounded timeout, malformed/empty odpověď a
digest drift, ale nepředstírá GPU ani skutečný model PASS. Skutečný DB
close/reopen ověřuje manual rehydrate i provider-terminal/pre-binding crash
okno. Nezávislé WAL testy prokazují jeden pull při soutěži application instancí
a serializují provider terminal/no-op i přesné provider completion/current-no-op:
uspěje jen jedna desired autorita. Direct-SQL guard odmítá pending i neuzavřený
success při revision změně i při same-revision změně kteréhokoli authority pole;
stejné pravidlo platí pro `DELETE` a `INSERT OR REPLACE`. Konfliktový insert
nesmí přepsat append-only no-op receipt ani přesunout jeho provider causal
junction k jinému receiptu. Repository stejné pravidlo pinuje pro apply,
rollback a observable baseline.
Legacy override zůstává bez operation/digestu
`LEGACY_UNVERIFIED`. Verification failure ponechá explicitně vybraný model
aktivní jako `FAILED` podle 018/Q1/A. Notification failure je degraded podle
018/Q3/A a replay neopakuje provider, runtime ani broadcast pokus. Pouze
explicitní typed receipt smí označit notification success; současný produkční
void broadcaster proto zůstává pravdivě degraded i po best-effort sendu.

### Focused ověření před produktovým commitem

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `C3_LOG_LEVEL=error node tests/schema-migrations.test.js` | 38 passed, 0 failed; 54 migrací | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-storage.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-repository.test.js` | 39 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-failover-schema.test.js` | 10 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-application.test.js` | 73 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/upgrade-apply.test.js` | 33 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/proposal-stale-cleanup.test.js` | 3 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/routes-smoke.test.js` | 109 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/confirmation-ownership.test.js` | 5 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-identity.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/ws-bridge.test.js` | 68 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/repository-hygiene.test.js` | 1515 tracked paths checked | 0 |
| `node scripts/validate-test-registry.js --json` | valid; 375 programů; 8 exclusions; fingerprint `a2f1e67e…f77b8` | 0 |
| syntax změněných JS souborů | bez chyby | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

Při širokém spuštění byly nejprve omylem použity neexistující cesty
`tests/confirmation-routing.test.js` a `tests/model-identity-contract.test.js`;
oba příkazy skončily `MODULE_NOT_FOUND`, exit `1`, a nespustily žádnou sadu.
Po dohledání registrovaných cest byly skutečné sady
`tests/confirmation-ownership.test.js` a `tests/m1-model-identity.test.js`
spuštěny s výsledky uvedenými výše. Jde o chybu orchestrace, nikoli zelený či
červený produktový výsledek.

### Fresh-clone evidence produktového commitu

Zdrojový checkout byl na čistém stromu commitnut jako
`e7d89b5ef038e1a32ad2fdff3990d6f9f20d9bec`. Bez lokální hardlink optimalizace
byl naklonován příkazem:

```text
git clone --no-local /home/belphareon/Projects/intentsmith \
  /home/belphareon/Projects/intentsmith/.intentsmith-artifacts/fresh-clone-e7d89b5e-sxaMfLwe
```

`git rev-parse HEAD` v klonu vrátil přesný source SHA výše a
`git status --porcelain=v1 -uall` byl před instalací prázdný. `npm ci --offline`
přidal 233 balíčků, auditoval 234 balíčků, našel 0 vulnerabilities a skončil
exit `0`; vypsal pouze deprecation warnings existujících závislostí.

Z tohoto klonu byly beze změny zopakovány všechny přesné testovací příkazy z
tabulky výše. Výsledky: schema migrations 38/0, binding storage 16/0,
repository 39/0, application 73/0, failover schema 10/0, upgrade apply 33/0,
upgrade UX 78/0, proposal cleanup 3/0, routes smoke 109/0, confirmation 5/0,
identity 16/0, WS bridge 68/0 a artifact validation 151/0; každý příkaz skončil
exit `0`. Hygiene v commitnutém stromu zkontrolovala 1519 tracked cest, exit
`0`. Registry validátor vrátil 375 programů, 8 exclusions a fingerprint
`a2f1e67e4f01c6e834f52eb1b15e10a5eec0893638d167e77baf3a35690f77b8`, exit
`0`. Rozdíl proti pre-commit hygiene počtu 1515 jsou přesně čtyři tehdy
untracked a nyní commitnuté nové soubory; jejich syntax byla před commitem
ověřena samostatně.

Po bězích byly `git status --porcelain=v1 -uall`, `git diff --check` a
`git fsck --no-dangling --no-progress` prázdné, respektive bez chyby, všechny
exit `0`. GPU, skutečná Ollama ani externí síť nebyly spuštěny; loopback
provider v acceptance sadě je test-owned protokolová fixture.

První compatibility běh `routes-smoke` skončil 75/1, exit `1`: fixture
záměrně nastavuje `OLLAMA_URL=invalid://…`, ale provider validoval URL už při
server composition a shodil jinak offline boot. Oprava kontrolu neoslabila:
strict loopback URL se dál vyžaduje před prvním provider efektem, pouze se
nevyhodnocuje při offline startupu bez binding práce. Reprodukce pak skončila
109/0, exit `0`. Dřívější průběžná hypotéza o loopback path prefixu byla
nesprávná; příčinou byl invalidní scheme fixture a žádná path výjimka nebyla
přidána.

Cílená mutace odstranila návrat z již aplikované replay větve, takže service
znovu došla k provideru. Acceptance sada zčervenala přesně ve dvou
effect-idempotency scénářích (`15 passed / 2 failed`, exit `1`). Po vrácení
jediného guardu skončil tehdejší čistý rerun `17 passed / 0 failed`, exit `0`;
zachovaný červený artifact je test-owned a není součástí Git evidence.

Compatibility sada proposals nejprve skončila `2 passed / 1 failed`, exit `1`,
protože stará aserce požadovala expiraci i právě zvoleného kandidáta. Aserce
nebyla rozvolněna: nový přesný kontrakt vyžaduje právě jeden `approved`
`qwen3:14b`, právě dva `expired` konkurenty a nula pending. Rerun skončil 3/0,
exit `0`.

## Checkpoint 21 — append-only identita bez SQLite replacement mezery

Migrace 053 doplňuje vlastní insert authority guards nad
`model_failover_proofs`, `model_failover_events`, `model_binding_operations`,
`model_binding_application_attempts`, `model_binding_provider_operations` a
`model_binding_provider_attempts` i nad oběma no-op auditními tabulkami.
Důvod je konkrétní: SQLite
`INSERT OR REPLACE` může konfliktní řádek odstranit před vložením náhrady a při
výchozím `recursive_triggers=0` tím obejít samotné UPDATE/DELETE append-only
guardy. U tabulek s TEXT/composite primary key lze navíc nahradit řádek přes
explicitní skrytý `rowid`, aniž se deklarované klíče překryjí. Nové guards
odmítnou každou primary/unique identity i explicitní rowid kolizi a zachovají
původní řádek. TEXT primary keys v těchto rowid tabulkách historicky přijaly i
`NULL`; migrace proto před prvním DDL odmítne `NULL` proof/operation/receipt ID
a u všech osmi journalů také každé preexistující nekladné pořadí/rowid.

Event, application-attempt a provider-attempt pořadí je nově výhradně DB
autorita. Callerem vložené `seq` se odmítne i tehdy, když by jinak celý řádek
splnil business kontrakt. Explicitní sentinel `-1`, který je v `BEFORE INSERT`
nerozeznatelný od vynechaného INTEGER PRIMARY KEY/rowid, zachytí `AFTER INSERT`
guard a abort vrátí celý statement bez trvalé mutace. Provider `command_seq`
má navíc starší `CHECK > 0`; explicitní `-1` tam fail-close skončí generickým
constraint signálem, zatímco ostatní explicitní hodnoty mají vlastněný
sequence signál. Preexistující business triggery jsou znovu vytvořené s
mutually-exclusive authority podmínkou. Nesentinelový authority/identity
konflikt tak má owned signál bez závislosti na pořadí SQLite triggerů. Jejich
přesný pre-053 name+SQL digest se ověří ještě před první schema mutací.
Explicitní `-1` je v `BEFORE INSERT` nerozeznatelné od vynechané hodnoty;
owned AFTER signál je proto garantovaný pro jinak business-validní řádek, vždy
však celý statement fail-close vrátí. Pozitivní protějšky dál dokládají, že
běžné repository zápisy projdou a databáze pořadí přidělí. Původ
preexistující kladné hodnoty už migrace zpětně dokázat neumí.

Test-first kontrola před přidáním guardu skončila u failover schema sady
`9 passed / 1 failed`, exit `1`: replacement eventu nebyl odmítnut. Při
závěrečném zpřesnění skončil jeden meziběh `11 passed / 1 failed`, exit `1`,
protože test nesprávně očekával receipt authority guard i na junction triggeru;
produktové cesty v témže běhu nepadly. Aserce byla opravena na skutečnou
tabulkovou autoritu, doplněna matice všech osmi ordering a tří NULL identity
preflightů a finální rerun skončil:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `C3_LOG_LEVEL=error node tests/m1-model-failover-schema.test.js` | 13 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/schema-migrations.test.js` | 38 passed, 0 failed; 55 migrací | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-storage.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-repository.test.js` | 39 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-application.test.js` | 73 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/upgrade-apply.test.js` | 33 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/proposal-stale-cleanup.test.js` | 3 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/routes-smoke.test.js` | 109 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/confirmation-ownership.test.js` | 5 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-identity.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/ws-bridge.test.js` | 68 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/repository-hygiene.test.js` | 1520 tracked paths checked | 0 |
| `node scripts/validate-test-registry.js --json` | valid; 375 programů; 8 exclusions; fingerprint `a2f1e67e…f77b8` | 0 |

Zdrojový commit `bcc9eb8443bf872efb42cb35589906649cc6427a` byl následně
ověřen z lokálního `--no-local` klonu v ignorovaném artifact rootu:

```text
/home/belphareon/Projects/intentsmith/.intentsmith-artifacts/
  fresh-clone-bcc9eb84-3s4GHYXT
```

`git status --short` byl před instalací prázdný. `npm ci --offline` přidalo 233
balíčků, auditovalo 234, našlo 0 vulnerabilities a skončilo exit `0`. Celá
tabulka výše pak na témže SHA znovu skončila uvedenými počty a exity; finální
`git status --short` zůstal prázdný. GPU, Ollama, produktový server ani externí
síť tento fresh-clone běh nepoužil.

GPU, Ollama, produktový server ani externí síť nebyly spuštěny. Tento
checkpoint pouze uzavírá auditní identitu a pořadí; nevydává PASS proof,
neaktivuje automatic failover a nemění Gate 1 z `BLOCKED`.

## Checkpoint 22 — verify timeout nezůstává živý po network failure

Nezávislé review checkpointu 21 ukázalo, že legacy `_verifyModel()` při
odmítnutém fetchi vrátí `false`, ale neuklidí 90s abort timer. Aserce 33/0 se
proto vytiskly rychle, zatímco Node proces zůstal zbytečně živý. Nový
deterministický test nahrazuje skutečný pokus na zavřený port test-owned
odmítnutím fetch a vyžaduje úklid stejného timeout handle i na chybové cestě.

Test-first běh skončil `32 passed / 1 failed`, exit `1`, přesně na chybějícím
`clearTimeout`. `_verifyModel()` nyní vlastní timer před vstupem do `try` a
uklízí jej ve `finally`, takže platí pro HTTP chybu, parse chybu i rejected
fetch. Nezávislé review navíc zachytilo, že samotný `finally` by posunul
původní success abort hranici až za parsování těla. Druhá regrese proto
vyžaduje `clearTimeout` bezprostředně po přijetí HTTP odpovědi; záložný
`finally` kryje chybové cesty. Rerun:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `/usr/bin/time -f 'elapsed=%e exit=%x' env C3_LOG_LEVEL=error node tests/upgrade-apply.test.js` | 34 passed, 0 failed | 0 |

Nejde o nový provider retry ani změnu 005/A: jeden verify request má dál jeden
provider effect a 90s timeout zůstává pro skutečné načtení modelu do VRAM.

Fresh-clone reprodukce použila `git clone --no-local` a ověřila přesný source
SHA `da03e8bd2e50f0079628d2728fa9da96e9feb580`. `npm ci --offline`
nainstalovalo 233 balíčků, auditovalo 234 a hlásilo 0 vulnerabilities, exit `0`.
V novém klonu skončily následující příkazy:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `env C3_LOG_LEVEL=error node tests/upgrade-apply.test.js` | 34 passed, 0 failed; 0,08 s | 0 |
| `env C3_LOG_LEVEL=error node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed | 0 |
| `env C3_LOG_LEVEL=error node tests/m1-model-binding-application.test.js` | 73 passed, 0 failed | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed | 0 |
| `node tests/repository-hygiene.test.js` | 1 520 tracked paths | 0 |
| `node scripts/validate-test-registry.js --json` | 375 programů, 8 exclusions; fingerprint `a2f1e67e4f01c6e834f52eb1b15e10a5eec0893638d167e77baf3a35690f77b8` | 0 |
| `git status --porcelain` | prázdný | 0 |

GPU, Ollama, produktový server ani externí síť nebyly spuštěny.

## Checkpoint 23 — typed identity konflikt po append-only guardu

Širší M1 běh nad čistým `c400b184` odkryl regresi mezi checkpointem 21 a
repository error mapperem. Migrace 053 správně odmítá opakovanou event identitu
vlastněným `RAISE(ABORT, ...)`, ale SQLite tento signál hlásí jako
`SQLITE_CONSTRAINT_TRIGGER`. Repository proto veřejnou chybu nesprávně
degradoval z `MODEL_FAILOVER_ID_CONFLICT` na obecný
`MODEL_FAILOVER_STORAGE_CONTRACT`; focused sada skončila 13/1, exit `1`.

Mapper nyní rozpoznává pouze osm stabilních signal tokenů, které vlastní
append-only migrace, a vyžaduje za tokenem přesný oddělovač `:`. Neuznává celý
lidský text ani obecný trigger code. Pozitivní konflikt připíná přesný SQLite
code a vlastněný signal token. Nový near-miss trigger
`MODEL_FAILOVER_EVENT_IDENTITY_CONFLICTING:` zůstává obecnou storage-contract
chybou a celá transakce zachová nulový desired projection. Dřívější fixture
triggery dál dokazují stejnou klasifikaci pro nepříbuzné business guards.

Mutační kontrola odstranila pouze větev pro owned trigger signal; sada pak
skončila přesně `13 passed / 1 failed`, exit `1`, na očekávaném rozdílu
`MODEL_FAILOVER_ID_CONFLICT` versus `MODEL_FAILOVER_STORAGE_CONTRACT`. Po
obnovení větve skončil rerun `14 passed / 0 failed`, exit `0`.

Navazující focused validace v hlavním checkoutu:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `C3_LOG_LEVEL=error node tests/m1-model-failover-repository.test.js` | 14 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/schema-migrations.test.js` | 38 passed, 0 failed; 55 migrací | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-failover-schema.test.js` | 13 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-storage.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-repository.test.js` | 39 passed, 0 failed, 0 skipped | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-application.test.js` | 73 passed, 0 failed, 0 skipped | 0 |

Oprava nemění schema, retry policy, provider effect, runtime binding ani proof
authority. Gate 1 zůstává `BLOCKED`; GPU, Ollama, produktový server ani externí
síť nebyly spuštěny.

### Fresh-clone reprodukce a celý lokálně bezpečný M1 profil

Produktový commit `419090cd2a543b6cef0ffcddfd300b52547a97c3` byl
naklonován přes `git clone --no-local` do
`.intentsmith-artifacts/fresh-clone-419090cd-PPNrY04F`. Před instalací byl
porcelain prázdný a `git rev-parse HEAD` odpovídal přesnému source SHA.
`npm ci --offline` přidalo 233 balíčků, auditovalo 234, našlo 0 vulnerabilities
a skončilo exit `0`.

V klonu proběhlo všech patnáct registrovaných M1 sad, které nevyžadují GPU,
skutečnou Ollamu ani externí síť:

| Sada | Výsledek | Exit |
|---|---:|---:|
| `m1-contract` | 26 passed, 0 failed | 0 |
| `m1-chat-contract` | 21 passed, 0 failed | 0 |
| `m1-model-contract` | 29 passed, 0 failed | 0 |
| `m1-model-identity` | 16 passed, 0 failed | 0 |
| `m1-model-failover-schema` | 13 passed, 0 failed | 0 |
| `m1-model-failover-repository` | 14 passed, 0 failed | 0 |
| `m1-model-binding-storage` | 16 passed, 0 failed | 0 |
| `m1-model-binding-repository` | 39 passed, 0 failed | 0 |
| `m1-model-binding-application` | 73 passed, 0 failed | 0 |
| `m1-model-failover-proof-policy` | 9 passed, 0 failed | 0 |
| `m1-model-failover-measurement` | 9 passed, 0 failed | 0 |
| `m1-model-failover-parent-acceptance` | 15 passed, 0 failed | 0 |
| `m1-model-settings` | 14 passed, 0 failed | 0 |
| `m1-studio-client` | 57 passed, 0 failed | 0 |
| `module-boundary-ratchet` | 13 passed, 0 failed | 0 |

Ratchet checker navíc přehrál 1 010/1 010 přesných hran, našel 0 přidaných a
0 odebraných hran a ověřil baseline provenance, exit `0`. Artifact validation
skončila 151/0, hygiene zkontrolovala 1 521 tracked cest a registry validátor
vrátil 375 programů, 8 exclusions a fingerprint
`a2f1e67e4f01c6e834f52eb1b15e10a5eec0893638d167e77baf3a35690f77b8`;
vše exit `0`. Finální porcelain v klonu zůstal prázdný.

Jediná přímo pojmenovaná M1 sada, která v tomto běhu nebyla spuštěna, je
`m1-model-gpu-pilot`: vyžaduje explicitně vyhrazené GPU/Ollama okno a není
nahrazena mockem ani označena zeleně.

### Otevřená rozhodovací fronta — checkpoint neblokuje

1. **Durable compensation failure.** Default je tvrdý typovaný
   `MODEL_BINDING_RUNTIME_COMPENSATION_REQUIRED` a držený in-process token.
   Přepnutí na restart-safe `RUNTIME_UNKNOWN` vyžaduje další migraci, recovery
   operaci a nejméně tři crash/restart testy.
2. **Notification delivery receipt.** Dnešní broadcaster vrací `void`, takže
   commit vrstva nemá důkaz ani o přijetí transportem. Proto zapisuje
   `RECEIPT_NOT_ISSUED` a stav `APPLIED_NOTIFICATION_DEGRADED`, i když
   best-effort send mohl proběhnout. Skutečný success vyžaduje typed enqueue
   receipt; exactly-once navíc outbox, stabilní event ID a klientskou
   deduplikaci. Tento checkpoint takový claim nedělá.
3. **Vzdálená Ollama.** Manual M1 provider je záměrně omezený na
   necredentialed HTTP loopback. Podpora explicitní vzdálené Ollamy je mimo
   tento local-runtime WP a vyžádá vlastní outbound authority rozhodnutí.
4. **Studio status consumption.** Backend má read-only interní
   `getBindingStatus()` projekci desired/runtime/verification/failure/
   notification truth, ale tento WP ji nepřidal do veřejného HTTP kontraktu.
   Současný Studio runtime stav nekonzumuje a UI je podle operátora přechodné.
   Live `upgrade_verify_failed` zobrazí jen text
   „Zvažte rollback“; current Studio ani chat nemají proveditelný rollback
   surface. Studio je zakázaná cesta tohoto WP, takže vlastníkem je
   `WP-M1-STUDIO`; residual blokuje full M1 acceptance, ne backend checkpoint.
5. **Verification retry.** Přijatá 005/A policy znamená právě jednu exact probe
   na operation generation. Bounded retry se smí přidat jen jako nová
   auditovaná operation/generation policy; nesmí skrytě násobit jeden provider
   effect.
6. **Veřejný HTTP receipt a typed error.** Interní start receipt už nese phase,
   request key a provider/binding operation ID, ale existující HTTP shape je
   zatím nevrací a immediate error body stále obsahuje jen lidský `error` text.
   Přidání stabilního `code` a correlation ID je backward-compatible adice,
   přesto je podle stop condition změnou veřejného connectoru a čeká na jedno
   operátorské potvrzení. Backend truth je zatím dostupná jen internímu
   application portu.
7. **Provider-origin authority.** Claim a causal frontier platí pro přesný
   origin používaný binding service. Alias loopback originy a přímý
   `/api/system/models/pull` používají starší provider cestu; jejich sjednocení
   vyžaduje samostatný provider connector scope.
8. **Runtime no-op notification.** No-op rollback nevytvoří
   `upgrade_history`, ale runtime port dnes zvýší `configVersion` a commit layer
   vyšle `model_changed` se shodným `from/to`. Focused test tento současný stav
   pinuje jako binding-notification revision, nikoli jako modelový přechod.
   Potlačit event/verzi nebo přidat `changed:false` by změnilo veřejnou WS
   sémantiku a zůstává ve frontě pro společné rozhodnutí.

Backend produktový checkpoint má source SHA i fresh-clone reprodukci popsanou
výše. GPU, skutečná Ollama ani externí síť nebyly spuštěny. Gate 1 proto
zůstává `BLOCKED`, nikoli PASS: chybí 015 prahy/TTL, proof issuer a automatický
failover, referenční GPU běh 009 a dokončený UI recovery/status journey.

## Checkpoint 24 — centralizovaná model delete cesta, C1 `PARTIAL`

**Source:** `da95ab15d9fdded66904195d4d5062549fb934d2`; fresh-clone
evidence doplní navazující evidence commit. **Vstup:**
`a3a00baae2dffa6204afa327b97f102ee36c8c09`.

Checkpoint odstraňuje přímé Ollama delete efekty z HTTP route a chatového
interceptu. HTTP a opt-in scheduler volají jediný
`ModelRegistry.deleteModel()`. Chatový adapter přijme jen exact registry plan,
ale skutečný post-apply candidate source vrací one-step rollback identitu;
sdílený guard ji odmítne před inventory. Funkční chat retirement proto tento
checkpoint netvrdí. Registry cesta sdílí fail-fast mutation
owner s binding apply/rollback/rehydrate, kontroluje runtime i durable
desired/pending/rollback identitu a před name-only provider efektem dvakrát
ověří exact provider name a normalizovaný SHA-256 digest. Overview používá
stejnou non-throwing delete klasifikaci, takže při stejném binding state
nenabízí model, který skutečný delete správně odmítne.

Retention cesta čte pouze autoritativní JSON nastavení, nepovažuje nulovou
gateway usage za důkaz nepoužití, nepovolí souběžný cleanup tick a všechny
SQLite/ISO `Z` timestampy validuje a porovnává numericky. Nevalidní čas,
chybějící usage, DB chyba, rovnost s cutoffem a chybějící digest fail-close
vedou k nula delete efektům. Chat před každým adapter preview znovu načte
kandidáty; session hint není autorita a po potvrzení se spolu s jednorázovým
preview zruší. Veřejné kompatibilní tvary zůstávají HTTP
`{ok, deleted, freedGB}` a WS `{action:'model_deleted', model, freedGB}`.

Focused běhy v hlavním checkoutu:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `C3_LOG_LEVEL=error node tests/m1-model-identity.test.js` | 25 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-application.test.js` | 77 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-settings.test.js` | 14 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/routes-smoke.test.js` | 109 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/confirmation-ownership.test.js` | 5 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/upgrade-flow.test.js` | 28 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-contract.test.js` | 29 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/model-upgrade.test.js` | 58 passed, 0 failed | 0 |

Jeden chybný operátorský příkaz mířil na neexistující
`tests/confirmation-arbitration.test.js` a skončil `MODULE_NOT_FOUND`, exit
`1`; nešlo o registrovanou sadu ani produktové selhání. Správná focused sada
`tests/confirmation-ownership.test.js` následně skončila 5/0, exit `0`.

Tři jednotlivé dočasné mutace zčervenaly stejnou focused sadu a byly před
čistým rerunem vrácené:

| Mutace | Výsledek | Exit |
|---|---:|---:|
| druhý inventory snapshot nahrazen prvním | 24 passed, 1 failed; očekávána 2 čtení, naměřeno 1 | 1 |
| durable binding guard vyřazen | 24 passed, 1 failed; očekáván `MODEL_DELETE_BINDING_PROTECTED` | 1 |
| cutoff ochrana změněna z `>=` na `>` | 24 passed, 1 failed; model na hraně prošel | 1 |

### Pravdivá hranice C1

Toto je `PARTIAL_REMEDIATION / FOCUSED_VERIFIED`, nikoli dokončená model-delete
autorita. Po posledním snapshotu může interní direct pull změnit name-only
artefakt; validace či jiný consumer může začít mezi posledním guardem a DELETE.
Inference, vision, embeddings, VRAM a verification zatím nedrží sdílený
per-model use lease. Mutation owner je pouze in-process, delete nemá durable
intent/terminal audit a vzdálený Ollama destructive scope není schválený.
Provider `modified_at` s RFC3339 offsetem je bezpečně odmítnut, ale bez
skutečného Ollama běhu není potvrzené, zda tím konkrétní runtime cleanup
nezůstane inertní.

Review navíc odhalil false-green v původním stubovém chat testu: manager vracel
kandidáta a registry jej nezávisle povolila, přestože reálné vrstvy stejnou
identitu klasifikují jako one-step rollback. Adapter test je nyní pojmenovaný
jen jako adapter a nový skutečný post-apply test vyžaduje zaparkování s nulovým
inventory efektem. Zvolit zdroj starší historie nebo explicitní retirement je
operátorské rozhodnutí, ne skrytá změna C1.

Tyto body vlastní finding 010 a checkpoint C2/C3. GPU, skutečná Ollama,
produktový server a externí síť nebyly spuštěné. Gate 1 zůstává `BLOCKED`.

### Exact-edge module ratchet po source commitu

První checker běh nad čistým source SHA správně skončil exit `1`: baseline
1 010 hran versus 1 011 current, dva přesné přírůstky a jedna odebraná hrana.
Integrátor přijal pouze tyto dvě exact dvojice, bez globu či adresářové výjimky:

- `src/chat/handlers/pre-handler.js -> src/upgrade/model-identity.js`;
- `src/upgrade/model-registry.js -> src/db/user-settings.js`.

Odebraná `src/routes/system.js -> src/upgrade/model-identity.js` byla současně
z baseline odstraněna jako explicitní utažení. Writer zachoval 3 cykly a 28
souborů v cyklech, zapsal 1 011 hran a připnul source revision
`da95ab15d9fdded66904195d4d5062549fb934d2`, exit `0`. Jde o samostatný
baseline commit; produktový source commit se tím nemění.

### Fresh-clone evidence

Baseline commit `3ff178fdf32fbab6a28a70b5e43fa228ec35e778` byl naklonován
přes `git clone --no-local` do ignorovaného artifact rootu:

```text
/home/belphareon/Projects/intentsmith/.intentsmith-artifacts/
  fresh-clone-3ff178fd-LQ81zjkc
```

Počáteční porcelain byl prázdný a HEAD se přesně shodoval. `npm ci --offline`
přidalo 233 balíčků, auditovalo 234, našlo 0 vulnerabilities a skončilo exit
`0`. Všechny registrované M1 sady bez GPU/Ollamy/external network potom
proběhly nad commitnutými daty:

| Sada | Výsledek | Exit |
|---|---:|---:|
| `m1-contract` | 26 passed, 0 failed | 0 |
| `m1-chat-contract` | 21 passed, 0 failed | 0 |
| `m1-model-contract` | 29 passed, 0 failed | 0 |
| `m1-model-identity` | 25 passed, 0 failed | 0 |
| `m1-model-failover-schema` | 13 passed, 0 failed | 0 |
| `m1-model-failover-repository` | 14 passed, 0 failed | 0 |
| `m1-model-binding-storage` | 16 passed, 0 failed | 0 |
| `m1-model-binding-repository` | 39 passed, 0 failed | 0 |
| `m1-model-binding-application` | 77 passed, 0 failed | 0 |
| `m1-model-failover-proof-policy` | 9 passed, 0 failed | 0 |
| `m1-model-failover-measurement` | 9 passed, 0 failed | 0 |
| `m1-model-failover-parent-acceptance` | 15 passed, 0 failed | 0 |
| `m1-model-settings` | 14 passed, 0 failed | 0 |
| `m1-studio-client` | 57 passed, 0 failed | 0 |
| `module-boundary-ratchet` | 13 passed, 0 failed | 0 |

Kompatibilitní běhy: routes smoke 109/0, confirmation ownership 5/0,
upgrade-flow 28/0, upgrade UX 78/0, model-upgrade 58/0 a schema migrations
38/0; vše exit `0`. Artifact validation skončila 151/0, hygiene zkontrolovala
1 523 tracked cest, registry validátor vrátil 375 programů, 8 exclusions a
fingerprint `a2f1e67e4f01c6e834f52eb1b15e10a5eec0893638d167e77baf3a35690f77b8`.
Ratchet reprodukoval 1 011/1 011 hran, 3 cykly a 28 souborů v cyklech. Vše
exit `0`; finální porcelain zůstal prázdný.

Tato evidence povyšuje pouze C1 na `FRESH_CLONE_VERIFIED / PARTIAL`. GPU pilot,
skutečná Ollama a rozhodnutí/implementace retirementu, active-use lease,
durable auditu, remote provideru a cross-process autority zůstávají otevřené.

## C2a — single-process model-use authority

Source-to-effect census opravil původní počet sedmi consumerů. Živé jsou
gateway, registry validation, VRAM manager, binding cutover/exact verify a
pull; `analyzeImages`, semantic index a legacy verify nemají produkčního
volajícího na současném HEAD. C2a proto nezapojuje dormant kód jen pro zelený
součet.

Nový `model-use-authority.js` drží fail-fast shared/exclusive lease nad
konzervativní canonical identity. Registry delete získá exclusive lease před
prvním inventory, single i batch validation drží shared lease do `finally` a
`UpgradeManager.pullModel()` drží exclusive lease přes celý stream. Binding
application mutex zůstává v lock orderu vnější a per-model lease vnitřní.

Focused evidence kandidáta:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `C3_LOG_LEVEL=error node tests/m1-model-use-authority.test.js` | 14 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-identity.test.js` | 25 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/upgrade-flow.test.js` | 28 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed | 0 |

Focused mutace potvrdily, že sada pinuje skutečné hranice, nikoli pouze tvar
návratové hodnoty:

| Dočasná mutace | Výsledek | Exit |
|---|---:|---:|
| delete přeskočí exclusive lease | 10 passed, 4 failed | 1 |
| validation přeskočí shared lease | 12 passed, 2 failed | 1 |
| pull přeskočí exclusive lease | 11 passed, 3 failed | 1 |

Po každé mutaci byl zdroj obnoven přesným opačným patchem; čistý focused běh
poté znovu skončil 14 passed, 0 failed, exit 0. Sada navíc odmítá neplatnou
mode-owner dvojici, dokládá nezávislost dvou canonical identities a držení
delete lease až do dokončení provider efektu. Default-wiring test váže registry
i direct pull na stejný produkční singleton; injected authority zůstává pouze
explicitní testovací seam.

C2a není celý C2. Gateway, binding cutover/exact verify a VRAM disposition
zůstávají otevřené; stejně tak multiprocess claim, durable audit, remote delete
a chat retirement. Gate 1 zůstává `BLOCKED`.

### C2a exact-edge baseline acceptance

Source commit `9b4d9f792ac26cb54dbeac0f915d96656824c99b` přidal přesně tři
source-to-source hrany. Integrátorský writer je přijal jednotlivými
`--accept-edge`; nepoužil glob ani adresářovou výjimku. Review výstup:

```text
MODULE_BOUNDARY_BASELINE_REVIEW baselineEdges=1011 currentEdges=1014
added=3 removed=0 cycles=3->3 filesInCycles=28->28
MODULE_BOUNDARY_BASELINE_WRITTEN sourceRevision=9b4d9f792ac26cb54dbeac0f915d96656824c99b edges=1014
```

Baseline metadata proto váže přesný source commit, scanner blob i source tree.
Zelený post-commit ratchet a fresh-clone běh budou zaznamenány až nad
commitnutým baseline SHA; tento zápis je pouze evidence integrátorského
rozhodnutí o třech hranách.

### C2a fresh-clone evidence

Baseline commit `19d63e1b496b1c2bddb693d7640cce8f288b4490` byl lokálně
naklonován přes `git clone --no-local --no-hardlinks` do ignorovaného artifact
rootu
`.intentsmith-artifacts/fresh-clone-19d63e1b-hGMLFdnF/repo`. Vstupní HEAD se
shodoval a porcelain byl prázdný. `npm ci --offline` přidalo 233 balíčků,
auditovalo 234, našlo 0 vulnerabilities a skončilo exit 0.

Všech 16 registrovaných M1 sad bez GPU, Ollamy a externí sítě prošlo z pouze
commitnutých dat:

| Sada | Výsledek | Exit |
|---|---:|---:|
| `m1-contract` | 26 passed, 0 failed | 0 |
| `m1-chat-contract` | 21 passed, 0 failed | 0 |
| `m1-model-contract` | 29 passed, 0 failed | 0 |
| `m1-model-identity` | 25 passed, 0 failed | 0 |
| `m1-model-failover-schema` | 13 passed, 0 failed | 0 |
| `m1-model-failover-repository` | 14 passed, 0 failed | 0 |
| `m1-model-binding-storage` | 16 passed, 0 failed | 0 |
| `m1-model-binding-repository` | 39 passed, 0 failed | 0 |
| `m1-model-binding-application` | 77 passed, 0 failed | 0 |
| `m1-model-failover-proof-policy` | 9 passed, 0 failed | 0 |
| `m1-model-failover-measurement` | 9 passed, 0 failed | 0 |
| `m1-model-failover-parent-acceptance` | 15 passed, 0 failed | 0 |
| `m1-model-settings` | 14 passed, 0 failed | 0 |
| `m1-studio-client` | 57 passed, 0 failed | 0 |
| `m1-model-use-authority` | 14 passed, 0 failed | 0 |
| `module-boundary-ratchet` | 13 passed, 0 failed | 0 |

Kompatibilitní běhy skončily routes smoke 109/0, confirmation ownership 5/0,
upgrade-flow 28/0, upgrade UX 78/0, model-upgrade 58/0 a schema migrations
38/0; vše exit 0. Artifact validation skončila 151/0, hygiene zkontrolovala
1 525 tracked cest a registry validátor vrátil 376 programů, 8 exclusions a
fingerprint `0472f18e3cc526a823d0e302c6c2ff9d13a7c60b0c480b940237487799024fd0`.
Ratchet reprodukoval 1 014/1 014 hran, 3 cykly a 28 souborů v cyklech. Finální
porcelain zůstal prázdný; žádný GPU/model/network běh nebyl proveden.

C2a je tím `FRESH_CLONE_VERIFIED`, celý C2 a Gate 1 však zůstávají `PARTIAL` /
`BLOCKED` kvůli gateway, binding cutover/exact verify, VRAM disposition,
durable auditu, multiprocess autoritě, remote provideru a retirementu.

## C2b — gateway provider lifecycle

Gateway checkpoint zapojil třetí z pěti živých model-use cest. Semaphore slot
se přidělí dřív než shared lease; request čekající ve frontě proto neblokuje
mutaci modelu. Po získání slotu gateway drží per-canonical shared lease přes
všechny provider pokusy, čtení response body i retry delay. Jeden vnější
semaphore ownership frame a vnitřní model-use frame vracejí oba zdroje při
success, provider erroru, malformed response, cancelu, timeoutu i chybě během
pre-provider setupu.

Při kontrole vyšla najevo starší lifecycle mezera: timeout a upstream cancel se
po přijetí HTTP hlaviček odpojily ještě před `response.json()`. Provider mohl
poslat hlavičky a tělo nechat viset bez gateway deadline. Cleanup nyní zůstává
v per-attempt `finally` až do terminálu body a cizí `AbortError` bez abortu
vlastněného controlleru se dál klasifikuje jako malformed provider response,
nikoli jako falešný timeout.

Focused evidence pracovního kandidáta:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check src/llm/gateway.js` | syntax valid | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-use-authority.test.js` | 24 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/llm-gateway-runtime-signal.test.js` | 7 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-contract.test.js` | 29 passed, 0 failed | 0 |

Mutační kontroly byly po každém běhu obnoveny opačným patchem:

| Dočasná mutace | Výsledek | Exit |
|---|---:|---:|
| gateway shared acquire odstraněn | 19 passed, 5 failed | 1 |
| lease uvolněn před providerem | 20 passed, 4 failed | 1 |
| owned response-body abort klasifikace odstraněna | 22 passed, 2 failed | 1 |

Testy tím dokládají obě strany závodu: aktivní delete/pull odmítne gateway před
provider fetch a běžící gateway odmítne delete před inventory. Lease je během
stalled body viditelně aktivní, přetrvá retry mezeru a po terminálu je znovu
možné získat exclusive mutation. Pre-aborted request zachová canonical cancel
prioritu i při současné mutaci; veřejný `ModelRequest/Result v1` se nemění.

Tento zápis je pouze `FOCUSED_VERIFIED`. Exact-edge baseline, fresh-clone a
širší baterie přijdou v navazujícím evidence checkpointu. Binding
cutover/exact verify, VRAM disposition, durable audit, multiprocess autorita,
remote provider, retirement a stalled-pull recovery zůstávají otevřené. GPU,
Ollama ani externí síť nebyly spuštěny. Gate 1 zůstává `BLOCKED`.

### C2b gateway exact-edge baseline acceptance

Source commit `7ccd8a584a01f45a9ed566aeba7a41c63a064907` přidal přesně jednu
P6-viditelnou hranu:

```text
src/llm/gateway.js -> src/upgrade/model-use-authority.js
```

Integrátorský writer ji přijal jediným exact `--accept-edge`; nepoužil glob ani
adresářovou výjimku. Review a write výstup:

```text
MODULE_BOUNDARY_BASELINE_REVIEW baselineEdges=1014 currentEdges=1015
added=1 removed=0 cycles=3->3 filesInCycles=28->28
ADDED src/llm/gateway.js -> src/upgrade/model-use-authority.js
MODULE_BOUNDARY_BASELINE_WRITTEN sourceRevision=7ccd8a584a01f45a9ed566aeba7a41c63a064907 edges=1015
```

Baseline metadata tím pinuje source revision, exact source tree a scanner blob.
Zelený post-write ratchet a fresh-clone evidence se zapisují až nad commitnutým
baseline SHA; tento odstavec netvrdí dopředu jejich výsledek.

## C2b — binding cutover a exact verification

Binding checkpoint zapojil čtvrtou z pěti živých model-use cest. Cold pull
skončí před shared lease. Následný cutover rezervuje canonical previous+target
v deterministickém pořadí, pod lease provede autoritativní exact re-resolve a
drží obě identity přes runtime prepare, durable repository zápis, compensation
i synchronní `runtime.commit()`. Částečně získaná sada se při konfliktu uvolní
v opačném pořadí a conflict zůstává typovaně retryable. Notification, proposal
repair a background verification začínají až po uvolnění cutover lease.

Exact verification drží target od provider probe přes kontrolu current
operation až po durable success zápis. Před retry delay lease vždy uvolní.
Startup inventory je pouze census hint: current operation i exact prior
override se před změnou runtime znovu resolveují pod lease. Operationless
legacy override zůstává výslovně name-only `LEGACY_UNVERIFIED`. Default wiring
test navíc prokazuje, že application a reálný `UpgradeManager.pullModel()`
sdílejí tentýž produkční singleton; konkurent skončí před provider fetch.

Focused evidence pracovního kandidáta:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check src/upgrade/model-binding-application.js` | syntax valid | 0 |
| `node --check src/upgrade/model-use-authority.js` | syntax valid | 0 |
| `node --check tests/m1-model-binding-application.test.js` | syntax valid | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-application.test.js` | 87 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-use-authority.test.js` | 24 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-repository.test.js` | 39 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-storage.test.js` | 16 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-failover-schema.test.js` | 13 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/schema-migrations.test.js` | 38 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-contract.test.js` | 29 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/llm-gateway-runtime-signal.test.js` | 7 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/upgrade-flow.test.js` | 28 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/model-upgrade.test.js` | 58 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/routes-smoke.test.js` | 109 passed, 0 failed | 0 |
| `C3_LOG_LEVEL=error node tests/ws-bridge.test.js` | 68 passed, 0 failed | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed | 0 |
| `node tests/repository-hygiene.test.js` | 1 525 tracked paths checked | 0 |
| `node scripts/validate-test-registry.js --json` | 376 programs, 8 exclusions, fingerprint `0472f18e…24fd0` | 0 |
| `node scripts/module-boundary-ratchet.mjs` | expected exact-edge review: 1 015 → 1 016, one added edge | 1 |

Mutační kontroly byly vždy spuštěné nad jediným dočasně odstraněným guardem a
zdroj byl po běhu obnoven opačným patchem:

| Dočasná mutace | Výsledek | Exit |
|---|---:|---:|
| cutover previous+target acquire odstraněn | 81 passed, 6 failed | 1 |
| verification target acquire odstraněn | 86 passed, 1 failed | 1 |
| exact prior-override acquire odstraněn | 86 passed, 1 failed | 1 |
| unleased census digest vrácen jako gate pro current operation | 86 passed, 1 failed | 1 |
| unleased census digest vrácen jako gate pro prior exact override | 86 passed, 1 failed | 1 |

Nezávislý review po prvním source commitu odkryl, že obě startup větve stále
používaly unleased census jako fail-gate před autoritativním resolve. Reachable
pull mohl snapshot změnit a current operation by se z nesprávné stale evidence
označila non-retryable digest driftem. Follow-up odstranil oba prechecky:
inventory zůstává jen census/reconciliation hint a o exact manual restore
rozhoduje pouze `resolveExact()` pod previous+target lease. Pozitivní regrese
pro current operation i prior override obnoví správný artifact mezi census a
resolve, očekává restore bez FAILED attemptu; zpětné vložení každého prechecku
samostatně zčervenalo 86/87.

Checkpoint současně odkryl residual, který lease neopravuje: repository zapíše
durable `APPLIED` před `runtime.commit()`. Pokud synchronní finalize poté selže,
neexistuje typovaný durable `RUNTIME_UNKNOWN` ani restart recovery protokol;
úspěšný terminal audit nelze pravdivě přepsat na failure. Test tuto mezeru
reprodukuje a Finding 008 proto přechází z globálního `REMEDIATED` na
`PARTIAL_REMEDIATION` s vlastníkem a termínem před M1 acceptance.

Source commit `0bf2e11db5618b2dcdcbd4cdcc25e5f572c7a014` přidal jedinou
P6-viditelnou hranu:

```text
src/upgrade/model-binding-application.js -> src/upgrade/model-use-authority.js
```

Integrátorský writer ji přijal jediným exact `--accept-edge`; glob ani
adresářová výjimka nebyly použité. Review a write výstup:

```text
MODULE_BOUNDARY_BASELINE_REVIEW baselineEdges=1015 currentEdges=1016
added=1 removed=0 cycles=3->3 filesInCycles=28->28
ADDED src/upgrade/model-binding-application.js -> src/upgrade/model-use-authority.js
MODULE_BOUNDARY_BASELINE_WRITTEN sourceRevision=0bf2e11db5618b2dcdcbd4cdcc25e5f572c7a014 edges=1016
```

Zelený post-write ratchet a jeho focused sada jsou součástí tohoto baseline
checkpointu. Navazující fresh-clone evidence je oddělená níže a váže se na
pozdější corrective source `cfcb63dd`; nemění baseline provenance
`0bf2e11d`. GPU, Ollama, produktový server ani externí síť nebyly spuštěné. C2
zůstává `PARTIAL` (VRAM je pátá živá cesta) a Gate 1 zůstává `BLOCKED`.

### C2b gateway + binding fresh-clone evidence

Autoritativní reprodukce běžela z nového lokálního clone uvnitř vlastněného
artifact stromu. Testovaný source byl přesný detached HEAD
`cfcb63dd5cd5560a7b6729ea4420679ae3bcac0d`; Node byl `v22.21.1`, npm
`10.9.4`. Příkazy instalace:

```text
git clone --no-local . .intentsmith-artifacts/binding-fresh-cfcb63dd-DmkBKF
git -C .intentsmith-artifacts/binding-fresh-cfcb63dd-DmkBKF checkout --detach cfcb63dd
npm ci --offline
```

Všechny tři příkazy skončily exit 0. Instalace přidala 233 balíčků, auditovala
234 a hlásila 0 vulnerabilities. Před testy vznikl clone-local
`.intentsmith-artifacts` s mode 0700; jde o explicitní prerekvizitu isolation
helperu, nikoli změnu produktu.

Fresh clone reprodukoval tyto výsledky, všechny exit 0:

| Příkaz | Výsledek |
|---|---:|
| `C3_LOG_LEVEL=error node tests/m1-model-binding-application.test.js` | 87/0 |
| `C3_LOG_LEVEL=error node tests/m1-model-use-authority.test.js` | 24/0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-repository.test.js` | 39/0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-storage.test.js` | 16/0 |
| `C3_LOG_LEVEL=error node tests/m1-model-failover-schema.test.js` | 13/0 |
| `C3_LOG_LEVEL=error node tests/schema-migrations.test.js` | 38/0 |
| `C3_LOG_LEVEL=error node tests/m1-model-contract.test.js` | 29/0 |
| `C3_LOG_LEVEL=error node tests/llm-gateway-runtime-signal.test.js` | 7/0 |
| `C3_LOG_LEVEL=error node tests/upgrade-flow.test.js` | 28/0 |
| `C3_LOG_LEVEL=error node tests/upgrade-ux-v125.test.js` | 78/0 |
| `C3_LOG_LEVEL=error node tests/model-upgrade.test.js` | 58/0 |
| `C3_LOG_LEVEL=error node tests/routes-smoke.test.js` | 109/0 |
| `C3_LOG_LEVEL=error node tests/ws-bridge.test.js` | 68/0 |
| `node scripts/module-boundary-ratchet.mjs` | 1 016/1 016 hran, 3 cykly |
| `C3_LOG_LEVEL=error node tests/module-boundary-ratchet.test.js` | 13/0 |
| `node tests/artifact-validation.test.js` | 151/0 |
| `node tests/repository-hygiene.test.js` | 1 525 tracked cest |
| `node scripts/validate-test-registry.js --json` | 376 programů, 8 exclusions, fingerprint `0472f18e…24fd0` |

Finální `git status --porcelain=v1 -uall` v clone byl prázdný a `git
diff --check` skončil exit 0. První neautoritativní pokus na starším SHA
`175d5f31` měl clone-local artifact root vytvořený obecným `mkdir -p` v mode
0755; isolation helper proto správně zastavil všechny direct testy před první
asercí s exit 1. Požadavek nebyl obcházen ani test oslaben: nový clone dostal
mode 0700 před během a prošel celý.

C2b gateway + binding je tím `FRESH_CLONE_VERIFIED`, ale pouze pro čtyři z pěti
živých cest. VRAM, cross-process claim, durable delete audit, vzdálený provider,
stalled-pull recovery, retirement a post-DB runtime-finalize reconciliation
zůstávají otevřené. GPU, Ollama, produktový server a externí síť byly `NOT RUN`;
Gate 1 zůstává `BLOCKED`.

## Checkpoint 25 — nedělitelný runtime finalize recovery candidate

Post-DB residual z Findingu 008 dostal vlastní úzký
[`WP-M1-BINDING-FINALIZE-RECOVERY`](../../wp/WP-M1-BINDING-FINALIZE-RECOVERY.md).
Nezávislé review odmítlo původně plánovaný mezilehlý schema/repository commit:
produkční application sada v něm byla červená 58/29 a nepotvrzený runtime
attempt mohl uniknout jako effective manual binding. Schema, repository,
application a runtime port proto tvoří jeden nedělitelný source candidate.
Historie se nepřepisuje: review jednotkou je `0a6bde54..7c4aa73c` a pouze
výsledné SHA smí nést fresh-clone důkaz.

Migrace 054 odděluje durable runtime attempt od potvrzeného synchronního
finalize. Sealed cutoff zachytí všechny pre-054 runtime generace a zabrání
jejich dodatečnému přímému potvrzení; úplný pre-054 trigger set i SQL digest se
ověří před první schema mutací. Každý pre-054 změněný `RUNTIME_APPLY` musí mít
právě jeden exact history řádek, který původní repository writer zapisoval ve
stejné transakci; chybějící i duplicitní stopa fail-close zastaví upgrade před
DDL. `DIRECT_CONFIRMED` smí patřit jen nejnovější
úspěšné runtime generaci. `RECOVERED_BY` smí ukázat pouze na pozdější
direct-confirmed `STARTUP_REHYDRATE` stejné operace. Sekvenci, čas a recovery
množinu vlastní repository; oba journaly jsou append-only.

Application pořadí je nyní:

`prepare → durable runtime success → synchronous runtime commit → direct/recovery receipt → proposal/broadcast/verification`.

`upgrade_history` se zapisuje ve stejné transakci jako direct receipt, nikoli
před skutečným runtime finalize. Neautoritativní in-memory historie nemůže
zpětně shodit dokončený runtime commit. Commit/receipt crash okno zůstává
pravdivě `UNKNOWN`; ani pozdější selhaný startup attempt nezakryje starší
nepotvrzený success. User replay neopakuje runtime, pull ani provider intent.
Operation-scoped recovery znovu čte exact provider identitu a vytvoří přesnou
startup generaci. Po každém typed busy existuje nejvýše jeden operation-scoped
timer, ale počet po sobě jdoucích busy rearmů není omezen; jiné provider/DB
selhání ponechá `UNKNOWN` pro restart nebo pozdější replay. Dva po
sobě jdoucí restarty před receiptem jsou pokryté skutečným SQLite close/open:
třetí generace dostane direct receipt a obě starší generace `RECOVERED_BY`.

Interní `RUNTIME_RECONCILIATION_REQUIRED` se přes compatibility mapping
nepropaguje jako nový veřejný enum: dnešní veřejná hranice zůstává `PENDING` /
`NOT_APPLIED`. HTTP, chat a WS schéma se nezměnilo.

Lokální focused a compatibility výsledky v checkoutu
`/home/belphareon/Projects/intentsmith`, na bázi `0a6bde54`, před opravným
zdrojovým commitem:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check src/db/migrations/2026_08_09_054_model_binding_runtime_finalization.js` | syntax valid | 0 |
| `node --check src/upgrade/model-failover.js` | syntax valid | 0 |
| `node --check src/upgrade/model-binding-application.js` | syntax valid | 0 |
| `node --check src/upgrade/upgrade-manager.js` | syntax valid | 0 |
| `C3_LOG_LEVEL=error node tests/schema-migrations.test.js` | 38/0; 56 migrací | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-failover-schema.test.js` | 20/0 | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-failover-repository.test.js` | 14/0 | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-repository.test.js` | 42/0 | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-application.test.js` | 96/0 | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-binding-storage.test.js` | 16/0 | 0 |
| `C3_LOG_LEVEL=error node tests/routes-smoke.test.js` | 109/0 | 0 |
| `C3_LOG_LEVEL=error node tests/ws-bridge.test.js` | 68/0 | 0 |
| `C3_LOG_LEVEL=error node tests/upgrade-flow.test.js` | 28/0 | 0 |
| `C3_LOG_LEVEL=error node tests/upgrade-ux-v125.test.js` | 78/0 | 0 |
| `C3_LOG_LEVEL=error node tests/model-upgrade.test.js` | 58/0 | 0 |
| `node tests/artifact-validation.test.js` | 151/0 | 0 |
| `node tests/repository-hygiene.test.js` | 1 527 trackovaných cest | 0 |
| `node scripts/validate-test-registry.js --json` | 376 programů / 8 exclusions; fingerprint `0472f18e…24fd0` | 0 |
| `node scripts/module-boundary-ratchet.mjs` | 1 016/1 016 hran; 3 existující cykly | 0 |
| `git diff --cached --check` | bez whitespace chyb | 0 |

Třináct cílených mutací prokázalo účinné negativní pokrytí. Každá vznikla
jedním přesným dočasným patchem v uvedeném souboru a po běhu byla vrácena
opačným patchem:

| Soubor a dočasná mutace | Příkaz a výsledek | Exit |
|---|---:|---:|
| `model-failover.js`, `getEffectiveBinding()`: odstraněn predicate `runtimeFinalizeStatus === 'DIRECT_CONFIRMED'` | repository 40/2 | 1 |
| migrace 054, `trg_model_binding_runtime_finalize_direct_after_cutoff`: do `WHEN` přidáno `AND 0` | failover schema 19/1 | 1 |
| migrace 054, `up()`: oba name-set/SQL-digest `if` preflighty prefixovány `false &&` | failover schema 17/3 | 1 |
| migrace 054, `trg_model_binding_application_finalize_prerequisite`: `WHEN` vypnuto | repository 41/1 | 1 |
| `model-binding-application.js`, `#executeOperation()`: odstraněn call `recordManualRuntimeFinalized()` | application 49/47 | 1 |
| `upgrade-manager.js`, binding `commit()`: před receipt vrácen call `recordUpgrade()` | application 95/1 | 1 |
| `model-binding-application.js`, public-state mapper: odstraněna compatibility větev pro interní unknown | application 95/1 | 1 |
| `model-failover.js`, `deriveBindingApplicationState()`: odstraněna priorita `unresolvedRuntimeAttempt` | repository 37/5 | 1 |
| `model-failover.js`, `recordManualRuntimeFinalized()`: vypnut predicate `legacyHistoryAlreadyOwned` | repository 34/8 | 1 |
| `model-binding-application.js`, `#scheduleRuntimeFinalizeRecovery()`: busy rearm změněn na `false && rescheduleAfterBusy` | application 95/1 | 1 |
| `model-binding-application.js`, receipt-readback catch: odstraněn recovery schedule | application 95/1 | 1 |
| `model-binding-application.js`, runtime-attempt catch/readback: oba recovery schedules změněny na `if (false)` | application 95/1 | 1 |
| migrace 054, legacy-history preflight: unikátnost `COUNT(*) <> 1` oslabena na `= 0` | failover schema 19/1 | 1 |

Repository mutace běžely příkazem
`C3_LOG_LEVEL=error node tests/m1-model-binding-repository.test.js`, schema
mutace přes `C3_LOG_LEVEL=error node tests/m1-model-failover-schema.test.js` a
application mutace přes
`C3_LOG_LEVEL=error node tests/m1-model-binding-application.test.js`; každý subprocess skončil
uvedeným nenulovým exit code.

Po každé mutaci byl zdroj vrácen přesným opačným patchem; finální pozitivní
focused běh znovu skončil 38/38 + 20/20 + 14/14 + 42/42 + 96/96, vše exit 0.

### Fresh-clone evidence výsledného source SHA

Výsledný source commit `7c4aa73c18289eebced48511910e35dad21c3be5` byl
ověřen v čistém lokálním klonu
`/tmp/intentsmith-binding-finalize-loBpzT/repo`; cizí necommitnuté dokumenty z
hlavního checkoutu v něm nebyly. Přesné instalační a provenance příkazy:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `git clone --no-local --branch claude/gate1-mobile-app-progress-5sywlt /home/belphareon/Projects/intentsmith /tmp/intentsmith-binding-finalize-loBpzT/repo` | clone lokálního Git objektu | 0 |
| `git rev-parse HEAD` | `7c4aa73c18289eebced48511910e35dad21c3be5` | 0 |
| `npm ci --offline` | 233 balíčků; audit 234; 0 vulnerabilities | 0 |

V tomto klonu byly znovu spuštěny všechny pozitivní příkazy z tabulky výše se
stejnými výsledky: schema 38/0, failover schema 20/0, failover repository 14/0,
binding repository 42/0, application 96/0, storage 16/0, routes 109/0, WS 68/0,
upgrade flow 28/0, upgrade UX 78/0, model-upgrade 58/0 a artifact validation
151/0. Hygiene zkontrolovala 1 527 trackovaných cest; registry měla 376
programů, 8 exclusions a fingerprint `0472f18e…24fd0`; ratchet potvrdil
1 016/1 016 hran a tři existující cykly. Všechny subprocessy skončily exit `0`.
Závěrečné `git diff --check` i `test -z "$(git status --porcelain=v1)"` skončily
exit `0`.

GPU, Ollama, produktový server a externí síť nebyly spuštěny. Gate 1 zůstává
`BLOCKED` nejméně na 015, proof/automatic failover, Studio recovery surface,
globální VRAM residency authority a autorizovaný GPU pilot.

## Checkpoint 27 — opt-in digest-bound failover detection candidate

Nový `src/upgrade/model-failover-coordinator.js` nahrazuje jediný produkční
pětiminutový call name-only `checkBindingIntegrity()`. Nesdílí jeho
`PROPOSED`/score sémantiku a nevybírá fallback. Po literal-true opt-inu použije
stejný strict loopback provider jako manual binding application a právě jeden
inventory snapshot. Bindings se čtou před i po provider effectu, celý snapshot
se validuje před zápisem a policy se znovu ověří po inventory i uvnitř stejné
repository `BEGIN IMMEDIATE` transakce jako každý durable krok. Composition
root koordinátoru předává dva frozen porty: pět repository metod a jedinou
inventory metodu, nikoli plné objekty s mutation authority.

Povolené durable výsledky jsou pouze první exact digest-bound desired baseline
a `DETECTED` nad shodnou persisted revision. Repository `expectedAbsent`
zabrání scheduleru přepsat mezitím vzniklou desired autoritu; `detectionOnly`
zakáže tomuto callerovi skrytě retireovat terminal `SUPERSEDED_BY_USER` stav.
Existující desired se neposouvá. Unseeded missing, digest drift, runtime/desired
drift, manual authority, orphan override, terminal incident, prázdný,
malformed nebo canonical-ambiguous inventory a změna policy končí bez
aktivace. Recursive scheduler zachovává dosavadní první pětiminutový delay a
další tick plánuje až po dokončení předchozího.

Lokální focused výsledky source kandidáta:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check src/upgrade/model-failover-coordinator.js` | syntax valid | 0 |
| `node --check src/upgrade/model-failover.js` | syntax valid | 0 |
| `node --check src/server.js` | syntax valid | 0 |
| `node --check tests/m1-model-failover-coordinator.test.js` | syntax valid | 0 |
| `C3_LOG_LEVEL=error node tests/m1-model-failover-coordinator.test.js` | 16/0 | 0 |
| `node tests/m1-model-failover-repository.test.js` | 14/0 | 0 |
| `node tests/m1-model-binding-repository.test.js` | 42/0 | 0 |
| `node tests/m1-model-binding-application.test.js` | 96/0 | 0 |
| `node tests/m1-model-failover-schema.test.js` | 20/0 | 0 |
| `node tests/m1-model-settings.test.js` | 14/0 | 0 |
| `node tests/m1-model-identity.test.js` | 25/0 | 0 |
| `node tests/schema-migrations.test.js` | 38/0, 56 migrations | 0 |
| `node tests/routes-smoke.test.js` | 109/0 | 0 |
| `node tests/artifact-validation.test.js` | 151/0 | 0 |
| `node tests/repository-hygiene.test.js` | 1 527 tracked paths | 0 |
| `node scripts/validate-test-registry.js --write-doc` | 377 programů; fingerprint `1370be04…75a6` | 0 |

Source commit `be4f2175d472f24b98970d046697a0a2a6b21e5a` ponechal ratchet
záměrně červený právě na čtyřech nových exact hranách:
`src/server.js → src/upgrade/model-failover-coordinator.js`,
`src/upgrade/model-failover-coordinator.js → src/upgrade/model-failover.js`,
`src/upgrade/model-failover-coordinator.js → src/upgrade/model-identity.js` a
`src/upgrade/model-failover.js → src/db/user-settings.js`; nepoužívá se glob
ani adresářová výjimka. Standardní writer následně v čistém detached klonu
source SHA přijal právě tyto čtyři `--accept-edge` dvojice: 1 016 → 1 020 hran,
cykly zůstaly 3 a soubory v cyklech 28. Baseline nyní pinuje source revision
`be4f2175…` a source tree `030f7d2a…`; lokální ratchet a čistý klon se ověří
ještě před uzavřením evidence commitu.

Checkpoint nevydává proof, claim, provider mutation, runtime binding ani
broadcast a nemění L0-9. Gate 1 zůstává `BLOCKED` na rozhodnutí 015, proof
issuance, terminal activation/restore, negotiated Studio wire, VRAM authority a
autorizovanou GPU evidenci.

### Fresh-clone uzavření checkpointu 27

Výsledný baseline commit `1823e9a4d0458ae4b42c49e791b64160ed3b66d6`
byl checkoutnutý detached přes `git clone --no-local --no-checkout` do nového
adresáře v `/tmp`. První `npm ci --offline` byl omylem spuštěn z nadřazeného
`/tmp` a správně skončil exit `1` na chybějícím lockfile; nejde o produktový
běh ani evidenci instalace. Stejný příkaz spuštěný z kořene přesného klonu
instaloval 233 balíčků, nalezl 0 vulnerabilities a skončil exit `0`.

Z tohoto klonu, bez Ollamy, GPU, produktového serveru a externí sítě, proběhlo:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-model-failover-coordinator.test.js` | 16/0 | 0 |
| `node tests/m1-model-failover-repository.test.js` | 14/0 | 0 |
| `node tests/m1-model-binding-repository.test.js` | 42/0 | 0 |
| `node tests/m1-model-binding-application.test.js` | 96/0 | 0 |
| `node tests/m1-model-failover-schema.test.js` | 20/0 | 0 |
| `node tests/m1-model-settings.test.js` | 14/0 | 0 |
| `node tests/m1-model-identity.test.js` | 25/0 | 0 |
| `node tests/schema-migrations.test.js` | 38/0, 56 migrations | 0 |
| `node tests/routes-smoke.test.js` | 109/0 | 0 |
| `node tests/module-boundary-ratchet.test.js` | 13/0 | 0 |
| `node scripts/module-boundary-ratchet.mjs` | 1 020/1 020, provenance replay 1 020 | 0 |
| `node tests/artifact-validation.test.js` | 151/0 | 0 |
| `node tests/repository-hygiene.test.js` | 1 529 tracked paths | 0 |
| `node scripts/validate-test-registry.js --json` | 377 programů, 8 exclusions, fingerprint `1370be04…75a6` | 0 |
| `git status --porcelain=v1 --untracked-files=all` | prázdný výstup | 0 |

Tím je detection-only checkpoint uzavřený. Neznamená to Gate 1 PASS:
fallback selection, proof issuance, claim/activation, restore, rozhodnutí 015,
Studio wire a autorizovaný GPU pilot zůstávají samostatné otevřené bloky.

## Post-checkpoint opt-in reachability — rozhodnutí 020

Call graph po uzavření checkpointu ukázal, že typed
`updateModelSettings()` nemá v produkčním `src/` žádného volajícího. Skutečný
in-memory probe obecného `POST /api/settings` prokázal dva odlišné efekty:
full-document tělo umí failover zapnout i s neznámým modelovým klíčem a
navazující `{}` smaže celý dokument a vrátí policy na default off; oba requesty
vrátily 200, probe exit `0`.

Obecný POST je živá backup/import/reset autorita obou UI, takže jeho změna na
merge nebo modelový allowlist není interní refaktor. Varianty a doporučení
samostatné exact typed route jsou v
[`020`](../../decisions/020-m1-model-failover-opt-in-surface.md). Do rozhodnutí
zůstává zastaven pouze podporovaný opt-in surface; detection scheduler je
bezpečně default off a ostatní decision evidence může pokračovat.
