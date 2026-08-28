# IntentSmith — pravidla vývoje

**Verze:** 4 · **Datum:** 2026-08-21 · **Vlastník:** operátor

> Tento dokument je **jediný zdroj pravdy pro pravidla vývoje**. Kde si jakýkoli
> jiný dokument v repozitáři odporuje s tímto, platí tento.
>
> Produktový cíl určuje [`PRODUCT.md`](PRODUCT.md), evoluční rozhodnutí
> [`DIRECTION.md`](DIRECTION.md), pořadí [`ROADMAP.md`](ROADMAP.md) a změřený
> stav [`SYSTEM-MAP.md`](SYSTEM-MAP.md). `AGENTS.md` a `CLAUDE.md` jsou pouze
> vstupní ukazatele; `docs/convergence/*` je historická/release evidence.

---

## 1. Východisko — evoluce funkčního produktu

C3 je funkční produkt, nikoliv greenfield baseline. IntentSmith jej evolučně
zpřesňuje, zpevňuje a doplňuje. Funkční části se zachovávají, dokud měření nebo
uživatelský scénář neprokáže konkrétní přínos opravy či náhrady. Historický
rozbor a čísla jsou v `DIRECTION.md`. Dynamická měření a průběžné statusy patří
do `SYSTEM-MAP.md`; tento kontrakt může uchovat jen řídicí rozhodnutí nebo
pojmenovaný blocker, který mění způsob práce.

Z toho plynou čtyři pravidla:

1. nejprve pozorovat produkt a skutečný call graph, teprve potom měnit;
2. nepřepisovat fungující část jen proto, že existuje novější knihovna;
3. náhrada musí prokázat přidanou funkci, kvalitu, bezpečnost nebo nižší cenu;
4. objem testů, dokumentů ani commitů není důkaz výsledku.

---

## 2. Vrstvy

Ne fáze. Fáze se projdou a zapomenou; tohle platí trvale a běží souběžně.

| | Vrstva | Co to je |
|---|---|---|
| **L0** | Release invarianty a vývojové rails | Co musí platit pro release a co žádná změna nesmí dále oslabit. Otevřené zděděné porušení se přizná a opraví před releasem. |
| **L1** | Zelená linie | Scénáře, které musí fungovat vždy. Běží při každé změně. Roste o jeden scénář za každou dokončenou schopnost. Cíl je běh v řádu vteřin — zatím **neověřeno**, dnešní deterministická sada běží minuty. |
| **L2** | Schopnosti | Vertikální user journeys v ohraničených WP; nezávislé WP mohou podle DAG běžet paralelně. |
| **L3** | Kvalita jako číslo | p95 latence, chybovost, přesnost intentů, počet regresí. Měřeno průběžně. |
| **L4** | Evoluce | Výměny a upgrady. Sahá se jen na to, co je za stabilním rozhraním z L0. |

### L0 — invarianty

Prvních deset je zděděný technický kontrakt. Poslední tři jsou produktová
autorita. Invariant může být `VERIFIED`, `UNVERIFIED`, `PARTIAL` nebo
`OPEN_VIOLATION`; pouze první stav znamená prokázané splnění. Aktuální stav je
výhradně v `SYSTEM-MAP.md`, ne v tomto kontraktu. Žádná změna nesmí otevřené
porušení rozšířit nebo vydat za zelené a M6 vyžaduje všech třináct bez
otevřeného porušení.

1. CRE je jediná autorita — žádná zpráva ji neobejde.
2. `mergeExpertisePrompt()` je čistá funkce — žádné side effects.
3. ExpertiseEnforcer: max 2 retries, temperature decay −0,1/pokus.
4. 5D capability vector je `{reasoning, creativity, determinism, riskTolerance, verbosity}` 0–100.
5. QGv2 je deterministický a idempotentní — žádné LLM volání, žádné nové věty.
6. Patch engine: 3-tier anchor, atomický zápis, plný rollback při selhání.
7. Execution loop: max 8 iterací.
8. Specialista je soběstačný — žádný `import ../../src/` z balíčku, vše přes
   schválenou registrační hranici.
