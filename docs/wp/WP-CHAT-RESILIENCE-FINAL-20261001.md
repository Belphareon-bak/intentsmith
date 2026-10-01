# WP-CHAT-RESILIENCE-FINAL-20261001 — skutečný chatový korpus

**Autorita:** výslovné zadání operátora z 30. 9. a 1. 10. 2026: ověřit skutečné
chatové chování na více projektech, kontextu, specialistech a workerech. Tento
WP pokrývá jen navazující 53případovou sadu z historického
`work/intent-resilience-20260928`; ostatní produktové cesty mají vlastní WP.
Vstup: čistý integrační `76274bb6`. Vlastněné cesty:
`scripts/measure-m1-l3.js`, `scripts/chat-resilience-transport.js`,
`scripts/chat-resilience-provider-relay.js`,
`tests/fixtures/chat-resilience-final.json`,
`tests/chat-resilience-runner-contract.test.js`, příslušný řádek
`tests/registry.json` a tento dokument.

## Pozorovatelný výsledek a hranice

53 skutečných M1 HTTP tahů běží v novém izolovaném serveru, DB a syntetickém
projektu; šest dialogů používá perzistentní návaznost. Vedle produktové B
odpovědi se ve finální sérii změří i přímá A odpověď stejného připnutého CHAT
modelu. Nástrojový efekt se schvaluje jen tehdy, když sedí přesný kind, kořen,
relativní cesta a předem určený digest; nesoulad zůstane `approvalBlocked`.
Výsledné soubory, HTTP, DB řádky, provider request/response a latence se uloží
do soukromých ignorovaných artefaktů, nikoli do Git historie.

Korpus vychází z `00742bcd` (53 případů, 20 rodin, 8 nedotčených rodin).
Přenos doplnil u čtyř `approve.previous` explicitní `fromCase`, protože dnešní
`buildHandlerHistory()` nepředává původní metadata odpovědi. To mění hash
korpusu proti historickému `5e6b8c9f…`; všechny tři nové finální běhy musí
použít **stejné nové bytes**, stejný source, modelový digest, Node, provider
verzi, bindings a memory policy. Historické `NEEDS_MORE_WORK` a 53 × 3
`LIVE_NOT_RUN` zůstávají historickým stavem, ne výsledkem tohoto přenosu.

Runner odděluje transportní úplnost `LIVE_COMPLETE_UNASSESSED` od významového
hodnocení. Ani tento status není PASS kvality. Text každé odpovědi se musí
posoudit proti `intent`, `allowed`, `forbidden` a `question`, prověřit všechny
efekty a latence. Předem zmražené cíle v korpusu: 0 kritických problémů,
užitečnost alespoň 95 %, zbytečná zastavení nejvýše 5 %, jazyková delta
nejvýše 5 bodů; zvýšení teplého mediánu nad 20 % vyžaduje výslovně popsaný
kompromis. Po třech úplných nezměněných bězích následuje nezávislé review.

Tento WP **nepřebírá** divergentní produktové změny z větve resilience a
neprokazuje jejich přijetí. Mobil, M5/M6 release, Hunt grading a nasazený
backend jsou samostatné hranice.

## Ověření a stop podmínky

Pozitivní/negativní offline kontrola nemá žádné modelové volání:

```bash
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node tests/chat-resilience-runner-contract.test.js
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node scripts/measure-m1-l3.js --isolated-chat --offline \
  --phase pilot-1 --corpus tests/fixtures/chat-resilience-final.json \
  --record .intentsmith-artifacts/chat-resilience/runs.json
```

Minimální živý pilot až na čistém a nezávisle reviewovaném commitu, při volné
sdílené GPU a bez souběžného Hunt hodnocení:

```bash
CHAT_PROBE_CASES=http-plain /home/belphareon/.nvm/versions/node/v24.21.0/bin/node \
  scripts/measure-m1-l3.js --isolated-chat --live --phase pilot-1 \
  --corpus tests/fixtures/chat-resilience-final.json \
  --record .intentsmith-artifacts/chat-resilience/runs.json
```

