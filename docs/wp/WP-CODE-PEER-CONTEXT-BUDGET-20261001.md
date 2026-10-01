# WP — rozpočet peer kontextu pro generování CODE projektu

**Autorita:** uživatel požaduje dokončit funkční IDE/BE a ověřit skutečně
fungující generované projekty. Produktový požadavek je v
[`PRODUCT.md`, Práce nad projektem](../../PRODUCT.md#práce-nad-projektem):
relevantní kontext s provenance, návrh, přesné schválení, atomické provedení
a kontrola výsledku. Naměřený stav zůstává v
[`SYSTEM-MAP.md`](../../SYSTEM-MAP.md) a
[`completion trackeru`](../review/2026-09-30-COMPLETION-TRACKER.md).
Tento WP nepřidává produktovou ani schvalovací autoritu.

**Stav:** `SOURCE_REVIEW_PASS / APPLICATION_FAIL / OPERATOR_DECISION_REQUIRED` od navazujícího zadání
operátora 1. 10. 2026. CPU experiment, implementace a nový zmrazený modelový průchod dokončeny;
aplikace neprošla. Další inference čeká na výslovné rozšíření limitu opravy.
Samotný CPU výsledek není funkční přejímka aplikace.

## Vlastnictví a konkrétní výsledek navazujícího milníku

**Vlastník connectoru a jediný zapisovatel produktu:** ROOT.
**Baseline:** `84faa2a5a549ee968358db82b5d57fe4ef18a1c2`, existující
`work/real-chat-journeys-20260930`, bez nového worktree.
Vlastněné cesty: `src/lifecycle/m2-code-draft.js`,
`src/lifecycle/m2-lifecycle-application-service.js`, nezbytné přímo navázané
testy a podle zvolené reprezentace konkrétní Studio CODE connector.
Případné další přímo navázané cesty se před změnou jmenovitě zaznamenají zde.
CPU experiment má vlastní ignored packet; nezávislý reviewer zdroj nemění.

Výsledek: funkční SQLite aplikace skutečnou produktovou CODE cestou:
generování → náhled → přesné M2 schválení → frozen funkční oracle → commit
→ restart backendu a ověření aplikační persistence v dalším procesu.
Stejné úplné zdroje určují diff, digest, schválení a zápis. Existing povolená
jedna opravná smyčka zůstává omezená; historické raw výstupy se neopravují.
Oracle `28c9b73f1eec7e0b32a6e563f75f71da1d7b9f60a6a8dc149fbdbbb2c9a0ceb3`,
entrypoint `f35a4d08d2e1ded7eff8100a9096f8cfb5538583992a6208ffa5f40496b3bec1`
a context8192/output3440/reserve384 se nemění.

Před source změnou rozhodne malý CPU experiment: přesná rekonstrukce8811 B,
rozklad zdrojů/instrukcí/plánu/metadat/escaping a porovnání bezztrátového
obalu úplných zdrojů s explicitní projekcí potřebného rozhraní. Měří se i
navazující kroky a větší/UTF-8 vstupy. Dřívější doporučení projekce níže je
předběžné; konečnou volbu určí experiment, nikoli chybějících75 B.
Přesný tokenizer zůstává mimo kritickou cestu bez důkazu jeho nutnosti.

Milník skončí doloženou funkční přejímkou/review, nebo konkrétní eskalací
skutečného blokéru s možnostmi, doporučením a otázkou. Dva cykly bez
měřitelného posunu spouštějí diagnostiku a změnu strategie. CHAT, mobil,
modelová aktivace, prod nasazení a již přijatý GPU audit/cleanup mají
oddělené vlastnictví; cizí práce a GPU procesy se zachovávají.

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

## 3. CPU rozhodnutí — 20:18 UTC

Přesně obnovené čtyři f557 request-body SHA a všech sedm původních a27
requestů i osmý repair request souhlasí s historickým packetem. Rekonstrukce
pátého f557 vstupu není nová inference. Rozklad8811 B:

| Část | UTF-8 B |
| --- | ---: |
| Systémové instrukce | 1173 |
| Úplný zdroj dvou peers | 5961 |
| Escaping zdroje / uvozovky | 164 /4 |
| Metadata peers | 124 |
| File plan | 377 |
| Celkový úkol / instrukce cíle v JSON | 446 /512 |
| Cíl, beforeContent, delimitery | 50 |

| Změna reprezentace včetně jejího výkladu | Fifth B | Rezerva8736 B |
| --- | ---: | ---: |
| Původní úplný JSON | 8811 | -75 |
| Přímé úplné tuples, popis97 B | 8725 | 11 |
| Path→dependency map, popis102 B | 8730 | 6 |
| **Indexované úplné tuples, popis130 B** | **8692** | **44** |
| Raw length frames, popis227 B | 8936 | -200 |
| Experimentální pozorované rozhraní | 5088 | 3648 |

**Volba ROOT:** obecný interní formát `indexed-full/v1`, stejný algoritmus
pro všechny project-build a repair kroky. Nemění se veřejný draft formulář,
Studio persistence ani autorské instrukce. Původní small/single-file režim
zachová svůj JSON. BUILD/REPAIR wire se výslovně mění: nezaměňovat s původním
wire-byte-exact režimem. Žádný automatický fallback, instrukční slovní patch,
truncation ani navýšení rozpočtu. Net úspora na f557 je119 B (249 B obalu
minus130 B pevného popisu), nikoli odstřižení75 B ze zdroje.

Volba má malou rezervu; **neřeší obecně růst obsahu dependencies**. Tři větší
ASCII/UTF-8/escaping fixtures dále správně překračují8736 B. Sedm oddělených
historických a27 kroků má v tomto formátu2284/2301/3595/2450/7853/3727/4204 B;
repair2766 B vyhoví vlastnímu původnímu11520 B limitu. To není předpověď
neexistujících pozdějších f557 výstupů ani přijetí původní a27 aplikace.

Projekce není vybrána: snižuje informace a experiment neumí doložit osm
shorthand method signatures store factory. Požadované zadání nenahrazuje
pozorované rozhraní; computed/nevyřešené tvary by potřebovaly typed odmítnutí
v samostatném návrhu. Zde nepřibývá parser ani odhad sémantiky. Přesný tokenizer
experiment pro tento omezený krok nevyžaduje; konzervativní guard zůstává.

Privátní CPU experiment:
`.intentsmith-artifacts/code-context-experiment-20261001-2005`.
Všech587 historických regular files /30,694,789 B zachováno.
Nezávislý callgraph/design audit na84faa2a5 má REVIEW_PASS pro bounded
lossless směr. Následný source11f74be8 má SOURCE_REVIEW_PASS, nikoli
aplikační přejímku.

## 4. Zmrazený formát a vlastněné změny

Jediný product writer ROOT. Konkrétní source změna:
`src/lifecycle/m2-code-draft.js`; stávající služba ji používá přes vlastní
`promptFor` → `buildCodeDraftPrompt` → `generateCodeDraft`. Služba/Studio
se změní jen při konkrétní nezbytnosti, nikoli kvůli novému public opt-in.
Vlastněné testy/controlled decoding: `tests/m2-lifecycle-application-service.test.js`,
`tests/project-app-m2-functional.test.js` a
`tests/helpers/m2-http-build-fixture.js`. Poslední dvě cesty pouze dekódují
verzovaný kontext pro stejné existující fixture výstupy a oracle.
Existující WP, WORK-PROGRESS, completion tracker a SYSTEM-MAP jsou navázané
reportovací cesty. Registry/graph/oracle/profile změny nejsou plánované.

- JSON `contextEncoding` je `indexed-full/v1`.
- `paths`: deterministická unikátní tabulka cest v pořadí target, filePlan
  v generation order (jeho path a dependencies), peers v původním pořadí.
- `path`: index cíle do `paths`.
- `filePlan`: `[pathIndex, dependencyIndexes, state?]`.
- `peerFiles`: `[pathIndex, completeContent, state, contentDigest?]`.
- Vše ostatní včetně beforeContent/null, previousDraft/source digest,
  repair instrukce a požadovaných instrukcí zachová přesné hodnoty.
- Pevný130 B systémový dovětek je doslovně:
  ` indexed-full/v1: path uses paths indexes; filePlan=[path,dependsOnIndexes,state?]; peerFiles=[path,content,state,contentDigest?].`
- Tabulka/indexy nevykonávají zdroj. Úplné zdroje určují syntaxi, preview,
  digest, approval, retained revizi a write. Peers zůstávají untrusted data.
- Chybějící/duplicitní peer nebo neplatná vazba/digest nesmí vytvořit kontext.
  Projektová scope/revision zůstává ověřována stávající službou.
- Limity32000 B build envelope,8736 B build model-input a11520 B repair
  model-input i output/signal/syntax/approval invarianty zůstávají.

## 5. Ověření a skutečné dokončení

Před inference: samostatná decode-equality bez společného encoderu na
skutečném problémovém vstupu a následných/revision krocích; veřejné vlastní
UTF-8/escaping/marker fixtures, různé1..32 graphy/read-only/state/digest,
exact cap/cap+1, missing/stale/cancel/incomplete. Starý small JSON nezměněný.
Private actual raw zůstává ignored, nepublikovat do veřejných tests.

Dotčené registry gates (bez GPU): lifecycle application-service, routes,
Studio surface, project-app acceptance, project-app M2 functional a lifecycle
HTTP E2E. Poslední dvě mají vlastní izolovaný loopback fixture; nikdy default
produkční endpoint. Ledger/TaskFlow instrukce a frozen oracles se nemění.
Nezávislé source review a příslušné registry/graph/inventory gates se neobchází.

Po gates/review se commit a reprezentace zmrazí. Na skutečně volné GPU a
kanonické lease proběhne celý SQLite scénář přes produktové HTTP M2 draft/
preview/approval. Povolena jen existující jedna schema repair revize, nikoli
ruční patch generovaného kódu. Review musí doložit provider identity,
preview/write bajty, approval/replay, oracle, atomic rollback, commit, restart
backendu a persistence mezi aplikačními procesy podle stávajícího sandboxu.

Důležitá hranice oracle: DB žije ve stejné privátní `/tmp` tmpfs přes několik
aplikačních procesů; každý další sandbox má novou `/tmp`. Restart backendu
ověřuje durable M2/commit/source a znovu funkční aplikaci, nikoli tentýž
aplikační DB soubor přes dva sandboxy. Nezamlčet tuto hranici při handoffu.

Implementace formatteru hotová, SHA
`91c8a18d32072df560daffaa2930af1ea32479b896257cb052eef1617fe74f2a`.
Lokální100/100 lifecycle-service a22/22 frozen app kontroly mají PASS;
actual-product private replay8692/8736 a všechny historické decode-equality
kontroly PASS. Registered integrace: šest PASS na11f74be8, artifact-validation stale census
FAIL zachovaný, doc-only860 census recheck PASS. HTTP owned-server75 assertions
PASS na860 s Node24 PATH; předchozí ABI127 environment FAIL zachovaný.
Source review PASS b11d96b011a46737541ce07d5e0cf9b21aee2a9349af284d1d1851a65b833ba1;
reviewer vlastní čisté9/9 CPU, kandidát860 má totožný product zdroj11.
Push remote860 a CI36922420547/job110571450326:13 SUCCESS.
Historické neúspěchy se nepřeznačují a CPU/source/CI není hotová aplikace.
CPU experiment RESULT SHA
`a31f1a9f48f80bacced9ebb7e65fcc9975040de9474c772319fae372725be2b2`,
manifest `64888bdaa190d69e1f2a3d9ec5212a10389ff6ad1d8ccdd7303fbe72e2f471a9`.

Pokud plný zdroj opět překročí limit, je to selhání této omezené strategie,
ne modelová chyba či GPU nedostupnost. Dva cykly bez měřitelného posunu
spustí diagnostiku a skutečně odlišnou strategii podle CONTRACT §11;
potřebné rozhodnutí operátora se předá s přesným blokérem a možnostmi.
CHAT, mobil, aktivace modelů, produkční deploy a uzavřený GPU/cleanup mimo scope.


## 6. Skutečný průchod860 — 20:37–20:38 UTC

Zmrazený `860023341c7b2da78e17da32414ec79e904c7013`, product11f74be8,
Qwen3.8 digest22130167…79643/provider0.34.0-intentsmith.1:
**APPLICATION_FAIL, exit1** 20:37:01.283–20:37:59.703 UTC.
Všech osm skutečných request SHA rekonstruováno; úplné output/preview/plan
bajty a šest retained zdrojů souhlasí. Input2284/2301/3592/2450/7662/3731/4104 B,
repair2766 B; každý vyhověl původnímu8736/11520 B limitu.

Pozor: nový store2855 B a validate2090 B nejsou původní f5574110/1851 B.
S těmito novými zdroji by i původní JSON vstup7781 B vyhověl. Přímý izolovaný
důkaz přínosu formatteru je CPU replay starého8811→8692 B, nikoli tvrzení,
že nový živý fit způsobila výhradně komprese. Živý důkaz je úplná produktová
CODE generace/preview/approval při zachovaných limitech a identitě.

První exact approval odmítl skutečný zakázaný schema importnode:sqlite.
Sedm cest atomicky vráceno. Jediná předem povolená osmá schema revize import
odstranila, zachovala šest úplných modulů, dostala nový plán/digest/schválení;
starý digest409. Druhý frozen funkční test selhal při mazání:
CLI výraz `catalog.remove(cmd[1]) === undefined ? true : catalog.remove(cmd[1])`
volá remove dvakrát. První vracítrue, druhý už nenajde řádek a vyhodí chybu.
Callbackfn() už prošel; nejde o původní callback/context blokér.

Druhý rollback opět7/7. Oba terminály failed, žádný generated commit,
post-success restart/replay/persistence přejímka nedosažená. Model byl vlastní
actor bezpečně unloaded, GPU lease released, relay activeRequests0/sourceclean.
Raw packet379 pravidelných souborů /19,849,724 B zachován:
`.intentsmith-artifacts/sqlite-catalog-indexed-physical-86002334-20261001-2037`.
Provider review potvrzen, celkové actual evidence review se dokončuje.

## 7. Konkrétní další krok a operátorská hranice — 20:46 UTC

Současný [failed revision WP](WP-CODE-FAILED-PROPOSAL-REVISION-20261001.md)
§Předem vymezený test2 dovoluje nejvýše jedno další modelové volání pouze
schema.js a osm generací celkem. Tato oprava byla spotřebována. Deváté CLI
volání není součástí tohoto zmrazeného protokolu. Produktové revisionOf jej
technicky umí, ale kontraktovou přejímku nelze potichu rozšířit.

Připravený konkrétní návrh: z druhého failed lifecycle/digest vytvořit nový
CODE draft, jediný generovaný cíl `src/cli.js`, šest dalších `reusePrevious`
včetně již modelově opraveného schema. Opravný pokyn: každý dispatch provést
jednou a výsledek nejprve uložit před normalizací; tuple/API, validace,
transaction/close a ostatní chování zachovat. Stejný model/digest/budget,
nový úplný preview/digest/exact approval, tentýž oracle, commit/restart/replay.
Žádný ruční patch skutečného modelového výstupu a žádná aktivace role.

Před žádostí o rozhodnutí provedena izolovaná CPU diagnostika v canonical
bwrap nad třemi vlastními kopiemi:

| Kopie | Nezměněný frozen oracle |
| --- | --- |
| Skutečný modelový výstup po schema revizi | FAIL: dvojité mazání |
| Hypotetická autorská oprava jediného CLI výrazu | PASS celého oraclu |
| Mutant vynechávající mazání | FAIL |

Hypotetická oprava je diagnostika, **není nová modelová generace ani přijatá
aplikace**. Všechny původní modelové bajty zůstaly nezměněné. Konkrétní CODE
revision blueprint je compiled a jeho úplný repair vstup5700/11520 B.
Private packet `.intentsmith-artifacts/sqlite-double-delete-cpu-diagnosis-860-20261001`,
RESULT20842bf091a8b4c34cc70a5c0175a2c0263b4a8e71297f21edfd390a4846e68d,
blueprint1c2f9fefb413142426f9fe537277cc21140206bd5d6b7bfd5233eea3346952e3,
manifest51c3150ea860a3d678b2de4b0299420c2ad8606b3535ea6f3f3aaff835b115c2.

**Možnosti:** (A, doporučeno) výslovně povolit právě jednu další CLI CODE
revizi, nejvýše devět generací celkem, beze změny oraclu/ostatních šesti
modulů/approval; (B) zachovat osmigenerační limit a připravit jinou předem
zmrazenou strategii. Stejný kandidát se neopakuje kvůli náhodě. Žádná další
inference před odpovědí.

**Konkrétní otázka operátorovi:** povolit devátou generaci pouze CLI s novým
přesným M2 schválením podle výše uvedeného připraveného blueprintu?
Celý aplikační milník není DONE; navazující práce vyžaduje toto rozhodnutí.
