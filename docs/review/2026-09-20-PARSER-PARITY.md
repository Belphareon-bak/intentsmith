# GPU hunt — sjednocení JSON parseru s produkcí

**PARSER_PARITY_VERIFIED / REVIEW_PENDING / NOT_DEPLOYED. Autonomní hunt: NO-GO.**
Adresát: operátor a nezávislý reviewer. Autorita: explicitní operátorské
upřesnění z 20. 9. 2026 — evaluace používá tentýž řetězec jako `client.js`;
HANDOFF §5 a DIRECTION §1 / větev B. Navazuje na
[offline posudky](2026-09-20-HUNT-GRADING-FOLLOWUP.md).

## Co se změnilo

CHAT T2 a VISION volají přímo produkční `extractJSON()` z `src/llm/client.js`.
`runtime-json.js` přidává pouze diagnostiku a identitu zdroje; neobsahuje
náhradní extrakci ani opravy JSON. Samotný produkční parser se nezměnil.
Celý jeho postup včetně prvního fence, hranic objektu, `fixBrokenJSON`
a fallbacku na pole proto zůstává společný.

`strictJson` zaznamenává původní tvar výstupu. Markdown/prozaický obal,
který produkce umí zpracovat, již nesráží obsah ani příznak splnění úlohy.
Nesprávné hodnoty ztrácejí příslušné obsahové body; chybné schéma zůstává
nesplněným testem. Extra klíč nesmaže správné hodnoty jiných polí. Nečitelný
výstup má provozní neúspěch a `contentScore: null`, nikoli doloženou obsahovou
nulu. Tyto hodnoty jsou **podíl správných polí**, nikoli známky podle stupnice
DIRECTION §1.3.

Verze hodnocení a hash produkčního parseru vstupují do kontraktu a cache
identity. Stará měření se nepřepisují ani neimportují pod nový kontrakt.
T5 zákaz, přejímací brána, bindingy a retence zůstávají beze změny.

## Replay všech JSON odpovědí

| Tvar | Počet |
|---|---:|
| Přímý JSON | 642 |
| Fence tvoří celý výstup | 434 |
| Fence s prózou | 54 |
| Hranice objektu v próze | 3 |
| Další produkční fallback — vnitřní pole | 1 |
| Neparsovatelné i produkcí | 48 |
| Celkem | **1 182** |

Tím je potvrzeno všech 54 případů z externího rozboru. Drobné upřesnění:
produkce načte **506 objektů + 1 pole** z 552 VISION odpovědí. Dodatečná
položka `a0fc4b465f73` / `vision_critical_path` obsahuje neplatné escapování
podtržítek v klíčích. Objekt se neopraví; poslední strategie vyjme
`["B","D","A"]`. Požadovaný objekt tak chybí a test pořád neprojde.
Není to oprava `fixBrokenJSON` ani další správná VISION odpověď.

570 CHAT a 541 VISION dokončených odpovědí má nový deterministický rozpad.
Dalších 60 CHAT JSON odpovědí patří otevřeným T4 úlohám a 11 VISION odpovědí
vyčerpalo rozpočet; mají pouze záznam parsování, nikoli novou obsahovou známku.

Ze dřívějších 95 odmítnutí je 57 nyní vyhodnoceno po polích, 37 zůstává
nečitelných a jedna vrací špatný typ. **48 obsahových výsledků se změnilo**
(17 CHAT, 31 VISION), ostatních devět čitelných odpovědí zůstává obsahově
chybných. Známá `8cc71f462c9d` / `vision_weighted_rates` má **0 → 0,4**.
Samostatně se u 238 odpovědí změnil příznak splnění úlohy (49 CHAT, 189 VISION),
protože obal dříve blokoval i úplně správná pole. Není to 238 nových lepších
odpovědí ani 238 změn obsahového skóre.

## Meze a rubriky

Produkce umí vyjmout správný JSON i z rozporné prózy. Kontrola polí proto
nedokazuje pravdivost celého volného textu. Dřívější sondy požadující nulu
za okolní negaci byly na základě aktuálního zadání změněny na kontrolu shody
s produkčním výběrem; zůstávají viditelné a nejsou přejímkou sémantického
hodnotitele. Negace uvnitř hodnoty (`"not a ring"`) nadále selhává.

U všech 32 reasoning úloh je kritérium 1 obecný pokyn pro hodnotitele.
Další doložené překryvy jsou v širokém požadavku opravy a jeho konkrétních
invariantech (D2 refinement/metrics, R1 metrics, D1 metrics).
`rubric-overlap-observations.json` uchovává čísla a texty kritérií. V tomto
kroku se rubriky, váhy ani 14 neuzavřených souhrnných známek nemění.
Diagnóza, navržený kód a důkaz ověření se nesmějí automaticky slít jen proto,
že se týkají stejné vady. Sjednocení těchto rubrik zůstává další práce.

## Ověření a předání

Čistý `30c5df33`: replay porovnal 1 182 extrakcí s produkcí, VISION sondy
**299/299**, focused evaluace **12/12** a širší evaluační sada **33/33**.
Celý profil offline/database: **363 PASS / 1 FAIL / 0 BLOCKED / 0 TIMEOUT**.
FAIL je `nightly-orchestrator-self-test`: neshoda registru s přijatou Gate 0
pečetí. Pečeť se kvůli PASS neměnila. Registr samotný validuje 529 programů.
Standalone HTML prošlo třemi kontrolami skutečného Electron rendereru
(diagnostický `--no-sandbox`, software rendering; není to test Studia).

Předchozí neúspěchy zůstávají uložené: odmítnutý dirty start; špatný externí
adresář testové izolace (74 PASS / 280 FAIL / 10 BLOCKED); první úplný běh
359 PASS / 5 FAIL (LOC metadata, PDF runtime, stará parserová očekávání,
přesné nové závislosti, release pečeť). Závěrečný běh používá existující
připnuté PDF prostředí a explicitně zaznamenané tři nové importy. Počet
cyklů zůstal 3 / 28 souborů. Replay s přiznaným dirty příznakem během testů
byl po jejich skončení zopakován na čistém stromu; všech 1 182 výsledků
je shodných. Žádný předchozí report se nevydává zpětně za čistý.

Celý původní sběr (247 zapečetěných souborů), staré známky a CODE výsledky
133 / 3 / 74 jsou zachované. Nová inference, produkční import, změna rolí,
mazání ani spuštění timeru neproběhly. Instalovanému Studiu se tato větev
nepodsunula jako nasazená oprava.

Plné podklady: `/home/belphareon/Projects/coworker/intentsmith-hunt-parser-parity-20260920/`.
`parser-delta.html` nabízí rozklikávací staré/nové výsledky a původní odpovědi;
`replay-verified/replay.json` obsahuje všech 1 182 záznamů.
[Strojové shrnutí a hash archivu](evidence/2026-09-20-parser-parity.json).

Další kroky zůstávají: nezdvojené reasoning rubriky, dohodnocení zbytku sběru,
a pak porovnání alespoň dvou kandidátů na nových oddělených provozních
případech. Tento replay neprokazuje předpovědní platnost žádné sady.