9. Model upgrade nikdy neupgraduje sám — discovery nemění konfiguraci.
10. Legacy listener nikdy neopustí loopback, dokud neexistuje oddělená ověřená hranice.
11. Každý významný externí nebo stav měnící efekt zůstává pod autoritou
    uživatele: má původ, omezený rozsah, odpovídající approval a auditní stopu.
12. Žádná tichá odchozí komunikace: background síť je opt-in; explicitní
    síťové schopnosti jsou mediované a auditované.
13. Učení samo nesmí rozšířit oprávnění, změnit kód nebo konfiguraci ani
    přenést projektová data přes hranici bez explicitního opt-inu.

---

## 3. Postup u schopnosti — hloubka až po důkazu

Proces nemá před implementací vyrobit stovky papírových záznamů. Pracuje ve
dvou hloubkách.

### Lehký obraz celého produktu

Pro každou ze 22 schopností stačí:

1. jedna věta „co uživatel udělá a co se stane";
2. nejvyšší dosažený stupeň důkazu podle §5;
3. případný příznak `BROKEN` a odkaz na pozorování.

Tím vznikne společný obraz a dependency DAG, nikoliv předstíraná detailní
znalost. Sedmidimenzionální inventura ani cílový redesign se pro schopnost,
která nebyla skutečně spuštěná, nevymýšlí.

### Hluboká práce ve schváleném Work Package

Schopnost se rozpracuje do hloubky teprve tehdy, když je na řadě podle DAG a
existuje runtime pozorování. Pak následuje:

1. **Spuštění a měření.** Nejdřív uživatelský scénář, prerekvizity, latence,
   data a efekty. Čtení kódu samo nestačí.
2. **Hluboká inventura.** Moduly, funkce, principy, konektory, data, efekty,
   hranice a případná učící smyčka. Výstup: zachovat / zlepšit / nahradit či
   vyřadit / rozhodnout.
3. **Schválené chování.** Operátor schválí pozorovatelné věty a případná
   rozhodnutí o scope před implementací.
4. **Malý vertikální přírůstek.** Implementace, focused pozitivní i negativní
   test a uživatelsky viditelná demonstrace nebo L3 číslo.
5. **Akceptace.** Důkaz z čerstvého klonu na pojmenovaném commitu a aktualizace
   mapy schopností.

Schopnosti na různých větvích mohou postupovat souběžně podle §6. Uvnitř jedné
schopnosti se uvedené pořadí nepřeskakuje.

---

## 4. Pravidlo chování

> Chování je krátká věta o tom, co musí platit **na hranici, kde to zažívá
> uživatel**. Modulový test je doplněk; není náhradou za request, UI nebo jiný
> skutečný vstup do produktu.

- seznam se tvoří až ze spuštěné reality a schvaluje jej operátor;
- každé schválené chování má pojmenovaný důkaz, který při rozbití zčervená;
- existující testy se nejdřív mapují, nepřepisují automaticky;
- chyba nalezená za provozu přidá regresní chování;
- preventivní bezpečnostní, recovery a datové chování smí vzniknout z threat
  modelu, i když k incidentu ještě nedošlo;
- test bez vazby na chování se nepočítá jako důkaz schopnosti;
- zlepšit / nahradit / vyřadit se plánuje až pro `RUNTIME_VERIFIED` schopnost.

Dobré:

> „Na `kolik je hodin?` přijde odpověď s aktuálním časem, bez volání modelu,
> do 100 ms přes skutečný chat request."

Špatné:

> „`decide()` volá `classifyDeterministic()` před LLM."

---

## 5. Stav schopnosti a výsledek běhu

Tyto dvě osy se nesmějí míchat.

### Žebřík ověření schopnosti

