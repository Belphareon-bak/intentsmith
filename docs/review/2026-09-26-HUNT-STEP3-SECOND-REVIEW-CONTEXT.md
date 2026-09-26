# GPU hunt — druhé posudky a doručený kontext CHAT

**Stav: REVIEW_PENDING / CHAT_CAPTURE_CONTEXT_DEFECT / NO_AUTONOMOUS_GO.**
Tento zápis porovnává dva vývojové posudky nad stejnými anonymními balíčky.
Nejde o přijatou referenci, přejímku místních hodnotitelů ani rozhodnutí o
modelu. Staré známky a syrové odpovědi zůstaly beze změny.

## Co bylo porovnáno

Na zdroji `f5e4c755` proběhl `scripts/verify-hunt-blind-review.mjs` nad
kanonickými balíčky a dvěma úplnými posudky. Opusovy posudky mají SHA-256
`909a89571f84afeac52f5ee4035481e8aad748056147f001df8c35358f117fc4`
(D/R) a `563ac1321bdb19197907052f570a5060fc3cd185af638e554b0fa1607433455a`
(CHAT). Oba porovnávací výstupy mají `decisionAuthority: false`.

| Balíček | Odpovědi | Kritéria | Rozdíl nejvýš 0,25 | Spor nad 0,25 |
| --- | ---: | ---: | ---: | ---: |
| D1/D2/R1/R2, jedna úloha `model_cleanup` | 24 | 66 | 61 | 5 ve 4 odpovědích |
| CHAT, produkční dvoumodelový sběr | 80 | 320 | 283 | 37 ve 27 dialozích |

V D/R je všech pět sporů v `model_cleanup`: třikrát D1, jednou D2 a jednou
R1. Dva spory se týkají toho, zda dvě umístění stejné deduplikace představují
opravdu různé rozsahy opravy; další se týkají příčinného řetězce, ochrany při
mazání a reprodukčního testu. Rubrika i zadání vyžadují ochranu rollbacku,
ale druhý posudek upozorňuje na nejasný zdroj její konkrétní vazby. Tyto
spory musí být rozsouzeny nad veřejným zadáním a dodaným kontextem. Známky
z jedné úlohy nejsou známkou celé role.

| Anonymní odpověď | Role / kritérium | Codex | Opus | Předmět rozsouzení |
| --- | --- | ---: | ---: | --- |
| `64616cac…` | D1 / 2 | 0,85 | 0,50 | dvě skutečně odlišné varianty opravy |
| `2b72edc9…` | D1 / 1 | 0,95 | 0,50 | rozsah příčinného řetězce až k mazání |
| `2b72edc9…` | D1 / 2 | 0,80 | 0,50 | rozsah variant versus jiné umístění deduplikace |
| `f6335121…` | D2 / 2 | 0,40 | 0,75 | váha chybějící kontroly těsně před mazáním |
| `6802b949…` | R1 / 2 | 0,10 | 0,50 | zda navržená reprodukce odlišuje chybu od opravy |

Celé znění odpovědi, rubrika a oba důvody jsou v anonymním packetu a v
`dr-comparison.json`; tato tabulka je jen fronta k revizi.

## Vada zjištěná v produkčním CHAT sběru

Audit četl **skutečné `receipts[].body.messages` odeslané Ollamě** ve všech
80 pokusech. Porovnal každý předchozí vstup uživatele s textem v následujícím
požadavku. Čtyři úlohy mají jeden tah, 76 úloh tři tahy.

| Tah | Tříkolových pokusů | Chybí aspoň jedna dřívější uživatelská zpráva | Chybí všechny dřívější uživatelské zprávy |
| --- | ---: | ---: | ---: |
| Druhý | 76 | 18 | 18 |
| Třetí | 76 | 66 | 16 |

