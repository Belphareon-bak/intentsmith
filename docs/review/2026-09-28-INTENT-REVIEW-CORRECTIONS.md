# IntentSmith — opravy po CHANGES_REQUIRED

**CHANGES_REQUIRED / NOT_DEPLOYED — historické předání.** Původní kandidát `f167cf98` i následné opravy v tomto předání byly operátorskou revizí odmítnuty. Nové nálezy jsou opravené v [druhém kole předání k revizi](2026-09-28-INTENT-REVIEW-ROUND2.md); jeho přijetí zůstává otevřené. Níže jsou zachované důkazy tehdejšího kandidáta.

Čistý ověřovaný kandidát: `1e5a9e35533a0fe4e9ab825085defd617735a0c9`. Hlavní oprava: `32d2e98f`; samostatná strukturální baseline: `ebf1cff2`; následná korekce úplných poděkování a pořadí kontroly write authority: `1e5a9e35`. Rozsah opravy: `464793f1..1e5a9e35`. Větev/worktree: `work/intent-resilience-20260928`, `/home/belphareon/Projects/intentsmith-intent-resilience-20260928`. Autorita: konkrétní operátorské nálezy 1–6 v této session, [vymezení práce](../wp/WP-INTENT-REVIEW-FIXES-20260928.md). Žádný merge, push, nasazení ani zápis do živé DB.

## 1. Dispozice nálezů

| Nález | Oprava a důkaz |
| --- | --- |
| 1: GPU / poděkování / nesprávné information | `assessGpuIntent` běží v `inspectRequest` před jakýmkoli klasifikátorem. Zachovává spodní deterministickou GPU pojistku. „Díky moc, a teď sniž napětí GPU na polovinu“ vrací `gpu_quantity_ambiguous` bez modelu. Pojistka se nezamění za obecné ověření významu. `isGratitudeOrFarewell` i exportované vzory přijímají celé běžné poděkování; smíšená zpráva jde přes kontrolu. HTTP test ověřuje otázku, obecné ano a explicitní příkon; poslední krok vrací pravdivé `gpu_control_unavailable`, bez handleru či inference. |
| 2: zákaz a citace uvnitř slova | Citace mají přesné offsety a Unicode hranice slov. „zapisuj“ uvnitř „Nezapisuj“ není citace. Produktivní české `ne-` na začátku věty/klauze nebo v citovaném akčním slovese nevyžaduje seznam slovesných kmenů. Doplněno `n't`, typografický apostrof a `dont`. Zákaz se kontroluje i při `information`. Šest dodaných negativních příkladů zastaví controller před syntézou a nástroj před brokerem. |
| 3: informační soubor / výpis projektu | Core lexer doplní doslovné file targets i pro informační interpretaci; prompt jejich slot výslovně vyžaduje. Ověřená klasifikace má přednost před starými konverzačními fast paths. Přes `inspectRequest -> decide -> handleFileDecision -> ToolExecutor` prochází `Vysvětli mi src/app.js`, varianta s tečkou a „…“ uvozovkami až ke stávající read approval hranici. `detectProjectFileIntent` sdílí controller preflight a skutečný project handler; „Co za soubory je v tomto projektu?“ už má stejnou vazbu `file.list / .` v obou místech. |
| 4: skutečné parametry nástrojů | Kontrola zná skutečné M2 klíče uvedené níže; nepodložený klíč, chybějící vazba a změněný údaj se odmítají. `Spusť ls` má core vazbu na přesně extrahovaný příkaz a jazyk; `rm -rf ~` i změna jazyka končí před brokerem. Testy vedou změněné content/code/language/query/url/database a port/jednotku/adresu v query přes skutečný ToolExecutor. Platné literal/core bindingy projdou k původní autoritě. Celá promítnutá dávka se vytvoří, zkopíruje a zkontroluje před první operací; nepodložené SQL druhého nástroje zastaví i první platné hledání. |
| 5: kolize modelových jmen slotů | Upřesnění ukládá jeden přesný úsek zdroje, roli a index slotu; jméno není výjimka. Ambiguita se stejnými jmény více slotů žádný úsek nevyjme. Úsek obsahující zákaz se nevyjme ani při chybné roli. Zákaz má přednost i před konfliktní alternativou. Reprodukce „Nemaž notes.md“ se shodnými jmény a následnou volbou zákaz zachová. |
| 6: interpunkce / opakované použití | Lexer odděluje tečku a české uvozovky od názvu souboru; URL a email nevydává za soubor. Cache CRE se použije jen při `candidate.source === input`. Stará `intentSourceText` už podmínku neobchází; jiný vstup vyvolá novou kontrolu. Conversation handler nepřidává projektový hint k již ověřenému shodnému vstupu; projekt je dál v contextu. Test ověřuje jednu klasifikaci a history-bound zápis čekající na schválení. |

