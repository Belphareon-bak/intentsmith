# Rozdělení pracovních rolí — aktuální podklad pro operátora

> **Aktualizace 29. 9.: níže je zachovaný historický stav před doplněním.** Aktuální panel všech deseti modelů je v [dokončení matice](2026-09-28-HUNT-MATRIX-COMPLETION.md) a v [procentní matici s celými odpověďmi](/mnt/vi7000/intentsmith/evidence/hunt-matrix-completion-20260928/matrix/comparison.html). Má 63 úplných výsledkových buněk, 3 částečné a 4 N/A. Jde o první skutečné posouzení; pokrytí druhým posudkem je uvedené zvlášť. Staré návrhy sestavy níže nejsou novým doporučením.

28. 9. 2026. **Pracovní doporučení, nikoli přijatá sestava. Žádné vazby změněny.**

Volba pracovních modelů nemusí čekat na automatické místní hodnotitele. Máme dva
oddělené externí posudky, které lze použít pro operátorský návrh a konkrétní kontrolu.
Nemáme však doložené optimum celé sestavy ani úplně přehodnocenou desetimodelovou matici všech rolí.

## Proč matice ještě není úplná — opravený audit pokrytí

**Téměř plná matice byla požadovaný výstup. Omezený výběr pozdějších běhů jej nenahradil.**
Předchozí verze tohoto dokumentu navíc příliš široce tvrdila, že starší podklady mají jiné zadání.
Kontrola skutečných požadavků ukázala: u všech sedmi ponechaných D/R případů jsou zadání,
parametry inference i verze poskytovatele stejné; změnila se hodnoticí rubrika.
Všech deset přesných modelových digestů je stále nainstalovaných.

| Role / část | Co skutečně existuje | Co chybí k úplnému srovnání |
|---|---|---|
| D1/D2/R1/R2, sedm ponechaných případů | Dva posudky pro 13 ze 40 buněk. Pro zbývajících 27 buněk je uloženo 567 pokusů; **554 úplných odpovědí je přímo použitelných k přehodnocení**. | Dva posudky podle sjednocené rubriky pro těch 27 buněk. Ve 21 buňkách je sběr už celý; v dalších šesti je dohromady 13 odpovědí ukončených výstupním limitem. |
| D/R, opravený `model_cleanup` | Samostatný nový profil a 24 úplných odpovědí dvou kotevních modelů, s dvěma posudky. | Doplnit ostatní modely ve stejném profilu; tento případ není součástí sedmipřípadových průměrů. |
| CHAT, opravená produkční historie | 80 dialogů dvou modelů, oba posudky úplné. Starší desetimodelový vícekolový panel existuje zvlášť. | Produkční sběr a dva posudky pro osm zbývajících modelů; starý panel běžel v jiných podmínkách. |
| CODE | Všech deset modelů má 21 uložených oprav a samostatné technické skóre. | Dokončit a přijmout celé orákulum; technická komponenta není celková známka. |
| VISION | **Všech šest podporovaných modelů má 23 úloh.** Nyní znovu přepočteno současným orákulem nad původními odpověďmi po kontrole vstupů a podmínek. | Nechybí buňky obsahového srovnání. Zbývá jeho přejímka a provozní kvalifikace. Čtyři další modely VISION nedeklarují. |

Třináct neúplných D/R pokusů: Ornith 11, Qwen3:14b 1 a Qwen3.5 1.
Nejsou skryté ani nahrazené nulou. Zvětšení limitu by vyžadovalo nový společný profil;
nelze jen jednomu modelu přidat rozpočet a výsledek přimíchat k ostatním.

[Audit každé uložené odpovědi, otisky zdrojů a přesné identity](/mnt/vi7000/intentsmith/evidence/hunt-role-allocation-20260928/matrix-coverage-audit.json) ·
[verzovaný souhrn pokrytí](evidence/2026-09-28-hunt-matrix-coverage.json) ·
[konkrétních 567 položek k dokončení D/R](/mnt/vi7000/intentsmith/evidence/hunt-role-allocation-20260928/dr-grading-backlog.json) ·
[reprodukce auditu](/mnt/vi7000/intentsmith/evidence/hunt-role-allocation-20260928/audit-matrix-coverage.py).
Seznam obsahuje identity, není to zaslepený formulář; neobsahuje nové ani simulované známky.
Kontrola ověřila všech 39 otisků zdrojů, 567 jedinečných ID nedokončeného D/R
hodnocení a každou z deseti technických CODE a šesti VISION hodnot v tabulce.
Jde o audit podkladů a deterministický replay, nikoli nový sběr či přejímku huntu.

