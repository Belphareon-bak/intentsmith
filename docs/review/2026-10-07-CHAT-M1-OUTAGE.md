# C1 — pravdivý M1 výsledek při výpadku klasifikátoru

**Stav:** SOURCE_REVIEW_PASS; širší offline/database a CHAT7 kontroly PENDING.
ROOT integrace, fresh5, živý Studio → D1, GPU opakování a release přejímka NOT_RUN.
Autorita: explicitní převzetí úzké M1 opravy operátorem 7. 10. 2026,
stávající M1 kontrakt a WP-CHAT-QUALITY-20261001. Aktuální společný deník je
[WORK-PROGRESS](../WORK-PROGRESS.md); tento paket uchovává důkaz jednoho cyklu.

## Identita a rozsah

- Base ROOT: `a61fe70d5ddabd63e066e9cbf4c8111b88f9fa56`.
- RED regrese: `68a51405213f825acb14213a7e97a0bce1f1128a` (produkt stále base).
- Přezkoumaný produkt/testy: `1f0989124630887edd5ab146e6acf662a5b2307d`.
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
Příkazy níže mají očekávaný exit 0 na kandidátu; všechny používají vlastní DB:

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
a jejich přesné command/exit/HEAD/log/report identity budou doplněny po skončení.
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