Praktická změna: názvy souborů, velikost písmen, čísla a jednotky se nepřepisují kvůli překlepu. Typo `ulzo` je možné klasifikovat při zachování původního slova. Pokud má být opraven i materiální údaj, systém vyžádá konkrétní volbu.

## 2. Co přesně kontrola nástrojů znamená

| Tool | Kontrolované vstupy / dovolený původ |
| --- | --- |
| `file.read` | `path`: citovaný target nebo deterministický parser explicitního čtení |
| `file.list` | `path`: core `.` pro rozpoznaný výpis aktivního projektu |
| `file.write` | `path`: citovaný target; `content`: přesný citát nebo snapshot poslední skutečné assistant odpovědi z core historie |
| `code.execute` | `code`: core extrakce příkazu pro SHELL, jinak doslovný value slot; `language`: stejná core vazba / citát / nezadané `null` |
| `database.query` | `query`: doslovný value slot; `database`: doslovný target nebo nezadané `null` |
| `web.search` | `query`: původní požadavek, citovaný value/scope nebo deterministický sanitizer+canonicalizer, který zachová rozpoznané materiální citace |
| `web.scrape` | `url`: doslovný target; `query`: původní požadavek nebo citovaný value/scope; `maxLength`: core default 10 000 nebo citovaná celočíselná hodnota |
| `local.date/calendar/math` | `query`: původní požadavek, vazba vydaná core lokálním parserem |

Token nikdy sám neschvaluje efekt. Existující M2 approval, capability, sandbox a výsledková autorita zůstávají povinné. `code.execute` a `database.query` mají v současném registru `authorityMode: UNAVAILABLE`; spy testy dokazují předání/nepředání k brokeru, nikoli aktivaci provádění.

**Oprava původního claimu:** na `f167cf98` se před první operací kontrolovala dávka, ale z reálných materiálních M2 polí se ověřoval jen `path`. Tvrzení o kontrole všech parametrů bylo nesprávné. V nynějším kandidátu se ověřují přesné výše uvedené vazby skutečných polí; kód nekontroluje obecnou správnost významu libovolného generovaného programu, SQL či obsahu. Nepodložená generovaná hodnota se na chatové cestě odmítne, místo aby byla považována za ověřenou. Přímí typovaní volající bez chatového tokenu dál podléhají vlastním M2 kontraktům.

## 3. Modelový limit a neprovedená měření

Zachycení skutečného request body přes `inspectRequest -> cre-bridge -> gateway -> řízený fetch` potvrzuje **`think: false`**. Gateway to nastavovala již před touto opravou. Klasifikátor sice žádal 768 tokenů, ale oprávnění `WORKFLOW_CLASSIFIER` omezovalo skutečné `num_predict` na **500**. Kód nyní uvádí skutečných 500; role/ceiling ani veřejný modelový kontrakt se tím nezvýšil. Případné zvýšení je samostatná změna oprávnění.

**NOT_RUN:** skutečná přesnost klasifikátoru, počet falešných otázek, truncační četnost a latence na živém modelu. Ošetření `length`/empty/provider error je testované řízenými odpověďmi a dál končí typovanou terminální chybou. Žádný tichý přechod z neověřené klasifikace na vykonatelnou akci.

