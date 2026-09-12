# Studio composer, CODE provenance and process restart — 2026-09-12

Stav: **IMPLEMENTATION_AND_SCOPED_RUNTIME_VERIFIED / DELTA_REVIEW_REQUIRED /
PHYSICAL_MODEL_JOURNEY_UNPROVEN / ACCEPTANCE_BLOCKED**.
Autorita: PRODUCT §3, existující M2 connector a výslovné zadání operátora
pokračovat bez dílčích předání. [Vymezení práce](../../wp/WP-BUILD-COMPOSER-20260912.md).
Operátorem dodané [review na e87](../../review/2026-09-12-WEB-BUILDER-OPERATOR-REVIEW.md)
nenašlo blocker ve webu/builderu; nepřijímá tuto novou deltu ani celý release.

## Přesné zdroje a výsledky

Vlastní checkout: `/home/belphareon/Projects/intentsmith-audit-20260911-FNF2jj/snapshot`,
větev `work/audit-remediation-20260911`. Výchozí review pin
`e87b1ca2219fe330a05c73443a340983ff5410ea`; nový finální source
**`a10e3e0d3c429e2735205fba2019bebb43a56c34`**. Následující dokumentační
commit pouze opravuje návod a zaznamenává výsledky. Žádný push/integrace do
cizí větve, produkční DB, inference, pull, aktivace ani operátorské podpisy.

| Důkaz | Source | Výsledek a umístění pod `.intentsmith-artifacts/` |
|---|---|---|
| První celý deterministic | `9462ec0b` | **349 PASS / 3 FAIL / 1 TIMEOUT**, `audit/build-composer-20260912-01/report.json` |
| Finální celý deterministic | `a10e3e0d` | **353 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED**, `audit/build-composer-20260912-02/report.json` |
| První HTTP run | `1288e216` | **75 + 7 PASS**, `run-suites/2026-09-12T09-02-51-433Z/report.json` |
| Finální HTTP run | `a10e3e0d` | **75 + 7 PASS**, `run-suites/2026-09-12T09-39-02-022Z/report.json` |
| Studio build | `9462ec0b` | **PASS**, `build-composer-studio-build-20260912-02.log` |
| Nativní Electron | `9462ec0b` | **3/3 PASS**, `build-composer-studio-runtime-20260912-01/result.json` |

Finální deterministic běžel 09:33:46–09:38:23 UTC. SHA256 reportu:
`6202698c0dd32f50dce80be74b0f9cf7a6e4d178fb6e1db93c2304e903759f6d`.
Všech 353 logů odpovídá hashům v reportu; stejně byly ověřeny všechny logy
prvního neúspěšného běhu. Ten má SHA256 reportu
`0f9af9152968f471f48bf2dbc8235c972d33bbb708e707a6de55bc05b1bdf6f0`.

Z finálního profilu: service 53/53, Studio surface 36/36, routes 14/14,
web 23/23, CODE runner 56/56, CODE suite 23/23, evaluation suites 22/22,
model-upgrade 63/63, tool broker 34/34, candidate plan 21/21,
CDP reducer 62/62, Electron runner contract 21/21, artifact validation 158/158.
Registry: **516 programů / 422 ACTIVE / 79 BLOCKED / 15 HISTORICAL**;
všech 515 původních položek se zachovalo beze změny. Nový required DOM program
je v explicitní fresh-clone fázi `M6CandidateExecutionPlan@7`.
Registry hash: `162b890b97142127fdd4859bc48a02056a837b3fd2773e26d8a130e0e55f4deb`.
Module ratchet prošel: 1315 současných hran proti baseline 1321, žádná nová
hrana, stejné 3 cykly / 28 členů. Baseline se kvůli zelené nepřepisoval.

## Co runtime skutečně dokládá

Nový nativní DOM scénář přes sestavený renderer a skutečný autentizovaný
backend registruje privátní projekt a dvě konverzace, vyplní formulář běžnými
DOM událostmi a ověří focus, přesné argv včetně prázdného argumentu,
znehodnocení původního kontextu, explicitní zahození a zachování zadání i
běžného textu chatu po chybě. Projekt nemá policy: přesně jeden draft POST
vrátí skutečné **503 M2_LIFECYCLE_POLICY_UNAVAILABLE**, žádné schválení,
modelové volání ani souborový zápis. To je důkaz formuláře a odmítací cesty,
nikoli kladná generace. M0/M1 dál nepřijímají tuto výjimku ani DOM evidence.
Všechny tři scénáře mají vlastní loopback namespace, privátní Xvfb a skrytá
GPU zařízení. Electron sandbox je pro tento namespace probe vypnutý;
nejde o fresh-clone release envelope. Xvfb byl po běhu ukončen.