| Stav | Co je skutečně prokázáno |
|---|---|
| `EXISTS` | Kód a vstupní bod byly nalezeny; existuje jedna věta uživatelského chování. |
| `RUNTIME_VERIFIED` | Schopnost byla s reálnými prerekvizitami spuštěna a pozorována. |
| `USER_JOURNEY_VERIFIED` | Skutečný uživatelský scénář včetně relevantní negativní cesty prošel. |
| `ACCEPTED` / `PASS` | Všechna schválená chování prošla z čerstvého klonu na pojmenovaném commitu a operátor je přijal. |

`BROKEN` je samostatný příznak, ne pátá příčka. `DORMANT`, `DEAD`, `RETAIN`,
`IMPROVE`, `REPLACE`, `RETIRE` a `DEFER` jsou disposition, nikoliv důkaz.

### Výsledek konkrétního testu nebo běhu

- **PASS** — ověřované tvrzení v daném prostředí prošlo.
- **FAIL** — tvrzení neplatí; nesnižuje se na „většinou funguje".
- **BLOCKED** — běh narazil na konkrétní deklarovanou prerekvizitu; není zelený.
- **NOT RUN / NAPSÁNO** — běh neproběhl; je slabší než `BLOCKED` a není důkaz.

Prerekvizity se deklarují. Registry metadata jsou ale pouze deklarace: u
offline, bezpečnostních a efektových claimů se podle rizika přidává empirická
izolace nebo negativní kontrola.

---

## 6. Závislosti, Work Packages a paralelní práce

Pořadí neurčuje lineární seznam, ale dependency DAG v `ROADMAP.md`. Sériová je
integrační páteř a změna jednoho connectoru; nezávislé větve se smějí řešit
paralelně.

### Work Package je jednotka zapisující práce

Každý WP má pouze:

- uživatelský výsledek a rozsah;
- vlastněné cesty a connector;
- vstupní revision a závislosti;
- demonstraci, pozitivní a negativní test;
- stop condition a přesný ověřovací příkaz.

Další board, registr ani evidence framework se pro běžný WP nezakládá. Stav se
udržuje v roadmapě a příslušné inventuře.

### Kdy může práce běžet souběžně

Paralelní zapisující WP jsou povolené, pouze když:

1. nemají nevyřešenou dependency edge;
2. mají disjunktní zapisované cesty;
3. nemění tentýž connector ani jeho sémantiku;
4. mají jasný způsob předání a integrační pořadí;
5. modelové/GPU běhy se na jedné RTX 3090 spouštějí sériově;
6. každý má vlastní branch a vlastní checkout.

Connector mění jediný vlastník. Konzumenti pracují proti připnuté verzi a po
změně musí znovu projít boundary testy. Doporučený strop jsou tři paralelní
zapisující WP; read-only průzkum může běžet vedle nich.

#### Vlastnictví má dvě úrovně

Vlastnictví se určuje zvlášť pro projekt a zvlášť pro checkout:

- **Projekt:** nejvýše tři zapisující WP, každý s explicitně přidělenými
  cestami a connectorem;
- **Checkout:** právě jeden zapisující vlastník v jednom worktree, vždy.

Dvě větve v jednom checkoutu nejsou paralelní práce, jen střídání v čase.
Skutečně souběžný WP je ta výslovná potřeba, která opravňuje vznik dalšího
worktree. Ten je efemérní: vzniká po explicitním schválení, žije jen po dobu
svého WP a po integraci se odstraní.

#### Sdílený checkout jen pro prokazatelně read-only běhy

Souběžné operace smějí sdílet checkout pouze tehdy, jsou-li prokazatelně
filesystem-read-only. Jakýkoli běh, který vytváří artefakty, cache, DB,
generovaný dokument nebo jiný stav, používá vlastní checkout nebo explicitně
izolovaný externí artifact root.

