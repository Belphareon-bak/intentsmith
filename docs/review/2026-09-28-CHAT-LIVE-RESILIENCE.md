# CHAT resilience — živé srovnání a kandidát k revizi

## Stav

**NEEDS_MORE_WORK. Závěrečné živé ověření: BLOCKED_GPU / LIVE_NOT_RUN. Nezávislá revize: REVIEW_PENDING.**

Implementace a zmrazená sada: `66e824d739f6d9fbd0be333a539953ea7cb2297a`, branch `work/intent-resilience-20260928`. Poslední skutečně živě měřená implementace je **`7cd7397c`**, pouze pět ladicích případů. Pozdější změny záporu, stručnosti a odkazů na historii jsou ověřené offline; nemají živý retest. Produkce, živá DB, modelové bindingy a GPU nastavení se touto prací neměnily.

Autorita a rozsah: [WP](../wp/WP-CHAT-LIVE-RESILIENCE-20260928.md). **Jediný kanonický záznam**: [runs.json](../../.intentsmith-artifacts/chat-live-20260928/runs.json). Obsahuje všechny živé odpovědi A/B/C, skutečný kontext, provider request/response, latence, dostupné nativní M2 řádky, výsledné bajty souborů, vlastní hodnocení, offline pokusy i chyby runneru. Původní soubory zůstaly zachované a mají SHA-256 odkazy. Historické běhy neměly individuální porcelain snapshot; tento nedostatek je v záznamu přiznaný.

## Co měření odhalilo a co se změnilo

1. **Projektové plánování pohlcovalo běžný chat a tvorbu kódu.** Přímý CHAT odpověděl na překlep a vytvořil iterativní faktoriál; B psalo komentáře k plánování nebo odmítalo Python v Node projektu. Informační odpovědi a inline CODE nyní používají obsahovou cestu bez projektových efektů.
2. **Kontrola citací zaměňovala formulaci za podstatný parametr.** „Tři věci“/„tři“ a „v Pythonu“/„Pythonu“ způsobovaly zbytečné otázky. Informační parafráze neslouží jako oprávnění k efektu; konkrétní souborové cíle a skutečné vstupy nástrojů zůstávají vázané. Opraveny objektové cíle, obaly citací a chybějící akční slot.
3. **Historie a původ obsahu byly nedostatečné.** Klasifikátor dostává omezenou historii ze skutečné DB. Ukládání bere explicitní citovaný text nebo pozitivně označenou modelovou odpověď; schválení/chyby/upřesnění nejsou obsah. Core ověřuje přesnou identitu odkazovaného souboru z posledního seznamu; chybějící jméno zůstává otázkou i po „ano“.
4. **Měřený průchod schválením selhal až za původními mocky.** Přesné M2 schválení chybně procházelo jazykovým klasifikátorem a lazy produkční façade nepředávala resolver uloženého výsledku čtení. Obojí opraveno; C6 prokázalo dvě skutečná schválená uložení a jedno čtení. M2 schvalovací autorita zůstává původní.
5. **Produktivní ne-prefix blokoval běžná slova.** Odstraněn univerzální ne-prefix i whitelist new/next/network. Zůstává úzká pojistka výslovných zákazů známých operací podle konkrétního nástroje, technická validace a izolovaný původní GPU guard. To není obecný důkaz porozumění záporným větám.
6. **Prompt/budget podporoval dlouhé výklady.** Běžný budget je 768, výslovně stručný informační požadavek 256; explicitně podrobné požadavky mají větší limit. Prompt upřednostňuje přímou odpověď, aktuální opravu a pravdivé rozlišení textu od provedené operace. Živý dopad této poslední změny zatím neznáme.

Kód: [CRE a historie](../../src/chat/cre-decision.js), [vazby intentu](../../src/chat/intent-clarity.js), [projektový routing](../../src/chat/handlers/project.js), [odpovědi a budgety](../../src/chat/handlers/decisions.js), [M2 wrapper](../../src/executor/tool-executor.js). Produkční kompozici kontrolují [controller testy](../../tests/chat-intent-clarity.test.js); model v nich je řízený callback.

