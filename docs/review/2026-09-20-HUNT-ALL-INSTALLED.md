# Sběr všech lokálních modelů po druhé revizi sad

Autorita: explicitní pokyn operátora 20. 9. 2026; HANDOFF §5,
DIRECTION a nezměněný evaluační kontrakt. Stav: **COLLECTION_COMPLETE / NOT_GRADED / REVIEW_PENDING / NOT_DEPLOYED**.
Autonomní výběr zůstává **NO_GO_FOR_AUTONOMOUS_HUNT**.

## Oprava před sběrem

- `cz_ambiguity_clarification`: X zůstává 5, Y je 7. Prohození projektů
  nyní selže na skutečně rozdílných hodnotách. Staré odpovědi se nepřepisují.
- `cz_grammar_correction`: čtyři věty, nikoli nepravdivý počet čtyř změn tvaru.
- Formátová kritéria CHAT jsou oddělená od obsahových již v rubrice,
  u VISION v exportu podkladů. Nemění obsahový průměr v ručním formuláři.
  Fence je zaznamenaná odchylka od zadání, nikoli automaticky provozní chyba:
  `extractJSON` v produkčním client.js podporuje JSON v Markdown bloku.
- Strojový podíl přesně správných polí není lidská známka podle §1.3.
  Poctivý pokus s kritickou chybou se posuzuje jako 0,25; nic/echo/hesla jako 0.
  Toto rozlišení neprovádí heuristika ani nepřijatý modelový hodnotitel.

## Předem stanovený panel

Dvanáct nainstalovaných různých digestů; žádné nové stahování ani mazání.
Textové role: deset modelů, společný kontext 16 384; VISION: osm modelů,
společný kontext 4 096. Dvě LLaVA mají deklarovaný kontext jen 4 096/8 192,
proto dostanou celý VISION profil; textový profil jim nebude zkrácen.
Záznam způsobilosti obsahuje každou vynechanou roli a důvod.

Každá úloha třikrát: CODE 210, CHAT 1 200, D1/D2/R1/R2 po 240,
VISION 552, celkem 2 922 plánovaných pokusů. Obrazová schopnost je ověřena
v `/api/show`, nikoli odhadnuta podle jména. Způsobilost v konkrétním profilu
se teprve ověřuje za běhu; podpora v manifestu ji sama nezaručuje.
Předchozí exclusion qwen3-coder z CODE je pro tento širší sběr překrytý
novým pokynem „všechny modely“ a změnou orákul; stará čísla se tím nevyvracejí.

Sériové modelové běhy, žádný lokální hodnotitel, stejné zadání a generační
limity pro všechny v dané roli. 240 minut maximálně na jedno modelové/profilové
měření, 12 hodin celá fronta; konec rozpočtu zůstává viditelný.
Modelová chyba se nesmí změnit na nulu prostředí. Cizí GPU práce se nezabíjí.
Provider zůstává připnutý 0.34.2-intentsmith.1; známé omezení účtování MTP
paměti je auditní výhrada, ne důkaz 22GB způsobilosti.

Evidence root:
`/home/belphareon/Projects/coworker/intentsmith-hunt-all-installed-20260920`.
`panel.json` zachovává inventory a celé `/api/show`; následný sběr má
vlastní identity, čas, odpovědi a provider logy. Starší sběr zůstává beze změn.

Výstupem jsou odpovědi se skrytými identitami pro stejný styl nezávislého posouzení.
Nejsou automaticky importované do produkční DB. Timer, aktivace vazeb,
mazání a rozhodovací autorita zůstávají vypnuté. Tento dokument není přijetí
hodnotitele ani závěr o vítězi.

## Výsledek nového sběru

Stav fronty: **COMPLETE**; obsahové hodnocení: **NOT_GRADED**.
Zdroj měření: `775434ffc0d5a95228de275ed26e7a1ba66d43f9`; provider `0.34.2-intentsmith.1`.
Začátek `2026-09-20T06:17:03.106781+00:00`, konec `2026-09-20T12:24:26.963716+00:00` (UTC).
Zaznamenáno **2922 / 2922** plánovaných pokusů; chybí 0.

| Role | Artefaktů se záznamem | Zaznamenáno / plán | Dokončená generace | Tokenový limit | Transportní chyba |
|---|---:|---:|---:|---:|---:|
| CODE | 10 | 210 / 210 | 210 | 0 | 0 |
| CHAT | 10 | 1200 / 1200 | 1200 | 0 | 0 |
| D1 | 10 | 240 / 240 | 237 | 3 | 0 |
| D2 | 10 | 240 / 240 | 238 | 2 | 0 |
| R1 | 10 | 240 / 240 | 238 | 2 | 0 |
| R2 | 10 | 240 / 240 | 234 | 6 | 0 |
| VISION | 8 | 552 / 552 | 541 | 11 | 0 |