## Matice model × role — doložené podklady po rolích

**Všechny hodnoty jsou v procentech. D1/D2/R1/R2/CHAT: Codex / Opus, dva samostatné posudky, nikoli jejich průměr.**
CODE a VISION mají odlišný druh důkazu uvedený pod tabulkou. Matice je přehled dostupných podkladů k 28. 9., ne úplné hodnocení všech buněk ani součet do celkového žebříčku. VISION nyní používá jeden společný původní panel šesti modelů přepočtený současným orákulem, ne výběr tří později měřených modelů.

| Model | D1 | D2 | CODE — technická část* | R1 | R2 | CHAT | VISION — orákulum |
|---|---:|---:|---:|---:|---:|---:|---:|
| qwen3.8:latest | 72,6 / 73,2 | 64,2 / 64,9 | 100,0* | 58,0 / 53,0 | 82,1 / 79,8 | 86,3 / 85,7 | 77,2 |
| qwen3.5:27b | 66,4 / 66,1 | A | 85,7* | A (část) | A | 84,2 / 79,1 | 88,6 |
| qwen3.6:27b | 69,3 / 66,4 | 69,2 / 62,2 | 85,7* | 53,9 / 51,2 | 73,8 / 70,2 | A / B | 83,0 |
| gemma4:26b | A | 58,9 / 52,7 | 85,7* | 45,0 / 37,5 | A | A / B | 75,7 |
| devstral-small-2:latest | A | A | 71,4* | 34,0 / 29,2 | 51,2 / 41,7 | A / B | 63,5 |
| ornith-1.5:9b | A (část) | A (část) | 61,9* | A (část) | A (část) | A (část) / B | 81,9 |
| qwen3-30b-a3b:latest | A | A | 42,9* | A | A | A / B | N/A |
| qwen3-coder:latest | A | A | 71,4* | A | A | A / B | N/A |
| qwen3:14b | A | A | 57,1* | A | A (část) | A / B | N/A |
| phi4:14b | A | A | 61,9* | A | A | A / B | N/A |

- **B** odkazuje na samostatný vícekolový CHAT panel níže.
- **A** znamená **starší hodnocení existuje**; jeho procenta jsou v samostatné matici A níže. U D/R chybí přehodnocení sjednocenou rubrikou, nikoli automaticky nový test. U CHAT jde i o jiná zadání a profil.
- **N/A** u VISION znamená chybějící deklarovanou podporu obrazu pro přesný instalovaný artefakt, ověřenou proti inventáři původního panelu a dnešnímu digestu. Není to známka nula.
- **D/R:** sedm stejných případů × tři opakování na buňku; starý vadný `model_cleanup` je vyřazen všem. Rozpad a reprodukční zdroje jsou níže.
- **CHAT:** pouze nový produkční sběr 27. 9. s opravenou historií, 40 dialogů na model. Původní desetimodelový panel se sem nemíchá.
- **\* CODE:** jen technická komponenta 21 uložených oprav každého z deseti modelů; plné skóre CODE zůstává `null`. Nejde o 100% úspěšnost v roli. Rozšíření sloupce zpřístupňuje již existující komponenty, nevytváří novou známku.
- **VISION:** deterministické obsahové skóre 23 úloh, nikoli dva LLM posudky. [Nový replay šesti modelů](/mnt/vi7000/intentsmith/evidence/hunt-role-allocation-20260928/vision-six-model-replay.json) kontroluje 414 původních odpovědí; celkem jde o 144 různých výstupů ve 138 dvojicích model/úloha. Opakování se nepovažují za nezávislé případy. Původní odpovědi a známky se nepřepisovaly, GPU inference neproběhla.