Rozpoznání produktivního `ne-` je konzervativní jazyková heuristika, nikoli úplný český parser. Může se ptát navíc. Semantická klasifikace obecných akcí nadále závisí na modelu; nezávislá GPU pojistka chrání svůj explicitní rozsah. Korpus překlepů a nesmyslných zadání je nutný pro další rozhodnutí o nasazení. Tento balík neslibuje univerzální porozumění ani libovolné automatické opravy.

## 4. Incident 08:23–08:24: zjištěný překryv

Read-only z existujících receipts a journalu, bez úpravy cizího běhu:

- V provider run **`run-Jh4DmO`** (`05:41:00.869–06:23:19.807 UTC`) běžel screening judge panelu s plan SHA-256 `18a76e45bdcb4e3c7ed69075be18835dc4b11a125e5d39189df92e08577512ea`.
- Právě běžící úloha: **D2 / d2_model_cleanup**, case `0f3e79b2d277c1e9766a8824`, forward, judge **qwen3.8:latest**, exact artifact SHA-256 `22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`, provider `0.34.2-intentsmith.1`.
- Trial receipt: **08:22:57.776–08:23:17.829 Europe/Prague**. Resource receipt v 08:23:17.789: RAM available **3 100 053 504 B**, minimum **4 294 967 296 B**; `HUNT_MEMORY_RESERVE_LOW`. Provider skončil BLOCKED.
- Archiv `infrastructure-interruption-02/interruption.json` má **`EXCLUDED_INFRASTRUCTURE_ATTEMPT`**, `decisionAuthority:false`, důvod „HUNT_MEMORY_RESERVE_LOW with foreign primary Ollama model starting during the owned trial“. Právě tento pokus je tedy vyřazený, nikoli platný posudek.
- Journal původního incidentu potvrzuje start primárního runneru od 08:23:10 a chat requesty do 08:24:33. Časový překryv je **CONFIRMED**. Samotná časová shoda nedokazuje výlučnou příčinu poklesu RAM ani dopad na všechny okolní receipts. Nelze tvrdit nulový zásah do hodnocení.

Vlastní metadata snapshot bez textů hodnotících zpráv: `.intentsmith-artifacts/intent-baseline/review-incident-overlap.json`; obsahuje cesty a SHA-256 přečtených originálů. SHA-256 snapshotu: `7e4d8e58a568bf27c57af561196cfa30636afacf715f6fd434155cc6807991e8`. Originály jsou v `/mnt/vi7000/intentsmith/evidence/hunt-local-judges-20260928/infrastructure-interruption-02/`. Dosavadní journal evidence a neúspěšný audit zůstávají zachované.

## 5. Ověření a předání

