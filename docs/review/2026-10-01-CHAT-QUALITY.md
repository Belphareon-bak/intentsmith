# Chat quality — 2026-10-01

Stav po milníku S1: **CHANGES_REQUIRED / WORK_CONTINUES / REVIEW_PENDING**. Toto je vlastní technické a významové posouzení; nezávislá přejímka ani produkční nasazení neproběhly.

## Posudek proti skutečnému baseline

Posudek je správný ve směru: model musí dostat návaznost a aplikace musí držet skutečné zdroje a schválení. Historický popis handleru ale nelze převzít jako aktuální stav. Vstupem byl operátorem uvedený `45caf5b54b78def257221ac2ab33a64031800813`, nikoliv starší `1e7c5b4`. Opakované ukládání mělo již na vstupu skutečný M1 HTTP PASS. První ASK_USER se ještě přepisoval na generování, klasifikace neměla historii a běžná odpověď nedostávala připravenou LTM — tyto tři reprodukce před opravou selhaly.

| Návrh | Verdikt a provedení |
| --- | --- |
| Relevantní historie, otevřená otázka a cíl při interpretaci | Přijat. Společný rozpočtovaný paket, původní ID zpráv, explicitně označené vynechání. Historie není oprávnění k opakování efektu. |
| Přirozené formulace ukládání | Přijat jako produktové chování. Regexový handler byl v baseline již nahrazen typed plánem; nebylo správné stavět další slovník příkazů. Doplněno pokračování, správné informace o podporovaných zápisech a přesná kontrola původu. |
| Shrnutí / nový text a následný zápis | Přijat v konkrétním rozsahu. Text se vytvoří, dokončí a uloží jako zdroj v DB; teprve pak vznikne návrh M2 pro přesné schválení. Libovolný víceakční plánovač tím není implementovaný. |
| Konkrétní doptání i v první zprávě | Přijat. Odstraněn první-turn override i výběr interních kategorií. Původní požadavek, zdroj a omezení přežijí restart. |
| Kompakce podle skutečného rozpočtu | Přijat. Počet deseti zpráv není spouštěč; běžná historie má omezený načítací strop 50. Úplný durable souhrn chráníme před vytlačením. Původní uživatelské podklady lze dohledat proti ztrátovému souhrnu. |
| Jednotné předání preferencí a projektových faktů | Přijat pro existující paměťové politiky. Běžná, expertízní a specializovaná odpověď mají společný blok podkladů s původem; existující platnost se uvádí pouze pokud je skutečně známá. |
| Měření rychlosti a streamování | Měření přijato a provedeno. Streamování v této dávce nezavádím: měnilo by sdílenou M1/providerovou cestu, včetně zrušení a rozdílu mezi pracovními tokeny a ověřenou finální odpovědí. Je to samostatné rozšíření kontraktu, které tyto důkazy nepotvrzují. |

## Důležité doplnění mimo posudek

- Zápis původní odpovědi či doslovného textu používá ověřenou identitu z DB a plné bajty, nikdy modelový preview. Otázky, schvalovací doklady a cizí/neověřené zdroje se nesmějí tiše stát ukládaným obsahem.
- Shrnutí a nový obsah se ověřují po modelových await; změna projektu, zdroje, nedokončená generace nebo zrušení zastaví přípravu efektu. Negace ani podmínka se neztrácí při odpovědi na otázku.
- M2 normalizuje text do NFC. Pokud by tato cesta změnila požadované původní bajty nebo název, odmítne zápis před ToolRequest; neprohlašuje takový zápis za přesný. Náhled drží nové řádky a používá inertní blok s bezpečným oddělovačem.
- Samotný souhrn není původní evidence. Zprávy mají svůj projekt a ID; pozdější oprava má přednost. Návrat k tématu není automatické zrušení pozdějšího rozhodnutí. Cizí projekt a tvrzení asistenta se do dohledaných původních uživatelských podkladů nepůjčují.
- Explicitní stručnost má přednost před minimem znaků. Pět slov může být úplná tvůrčí odpověď. Přesný požadovaný počet slov se ověřuje; oprava používá typed pole jednotlivých slov, ale počet slov, délka ani klíčová slova nejsou hodnocením užitečnosti.
- Neodpovězený nebo chybou ukončený poslední požadavek nemůže při následném ukládání tiše vybrat starší odpověď. Bariéra je trvalá a přežije upřesnění i restart.
- Upřesnění souboru zachovává původní operaci: delete se nesmí změnit na read. Po konkrétním určení souboru se nedostupné mazání pravdivě odmítne bez další potvrzovací otázky.
- Nová žádost ruší starou ukládací otázku v obou skutečných cestách, conversation i project; původní create-only se nepřenese na nový výslovný doslovný zápis.
- Vymyšlený cíl se nikdy nepředá M2; pokud je známý zdroj a chybí cílový název, zachová se cílená původní otázka a source ID pro pokračování po restartu.
- Příklad kódu v aktivním projektu zůstává odpovědí v chatu; oprava má zachovat názvy, signatury, návratové typy i původní chybové chování, pokud uživatel jejich změnu nepožaduje; aktivní projekt sám nedovoluje návrh změn. Oprava a nový úkol se interpretují znovu, nereplayují starý nástroj. Starý specialistův nástrojový kontext se při jiném úkolu invaliduje.