Checkpointy jednotlivých změn, hypotézy a zdůvodnění výsledků jsou v záznamu u každého případu. Po neúspěšném promptovém upřesnění C3 následovala oprava routingu a skutečné M2 cesty, nikoli další fráze pro tentýž vstup.

## Úplná matice dosavadních živých případů

**P** = pozorovaný úkol splněn; **S** = správný schvalovací návrh, vykonání netestováno; **F** = selhání; **—** = neběželo. U C5/C6 se hodnotí i následný schvalovací turn. Schválení M2 není zbytečná jazyková otázka.

| Případ | První B | Teplé B | C1 | C2 | C3 | C4 | C5 | C6 |
|---|---|---|---|---|---|---|---|---|
| HTTP 409, dvě věty | P | F | P | P | — | — | — | — |
| Paměť, bez diakritiky | F | F | P | P | — | — | — | — |
| Překlep jka, krátce | F | F | F | F | — | — | — | — |
| Nefunguje Wi-Fi | F | F | P | P | — | — | — | — |
| Python bez rekurze | F | F | F | F | F | P | — | — |
| Poděkování + nový dotaz | F | F | P | P | — | — | — | — |
| Ahoj → new-notes.md | F | F | F | F | F | F | F | P |
| Nemaž notes.md, přečti | F | F | F | S | S | S | F | P |
| Smaž ten druhý, bez kontextu | F | F | F | F | F | — | — | — |
| RAM vs disk | P | F | P | P | P | P | P | P |
| Oprava na lidskou paměť | P | P | F | F | P | F | F | F |
| Ulož předchozí odpověď | F | F | F | S | F | S | F | P |

| Běh / revize | P / S / F | Modelová volání aplikace | Teplá HTTP latence: n; medián; maximum |
|---|---|---:|---|
| První B / fb54fbf5 | 3 / 0 / 9 | 18 (+12 přímých A) | —; měnilo se 4k/16k, reloady |
| Teplé B / fb54fbf5 | 1 / 0 / 11 | 16 | 11; 5,96 s; 10,13 s |
| C1 / 08ce19a9 | 5 / 0 / 7 | 20 | 11; 6,90 s; 34,21 s |
| C2 / 0c0820eb | 5 / 2 / 5 | 19 | 11; 8,33 s; 28,23 s |
| C3 / 1f337e15 | 2 / 1 / 4 | 10 | 7; 5,43 s; 8,81 s |
| C4 / 38418397 | 2 / 2 / 2 | 9 | 6; 5,40 s; 17,59 s |
| C5 / a639e85e | 1 / 0 / 4 | 10 | 5; 4,19 s; 7,16 s |
| C6 / 7cd7397c | 4 / 0 / 1 | 7 | 5; 3,88 s; 7,59 s |

C1 obsahuje provider **500 unexpected EOF**, zachovaný opravný pokus a celou odpověď trvající **65,47 s**. Reload nad 1 s je vyřazen pouze z teplé latence, nikoli z výsledků kvality. Vzorky jsou malé; p95 neuvádím. Ve stejných devíti nezávislých teplých vstupech C1 zvýšilo medián proti B přibližně o **51 %**: užitečné vysvětlení bylo dražší než původní blokace. To je výslovný latencový kompromis, který pozdější neměřený budget zatím nevyřešil důkazem.

C6 má na pěti shodných zprávách medián **3,877 s** proti **3,847 s** v B (+0,8 %), ale kontext návazných zpráv se liší a B často zastavilo úkol. Nelze z toho vyvodit ekvivalenci latence dokončených úkolů ani plošnou 80% kvalitu. Schvalovací requesty C6 trvaly 33/23/15 ms; lidské čekání není zahrnuto. První užitečný obsah měřím na terminálu ne-streamovaného HTTP; dílčí zobrazení ve Studiu nebylo měřeno.

