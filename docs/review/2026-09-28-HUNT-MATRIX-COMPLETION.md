# Doplnění skutečné matice model × role

Aktualizováno 29. 9. 2026. **FIRST_REVIEW_COMPLETE_WITH_EXPLICIT_CAPTURE_FAILURES / REVIEW_PENDING / REAL_NO_GO.**
Explicitní zadání operátora: doplnit testy a hodnocení celého panelu, aby výběr rolí nestál pouze na dvou kotevních modelech. Tento dokument nahrazuje průběžný stav téhož doplnění; původní sběry a posudky zůstávají beze změny.

[Úplná matice, zadání → model → celá odpověď → známka](/mnt/vi7000/intentsmith/evidence/hunt-matrix-completion-20260928/matrix/comparison.html) · [Výsledkový dokument s procentní tabulkou](/mnt/vi7000/intentsmith/evidence/hunt-matrix-completion-20260928/matrix/REVIEW.md) · [28 prioritních případů k revizi](/mnt/vi7000/intentsmith/evidence/hunt-matrix-completion-20260928/matrix/PRIORITY-REVIEW.md).

## Co je skutečně dokončené

- Deset přesných modelových digestů × sedm rolí: **70 buněk**, z toho čtyři VISION `N/A`. **63 relevantních buněk má úplný první výsledek, tři jsou částečné.**
- Evidence obsahuje **1 984 pokusů**, z nich **1 980 úplných a posouzených**. Čtyři vyčerpaly kontext/výstupní limit; nemají vymyšlenou nulovou známku ani výhodnější náhradní starou odpověď.
- D/R + CHAT: **1 356 celých odpovědí, 4 235 známek po kritériích**, skutečný první externí LLM posudek s důvody. Nový CODE má dalších 30 odpovědí a dvě oddělené složky známky. Šest zachovaných CODE komponent a VISION hodnotí uvedené spustitelné kontroly.
- **213 zachovaných D/R odpovědí má i skutečný druhý posudek.** Nové první známky nejsou průměrované s Opusem ani vydávané za lidskou či nezávisle přijatou referenci. Nový balíček pro druhého hodnotitele obsahuje **1 173 odpovědí / 3 689 kritérií**; zbývajících 594 odpovědí tvoří čistě spustitelné CODE/VISION kontroly.
- Všech 102 dvojic role/úloha prošlo kontrolou stejného veřejného zadání, rubriky, inference a poskytovatele napříč modely. Každý model má v matici jediný přesný digest. Datum nového posudku není datum nové inference.

## Sběry a verze

| Část | Obsah výsledné matice | Podmínky a původ |
|---|---|---|
| CHAT | 400/400 nových vícekolových dialogů; 1 163 skutečných volání = 1 160 základních + 3 opravná | Poskytovatel `0.34.2-intentsmith.2`; stejný produkční systémový prompt pro každý krok a pevný referenční čas `2026-09-28T12:00:00Z`. Audit celé historie a 116 společných kroků PASS. Jeden dialog na úlohu, 20 CZ/EN dvojic, nikoli 40 nezávislých případů ani starý panel 1 200 dialogů. |
| D1/D2/R1/R2 | 960 pokusů, 956 úplných odpovědí; osm případů × tři pokusy/model/role | Vlastní výstup a rubrika každé role. Shodné zachované vstupy jsou znovu skutečně posouzené podle současné rubriky. Opravený model_cleanup má vlastní verzi. Poskytovatel `.1`. |
| Nový rozšířený D/R profil | 270 nových pokusů, 266 úplných | Devět slotů na všech deseti modelech: D1/pairwise; D2/lease+pairwise; R1/metrics+pairwise+cleanup; R2/history_late_guard+immutable+pairwise. Kontext 16 384, výstup 12 288, 900 s, teplota 0,1. Celý slot nahrazuje starý profil včetně čtyř neúplných pokusů. |
| CODE | 210 odpovědí, sedm úloh × tři pokusy/model | Šest původních vymezených oprav má doloženou shodu veřejných vstupů, artefaktu a spustitelného replay. Vadnou úlohu confidence nahrazuje 30 nových odpovědí v2: API na 24 pevných vstupech + skutečné čtení významu vysvětlení. Vývojový průměr těchto dvou složek není přijaté plné orákulum ani dokončení celého opravného workflow. |
| VISION | 414 odpovědí, šest relevantních modelů × 23 úloh × tři pokusy | Ověřený replay zachovaných přesných výstupů, poskytovatel `.1`. Při teplotě nula nejde o 414 nezávislých vzorků: 144 různých výstupů ve 138 dvojicích model/úloha. Čtyři artefakty bez deklarované obrazové podpory mají N/A. |

