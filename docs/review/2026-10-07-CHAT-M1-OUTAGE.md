# C1 — pravdivý M1 výsledek při výpadku klasifikátoru

**Stav:** SOURCE_REVIEW_PASS; finální offline/database **410 PASS / 0 FAIL /
BLOCKED / TIMEOUT / SKIPPED**, CODE12 12/12, CHAT7 7/7, CI všech 18 kroků SUCCESS.
**FINAL_EVIDENCE_REVIEW_PASS — připraveno pro ROOT integraci.**
ROOT integrace/fresh5 zůstávají otevřené.
ROOT integrace, fresh5, živý Studio → D1, GPU opakování a release přejímka NOT_RUN.
Autorita: explicitní převzetí úzké M1 opravy operátorem 7. 10. 2026,
stávající M1 kontrakt a WP-CHAT-QUALITY-20261001. Aktuální společný deník je
[WORK-PROGRESS](../WORK-PROGRESS.md); tento paket uchovává důkaz jednoho cyklu.

## Identita a rozsah

- Base ROOT: `a61fe70d5ddabd63e066e9cbf4c8111b88f9fa56`.
- RED regrese: `68a51405213f825acb14213a7e97a0bce1f1128a` (produkt stále base).
- Přezkoumaný produkt/testy: `1f0989124630887edd5ab146e6acf662a5b2307d`.
- Testovaný a publikovaný checkpoint: `b9cfc7c56d6cf5648267a40573805fe1cd67241c`.
  Strom src, chat-context regresní test a lockfile jsou shodné s přezkoumaným zdrojem.
  Jedinou změnou zbytku tests stromu je samostatně schválený module baseline.
- [Konečné příkazy, exity, reporty a SHA-256](evidence/chat-m1-outage-20261007/verification.json).
- [Přesný produktový a testový diff](evidence/chat-m1-outage-20261007/product-and-regression.patch).
- [Manifest raw logů, SHA-256 a zachovaných JSON](evidence/chat-m1-outage-20261007/manifest.json).

CHAT zapisuje pouze klasifikační propagaci chyby, regresi a dokumentaci.
Dosavadní ROOT vlastní HTTP/Fan/fresh5/M6 a převzetí této větve. Hunt i druhý
posudek jeho matice zůstávají oddělené. D1 `8fe6fb53` je předek kandidáta.
Zmrazený Gemma kandidát `9591ea1b` se nepřesunul; produkce `c84b88cd` se neměnila.

## Změna a reprodukce

Původní klasifikátor zachytil providerový výpadek a vydal fallback: skutečný
HTTP požadavek na odborný rozbor obdržel HTTP 200 / status:ok a obecné doptání,
které se zapsalo jako assistant. RED toto doložil pro HTTP 503 i odmítnuté spojení.

Patnáct přidaných řádků v `src/chat/cre-decision.js` předává existující
`LLMProviderUnavailableError`. Kontroluje typovaný kód i čtyři síťové kódy
z gateway v řetězci `cause`, s ochranou proti cyklu. Zrušení má stále přednost;
chybný JSON, neplatný intent/confidence a běžná textová chyba zachovávají fallback.
Gateway ani pravidla projektu/M2 se nemění.

Test používá skutečný backend a HTTP rozhraní, privátní SQLite a řízený
loopback provider. Výsledek po opravě: HTTP 503 / status:error /
LLM_PROVIDER_UNAVAILABLE, žádná response ani soukromý providerový detail,
jen uživatelský tah a žádný další tool request. Restart stejné DB zachová stav.
Matematika 17 × 23 funguje bez inference. HTTP 503 vyvolá právě jeden pokus
klasifikace; nejde o test živého modelu.

## Nezávislá revize a kontroly

Reviewer `/root/m1_outage_review` přezkoumal přesné `1f098912` proti base,
RED důkaz a sám opakoval tři sady. Bez nálezů P0–P3 v přiděleném rozsahu.

| Kontrola | Autor | Reviewer | Očekávaný exit |
| --- | --- | --- | --- |
| context | 27/27 PASS | 27/27 PASS | 0 |
| M1 contract | 74/74 PASS | 74/74 PASS | 0 |
| project collaboration / D1 regrese | 44/44 PASS | 44/44 PASS | 0 |
| Původní outage reprodukce | 2 vadné scénáře; parent + 2 subtesty FAIL | RED log ověřen | 1 na RED |
| Module boundary před přijetím hrany | přesně 1 ADDED | hrana schválená | 1 před přijetím |

