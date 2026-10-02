# IntentSmith — průběh práce na kvalitě chatu

Poslední aktualizace: **2. 10. 2026, 12:45 CEST**. Stav: **NO_GO / REVIEW_PENDING / CI_NOT_RUN**.
Dokument aktualizuji po každém dokončeném milníku, nejpozději po třech hodinách
aktivní práce. Historická selhání zůstávají uvedena; nové ověření je nepřepisuje
na úspěch. Nejde o plánovač úloh po ukončení této pracovní relace.

Větev: `work/chat-quality-20261001`. Společný výchozí commit:
`45caf5b54b78def257221ac2ab33a64031800813`. Poslední testovaný implementační
commit: **`0fad3823`** (7 cílených PASS, kontext 21/21, M1 74/74;
celý profil 399 PASS / 4 FAIL / 3 BLOCKED). Živé archivní reprodukce na témže
SHA mají 3/3 užitečných; úzká časová sonda má šest úplných odpovědí.
S1 se vztahuje výhradně k `3b3b399f`, S2 k `6f0259ec`;
vývojové kroky schopností k `c868fea3`. Tento dokument se publikuje následným dokumentačním
commitem. Vlastní worktree: `intentsmith-chat-quality-20261001`.
Mimochatový worker, jeho soubory a produkční release zůstávají nedotčené.

Podrobný rozsah a autorita jsou v [pracovním balíku](WP-CHAT-QUALITY-20261001.md).

## Posouzení dodaných návrhů

Přijímám společnou interpretaci aktuální žádosti a historie, cílené doptání,
pokračování po odpovědi, přesnou identitu ukládaného obsahu, rozpočtování
kontextu, jednotné předávání paměti a měření latence. Přirozené ukládání a
atomické vytvoření souboru již částečně obsahoval společný baseline; původní
posudek staršího commitu tedy nevystihuje celý aktuální stav.

Doplnil jsem věcná kritéria a negativní kontroly odpovědí, celé dialogy,
opravy zadání, obnovu po restartu, izolaci projektů, práci s nedůvěryhodným
citovaným textem, ověření skutečných bajtů před schválením a skutečné testy
Studio DOM. Průběžné zobrazování tokenů zatím není implementováno: providerová
cesta používá celé odpovědi a změna sdíleného gateway není součástí tohoto WP.

## Dokončené implementační milníky

1. Klasifikátor dostává relevantní historii, zdrojové identity, otevřenou
   otázku a původní požadavek. První skutečné doptání se vrací uživateli bez
   přepsání na optimistickou odpověď. Návaznost přežívá restart.
2. Běžné odpovědi používají společný kontext paměti s původem. Kompakce se
   řídí kontextovým rozpočtem; hotový souhrn se ukládá před archivací a původní
   obsah lze dohledat podle identity. Selhání kompakce zachová surová data.
3. Uložení odpovědi, souhrnu a nového textu zachovává přesný zdroj a create-only
   režim. Chybějící jméno souboru vyvolá konkrétní otázku. Změna tématu,
   negace a nepotvrzená operace nesmí spustit starý efekt ani náhradní čtení.
4. Opravy textového scope drží vysvětlování a inline kód v rozhovoru i při
   otevřeném projektu. Odpověď po upřesnění zachová původní omezení. Číselný
   parametr modelu nesmí zaměnit věty za slova, citaci za pokyn ani obnovený
   formát za již zrušený limit.
5. Původní korpus 53 případů je beze změny. Přibyla předem deklarovaná
   významová rubrika a 12 vývojových případů ve třech celých dialozích.
   Test pěti frameworků nyní odmítá tři položky, duplicity a pouhá klíčová
   slova. Počet položek sám neprokazuje věcnou správnost jejich popisu.
6. Skutečná Studio aplikace prošla zkouškami odeslání, zastavení, restartu,
   přepínání relací a obnovy. Samostatná zkouška jejího skutečného DOM
   potvrzuje vykreslení Markdown/kódu a neprovedení vloženého HTML/scriptu.
7. Generování odpovědi nyní posílá již vybraný a rozpočtovaný kontext se
   skutečnými rolemi uživatel/asistent místo sloučení celého rozhovoru do
   jedné uživatelské zprávy. Souhrn zůstává označeným podkladem, nikoli
   systémovou instrukcí. Aktuální vstup se předá přesně jednou; dokončovací
   opakování zachovává celé předchozí zadání a role. Sdílený gateway se nemění.

## Doložené výsledky a otevřená selhání