## Předání skutečného rozhovoru modelu

Generování nyní předává již rozpočtovanou historii v nativních rolích USER / ASSISTANT, nikoli jako přepsaný rozhovor uvnitř jednoho USER promptu. Aktuální zpráva je úplná a právě jednou. Historická UI označení SYSTEM nikdy nejsou providerové systémové instrukce; souhrn je citovaný podklad v USER zprávě. Dokončovací opakování znovu sestaví stejný kontext a zachová zdroje. Doloženo na skutečných zachycených providerových zprávách a negativní kontrolou starého asistentského textu obsahujícího „SYSTEM“. Sdílený gateway nebyl upraven.

Samotné doplňování systémového promptu nezaručilo věcnou kvalitu. Delší pokus navíc způsobil tři původní kapacitní testy; byl zkrácen, tlakové fixtures a jejich asertace zůstaly. Zlepšení po nativních rolích je vývojová evidence, nikoli izolovaný kauzální experiment ani nezávislá přejímka.

## Studio a obnova

Skutečná sestavená Studio aplikace prošla třemi řízenými UI zkouškami: odeslání, zastavení rozpracované odpovědi, přepínání relací/projektů a obnova po restartu. Samostatný průchod jejího skutečného DOM ověřil Markdown a blok kódu a neprovedení vloženého HTML/scriptu. Backend a odpovědi zde byly řízené. Neprohlašuji tím průchod celé UI aplikace se živým modelem, skutečné streamování ani zátěžovou přejímku souběžných uživatelů.

## Alternativy

Zvažované možnosti: (1) nový centrální víceakční interpreter — největší zásah do existujících autorit a vyšší riziko; (2) nejprve čistě textový chat — užší změna, ale odkládá požadované ukládání; (3) postupné sjednocení existující cesty s časným měřením textu i efektů — zvolená varianta. Změna modelu je oddělená: aplikační selhání nemá zakrýt výměna modelu bez stejného kontextu a přesné artefaktové evidence.

## Rozsah a hranice důkazu

Nové dlouhodobé učení není tímto zapnuté. Živá zkouška používala soukromou DB s context ON a learning OFF, běžný český/anglický chat a skutečnou M2 souborovou cestu. Expertní odpovědi a všechny další jazyky nejsou plně živě přejaty. Historický provoz a bindingy se nezměnily.

Přesný globální počet slov má deterministicky ověřené číslice 1–1000 a vybrané slovní tvary 1–10 v češtině, slovenštině, angličtině a němčině. Není to záruka všech číslovek, všech jazyků ani libovolně dlouhého výstupu; 4K modelový rozpočet stále platí. Věty, položky, citované číslo a zrušený počet nesmějí být zaměněny za aktivní globální počet slov. Tato formátová kontrola neposuzuje věcnost textu.

Rozpočet vychází z efektivní kapacity modelu a konzervativních odhadů bajtů/tokenů, nikoli z jeho přesného tokenizeru. Kompakci vyvolává tlak na kapacitu i pojistka při dosažení stropu načítání 50 zpráv, aby nezmizela neshrnutá zpráva. Tím se odstraňuje předčasný desetizprávový spouštěč, ale nejde o neomezenou historii ani univerzální záruku přesného počtu tokenů.