Reviewer výslovně schválil jedinou hranu
`src/chat/cre-decision.js -> src/core/chat-turn-error.js`: existující terminální
chyba, bez nové authority nebo efektu. Autor poté spustil exact-edge writer na
čistém `1f098912`: 1511 → 1512 hran, 0 odstraněných, cykly 3 → 3 / členové 28 → 28.
Baseline připíná tento sourceRevision a sourceTree; reviewer jej sám neupravoval.

Původní direct-test runtime adresáře uklidil existující helper. RED pozorování
je celé v assertion logu; jeho dočasné JSON cesty se neprezentují jako zachované.
Finální context znovu prošel 27/27 s `KEEP_TEST_RUNTIME=1`; čtyři raw JSON před/po
restartu jsou veřejně přiložené byte-for-byte a privátní runtime zůstal zachován.
Neúspěšný mezikrok `green.log` je v manifestu výslovně označený jako FAIL.

## Opakování a předání

Pracovní adresář: `/home/belphareon/Projects/intentsmith-chat-quality-20261001`.
Node 24.21.0 je v `/home/belphareon/.nvm/versions/node/v24.21.0/bin`.
Příkazy níže mají očekávaný exit 0 na checkpointu `10ef40ab`, který obsahuje
přijatý baseline. Na samotném source `1f098912` má module ratchet očekávaný
exit 1 (dosud nepřijatá hrana); ostatní uvedené kontroly mají exit 0.
Testy používají vlastní DB:

```bash
export PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:/usr/bin:/bin
KEEP_TEST_RUNTIME=1 node --test tests/chat-context-interpretation.test.js
node --test tests/m1-chat-contract.test.js
node --test tests/project-collaboration.test.js
node scripts/module-boundary-ratchet.mjs
npm run test:registry
git diff --check
git diff a61fe70d5ddabd63e066e9cbf4c8111b88f9fa56 1f0989124630887edd5ab146e6acf662a5b2307d -- src/chat/cre-decision.js tests/chat-context-interpretation.test.js
```

Poslední příkaz má exit 0 i při zobrazených rozdílech. Širší registrované běhy
a jejich přesné command/exit/HEAD/log/report identity jsou v konečném manifestu
odkazovaném výše; každý příkaz je uložený jako argv, včetně prostředí a očekávaného
exitu (0 pro finální kontroly, 1 pro oba historické FAIL běhy).
Následný předávací commit smí měnit pouze baseline, dokumentaci a důkazy;
produktové/testové blobs se musí shodovat s přezkoumaným `1f098912`.

**Co nečíst:** `restricted/`, H1/H2 plaintext, odpovědi a hodnocení holdoutu,
cizí privátní raw stopy; žádné rekurzivní prohledávání evidence rootu.
Známá 53případová regrese je exponovaná a má oddělený C2 report. H1 je
UNSEALED / NOT_RUN, neposkytuje tomuto cyklu žádný výsledek.

**GPU okno:** C1 a CPU opakování GPU nepotřebují. Pro fresh5/živé opakování
je vlastník ROOT, před spuštěním musí být dohodnutý reviewer, začátek/konec
a předání lease s čistým procesním/GPU inventářem. Okno dosud RESERVED není;
to blokuje jen živý běh, ne toto CPU předání. Tento worker nespouští inference.

Po publikaci ROOT převezme přesný commit, ověří svůj společný freeze/CI a
původní fresh5. Historický fresh5 3 PASS / 2 FAIL se nepřepisuje. CHAT kvalita
zůstává NO_GO a release NOT_ACCEPTED; tato úzká oprava sama nepřijímá ani jedno.

## Širší profil — zachovaný první FAIL

`10ef40ab`, 15:13:11–15:23:03 UTC: 409 PASS / 1 FAIL / 0 BLOCKED / TIMEOUT /
SKIPPED, exit 1. Jediný program M2 governance evaluator má 31 PASS / 3 FAIL
pro TypeScript. Přímý import zjistil chybějící `tree-sitter-typescript`;
porovnání node_modules locku s integrovaným package-lock ukázalo pouze tento
balík 0.23.2 a jeho vnořený JavaScript grammar 0.23.1. Oba byly v autoritativním
lockfilu, ale po převzetí checkoutu chyběly v instalaci.

