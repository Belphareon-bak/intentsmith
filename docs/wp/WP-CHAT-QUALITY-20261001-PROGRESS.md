# IntentSmith — průběh práce na kvalitě chatu

Poslední aktualizace: **1. 10. 2026, 19:27 CEST**. Stav: **CANDIDATE / REVIEW_PENDING**.
Dokument aktualizuji po každém dokončeném milníku, nejpozději po třech hodinách
aktivní práce. Historická selhání zůstávají uvedena; nové ověření je nepřepisuje
na úspěch. Nejde o plánovač úloh po ukončení této pracovní relace.

Větev: `work/chat-quality-20261001`. Společný výchozí commit:
`45caf5b54b78def257221ac2ab33a64031800813`. Poslední testovaný implementační
commit: **`f50ffea7`**. Tento dokument se publikuje následným dokumentačním
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

## Doložené výsledky a otevřená selhání

| Ověření | Testovaný commit / běh | Výsledek a hranice důkazu |
| --- | --- | --- |
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

Nový A/B běh potvrdil opravu zaměnění dvou vět za dvě slova a opakované žádosti
o již vložený text. Přesto měl věcné chyby: rozpor při porovnání cen, domyšlený
záznam semináře a chybné převádění neurčených dnů na kalendář. Krátké obecné
pravidlo pro zachování uživatelských faktů a neznámých údajů je implementované
a cíleně zelené; jeho účinek ještě musí potvrdit další živý běh.
Další starší neúspěšné a přerušené běhy zůstávají v evidenci, nikoli jako
PASS. Původní nepoužité rodiny F14–F20 zatím nebyly využity k ladění.

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
commitu. Závěrečný report poskytne kontrolovatelný výběr výsledků bez těchto
soukromých dat.

## Další milník a podmínky přijetí

1. Zopakovat nové 12případové dialogy také přímo proti stejnému modelu s
   historií. Oddělit aplikační chyby od kvality modelu; porovnávat skutečný
   obsah, nikoli pouze délku.
2. Na aktuálním kandidátu dokončit přirozené akce a dlouhou návaznost včetně
   restartu a nejméně dvou kompakcí.
3. Zmrazit commit a dokončit tři celé nezměněné série původních 53 případů.
   Celá tato série tvoří jeden přejímkový milník; během ní se testovaný commit
   nemění. Odpovědi se významově vyhodnotí až po dokončení všech tří sérií.
4. Dokončit celý technický profil aktuálního commitu, významové hodnocení,
   porovnání latence a závěrečný review report. Vlastní hodnocení se označí
   samostatně od nezávislého přijetí.

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