| Ověření | Testovaný commit / běh | Výsledek a hranice důkazu |
| --- | --- | --- |
| Nezměněná série final-1 | `3b3b399f`, run `1e1b2ae2-4f59-4d7b-9967-8759d68f701c` | Vlastní významové hodnocení: 42/53 = 79,25 % užitečných, 6/53 = 11,32 % zbytečných zastavení, 0 kritických chyb. Cíle nesplněny |
| Nezměněná série final-2 | `3b3b399f`, run `0712bd56-9d2c-4921-a584-4f745ee0ad12` | Vlastní významové hodnocení: 41/53 = 77,36 % užitečných, 4/53 = 7,55 % zbytečných zastavení, 0 kritických chyb. Cíle nesplněny |
| Nezměněná série final-3 | `3b3b399f`, run `6fde29e0-9285-48ac-ac0a-249b2a8d8c55` | Vlastní významové hodnocení: 43/53 = 81,13 % užitečných, 5/53 = 9,43 % zbytečných zastavení, 0 kritických chyb. Cíle nesplněny |
| Celý offline + DB profil po nativních rolích | `495a069f`, `chat-quality-full-20261001-native` | 399 PASS / 4 FAIL / 3 BLOCKED z 406. Žádné nové selhání; čtyři otevřené chyby a tři blokované exportní/runtime sady níže zůstávají |
| Devět skutečných HTTP sad | `09d9fa01`, `chat-quality-journeys-20261001-native-current` | 9 PASS: účetní deterministická cesta, doslovný zápis, soukromí, projektové expertízy, opakované uložení, druhá kompakce, návaznost specialisty, překlad a přesnost hodnot |
| Starý prefix ve fixture přesnosti hodnot | `495a069f`, `chat-quality-journeys-20261001-native-fixed` | 8 PASS / 1 FAIL; helper nerozpoznal přesný nativní USER vstup. Opraveno v `09d9fa01`, původní pozitivní i negativní kontroly hodnot zůstaly. Samostatné opakování `chat-quality-value-native-20261001` 1 PASS a celé HTTP opakování výše 9 PASS |
| Chybný první výběr HTTP sad | `chat-quality-journeys-20261001-native` | Runner odmítl neexistující ID, exit 2, 0 provedených testů. Není selháním produktu ani PASS; opravený výběr používá registrovaná ID |
| Aktuální dlouhý rozhovor a skutečný restart | `e1638ac2`, run `e7eb8877-3191-4ae2-8af2-e15d31862009` | 27/27 užitečných, osm skutečných kompakcí, dva různé procesy. Po restartu správně Javor / LIPA_781 / ruční kontrola bez změn; nulové efekty |
| Zdvořilé, opakované a souhrnné uložení | `e1638ac2`, run `89a7b5ab-17c0-49a7-a37a-6754ce15a841` | 5/5 kroků dokončeno; všechny zápisy mají nula efektů před schválením a přesné následné bajty. Významově 3/5: neobratný pětislovný popis a souhrn tvořený citací s úvodem jsou nedostatečné |
| Vytvoření nového textu a uložení | `e1638ac2`, run `7567fa86-d0ea-461c-93bf-7d1437c9274e` | 1/1 užitečný, tři odrážky, durable zdroj před M2, create-only a přesné schválené bajty |
| Zastavený start dlouhého rozhovoru | `e1638ac2`, run `3757c726-5016-49a7-8bcc-43c97ba806a5` | BLOCKED_GPU, 0 případů a 0 modelových volání. Po nové inventuře volného provideru/GPU následoval celý 27případový běh výše; neúspěšný start zůstává zachovaný |
| Živé dialogy po předání nativních rolí | `ca0a7603`, run `9c443452-aaf9-474c-90a6-9878c06dd581` | B 9/12 a A 8/12 užitečných, 0 zbytečných zastavení, 0 kritických chyb. Tři odpovědi B stále domýšlejí kalendářní souvislost nebo mění den registrace; kvalitativní cíl není splněn |
| Skutečné role zpráv a opakování | `14f09b69`, `chat-quality-focused-20261001-native-final` | 7 PASS; M1 program 74 PASS včetně přímého ověření providerových rolí, úplných zdrojů a nulové systémové autority historie |
| Přechodové asertace starého textového obalu | `de4b4be8` a `c581b14a`, `chat-quality-focused-20261001-native-roles` / `native-retry` | Každý 6 PASS / 1 FAIL; staré očekávání JSON obalu / prefixu USER v CODE opakování. Nové asertace ověřují úplný skutečný USER vstup v každém požadavku |
| Opakování dialogů po stručném faktickém pravidlu | `8a849891`, run `08951687-6260-468a-a86d-e609fc7049db` | B 7/12 a A 6/12 užitečných, 1 zbytečné zastavení B, 0 kritických chyb; samotný prompt kvalitu dostatečně nezlepšil |
| Nejnovější cílené kontroly faktického promptu | `f50ffea7`, `chat-quality-focused-20261001-compact-facts` | 7 PASS / 0 FAIL / 0 BLOCKED, včetně původních pozitivních i negativních kontrol 4K kontextu |
| Delší verze faktického promptu | `a7a82265`, `chat-quality-focused-20261001-source-uncertainty` | 6 PASS / 1 FAIL; v M1 programu tři kapacitní kontroly selhaly. Prompt zkrácen, asertace a tlakové fixtures zůstaly stejné |
| Nové celé dialogy A/B | `09e44e89`, run `30b2ad78-ebca-4914-a2bc-4ad9b86b1d44` | 12/12 dokončeno; vlastní hodnocení B 8/12 a A 8/12 užitečných, 0 zbytečných zastavení, 0 kritických chyb |
| Celý offline + DB baseline | `45caf5b5` | 397 PASS / 5 FAIL / 3 BLOCKED |
| Poslední celý offline + DB kandidát | `77cdd7b6`, `chat-quality-full-20261001-rubric` | 399 PASS / 4 FAIL / 3 BLOCKED; není zelená brána ani důkaz novějšího commitu |
| Nejnovější cílené kontroly | `82a9a7a2`, `chat-quality-focused-20261001-cancelled-format` | 7 PASS / 0 FAIL / 0 BLOCKED; kontext, doslovný zápis, opakované uložení, runner, CRE, M1 a importní hranice |
| Předchozí negativní kontrola změny formátu | `f2fc721d`, `chat-quality-focused-20261001-format-precedence` | 6 PASS / 1 FAIL; zrušený limit slov chybně přetrvával, opraveno v `82a9a7a2` |
| Studio/Electron | `77cdd7b6`, `chat-quality-studio-20261001-rubric` | 3 PASS; skutečná aplikace, řízený backend, bez živého modelu |
| Studio Markdown a nedůvěryhodné HTML | `21f3d22c`, `chat-quality-focused-20261001-renderer` | Skutečný UI průchod PASS; celá cílená sada měla 5 PASS / 2 FAIL kvůli starým fixture kontraktům, opraveným v `05105d04` |
| Nové celé dialogy proti živému modelu | `05105d04`, run `67ea6302-3d87-4b8e-a53f-efa3fb886f86` | 12/12 transportně dokončeno; vlastní významové hodnocení 8/12 užitečných, 2/12 zbytečných zastavení, 0 kritických chyb |
| Dlouhá návaznost — historický vývojový běh | `7c7e4c4c`, run `51273392-fd99-438c-a21f-aa457ad87875` | 27/27 užitečných podle vlastního hodnocení, nejméně pět kompakcí a skutečný restart; není přejímka aktuálního commitu |

