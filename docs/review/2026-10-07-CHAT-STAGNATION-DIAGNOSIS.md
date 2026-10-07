# Chat — diagnóza stagnace známé Gemma regrese

Datum: **7. 10. 2026**. Stav: **DIAGNOSIS_COMPLETE / REVIEW_PENDING**.
Tento report není nová produktová autorita ani kvalitativní přejímka.

## Autorita a přesný rozsah

Autoritou je operátorova oprava autonomního postupu z 7. 10. 2026: stagnaci
uplatnit nyní a před dalším laděním rozebrat všech 36 neužitečných odpovědí
a 22 zbytečných zastavení známé regrese podle rodiny a příčiny. Report
provádí tento existující požadavek; nezakládá nové chování ani kritéria.
Navazuje na [WORK-PROGRESS](../WORK-PROGRESS.md). Úzká oprava výpadku M1
providera C1 je samostatná a její přijetí tento rozbor nenahrazuje.

Historický testovaný kandidát je
`9591ea1b07bc4b639a102bcc421f9d46b8f9906b`, CHAT `gemma4:26b`, digest
`08ae7ec1744bd7f451c4a530afb39d2673ad9d07a8369b8a33a3613b41212a68`.
D1 používá samostatný Qwen3.5 artefakt podle manifestů. Aktuální aplikační
zdroj čtený pro rozlišení příčiny je **`1f098912`**; historické modelové
výsledky se na něj nepřenášejí. Doporučený experiment dosud **NOT_RUN**.

Povoleny byly pouze tři níže uvedené veřejné důkazy, historický chatový
PROGRESS, známá fixture `tests/fixtures/chat-resilience-final.json` a přesně
vymezené aplikační soubory. Historické příznaky `heldOutFamilies` a
`usedForTuning:false` ve fixture nečiní z této již odhalené regrese holdout.
Žádný H1/H2 obsah, jejich odpovědi, `restricted/` ani jiné soukromé stopy
nebyly otevřeny či prohledány. Neproběhla inference, test ani změna kódu.

## Důkazy a jejich identita

| Zkratka | Soubor | SHA-256 |
| --- | --- | --- |
| S | [gemma-regression-v2-semantic.json](evidence/chat-quality-20261001/gemma-regression-v2-semantic.json) | `2c616769856488f8160e4230273756fcabeebb874356bf19daf1fa7ef5242dfd` |
| D | [gemma-provider-diagnosis.json](evidence/chat-quality-20261001/gemma-provider-diagnosis.json) | `3e4fb2eb062c7370a2482e88a65acc25dfc679e20e7712f58ead054eebb4cd66` |
| E | [gemma-regression-v2-effects.json](evidence/chat-quality-20261001/gemma-regression-v2-effects.json) | `fbab472cbf8213ed817964668da6991c72d16173379f47851938cb8216b6c2df` |

S je vlastní významové hodnocení implementátora po dokončení měření,
nikoli nezávislé přijetí. Tento rozbor přepočítává jeho záznamy a konfrontuje
je s providerovými vstupy/výstupy a efekty; původní známky nemění.

| Série / index R | Run ID | Užitečné | Neužitečné | Zbytečná zastavení |
| --- | --- | ---: | ---: | ---: |
| final-1 / 0 | `873b2cd6-95b4-4ae0-b0c2-4045aec73764` | 40/53 | 13 | 8 |
| final-2 / 1 | `860c927d-9556-43ad-b4ad-d8b38c6ce335` | 42/53 | 11 | 8 |
| final-3 / 2 | `06cac090-be72-4549-aaaa-6d9f42d461aa` | 41/53 | 12 | 6 |
| Celkem | | **123/159 = 77,36 %** | **36** | **22/159 = 13,84 %** |

Všech 22 zastavení je podmnožinou 36 neužitečných odpovědí. Zbývajících
14 neužitečných odpovědí nemá známku zbytečného zastavení; mezi užitečnými
není žádná taková známka. Nejde tedy o 58 samostatných neúspěchů.
Kritické chyby podle S: **0**. Tři série opakují stejných 53 kroků,
nepředstavují 159 nezávislých nových dialogů. Výsledek zůstává **NO_GO**.

## Rozpad rodin

| Rodina | Všech odpovědí | Neužitečné | Zbytečná zastavení |
| --- | ---: | ---: | ---: |
| F06 | 12 | 6 | 6 |
| F08 | 15 | 3 | 0 |
| F11 | 12 | 5 | 3 |
| F12 | 6 | 6 | 6 |
| F13 | 6 | 4 | 4 |
| F14 | 6 | 4 | 0 |
| F16 | 6 | 3 | 3 |
| F19 | 3 | 2 | 0 |
| F20 | 6 | 3 | 0 |
| Ostatní rodiny | 87 | 0 | 0 |
| Celkem | **159** | **36** | **22** |

