# CODE — nové měření 19. 9. 2026

**BENCHMARK_COMPLETE / EXPLORATORY_ONLY / PILOT_INCOMPLETE / REVIEW_PENDING.**
Autorita: pokračování schváleného CODE pilotu a přímý pokyn operátora
„muzes zacit s merenim“. Průzkumná data neopravňují k výměně role.

## Rozsah a výsledek

Čistý zdroj `0ca09dd931fe94fb09b8e0937cb43d9d9f62d7ed`, kontrakt
`0e55ee99cda70bb8d5a1c78741eeee3efcb234da5aa2fc8cb1278c4f61677c94`.
Stejná Ollama `0.34.0-intentsmith.1`, kontext 16 384, teplota 0,1,
limit odpovědi 4 096 tokenů, limit generování 300 s. Jeden model současně;
45 minut maximálně na proces včetně čekání na GPU. Tři čerstvá měření,
žádná použitá cache, celkem **63/63 pokusů, tři DB COMPLETE**.

| Model | Průměr sady | Pokusy | Čas měření | Krátká paměťová sonda |
| --- | ---: | ---: | ---: | ---: |
| `qwen3.8:latest` | 85.71 % | 21/21 | 5:00 | 16.13 GiB |
| `devstral-small-2:latest` | 46.03 % | 21/21 | 5:27 | 15.78 GiB |
| `qwen3-coder:latest` | 11.43 % | 21/21 | 3:36 | 18.71 GiB |

Čas měření zahrnuje kontrolu orákula a vyhodnocení, nikoli celý start a
ukončení provideru. Všechny tři paměťové sondy vykázaly nulový CPU offload;
nejde o kvalifikaci maximální špičky při dlouhém vstupu a generování.
Plný protokol a zdrojová data shrnuje
[strojový přehled](evidence/2026-09-19-code-pilot-comparison.json).

## Co skutečně znamenají čísla

Sedm úloh opravuje úseky o 12–52 řádcích. Pět skupin: výběr starých modelů,
modelové lease (dvě varianty), jistota porovnání, ukládání chatu, časovače
(dvě varianty). 78 cílových kontrol není 78 nezávislých scénářů; 63 pokusů
není 63 různých úloh. Průměr zde dává stejnou váhu sedmi úlohám. Při
popisném zprůměrování nejprve uvnitř pěti skupin vycházejí hodnoty
80,0 % / 44,44 % / 16,0 %. Nejde o alternativní rozhodovací pravidlo.

Výsledky tří opakování v procentech:

| Úloha | Qwen3.8 | Devstral | qwen3-coder |
| --- | ---: | ---: | ---: |
| Výběr starých modelů bez duplicit | 100.0 / 100.0 / 100.0 | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 |
| Souběh změny modelu | 100.0 / 100.0 / 100.0 | 100.0 / 100.0 / 100.0 | 0.0 / 0.0 / 0.0 |
| Ochrana modelu během VRAM práce | 100.0 / 100.0 / 100.0 | 100.0 / 100.0 / 100.0 | 0.0 / 0.0 / 0.0 |
| Jistota porovnání | 0.0 / 0.0 / 0.0 | 0.0 / 66.7 / 0.0 | 0.0 / 0.0 / 0.0 |
| Chyba zápisu odpovědi | 100.0 / 100.0 / 100.0 | 100.0 / 100.0 / 100.0 | 80.0 / 80.0 / 80.0 |
| Časovač úspěšného volání | 100.0 / 100.0 / 100.0 | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 |
| Časovač síťové chyby | 100.0 / 100.0 / 100.0 | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 |

Qwen v této sadě vede; to není průkazná pravděpodobnost dokončení projektu.
Průzkumné rozdíly proti němu jsou −39,68 a −74,29 procentního bodu.
Interval ani rozhodovací mez nebyly uzamčené před během. Nevydáváme proto
intervalové rozhodnutí podle §6 ani doporučení ke změně bindingu. Oddělený
provozní holdout v C3 podle §8 stále neproběhl; quick/full profil není hotový.

## Proč coder dostal 11,43 %

Z celých uložených odpovědí a jejich skutečného znovuspuštění:

- ve dvou úlohách modelových lease vrátil původní vadný kód bez opravy;
- v rozhodovací funkci napsal `incumbententWins`, takže vznikla ReferenceError
  a čtyři regresní kontroly selhaly;
- při čištění modelů porovnává původní jména, ne kanonickou identitu, a
  `.filter(Boolean)` nad objekty neodstraní jejich prázdné pole `model`;
- při chybě sítě používá `timeoutId` mimo platný rozsah;
- při úspěšném volání ruší časovač až po parsování, přestože zadání požaduje
  dřívější hranici;