V kandidátu S1 bylo dohledání archivovaných podkladů omezené: prvních 1000 archivovaných uživatelských zpráv, nejvýše tři relevantní zdroje, společně 1200 UTF-8 bajtů. Dlouhá zpráva dává pouze přesný začátek do 512 bajtů, explicitně označený `contentTruncated`; původní úplná zpráva zůstává v DB. Relevance vybírá podklady, neinterpretuje efekty ani neopravuje hodnoty. Budoucí rozšíření má přidat dohledání dalších oken/identit bez vydávání zkráceného výňatku za celý důkaz.

Změny jsou na samostatné větvi. Cizí checkouty, dirty práce, procesy, GPU rezidence, providerové bindingy a produkční release nejsou převzaté. Jediný přesný importní baseline přidal 14 konkrétních source hran; cykly zůstaly 3 / 28. Nejde o plošné schválení libovolných importů.

## Technické testy

| Důkaz | Přesný zdroj | Výsledek |
| --- | --- | --- |
| Vstupní offline + DB profil | `45caf5b5` | 397 PASS / 5 FAIL / 3 BLOCKED |
| Celý offline + DB profil s nativními rolemi | `495a069f`, `chat-quality-full-20261001-native` | 399 PASS / 4 FAIL / 3 BLOCKED z 406 |
| Kontext, CRE, M1, zápisy, runner a importní hranice | `14f09b69`, `chat-quality-focused-20261001-native-final` | 7 PASS, M1 včetně 74 vlastních kontrol |
| Devět HTTP sad | `09d9fa01`, `chat-quality-journeys-20261001-native-current` | 9 PASS |
| Studio | `77cdd7b6`, `chat-quality-studio-20261001-rubric` | 3 PASS skutečné aplikace s řízeným backendem |
| Markdown a nedůvěryhodné HTML ve skutečném DOM | `21f3d22c`, `chat-quality-focused-20261001-renderer` | Renderer PASS; jeho tehdejší celá sada měla 5 PASS / 2 FAIL, následně opravené fixture kontrakty |

Po posledním úplném profilu se runtime nezměnil: `09d9fa01` opravuje pouze rozpoznání přesného nativního USER vstupu v helperu testu přesnosti hodnot, další commit aktualizuje dokument. Původní pozitivní i negativní kontroly čísel, znamének, typů, duplicitních klíčů a starých hodnot nebyly odstraněny. První nový HTTP průchod měl 8 PASS / 1 FAIL právě kvůli tomuto starému prefixu; opakování celé devítky prošlo. První chybně zadaný výběr sad runner odmítl před testy (exit 2, 0 testů); zachovaný log není produktový výsledek.

Čtyři trvající FAIL: `artifact-validation` (historické dokumentační/migrační štítky), `m1-model-failover-schema` (původní počty schématu 120/107 versus 121/108), `m6-runtime-evidence` (historický snapshot) a `routing-accuracy` (skutečné legacy účetní směrování: dotaz na DPH v Německu skončí jako výpočet). Poslední chyba se chatu týká a nesmí se schovat jako nesouvisející dokumentace. Tři BLOCKED: `accountant-workflow-integration`, `chat-export-budget`, `export-pdf-docx`; chybí autorizovaná PDF runtime. Bez změny oprávnění ani obcházení autorit se zde nepřeznačují na úspěch. Celý technický profil **není zelený**.

Vývojová selhání včetně přetížení 4K kontextu, nepřesných hodnot, chybného CODE příkladu, náhradního read místo delete a přerušených živých sérií zůstávají v privátní evidenci a průběžném dokumentu. Pozdější kontrola dokazuje opravu svého konkrétního zdroje; zpětně nemění starý FAIL na PASS.

## Vývojové živé dialogy

Stejný přesný `qwen3.5:27b`, digest `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`, provider `0.34.0-intentsmith.1`, Node 24.21.0 a soukromá projektová DB. Žádná změna produkčních bindingů. Cizí GPU rezidence se neuvolňuje; každý běh má serializovaný lease a kontrolu přesného artefaktu.