Čtyři chyby celého kandidáta: `artifact-validation`,
`m1-model-failover-schema`, `m6-runtime-evidence`, `routing-accuracy`.
Poslední je skutečná chyba účetního doménového směrování, nikoli pouhá
dokumentační odchylka. Tři BLOCKED: `accountant-workflow-integration`,
`chat-export-budget`, `export-pdf-docx`; chybí autorizovaná PDF runtime.

Tři finální série dokončeny 22:23 CEST na jednom čistém commitu. Shodný
manifest (source, corpus, runner, model digest a Node) i fingerprint efektivní
konfigurace; každé volání a závěrečný inventář dokládají tentýž artefakt modelu.
Celkem 159 odpovědí B a 159 přímých A, 405 modelových volání. Žádný průběžný
obsah nebyl použit k ladění; významové hodnocení je nyní hotové: souhrnně 126/159 užitečných a 15/159
zbytečných zastavení, 0 kritických chyb těchto sérií. Výsledek CHANGES_REQUIRED;
žádná série nesplnila cíle. Transportní stav LIVE_COMPLETE_UNASSESSED v raw
runner evidence zůstává původním označením před vlastním hodnocením. Po posledním běhu vlastní procesy skončily a provider
i NVIDIA compute inventář jsou prázdné. Modelové bindingy se neměnily.

První nový A/B běh potvrdil opravu zaměnění dvou vět za dvě slova a opakované žádosti
o již vložený text. Přesto měl věcné chyby: rozpor při porovnání cen, domyšlený
záznam semináře a chybné převádění neurčených dnů na kalendář. Krátké obecné
pravidlo pro zachování uživatelských faktů a neznámých údajů je implementované
a cíleně zelené. Následné opakování stále měnilo známé dny a domýšlelo fakta,
proto nestačí k přijetí. Další implementační krok zachovává nativní role
rozhovoru na skutečné providerové hranici. Živý průchod po změně má 9/12
užitečných odpovědí B: celé doporučovací a citované dialogy prošly, zbývají
věcné chyby v seminářovém dialogu. Nejde o důkaz ≥95% kvality systému.
Další starší neúspěšné a přerušené běhy zůstávají v evidenci, nikoli jako
PASS. Rodiny F14–F20 nebyly využity k ladění před S1; po hodnocení jsou odhalené.
Pro další přejímku se nesmějí znovu označit jako nepoužitý vzorek.

A/B latence tohoto vývojového běhu: první studená B odpověď 73,0 s, z toho
52,8 s načítání modelu; ostatních 11 B odpovědí medián 15,2 s a p95 30,8 s.
Celé A/B páry měly medián B 16,1 s versus A 5,1 s. A používá jednodušší
systémový prompt a příchozí historii B; není to nezávisle vedený dialog ani
měření čisté režie aplikace. Rozdíl převyšuje deklarovaných 20 % a vyžaduje
zvážení nákladů klasifikace a bezpečného předání kontextu, nikoli tvrzení o
splněné pohotovosti.

Surové DB, providerové záznamy a úplné diagnostické logy jsou místní soukromé
artefakty v `.intentsmith-artifacts/chat-quality-20261001/` a
`.intentsmith-artifacts/test-runs/<run-id>/`. Neobsahují se v publikovaném
commitu. Kontrolovatelný výběr výsledků je v [review reportu](../review/2026-10-01-CHAT-QUALITY.md)
a jeho evidence přílohách; obsahuje syntetické odpovědi, důvody, identity,
bajty efektů, latence a původní neúspěchy, bez privátních DB a capabilities.

## Milník S2 — návaznost mazání a skutečné schopnosti aplikace

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
  [evidenci vývojového milníku](../review/evidence/chat-quality-20261001/capabilities-development.json).

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

[Kontrolovatelná evidence včetně skutečných providerových rolí a podkladů](../review/evidence/chat-quality-20261001/archive-boundary-live.json).

## Milník S4 — skutečná hranice faktických chyb