Celkem **31 zobrazených hodnotových buněk**: 13 D/R, 2 CHAT, 10 technických komponent CODE a 6 VISION; dalších 4 je N/A. To stále není 31 přijatých výsledků rolí. Zbývajících 35 buněk má staré známky, ale potřebuje sjednocené hodnocení (27 D/R) nebo nový produkční CHAT (8). Původní známky jsou přístupné přes A/B níže; nelze je přímo doplnit do novějších hodnoticích sloupců.

## A — existující výsledky původní celopanelové sady

**Sběr 20. 9., archivní přehled 23. 9. Všechna čísla v procentech.** Tyto známky existují a nesmějí zmizet z evidence jen proto, že pozdější sběr měl méně kandidátů. U D/R se změnila rubrika a vyřazuje se starý `model_cleanup`; u CHAT také zadání a profil. Přehled nahoře již přebírá technické komponenty CODE a ověřený replay VISION.
Původní podklad kombinuje přímé posouzení Codexem a mechanické kontroly; **nejde o dvojici úplných posudků Codex / Opus**. Obsahuje později zjištěné vady sad. Slouží k dohledání výsledků, nikoli k doplnění novějšího pořadí.

| Model | D1 | D2 | CODE původní† | CODE techn. replay* | R1 | R2 | CHAT | VISION |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| qwen3.8:latest | 62,0 | 58,3 | 100,0 | 100,0 | 54,2 | 71,9 | 80,7 | 77,2 |
| qwen3.5:27b | 63,5 | 67,7 | 84,1 | 85,7 | 41,4 (část) | 72,9 | 85,4 | 88,6 |
| qwen3.6:27b | 59,1 | 72,9 | 71,4 | 85,7 | 48,4 | 70,8 | 81,3 | 83,0 |
| gemma4:26b | 59,6 | 56,0 | 85,7 | 85,7 | 35,9 | 59,4 | 84,1 | 75,7 |
| devstral-small-2:latest | 50,3 | 51,6 | 57,1 | 71,4 | 28,1 | 42,7 | 79,7 | 63,5 |
| ornith-1.5:9b | 59,2 (část) | 43,9 (část) | 47,6 | 61,9 | 29,7 (část) | 37,5 (část) | 71,0 (část) | 81,9 |
| qwen3-30b-a3b:latest | 41,7 | 49,7 | 28,6 | 42,9 | 20,8 | 34,4 | 77,8 | — |
| qwen3-coder:latest | 51,0 | 58,6 | 63,5 | 71,4 | 37,0 | 43,8 | 77,3 | — |
| qwen3:14b | 40,1 | 52,9 | 57,1 | 57,1 | 32,3 | 36,5 (část) | 82,4 | — |
| phi4:14b | 40,1 | 54,2 | 47,6 | 61,9 | 28,1 | 38,5 | 87,3 | — |

**(část)** je průměr jen dostupných známek, nikoli úplné skóre; obsahuje neohodnocené nebo provozně selhané pokusy. Nelze ho řadit proti úplnému průměru.

† Původní CODE orákulum má doložené vady; tato historická známka není přijatý výsledek. * Technický replay je jen oddělená spustitelná komponenta, nikoli plné skóre role. Prázdná buňka znamená chybějící úplný průměr v tomto exportu, ne nulovou schopnost.
[Původní úplná matice se zdroji a SHA](/mnt/vi7000/intentsmith/evidence/hunt-milestones-20260923/full-matrix.json). Všech pět otisků jejích zdrojů bylo znovu ověřeno 28. 9.

## B — vícekolový CHAT, Opusův první úplný průchod úlohami

**Panel 23.–24. 9., 40 hodnocených dialogů na model.** Jeden Opusův posudek, standardně první opakování; přerušený dialog Phi4 byl nahrazen dalším opakováním. Průměr je přes uložená obsahová skóre. Není to hodnocení všech 120 dialogů modelu ani nový produkční profil z 27. 9. Panel běžel bez produkčního systémového promptu a s `think:false`.

