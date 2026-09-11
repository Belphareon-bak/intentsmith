# Conversation web review follow-up — 2026-09-11

Stav: `IMPLEMENTED_CANDIDATE / WEB_REVIEW_REQUIRED`. Input:
`4166056e81481415bbfa21228ec13f2b3fa2b5a5`; source/test candidate:
`dbe6630abefbffac8489c4cc0901997b52375e6d`; full web base:
`983121eece58b8522f736d4c8bc7c7e0ea4f657a`.

Pracovní strom: `/home/belphareon/Projects/intentsmith-audit-20260911-FNF2jj/snapshot`,
větev `work/audit-remediation-20260911`. Root byl jediný writer; dva souběžné
read-only proudy posoudily webovou bezpečnost a revizní scope. Nový worktree
nevznikl. Modelový klon, cizí změny, produkční DB, bindingy, inference a cizí
procesy zůstaly nedotčené. Nebyl proveden push ani release.

`226bc96e` opravuje místní transportní provenance a terminal audit po revoke;
obsahuje také oba vadné první peer případy. `39c96957` připíná jedinou novou
module hranu `src/network/conversation-web-repository.js -> src/security/global-auth-policy.js`.
Graph: 1321 hran, 3 cykly / 28 členů. Registry: 515 programů,
421 ACTIVE / 79 BLOCKED / 15 HISTORICAL; fingerprint
`bb85f822d48d34e3a09297b026583ce808bfb05d28c764935e1c67481e7d2ad6`.
Současný JS census: src 605 souborů / 222 884 řádků; tests 521 / 241 620.

## Příkazy

```bash
node tests/conversation-web.test.js
node tests/m2-lifecycle-application-service.test.js
node tests/m5-global-auth.test.js
node tests/m7-conversation-command-executor.test.js
node tests/m2-tool-production-consumer.test.js
npm run test:registry
node tests/artifact-validation.test.js

unshare --user --map-root-user --net -- sh -c \
  'ip link set lo up && exec node scripts/run-suites.js --keep-run-root --suite=IS-T3-TESTS-CONVERSATION-WEB-HTTP-TEST,IS-T1-TESTS-M5-GLOBAL-AUTH-TEST'

LC_ALL=C \
INTENTSMITH_PDF_PYTHON=/home/belphareon/worktrees/is-m6-operator-demo-prep-20260827/.intentsmith-artifacts/pdf-runtime/bin/python \
npm run test:deterministic -- \
  --allow-blocker=toolchain:git --allow-blocker=toolchain:bwrap \
  --allow-blocker=toolchain:bubblewrap --allow-blocker=toolchain:prlimit \
  --allow-blocker=toolchain:python-pdf-runtime \
  --run-id=conversation-web-review-20260911-02 --out-dir=.intentsmith-artifacts/audit

git diff --check
```

Lokální toolchain výjimky zpřístupňují deklarované skutečné Git/bwrap/prlimit/PDF
prerekvizity; nevynechávají neúspěšné testy. Běželo nad připnutým čistým vlastním
checkoutem, s izolovanými testovými DB; nejde o novou fresh-clone acceptance.
HTTP namespace nemá odchozí routu. Full deterministic runner pro každý program
zaznamenává vlastní environment, source a stav pracovního stromu.

## Výsledky

Na `dbe6630abefbffac8489c4cc0901997b52375e6d`:

| Důkaz | Výsledek a hranice |
|---|---|
| Úplný deterministic profil | **353/353 PASS**, 0 FAIL/TIMEOUT/BLOCKED/SKIPPED; všech 353 source/clean údajů a log hashů ověřeno. |
| Webová DB/transport sada | **20/20 PASS**, včetně skutečného M7 executoru, odvolání scope, auditu a replay. |
| Lifecycle application service | **36/36 PASS**, včetně obou vadných prvních peerů a rollbacku celé dávky. |
| M5 global auth + web HTTP | **2/2 programy PASS** v namespace; auth **13/13** podle TAP logu, web HTTP **2/2** podle reportu. Runner u TAP sady uvádí stepsPassed=0, proto se počet auth případů odvozuje z raw TAP. |
| Původní offline M7 + production tool consumer | **4/4 + 22/22 PASS** v plném profilu. |
| Registry, artifact, module/isolation | PASS; 515 programů beze změny, 158 artifact případů, 1321 hran a 128 chráněných DB test roots. |

První úplný běh `39c96957` je zachovaný jako **349 PASS / 2 FAIL / 2 TIMEOUT**.
Nový PASS je jeden celý běh, nikoli součet cílených oprav. M2 authority repository
nyní prošlo 13/13 za 2718 ms, tool broker 34/34 za 3029 ms při původním 30s limitu.
Příčina předchozích timeoutů není prokázaná; zůstává to omezení reprodukovatelnosti.


| Artefakt | SHA-256 |
|---|---|
| `.intentsmith-artifacts/audit/conversation-web-review-20260911-01/report.json` | `7b4b0399763cec2489b716f98a091c2475d6257d8e9cab9e8c14d45ae563b4d8` |
| `.intentsmith-artifacts/audit/conversation-web-review-20260911-02/report.json` | `6fc617bddff51aaf2050101cf3ea1eb2760f337728711ec251d6dece6c1dc084` |
| `.intentsmith-artifacts/run-suites/2026-09-11T21-28-10-122Z/report.json` | `2913812b2c92ca00b9b95a3c28962e9d7bf83e4a21652be8d4819503f365d121` |
| `.intentsmith-artifacts/conversation-web-review-evidence.json` | `7f092922ae358ef846a4e6dbaf15cf1f1bac6a81490b317d05d3ebd683c55757` |
| `.intentsmith-artifacts/conversation-web-review-evidence.tar.gz` | `bec71b1793a0e2c0ffafe05ccd9a8e9fb76e4222ba48d842ec7c7ceab5c55b7c` |