| Změna uživatelského chování | Stručný důkaz | Zbývající problém | Jeden následující krok |
| --- | --- | --- | --- |
| Tento diagnostický milník nemění runtime. Oprava archivu zůstává; faktické odpovědi stále nelze označit za spolehlivé. Nezavádíme nedoloženou opravu předávání kontextu ani změnu modelových bindingů. | Osm konkrétních chybných odpovědí S1 je bajtově shodných se surovým providerovým textem; celé zadání a příchozí historie jsou ve skutečném vstupu. Šest nových volání přesně opakuje tři původní vstupy na stejném digestu Qwen3.5, včetně obou SYSTEM a parametrů. Rok 2024, obrácená negace a „hlubší vrstvy“ se v těchto dvou opakováních příslušného případu nevrátily; jiné nepodložené závěry o modelových verzích a přehnaný příměr paměti zůstávají. | Chybná fakta vznikají při generování. Dvě náhodná opakování neoddělí vliv promptu od omezení modelu; přímé A má jednodušší prompt, někdy jiný výstupní strop. Chyba kontextu zde doložená není. | Dokončit celý offline/DB profil aktuálního kandidáta před zmrazenou regresní přejímkou. |

[Úplné syntetické providerové vstupy, původní B/A a všech šest opakování](../review/evidence/chat-quality-20261001/factual-provider-trace.json).
Run `c1647717-6a1b-431b-b863-89d3011bfb86` na `38ca74c3`, provider
`0.34.0-intentsmith.1`, digest beze změny; 6 platných inferencí, nulové externí
akce. Tři předchozí starty zachovány jako BLOCKED_GPU s nulou inferencí kvůli
využití GPU. Vlastní prokazatelně nečinná residency byla uvolněna; cizí procesy
ani modely nebyly zastaveny. Nejde o nový počet PASS ani obecnou přejímku.

U těchto chyb má smysl ověřené doplnění podkladů a řízené vyhodnocení
instrukcí/modelu. Samotné doplnění dalšího obecného zákazu nepravdivých faktů
nemá prokázaný přínos; stávající taková instrukce ve vstupu skutečně je.
Aktuální priority nevyžadují změnu fyzického modelu, jeho porovnání je odložené.

CI má [konkrétní předávací návrh](../review/2026-10-02-CHAT-CI-HANDOFF.md)
na ověřený main, včetně sedmi sad a zachování auditních reportů. Vlastník/kanál
stále není známý, workflow nebyl měněn a CI kandidáta není doložené.

První nový start celého profilu `chat-quality-full-20261002-archive` runner
odmítl (exit 2, 0 testů): nově vytvořená evidence ještě nebyla commitnutá a
runner vyžaduje čistý strom. Nejde o výsledek profilu; po publikaci důkazu
následuje nový čistý běh s jiným ID.

## Milník S5 — celý profil a měřená režie přejímky

| Změna uživatelského chování | Stručný důkaz | Zbývající problém | Jeden následující krok |
| --- | --- | --- | --- |
| Runtime se tímto ověřením nemění. Oprava archivu nezavádí nové selhání ve všech 406 registrovaných offline/DB sadách. Latence S1 zůstává historickým měřením celé diagnostické cesty, nikoli čisté produkční aplikace. | `289afec0`, `chat-quality-full-20261002-archive-clean`: 399 PASS / 4 FAIL / 3 BLOCKED, exit 1; přesně stejné otevřené non-PASS jako před archivní opravou. Rozklad všech 60 předem vybraných textových měření: rozhodnutí průměrně 9,763 / 9,937 / 10,404 s, generování s kontrolami 12,555 / 11,640 / 12,722 s. Kontrolovaná fixture bez modelu s 88 417 475 B klonované historie reprodukuje 3,186–3,383 s na požadavek, z toho 3,109–3,317 s synchronní přepis historie. | Čtyři FAIL a tři BLOCKED nejsou odstraněné. Přesnou minulou režii jednotlivých zápisů nelze dopočítat; latence S1 není srovnatelná s čistým providerovým časem ani ji nelze upravit prostým odečtením dnešní fixture. Kvalita aktuálního runtime ještě nemá nové celé tři série. | Zmrazit čistý publikující commit a dokončit tři nezměněná regresní opakování 53 případů na samostatném prázdném masteru evidence. |

[Celý technický profil](../review/evidence/chat-quality-20261001/full-profile-archive.json),
[přesný rozklad S1 včetně hodnot každého případu](../review/evidence/chat-quality-20261001/s1-latency-decomposition.json)
a [kontrolovaná reprodukce režie evidence](../review/evidence/chat-quality-20261001/latency-capture-fixtures.json).

Pozorovaná příčina měřicí režie: `scripts/measure-m1-l3.js` volá `canonical()`
i při každém `persistWire`, což synchronně čte a přepisuje celý společný master
historických běhů. Samotný relay s malou historií měl v řízené fixture
5,6–37,8 ms, nikoli sekundy. Samostatný master nové série tento historický
objem nebude obsahovat; žádná stará evidence se nemaže ani nepřepisuje a runner
se kvůli měření nemění. Významové skóre S1, skutečné efekty i NO_GO tím zůstávají.

Následující kandidát bude mít beze změny všechny původní formulace a digest
Qwen3.5. Nová série je **regrese po S1**, nikoli dosud neviděný holdout F14–F20.
Žádné změny zdrojů, corpus/runner ani čtení odpovědí k ladění mezi třemi běhy.
Výsledky a milník se zapíší po dokončení celé zmrazené série, SHA je v jejím
manifestu. Vlastní hodnocení nenahrazuje nezávislé přijetí.

## Milník S6 — dokončená zmrazená regrese S2