Rozšířený sběr běžel na čistém zdroji `c3d3e5ac2de6163d53071ccc04778804c97bbf36` a dokončil všech **100/100 úloh, 300 pokusů, 296 úplných odpovědí** (D/R 266 + CODE 30). `COLLECTION_PARTIAL` zachovává čtyři skutečná vyčerpání limitu. Původní blokace Phi4 na 24k byla ověřená nepodpora profilu: poskytovatel přidělil jen 16k, nikoli prokázaný nedostatek VRAM. Profil se proto změnil společně pro celý panel; runner odlišuje `MODEL_PROFILE_CONTEXT_MISMATCH`.

Částečné buňky: **Ornith R1 23/24, Ornith R2 22/24, Qwen3:14b R2 23/24**. V tabulce mají místo souhrnné známky stav a aritmetické možné meze. Tyto meze nejsou interval spolehlivosti. Dokončovací poměr je pozorovaný výsledek schopnosti pracovat v tomto rozpočtu, nikoli chybějící běh, který by se tajně doplnil jiným profilem.

## Jak vznikají známky a jak proběhne revize

D/R: průměr kritérií odpovědi → průměr tří opakování úlohy → stejná váha osmi úloh. CHAT: obsah 40 %, užitečnost 30 %, návaznost 20 %, komunikace 10 %, striktní JSON zvlášť. CODE a VISION mají svůj pojmenovaný druh kontroly; role se nesčítají do obecného pořadí modelů.

První posuzovatel je **Codex/GPT, autor části nástrojů, s přiznanou expozicí historickým výsledkům**. Znalost identity nebyla během nového čtení odvozována z klíče; klíče se otevřely až po zmrazení prvních posudků. To přesto není nezávislá slepá přejímka. U přesně totožných odpovědí je převzetí vlastní známky označené. U technických sporů jsou uchované skutečné CPU reprodukce (lease cleanup, pořadí filter/map, rozsah proměnné, metriky/backoff).

Prioritní revize obsahuje 28 konkrétních odpovědí: spory skutečných posudků, nízkou vlastní jistotu, nízké známky a šest předem seedovaně náhodných kontrol. Každý výběr má uvedený důvod a otevře stejnou úlohu se všemi modely. Nízká vlastní jistota není kalibrovaná pravděpodobnost; malý náhodný vzorek nenahrazuje druhého hodnotitele.

[Balíček druhého hodnotitele](/mnt/vi7000/intentsmith/evidence/hunt-matrix-completion-20260928/matrix/second-review/README.md) předává celé odpovědi se stejnými rubrikami a systémovým kontextem, bez prvních známek a s novými štítky zvlášť v každé roli. Klíč je v `restricted/` s oprávněním jen pro vlastníka. Jde o známé vývojové případy, ne nový holdout; hodnotitel musí přiznat expozici. Validátor přijímá přesně přemapovaný první posudek pro následné porovnání, **nevytváří tím druhý posudek**.

## Přesné artefakty a ověření