- Po nativních rolích tři celé vývojové dialogy, `ca0a7603` / `9c443452-aaf9-474c-90a6-9878c06dd581`: B **9/12**, A **8/12** užitečných, 0 zbytečných zastavení a 0 kritických chyb. Doporučení podle ceny a vlastností a práce s citovanými podklady prošly; seminářové odpovědi stále domýšlely relativní kalendář nebo měnily den registrace. Cíl ≥95 % nebyl dosažen.
- Přirozené uložení a souhrn, `e1638ac2` / `89a7b5ab-17c0-49a7-a37a-6754ce15a841`: **3/5** významově užitečných. Všechny tři zápisy byly bez efektu a beze změny souborů před schválením a měly přesné následné bajty; opakovaný zápis správně používal původní odpověď místo dokladu. Pětislovný popis byl neobratně nedokončený a „souhrn“ citoval celou odpověď s úvodem. Správné souborové efekty tyto obsahové nedostatky nenapravují.
- Nový obsah a uložení, `e1638ac2` / `7567fa86-d0ea-461c-93bf-7d1437c9274e`: **1/1**, tři užitečné odrážky o péči o rostlinu, dokončený durable zdroj před M2, create-only a přesné schválené bajty.
- Dlouhý rozhovor, `e1638ac2` / `e7eb8877-3191-4ae2-8af2-e15d31862009`: **27/27** podle vlastního hodnocení, osm skutečných kompakcí a restart na jiný PID se stejnou konverzací. Po restartu správně Javor, LIPA_781 a ruční kontrola bez změn; žádné efekty ani souborové změny. Z toho 24 odpovědí jsou jednoduchá potvrzení podkladů; hlavním důkazem jsou dvě správné závěrečné vzpomínky, nikoli nafouknutí globální užitečnosti těmito potvrzeními. Předchozí start `3757c726…` byl BLOCKED_GPU, 0 případů / 0 inferencí; zůstal zachovaný.

A je diagnostický protiargument proti stejnému modelu s příchozí historií B a jednodušším systémovým promptem. Není to samostatně vedený dialog A, ani čisté měření aplikační režie. Časy navíc zahrnují synchronní diagnostický relay a journal; jejich samostatná režie nebyla změřena. B volá klasifikátor i generování, A dostává jednodušší prompt. Jde o diagnostiku rozdílu cest, nikoli o čistý kauzální odhad režie nebo produkční zátěžový benchmark. U akcí A nemá nástroje, proto s ním neporovnávám úspěšnost skutečného provedení.

## Tři nezměněné série S1 — vlastní významové hodnocení

Výsledek **CHANGES_REQUIRED / WORK_CONTINUES**. Všechny tři série původních 53 případů se dokončily na čistém `3b3b399f1bd1903a27a2c05ee4ed4701774b88dd`, se shodným manifestem, efektivní konfigurací a přesným digestem modelu uvedeným výše. Odpovědi byly přečteny až po dokončení všech tří; mezi sériemi se neladilo. Transportních 405 platných inferencí není 405 užitečných odpovědí.

| Série / run ID | Užitečnost B | Zbytečné zastavení | Kritická chyba | Průměr rodin | Dosud nepoužité F14–F20 |
| --- | --- | --- | --- | --- | --- |
| final-1 / `1e1b2ae2-4f59-4d7b-9967-8759d68f701c` | 42/53 = 79,25 % | 6/53 = 11,32 % | 0 | 73,17 % | 5/12 |
| final-2 / `0712bd56-9d2c-4921-a584-4f745ee0ad12` | 41/53 = 77,36 % | 4/53 = 7,55 % | 0 | 69,83 % | 5/12 |
| final-3 / `6fde29e0-9285-48ac-ac0a-249b2a8d8c55` | 43/53 = 81,13 % | 5/53 = 9,43 % | 0 | 73,17 % | 5/12 |

Souhrnně 126/159 = 79,25 % užitečných a 15/159 = 9,43 % zbytečných zastavení. Žádná série nesplnila ≥95 % / ≤5 %. Nula kritických chyb platí pro tyto tři série; nemaže starší doloženou chybu náhradního čtení. Nejhorší rodina má 0 % užitečnosti. Jde o vlastní hodnocení s konkrétními důvody ke každé odpovědi, nikoli nezávislý verdikt.

**Efekty:** před schválením všech 159 kroků nulové nové EffectResults a nezměněné soubory. Každá série má 13 schválených zápisů a čtyři čtení: všech 39 zápisů má přesné očekávané bajty, všech 12 čtení vrací skutečný obsah a nemění soubory. Kontroly zahrnují původní odpověď místo dokladu, druhou položku seznamu, port 80/8080 a rozlišení mW/MW. Návrhy create-only pro existující soubor nebyly v S1 schváleny; zde je doložen návrh a nulová změna, skutečné odmítnutí provedení dokládají samostatné HTTP testy. Původní privátní pomocná kontrola používala pro read nulové pole expected; po opravě na skutečný obsah fixture a kontrolu M1 odpovědi všech 12 čtení prošlo. Chyba checkeru není chyba efektu.