- typ chyby zápisu splnil 4/5 kontrol: potomek předá `cause`, ale základní
  konstruktor ji nepřijme ani nepředá do Error, takže se původní chyba ztratí.

Qwen3.8 splnil šest úloh; v sedmé vrací číselné `confidence` místo
požadovaného slovního stupně. Devstral měnil výsledek této úlohy mezi
opakováními (0 / 2⁄3 / 0); dále selhal na deduplikaci a obou časovačích.
**16/16 různých neúspěšných odpovědí z celé série reprodukovalo stejné skóre.**
Žádné dnešní skóre nebylo dodatečně opravováno či přepsáno v DB.

## Oprava zadání a ověření před inferencí

Dvě původní úlohy neuváděly povinné veřejné rozhraní a stupně jistoty.
Doplněno před novou sérií; všichni tři dostali stejný nový prompt. Historické
kalibrace jsou oddělené, fingerprinty úloh i kontrakt sady se změnily.
To opravuje zadání, nikoli reprezentativnost celé sady. Qwenových starých
76,19 % se nepřebírá jako nové měření. Podrobná korekce původní hypotézy
parseru je v [předchozím checkpointu](2026-09-18-CODE-PILOT-GRADER-CHECKPOINT.md).

Čistý commit před inferencí: 49/49 odpovědních sond + gold/alternate/broken
orákula všech sedmi úloh PASS. Cílené kontroly runner 62/62, suite 27/27,
read-model 22/22, artifact 160/160, registry 525 programů validní. Původní
neúspěchy (vlastní neplatná sonda, zastaralý LOC census, chybná cesta k
registry skriptu) zůstávají v evidenci; nejsou skryté jako úspěch.
Úplný profil po této deltě nebyl opakován; dřívější zděděný FAIL pečeti
nightly orchestrátoru nebyl touto prací opravován ani přeznačen.

## Živý stav a evidence

Při dokončení jsou všechna skóre ověřená proti produkční DB. Přesné identity:

- `qwen3.8:latest`: run `eval_17ffb1f3-2f42-4f8a-bec7-8e11780cac03`, digest `22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`.
- `devstral-small-2:latest`: run `eval_b11c62f7-8631-4485-9af9-17e49c0306ee`, digest `24277f07f62db8f9cb68e9dfc679ea1818a7fbac47a50eff0a701d3f645b63c8`.
- `qwen3-coder:latest`: run `eval_40172b39-041b-44b5-b627-b477aa97426a`, digest `06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca`.

Inventář zůstal na 13 stejných artefaktech, bindingy jsou beze změny. Nebylo
stahováno ani mazáno. První ranní pokus se starým kontraktem byl ukončen
před inferencí při čekání na cizí GPU práci. Tato práce nebyla zastavena.

Během série se **souběžně změnila instalace** z `0ef67a56` na `c0eeec50`
a timer přešel na enabled/active (07:26:44 CEST, další tick
20. 9. v 03:10:48 CEST). Tato série timer nezapínala ani nepřepisovala
instalaci; původ změny není tímto reportem doložen. Aktuální instalovaný
build neobsahuje dnešní opravy evaluátoru, takže výsledek aktuálního
kontraktu nelze automaticky očekávat v jeho tabulce současných skóre.
Měření běželo z připnutého pracovního zdroje, data jsou v téže produkční DB.
**NOT_DEPLOYED** platí pro tuto deltu. Po skončení série byl seznam NVIDIA
compute procesů prázdný; další GPU měření tato série neplánuje.

Soukromá evidence:
`/home/belphareon/Projects/coworker/intentsmith-code-resume-20260919`.
Obsahuje plné odpovědi, replay a logy, vstupní/výstupní inventář, plán,
invokace, identity kontraktů a zachované negativní pokusy.

Content-addressed balíček (SHA-256):

- `evidence.tar.gz`: `f15b36f0d310baa1b2c800007d78d3fba4db6db099e24512f71768904048ca90`;
- `evidence-manifest.json` (47 souborů): `24e86096a2445241b0470f3e6ee0fbdaccbe1c4a61dc7e070ffc76304521b5cc`;
- `source.bundle`: `4fd6168c096c6b53f7761cfc77ca95b7a29b10d1481bf3f010c3873ff7cf4235`.

Git bundle byl ověřený; obsahuje měřený `0ca09dd9` a vyžaduje předchozí
publikovaný `f5f35757`. Není to archiv celého prostředí ani nezávislé
zopakování fyzického GPU běhu. První neúspěšný pokus balení zůstává
označený jako neplatný v `packaging-first-error.json` a oddělených souborech.