- CHAT packet v2 SHA `7a58b4ea71a328781c21a828caa033185f9badb6a04b9eba67709501dfc4927e`; první posudek SHA `cbe7cb2010e94ccdef9548417358b61cebf67bf914e94c55f4ca089234104f33`. Dřívější nesprávný export zůstal označený v `chat/assessment-codex/export-v1-rejected/CORRECTION`; není zdrojem matice.
- Rozšířený D/R packet SHA `fc417e81ff4ee206c471696e3993a51fc77c35c084ed9f8e3621800fe75c093d`; první posudek SHA `dc0ecda6a270e117dcf6811fe7198b283f8961298f5e87ce0f0da94b80b9a21b`, validátor 266/266 odpovědí a 625/625 kritérií.
- Nový CODE packet SHA `fb7012015128cf7db89b43943b51b9fdd9ed25203ccd0398a64bd497dc567e99`; posudek SHA `decae9224c9bcdd79bb9d3fbaac76e3d0c39e8fcb395ebfa351c499cf7c976ea`. Technický runner dál drží plné přijaté sémantické skóre jako null; pracovní kombinace je pouze v této revizní matici.
- Druhý-review packet SHA `08d0ab7e92dc324d2a8e9e210d7b32525167b8eb7db2810b7fed55f31e7d4726`, validace přemapování 1 173/1 173 odpovědí a 3 689/3 689 kritérií.
- [153 kontrol matice](/mnt/vi7000/intentsmith/evidence/hunt-matrix-completion-20260928/matrix/verification.json): pokrytí, agregace, hashe zdrojů i odpovědí a srovnatelnost profilů. [34 kontrol skutečného prohlížeče](/mnt/vi7000/intentsmith/evidence/hunt-matrix-completion-20260928/matrix/browser-checks.json): tabulka, celé texty, všechny modely/opakování, obrazový vstup, detail CODE i trvalé poznámky. HTML sdílí opakované řetězce; rekonstrukce se rovná původnímu JSON, žádné zkracování odpovědí.
- [Manifest revizních souborů](/mnt/vi7000/intentsmith/evidence/hunt-matrix-completion-20260928/review-manifest.json) a reprodukční skripty jsou vedle důkazů. Zdrojové databáze a jejich proměnlivé WAL/SHM soubory nejsou manifestem prohlašované za neměnné.

## Zbývá před přijetím doporučení rolí

1. Skutečný druhý posudek nových sémantických odpovědí, porovnání po kritériích a rozsouzení. Dvojice místních hodnotitelů zatím přijatá není.
2. Revize měřítka nového CODE vysvětlení a jednotlivých sporných známek. Není přípustné prohlásit vlastní průměr za nezávislé potvrzení.
3. Provozní ověření preferovaných kandidátů na čerstvých případech a sestava bez vlastní revize; samotná tato vývojová matice provozní převahu neprokazuje.

Žádné vazby, modely, časovač ani produkční přijímací evidence se tímto doplněním nezměnily. Výstup už umožňuje porovnávat celý relevantní panel místo dvou kotev, ale není hotovým autonomním GO.

## Závěrečná kontrola repozitáře

`npm test` na `c3d3e5ac` provedl 377 programů: **365 PASS, 2 FAIL, 10 BLOCKED**. Jedna regrese této práce byla nezapsaná přesná vazba evaluačních hodin na společný formát hodin; po kontrole čistého zdroje ji oficiální writer zapsal bez růstu cyklů (1 431 hran, 3 cykly / 28 členů). Následné `module-boundary-ratchet` **13/13** a `artifact-validation` **160/160** prošly. `npm run test:registry` potvrzuje **542** registrovaných programů.

Původní plný audit není přepsán na PASS. Druhý FAIL je `nightly-orchestrator-self-test`: otisk registru nesouhlasí s release pečetí Gate 0. Deset BLOCKED má deklarované toolchain prerequisites (OCR/PDF, systemd-analyze, git/bwrap/prlimit). Jde o přesně uvedená omezení tohoto auditního profilu; tato práce nemění release pečeť ani nepředstírá provedení blokovaných sad. [Původní report a následné kontroly](/mnt/vi7000/intentsmith/evidence/hunt-matrix-completion-20260928/verification/summary.json).
