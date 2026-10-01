# WP — význam přirozeného zadání DPH

Autorita: explicitní zadání operátora a reprodukce review na `77672c2`;
`PRODUCT.md` §2/§3 a `CONTRACT.md` §4/§10. Vstupní kandidát
`4cbb4b55ee8ef5fa0e1c6ec3401d3e9802c2af32`.

## Chování a rozsah

Požadavek na stručnost či tabulku nemění jednoznačný výpočet. Model vyloží
celé přirozené zadání a kontext do typovaného plánu. Jádro ověří konkrétní
nástroj, částku, sazbu, rok a směr; model nesmí změnit zdrojovou peněžní
hodnotu ani vynechat odporující či další neřešitelný požadavek. Výpočet a
prezentace zůstanou deterministické. Jednoduchý celý kalkulátorový výraz
zůstane bez modelu. Nejednoznačnost, negovaný výpočet nebo neověřený plán
nevytvoří úspěšný výsledek. Bez GPU se ověří skutečné M1 HTTP a SQLite s
řízeným providerem; živá jazyková kvalita zůstává `NOT_RUN`.

Vlastněné plochy: `specialists/accountant-cz/index.js`, nový balíčkový
modul významového plánu, dispatch v `src/chat/handlers/{specialist,expertise}.js`,
malý runtime konektor pro async package resolver, cílené VAT testy,
`tests/registry.json`, generovaná mapa testů a tento WP. Zakázané plochy:
produkční DB, běžící release, GPU/Ollama, ostatní handlerové opravy.

Konektor: registrovaný nástroj může mít `resolveParams(input, context)`;
jádro poskytuje pouze autorizovaný modelový interpret a omezenou historii.
Výstup se ověřuje před cache a před deterministickým ToolAdapterem.

## Ověření

M1 pozitivní formátové varianty, negace celého výpočtu, negace jen formátu,
citovaná negace, odporující směry, více neřešitelných výpočtů, pozměněná
částka/sazba/rok, neplatný JSON nebo neúplné pokrytí zadání. Trvalá historie
se porovná s odpovědí. Stop: nesoulad zdrojové částky nebo možnost počítat
navzdory negovanému plánu. Přesné příkazy a výsledky budou doplněny po běhu.

## Výsledek kandidáta

Na vstupním SHA byl skutečný požadavek „… a napiš výsledek stručně“ odmítnut
jako `NEEDS_INPUT/compoundIntent`. Red-first první sada měla 16 selhání;
reprodukce této konkrétní chyby porovnává M1 status a odpověď. První
registrovaná sada na `fbad93b1` měla 22/22 PASS, včetně restartu a trvalého kontextu. Další
konkrétní negativní případy: jiná částka/sazba/rok, obrácení explicitního
základu bez DPH, pokus schovat alternativní sazbu do formátu, falešný rozsah
citace, vynechaná věta, neplatná authority navíc, rozbitý JSON, selhání
provideru a useknutý plán. SQLite nemá pro tyto průchody žádný ToolRequest.

Model vyloží přirozené zadání do `VatIntent/v1`. Jádro poskytne autorizovaný
`classifyIntent` connector přes registrovaný runtime; balíček jej neimportuje.
Úplný zdrojový text musí být zachován v segmentaci plánu. Peněžní parametry
se znovu čtou ze zdroje; hodnoty v modelovém plánu se s nimi porovnají.
Po opravě nezávislého review se sazba/rok/částka čtou z celého původního
vstupu; modelové štítky ani hranice segmentů je nemohou vyřadit. Kontext
tvoří nejvýše osm trvalých tahů ze stejného projektu,
s dohledatelným původem a nejvýše 500 znaky na tah; technické hlášky a
souhrn bez projektové provenance se nepředávají. Parametry předchozího
výpočtu se při semantic resolution nepřebírají ze session cache.

Prezentace `table/concise/bullets/explanation` používá jen výsledek skutečného
kalkulátoru. Číselný požadavek na dvě nebo tři odrážky musí mít typovaný
`presentation.itemCountSource`, který obsahuje jedinečný doslovný počet
a jednotku odrážek z originálu. Jádro ověří hodnotu a jednotku rozvržení;
měna, procento ani rok nemohou tvořit tuto výjimku. Renderer dodrží počet.
Vysvětlení ukáže vzorec výpočtu a zaokrouhlení,
nevytváří právní text. Whole calculator expression dál funguje bez modelu.
Přirozená prose spotřebuje jedno další inference volání; direct-expertise
průchod má také svou stávající CRE klasifikaci. Selhání provideru ani
cancellation se nemění na domněle úspěšný výpočet.

Ověřené příkazy (Node 24.21.0, soukromé testovací runtime):

| Příkaz `node tests/…` | Výsledek |
|---|---:|
| `chat-vat-semantic-http.test.js` | 27/27 PASS po review opravě |
| `chat-accountant-model-contract.test.js` | 53/53 PASS |
| `chat-accountant-deterministic-http.test.js` | 1/1 PASS; přesný kalkulátorový výraz, restart, žádná inference |
| `accountant-self-contained.test.js` | 27/27 PASS |
| `accountant-tools.test.js` | 81/81 PASS |
| `specialist-runtime.test.js` | 24/24 PASS |
| `tool-adapter.test.js` | 94/94 PASS |
| `m1-chat-contract.test.js` | 73/73 PASS |

`node scripts/validate-test-registry.js --json` je validní: 591 programů;
fingerprint `8225f8bb671d654e87aaf96351aa5934b3e88aeaae5fab0756be2856e6f60b9a`.
`git diff --check` je čistý. Širší profil tohoto nového SHA neběžel.

Nezávislé review prvního kandidáta `fbad93b1` bylo **CHANGES_REQUIRED**.
Skutečný M1/SQLite průchod přijímal částku 10 000 při doplnění alternativní
částky 20 000, pokud model tuto větu označil jako formát. Rozdělení „12 %“
či „20 000 Kč“ mezi formát a zdvořilost také ukrylo alternativu. Úplné
pokrytí řetězce samo tuto chybu nechránilo. Čtyři přidané red-first případy
(včetně rozděleného alternativního roku) na tomto kandidátu skutečně
vracely `SUCCESS`; po opravě mají `NEEDS_INPUT`, žádný výsledek ani
ToolRequest. Další test odmítá pokus prohlásit částku „2 Kč odrážky“ za
počet položek. Modelová segmentace už číselný zdroj neupravuje.

Review také našlo oslabení původního oracle dokumentového workflow:
společný pomocník přehlížel provider lookupy. Pro oba non-VAT dokumentové
průchody je obnoven úplný zero-contact oracle. VAT prose povoluje pouze
explicitní JSON rozpoznání významu a jeho lookup `/api/tags` či
`/api/show`; wrapper ani jiný endpoint není povolen. Obnovená sada má
53/53 PASS. Reporty jsou v soukromých `vat-whole-input-{red,green}.log`,
`vat-model-contract-after-review.log` a `vat-runtime-after-review.log`.

**Stav: `REVIEW_PENDING`, živá významová kvalita `NOT_RUN`.**
Řízený provider dodává předem pojmenované významové plány; dokládá propojení,
numerickou kontrolu, přesnou prezentaci a persistenci. Správnost modelových
štítků pro neznámé formulace, negaci či implicitní směr musí ještě potvrdit
krátký živý pilot a přejímka jednoho zmrazeného kandidáta. Při samotném
číselném dovětku bez DPH triggeru tento WP nově nepřebírá starou částku;
obecná konverzační kompozice zůstává další integrační cesta.