**Kód:** všech 12 skutečných B bloků ze dvou navazujících faktorálových úloh zachovávalo `factorial(n)`, správné 0/1/5/10 a ValueError pro záporný vstup. Celkem 24 přesných bloků B/A bylo přečteno a ověřeno izolovaně bez sítě a hostitelských pracovních souborů, s limity CPU/RAM. Původní kód ani ukázky se neopravovaly pro test. Jedna A návaznost změnila chybové chování na None; pozitivní čísla sama by tuto chybu neodhalila. Samostatná kalibrace detekuje chybný výsledek i NameError. Komentovanou ukázku nevydávám za vykonaný příklad.

**Aplikační závady k opravě:** model při odpovědi „Myslím notes.md.“ na původní mazání vrací správné `requestedOperation=delete`, konkrétní `fileTarget` a `continuesPending=true`, ale neplatný enum `FILE_DELETE`. `_llmClassifyIntent` zahodí celý výsledek; fallback položí obecnou otázku, místo pravdivého odmítnutí nepodporované operace. Dále e-mail/kalendář vyvolávají otázky na vlastní dostupnost nástroje, kterou má znát aplikace. Složená žádost RAM + GPU opomíjí nezávisle proveditelnou textovou odpověď. Nesrozumitelný vstup ve dvou sériích získal nepodložený projektový referent. Oprava nesmí normalizací neznámého záměru povolit kladný efekt ani zrušit potřebná konkrétní doptání.