Není to preventivní opatrnost. Sdílený worktree už jednou vyvolal dirty-tree
race a zneplatnil jinak platný report na shodném SHA — viz `ROADMAP.md` §4,
„Aktuální evidence“. Efemérní worktree se zakládá na disku, ne v `/tmp`; ten je
na referenčním stroji tmpfs.

#### Rozpočet pracovní plochy

Efemérní worktree z předchozí sekce má měřitelný konec a rozpočet. Cílem není
omezit, kolik práce smí běžet — to řeší strop paralelních WP výše. Cílem je,
aby po dokončené práci nezůstávala pracovní plocha, kterou nikdo neuklidí.
Samotná věta „po integraci se odstraní" se ukázala jako nevymahatelná — viz níže.

- **Rozpočet se počítá z živých worktreeů.** Živý je ten, jehož commity ještě
  nenese jiná živá větev; absorbovaný se do rozpočtu nepočítá, protože už jen
  zabírá místo. Orientační rozpočet jsou tři živé worktree vedle hlavního
  checkoutu, shodně se stropem paralelních zapisujících WP.
- **Úklid se vynucuje růstem, ne zákazem.** Před založením nového worktree se
  odstraní všechny bezpečně odstranitelné absorbované checkouty. Dirty,
  používaný nebo důkaz obsahující checkout se nejprve vypořádá; nesmí být
  ztracen ani odstraněn silou. Potřeba dalšího worktree práci neblokuje, ale
  odložený úklid musí mít pojmenovaný důvod.
- **Default je větev, ne worktree.** Práce, která na jiný WP navazuje v čase,
  se dělá přepnutím větve v existujícím checkoutu. Nový worktree opravňuje jen
  prokazatelně souběžný zapisující WP podle podmínek výše. Dvě větve v jednom
  checkoutu nejsou paralelní práce — a právě proto pro ně nový worktree není.
- **Konec worktree je měřitelný.** Worktree se odstraní, jakmile jiná živá
  větev obsahuje jeho commity celé
  (`git merge-base --is-ancestor <větev> <jiná>`). Merge do `main` tou podmínkou
  **není**: `main` se v tomhle projektu jako integrační cíl nepoužívá, takže
  vázat na ni úklid znamená neuklízet nikdy. Odstraňuje se worktree, ne větev;
  commity, důkazy ani historie tím nemizí.
- **Sandbox je vstup běhu, ne jeho důkaz.** Adresáře `runtime/`, `home/`,
  `repo/` a `node_modules/` pod `.intentsmith-artifacts/` jsou jednorázové.
  Drží se nejvýše sada z nejnovějšího běhu na worktree; starší se po dokončení
  běhu mažou. `report.json`, `checkpoint.json`, `inventory.json` a `logs/` leží
  vedle nich, jsou o tři řády menší a nemažou se nikdy. Sandbox, který tyto
  důkazy sám obsahuje, je chráněný a automatický úklid ho přeskočí. Plošné
  smazání `.intentsmith-artifacts` je zakázané.

Stav pracovní plochy vypisuje [`scripts/workspace-budget.sh`](scripts/workspace-budget.sh):
`report` označí bezpečně odstranitelný worktree a zvlášť pojmenuje dirty,
používané, detached nebo evidence-bearing překážky; `clean --yes` smaže pouze
starší jednorázové sandboxy a důkazy nechá. Skript je nástroj, ne autorita —
pravidlo platí i tam, kde ho nikdo nespustil.

**Proč to tu je.** Pravidlo o efemérním worktree platilo od verze 4 a přesto
byl 2026-08-28 filesystém referenčního stroje podruhé zaplněný na 100 %
(3,1 MB volných z 477 G). Naměřeno: 26 worktreeů, z toho 13 s větví už plně
obsaženou v jiné živé větvi, a 99 GB jednorázových sandboxů proti ~130 MB
důkazů. Chyběl strop a operační definice konce; obojí doplňuje tato sekce.

#### Měřený dokument patří integračnímu SHA