Frontend bundle SHA256:
`8fee233175ff7bc2b2f4bb5b98778c740c3c6720649119e1c20c4fdbd632ad69`.
Od `9462ec0b` do `a10e3e0d` se nezměnily produktové ani Studio/probe bytes;
paritu dokládá `build-composer-source-provenance-20260912.json`.

HTTP ponechává všech 27 původních kontrol nad skutečným `src/server.js`.
Dalších 48 kontrol používá produkční M2 routes/service a skutečné SQLite,
Git a bwrap, ale **fixture auth, project registry, model a composition**.
Úspěšný dvousouborový build projde šesti funkčními testy přestupných let,
schválením a přesným commitem. Vadný první dependency modul způsobí návrat
celé dávky: odstraní nový soubor, obnoví původní entrypoint a Git stav.

V obou případech první serverový proces skončí a další PID otevře stejnou DB.
Finální success: **1527870 → 1527991**; rollback: **1528005 → 1528106**.
Všechny čtyři procesy skončily exit 0 bez nuceného ukončení. Opakované approval
nezpůsobí novou generaci/efekt; celé M2 tabulky mají stejné počty a hashe,
status stejný obsah a soubory stejné bytes/inode/mtime. Evidence jsou v
podadresářích finálního HTTP runu `artifacts/m2-http-build-restart-6hbVEb/`
a `artifacts/m2-http-build-restart-1aogu1/`. Restart je po terminálu,
nikoli crash uprostřed efektu. Tyto důkazy se nesčítají s DOM a historickou
modelovou inferencí do jednoho fyzického journey.

## Zachované neúspěchy a příčiny

- První VM fixture postrádala `TextEncoder`; opraveno prostředí fixture.
- CDP reducer původně přehlédl druhou stejnou 503 v agregovaném záznamu;
  doplněna kontrola `count === 1`, původní negativní případ ponechán.
- Registry nejprve upozornil na nové helpery a tvar `lastGreen`; doplněny
  explicitní podpůrné exclusions a nevyplněný důkaz, žádný vymyšlený PASS.
  Artifact validation zachytila také neaktualizovaný census v README.
- Celý profil našel import census 128 místo 129, chybějící DOM membership
  v M6 fresh-clone setu a starý přesný registry seal. Nový HTTP root je jediná
  změna DB reachability; před i po ní je `unprotected=[]` a mutation sentinel
  dál odmítá odstraněný bootstrap. M6 omission a původní metadata jsou zachované.
- Tool broker překročil původní 30 s při opakovaném setupu schématu. Dvě
  párová měření osmi migrací: 1274/1390 ms samostatně proti 18/23 ms v transakci.
  SQL digest bez BEGIN/COMMIT i schema před/po reopen jsou stejné, foreign keys
  ON, synchronous FULL a journal DELETE. Transakce končí před testovanými
  durable operacemi; finální celý běh má tool broker za 1031 ms, všech 34 kontrol.
  Benchmark nepokrývá podmíněné M1 repair větve; ty byly ověřeny ze zdroje.
- Produkční policy validátor odhalil nesetříděné přípony v novém návodu.
  Doklad před/po zůstává v `build-composer-guide-policy-20260912-01.json`;
  opravuje se příklad, ne striktnost validátoru.

Read-only spolupracující review potvrdilo opravy starého approval callbacku,
active-send guardu, CODE import/runtime provenience a poslední setup/registry
integraci; root integroval a testoval. Není to nezávislé Opus acceptance.

## Reprodukce a předání

```bash
LC_ALL=C INTENTSMITH_PDF_PYTHON=/absolute/path/to/reviewed/pdf-runtime/bin/python \
npm run test:deterministic -- --allow-blocker=toolchain:git \
  --allow-blocker=toolchain:bwrap --allow-blocker=toolchain:bubblewrap \
  --allow-blocker=toolchain:prlimit --allow-blocker=toolchain:python-pdf-runtime
unshare --user --map-root-user --net -- sh -c \
  'ip link set lo up && exec node scripts/run-suites.js --keep-run-root --suite=IS-T3-TESTS-CONVERSATION-WEB-HTTP-TEST,IS-T3-TESTS-M2-LIFECYCLE-HTTP-E2E-TEST'
```

Electron launcher je zachovaný jako `.intentsmith-artifacts/run-build-composer-studio.py`;
vyžaduje explicitní místní Xvfb/Xauth a sestavené Studio. Nemění uživatelův displej.
Nový archiv, manifest a bundle jsou v `.intentsmith-artifacts/build-composer-review-20260912/`.
Obsahují raw úspěšné i neúspěšné reporty/logy a přesné hashe, nikoli privátní
runtime DB, Xauth, nainstalované dependencies či celé home adresáře.
Další akce a přesný review scope jsou v
[jednom navazujícím packetu](../../review/2026-09-12-BUILD-COMPOSER-CODE-REVIEW-PACKET.md).