| Změna uživatelského chování | Stručný důkaz | Zbývající problém | Jeden následující krok |
| --- | --- | --- | --- |
| Aktuální cesta zvládá přesné schválené soubory, dostupnost nástrojů a většinu návaznosti v původních dialozích. Může však nepravdivě oznámit odeslání e-mailu, přestože žádný efekt nenastal. | Nezměněný `6f0259ec`, tři úplné série 53: vlastní užitečnost 49/53, 48/53, 47/53 (celkem 144/159 = 90,57 %), zbytečná zastavení 0/0/1, kritické nálezy 1/0/0. Všech 159 žádostí bez předčasného efektu; 39 přesných schválených zápisů a 12 správných čtení. Všech 24 příkladů Pythonu izolovaně ověřeno. | **NO_GO**: cíl 95 % nesplněn a existuje vymyšlené provedení. Toto je vlastní hodnocení známé regrese, nikoli nový holdout nebo nezávislé přijetí. Technická brána zůstává 399 PASS / 4 FAIL / 3 BLOCKED; CI nedoložené. | Opravit nezávisle reprodukovanou mezeru fixture `decision.toJSON` a ověřit také úspěšný návrat handleru. |

Běhy: `1020b23a-c809-46b4-8df0-e610baa0ab49`,
`7a554d42-eb33-43d5-b87d-38f11756f3d5`,
`c0558205-c3e3-4e5c-b66d-16bca89d8f61`. Stejný model/digest, corpus,
runner a konfigurace; 139/139/140 platných inference, žádná neplatná.
Odmítnutý start druhého běhu `62cdd4af-b15d-4aac-922f-333583f1e90f`
zůstává **BLOCKED_GPU**, 0 případů a volání. Odpovědi se četly až po dokončení
všech tří opakování; mezi běhy nebyla žádná změna kandidáta.

[Každá odpověď a významový důvod hodnocení](../review/evidence/chat-quality-20261001/s2-semantic-assessment.json),
[skutečné efekty](../review/evidence/chat-quality-20261001/s2-effect-check.json),
[izolované příklady](../review/evidence/chat-quality-20261001/s2-code-check.json),
[rozklad latence S2](../review/evidence/chat-quality-20261001/s2-latency-decomposition.json),
[kritický providerový vstup a nezměněný výstup](../review/evidence/chat-quality-20261001/s2-critical-provider-trace.json).
Kritický nález není skutečné odeslání: raw modelový výstup tvrdí odeslání,
zatímco trace žádný efekt nedokládá. Zlepšení vlastního souhrnného skóre proti
S1 neprokazuje konvergenci ani přijetí; známé formulace už nejsou holdout.

Na stejných dvaceti textových případech má S2 průměr rozhodování
2,413 / 3,555 / 4,693 s a generování s kontrolami 4,666 / 6,240 / 8,054 s.
Providerový součet je 6,267 / 6,812 / 7,172 s. Zbytek není čistá režie aplikace:
synchronní evidence roste i uvnitř nového masteru. S1 a S2 mají jiný objem
diagnostické historie; jejich rozdíl nelze vydávat za zrychlení produktu.
Čisté měření interpretace/generování/aplikace/diagnostiky teprve následuje.

### Přijatý doplňující nezávislý posudek

Potvrzuji přesnější stav úplného profilu na `289afec0` a jeho runtime shodu
s dokumentačním `6f0259ec`. Novou reprodukci „Projekt má název Lípa.“ →
„Oprava: místo toho používej Javor.“ přijímám jako konkrétní závadu výběru
archivu: chybí významová návaznost a `omitted=false` zamlčuje nevybranou opravu.
Zvlášť ověřím růst ceny hledání, opravy za koncem výňatku a změnu tématu.
FTS5 ani embeddings nejsou samy důkazem správnosti významu.

Další aplikační opravy vyžadují reprodukci. Původní 53 zůstává regresí;
budoucí nepoužitý holdout bude oddělen od ladění a nezávisle hodnocen.
Modelový pilot M0 nepřijal nezhoršení Qwen3.8 a hodnotitel viděl identity;
porovnávání modelů zůstává odložené podle operátora. `routing-accuracy`
(DPH v Německu) je otevřená skutečná vada sdílené specialistní cesty.
CI návrh je připraven, kontakt vlastníka integrace dosud není určen.

## Milník S7 — odstraněná falešně zelená fixture

| Změna uživatelského chování | Stručný důkaz | Zbývající problém | Jeden následující krok |
| --- | --- | --- | --- |
| Produkční chování se touto opravou nemění. Kontrola běžné odpovědi nyní odhalí chybu návratu handleru i při správném providerovém vstupu. | Přidaná asertace před opravou reprodukovala `decision.toJSON is not a function`. Po vytvoření skutečného rozhodnutí přes existující factory: celý program 17/17 PASS, včetně skutečného HTTP restartu. Test ověřuje přesný návrh zprávy, nepřítomnost error, model, finishReason, ANSWER, requestedOperation, čas a canExecute=false. | Jde o opravu důkazu, nikoli o důkaz vyšší modelové kvality; kritický S2 nález, archiv, CI a technické non-PASS zůstávají. | Reprodukovat a opravit výběr archivní opravy bez společných slov pro paměťový i SQLite backend. |

Předchozí příliš obecný filtr názvu vybral nula subtestů a není započítán
jako PASS. Správný konkrétní filtr nejprve selhal a po opravě prošel;
potom prošel celý program. Fixture emituje použitelný přesný návrh zprávy,
ne nesouvisející text o Gitu. Produkční metoda rozhodnutí se nemění.

## Milník S8 — archivní reprodukce a oddělený výkon

