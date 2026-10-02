# WP — rozpočet peer kontextu pro generování CODE projektu

**Autorita:** uživatel požaduje dokončit funkční IDE/BE a ověřit skutečně
fungující generované projekty. Produktový požadavek je v
[`PRODUCT.md`, Práce nad projektem](../../PRODUCT.md#práce-nad-projektem):
relevantní kontext s provenance, návrh, přesné schválení, atomické provedení
a kontrola výsledku. Naměřený stav zůstává v
[`SYSTEM-MAP.md`](../../SYSTEM-MAP.md) a
[`completion trackeru`](../review/2026-09-30-COMPLETION-TRACKER.md).
Tento WP nepřidává produktovou ani schvalovací autoritu.

**Přijatý SQLite milník:** `CONTEXT_SOURCE_REVIEW_PASS / CONTINUATION_SOURCE_REVIEW_PASS / APPLICATION_ACCEPTANCE_REVIEW_PASS / MILESTONE_ACCEPTED`.
CPU experiment a produktový formatter dokončeny. Po autorizované jediné
CLI revizi skutečná aplikace prošla celým omezeným backend/M2 kontraktem.
Nezávislá fyzická přejímka přijala doložený scénář; historický osmigenerační
FAIL platí. Release a instalované Studio mají samostatné brány.

**Aktuální navazující práce:** omezený CODE16k source převzatý, nezávislé
review PASS; celý profil a CI ověřené, skutečný fan-monitor čeká.
Rozsah a poslední výsledky v §11; přijatý SQLite se neopakuje.

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
Provider review i nezávislé celkové review dokončeny:
**REJECTION_EVIDENCE_REVIEW_PASS / APPLICATION_FAIL_NOT_QUALIFIED**.
Provider receipt SHA
`348c04adc35a419f717d823477b68092d517e137272fd33540a135b7d4928109`.
Celkové review receipt SHA
`79e225b6cb2cd28323942c09bb8e653cbc1c6211210b6c7025695a75be02c27b`,
manifest `bb1f95a197290c1df9956e93c60f52772ca84e2ef797e0052e5a4acf879ee262`.
Privátní receipt:
`intentsmith-ide2-staging-20261001/.intentsmith-artifacts/gate0-review-sqlite-indexed-physical-86002334-2037/REVIEW.json`.
Review nezávisle otevřelo durable DB read-only: dva failed terminály,
14 přesných materiálů, 14 úspěšných rollbacků, 60 událostí a žádný Git commit.
Restart před prvním schválením je doložený; závěrečný restart úspěšné aplikace
a persistence přejímka nejsou dosažené. Všech 379 raw souborů zůstalo přesných
včetně módů a Git indexu. Celkové review nepovoluje další živý běh.

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

**Nezávislé uzavření eskalace, 21:03 UTC:** reviewer přijal konkrétní blueprint,
vazbu na druhý failed plán, šest zachovaných modulů, nezměněný oracle i úplný
opravný vstup 5 700/11 520 B. Potvrdil, že devátá generace vyžaduje výslovné
rozšíření kvalifikace. Výsledek je doložená eskalace skutečného blokéru;
aplikace zůstává FAIL a žádná hypotetická CPU oprava není vydávána za CODE
modelový výstup. Read holds jsou uvolněné; čeká pouze konkrétní rozhodnutí
operátora, nikoli review návrhu.

## 8. Autorizované pokračování — 1. 10. 2026 21:32 UTC

Operátor po konkrétní eskalaci udělil „veškeré povolení“ a zadal autonomně
dokončit produkt podle dokumentace a priorit. CHAT vlastní jiný worker.
Tím je navazující CLI revize autorizovaná; stejná otázka se znovu nepokládá.
Historický průchod osmi generací zůstává uzavřený FAIL, jeho zdroj a důkazy
se nepřepisují. Toto pokračování má právě jedno nové CODE volání pro CLI,
tedy devátou generaci řetězce, šest přesně zachovaných modulů a nový plán.

**Rozsah a vlastnictví před implementací:** ROOT vlastní
`scripts/project-app-revision.js`, nezbytné regrese v již registrovaných
`tests/project-app-acceptance.test.js` a `tests/project-app-m2-functional.test.js`
a existující WP/report. Delegovaný autor vlastní pouze
`scripts/run-project-app-journey.js`; bez commitu a bez GPU. Nezávislé review
nové změny provede jiný autor. Produktový formatter je již přijatý a nemění se.

Nový explicitní resume režim zkopíruje přesný neúspěšný privátní runtime do
nového evidence packetu. Durable DB zachová lifecycle/digest a úplné návrhy.
Kvůli absolutním projektovým cestám se v izolovaném namespace kopie připojí
na původní runtime cestu; skutečný původní packet zůstane nezměněný a hashovaně
ověřený před i po běhu. Žádný zápis do původní DB, Git indexu či modelových
výstupů. Původních osm generací a jedna nová mají oddělenou provenance.

CLI pokyn a blueprint odpovídají připravenému návrhu SHA
`1c2f9fefb413142426f9fe537277cc21140206bd5d6b7bfd5233eea3346952e3`.
Model/digest/provider, úplné zdroje, budget, oracle28c9, entrypoint, policy,
projektová izolace a přesné schvalování jsou invarianty. Parser pouze doloží
pozorovaný dvojitý dispatch; nespouští generated kód v trusted procesu.
Chybějící/stale/foreign/změněný vstup odmítne před novým voláním.

Před živým během: CPU provenance a immutable-copy/mount kontroly,
dotčené existující app/M2 integrační sady, nezávislé review, commit/push,
exact remote/CI a zmrazení nového kandidáta. Potom skutečný draft→preview→
nový digest→exact approval→stejný oracle→commit→backend restart/replay a
aplikační persistence v rozsahu oraclu. Omezení private `/tmp` se přiznává;
nový běh neprokáže uchování téže DB mezi samostatnými sandboxy.

Další běžné inženýrské opravy jsou již autorizované; vznikne-li další konkrétní
FAIL, provede se diagnostika a před dalším během se zmrazí omezená strategie.
Nemění se zpětně žádný oracle nebo historický výsledek. Dva cykly bez posunu
vyžadují změnu strategie podle kontraktu. Stav aplikace je stále FAIL.

## 9. Implementované pokračování — 2. 10. 2026 08:06 UTC

Explicitní `--resume-failed` přijímá pouze přesný reviewed packet860.
Před GPU porovná celý manifest 379 souborů /19 849 724 B, včetně módů,
se zapečetěným nezávislým receipt `a853f74038ca8bd26a006e52dc44b1ad2ff05859b641b5cbc1bf4a013aa0a8a2`.
Z kopie ověří SQLite integritu, dva failed terminály, 14 úplných materiálů,
projekty/konverzaci, původní Git HEAD a nepřítomnost sedmi generovaných cest.
Starý runtime se nepřepisuje: namespace mapuje novou kopii na staré durable
cesty, původní packet je read-only. Nová proxy odmítne druhý modelový request
před forwardem. Původní ledger/taskflow/schema8 režimy zůstávají podporované.

Tři focused CPU kontroly i jejich recheck PASS: AST/provenance negativa,
původní schema revize a skutečný M2 CLI failed→rollback→nový digest→stale409→
nové přesné schválení→frozen oracle→commit. Nový blueprint odpovídá přesně
připravenému SHA1c2f. Helper review `REVIEW.md` SHA
`0ca83273e47e2d13b9ae211438458846e67df159df735b154305c14f2a6413fc`
je PASS; původní nálezy missing request SHA a dormant ternary byly opraveny.
AST kontrola dokládá jen vymezený delete dispatch, nikoli obecnou reachability.

Controlled-provider úplné pokračování 08:00:02.617–08:00:10.341 UTC je
**CPU_CONTROLLED_PROVIDER_PASS**: jediný supplied replacement přes skutečný
backend, nový náhled, pending restart, přesné approval, oracle, commit,
závěrečný backend restart/replay a postRestartApp. Originálních 379 souborů
nezměněno. Toto není nový modelový výstup ani fyzická přejímka aplikace.
Privátní packet: `.intentsmith-artifacts/sqlite-resume-runner-controlled-cpu-20261002-0800`.

Předchozí CPU fixture selhání zůstávají: dlouhá unix socket cesta EINVAL,
neúplná fake inventory LLM_PROVIDER_UNAVAILABLE s nulou generací a odlišné
directory módy kopie. Konfigurace CPU fixture a módy pouze nové kopie jsou
opravené; žádný provider workaround ani změna modelových bajtů.
Expanded source review a registrované brány aktuálního kandidáta probíhají.

## 10. Zmrazené skutečné pokračování — 2. 10. 2026 08:18 UTC

Čistý kandidát `f5964604cb76cad916fdc1ef894bfc6519c7e0d5` má přesný remote,
[CI SUCCESS, 13 kroků](https://github.com/Belphareon-bak/intentsmith/actions/runs/36982493222)
a SOURCE_REVIEW_PASS, receipt
`92a3d31bde3ed594898acc75831b018ed45d786b6f1b0e519d60565119933123`.
Reviewer ověřil celý původní manifest379, odmítnutí změny DB/souboru/módu
před GPU a tvrdou mez právě jednoho forwardovaného requestu. V1 wire,
produktový formatter, oracle i původní modelové výstupy zůstaly přesné.

Čtyři potřebné registrované sady prošly ve dvou reportech: artifact a module
boundary PASS, report SHA
`f17a1c6c97fd92ac5eb63e9db0081138dbbd8ce6659626b8b1722a5488e94d0e`;
obě app sady PASS s explicitními toolchain prerequisites, report SHA
`e716717e6abfc3ea33cc8bca37b6d49349aaab1c859b05e7a740fb29e9a95edf`.
První výběr chybného ID skončil ERROR bez spuštěných sad; následný běh
bez toolchain flags měl 2 PASS /2 BLOCKED. Oba zůstávají uchované a nejsou
vydávané za zelenou bránu.

Před živým startem zmrazená konfigurace má SHA
`0cfa8da65fbb2af0500b4e0f0687e1464b1ba5fc6dd3e70c06dabf24cf2b7ac9`:
přesný zdroj, model/digest/provider, jeden nový request, blueprint1c2f,
šest retained modulů, oracle28c9 a repair context8192/output2048/reserve384/
maxPrompt11520. Vlastní GPU lease získána až bez cizího compute/requestu.

Skutečný běh **08:18:22.941–08:18:41.453 UTC, exit0 / PHYSICAL_PASS**.
`qwen3.8:latest`, digest
`22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`,
provider `0.34.0-intentsmith.1`, dodal právě jednu úplnou CLI odpověď.
Request SHA `fed2cde62aa713ebb89b6e97eb9ce50cd97e4dd8a03604487322f294cdfbef3c`,
CLI output/preview SHA
`944d56317cb72e0692be8e35ea854079570c8a0acc35de9388271110a19c01e9`.
Celý řetězec má devět generací; šest modulů zachováno přesně. Mazání se
nyní provede právě jednou. Nový preview/digest, starý digest409, pending
backend restart, přesné approval, frozen oracle a Git commit
`a5e789cbda24e009c0eeefeda16c202877d1b88f` prošly. Závěrečný backend
restart, durable status/replay a `postRestartApp` opět prošly.

Raw result SHA `f3eb674dbba8b0b79b995f857d64fb39433882d8bae53f79f41a5f06634c1f59`;
app journey SHA `3003b460491a4e57bdc5ca4695b5f7c88a98f6028758759dc9e46333e38a178f`.
Soukromý packet
`.intentsmith-artifacts/sqlite-catalog-cli-continuation-f5964604-20261002-0816`.
Původních 379 souborů nezměněno; relay prázdný, vlastní model uvolněný,
GPU lease odstraněná. Čistý source po běhu. Nezávislá fyzická přejímka
je **APPLICATION_ACCEPTANCE_REVIEW_PASS / PHYSICAL_SQLITE_SCENARIO_ACCEPTED**,
receipt SHA `41d18e640cfbeaa9aaad38813ba822335f472438c5b96e72a0de823f9fb7302f`,
review manifest `712bd19ec61857fd2b4901393fcfb552316ed4603033ca60c4822902b57372bc`.
Reviewer znovu rekonstruoval request5700/11520, tři exact approval/plan/terminal
vazby, 21 durable materiálů, failed/failed/succeeded, 14 historických rollbacků,
sedm nových zápisů a test/commit. Vlastní samostatný canonical RO oracle PASS;
všech 646 nových raw souborů /35 261 871 B i původních379 zachováno včetně
Git indexů. Tři chyby polí/enum v reviewer checkeru jsou uchované a opravené,
žádná změna produktu ani raw důkazů.

Persistence má původní rozsah: stejná SQLite DB mezi dětskými procesy
uvnitř jednoho sandboxu. Backend restart ověřil durable M2 DB, commit a
zdroje; nový sandbox znovu provedl oracle na nové privátní DB. Stejný DB
soubor přes dvě sandbox invocations, instalované IDE a release netvrzené.
Restartové a replay assertions dosáhl skutečný runner se třemi backend PID;
jejich HTTP response bodies nejsou zvlášť uchované. Immutable DB nezávisle
potvrdila jediný nový approval a execution. Nejde o tři nové modelové běhy.

Milník uzavřen v tomto přesném rozsahu. [Veřejný source-only export](../../examples/generated-apps/sqlite-catalog/README.md)
obsahuje sedm přesných modulů /8 965 B; žádný DB, prompt, full response ani
private Git object. Samostatná copy/privacy kontrola exportu má SOURCE_EXPORT_REVIEW_PASS,
receipt `00b78d60b3d2d7ea91f0b194d3df248e6b3679086b97a8f4ce729d20e25c42a4`;
export manifest `d0784275c353bfeed2408a84f5ef08ec8463f1ff578440eb046b1d0bb130461c`.
Historické pořadí před operátorovou revizí: obecný M2 AST scanner a skutečný
větší projektový průchod. Aktuální pořadí určuje následující §11;
žádné opakování již přijatého SQLite/GPU/cleanup výsledku.


## 11. Větší projekty — nová priorita 2. 10. 2026

Operátorova revize požaduje rozhodnout kontextovou strategii před obecným
AST scannerem. Historický formatter a SQLite n=1 zůstávají přijaté v jejich
rozsahu; 119 B úspora neřeší škálování. ROOT navazuje v témže owned checkoutu.
Před implementací a GPU během porovná CPU reprezentativní větší zdroje,
fanout, navazující opravu a UTF-8/escaping: plné zdroje při 8k/16k/32k oproti
přírůstkové dekompozici a případné výslovné projekci rozhraní. Modelová
hranice a 32 000 B serializační mez se nezaměňují. Service už posílá přímé
požadované dependencies; nelze tvrdit úsporu odstraněním neexistujícího
transitivního balastu. CODE 8192 je fallback, nikoli měřená kapacita VRAM.

Případné zvýšení musí mít přesný model/digest/provider/ctx a změřenou GPU
rezidenci/headroom bez CPU fallbacku. Změna se omezí na CODE connector,
potřebnou přímo navázanou policy; CHAT kontext ani jeho globální ceiling se
potichu nemění. Projekce musí odlišit požadované a skutečně pozorované API,
verzi/původ a úplný source SHA; nepodporované JS tvary konkrétně odmítat.
Úplné zdroje dál určují preview, digest a zápis, žádné jejich zkrácení.

Nejbližší odlišný projekt je offline fan-monitor core/CLI z existujícího
WP-PROJECT-FLOW-20260918, ve dvou skutečných D1 přírůstcích. Oracle, parametry,
kontext i konečný opravný rozsah zmrazit před novou inferencí. Žádné další
ruční prodlužování běhu podle selhání. Žádná modelová aktivace ani produkční změna.

CPU rozhodnutí ROOT z 09:40 UTC: **úplné zdroje při 16k, pokud přesný runtime
prokáže FIT, a skutečné projektové přírůstky**. Stávající 32 000 B obal zatím
zůstane; při 16k modelový build guard 23 808 B a repair 27 904 B stejně omezuje
víc. Build output se výslovně mění 3 440 → 4 096 tokenů, repair zůstává 2 048,
rezerva 384. Před GPU během i produktovým zapojením se tato policy zmrazí.

Zapečetěný privátní CPU packet `code-context-scaling-cpu-20261002-092213`,
manifest `191b80532bfa6ce0b7f3656c6aa399c751985a5d6449572a32ccb8502befe2c7`,
RESULT `1b77c68425ea463aadcfea6d98395fde28b092f2e5c77f896987f92637f2b060`:
198 velikostních případů, devět 32souborových grafů se všemi kroky, 27 oprav,
šest byte regresí a devět resolver kontrol. Původních 379 souborů zachovalo
hash/mode/mtime. Vstup 8 811 B = 5 961 B úplných zdrojů + 164 B source escaping
+ 1 513 B nesource JSON + 1 173 B system. Indexed obal má 1 264 B nesource
JSON a 1 303 B system, zdroje a jejich escaping přesné: celkem 8 692 B.

| Konkrétní úplný vstup | B | 16k | 32k, obal beze změny |
| --- | ---: | --- | --- |
| Dvě 8KiB dependency, skutečný růst těl funkcí | 19 147 | fits | fits |
| Dvě 16KiB dependency, skutečný růst těl funkcí | 35 843 | guard FAIL | serializer FAIL |
| Escaping, dvě 8KiB dependency | 31 535 | guard FAIL | fits |
| Repair 16KiB cíl + jedna 8KiB dependency | 27 097 | fits | fits |
| Repair 16KiB cíl + dvě 8KiB dependency | 35 372 | guard FAIL | serializer FAIL |

Matrix coverage 27/198 při 8k, 97/198 při 16k, 103/198 při 32k jsou velikostní
fixtures, nikoli modelová kvalita. 32k jen změnou num_ctx ponechá druhou mez;
teprve explicitní budget-derived envelope by pokryl 137/198. Pokud příští
skutečný projekt potřebuje více, volit změřené 32k s odpovídajícím obalem nebo
skutečnou změnu architektury na menší přírůstky. Žádné vynechání dependencies.

Explicitní CPU projekce v2 zkrátila pátý vstup na 6 489 B, ale ztrácí callback,
validaci, returns/errors a atomicitu; navazující skutečné soubory podporuje
jen 6/13. Nevolí se jako první oprava. Resolver/gateway mají ještě nezměněný
cache/profile ceiling: prostý caller num_ctx override není produktové řešení.
Nový CODE rozpočet musí být interní, digest-bound a stejný při preflight i
generování; změna nesmí potichu zvýšit CHAT kontext ani obejít starý profil.

### Omezené produktové vlastnictví před implementací — 2. 10. 11:05 UTC

Krátký skutečný load přesného Qwen3.8 při 16384 prokázal pouze alokaci:
13 vstupních /1 výstupní token, plná GPU rezidence, minfree 3759 MiB;
plný kontext a nový projekt zůstávají NOT_RUN. Receipt
`82dd95941b8a4008d2fda274f7e9f6264b48ecf80bad75b806a71365cb264fd6`.
CPU call-graph návrh má 20 kontrol; manifest
`66be12ab18d50c5f69f4c632835a940844b2721d93c070abaa46bf0a4c22b8eb`.

ROOT vlastní právě `src/lifecycle/m2-code-draft.js`,
`src/lifecycle/m2-lifecycle-application-service.js`, `src/llm/gateway.js`
a `src/llm/model-runtime-profile.js` a nezbytné existující testy těchto cest.
Konkrétní navázané testy: `tests/m1-model-contract.test.js`,
`tests/model-ctx.test.js` a již vlastněný
`tests/m2-lifecycle-application-service.test.js`; helper experimenty jsou
ignored a nenahrazují registrovanou regresi default služby.
Delegovaný worker připravuje pouze ignored adoptovatelný patch; ROOT
jediný zapisuje produkt. Ověří skutečné názvy cest před adopcí.
Jedna privátní gateway-issued capture sváže config CODE, durable exact
artifact, oddělený schválený CODE profil a provider identity s oběma budgets
a všemi kroky. Drift před preflightem, po frontě či u served identity
konkrétně zastaví volání. Veřejné options/JSON capture nenahrazují.

Přesný nový profil: Qwen3.8 digest `22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`,
provider `0.34.0-intentsmith.1`, 16384, build4096 /repair2048 /reserve384,
obal32000 B. Globální cache, CHAT/D1 resolver, dosavadní M1 profil a T3
4096 fixture se nemění; žádná aktivace modelů nebo produkční změna.
Pokud tyto scope/digest podmínky nejsou splněné, stará cesta má své původní
limity; neznámý artifact nesmí získat nové oprávnění. Úplné sources určují
preview/digest/zápis. Nezávislé review a dotčené integrační kontroly před
zmrazeným fan-monitor průchodem; žádný CPU nebo krátký FIT není aplikace.

Společné CI ve vlastněném integračním WP přidá k zachovaným čtyřem M2
sadám právě registrovaný M1 model-contract a model-ctx; zachová všech sedm
chatových kontrol. Celek po adopci dostane jeden nový společný profil.
Finální V3 návrh je zapečetěný v `code-16k-adoption-cpu-20261002-null-body-v3`,
manifest `142917dde170ac8265b69cf6d4dae78926bca9a1553177634522550cedf77d38`.
V1 timeout a V2 null-body typová chyba zůstávají zachované; V3 CPU44+18+5
PASS není modelové či aplikační přijetí. Historická narrativní hodnota
8744 B v API návrhu je překlep; správný původní guard je 8736 B.

### ROOT adopce — 2. 10. 2026, 11:56 UTC

Přesné čtyři source cesty V3 a dvě existující testové sady převzaté nad
`3fb1d9e0`; oddělený test default služby zachovává 103 starých případů a má
104/104 CPU PASS. Root actual gateway44/44, context18/18 PASS. Úplný
default service vstup 17675 B v CPU provider fixture překračuje původních
8736 B a vejde se do nových 23808 B; pozdější overflow/neúplný output/drift
nemají autoritní řádek ani zápis. Úplné zdroje nekrácené, opravy i build
sdílejí stejný zachycený runtime. Metadata verze má původní bounded
controller a model-use lease; null body zachovává typed MALFORMED_RESPONSE.

Nezávislý source receipt
`05562774d50e6e26c9964211a1bee91c6a7cc15bd528151a794c7f141c71a9a0`;
servisní CI kontrola
`0ced6510ee02374d578edd9182b57eca8e2eb1b5500ed49481721aeb207fdf2a`.
CI zahrne oba modelové/context testy, bez změny chatových kontrol.
Jedna nová hrana gateway→model-runtime-profile; žádný removed edge ani
nový cyklus. Oficiální ratchet přijal právě tuto hranu na čistém source
`a68ce03c286e4657ed0a6f1fdda88f1f06ab1132`: 1497 hran, 3 cykly /28 členů.
Poté jeden celý společný profil. GPU/app/full-window jsou stále NOT_RUN;
allocation-only profil nezaměňuje UNKNOWN za vymyšlený obecný VRAM FIT.

### Celý společný profil a publikace — 2. 10. 2026, 12:13 UTC

Source `a68ce03c286e4657ed0a6f1fdda88f1f06ab1132` a přesná baseline jsou
pushnuté v `7cfe4edfa7e880ef4ea8e73a7e92f19ef17212c1`; remote SHA ověřené.
Jediný nový celý offline/database profil na čistém kandidátu trval
12:02:48–12:12:15 UTC: **404 PASS /1 FAIL /3 BLOCKED /0 TIMEOUT /0 SKIPPED**,
verdict FAIL. Jediný FAIL je zděděné CHAT routování DPH; přesně tři BLOCKED
jsou accountant OCR/Python PDF, chat-export-budget a export-pdf-docx runtime.
Root default služba 104/104 PASS; source se během profilu nezměnil.
Report `shared-code16k-7cfe4edf-20261002` SHA
`8b181cdd7047d85b2e551068dd8f9b9949a5a71b0a291efb6d54f1d0faff4e65`.

[CI 37004411495](https://github.com/Belphareon-bak/intentsmith/actions/runs/37004411495)
na přesném SHA SUCCESS: CHAT 7/7 a CODE 6/6, všechny Studio/privacy/hygiene
kroky PASS bez SKIPPED. Archiv obsahuje reporty se stejnou source identity,
ZIP 33925 B / SHA `4c8c115673ea00385d58a0d095bf0907cbde18bea39f65df3518ea1984d8a0a2`.
Historické FAILy zachované. CODE source/CPU/CI výsledek není dokončená
fan aplikace ani přijetí releasu; skutečný D1/Studio/M2 průchod zůstává NOT_RUN.

Konkrétní tři runtime BLOCKED byly 12:24:21–12:24:26 UTC ověřené na čistém
`252e839b7e43ea5b0ebc0643cbbaff5473f0360c` s dokumentovaným PDF/OCR runtime:
focused **3/3 PASS**, bez instalace či globální změny. Původní celý profil
zůstává nezměněný. Report SHA
`93f188bfff29f05cda6abaa2979187eb745bfbaeab574754cbecbcead3a03413`.
Preflight runtime receipt
`06c771b8795ce26dcff40f6741b1770a9e90debf3d4f4800b21e8072733d9b8f`
dokládá přesné piny a skutečné ces/eng data; původním options chyběla tato
konkrétní toolchain povolení. Aktuální fan block je actual CHAT routing,
nikoli kontextový overflow nebo zamítnutá GPU; žádný nový modelový běh nebyl.