| Model | CHAT — Opus | Hodnoceno |
|---|---:|---:|
| qwen3.8:latest | 95,3 | 40 |
| qwen3.5:27b | 88,4 | 40 |
| qwen3.6:27b | 90,9 | 40 |
| gemma4:26b | 92,1 | 40 |
| devstral-small-2:latest | 66,6 | 40 |
| ornith-1.5:9b | 86,3 | 40 |
| qwen3-30b-a3b:latest | 80,2 | 40 |
| qwen3-coder:latest | 74,5 | 40 |
| qwen3:14b | 76,4 | 40 |
| phi4:14b | 64,9 | 40 |

[Uložené známky všech 400 dialogů](/mnt/vi7000/intentsmith/evidence/hunt-chat-panel-20260923/opus-grading-20260924/scores-unblinded.json) · [okolnosti a omezení panelu](2026-09-24-HUNT-M0-DECISION-METHOD.md).
Můj tehdejší první blok u Phi4 hodnotil šest běžných dialogů a šest JSON dialogů; neměl úplné skóre panelu. [Podrobný rozpad prvního posouzení](/mnt/vi7000/intentsmith/evidence/hunt-chat-panel-20260923/assessment-20260924/REVIEW.md).

## Co je nyní skutečně nastavené

Čtení živé SQLite `data/c3.db`, tabulek `model_desired_bindings` a `model_overrides`
28. 9. potvrdilo D1/CHAT=qwen3.5:27b, D2/CODE/R1=qwen3.8:latest,
R2=devstral-small-2:latest, VISION=ornith-1.5:9b. Jde o uložené vazby;
není to samostatná atestace každé běžící instance aplikace.

Qwen3.8 má tři role a zároveň píše i reviduje vlastní kód. To porušuje
požadavek maximum dvou rolí i oddělení autora a revize. Pouhé přidání CHATu
nebo přesunutí R1 nestačí k ověření celé sestavy.

## Přepočet D/R ze stejných odpovědí

U každého modelu/role je **7 případů × 3 opakování = 21 odpovědí**.
Vyřazen je celý starý `model_cleanup` s vadným kontextem, u všech kandidátů.
Jeho nový samostatný sběr se sem nepřimíchává. Nejprve průměr kritérií odpovědi,
pak opakování uvnitř případu a sedm stejně vážených případů. Sloupce nejsou
sloučeny do nové konsenzuální známky. Jde o známé vývojové případy.

| Role | Model | Codex | Opus |
|---|---|---:|---:|
| D1 | qwen3.5:27b | 66,43 % | 66,07 % |
| D1 | qwen3.6:27b | 69,29 % | 66,37 % |
| D1 | qwen3.8:latest | 72,56 % | 73,21 % |
| D2 | gemma4:26b | 58,93 % | 52,68 % |
| D2 | qwen3.6:27b | 69,23 % | 62,20 % |
| D2 | qwen3.8:latest | 64,17 % | 64,88 % |
| R1 | devstral-small-2:latest | 34,05 % | 29,17 % |
| R1 | gemma4:26b | 45,00 % | 37,50 % |
| R1 | qwen3.6:27b | 53,93 % | 51,19 % |
| R1 | qwen3.8:latest | 57,98 % | 52,98 % |
| R2 | devstral-small-2:latest | 51,19 % | 41,67 % |
| R2 | qwen3.6:27b | 73,81 % | 70,24 % |
| R2 | qwen3.8:latest | 82,14 % | 79,76 % |

[Strojový přepočet, přesné identity, SHA zdrojů a snapshot vazeb](/mnt/vi7000/intentsmith/evidence/hunt-role-allocation-20260928/role-evidence.json).
[Reprodukční skript](/mnt/vi7000/intentsmith/evidence/hunt-role-allocation-20260928/recompute.py).
273 odpovědí představuje 13 hodnocených buněk, ne všech deset modelů ve všech rolích.
Ani tři opakování nejsou tři nezávislé historické případy.

## Ostatní role mají jiné podklady

- **CHAT:** nový produkční sběr s úplnou historií, 40 dialogů na model:
  qwen3.8 86,26 / 85,68 %, qwen3.5 84,20 / 79,08 % (Codex / Opus).
  Oba posudky preferují qwen3.8; velikost přínosu se liší. To je důvod k
  operátorské volbě, ne automatický důkaz splnění výměnového prahu.
  [Dva celé posudky](2026-09-27-HUNT-REAL-SECOND-REVIEW.md).