`CAPTURED` znamená dokončenou generaci, nikoli správný obsah.
Prázdných dokončených výstupů: 0.
Limity a chyby zůstávají v datech; nejsou skrytě přeznámkované nulou. CODE odpovědi čekají
na oddělené spuštění orákul. Neběžel automatický hodnotitel žádné role.

| Model | Zaznamenané pokusy | Dokončené generace | Tokenový limit | Doba profilů (min) |
|---|---:|---:|---:|---:|
| llava-llama3:8b | 69 | 58 | 11 | 2.7 |
| llava:13b | 69 | 69 | 0 | 3.1 |
| gemma4:26b | 306 | 306 | 0 | 14.3 |
| ornith-1.5:9b | 306 | 295 | 11 | 37.0 |
| phi4:14b | 237 | 237 | 0 | 22.1 |
| qwen3:14b | 237 | 236 | 1 | 30.2 |
| qwen3-coder:latest | 237 | 237 | 0 | 12.9 |
| qwen3-30b-a3b:latest | 237 | 237 | 0 | 12.3 |
| qwen3.5:27b | 306 | 305 | 1 | 88.8 |
| qwen3.6:27b | 306 | 306 | 0 | 51.2 |
| devstral-small-2:latest | 306 | 306 | 0 | 42.9 |
| qwen3.8:latest | 306 | 306 | 0 | 49.9 |

Doby jsou skutečný součet běžících profilů včetně načtení a ukončení providera.
Nejsou převzaté z `result.durationMs`: všechny plány byly připravené předem,
takže toto starší pole zahrnuje i čekání ve frontě. Samotná generace má vlastní
časy a počty tokenů v každém pokusu.

## Ověření a omezení

Kontrola integrity: **PASS**, 2922 pokusů, 2922 uložených volání; 0 dalších volání vyloučeno z podmínek sběru.
Kontrola porovnává původní zprávy, jejich SHA, přesný digest v odpovědi,
verzi providera, nastavení a úplnost plánovaných trojic role/úloha/opakování.
Úlohy mají 102 různých zadání: CODE 7, CHAT 40, D1/D2/R1/R2 po 8,
VISION 23 (22 různých obrázků a jedna kontrola bez obrázku).
Počet ID ani tři opakování nedokládají statistickou nezávislost.

Před sběrem prošly cílené sady: evaluation-repair 10, semantic-evaluation 15,
role-collection 6 a artifact-validation 160. Široký release gate zde znovu
spouštěný nebyl; starší výsledek 363 PASS / 1 FAIL není přepsaný na zelený.
Samostatný hodnoticí formulář byl ověřen skutečným rendererem a exportem JSON;
diagnostický Electron s `--no-sandbox` a softwarovým vykreslováním není
důkaz nasazení nového Studia. Viz `review-ui.json` a `targeted-validation.json`.

Výhrady k prostředí (podrobné řádky logů a vzorky jsou v `hardware-audit.json`):

- `gemma4-26b-text`: `API_MEMORY_ACCOUNTING_INCONSISTENT`. Do not use provider size equality as autonomous memory qualification or deletion evidence.
- `gemma4-26b-vision`: `API_MEMORY_ACCOUNTING_INCONSISTENT`. Do not use provider size equality as autonomous memory qualification or deletion evidence.

API paměťová čísla nejsou nezávislá přejímka GPU profilu ani oprávnění k mazání.
Umístění všech vrstev na GPU samo nedokazuje nulové alokace v RAM.
Případná evidence zkrácení vstupu musí být posouzena před známkováním.

## Podklady pro stejné nezávislé posouzení

- `review.html` / `answers-for-review.json`: zadání a úplné odpovědi bez známek a identity.
- `review-sample.html` / `.json`: 15 cílených a 15 náhodných různých odpovědí; bez CODE.
- `grading-template.json`: obsahová kritéria a formát zvlášť, s důvodem každé známky.
- `identity-key.json`: oddělené odhalení modelů až po prvním posouzení.
- `README-BLIND.md`: pravidla vadných kritérií, neúplných odpovědí a stejného základu porovnání.
- `collection-summary.json`, `collection-integrity.json`, `hardware-audit.json`: dohledatelné počty a výhrady.