| Změna uživatelského chování | Stručný důkaz | Zbývající problém | Jeden následující krok |
| --- | --- | --- | --- |
| „Místo toho Javor“ se předává s původním pojmenováním i bez společného slova. Oprava na konci dlouhé zprávy se neztratí za prefixem. Vynechané zprávy se přiznávají i při nulové lexikální shodě. | Čtyři nové reprodukce na paměti/SQLite před opravou FAIL; po opravě celý kontextový program 21/21 PASS, včetně změny tématu, >1000 zpráv, cizího projektu, přesných UTF-8 pozic suffixu, editace/mazání a změny přes jiné spojení. Soukromá SQLite zkouška 1k/10k/50k zpráv: opakovaný řídký dotaz medián 0,25/0,28/0,42 ms proti 7,05/66,34/336,09 ms baseline; častý výraz 1,90/16,70/98,05 ms proti 7,09/68,40/347,24 ms. | Nejde o záruku libovolné vzdálené významové opravy: výběr je stále lexikální, nejvýše tři zprávy a dva sousedé. První vytvoření indexu stojí 6,58/42,77/270,12 ms; zápis přes jiné spojení jej invaliduje. Živá odpověď těchto nových případů zatím není změřená. | Zmrazit nezbytné opravy a provést deklarované živé archivní a čisté časové sondy na stejném modelu. |

[Všechny podmínky měření archivu a SHA-256 zdrojů](../review/evidence/chat-quality-20261001/archive-performance.json).
Měření používá stejnou privátní DB a 25 střídajících dotazů pro každou podmínku.
Po zahřátí má index nula zápisů; časté výrazy zůstávají dražší. TEMP FTS5
je cache pro nejvýše čtyři konverzace ve spojení, bez trvalé migrace.
Vybraný obsah se znovu čte z původních zpráv ve stejném DB snapshotu;
scope metadata jsou ověřená. Prefix a suffix zůstávají oddělené, s přiznanou
mezerou a přesnou bajtovou pozicí. Příprava souborových efektů pořád čte celé
původní bajty podle identity, tento index nedodává efektová oprávnění.

Neúspěšný první indexový experiment měl nevhodné pořadí JOIN a byl zastaven;
finální benchmark používá explicitní pořadí FTS → původní řádek. První test
externího spojení selhal na chybějícím `conversation_web_writer`; fixture
nyní registruje skutečný autoritativní writer, nikoli náhradní funkci nebo
vypnutí triggerů. Tyto neúspěchy se nezapočítávají jako zelené ověření.

Runner již nekonsoliduje celý historický master při každém providerovém
eventu. Raw journal zůstává fsynced před předáním. Přibyly monotónní časy
journalu, snapshotu, čekání na upstream a předání konce odpovědi; kontrolovaný
test ověřuje úplný návrat i všechny stávající přerušené přenosy. Deklarované
sondy: tři archivní reprodukce a šest shodných read-only otázek v nových
konverzacích. Nepoužívají zjednodušené A instrukce a nejsou nový holdout.
Živé časy se zapíší až po skutečném běhu na čistém commitu.

## Milník S9 — obnova cache a zmrazení dalšího kandidáta

| Změna uživatelského chování | Stručný důkaz | Zbývající problém | Jeden následující krok |
| --- | --- | --- | --- |
| Selhání archivní query nezanechá falešný údaj o hotovém indexu; následující úspěšné dohledání znovu vrátí původní podklady. | Kontrolovaná chyba po naplnění TEMP indexu vyvolá rollback; následná query znovu vrací Javor. TEMP objekty vznikají před snapshotem a chybná transakce invaliduje cache. Celý kontextový program 21/21 PASS; runner zachovává 23 transportních kontrol, 53případovou rubriku a šest kalibračních kontrol seznamu. Jediná nová importní hrana je přesně přijatá v baseline. | Není nezávislá kvalitativní přejímka, zelené CI ani nové úplné technické ověření tohoto kandidáta. | Na čistém publikujícím SHA spustit sedm registrovaných cílených sad a deklarované živé sondy bez průběžných změn zdrojů. |

[Opakovaný benchmark přesného zdroje po ochraně rollbacku](../review/evidence/chat-quality-20261001/archive-performance-recovery.json)
zachovává předchozí měření S8. Další runtime opravy po tomto zmrazení vyžadují
novou konkrétní reprodukci; původní S1/S2 a jejich commity zůstávají nedotčené.
Nezávislý autor/hodnotitel nového holdoutu není určen; vlastní hodnocení
jej nenahrazuje. Kontakt vlastníka CI/integrace rovněž stále chybí.

## Milník S10 — živé reprodukce, čistý rozklad a celý zmrazený profil

| Změna uživatelského chování | Stručný důkaz | Zbývající problém | Jeden následující krok |
| --- | --- | --- | --- |
| Na `0fad3823` chat živě drží Javor po opravě bez společných slov i z konce dlouhé zprávy; při opravě oběda zachová projekt Lípa. | `63ee5ba2-7313-4a37-b629-bec809767544`: 3/3 užitečné podle vlastního čtení, šest přesných inference stejného digestu, původní identity v klasifikaci i generování, nula efektů. Sedm registrovaných cílených sad PASS. Celý profil `chat-quality-full-20261002-followups-matched` na stejném čistém SHA: 399 PASS / 4 FAIL / 3 BLOCKED, všech 406 provedeno nebo výslovně blokováno, shodná non-PASS s předchozím úplným profilem. | **NO_GO** trvá: S2 má kritické vymyšlené odeslání a vlastní užitečnost 90,57 %. Výběr archivu stále nezaručuje všechny vzdálené opravy. Technická brána a CI nejsou zelené; nezávislý nepoužitý holdout nemá autora/hodnotitele. | Předat zmrazeného kandidáta určenému nezávislému autorovi/hodnotiteli holdoutu a integračnímu vlastníkovi; identita/kontakt obou je otevřená otázka operátorovi. |

