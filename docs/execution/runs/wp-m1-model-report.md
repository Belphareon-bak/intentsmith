# WP-M1-MODEL — průběžný report

- **stav WP:** B3-IDENTITY + B3-PROFILE READY; BLOCKED na novém referenčním
  GPU běhu 009 a B3-FAILOVER; offline connector READY
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
