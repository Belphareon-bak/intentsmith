# WP-M1-MODEL — průběžný report

- **stav WP:** BLOCKED na referenční GPU konfiguraci; offline connector READY
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

## Rozhodnutí a findingy

- `docs/decisions/005-m1-model-retry-policy.md` — DECIDE, default jeden pokus
  pouze pro connector v1;
- `docs/decisions/006-m1-model-auto-rebind-l0.md` — BLOCK pouze pro automatický
  rebind, gateway práce pokračuje;
- `docs/decisions/007-m1-vram-nonfit-policy.md` — DECIDE, pouze trusted fyzický
  `NONFIT` se odmítne před efektem;
- `docs/decisions/008-m1-model-adapter-authority.md` — DECIDE, explicitní
  role-purpose matice, samostatný auth token a parametrický allowlist;
- `docs/findings/002-m1-vision-bypasses-model-connector.md` — vision direct
  fetch je PENDING-OWNER, protože B1 connector nenese image schema;
- `docs/findings/003-m1-vram-policy-is-duplicated.md` — startup, media VRAM
  manager a request preflight zatím nemají jednoho vlastníka footprintu.
- `docs/findings/004-llm-auth-factory-capability-elevation.md` — process-local
  token nejde padělat, ale trusted factory zatím zachovává legacy capability
  override mimo default role.

## Zbývá v WP

1. autoritativní footprint fixture pro registrovaný GPU běh; bez ní zůstává
   produkční preflight správně `UNKNOWN`;
2. sériový GPU run na skutečné Ollamě včetně cold/warm a mid-generation cancel;
3. konečný read-only review, focused baterie a uzavření WP. GPU část se nesmí spustit, dokud
   bezpečný snapshot neprokáže, že není nutný pull/delete/rebind ani zásah do
   sdílené Ollamy.

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

Výsledek se neopravuje oslabením 1GiB aserce ani změnou modelu/contextu.
Rozhodovací fronta je v `docs/decisions/009-m1-gpu-headroom.md`. GPU část B3 je
do operátorského rozhodnutí blokovaná; offline fake-provider a connector část
zůstává ověřená. Následná úprava sady pouze doplňuje typovaný failure
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