[Živé podklady archivu včetně skutečných providerových zpráv](../review/evidence/chat-quality-20261001/followup-archive-live.json),
[registrované cílené sady](../review/evidence/chat-quality-20261001/focused-followups.json),
[nejnovější celý profil a přesné non-PASS](../review/evidence/chat-quality-20261001/full-profile-followups.json).
Archive seed je syntetický >1000řádkový rozhovor, nikoli tisíc živých odpovědí.
Po celou dobu těchto měření se zdroje, corpus, runner ani model neměnily.

Časová sonda `0320d267-a4b0-4e08-86df-fa6e181214d4` má šest stejných
otázek HTTP 409 v nových konverzacích, dvanáct inference, stejný 4K kontext,
256 tokenů klasifikace a 384 tokenů generování. Providerové klasifikační
požadavky jsou totožné; generační jsou totožné po vyjmutí pouze dodaného
aktuálního časového SYSTEM záznamu. První cold odpověď: **11,327 s**, z toho
načtení modelu **5,554 s**. Pět warm odpovědí: medián **5,052 s**,
nejpomalejší **5,127 s**. Průměrné složky jsou:

| Složka | Warm průměr | Jak se čte |
| --- | --- | --- |
| Interpretace včetně provideru | 2,198 s | Součást celého času chatu |
| Generování a kontroly | 2,841 s | Součást celého času chatu |
| Ostatní aplikace mimo obě fáze | 3,6 ms | Součást celého času chatu; zaokrouhlené monotónní časy |
| Providerový součet obou inference | 4,950 s | Čas uvnitř předchozích dvou fází, ne přídavná položka |
| Fsynced diagnostika před předáním odpovědi | 61,7 ms | Již zahrnutá v aplikačních fázích |
| Nevysvětlený zbytek po odečtení provideru a této diagnostiky | 30,8 ms | Síť/klient/gateway a také post-forward capture; není čistý produkční overhead |

[Úplný rozklad s každým vstupem, limitem a odpovědí](../review/evidence/chat-quality-20261001/clean-latency-probe.json).
Tato sonda pokrývá jednu krátkou českou otázku a jediné cold načtení;
neprokazuje globální zrychlení, cold distribuci ani čas prvního tokenu.
Některé odpovědi stále přidávají nepravdivou nutnost manuálního zásahu.
Úspěšná doprava a rychlost proto nejsou kvalitativní PASS. Dvě modelová volání
jsou hlavní cenou **této změřené cesty**, nikoli všech zpráv aplikace.
Žádná nová rychlá cesta ani streaming se na základě sondy nezavádí.

První audit `chat-quality-full-20261002-followups` měl odlišný seznam
povolených nástrojů a byl přerušen: 45 PASS / 2 FAIL / 2 BLOCKED / 357 SKIPPED.
Jedno FAIL je zrušený běžící child; originální report zůstává beze změny.
Je to **INCOMPLETE**, nikoli nová reprodukovaná produktová regrese.
Následný úplný běh výše používá přesně předchozí konfiguraci a má exit 1.
První bezpečné cleanup kontroly po živých sondách odmítly krátce ne-idle GPU;
po novém ověření vlastní identity a idle stavu byly uvolněny pouze vlastní
residency. Cizí práce a produkční release nebyly měněny.

Pro ROOT je [konkrétní předání routingu](../review/2026-10-02-CHAT-ROUTING-ROOT-HANDOFF.md).
Přesně doložený výsledek „Co je DPH v Německu?“ je chybné
`vat_calculator → clarify [calculationIntent]`, ne doložený provedený výpočet.
Nezávislý [holdout má připravený postup](../review/2026-10-02-CHAT-HOLDOUT-HANDOFF.md),
ale corpus, autor a hodnocení ještě neexistují. Porovnávání modelů zůstává
odložené; M0 není přijaté nezhoršení ani nezávislý slepý důkaz.
CI předávací návrh není aplikované workflow a PR dříve odmítlo oprávnění 403.

## Další milník a podmínky přijetí

### S11 zahájení — známé reprodukce a nezávislý holdout (2. 10.)

Operátor dodal zapečetěný holdout na `review/chat-holdout-seal-20261002`,
commit `6a9d1dbe`; protokol byl přečten pouze z Git větve. Dřívější stav
„autor/corpus neexistují“ je tím překonaný. Zapečetěný adresář nebyl otevřen
ani prohledáván. Autorova izolace je podle koordinátora organizační,
technicky nevynucená. Obsah worker nezná.

- Uživatelské chování k opravě: neprovedené odeslání hlásí aplikace a
  samostatné vysvětlení RAM/disku zachová dvě věty vedle limitu GPU.
- Důkaz před opravou: připravená měřicí fáze `quality-reproduced-defects`
  provede střídavě 20 stejných e-mailů a 20 složených žádostí přes M1;
  aktuální produkční aplikační cesty se zatím nemění.
- Zbývá: oba nálezy, runner holdoutu a zmrazení; kvalita stále NO_GO,
  CI_NOT_RUN, faktické znalosti modelu ani jazyková parita nejsou vyřešené.