Z těchto 80 dialogů je jen 14 bez takového výpadku (včetně čtyř
jednokolových). Všech 37 sporů CHAT leží v dialozích, v nichž třetí tah
nedostal alespoň jednu úplnou předchozí uživatelskou zprávu. To **nedokazuje**,
že výpadek způsobil každý spor nebo každou chybu odpovědi; část údajů mohla
zůstat v citované odpovědi asistenta. Znamená to, že sběr neověřil schopnost
modelů navázat na plnou historii, kterou test předpokládal. Rozdíl CS/EN ani
pořadí modelů z těchto známek nelze bezpečně vyvodit.

Přímý příklad je `cs_weighted_average`: původní uživatel dodal skupinu B
`90/100` a druhý tah opravil skupinu A. Ve třetím skutečném requestu byla jen
uříznutá odpověď asistenta a aktuální žádost. Údaj B chyběl; model pak
výslovně hlásil, že ho nemá. Nejde o spolehlivý doklad jeho matematické
neschopnosti.

Příčina je v `buildAnswerContext()` v `src/chat/handlers/decisions.js`: při
`num_ctx=4096` a výstupu až 2048 tokenů vybírala historie nejdříve nejnovější
dlouhou odpověď asistenta. Ta vyčerpala rozpočet před zařazením starších
uživatelských faktů. Dosavadní `capture-audit` správně ověřil úplnost transportu
a shodu profilu obou modelů, nikoli úplnost dodané historie.

## Oprava a její mez

Vývojová oprava nyní přednostně zachová nejnovější uživatelské zprávy a shrnutí,
pro ně případně vezme část rozpočtu vyhrazeného pro výstup a teprve pak přidá
odpovědi asistenta. Syntetický regresní test i rekonstrukce všech 80 uložených
dialogů se stejnými systémovými prompty prošly: ve 2. a 3. tahu už nechybí
žádný předchozí vstup uživatele, žádný předchozí asistent a žádný prompt
nepřekročil konzervativní kontextový rozpočet. Výstupní limit se snížil u 26
z 232 volání. **Jde o offline rekonstrukci; nové odpovědi modelů nevznikly.**
Změna vstupu i tokenového limitu znamená nový profil sběru. Staré odpovědi se
nesmějí po opravě jen přeznámkovat jako by šlo o nový běh.

## Důkazy a další postup

- Anonymní porovnání:
  `/mnt/vi7000/intentsmith/evidence/hunt-step3-comparison-20260926/{dr,chat}-comparison.json`.
- Audit skutečných requestů:
  `/mnt/vi7000/intentsmith/evidence/hunt-step3-comparison-20260926/chat-context-audit.json`.
  Vazba na jména modelů je samostatně v souboru `chat-context-identities.restricted.json`
  s oprávněním vlastníka; porovnávací soubory identity neodhalují.
- Rekonstrukce opraveným kódem:
  `/mnt/vi7000/intentsmith/evidence/hunt-step3-comparison-20260926/chat-context-replay.json`.
- Reprodukce: `python3 scripts/manual/audit-hunt-chat-receipts.py --help` a
  `node scripts/manual/replay-hunt-chat-context.mjs ATTEMPT_DIR`.
- Cílený `m1-chat-contract`: **34/34**. `artifact-validation`: **160/160**.
  Širší `chat-export-budget` skončil na chybějícím izolovaném PDF runtime
  (`ENOENT`), mimo opravovanou cestu; jako PASS ho neuvádíme.

Nejdřív rozsoudit pět D/R kritérií a vyjasnit rollbackovou vazbu v zadání.
CHAT posudky zachovat jako vývojovou stopu; na opraveném runtime zopakovat
stejný dvoumodelový sběr s připnutou verzí poskytovatele a před známkováním
ověřit doručení předchozích vstupů. Nové výsledky musí znovu posoudit dva
oddělení hodnotitelé. Do té doby žádná procentní matice ani doporučení ke
změně modelu z těchto 80 dialogů.