Toto je předání dat k posouzení. Nepotvrzuje předpovědní platnost sad,
přijetí hodnotitele ani vítěze pro žádnou roli. Produkční DB a vazby se
tímto sběrem nemění; autonomní rozhodovací a mazací brána zůstává zavřená.


## Konečná kontrola předání

Běh trval **6 hodin 7 minut 24 sekund** (08:17–14:24 CEST). Měření celé
proběhlo na čistém `775434ff`; tento následný commit aktualizuje pouze dokumentaci.
Systémový provider na 11434 zůstal `0.34.0-intentsmith.1`, měření používalo
oddělený připnutý provider `0.34.2-intentsmith.1` na 11435.

Kontrola hostu ve 12:24:55 UTC (`final-host.json`): žádný NVIDIA výpočetní
proces, evaluační provider ukončený, systémový inventář beze změny a bez
rezidentního modelu; timer `disabled` / `inactive`. Před uzavírací dokumentací
byl zdroj stále čistý `775434ff`. Volných přibližně 39,6 GiB; žádný model
nebyl tímto sběrem stažený ani odstraněný. Sběr neměnil přiřazení produkčních rolí.

Hodnoticí formulář nad finálními 2 922 položkami: **14/14 PASS**
(`review-ui.json`, přesný hash HTML a počet položek). Ověřeno zobrazení zadání,
obrázku a celé odpovědi, přímé odkazy, oddělení formátu od obsahového průměru,
uložení po obnovení a skutečné stažení JSON s důvody. Diagnostické známky
jsou pouze v izolovaném testovacím profilu, který není v archivu. Zástupné
prohlášení o nezávislosti recenzenta zůstává `null`, nikoli domyšlené `true`.

Finální vzorek: **30 položek = 15 cílených + 15 náhodných**, všech
12 artefaktů a všech šest rolí vhodných pro čtené posouzení. Počty:
CHAT 11, VISION 5, D1 6, D2 3, R1 3, R2 2. CODE se posuzuje orákulem.
Ověřena jedinečnost dvojic úloha/odpověď a funkční odkazy; nejde o tvrzení
30 statisticky nezávislých případů. Výběr nepoužil skóre ani úsudek o kvalitě.
Model může své jméno uvést sám v textu; skrytá metadata nezaručují dokonalé zaslepení.

Průběžná kontrola zachytila zastaralý vzorek před dokončením panelu;
regenerace a konečné ověření jsou zaznamenané v `review-validation-events.json`
a `review-sample-verification.json`. První archiv byl nahrazen, protože obsahoval
měnící se výstupní log balení. Finální archiv tento log vylučuje a ověřuje
jak členy archivu, tak jejich shodu s konečnými soubory; předchozí pokus zůstává
popsaný v `packaging-events.json`. Žádná tato oprava nezměnila modelové odpovědi.

## Ověřené archivy

- Balíček pro první posouzení bez klíče identit: [blind-review-223001958803b435.tar.gz](/home/belphareon/Projects/coworker/intentsmith-hunt-all-installed-20260920/blind-review-223001958803b435.tar.gz) (4,477,180 bytů).
  SHA-256 `223001958803b43549c457e9ac78a9f7568fb16ea299145329fb9cd7e2d69727`.
- Úplná evidence včetně identit, raw volání, logů, helperů a zdroje: [evidence-563ad4d36de40994.tar.gz](/home/belphareon/Projects/coworker/intentsmith-hunt-all-installed-20260920/evidence-563ad4d36de40994.tar.gz) (103,130,268 bytů).
  SHA-256 `563ad4d36de40994064b19097160b184fa3a50a0b3be35b1c988f4997f62865e`.

Finální archiv: **PASS**, 247 členů ověřeno proti manifestu.
Git bundle obsahuje zdroj měření a potřebnou historii; ověřený import do
prázdného repozitáře zahrnoval všech 44 odkazovaných revizí. To neznamená,
že bundle obsahuje pouze 44 commitů. Viz `source-bundle-verification.json`.

## Další krok

Nejdřív posoudit odpovědi podle kritérií s konkrétními důvody; obsah a formát
odděleně. Vadné kritérium ponechat bez známky, zaznamenat vadu a případnou
opravu použít stejně pro všechny kandidáty. Sporné vlastní nálezy ověřit,
nepřidělit jim automaticky body. CODE oznámkovat odděleným spuštěním opravených
orákul nad uloženými odpověďmi. Porovnání modelů musí zachovat stejné případy
i viditelné počty neúplných pokusů. Teprve poté lze mluvit o výsledcích;
pro přijetí rozhodovacího profilu stále chybí oddělená provozní kvalifikace.