**Věcná omezení modelu:** v některých odpovědích se mění negace režimu letadlo, RAM či paměť dostává nepodložené záruky a porovnávání verzí přidává neověřenou architekturu/kompatibilitu. Ověření primárními zdroji odmítá univerzální SHA-1 u Gitu (podporuje také SHA-256), rok 2024 u Pythonu 3.12.0 (vydán 2. 10. 2023) a tvrzení, že Qwen3.5 neexistuje. Tyto příklady jsou doložené [git-init](https://git-scm.com/docs/git-init), [Python 3.12.0](https://www.python.org/downloads/release/python-3120/) a [oficiální repozitář Qwen](https://github.com/QwenLM/Qwen3.8). Samotná změna směrování tyto faktické chyby neopraví.

**Latence:** po vynechání prvního studeného kroku jsou mediány B 17,985 / 20,104 / 21,946 s; p95 34,447 / 27,997 / 29,781 s. Studené první odpovědi 31,676 / 37,709 / 38,686 s zahrnují načtení modelu 11,338 / 11,366 / 10,493 s. Před čtením výsledků byl vybrán společný vzorek 20 čistě textových případů: užitečnost B 15/20, 14/20, 17/20; A 16/20, 16/20, 15/20. Mediány B/A 19,532/8,528, 20,328/7,752, 23,028/8,398 s; relativní rozdíly 129,0 / 162,2 / 174,2 %. Jednodušší A prompt, historie B, pevný český systém A a synchronní diagnostický journal brání tvrzení o čisté produkční režii. Včasnost přesto není doložená jako splněná.

V každé sérii pouze tři anglické případy; výsledky B 1/3, 2/3, 2/3 nestačí pro jazykovou paritu ani interval 5 procentních bodů. F14–F20 byly nedotčené před S1, nyní jsou odhalené a poslouží jako regrese. Po opravách je potřeba nový předem deklarovaný nepoužitý vzorek formulací.

Kontrolovatelná evidence: [odpovědi, důvody, identity a měření S1](evidence/chat-quality-20261001/semantic-assessment-s1.json), [technické běhy včetně FAIL/BLOCKED](evidence/chat-quality-20261001/technical-evidence.json), [přesné efekty](evidence/chat-quality-20261001/final-effect-check.json), [izolované kontroly kódu](evidence/chat-quality-20261001/final-code-check.json), [kalibrace](evidence/chat-quality-20261001/code-validator-calibration.json), [předem vybraný textový vzorek](evidence/chat-quality-20261001/final-comparison-scope.json). Jde o syntetické testové rozhovory; privátní DB, authorization capability a surové wire logy se nepublikují.


## Vývojový milník S2 po neúspěšné sérii S1

- `09ec41ec` zachovává z neznámého intent enumu pouze konkrétní typed delete
  pro odmítnutí. Neznámé kladné akce, neověřený cíl, neplatný tvar/confidence
  a zkrácená odpověď zůstávají odmítnuté. Reprodukce používá skutečnou
  providerovou hranici a HTTP pokračování po restartu; delete se nemění na read.
- Klasifikátor zná chybějící adaptéry pro zprávy, osobní kalendář a hardware;
  vlastní dostupnost nepožaduje po uživateli. Jazyk konkrétní otázky a neutrální
  chybějící referent jsou součástí interpretace. Dostupné souborové akce si
  zachovávají vlastní schvalovací cestu.
- Nejnovější `chat-quality-focused-20261001-capabilities-literal` na `c868fea3`
  má 7 PASS, M1 74/74; původní kapacitní limity a fixtures zůstaly.
  První `09ec41ec` průchod měl 5 PASS / 2 FAIL kvůli delší instrukci a její
  textové asertaci; zkrácení v `db8e9553` vrátilo celou sedmici na PASS.
- Předem deklarovaných 13 nových vývojových kroků: `3d4f57b2` / run
  `6a96cd3a-012d-4827-8c8d-d2937402d44f`: B-only, 8/13 užitečných.
  `c868fea3` / run `888d5b79-b85e-4fec-8f0b-448a45a484d0`: všech 13 B/A
  dokončeno, vlastní hodnocení B 9/13. Oba mají 0 zbytečných zastavení,
  0 kritických chyb a přesný schválený zápis `sum=37ms` do `metrics.md`;
  všech 26 kroků před schválením bez efektu a změny souborů.
- Opravená návaznost mazání, cílené chybějící referenty a kalendářový návrh
  prošly. Přesný e-mailový draft a formát samostatné části složeného zadání
  stále selhávají; další konceptuální odpověď chybně zaručuje neobnovitelnost
  smazání. Živý výkon tedy stále nesplňuje kvalitativní cíl.
- Diagnostická chyba byla opravena: kontrola první SYSTEM zprávy (hodiny)
  nesprávně naznačila ztrátu metadat. Druhá SYSTEM zpráva skutečně obsahuje
  nové instrukce. Nebyla provedena oprava neexistující ztráty; selhání je
  nedodržení předaného pravidla modelem. Obě série a důvody zůstávají v
  [evidenci vývojového milníku](evidence/chat-quality-20261001/capabilities-development.json).

Další práce: celý technický profil aktuálního runtime a izolované srovnání
již instalovaných přesných artefaktů na stejných dialozích. Produkční modelové
bindingy se nemění. Po volbě kandidáta následují tři nezměněné regresní série
původních 53 případů; odhalené F14–F20 nejsou nový nepoužitý holdout.

## Milník S3 — archiv po tisící zprávě (2. 10. 2026)

| Změna uživatelského chování | Stručný důkaz | Zbývající problém | Jeden následující krok |
| --- | --- | --- | --- |
| Dohledání prochází celý archiv po stránkách místo odříznutí po prvních 1 000 uživatelských zprávách. Novější relevantní oprava má místo před staršími záznamy s vyšším počtem shodných slov; při omezeném providerovém rozpočtu se vkládá před nimi. Původní identita a nezměněná omezení zůstávají dohledatelná. | Reprodukce `08eb27f1`: dvě nové kontroly FAIL v paměti i SQLite. `856e07c3`: stejná sada 17/17 PASS včetně více než 1 000 zpráv, pozdější kratší opravy, cizího projektu, asistentského výmyslu a těsného 330B rozpočtu. Celkem sedm cílených sad PASS, M1 74/74. | Živá odpověď nad takto dlouhým archivem ještě není ověřená. Výběr je stále lexikální: nejnovější shodný podklad, původní nejsilnější podklad a další relevantní zdroj; nejvýše tři výňatky / 1 200 B, dlouhé zprávy mají označený přesný začátek do 512 B. Není to záruka zachycení každé významové opravy bez společných slov nebo za koncem výňatku. | Ověřit celý M1/providerový průchod s privátním archivem nad 1 000 zprávami a ztrátovým starším souhrnem. |

Poslední úplný profil `chat-quality-full-20261001-capabilities` na `3e862ecf`
se při přerušení nedokončil: checkpoint 108/406, závěrečný report chybí,
proces neběží. Stav **INCOMPLETE**, nikoli PASS ani celý FAIL profil.
Neúplná evidence zůstává zachovaná.

Aktuální priority operátora: (1) archiv a pozdější opravy; (2) konkrétní
faktické chyby proti skutečným providerovým vstupům a stejnému artefaktu;
(3) zmrazená přejímka s významem a rozkladem latence; (4) CI s integračním
vlastníkem. Další porovnávání odlišných modelů je odložené. Nová série 53×3
nebyla spuštěna; hotová S1 zůstává na `3b3b399f` s výsledkem **NO_GO**.

## Milník S3-LIVE — pozdější oprava ve skutečné odpovědi

| Změna uživatelského chování | Stručný důkaz | Zbývající problém | Jeden následující krok |
| --- | --- | --- | --- |
| Návrat k rozhodnutí po dlouhém archivu zachová pozdější Javor a původní JILM_407 / ruční kontrolu bez změn; starý souhrn s Lípou opravu nezruší. | `97395516` / `088fcb1f-9896-41d4-afc4-dcdbaf204f4b`: 2/2 užitečných, 0 zastavení, 0 kritických chyb a 0 efektů; čtyři inference přesného digestu Qwen3.5. Skutečný klasifikační paket obsahuje původní ID 1 a opravu ID 1015. Jde o 1 015 syntetických uložených USER zpráv, nikoli 1 015 živých modelových turnů. | Lexikální relevance, tři výňatky a označený 512B prefix zůstávají omezením; ostatní faktické chyby a nová kompletní přejímka tím nejsou vyřešené. | Pro konkrétní faktické chyby porovnat surovou odpověď a celý skutečný providerový vstup se stejným artefaktem modelu. |

[Kontrolovatelná evidence včetně skutečných providerových rolí a podkladů](evidence/chat-quality-20261001/archive-boundary-live.json).

## Publikace a další postup

Větev `work/chat-quality-20261001` vychází z přesně připnutého `45caf5b5`, srovnávací vzdálená větev `review/chat-quality-base-20261001` ukazuje na stejný commit. Pushe jsou ověřené vzdáleným SHA; nejsou nasazením ani přejímkou. Draft PR nevzniklo: GitHub integrace odmítla operaci 403 `Resource not accessible by integration`. Stav **PR_NOT_CREATED / CI_NOT_RUN / REVIEW_PENDING** se nemění bez nového důkazu. Jiné workerovy checkouty a produkční proces zůstaly nedotčené.

Další milník: opravit doložené chyby interpretace nepodporovaných operací a doptávání, ověřit původní negativní kontroly a živé dialogy na nových formulacích. Změny budou pokračovat na stejné kandidátní větvi; S1 zůstane historický neúspěšný výsledek svého přesného zdroje. Průběžný dokument se aktualizuje po každém milníku nebo nejpozději po třech hodinách aktivní práce.

## S4 — dohledání faktických chyb v reálném providerovém vstupu

Na osmi konkrétních chybách všech tří S1 sérií je surový providerový text
shodný s emitovanou odpovědí M1. Aktuální požadavek je ve vstupu právě jednou,
příchozí historie včetně opravy na lidskou paměť je úplná. Obě skutečné
SYSTEM zprávy obsahují hodiny a vlastní instrukce s nejistotou, zachováním
uživatelských faktů a zákazem domýšlení. Chyba předávání kontextu ani pozdější
přepsání textu tu doložené není; první chybná tvrzení jsou v generovaném textu.

Na `38ca74c3` run `c1647717-6a1b-431b-b863-89d3011bfb86` zopakoval třikrát
vybraný **přesný** zachycený vstup, každý dvakrát. Stejný Qwen3.5 digest a
provider; historické hodiny, role, teplota 0,7, formát a tokenový rozpočet
zůstaly zachované. Všech šest terminálních odpovědí má potvrzený digest.
Rok 2024, původní obrácená negace letadlového režimu a vymyšlené „hlubší
vrstvy“ se v těchto opakováních nevrátily. Zůstávají ale obecné nepodložené
závěry o architektuře z modelového názvu a přehnaná analogie permanentního
uložení lidské paměti. Neoznačuji tyto diagnostické výstupy souhrnným PASS.

[Evidence obsahuje celé providerové vstupy, původní B/A i všechna opakování](evidence/chat-quality-20261001/factual-provider-trace.json).
Původní A má jiný systémový prompt a u dvou vybraných případů i vyšší limit
odpovědi: není totožnou kontrolou instrukcí. Dva náhodné vzorky neprokazují
příčinu na straně promptu nebo modelu. Rozhodnutí: neopravovat bez důkazu
předávání kontextu, nezavádět další pravidlo podle slov této fixture; řešit
věcnou spolehlivost podklady a řízeným vyhodnocením promptu/modelu. Bindingy
a sdílený gateway zůstaly beze změny. S1 NO_GO se nepřepisuje.

Diagnostická rada pro Wi-Fi má chybnou výchozí polaritu vůči
[postupu Microsoftu](https://support.microsoft.com/en-us/windows/experience/connectivity-networking/fix-wi-fi-connection-issues-in-windows).
To neznamená, že Wi-Fi nikdy nemůže fungovat se zapnutým režimem letadla;
[Microsoft popisuje i zapamatování Wi-Fi v tomto režimu](https://support.microsoft.com/en-us/windows/experience/connectivity-networking/essential-network-settings-and-tasks-in-windows).
Lokalizaci paměti do „hlubších vrstev“ nepodporuje
[výzkumný přehled distribuované paměti](https://pubmed.ncbi.nlm.nih.gov/9753601/).
K zapomínání při vybavování existuje také
[primární výzkum interference](https://pubmed.ncbi.nlm.nih.gov/18564040/),
proto lidskou dlouhodobou paměť nelze slibovat jako neomylné celoživotní úložiště.

Tři předchozí starty byly BLOCKED_GPU s nulou inferencí. Vlastní residency
po dokončeném běhu prokazatelně uvolněna. První start nového celého technického
profilu odmítl dirty strom po vytvoření evidence (exit 2, 0 testů); po commitu
následuje nový běh. CI má konkrétní [návrh předání](2026-10-02-CHAT-CI-HANDOFF.md),
vlastník zatím neznámý a žádná změna workflow nebyla provedena.

## S5 — celý profil po opravě archivu a rozklad latence

`289afec0` / `chat-quality-full-20261002-archive-clean` skončil
**399 PASS / 4 FAIL / 3 BLOCKED z 406**, exit 1. Non-PASS ID jsou shodné
s úplným profilem `495a069f`: archivní oprava nepřidala další selhání. Není to
zelená brána. [Evidence](evidence/chat-quality-20261001/full-profile-archive.json)
obsahuje identitu zdroje, čas, hash plného reportu a přesná neúspěšná ID.
Starší přerušený checkpoint 108/406 a odmítnutý dirty start se tím nepřeznačují.

[Rozklad latence S1](evidence/chat-quality-20261001/s1-latency-decomposition.json)
obsahuje všech 60 předem vybraných textových případů a odděluje rozhodnutí,
sestavení promptu, generování/kontroly a ostatní čas. Sčítají se průměry stejné
množiny, nikoli samostatné mediány:

| S1 série, 20 textových případů | Celá chat cesta, průměr | Rozhodnutí | Generování/kontroly | Provider, celkový čas inferencí |
| --- | --- | --- | --- | --- |
| final-1 | 22,323 s | 9,763 s | 12,555 s | 6,760 s |
| final-2 | 21,581 s | 9,937 s | 11,640 s | 6,100 s |
| final-3 | 23,129 s | 10,404 s | 12,722 s | 6,454 s |

Providerový čas je podmnožinou, nepřičítá se znovu. Celá cesta i obě hlavní
části obsahují měřicí režii; rozdíl není čistá aplikační režie. V aktuálním
runneru `save()` při každém zachyceném providerovém požadavku synchronně volá
`canonical()` a přepisuje celý master všech minulých běhů.

[Samostatná offline fixture](evidence/chat-quality-20261001/latency-capture-fixtures.json)
s pevnou odpovědí a privátní kopií 43 historických běhů / 88 417 475 B
reprodukuje 3,186–3,383 s požadavku bez inference; samotný přepis má
3,109–3,317 s. Bez historického přepisu má relay jen 5,6–37,8 ms. Původní
S1 data jsou nedotčená. Neodečítáme dnešní fixture od minulých časů, které
měly jiný objem historie a provozní podmínky.

Nová zmrazená regrese 53×3 použije samostatný prázdný master evidence,
stejný modelový artefakt a původní corpus. Nejde o runtime optimalizaci ani
nový holdout. Změna objemu zachytávání omezuje přímé srovnání nové latence
se S1. CI a vlastník integrace stále otevřené; návrh předání připravený.
