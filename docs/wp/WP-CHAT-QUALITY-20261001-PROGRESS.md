# IntentSmith — průběh práce na kvalitě chatu

Poslední aktualizace: **1. 10. 2026, 23:28 CEST**. Stav: **CHANGES_REQUIRED / WORK_CONTINUES / REVIEW_PENDING**.
Dokument aktualizuji po každém dokončeném milníku, nejpozději po třech hodinách
aktivní práce. Historická selhání zůstávají uvedena; nové ověření je nepřepisuje
na úspěch. Nejde o plánovač úloh po ukončení této pracovní relace.

Větev: `work/chat-quality-20261001`. Společný výchozí commit:
`45caf5b54b78def257221ac2ab33a64031800813`. Poslední testovaný implementační
commit: **`c868fea3`** (aktuální oprava schopností, 7 cílených PASS a 13
živých vývojových kroků; S1 se vztahuje výhradně k `3b3b399f`). Tento dokument se publikuje následným dokumentačním
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

## Další milník a podmínky přijetí

1. Nové dialogy A/B, přirozené akce, dlouhá návaznost, restart a osm kompakcí
   jsou dokončené. Významové nedostatky jsou uvedené výše; cíle nejsou splněné.
2. Technický profil a devět HTTP sad jsou dokončené. Baseline chyby zůstávají
   explicitně otevřené; profil není zelený.
3. Tři celé nezměněné série původních 53 případů dokončeny na `3b3b399f`.
   Vlastní významové hodnocení, efekty, kód a latence dokončeny; S1 nesplnil přijetí.
4. Opravit doložený neplatný enum mazání a otázky na vlastní schopnosti aplikace,
   zachovat fail-closed autority a potřebná doptání. Cílené testy a nové živé
   formulace mají doložit opravu; původní S1 se nepřepisuje.
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
