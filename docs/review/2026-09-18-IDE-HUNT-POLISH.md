# IDE a GPU hunt: opravy reprodukcí z 18. září

Stav: IMPLEMENTED_TESTING / REVIEW_PENDING. Vstup `ce4a5fc7`, větev
`work/ide-workspace-20260918`. Úplný profil a nasazení tohoto kandidáta ještě
nejsou dokončené. Toto není prohlášení production-ready celého produktu.

## Rozsah a chování

| Zadání | Výsledek |
|---|---|
| 1a Kandidáti | Šest řadicích hlaviček, oba směry, původní select odstraněný. |
| 1b Kompletní test | Otestovat vše připne přesný digest a aktuální kontrakt každé použitelné role; jedna sériová úloha bez přepnutí bindingů. |
| 1c Evaluace | Výchozí kompaktní matice pro každou roli: model, úlohy v procentech, Celkem; chybějící údaj není nula. Info u testu, zachovaný podrobný pohled. |
| 1d Discovery | Kandidáti nyní zahrnují trvalý katalog GPU huntu. Počet v UI předtím nereprezentoval objevy huntu. |
| 2a–c Relace | Názvy max. 28 Unicode znaků, tmavší záložky, úplný název na hover; odstraněný lokální plus, vysvětlená procenta kontextu. |
| 2d Projekty | Instalace drží stabilní projectsDirectory nezávislý na release; wizard obnovuje backendový kořen. fan-checker přestěhovaný se zachováním dat. |
| 2e Zavření | Křížek hlavičky zavře celou relaci a zredukuje sloupce; zbývající indexy/transporty se nepřeznačují. |
| 2f Soubory | Posun i výběr sousedního souboru šipkami, aktivní záložka se odkryje, krajní šipka je neaktivní. |
| 3 Seznamy | Společné sloupce pro ikonu, název, popis a stav; chybějící popis nerozhodí další řádek. |
| Screenshot počasí | Neznámá poloha vyžádá město; následně zobrazí přesnou HTTPS adresu a schvalovací příkaz namísto obecné chyby M2. |

## Hranice kompletní evaluace

Starý jednorolový formát zůstává podporovaný. Dávka má 1–7 unikátních rolí,
každá s vlastním aktuálním suiteContractSha256. Backend zkontroluje všechny
identity před systemd-run, CLI je znovu zkontroluje před měřením. Změněná
poslední role shodí celou žádost. Argumenty jdou přímo přes argv, bez shellu.
COMPLETE vyžaduje výsledek všech požadovaných rolí; částečný výsledek je
BLOCKED, chyba role FAILED. Přítomnost testu neznamená kladné skóre.
Odmítnuté spuštění je viditelné i na kartě Evaluace.

## Co skutečně prohledává hunt

Čtecí inventura [oficiální knihovny Ollama](https://ollama.com/library) v
`2026-09-18T16:46:22Z` našla 240 názvů rodin. Trvalá lokální DB měla 183
revizních záznamů, 180 modelových identit a 174 knihovních rodin. Sloučené API
v izolované DB nad těmito faktickými záznamy vrátilo 243 kandidátů, dřívější
API pouze 82. VRAM/role filtr může zobrazovat menší podmnožinu.

Ze 64 rodin knihovny nepřítomných ve sloučeném výsledku: 31 nemělo variantu
splňující předběžný limit velikosti, u 24 parser nenalezl lokální GB variantu
(omezení rozsahu/parseru; nelze všechny prohlásit za cloudové), 9 nabízelo
malé 2–4B varianty bez použitelné role podle současných kontraktů. Jejich
minimem je 7B, pro D1/R1 14B. Tyto kontrakty se nemění. Evidence neznamená,
že malé modely obecně nemají hodnotu ani že jsou prohledány všechny LLM na
světě. Hodnoty katalogu nejsou skóre kvality. Chybějící seznam od operátora
nelze konkrétně porovnat. Zdroj, rozsah a poslední první nález jsou v UI.

## Projekt a zachování dat

Projekt id 11 `fan checker`: původní `c3-agent-wip/projects/fan-checker`
byl atomicky přesunut do `/home/belphareon/Projects/intentsmith/projects/fan-checker`.
Registr změněn přes existující autentizované API. Původní cesta je kompatibilní
symlink na jedinou fyzickou kopii, nikoli druhý pracovní strom. Ověřeno 57
souborů s hashi/režimy, nezměněný Git HEAD
`7fbacd8aabc1cfde36c1636bf687b4b818c6f00d`, konverzace i projektová paměť.
Záloha: `~/.local/state/intentsmith/project-relocations/2026-09-18T16-43-25-569Z`.
Staré M2 souhlasy se nepřepisují na nový kořen. Nová instalace neprovádí
hromadnou migraci cizích projektů ani nepřepisuje desktopový profil.

## Dosavadní důkaz a jeho meze

- 65/65 Node testů v pěti cílených programech, 54/54 v šesti navazujících.
  Některé programy mají vlastní vnitřní počítadla; s Node součtem se nesčítají.
- Artifact validation 160/160, produkční Studio build PASS.
- Skutečné Electron klikání: 12 modelových kontrol, 5 workspace scénářů,
  2 weather/M1 kroky. Modelové UI používá zmrazený faktický API snapshot a
  zachytí POST; nepředstírá skutečné sedmirolové GPU měření. Backendové
  odmítnutí neplatných pinů a start jediné systemd úlohy jsou pokryté zvlášť.
- Weather scénář jde přes skutečný privátní server a M1, bez modelového
  provideru a bez odeslání HTTPS. Schválení/transport navíc kryje regresní test.
- Zachované první neúspěšné běhy: WS testovací fixture, chybně nabízený
  neaplikovatelný model v selectoru, chybějící tooltip běžné hlavičky a první
  chyby GUI harnessu. Následné běhy rozlišeny názvem, nic nepřepsáno na PASS.
- Dvě nové strukturální hrany rout na hunt-state/sweep jsou výslovně ve WP;
  počet cyklů se nemění. Strukturální baseline není release Gate 0 policy.

Evidence: `.intentsmith-artifacts/ide-polish-20260918/`. Kompletní archiv,
finální hash souborů, přesný gate a instalační důkaz budou doplněné po běhu.
Zděděné otevřené oblasti: nezávislé review, Gate 0 pečeť, M5 history podpis a
systemd M2 AppArmor. Tento rozsah je neuzavírá.
