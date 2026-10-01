# WP — rozpočet peer kontextu pro generování CODE projektu

**Autorita:** uživatel požaduje dokončit funkční IDE/BE a ověřit skutečně
fungující generované projekty. Produktový požadavek je v
[`PRODUCT.md`, Práce nad projektem](../../PRODUCT.md#práce-nad-projektem):
relevantní kontext s provenance, návrh, přesné schválení, atomické provedení
a kontrola výsledku. Naměřený stav zůstává v
[`SYSTEM-MAP.md`](../../SYSTEM-MAP.md) a
[`completion trackeru`](../review/2026-09-30-COMPLETION-TRACKER.md).
Tento návrh není nová produktová ani schvalovací autorita.

**Stav:** `DRAFT / NOT_STARTED / DESIGN_OPEN`.
Zdrojový helper není implementovaný, nové testy jsou `NOT_RUN` a nový
modelový průchod je `NOT_RUN`. Statická inventura a rekonstrukce velikosti
skutečného vstupu nejsou implementační ani fyzická přejímka.

## 1. Pozorovaná mezera a přesný baseline

Skutečný SQLite CODE průchod na čistém zdroji
`f557fb1a9bbb4b1d70f1a9014d9ff30e88b1cba8` skončil `FAIL` při sestavení
pátého vstupu. První čtyři odpovědi byly úplné; pátá inference neproběhla.
Přesný privátní packet je
`.intentsmith-artifacts/sqlite-catalog-callback-physical-f557fb1a-20261001-1817`.
Jeho modelové odpovědi, request metadata a případné CPU replay fixtures
zůstávají ignorovanými důkazy; do veřejného WP se nekopírují raw odpovědi,
prompty, DB, provozní identity ani lokální produkční cesty.

| Pořadí | Cíl | Úplný `afterContent` | Skutečný `prompt_eval_count` |
| --- | --- | ---: | ---: |
| 1 | `src/query.js` | 616 B | 508 |
| 2 | `src/schema.js` | 356 B | 507 |
| 3 | `src/store.js` | 4 110 B | 898 |
| 4 | `src/validate.js` | 1 851 B | 540 |
| 5 | `src/service.js` | NOT_GENERATED | NOT_MEASURED |

Pátý prompt používá pouze přímé dependencies `store.js` a `validate.js`:
5 961 B úplného zdrojového obsahu. Nejde o přidávání všech předchozích nebo
tranzitivních souborů. Read-only rekonstrukce aktuální serializace dala:

`1 173 B system + 7 638 B prompt = 8 811 B`.

Nezměněný modelový rozpočet je `numCtx=8192`, `maxOutput=3440`, rezerva384.
Současný bajtový guard je `(8192 - 3440 - 384) * 2 = 8736 B`;
překročení činilo **75 B**. Toto je přesné měření UTF-8 bajtů serializovaného
vstupu, nikoli měření 8 811 tokenů nebo důkaz skutečného tokenového overflow.
Pátý počet tokenů není k dispozici. První čtyři providerové počty jej
nenahrazují.

Původní výstupy a všechny historické `FAIL`, včetně dřívějších porušení
schema dependency a callback rozhraní, zůstávají uchované. Tento WP
neprohlašuje SQLite aplikaci za přijatou a neupravuje její instrukce ani oracle.

## 2. Skutečná cesta a vlastník connectoru

1. [`src/routes/m2-lifecycle.js:135`](../../src/routes/m2-lifecycle.js#L135)
   předává explicitní draft do `draftSmallProjectChange` s actor/project/origin
   a abort signalem. Přirozený CHAT na této cestě není předmětem WP.
2. [`src/lifecycle/m2-lifecycle-application-service.js:650`](../../src/lifecycle/m2-lifecycle-application-service.js#L650)
   ověřuje projekt, workspace revision, policy, baseline a předchozí návrh.
3. [`:758`](../../src/lifecycle/m2-lifecycle-application-service.js#L758)
   vybírá přímé dependencies, navazuje úplné generated/retained obsahy
   nebo ověřené read-only soubory a sestavuje další vstup.
4. [`src/lifecycle/m2-code-draft.js:142`](../../src/lifecycle/m2-code-draft.js#L142)
   serializuje prompt. Současný BUILD profil výslovně popisuje úplné obsahy
   dependencies; pod tento profil nelze podstrčit ořezaný obsah jako celý soubor.
5. [`:226`](../../src/lifecycle/m2-code-draft.js#L226) určuje rozpočet a
   [`:243`](../../src/lifecycle/m2-code-draft.js#L243) ověřuje jeho limit
   před voláním policy gateway. Model poskytuje pouze návrh obsahu, ne approval.
6. Úplné výstupy jdou do stávajícího compileru a M2 prepare/preview/approval.
   Odvození kontextu nebude zapisovat projekt, vykonávat kód ani vydávat grant.

[`src/planner/milestone-decomposer.js:39`](../../src/planner/milestone-decomposer.js#L39)
řeší LOC a počet souborů v jiné planner cestě. Není volán tímto explicitním
M2 project-build draftem a sám jeho serializovaný peer rozpočet neřeší.

Před implementací musí být určen jediný vlastník M2 draft/context connectoru.
Samostatný návrh AST import scanneru se tímto WP nepřebírá ani nerozšiřuje.

## 3. Tři řešení a doporučený směr

| Varianta | Přínos | Omezení / podmínka |
| --- | --- | --- |
| Pevný module-output/interface budget | Umožní před generováním odhadnout nejhorší velikosti následných vstupů podle dependency graphu a odmítnout neproveditelný plán dříve. | Samotný pevný output cap může odmítnout jinak platný celý modul. Nelze jej nastavit podle chybějících75 B nebo vydávat dřívější odmítnutí za dokončení aplikace. Počítat musí i finální JSON escaping a metadata. |
| **Explicitně verzovaný odvozený peer kontext** | Omezuje kontext určený konzumentovi, přitom ponechává celý modelový zdroj pro plán, approval, provenance a oracle. Nepotřebuje další modelové volání. | Vyžaduje jasně označený nový profil, podporovaný statický tvar rozhraní a důkaz vazby na skutečný zdroj. Nevyřešené rozhraní musí zastavit krok. Zda skutečný vstup po projekci vyhoví, je zatím `NOT_PROVEN`. |
| Přesný tokenizer | Mohl by měřit vstupní tokeny místo konzervativního bajtového guardu. | Vlastní následný WP: přesný modelový artefakt/tokenizer, provider build, chat template, system/user/schema balení a BOS/EOS musí odpovídat skutečnému requestu. Chybí přijatý důkaz i CPU/RAM/časové containment. `prompt_eval_count` až po inference není předběžná autorizace. |

Doporučení: druhá varianta, doplněná deterministickým předběžným rozpočtem
serializovaných interface records. Přesný tokenizer teď nezavádět; limity
modelu nezvyšovat a současný guard neobcházet.

## 4. Navržené API a explicitní význam

Pracovní návrh čistého helperu:

`buildCodePeerContext({ mode, consumerPath, peers, authoredContracts, budget, scope })`.

- Původní režim s úplnými soubory zůstane výchozí a **wire-byte-exact**.
  Zda a kde caller výslovně zvolí nový režim, musí určit reviewed návrh před
  změnou zdroje; žádný skrytý přepínač nebo tiché přepnutí po overflow.
- Nový enum/profile bude `declared-interface/v1` se samostatným označeným
  schema/profilovým kontraktem. Odvozená view se nebude nazývat úplným `content`.
- Každá view ponese cestu, původ/state, digest úplného zdroje, verzi projekce
  a digest projekce. Vazba na vlastní project/workspace revision musí zůstat
  ověřitelná; stale/foreign source nelze použít jako aktuální dependency.
- **Požadované rozhraní** je původní autorská instrukce, převzatá beze změny.
  **Pozorované rozhraní** je doložitelný statický výsledek parse-only analýzy
  skutečných úplných bajtů. Požadavek neprokazuje, že jej implementace splnila.
- Výčet podporovaných JS exportů/signatur a statických return-object kontraktů
  musí být uzavřený před implementací. Nevyřešený export, computed/dynamický
  objekt, nejasná vazba vracené metody nebo nepodporovaný tvar znamená
  fail-closed; žádné vymyšlené signatury, automatický modelový souhrn ani
  vydávání komentáře nebo zadání za ověřenou sémantiku implementace.
- Číst/parsovat lze zdrojová data; nesmí se spouštět/linkovat generovaný modul,
  resolving imports, používat eval nebo vykonávat kód kvůli odvození rozhraní.
- Měřit se bude finální UTF-8 serializace včetně profile/system textu,
  request metadata a escaping. Ani odvozený kontext nesmí překročit původní
  limit. Pokud se nevejde nebo je neúplný, další modelový call ani plán nevznikne.
- Celé `afterContent`, stávající source syntax gate, provenance, preview,
  digest, approval, revisionOf, rollback, restart a funkční oracle zůstanou
  autoritou konečné změny. Kontextová view se nikdy nestane zápisovým návrhem.
- Žádné dodatečné inference pro kompresi. Skutečná kvalifikace zachová sedm
  počátečních callů a nejvýše jednu existující povolenou revizi; žádná rekurze
  ani ručně opravené modelové zdroje.

**`DESIGN_OPEN`:** konečný supported-JS seznam, explicitní volba profilu,
finite aggregate limit všech parser vstupů/výstupů, celková parser deadline
a způsob vynucení jejího ukončení. Per-file limit sám neomezuje součet ani
synchronní native parse. Tento návrh zatím netvrdí deadline containment,
úplnost projekce ani to, že výsledná serializace skutečně vyhoví8736 B.

## 5. Bounded implementační a důkazní plán

1. **WP-first review návrhu:** uzavřít otevřené profile/parser/budget hranice
   a přidělit vlastníka connectoru; teprve poté source změny.
2. **Čistá implementace a CPU:** navržený nový helper
   `src/lifecycle/m2-code-peer-context.js`, bounded změny pouze dvou
   současných M2 draft/service modulů a rozšíření existujících
   `tests/m2-code-draft-model.test.js` a
   `tests/m2-lifecycle-application-service.test.js`.
   Případné caller opt-in má samostatně deklarovanou owned cestu; žádná
   změna sedmi SQLite fileInstruction hodnot jako náhrada algoritmu.
3. **Nezávislé source review a registrované boundary kontroly:** modelové
   souhrny, truncation, obcházení policy a rozšíření approval nejsou přijatelné.
   Přesně změřit případné nové importní hrany, descriptor a census delty;
   registry ani graph gate se neoslabují.
4. **Jeden zmrazený fyzický průchod:** až po review a příslušných gates,
   se stejným oraclem/policy/limity. Dokončená aplikace a odmítnutí porušení
   jsou dvě odlišné kvalifikace. Modelová kvalita zde zatím `NOT_RUN`.

Předběžná CPU přejímka (zatím vše `NOT_RUN`):

| Kontrola | Požadovaný výsledek |
| --- | --- |
| Starý výchozí režim se skutečnými čtyřmi f557 výstupy | Bajtově stejný8811/8736 baseline: čtyři modelové calls, odmítnutí před pátým, žádný částečný plán ani změna souborů. |
| Explicitní nový režim se stejnými raw výstupy | Finální request vyhoví nezměněnému budgetu pouze s úplnou ověřitelnou view; původní source bajty/digesty se nezmění. Fit se musí naměřit, ne předpokládat. |
| Požadovaný vs pozorovaný kontrakt | Nezaměnitelné fields; parser nepřidá nepozorovaný export/signaturu ani netvrdí správnost callback chování bez oraclu. |
| Nevyřešený export/return object, unknown verze | Zastavení před dalším voláním; žádná fallback inference, vynechaná dependency nebo autoritativní odhad. |
| Chybný digest, stale či foreign scope | View nelze použít; žádná připravená změna ani vedlejší efekt. |
| UTF-8, JSON escaping, exact8736/8737 | Rozhoduje finální skutečný počet bajtů; žádné vydávání odhadu za tokeny. |
| Aggregate overflow/parser deadline | Omezené CPU vstupy/výstupy i čas, prokazatelně ukončený vlastní parser; selhání nevytvoří view nebo plán. Mechanismus zatím `DESIGN_OPEN`. |
| Cancel, truncated output, stale revize během async kroku | Stávající typed terminal, žádný částečný plán či falešný úspěch. |
| Úplné M2 preview/new approval/revision/rollback | Operuje s celými skutečnými `afterContent`; projekce nepřepíše raw source ani digest. |
| Ledger/TaskFlow a režim bez opt-in | Zachované původní instrukce/oracles a přesná serializace původního režimu. |

Actual-raw replay fixture bude privátní, ignored a hashově připnutý.
Veřejné testy mají používat vlastní malé fixtures se stejnými měřitelnými
hranicemi; nesmějí zveřejnit privátní modelový packet nebo kopírovat jeho
obsah do nového veřejného testového rootu.

## 6. Stop podmínky a neprovedené práce

Zastavit implementační větev, pokud projekce potřebuje nepozorované rozhraní,
nedoložený tokenizer, neomezené parser zdroje, další modelové calls, zvýšení
`numCtx/maxOutput`, oslabení source/approval/oracle boundary nebo ruční opravu
modelových výstupů. Nejde o skrytý způsob, jak přeznačit původní `FAIL`.

Tento WP nemění CHAT, mobil, Hunt/role activation, produkční DB/služby,
frozen SQLite oracle, callback instrukce, veřejné sample sources ani cleanup.
Source implementace, CPU kontroly, registered gate a nový fyzický běh:
**`NOT_STARTED / NOT_RUN`**. Návrh čeká na review před source změnami.
