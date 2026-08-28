# WP-M6-RELEASE — zmrazený kandidát a validační matice IntentSmith 1.0

**Typ:** zapisující Work Package · **Stav:** KEY_CEREMONY_COMPLETE / PRODUCT_RE_REVIEW_REQUIRED / TECHNICAL_REVIEW_CHANGES_REQUESTED / ACCEPTANCE_BLOCKED
**Vstupní revision:** `55938fd0628bdb725736acdf21a451854580aaa7`
**Vlastník:** `codex/m6-release-20260827`, jediný writer tohoto checkoutu

Operátor 2026-08-27 výslovně povolil implementovat všechny bloky M6 bez čekání
na technické re-review M5. Toto povolení mění pořadí práce, nikoli pravdu o
branách: M5 zůstává `8/9 REVIEW_PASSED / PRIVACY RE_REVIEW_REQUIRED`, skutečné rotace
a disposition historie nejsou provedené a M6 se nesmí označit `ACCEPTED`, dokud
nejsou splněné vstupy a exit kritéria `ROADMAP.md §10`.

Operátor tentýž den odložil všechny validační běhy, které vedou chat přes živé
LLM/Ollamu nebo hodnotí modelově závislou kvalitu, protože probíhá optimalizace
a aktivní modely se mohou změnit. Tyto řádky mají stav
`DEFERRED_MODEL_OPTIMIZATION`: nejsou PASS ani FAIL a starší modelové artefakty
se nesmějí připnout k novému kandidátu. Modelově nezávislé kontrakty, fake
provider testy, upgrade, soak a throughput bloky mohou pokračovat.

## 1. Uživatelský výsledek a rozsah

Vznikne reprodukovatelný IntentSmith 1.0 release candidate, jehož hlavní
Studio journey, lokální modelové role, řízené efekty, rozšíření, agenti, učení,
data/recovery a všechny podporované conditional plochy projdou jednou
spustitelnou a content-addressed validační maticí. Výsledek pravdivě oddělí
implementační zelenou, nezávislé review, operátorské demo a samotné vydání.

## 2. Vlastněné cesty a connector

**Vlastněné cesty:** `contracts/m6/**`, `src/release/**`, M6 testy a fixture,
`scripts/*m6*`, nezbytné focused opravy skutečných release regresí,
`tests/registry.json`, generovaný `docs/convergence/TEST-REGISTRY.md`, M6 run/review
dokumenty a přesné M6 stavové řádky v `ROADMAP.md`/`SYSTEM-MAP.md`.

**Connector:** interní `M6ReleaseValidation@1` mezi připnutým kandidátem,
test registrem, runtime evidence a release verdictem. Nemění veřejný HTTP/WS
produktový kontrakt ani model binding.

**Zakázané bez nové explicitní autority:** push, merge do cizí větve, tag,
publish, force/rewrite Git historie, credential rotation u providerů, změna
aktivního model bindingu, zásah do coworker checkoutu/procesů a souběžné GPU
zatížení.

## 3. Vstupní revision a závislosti

- technický základ: `55938fd0628bdb725736acdf21a451854580aaa7`;
- M1–M4 jsou operátorsky přijaté podle `ROADMAP.md`;
- M5 druhé review: 5/9 přijato, 4/9 implementačně opraveno a čeká na re-review;
- tvrdé acceptance závislosti: M5 9/9, 8/8 skutečných rotací, history receipt,
  nulové HIGH/CRITICAL blokátory a nezávislé M6 review;
- operátor povolil implementovat přes tuto závislost, ale ne ji přeskočit ve
  finálním verdiktu.

## 4. Malá demonstrace

Z čerstvého klonu připnutého commitu: instalace a produkční Studio build,
otevření Git projektu, pokračování existující konverzace přes lokální Ollamu,
malá schválená změna s plánem/efektem/testem/diffem/auditem, negativní
cancel/error/recovery větev, spuštění specialisty a extension agenta, kontrola
schváleného learning itemu a model-discovery conditional journey. Artefakt musí
nést exact candidate/build identity a nulový neočekávaný egress.

## 5. Pozitivní a negativní test

**Pozitivní:** všechny položky povinné matice `ROADMAP.md §10` vrátí PASS nad
jediným čistým kandidátem a release artefaktem.

**Negativní:** validator odmítne alespoň dirty/mismatched candidate, BLOCKED či
NOT RUN required řádek, chybějící L0 důkaz, nepovolenou conditional plochu,
nepřipnutý model/GPU artefakt, neodpovídající build digest, neuzavřenou M5
bránu a self-asserted review/operator approval.

## 6. Implementační bloky

1. release baseline: PDF/export, orchestration a VRAM determinismus;
2. executable release manifest a přesné candidate/artifact bindingy;
3. server/WS/Studio + effect/approval/security/data/recovery journey;
4. specialist/agent/learning/RemoteCorePort/conditional journey;
5. upgrade a backup/restore round-trip;
6. sekvenční Ollama/GPU, performance, soak/nightly a resource budgety;
7. třináct content-addressed L0 evidence řádků a Gate 0 attestační řetěz;
8. nezávislý review packet a operátorské demo; tag/publish až samostatně.

## 7. Stop condition

Zastavit konkrétní efekt a eskalovat, pokud by vyžadoval změnu některého L0,
oslabení acceptance, nový veřejný connector, destruktivní historii/rotaci,
tag/publish/push, neodsouhlasené produktové chování nebo kolizi s cizím
writerem či GPU/Ollama procesem. Ostatní M6 bloky mohou pokračovat a blokovaná
položka zůstane pravdivě `BLOCKED`.