Manifest zahrnuje 735 artefaktů; oba kompletní běhy mají
nezávisle přepočtené hashes všech 706 logů. Archiv má 835931 B;
každý člen byl znovu porovnán s manifestem. Obsahuje reporty a logy, nikoli
produkční DB. Source manifest ověřuje přesné bytes rozhodujících souborů proti
commitu. Nový přenosný Git bundle je
`.intentsmith-artifacts/intentsmith-conversation-web-review-20260911.bundle`;
vyžaduje base `983121ee`. Jeho final HEAD, hash a výsledek `git bundle verify`
jsou v `.intentsmith-artifacts/conversation-web-review-handoff.json`.


## Zachované neúspěchy a limity

První nová revocation regrese `web-review-focused-01.log` skončila
13 PASS / 1 FAIL: test očekával běžnou odpověď po explicitním cancel, zatímco
stávající cancellation kontrakt správně vyhodil `ABORT_ERR`. Oracle byl opraven
na `assert.rejects`; žádný produktový abort nebyl potlačen. Následné běhy 02,
03 a 04 prošly 14, 15 a 19 případy. Po přesunu stejné M7 regrese do webové DB sady prošlo 20 případů (běh 05).

První full run na `39c96957` je `349 PASS / 2 FAIL / 2 TIMEOUT`: ROADMAP
uváděl 1320 namísto 1321 hran a do offline M7 testu přidaný DB scénář změnil
chráněný import census 128 na 129. Regrese byla přesunuta do existující webové
DB sady, beze ztráty assertions; M7 si ponechal své deklarované offline fixtures.
Po opravě počet zůstal 128 a mutation test odstraněného isolation anchoru prošel.
M2 lifecycle authority repository a tool broker překročily původních 30 s;
limity ani jejich produktové/testové chování nebyly změněné. Nové ověření je
samostatný celý běh, nikoli složení cílených PASS.

`web-review-artifact-02.log` zachovává ještě 157 PASS / 1 FAIL kvůli chybějící
čárce v nově generované census tabulce. Oprava formátu prošla 158/158 v běhu 03.
Původní 349 PASS / 3 FAIL / 1 TIMEOUT i staré historické manifesty zůstávají.

Read-only recheck nezjistil po opravách novou blokující vadu. U runtime souborů
ověřil SHA-256:

| Soubor | SHA-256 |
|---|---|
| `src/network/conversation-web-repository.js` | `1b6e51deb833d735ccd95ba8ec33bc8dba1290ff4cc65788df4d34a94b834450` |
| `src/chat/handlers/conversation-web.js` | `36794a0e1e2da6a0111f677eb84387f50588bb9569df245119f6f37b69a66fe0` |
| `src/security/global-auth-policy.js` | `74cc8dc3233690a9ae380aad47cf7cd32c99b94503949f908cb6c78e6687b762` |
| `contracts/m2/conversation-web-v1.js` | `bcb48e49958ee6e4f027b1f3d370d01ba9e4a472b1f9b31816f4fbaa2dd710ae` |

Paměťový probe rechecku: actual M7 odmítnut `WEB_LOCAL_TRANSPORT_REQUIRED`,
pending zachován; následný local claim → revoke → dvakrát failClaim zanechal
revoked a právě decision/allow + terminal/failed, network calls 0. Tyto výsledky
jsou zde záznamem spolupracující kontroly; primární reprodukovatelné důkazy
jsou commitnuté testy a jejich raw logy, ne tvrzení tohoto dokumentu.

HTTP 2/2 znamená proposal/cancel a private-IP deny/replay přes skutečný server.
M7 test používá skutečný executor a handler s kontrolovaným handoff adaptérem,
ne celé VPN/ChatController journey. Finální M7 mapování doručuje odmítací
text jako dokončenou konverzační odpověď (M1 `ok`), nikoli typed web error;
pending web ani 0 I/O se tím nemění. DNS/TLS transport je v unit testu injektovaný.
Audit outage může stále zanechat executing bez terminalu; UI to hlásí unavailable,
I/O se neopakuje. Process-local claim nenahrazuje recovery po pádu procesu.

Model, Studio build a Electron nebyly v tomto follow-upu spouštěné; jejich
předchozí samostatné důkazy se nepřeznačují na novou revizi. Reputace webu,
autonomní egress a nový veřejný provider test nejsou obsahem tohoto běhu.
Migrace zde: 111 conversation_web, 98 celkem. Upstream `7c693d32` má vlastní
commitnuté 111 i 112; před integrací musí vzniknout společný census a ověření
upgrade obou linií. Kontrola před předáním zachytila čistý upstream `fe064ee8`, stejné migrace
a druhý dokument Decision 044 (reprodukovatelný evaluační provider). Při
integraci je třeba sladit také čísla rozhodnutí a odkazy, zachovat oba obsahy.
Celkový stav zůstává candidate vyžadující review.

[Samostatný packet](../../review/2026-09-11-CONVERSATION-WEB-REVIEW-PACKET.md)
a [vypořádání operátorského review](../../review/2026-09-11-PRODUCTION-FOLLOWUP-REVIEW-RESPONSE.md).