- **CODE:** zachovat qwen3.8 jako pracovní první volbu. Technická komponenta
  uložených oprav má 100 % proti 71,43 % Devstralu; **plné skóre úlohy je null**.
  Toto není celková známka CODE ani nové měření provozní dokončenosti.
  [Audit komponenty](evidence/2026-09-25-hunt-code-components.json).
- **VISION:** doporučení nelze opřít jen o tři pozdější běhy. Společný původní panel
  přepočtený současným orákulem řadí bodově Qwen3.5 88,62 %, Qwen3.6 83,04 %,
  Ornith 81,88 %, Qwen3.8 77,25 %, Gemma4 75,72 % a Devstral 63,48 %.
  Pozdější Ornith vyšel 77,61 %; tento jiný výstup zůstává samostatně doložený
  v [kampani 25. 9.](2026-09-25-GPU-HUNT-ISOLATED-CAMPAIGN.md).
  Ponechání Ornithu může být kompromis celé sestavy, ale není to vítězství v úplném panelu.

## Doporučení a konflikty, které se nesmějí skrýt

1. **Rezervovat Qwen3.8 pro CODE**; pro CHAT je také nejsilnější aktuálně
   porovnaný pracovní kandidát. Dvojice CODE+CHAT je návrh povoleného sdílení,
   pouze pokud CHAT nepřebírá revizi svého kódu. Dnešní whitelist sdílení je
   prázdný: návrh není tvrzení, že jej existující solver již přijímá.
2. **D1 prozatím ponechat Qwen3.5.** Qwen3.8 je bodově výš, ale je potřeba
   také pro CODE. Malý rozdíl Qwen3.6 proti Qwen3.5 není důvod vyčerpat tím
   jediného silnějšího alternativního review kandidáta.
3. **R1 a R2 řešit společně.** Qwen3.6 je nejlepší změřená alternativa mimo
   artefakt Qwen3.8 v obou rolích. Nesmí však obsadit obě a vydávat to za dvě
   nezávislé kontroly. Je třeba ověřit i skutečný původ/lineage, nejen rozdílné
   tagy. Vhodnější použití podle těchto dat je R2: výrazný náskok proti Devstralu.
4. **D2 zatím bez jasného vítěze.** Codex upřednostnil Qwen3.6, Opus Qwen3.8.
   Gemma je v obou posudcích níž. Dosadit ji jen kvůli volnému slotu by byl
   vědomý kompromis, nikoli zlepšení doložené testem.
5. **Před nákupem dalšího sběru dokončit porovnání existujících modelů.**
   Pro dalších 27 D/R buněk leží 554 použitelných úplných odpovědí na disku;
   doplnění jednotného hodnocení má přednost před závěrem, že v panelu vhodná
   alternativa pro R1/D2 neexistuje. Slabé výsledky dosud vybraných kandidátů
   neopravňují vyřadit ostatní bez srovnatelného posouzení.

Například úplná pracovní sestava D1=Qwen3.5, D2=Gemma4, CODE+CHAT=Qwen3.8,
R1=Qwen3.6, R2=Devstral, VISION=Ornith odstraní přímou vlastní revizi a
přetížení třemi rolemi. **Nedoporučuji ji vydávat za kvalitativní optimum:**
platí se nižším D2 a slabým R2, sdílení CODE+CHAT není přijaté a rodinná
nezávislost Qwenů není prokázaná. Varianta s Qwen3.6 v R2 má naopak díru v R1.
Nelze to vyřešit pouhým seřazením procent nebo jejich součtem napříč rolemi.

Praktická priorita: doplnit dva posudky 554 úplných uložených D/R odpovědí,
uzavřít 13 vyčerpání rozpočtu a doplnit opravený `model_cleanup`, potom osm
chybějících produkčních CHAT buněk. CODE držet jako technickou komponentu,
dokud nebude celé orákulum způsobilé. Teprve nad tímto širším podkladem sestavit
návrh oddělující CODE od jeho revizí. Automatická přejímka místních hodnotitelů
nesmí znovu odsunout dokončení základní matice pracovních modelů.
