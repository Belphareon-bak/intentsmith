# WP-M6-RELEASE — zmrazený kandidát a validační matice IntentSmith 1.0

**Typ:** zapisující Work Package · **Stav:** CANDIDATE_COMPLETE / TECHNICAL_IMPLEMENTATION_PASS / REVIEW_PENDING / ACCEPTANCE_BLOCKED
**Vstupní revision:** `55938fd0628bdb725736acdf21a451854580aaa7`
**Vlastník:** `codex/m6-release-20260827`, jediný writer tohoto checkoutu

Operátor 2026-08-27 výslovně povolil implementovat všechny bloky M6 bez čekání
na technické re-review M5. Toto povolení mění pořadí práce, nikoli pravdu o
branách: M5 zůstává `5/9 REVIEW_PASSED / 4 RE_REVIEW_REQUIRED`, skutečné rotace
a disposition historie nejsou provedené a M6 se nesmí označit `ACCEPTED`, dokud
nejsou splněné vstupy a exit kritéria `ROADMAP.md §10`.

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