Sériové mergování samo neopravuje význam měřených dokumentů. Větev změří
baseline na svém SHA a po spojení už popisuje jiný strom, i když textový merge
proběhl čistě. Proto:

- WP zapisuje vlastní report do unikátní cesty a s přesným source SHA;
- `ROADMAP.md`, `SYSTEM-MAP.md`, generovaný `docs/convergence/TEST-REGISTRY.md`
  a souhrnný stav aktualizuje integrační vlastník na merge SHA;
- evidence tvoří DAG, ne jeden přepsaný výsledek: focused důkaz na větvi,
  integrační důkaz na merge commitu. Merge commit je proto preferovaný před
  squashem; rebase nebo cherry-pick po vydání evidence vytvoří nové SHA a důkaz
  se musí přivázat znovu.

Rozsah důkazu podle úrovně: větev focused pozitivní a negativní test; merge
commit dotčené boundary/integration testy obou WP; milestone fresh-clone
journey na pojmenovaném SHA; release celý required Gate 0 řetěz podle §8. Běžný
merge nespouští celý release řetěz — Gate 0 platí u releasu, ne při vývoji.

#### Řízená výjimka: `tests/registry.json`

Registry je jediný soubor, který paralelní WP nutně sdílejí: validátor odmítá
každý runnable test, který v něm není, a současně vyžaduje aktuální generovaný
dokument. Branch-local zelená evidence tedy bez zápisu do registru neexistuje.
Vlastnictví je zde na úrovni `suites/<id>`:

- paralelní WP smí pouze **přidávat** nové záznamy s předem rezervovaným
  unikátním `suite.id` a `path`;
- nesmí měnit schéma, `exclusions` ani existující záznam;
- záznam píše větev, ne integrátor — jinak commit odkazuje na test, který
  v okamžiku vydání evidence není registrovaný;
- integrátor při merge provede sjednocení záznamů, generovaný
  `TEST-REGISTRY.md` vždy zahodí ve prospěch regenerace z výsledného registru
  a spustí validátor.

Validátor už hlídá duplicitní `id` i `path`, takže ztracený nebo zdvojený
záznam merge gate zachytí. Rozdělení registru na fragmenty je pozdější
optimalizace, ne podmínka paralelismu.

### Rozsah 1.0

Specialisté a agenti nejsou mimo produkt: 1.0 musí dodat jejich platformu a
jeden skutečný E2E scénář každého typu. Notifikace, marketplace, media a
upgrade automatika vstupují do práce podle závislosti konkrétního user journey,
nikoliv jen podle adresáře. Setup wizard, OpenCode a Serena nejsou kritická
cesta 1.0. Přesný rozsah a milníky určuje `PRODUCT.md` a `ROADMAP.md`.

---

## 7. Kontrakt pro agenta

Agent řídí větev. Operátor řídí projekt a určuje tento kontrakt.

**Agent smí bez ptaní:**
- provést read-only průzkum schopnosti nebo connectoru potřebný pro aktivní WP;
- implementovat malý přírůstek uvnitř schváleného WP a jeho vlastněných cest;
- opravit chybu, která shodila L1;
- doplnit chování jako regresi po nalezené chybě.

**Agent si musí vyžádat souhlas:**
- produktovou disposition zachovat / nahradit / vyřadit, pokud nebyla
  schválená v aktivním WP;
- seznam uživatelských chování a veřejný connector před implementací;
- změnu dependency DAG nebo rozsahu release;
- výměnu jakékoli části za open source;
- cokoli, co mění L0.

**Agent nesmí:**
- zahájit hlubokou implementaci bez runtime pozorování a vymezeného WP;
- zapisovat souběžně do cizích cest nebo měnit connector vlastněný jiným WP;
- zapsat nedokončenou schopnost jako hotovou;
- založit dokument, který nemá adresáta a důvod;
- snížit, přeskočit nebo umlčet test kvůli zelené;
- spouštět attestační řetěz jako součást běžného vývoje.

