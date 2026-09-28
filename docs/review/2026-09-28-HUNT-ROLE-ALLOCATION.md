# Rozdělení pracovních rolí — aktuální podklad pro operátora

28. 9. 2026. **Pracovní doporučení, nikoli přijatá sestava. Žádné vazby změněny.**

Volba pracovních modelů nemusí čekat na automatické místní hodnotitele. Máme dva
oddělené externí posudky, které lze použít pro operátorský návrh a konkrétní kontrolu.
Nemáme však doložené optimum celé sestavy ani aktuální desetimodelovou matici všech rolí.

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
- **VISION:** ponechat Ornith. Na 23 deterministických úlohách má 77,61 %, Qwen3.8
  77,25 % a Gemma4 75,72 %. Rozdíl je příliš malý na tvrzení o lepším modelu;
  Ornith uvolní Qwen pro jiné role. [Podklad](2026-09-25-GPU-HUNT-ISOLATED-CAMPAIGN.md).

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
5. **Úzké místo je alternativní technický model**, zejména R1. Slabé výsledky
   Gemmy a Devstralu v R1 nelze napravit přidělením role. Prioritou doplnění
   je další kandidát pro R1/D2, nikoli další velký CHAT panel.

Například úplná pracovní sestava D1=Qwen3.5, D2=Gemma4, CODE+CHAT=Qwen3.8,
R1=Qwen3.6, R2=Devstral, VISION=Ornith odstraní přímou vlastní revizi a
přetížení třemi rolemi. **Nedoporučuji ji vydávat za kvalitativní optimum:**
platí se nižším D2 a slabým R2, sdílení CODE+CHAT není přijaté a rodinná
nezávislost Qwenů není prokázaná. Varianta s Qwen3.6 v R2 má naopak díru v R1.
Nelze to vyřešit pouhým seřazením procent nebo jejich součtem napříč rolemi.

Praktická priorita: při operátorském sestavování nejprve oddělit CODE od jeho
revizí, preferovat Qwen3.8 v CODE/CHAT a Ornith ve VISION, pak doplnit měření
alternativ R1/D2 a cíleně rozsoudit D2. Automatická přejímka místních hodnotitelů
je souběžná práce a nemá tuto otázku pracovních modelů odsunout.