Před finální sérií musí být vyřešené nálezy pilotu a znovu zmražený source.
`final-1`, `final-2` a `final-3` se spouštějí stejným příkazem bez filtru
`CHAT_PROBE_CASES`; finální režim vyžaduje A/B a kontroluje návaznost SHA i
effective configuration. Při dirty source, Node ABI chybě, obsazené GPU,
odlišném modelovém digestu, konfiguraci, neúplném HTTP/provider záznamu nebo
neočekávaném efektu je běh `BLOCKED`/`LIVE_INCOMPLETE`, ne PASS. Do úplnosti se
počítá **každý** zachycený `/api/chat` a `/api/generate` request: HTTP chyba,
chybějící terminál ani neplatná identita modelu se nesmí ztratit za pozdějším
úspěšným voláním. `initial-exit.json` ukládá počet všech inference requestů a
počet neplatných. Všechna přítomná pole identity (`digest` i
`model_digest_sha256`) musí souhlasit. Soukromý `initial-provider-raw.jsonl`
ukládá a synchronizuje začátek requestu i syrové request/response chunky před
jejich předáním dál. Přerušený upstream nebo odchod child uzavře čekající
request jako `incomplete`; kanonický `providerWire` a veřejný status zůstávají
`LIVE_INCOMPLETE`, nikoli důkaz úplné odpovědi.

Nezávislé review kandidáta `c60afb87` našlo ještě dokončený upload
požadavku, po němž klient zavřel spojení dříve, než dorazila platná
odpověď upstreamu. Relay dříve zapsal `response_end` a falešný
`captureComplete:true`. Nová red-first socketová zkouška to
reprodukovala. Opravený relay považuje odpověď za dokončenou až po
`finish` směrem ke klientovi; předčasné `close`/`error` zapíše a
synchronizuje jako `incomplete` a ruší čekající upstream. Úspěšný
retry nesmí tento první request skrýt. Offline kontrakt nyní **20/20
PASS** bez modelových volání; samostatné re-review, integrace a živý
pilot stále čekají.

Re-review `94f60283` potvrdilo opravu zavřeného klienta, ale vrátilo
`CHANGES_REQUIRED`: umělá chyba `ServerResponse` nechala viset
upstream socket, protože request už byl vyřazen z aktivní množiny a
`sealPending()` jej nemohl ukončit. Negativní socketový test nejprve
selhal. Každé nedokončené ukončení nyní po synchronizaci soukromého
záznamu zruší provider response i outbound upstream request.
Řízený kontrakt **21/21 PASS**, včetně fyzického uzavření upstream
socketu; živý běh, nezávislé re-review této opravy a integrace čekají.

## První skutečný pilot, 1. 10. 2026

Přenos `0959c45f` dostal nezávislé omezené `REVIEW_PASS` pro korpus, izolaci a
bezpečný jednopřípadový pilot. Následný infrastrukturální pokus `pilot-1` na
`bbecff36` skončil ještě před providerem `RELAY_SOCKET_LISTEN_EINVAL`, protože
unixová cesta přesáhla limit `sun_path`. Původní runner po unhandled listen
chybě zanechal kanonický záznam `RUNNING`; tento konkrétní záznam byl výslovně
označen `LIVE_ABORTED` s postmortem a **0 provider calls**, bez přepisování
ostatních syrových důkazů. Oprava `c75d0269` používá krátký soukromý socket
bindovaný do read-only namespace.

Na čistém `c75d0269` prošel `pilot-2` s filtrem jediného `http-plain` případu:
M1 HTTP 200, jeden validní provider `/api/chat` s přesným digestem, SQLite
obsahuje jeden user a jeden assistant turn a `integrity_check=ok`, M2 effect
tabulky mají nulový přírůstek. Odpověď vysvětlila HTTP 409 ve dvou věcně
správných větách. Výsledek runneru je **`LIVE_COMPLETE_UNASSESSED` pouze pro
transport jednoho případu**; ruční věcná kontrola zde platí jen pro tento
pilot. Soukromý záznam:
`.intentsmith-artifacts/chat-resilience/runs.json`, běh
`f836f0be-cd27-4a37-a146-55846a6d44`. Lease se uvolnil; model zůstal
dočasně rezidentní podle standardního keep-alive providera. Celých 53 × 3,
jejich významové hodnocení a nezávislá akceptace jsou stále **LIVE_NOT_RUN**.