**Každý dokončený WP má demonstrovatelný výsledek** — je vidět v UI,
uživatelském journey nebo v čísle z L3. Jednotlivý prerequisite commit může
zavést connector contract, boundary test, migraci, packaging/recovery krok,
authority dokument nebo bezpečnostní opravu; musí ale být nezbytný pro
pojmenovaný WP, focused ověřený a nesmí se vydávat za dokončený produktový
výsledek sám o sobě.

---

## 8. Gate 0 platí u releasu, ne při vývoji

> **Rozhodnutí operátora, 2026-08-02.** Tohle je ta věta, na které stojí celý
> zbytek kapitoly: **Gate 0 se uplatňuje výhradně při releasu. Během vývoje
> neplatí.** Ne „uplatňuje se mírněji", ne „uplatňuje se u důležitých změn" —
> **neplatí.**

### Proč to bylo nutné vyslovit

Gate 0 má pravidlo *„jakákoli změna stromu ruší kandidátní verdikt"*. To je
správné pro certifikaci releasu a **fatální pro vývoj**, protože znamená, že
nelze zároveň vyvíjet a být certifikovaný. Proces tím **trestá produktovou
práci a odměňuje práci na aparátu.**

Změřeno na vlastní historii (`DIRECTION.md` §0): 177 commitů za 4 dny a poměr
aparátu k produktu zhruba **5 : 1**. Aparát fungoval — jen měřil prázdný pokoj.

### Co z toho konkrétně plyne

| Dosud | Nově |
|---|---|
| Gate 0 attestace u každé změny | **Attestace jen u releasu.** Denní režim = L1 zelená |
| „Jakákoli změna stromu ruší kandidáta" jako provozní režim | **Platí výhradně pro release kandidáta.** Při vývoji se kandidát neřeší |
| Attestační řetěz `C→E→R→A` ve smyčce | Spouští se **při releasu**, ne jako součást běžné práce |
| Fingerprint registru zapečetěný v Gate 0 policy | **Rozchod s ním při vývoji není vada.** `nightly-orchestrator-self-test` proto padá očekávaně; obnovení řetězce je release práce |
| Gate 1 jako 30 nezávislých důkazních řízení | Schopnosti podle §6, v pořadí daném závislostmi |
| Evidence generovaná devítifázovým producerem | Producer zůstává pro release; vývoj běží na L1 |
| `AGENTS.md` jako vlastní pravidla vývoje | Tento dokument. `AGENTS.md` a `CLAUDE.md` jsou shodné vstupní ukazatele |

### Co Gate 0 naopak zůstává

Ruší se **ceremonie, ne výstup.** Inventář — registr testových programů, matice
schopností, disposition, registr rizik — je živý majetek a mapa projektu, kterou
C3 nikdy nemělo. Udržuje se dál.

**Test, jestli je pravidlo aplikované správně:** brzdí mě právě teď Gate 0
v produktové práci? Pokud ano, aplikuju ho špatně.

---

## 9. Odložená rozhodnutí

### Bezpečnost a credentials — před release, ne jako odbočka od základu

**Rozhodnutí operátora, 2026-08-01.** Bezpečnost, credentials a privacy incident
`P-001`..`P-003` se řeší **až budou základní věci odladěné**. Nezastavují M0–M4,
ale jsou tvrdou podmínkou production-ready milníku M5 a release M6.

Zůstávají v evidenci, aby se na ně nezapomnělo:

- `P-001`..`P-003` — privátní materiál je v současném stromu kontejnovaný,
  v git historii zůstává dosažitelný. Rotace credentialů a rozhodnutí o historii
  vyžadují akci operátora, dokud se to neudělá, expozice trvá;
- `G0-R018` — legacy listener zůstává na loopbacku, což je invariant L0-10.
  Dokud platí, není z toho aktivní riziko;
- nezapojený `validateApiToken()` a chybějící globální auth guard patří do téhož
  balíku a řeší se s ním.