## 8. Přesné ověření

```bash
node scripts/validate-test-registry.js
npm run test:deterministic
node scripts/validate-m6-release.js
npm run gate0:validate-disposition
npm run gate0:validate-attestation
git diff --check
git status --short --branch
```

WP je implementačně hotový teprve po čistém fresh-clone kandidátu a kompletním
review packetu. `ACCEPTED` vyžaduje navíc reálné M5 operátorské podmínky,
nezávislé review a demo; `BLOCKED`, `NOT RUN` ani předpokládaný budoucí PASS se
nepočítá.

## 9. Implementační closeout 2026-08-27

Níže uvedený closeout je historický dílčí důkaz, nikoli aktuální technical
verdict. Operátorský review prokázal, že locked set vynechal 58 ACTIVE+required
programů a finální validator mohl přijmout self-asserted ignorovaný JSON.
Aktuální stav je proto `TECHNICAL_REVIEW_CHANGES_REQUESTED`; 311/311 zůstává
pravdivým výsledkem pouze vybraného podsetu.

- exact product candidate: `8abd6065bd614a15bf9f7814dea14ed1e040c616`;
- candidate tree: `f41a6af70b29d9024ba1006aabe417aad2ff26aa`;
- registry: 464 programů, fingerprint
  `3593af7c529d73c15cc3f12ee7e4e90fd2de91e6b383313ac43bca46969ea342`;
- locked execution: 311/311 required výsledků PASS přes deterministic, owned
  server, controlled soak, detached fresh clone a fyzický GPU pilot;
- L0: 13/13 PASS; conditional model-discovery journey: PASS;
- release artifact: 7 content-addressed build souborů, exact candidate binding;
- validator: `valid: true / verdict: BLOCKED / exitCode: 2`, bez errors;
- productové review: `PENDING`; M5 acceptance, Gate 0 a operator demo:
  `BLOCKED` na externí autoritě.

Autoritativní implementační report je
[`m6-integration-closeout-20260827.md`](../execution/runs/m6-integration-closeout-20260827.md)
a přesná review jednotka je
[`2026-08-27-M6-OPERATOR-REVIEW-PACKET.md`](../review/2026-08-27-M6-OPERATOR-REVIEW-PACKET.md).
Tento zápis není self-issued `REVIEW_PASSED` ani release approval.

## 10. Remediation progress po review

Implementované, ale zatím znovu nezreviewované bloky:

- Git-native raw evidence a exact artifact/receipt re-evaluation;
- množinově úplný plán všech `ACTIVE + required` programů;
- sedmifázový plan v6 s exact runner-owned server authority pro devět
  historických live-server consumer journeys, exact toolchain preflightem a
  fail-fast po prvním required non-PASS (Decision 040);
- skutečný persistentní application upgrade 136.0.0 → 136.1.0;
- upgrade receipt v2 váže přesný inode/device stejného SQLite souboru,
  migrační počty 56 → 79, celý canary a skutečný `lo`-only network namespace;
- L0-11 durable model artifact authority podle Decision 037.

L0-11 focused důkaz aktuálně tvoří 11/11 nových adversariálních checks,
24/24 původní model-use, 8/8 VRAM a 108/108 binding/chat compatibility.
Schéma má 156 tabulek / 80 migrací a registr 471 programů, z toho 376 ACTIVE a
371 `ACTIVE + required`. Registry nyní fail-closed zakazuje required external
program, který committed runner musí vždy hard-blockovat; přesná disposition je
v Decision 039.
Původních třináct false-soak ACTIVE položek je překlasifikovaných podle
skutečného runtime. Nové 24h a pětiminutové throughput programy běží nad owned
production serverem v loopback-only Linux namespace; jejich zkrácené sondy
prošly, ale jsou explicitně `DEV_ONLY` a release evidence je odmítá. Skutečný
24h soak, plný maximum-throughput, nový complete candidate report a
operátorský re-review jsou stále otevřené. Stav proto zůstává
`TECHNICAL_REVIEW_CHANGES_REQUESTED / ACCEPTANCE_BLOCKED`.

## 11. Decision 041 second re-review remediation

Exact candidate `75498c69` dostal `CHANGES_REQUIRED`, přestože jeho focused
programy byly `375/375 PASS`. Commit `8632c490` uzavírá reprodukované raw-byte
a Git-history vady: SQLite authority načítá exact BLOB bytes; release verifier
prochází každý commit a diff vůči každému parentu, zakazuje merge a ověřuje
samostatně candidate→receipt evidence HEAD; všechny Git read cesty vypínají a
odmítají replacement metadata a skryté index flags.

Skutečný temp-Git E2E sestaví validní 13-receipt bundle a získá PASS ze
standalone verifieru. Mutace `src/server.js`, následný signed receipt a revert
vrátí FAIL v bundle CLI i plném release CLI. Focused a structural matice je
`382/382 PASS`, registry zůstává 471 / `ffb7110746…`. Třetí nezávislý review
kandidatu `37edf30d` skončil `REVIEW_PASSED` a samostatně autorizovaná
ceremonie 2026-08-29 připnula čtyři produkční veřejné klíče. Protože trust
store a M5-R19 oracle mění produktové bytes, nový candidate vyžaduje úzký
re-review. M5 i M6 zůstávají acceptance-blocked na skutečných receipts a
zbývající release/runtime evidence.