Závěrečný audit **`2026-09-28T07-55-39-152Z`** na čistém **`1e5a9e35533a0fe4e9ab825085defd617735a0c9`** (Node 24.21.0): **373 PASS / 12 FAIL / 13 BLOCKED / 0 TIMEOUT**, exit 1, celkový gate **FAIL**. SHA-256 reportu: `c90934c18a3bea2e81f48a6e9f4753ba658ebe08cffbbe9317e8f41a1c87efa7`. Přesná shoda ne-PASS paths/stavů/blockerů s původním auditem `2026-09-28T06-29-01-063Z` je `true`, ověřená v `.intentsmith-artifacts/intent-baseline/review-nonpass-comparison.json`. Jedenáct FAIL jsou chybějící IDE dependency instalace, jeden historická Gate 0 registry pečeť; třináct BLOCKED jsou nezavázané testové toolchain prerequisites. [Přesný historický seznam](2026-09-28-INTENT-GROUNDING.md#zachované-ne-pass) se nezměnil.

Všechny podprocesy auditu dědily síťový namespace z `bwrap --unshare-net`. Sonda v něm potvrdila funkční vlastní HTTP loopback a `ECONNREFUSED` pro sdílenou Ollamu. První pokus o start auditu bez `--dev-bind /dev /dev` skončil před testy na nefunkčním `/dev/null`; nic nebylo označeno za PASS. Opravený příkaz níže nevyžaduje změnu audit runneru ani spoléhání na rodičovský `OLLAMA_URL`.

Na stejném čistém `1e5a9e35` prošel samostatný skutečný M1 HTTP journey (otázka, generické ano, explicitní volba, původní GPU incident i prefix „Díky moc…“): `.intentsmith-artifacts/intent-baseline/review-final-http-1e5a9e35.log`. Cílené důkazy v plném auditu: intent core PASS; M1 chat **33/33**, M2 production consumer **22/22**, M2 file consumer **39/39**, project context **15/15**, privacy **11/11**, WS **91/91**, CRE build **35/35**, file reference **9/9**, CRE capability **26/26**, Quality Sprint **125/125**, module boundary **13/13** PASS. Skutečný model se nevolal.

Registry validace: **565 programů**, fingerprint `508b5333c57dd59a96af282efc3ea46aec7f3635201ca943a7f22bbd08aff0a1`. Module ratchet: **1458 hran / 3 cykly / 28 členů**, přidána jediná explicitní hrana `file.js -> intent-clarity.js`; její baseline je připnutý k `32d2e98f`. Source census: **675 src JS / 231 827 řádků; 561 tests JS / 254 930 řádků**. `git diff --check`: PASS. Hlavní checkout byl při závěrečné read-only kontrole stále na `832db06f`, s cizími/UNKNOWN dirty `AGENTS.md`, `CLAUDE.md`, `CONTRACT.md`, `docs/development/agent-protocol.md`; zůstaly zachované.

Reprodukovat závěrečný deterministický profil:

```sh
bwrap --bind / / --dev-bind /dev /dev --unshare-net --die-with-parent --new-session node scripts/nightly-audit.js --profile=offline,database
```

První izolovaný audit `2026-09-28T07-48-23-750Z` na čistém `ebf1cff2`: **371 PASS / 14 FAIL / 13 BLOCKED / 0 TIMEOUT**, exit 1. Dvě nové chyby byly opraveny, nikoli vyřazeny: C-15 nyní ověřuje write authority před výběrem obsahu; rozpoznání úplných poděkování znovu zahrnuje běžné anglické varianty. V `quality-sprint-q` zůstalo **125 testů**; pozitivní očekávání u dvou smíšených zpráv bylo na základě operátorova nálezu 1 změněno na negativní a původní vacuous combo assertion nyní skutečně ověřuje nepřítomnost bypassu. Registry profily, assertions o oprávnění a required příznaky nebyly oslabeny. Následně focused C-15 **26/26** a Quality Sprint **125/125** PASS. První red audit/report zůstává zachován.

Samostatné diagnostické spuštění model-profile `cre-guard-interactions` s úplně zablokovaným transportem: **27 PASS / 1 FAIL**, nikoli přijaté modelové měření. Selhal `non-explicit search + creativeLock -> CREATIVE` u „Kdo napsal Prokletý ostrov?“. Bez klasifikátoru dává CRE na původním `464793f1` i opravené linii totožně CONVERSATIONAL/ANSWER; bounded porovnání načetlo starý CRE blob se současnými runtime dependencies, není to čistý baseline celé sady. Výsledek i rozsah srovnání jsou zachované v `.intentsmith-artifacts/intent-baseline/review-baseline-guard.log`. Tímto WP se neřeší obecná kvalita výstupu reálného klasifikátoru ani jeho kreativní arbitráž.

Příkazy k revizi:

```sh
git diff 464793f1..1e5a9e35 -- src/chat src/executor tests
source /home/belphareon/.nvm/nvm.sh
nvm use 24.21.0
bwrap --bind / / --dev-bind /dev /dev --unshare-net --die-with-parent --new-session node tests/chat-intent-clarity.test.js
bwrap --bind / / --dev-bind /dev /dev --unshare-net --die-with-parent --new-session node tests/chat-intent-clarity-http.test.js
```

Další krok je nezávislá revize těchto oprav a samostatně vymezené měření reálného modelu. [Audit paměti a self-learningu](2026-09-28-MEMORY-SELF-LEARNING-AUDIT.md) je už samostatně předaný read-only snapshot na předchozí revizi `464793f1`; zjištěné mezery tímto balíkem neopravujeme.