Nic z toho nebrání lokální produktové práci v M0–M4, dokud drží loopback. Nic z
toho se nesmí přenést jako otevřený blocker přes M5.

### Rozhodnuto po vydání verze 2

- **Legacy web UI `/architect`** — disposition **legacy**, potvrzeno operátorem
  2026-08-21. Není cílové UI ani fallback, neudržuje se a nevstupuje do release
  matice. Odstranění kódu zůstává samostatné pozdější rozhodnutí.
- **L0-8 specialist boundary** — přijata varianta A, **strict injection**.
  Rozhodnutí [`docs/decisions/019`](docs/decisions/019-l0-8-specialist-boundary.md),
  přijato operátorem 2026-08-09, potvrzeno 2026-08-21. Implementace zatím
  neproběhla; nese ji `WP-M3-L0-8-INJECTION`, vynucení hranice
  `WP-M3-L0-8-ENFORCEMENT`. Otevřené zůstávají `L8-3` (bajtově duplicitní
  nástroje) a `L8-4` (core kopie `src/expertises/tools/**` bez konzumenta) —
  rozhodnutí 019 je výslovně neřeší.

### Zbývá rozhodnout

- **Rozdělení #6** (chat pipeline) — vyplyne z hluboké runtime inventury.
- **#18b upgrade automatika** — background síť je vypnutá; zůstává rozhodnout
  dlouhodobé retain/defer/retire.

---

## 10. Protokol implementačního agenta

**Rozhodnutí operátora, 2026-08-21.** Způsob práce agenta v repozitáři upravuje
[`docs/development/agent-protocol.md`](docs/development/agent-protocol.md). Ten
dokument je **podřízený tomuto** — je jeho kapitolou vynesenou do samostatného
souboru, ne druhou autoritou vedle něj. Je psaný anglicky, což je vědomá výjimka
z jazyka zbytku korpusu.

### Proč vznikl

Dlouhý autonomní běh selhal tím, že vyráběl dokumenty a testy, které pak
ospravedlňovaly další dokumenty a testy, aniž pohnul jakýmkoli akceptačním
kritériem. Je to stejná nemoc, kterou měří `DIRECTION.md` §0 poměrem aparátu
k produktu 5 : 1 — jen na úrovni jednoho běhu místo čtyř dnů.

### Co z něj platí závazně

- **Co agent v běhu vytvoří, není autorita.** Plán, návrhová poznámka, report,
  nový test ani odvozené kritérium nezakládají požadavek. Smějí ho vysvětlit,
  implementovat nebo ověřit. Autoritou se stanou až přijatým rozhodnutím
  v `docs/decisions/`, zápisem do `ROADMAP.md` / `SYSTEM-MAP.md`, nebo souhlasem
  operátora.
- **Stop podmínka.** Jakmile je soubor vzniklý v tomto běhu citován jako zdroj
  požadavku, práce se zastaví a vrátí k poslednímu nezávisle autoritativnímu
  požadavku. Artefakty se nemažou; přestanou být autoritou.
- **Vstup do běhu.** Před první změnou musí agent pojmenovat konkrétní
  autoritativní položku, kterou běh posouvá. Když ji pojmenovat nelze, ptá se.
  Nezahajuje práci proto, aby zjistil, co ta práce je — to už zakazuje §7.
- **Pokrok je pohyb existujícího požadavku k akceptaci.** Commity, testy,
  dokumenty a spotřebované tokeny samy o sobě pokrok nejsou. Test a dokumentace,
  které vyžaduje tento kontrakt nebo akceptační podmínka aktivního WP, pokrok
  jsou — omezení míří jen na to, co vzniká **nad** požadavek.
- **Watchdog jde do handoffu, ne do souboru.** Watchdog, který vyrábí dokumenty,
  je přesně ta vada, které má bránit.