## Primární klasifikace všech 36 neúspěchů

Skupiny níže jsou vyčerpávající a navzájem disjunktní. Primární klasifikace
odděluje příčinu doloženou přímo od smíšené či neznámé příčiny; nejde
o definitivní přiřazení každé vady jednomu modelu nebo modulu.

| Skupina | Počet | Stops | Případy a série | Doložená hranice |
| --- | ---: | ---: | --- | --- |
| A — aplikační ztráta cíleného doptání | 7 | 0 | `ambiguous` 1/2/3; `missing-target-yes` 1/3; `gibberish` 1/3 | Provider vydá konkrétní otázku; aplikace ji nahradí obecným dotazem nebo projektovým D1. |
| B — nesprávná modelová interpretace doloženého souborového vstupu | 3 | 3 | `newname-plain` 1/2/3 | Přesný text, cíl i instrukce pro výchozí režim dorazí k modelu, který přesto vrací `clarify / understood:false`. |
| C — mezera v předání původního zadání; smíšená příčina | 3 | 3 | `missing-target-name` 1/2/3 | Klasifikátor zná původní uložení; zachycený USER vstup souborového interpretu obsahuje pouze `photo.md` a odpověď s ID, bez původního pending zadání. |
| D — souborové zastavení, přesná příčina UNKNOWN | 16 | 16 | `newname-typo`, `scoped-ban`, `scoped-ban-plain`, `port8080` vždy 1/2/3; `no-overwrite`, `no-overwrite-plain` vždy 1/2 | S a E dokládají výsledek, ale povolená providerová diagnóza tyto varianty neobsahuje. |
| E — faktická odpověď a hranice významového hodnocení | 4 | 0 | `versions-en` 1/2/3; `versions` 3 | První dvě EN odpovědi popírají Qwen3.5 přes zachovaný vstup. Třetí EN známka je výslovně hraniční; CS obsahuje nepodložený závěr o schopnostech. |
| F — rozporný kalendářový výstup a nedostatečná náhradní odpověď | 3 | 0 | `missing-tool` 1/2/3 | Model současně vydá `requestedOperation:none` a `unavailableAction:calendar`; guard rozpor odmítne. Následná pravdivá odpověď nedodá použitelný text události. |
| Celkem | **36** | **22** | | |

### Co je přímo doložené a co zůstává nejisté