Přímé A použilo stejný artifact, vlastní stručný prompt, 16k kontext a předchozí B historii. Rozumělo sledovaným požadavkům; při souborových operacích pravdivě hlásilo absenci nástrojů. Není to důkaz vykonání ani bezpečnosti aplikace. Všechny inference byly sériové.

### Přesné ukázky

- `vysvetli mi jka funguje pamet pocitace, kratce`: první B „Proto není potřeba generovat plán pro změny souborů.“ C1 už vysvětlovalo paměť, ale vytvořilo dlouhou esej. **Stručnost zatím živě neopravena.**
- `Ulož text "Ahoj" do new-notes.md.`: první B ptalo na `[object Object]`; C5 schválení zastavilo. C6 skutečně vytvořilo soubor s přesnými **4 UTF-8 bajty Ahoj**, doloženo M2 výsledkem a čtením souboru.
- `Soubor notes.md nemaž, jen ho přečti.`: C5 nativní čtení dokončilo, ale odpověď zobrazila „Ověřený uložený obsah souboru nelze bezpečně zobrazit.“ C6 zobrazilo ověřený původní obsah.
- Lidská paměť: C3 poskytlo vhodnou stručnou odpověď; C5 napsalo „teoreticky nekonečnou kapacitu“, C6 „teoreticky neomezená“. **Obsahová nestabilita zůstává F.** Správně uložený soubor neopravuje faktickou chybu jeho obsahu.

## Offline gate a prostředí

Čisté `66e824d7`, Node **24.21.0**, kernel `bwrap --unshare-net`: [audit 21:22](../../.intentsmith-artifacts/test-runs/2026-09-28T21-22-54-182Z/report.json) **373 PASS / 12 FAIL / 13 BLOCKED / 0 TIMEOUT**, exit 1, **celkový gate FAIL**. Záznam porovnává přesné ID/path/status/blockers i signatury příčin s auditem 19:06: shoda, žádná nová ne-PASS položka. Jedenáct FAIL jsou chybějící IDE moduly, jeden Gate 0 registry pečeť; BLOCKED mají stejné toolchain prerequisites. Předchozí vlastní audit 21:15 **370/15/13** je zachovaný; jeho tři nové chyby byly opraveny, ne přeřazeny.

Pozitivní důkazy: M1 33/33, modulová hranice 13/13, artefakty 160/160; intent test používá serverově inicializovaný **DB ConversationStore** a skutečné nativní M2 čtení i dva zápisy po administrativní hlášce, s kontrolovaným modelem. Přímé negativní testy na hranici nástroje odmítají změnu cíle, obsahu a kódu; „Spusť ls“ neopravňuje `rm -rf ~`. Tato offline evidence neprokazuje živé jazykové porozumění.

CHAT artifact `qwen3.5:27b`, digest `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`, provider **0.34.0-intentsmith.1**, `num_ctx=4096`, `think=false`; klasifikace temperature 0,1/max 500, obsah temperature 0,7 s budgetem a skutečným clampem uvedeným ve wire. Role bindingy byly pouze čtené; jiný model se nezkoušel ani neaktivoval.

Izolovaný server má vlastní HOME/DB/historii/projekt a kernel namespace s jediným výslovným Unix relay k lokálnímu provideru. Používá skutečný M1 HTTP controller, finální persistence a M2 authority. Automaticky schvaluje jen předem očekávaný přesný souborový efekt/payload ve vlastním projektu; ostatní efekty neschvaluje. Externí/hardwarový vykonávací adaptér nebyl v těchto případech dostupný; skutečný externí ani hardwarový efekt neproběhl. Nový runner ukládá i stav všech testových souborů a kontroluje digest modelu. Ve své nové soukromé DB nastavuje typed writerem learningEnabled=false; starší živé konfigurace tuto policy nesnapshotovaly.