- Následující krok: dokončit baseline 40 kroků na čistém commitu před
  aplikační úpravou, potom opravit obě hranice a změřit shodných 40 kroků.

### S11 baseline a implementace — 2. 10., 14:55 CEST

- Změna uživatelského chování: aplikace sestavuje `not_executed` s původem
  `application`, doslovný e-mail zachová příjemce a celé tělo bez generátoru;
  nezávislá textová část složené žádosti dostává vlastní vstup. Generované
  koncepty jsou oddělené chráněným citovaným blokem od stavu provedení.
- Důkaz: baseline na `2f2f2dee7d6aa3fd4b791b1d9b3de30c958b9591`, run
  `d7590e2e-2a92-43d4-9d8c-bcc2d868e820`, 40/40 kroků, 81 inferencí,
  přesný historický digest, 0 efektů. E-mail: nové vymyšlené provedení
  0/20 (historický kritický nález tím není vyvrácen). GPU: neúplný výklad
  20/20, vždy jen jedna věta vysvětlení. Řízená sada 22/22 včetně M1/DB;
  runner ověřen jen na syntetickém dummy, chybný SHA odmítnut i v live režimu
  ještě před preflightem. Dvě přesné nové read-only importní hrany,
  1 495 hran; 3 cykly / 28 členů zachováno.
- Zbývá: registrované kontroly a 20 živých opakování po opravě. Vlastní
  řízené testy nejsou nezávislá kvalitativní přejímka. První pokus spustit
  audit odmítl necommitnutý importní baseline ještě před testy; žádný výsledek
  profilu nevznikl. Technická brána a CI zůstávají otevřené.
- Následující krok: na čistém commitu dokončit registrované kontroly a
  shodnou reprodukční sérii, poté zmrazit kandidáta pro odpečetění operátorem.

### S12 první živá oprava — GPU stále FAIL, 2. 10., 15:12 CEST

- Změna chování: e-mail má aplikací sestavený pravdivý stav a přesné tělo;
  složené zadání zatím neumělo zachovat text, pokud ho model nevybral.
- Důkaz: čistý `9317c177`, run `21860a76-3da2-425f-8319-cf5a96ceed92`,
  40/40 kroků, 41 inferencí, 0 efektů. E-mail **20/20** přesný příjemce,
  tělo a stav; vymyšlené provedení **0/20**. GPU **1/20** kompletní;
  **19/20** ztratilo vysvětlení, protože `textRequest` bylo null. Je to
  neúspěšná první implementace, nikoli kvalitativní PASS. Celý profil téhož
  zdroje doběhl beze změny: **399 PASS / 4 FAIL / 3 BLOCKED**, žádný SKIPPED.
  Registrovaných sedm cílených sad PASS.
  [Baseline](../review/evidence/chat-quality-20261001/defects-before-proof.json),
  [první oprava](../review/evidence/chat-quality-20261001/defects-after-first-proof.json).
- Runner: syntetické `holdout-1..3` dokončeny na stejném zdroji, po 3 krocích
  a 7 inferencích, vždy přesně schválené čtení a zápis. Bajty ověřeny;
  veřejný progress bez obsahu a bez chybových textů. Toto ověřuje runner,
  nikoli kvalitu skutečného zapečetěného holdoutu.
  [Dummy protokol](../review/evidence/chat-quality-20261001/dummy-holdout-proof.json).
- Zbývá: opravit vlastní zahazování nevybraného textu; význam názvu veličiny
  se nebude přebírat z volného pole modelu. Dotaz bude citovat přesné zadání.
- Následující krok: aplikace zachová všechny zdrojové úseky mimo jednoznačně
  označený nedostupný efekt; nových 20 opakování každého známého případu
  proběhne na novém čistém kandidátu. Předchozí série zůstává beze změny.

1. Nové dialogy A/B, přirozené akce, dlouhá návaznost, restart a osm kompakcí
   jsou dokončené. Významové nedostatky jsou uvedené výše; cíle nejsou splněné.
2. Technický profil a devět HTTP sad jsou dokončené. Baseline chyby zůstávají
   explicitně otevřené; profil není zelený.
3. Tři celé nezměněné série původních 53 případů dokončeny na `3b3b399f`.
   Vlastní významové hodnocení, efekty, kód a latence dokončeny; S1 nesplnil přijetí.
4. S2 je dokončená regrese na `6f0259ec`, rovněž NO_GO. Následuje oprava
   fixture, významového výběru archivu a oddělené měření výkonu a latence.
   Původní S1 ani S2 se nepřepisují.
5. Nezávislé review a skutečné CI zůstávají otevřené.

Předem dané cíle: ≥95 % užitečných reakcí, ≤5 % zbytečných zastavení,
nula kritických chyb. Vyhodnocení musí ukázat i jednotlivé oblasti a rodiny,
aby snadné pozdravy nezakryly chyby při ukládání či opravách zadání.
Měříme čas celé odpovědi; čas prvního užitečného tokenu a streaming dosud
změřené nejsou.

## Publikace

Publikujeme kandidátní větev a tento dokument. Nejde o nasazení, merge ani
nezávislou přejímku. Předchozí pokus o vytvoření draft PR skončil GitHub
403 `Resource not accessible by integration`; PR nevzniklo. GitHub CI této
vlastní větve dosud nebylo spuštěno a jeho stav je **CI_NOT_RUN**.
Srovnávací baseline větev `review/chat-quality-base-20261001` ukazuje přesně
na společný `45caf5b5`.