Původní report:
`.intentsmith-artifacts/test-runs/chat-m1-c1-full-20261007-10ef40ab/report.json`.
Přesný příkaz, prostředí, exit a hash logu:
`.intentsmith-artifacts/chat-m1-outage-20261007/full-profile-receipt.json`.
Synchronizace pouze vlastních závislostí přes `npm ci --no-audit --no-fund`
není produktová oprava ani důvod přeznačit tento report. Následuje samostatné
opakování se stejnými kontrolami a znovu doloženou identitou.

## Druhý zachovaný FAIL a finální zelený profil

Druhé celé opakování `b9cfc7c5`, 15:29:40–15:39:29 UTC: opět 409 PASS / 1 FAIL,
ale M2 governance už má 34/34 PASS. Jediný FAIL je mobile-browser-a11y: po npm ci
chybí původní browser na projektové cache cestě. Npm ci bylo podle záznamu autora
v této relaci spuštěno s `PUPPETEER_SKIP_DOWNLOAD=true`; tato konkrétní hodnota
není nezávisle zachycená v npm receipt/logu a nepřipisuje se jim. Původní receipts
se zpětně nepřepisovaly. Chybějící browser a následná přesná verze jsou přímo v logu.

`npx --no-install puppeteer browsers install chrome` obnovilo zamčený
Chrome 152.0.7977.75, exit 0. Samostatný registrovaný browser retest má PASS
(24 skutečných browserových kontrol), 15:41:44–15:42:11 UTC.
Finální celý profil **15:42:11–15:51:54 UTC, b9cfc7c5: 410 PASS / 0 FAIL /
BLOCKED / TIMEOUT / SKIPPED, exit 0**. Všechny tři celé běhy mají stejné
inventory/options/registry fingerprinty, žádné vyřazení testu ani `noBlock`.

CODE12 **12 PASS** a CHAT7 **7 PASS**, oba exit 0 na `b9cfc7c5`.
[CI37644166375](https://github.com/Belphareon-bak/intentsmith/actions/runs/37644166375)
na stejném SHA: všech **18 kroků SUCCESS**, ověřený dokončený job 112870464823.
Konečný manifest uchovává každý report samostatně, včetně obou FAILů, environment
receiptů a jejich hashe. Součet ověřených dílčích logů je 1250 (3×410 +12 +7 +1).

Reviewer `/root/m1_outage_review` přijal opravy prostředí a zachování původních
FAILů, s výslovnou provenienční výhradou k npm environment výše. Finální celý
profil do tohoto dřívějšího review nespadal; jeho samostatné review je uzavřené níže.
Žádná runtime/produktová oprava mimo již přezkoumané C1 se kvůli prostředí nedělala.

## Uzavření cyklu pro ROOT

Nezávislý `/root/workflow_review` vydal **FINAL_EVIDENCE_REVIEW_PASS** pro
`b9cfc7c56d6cf5648267a40573805fe1cd67241c`: ověřil 1250 suite logů a dalších
27 artefaktů, shodu tří celých profilů, oba zachované FAILy, všechny finální
výsledky a přesný CI job. Přijatý manifest SHA-256:
`de2302b3ee3c3910d4bec17c82f5583e2a91a91fc79f175043e45688d90c89a7`.

Závěrečný commit k tomuto checkpointu přidává pouze aktuální dokumentaci a
manifest. Pro úplný diff včetně dokumentace, baseline a důkazů použij:

```bash
git diff --binary --full-index a61fe70d5ddabd63e066e9cbf4c8111b88f9fa56 b9cfc7c56d6cf5648267a40573805fe1cd67241c
git diff b9cfc7c56d6cf5648267a40573805fe1cd67241c HEAD
git diff --exit-code b9cfc7c56d6cf5648267a40573805fe1cd67241c HEAD -- src tests scripts package.json package-lock.json
```

Očekávané exity jsou 0; třetí příkaz potvrzuje, že závěrečné předání nemění
přezkoumanou implementaci, testy, baseline, runner ani závislosti. Skutečný
publikovaný HEAD je uvedený při předání a ověřený přes `git ls-remote`.
Samostatné dokumentační kontroly: artifact160 PASS, registry596 valid,
module boundary1512/3/28 PASS, `git diff --check` PASS.

ROOT nyní převezme větev/commit do svého integračního checkpointu a provede
vlastní freeze/CI/fresh5; dosavadní ROOT checkout ani produkce se tímto cyklem
nezměnily. GPU reviewerovo okno pro živý běh dosud není rezervované. Tento C1
je plně opakovatelný bez GPU. H1 zůstává UNSEALED/NOT_RUN; určení odděleného
správce sběru bylo operátorovi položeno předem, odpověď dosud není zapsaná.