Závěrečná kontrola **21:30:19 UTC**: cizí lease PID **1613789**, compute PID **1754361** / 16 916 MiB, GPU **95 %**; vlastní primární provider měl prázdné ps. Následný `candidate-retest` skončil **GPU_EVALUATION_BUSY**, **0 inference**. Prázdná primární Ollama neznamenala volnou sdílenou GPU. Žádný cizí proces/model nebyl ukončen ani uvolněn. Zachované jsou i první příliš přísná kontrola vlastního rezidentního modelu a chyba dvojího lease v runneru.

## Zmrazená závěrečná sada a zbývající práce

[Corpus](../../tests/fixtures/chat-resilience-final.json): **20 rodin, 53 turnů, šest dialogů; 8/20 rodin nepoužitých pro ladění tohoto živého milníku**. Nové jsou plné scénáře existujícího souboru bez přepsání, vysvětlení verzí, adresátů, zápisu 80/8080 a mW/MW, složeného GPU případu, nesrozumitelného zadání a nedostupného kalendáře. Některé lexémy/číselné kontrasty měly starší strukturální regresní testy; zdejší celé zprávy a kontexty nebyly použity pro úpravu modelového promptu/routingu. Každý turn má kontextovou politiku, záměr, allowed/forbidden, otázku a variantu. JSON evidence obsahuje **úplnou závěrečnou matici všech 53 × 3 položek: LIVE_NOT_RUN**. Samostatně zachovává také tři nové ladicí případy, které se kvůli GPU nedostaly do živého retestu.

Předem zachované cíle: 0 kritických problémů, užitečnost ≥95 %, zbytečná zastavení ≤5 %, jazyková delta ≤5 bodů; medián nad +20 % vyžaduje výslovný kompromis. **Žádný cíl závěrečné sady není označen za splněný; tři celé opakované běhy nebyly provedeny.**

Otevřené problémy:

- GPU guard stále zastaví celý složený požadavek; samostatné jasné vysvětlení vedle nejasného efektu se nedokončí.
- „Nepřepisuj existující soubor“ bezpečně zastaví zápis, ale odpověď je obecné potvrzení zákazu. Chybí užitečná dosažitelná alternativa; současné fs.write nemá atomickou create-only podmínku.
- Historické souborové odkazy, nové prefixy, přesná návazná schválení a stručný budget čekají na živý retest; resolver pokrývá přesný poslední seznam/soubor a první tři pořadí, nikoli libovolné reference.
- Nestabilní faktická odpověď a heuristika souborových zmínek v project handleru musí být vyhodnoceny na celých odpovědích. Složené „nově vygeneruj a rovnou ulož“ není touto sadou doloženo.
- Starší neoznačený obsah se nepovažuje za bezpečně identifikovanou modelovou odpověď. Nový runner zatím nemá úspěšný vlastní live běh; historická live data pochází ze zachovaného předchůdce runneru.

### Reprodukce a návrat

Offline: Node 24, `bwrap --bind / / --dev-bind /dev /dev --unshare-net --die-with-parent --new-session node scripts/nightly-audit.js --profile=offline,database`.

Po skutečném uvolnění GPU nejprve provést ladicí retest, přečíst všechny odpovědi/trasy a vyřešit otevřené chyby. Pak zmrazit novou finální verzi; případ použitého holdoutu přesunout do ladicí sady. Pro každé ze tří úplných opakování, bez mezilehlých změn:

```bash
node scripts/measure-m1-l3.js --isolated-chat --live --phase final-1 \
  --corpus tests/fixtures/chat-resilience-final.json \
  --record .intentsmith-artifacts/chat-live-20260928/runs.json
```

Další fáze `final-2` a `final-3` použijí stejné bytes kódu/config/corpu. Runner sám nedává významový PASS; vyhodnotit všechny odpovědi, nástroje, varianty, opakování a latence. Teprve splnění cílů dovolí READY_FOR_REVIEW; nezávislá revize a nasazení jsou další oddělené kroky.

Návrat je výběr původního `fb54fbf5` v tomto vlastním izolovaném worktree, případně reverty vlastních commitů od něj. Produkci není co vracet. Žádné resetování cizího checkoutu, přepis dirty práce ani změna živého učení není součást návratu.