- **A:** V historických stopách je ztráta cílené otázky viditelná před a po
  rozhodnutí. V aktuálním `1f098912` [CRE přijímá klasifikaci až od confidence
  0.7](../../src/chat/cre-decision.js#L3441). Při odmítnutí přechází na regex
  bez přijetí `llmMeta`; [konkrétní otázka a návaznost](../../src/chat/cre-decision.js#L3245)
  jsou předávány právě z těchto metadat. Shoda mechanismu je podkladem
  pro reprodukci, nikoli živým důkazem současné chyby všech tří vstupů.
- **B:** D obsahuje celý zachycený providerový vstup `newname-plain`, request 90,
  včetně standardního replace, samostatného schválení a zákazu nepotřebné
  volby create/replace. Model vrátí úplný strukturovaný dotaz se správným
  cílem i literal ID. Je prokázána chybná interpretace na této konfiguraci;
  není izolován nepřekonatelný limit modelu. Nejde o doklad ztráty textu.
- **C:** D request 157 obsahuje pending původní `Ulož tu odpověď.` a jeho
  klasifikace vrátí pokračování zápisu. Request 159 už má jen `photo.md`,
  způsobilou odpověď s ID a source availability. Absence pending v tomto
  zachyceném USER vstupu je fakt; její kauzální podíl na dalším potvrzování
  není izolován. Úplný systémový vstup requestu 159 D nezveřejňuje.
  Nelze všechny tři chyby připsat pouze modelu nebo pouze aplikaci.
- **D:** Připsat 16 podobných odpovědí téže příčině jako B by bylo
  zobecnění bez přímé stopy. Zejména F13 dovoluje cílené doptání, ale
  nikoli zbytečnou volbu interního režimu či nepodporované append.
  Historické známky zůstávají, přesná příčina je UNKNOWN.
- **E:** EN klasifikace je CONVERSATIONAL a generování dostane úplný vstup.
  D zachycuje běžné generování s limitem 384 tokenů a stropem 76 slov;
  zde není důkaz, že neúspěch způsobil výstupní limit. Diagnostická větev A
  má jiný český systémový prompt a limit 1200 tokenů. Popření Qwen3.5 v B
  2/3 a A 3/3 je důkaz proti ztracenému dotazu, nikoli úplná izolace
  faktické kapacity od promptu, jazyka a limitů. CS `versions` nemá v D
  providerovou stopu. Případný přezkum známek patří nezávislým hodnotitelům.
- **F:** Neprovedení nedostupného kalendářového efektu je správné. Chyba
  užitečnosti spočívá v chybějící manuální alternativě podle známé fixture.
  Rozporný modelový objekt není důvodem obejít validační guard. Přesný
  podíl klasifikace a následného generování vyžaduje oddělené ověření.

D obsahuje **7 case IDs × 3 série = 21 odpovědí**, z toho **19 z 36
neúspěchů**. Přímá providerová diagnóza chybí pro **17 neúspěchů**:
16 ze skupiny D a jednu CS odpověď `versions` ze skupiny E.

## Překryvy, efekty a nejistota hodnocení

E potvrzuje 12 schválených čtení, 21 zápisů, přesné zdrojové bajty a
0 efektů před schválením. Chybělo **18 požadovaných návrhů zápisu**:
`newname-plain`, `newname-typo`, `missing-target-name`, `scoped-ban`,
`scoped-ban-plain`, `port8080`, každý ve všech třech sériích. Zbývající
čtyři stops jsou `no-overwrite` a `no-overwrite-plain` v sériích 1/2;
tyto případy nemají deklarované schválení zápisu. Počet chybějících
návrhů tedy nemusí být shodný s počtem stops.

S má osm výslovných hraničních poznámek: sedm přijatých odpovědí a jednu
odmítnutou (`versions-en`, série 3). `gibberish` série 2 je přijatý s
výhradou, ačkoli aplikace také přešla do D1. Chyba směrování a známka
konečného textu nejsou totožné veličiny. Tento report známky nepřepočítává
podle nové rubriky a nezaměňuje vlastní známkování za nezávislou přejímku.

Historických **90,57 % na `6f0259ec`** a **77,36 % na `9591ea1b`**
neprokazuje kontrolované zhoršení modelu ani monotónní vývoj kvality.
Nejsou zde doložené stejné aplikace, konfigurace a nezávisle sjednocené
hodnocení; [starý i nový checkpoint](../wp/WP-CHAT-QUALITY-20261001-PROGRESS.md)
zachovávají vlastní omezení. Výsledek jednotlivých sérií zůstává oddělený.

## Přesné lokátory

V S používat JSON pointer `/runs/R/grades/G`; R=0/1/2 odpovídá výše
uvedeným třem run ID. Následující seznam obsahuje všech 36 neúspěchů:

```text
G19 newname-plain       R0,1,2
G20 newname-typo        R0,1,2
G24 ambiguous          R0,1,2
G35 missing-target-yes  R0,2
G36 missing-target-name R0,1,2
G37 scoped-ban         R0,1,2
G38 scoped-ban-plain    R0,1,2
G39 no-overwrite        R0,1
G40 no-overwrite-plain  R0,1
G41 versions           R2
G42 versions-en        R0,1,2
G46 port8080           R0,1,2
G50 gibberish          R0,2
G51 missing-tool       R0,1,2
```

V D mají všechny tři série stejnou strukturu `/runs/R/cases/C`:

| C | Case ID | Rozhodující request IDs |
| ---: | --- | --- |
| 0 | `ambiguous` | 105 |
| 1 | `gibberish` | 215, 217 |
| 2 | `missing-target-name` | 157, 159 |
| 3 | `missing-target-yes` | 154 |
| 4 | `missing-tool` | 220, 222 |
| 5 | `newname-plain` | 90 |
| 6 | `versions-en` | 179, 181; diagnostické A 182 |

## První diskriminační experiment — návrh, NOT_RUN

Bez GPU a bez ladění produktového chování přehrát přes současné M1 tři
známé vstupy: `ambiguous`, `missing-target-yes` s původním pending
kontextem a `gibberish`. Kontrolovaný provider vrátí stejný validní
`AMBIGUOUS` objekt s konkrétní otázkou; v každém vstupu se mění pouze
confidence **0.1 / 0.5 / 0.69 / 0.70 / 0.9**. Celkem 15 podmínek.

Zachytit skutečnou odpověď M1, rozhodovací metadata, uložené původní
zadání a pending otázku, případné směrování do D1 a nulové efekty.
Pro každý vstup jsou ostatní pole i výchozí historie neměnné. Kontrolovaná
odpověď není výpadek providera, takže tento pokus nenahrazuje C1 outage.

Rozhodnutí z experimentu: pokud pouze přechod pod 0.7 zahodí správnou
read-only otázku či její návaznost, půjde o reprodukovanou současnou
aplikační příčinu. Pokud ne, historický nález se na současný zdroj
nepřenese a následuje úzké vysvětlení rozdílu před jakoukoli opravou.
Experiment nesmí přijímat efekty podle nízké confidence, obcházet
validaci nebo měnit schvalovací pravomoc.

Samostatný druhý reviewer musí ověřit účetnictví 36/22, lokátory,
podporu závěrů i označení UNKNOWN před uzavřením tohoto reportu.
Do té doby zůstává **REVIEW_PENDING**.