- **Test registrovaný v `tests/registry.json` nebo vázaný na akceptační podmínku
  aktivního WP nesmí agent přeznačit na vadný nebo zastaralý.** To je eskalace,
  ne rozhodnutí agenta. Navazuje na zákaz v §7.

### Vztah ke Gate 0

Protokol **nevrací Gate 0 do běžného vývoje**. Slovem *gate* se v něm myslí
akceptační podmínka aktivního Work Package a zelená `L1`, nikdy attestační
řetěz `C→E→R→A`. Platí §8 beze změny, včetně toho, že
`nightly-orchestrator-self-test` a rozchod s zapečetěným fingerprintem registru
jsou při vývoji **očekávaný stav, ne vada**.

### Přednost

Pořadí je vypsané v `agent-protocol.md` §0. Shrnutí: `L0` invarianty
a `docs/security/` → přijatá rozhodnutí `docs/decisions/` → zbytek tohoto
dokumentu → `PRODUCT.md` / `DIRECTION.md` / `ROADMAP.md` / zadání aktivního WP →
protokol → cokoli z běhu. Kde by protokol vypadal, že dovoluje vynechat něco,
co vyžaduje vyšší položka, platí vyšší položka a protokol je čten špatně.

---

## 11. Autonomní režim — práce po milnících

**Rozhodnutí operátora, 2026-08-21.** Agent pracuje **po milnících**, ne po
krocích. Operátor kontroluje výsledek milníku, ne jednotlivá rozhodnutí uvnitř
něj. Tohle je úprava eskalačního prahu z `§10` a
[`agent-protocol.md §11`](docs/development/agent-protocol.md), ne jeho zrušení.

### Co agent uvnitř milníku rozhoduje sám

Všechno, co jde vyřešit z existujících požadavků, architektury, přijatých
rozhodnutí, testů a evidence. Volbu postupu, pořadí uvnitř dávky, tvar opravy,
rebaseline s revidovanými hranami, úpravu testu, který kódoval vadu, i to, že
nalezenou vadu **zapíše a neopraví**. Rozhodnutí patří do commit message, ne do
otázky na operátora.

### Co ho zastaví i uprostřed milníku

Krátký a uzavřený seznam. Mimo něj se neptá:

1. změna `L0` invariantu nebo bezpečnostní či autoritní hranice;
2. změna zamýšleného produktového chování nebo rozsahu 1.0;
3. oslabení přijatého akceptačního kritéria; přeznačení testu vázaného na
   akceptaci nebo registrovaného v `tests/registry.json` na vadný;
4. destruktivní nebo těžko vratná akce;
5. rozhodnutí, které patří do `docs/decisions/` a není udělané;
6. **prostředí práci nedovolí** — zamítnuté oprávnění, chybějící toolchain,
   nedostupný hardware. Tohle není rozhodnutí operátora o produktu, ale
   překážka, kterou agent sám odstranit nemůže.

Dvě po sobě jdoucí kola bez pohybu k akceptaci znamenají zadrhnutou strategii —
agent zastaví a ohlásí, i uprostřed milníku (`agent-protocol.md §8`).

### Co se hlásí na konci milníku

Handoff podle [`agent-protocol.md §14`](docs/development/agent-protocol.md):
posunuté požadavky, stav akceptace před a teď, odstraněné a zbylé blockery,
zavlečené nebo nalezené regrese, rozhodnutí, která operátor skutečně musí
udělat, a další nejcennější spustitelný krok. Ne počty commitů a testů.

### Podle čeho se milníky berou

`ROADMAP.md §13` — závazná Gate 1 fronta. Sedmá položka, autorizovaný GPU
pilot, je z autonomního režimu **vyňatá**: roadmapa u ní říká „jen na akci
operátora" a tohle rozhodnutí to nemění. Vedle fronty drží vlastní frontu
sekce „Otevřené release-blocking vady" v `SYSTEM-MAP.md`; hygiena `L1` má
přednost před další položkou fronty, protože červená povinná sada znehodnocuje
přejímku všeho ostatního.
