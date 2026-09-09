# Core completion: navazující měření M6 — 2026-09-09

Stav: **TECHNICAL_COMPLETION_IN_PROGRESS / MODEL_FAILURES_OPEN / NOT_RELEASE_READY**.
Runtime checkpoint: **2026-09-09 17:08:54 UTC**, čistý source
`6fccb1c2685c0a55eaf5830c76a68173543a692f`.
Autorita: [WP-CORE-COMPLETION](../../../wp/WP-CORE-COMPLETION-20260909.md).
Navazuje na [aktivaci provideru](provider-activation-20260909.md).
Tento dokument ani jeho budoucí commit nejsou novým měřeným source SHA.
Doplnění v 17:09:59 UTC zaznamenává pouze dokončené Guard6 source review.
Samostatné doplnění níže zachycuje přerušení v 17:21 a nový běh v 17:22 UTC.

## Dokončené běhy podle přesného source

| Source | Rozsah | Skutečný výsledek a hranice | Důkaz |
|---|---|---|---|
| `69b52278` | Všech 352 required deterministic programů | **352 PASS, 0 FAIL/TIMEOUT/BLOCKED/SKIPPED**; 279 offline + 73 database, existující dependencies v owned checkoutu | [report][d69], [nezávislé review][d69r] |
| `3b026f40` | Čtyři původní fresh-clone programy | **4 PASS**; skutečná offline npm/Yarn instalace a produkční Studio build; sedm release souborů hashově svázáno | [report][f3b], [nezávislé review][f3br] |
| `828dd4b3` | C12, executor, workflow; pětiprogramový batch | Tyto tři programy **PASS**, celý batch **3 PASS / 2 FAIL** (chat quality a lifecycle context) | [report][fix5] |
| `69b52278` | Chat quality; tříprogramový diagnostics batch | Chat quality **33 PASS / 0 FAIL / 1 WARN**; celý batch **1 PASS / 2 FAIL** | [report][diag], [raw chat log][cqt] |
| `6fccb1c2` | Registrovaná chat persistence | **1 program PASS, všech 36 interních kontrol PASS**, včetně skutečně awaitované singleton kontroly | [report][persist], [nezávislé review][persistr] |
| `69b52278` | Expertise routing | **35/43 PASS, 8 FAIL**; uchováno všech 39 skutečných rozhodnutí; nová Guard6 oracle oprava má pouze source review | [triage][guardtriage], [návrh a review][guardreview] |
| `599ec10a` | Explicitní project listing routing | Integrovaná oprava má **9 focused PASS**; `file.list` zůstává **UNAVAILABLE**, nikoli funkční výpis adresáře | [focused review][listing] |
| `da782aea` | M5 podmíněné credential resolution | **45 focused PASS** (24 + 6 + 15) a integrační source review; žádná skutečná N/A evidence ani acceptance nebyla vystavena | [integrační review][m5] |

Full deterministic běh ověřuje přesný seznam, všechny log hashe, checkpoint,
čistotu source a cleanup; původní phase validator vrací `valid: true`.
Použil explicitně připnutý místní Python PDF runtime. Není to fresh install.
Fresh-clone běh samostatně ověřuje M1 journey, upgrade předchozí verze,
Studio Electron boundary a Studio M1 journey. M1 vnitřní kontrakt má 29/29,
real provider response digest je ověřen a původní release validator přijímá
všech sedm zachovaných build souborů; vlastněný clone byl čistě odstraněn.
Tohle není součet **413 PASS na jednom kandidátu** ani release acceptance.

## Co je opravené a co výsledek neprokazuje

Reviewed registry refresh `573c7d92` sjednotil seal s fingerprintem
`3ce12a0edffe7e6da0f875ce3f0b25758524641557023d00aae39d0784fdbbfc`.
Registry má 512 programů, 413 ACTIVE + required a 19 support exclusions.
Všech 511 předchozích programových řádků zůstalo zachováno; přibyl jeden
required offline mobile program a přesná podpůrná 061 fixture. Rovnost seal,
required/ACTIVE kontroly ani negativní self-testy nebyly oslabeny.
[Párové baseline FAIL / candidate PASS a review][seal] předcházely dnešnímu
352/352 běhu. Historický `a71e5b98` zůstává **351 PASS / 1 sealed FAIL**.

[Skutečné A/B replaye stejného provider requestu][ab] prokázaly nedostatečný limit
256 tokenů u emailu a 64 u `Python` / `?`; při vyšším limitu stejný seed
skončil `stop` na 678 / 127 / 84 tokenech. [Projektový pár 128/256][abproject] naopak
skončil v obou případech na 102 tokenech; tuto vadu nereprodukoval.
Přímé provider A/B obchází produktový handler/finalizer; původní email ještě
neměl nový 150slovný scope. Tyto replaye nejsou nový registrovaný PASS.
Oprava `fa573c41` upravila headroom a rozsah emailu, zachovala strict finalizer.
Následný [skutečný šestipoložkový panel][panel] na tomto source má šest HTTP 200
s `finish=stop`, exact digest a řádnou private DB persistence. Samostatné
haiku/regex sondy nereprodukují původní vícetahový kontext celé modelové sady.

Chat-quality WARN zůstává: populační odpověď neobsahuje čísla, protože
neautorizovaný nástroj vrací poctivé odmítnutí. Opravená pozitivní EN
heuristika zachovává požadavek na angličtinu; není úplný jazykový posudek.
Guard6 návrh nemění produkt: pouze SEARCH/AMBIGUOUS musí přes přesný marker
přejít na CREATIVE; CONVERSATIONAL/CREATIVE se zachovají a emitují ANSWER.
Skutečný pozitivní SEARCH witness a explicit-search/effect/analyst výjimky
zůstávají. Nezávislé source review a 46 inertních kontrol prošly;
nový registrovaný modelový výsledek zatím není součástí tohoto checkpointu.

Listing oprava řeší routing před modelovou arbitráží. Existující M2 consumer
záměrně nevydá obsah přes nepodporované `file.list`; nepřibylo filesystem
oprávnění. Původní lifecycle `69b52278` **24 PASS / 3 FAIL** zůstává zachován.
Persistence oprava pouze doplnila chybějící await: předchozí `69b52278`
registrovaný PASS vykonal 35 z 36 deklarovaných kontrol; nový `6fccb1c2`
prokazuje všech 36. Source baseline grafu byl samostatně přijat v `6fccb1c2`
pro jedinou novou pure formatter hranu (1273 → 1274; 3 cykly / 28 souborů).

## Živý stav a dosud nedokončené práce

[Provider checkpoint][runtime] v 17:08:54 UTC znovu ověřil systémovou
Ollamu `0.32.14-intentsmith.1`, binary SHA `72580ab9…6878a` a všech devět
nezměněných modelových digestů. Běžel jeden vlastní `qwen3.5:27b` s digestem
`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`.
Checkpoint z 13:06 je zachován byte-for-byte; dnešní controlled/private DB
běhy neprokazují nasazení všech změn do živé DB nebo všechny role modelů.

Containment batch 13 programů na `69b52278` je k tomuto checkpointu
**RUNNING_NO_FINAL_VERDICT**. Dílčí dvě PASS a čtyři FAIL nejsou
konečným součtem. Původní v3 na `828dd4b3` má **13 FAIL / 0 provider requestů**
kvůli runtime/infrastrukturní chybě; tento report nebyl změněn na PASS.
Původní soak/throughput na `193e2351` běží od 14:18:55 UTC, čeká na
24hodinové okno a navazující průchod; nejdřívější konec přibližně
**2026-09-10 14:24 UTC**. Zatím nemá finální verdikt ani platnost pro novější SHA.

M5 kód umí podepsaně rozlišit dokončenou rotaci a prokázanou nepoužitelnost
kategorie; původní validní v1 receipt zůstává beze změny. Chybějící současná
konfigurace sama neprokazuje historické nepoužití. Historická fakta, skutečné
externí credential operace, offline custody, history disposition a pravé
podpisy/acceptance zůstávají nedořešené. Žádná z nich nebyla nahrazena testem.
M7 fyzická matice, produkční konfigurace a podpisy zůstávají samostatné.

Další postup k tomuto checkpointu: dokončit aktivní batch a uchovat každý neúspěch; opravit nebo
přesně zdůvodnit zbývající modelové vady, změřit přijaté source změny; potom
zmrazit jeden kandidát pro požadované M6 fáze a jejich společnou validaci.
M5 externí podmínky, skutečný dlouhý soak, nezávislé release review, demo
operátora a podpisy zůstávají podmínkami přijetí. Technická práce pokračuje
pod již schváleným WP, bez přeznačení starých FAIL nebo přeskočení testů.

## Doplnění po checkpointu — 17:21 až 17:22 UTC

V 17:21:28 UTC root ukončil přesný vlastní nightly proces signálem SIGTERM
kvůli opakované D1 SPEC parse chybě, aby nejdřív zachytil původní provider
odpověď. [Nezměněný report][contained] má **2 PASS / 7 FAIL / 4 SKIPPED**:
šest programů skončilo přirozeným FAIL, jeden byl přerušen a čtyři nebyly
spuštěné. Nejde o 13 dokončených assertion běhů ani o přijetí této fáze.
Všech devět spuštěných programů má `cleanup.checked=true`, žádný hlášený
leak; [záznam zásahu][interruption] odděluje tento vlastní proces od soak
běhu a systémového provideru. Historický checkpoint 17:08 výše zůstává zachován.

Guard6 oracle byla mezitím integrována v `1afaf2a8`; [artifact suite][guardartifact]
má **158 PASS / 0 FAIL / 0 SKIPPED** a [registry kontrola][guardregistry] drží
512 programů se stejným fingerprintem. Jde o source/test změnu, její nový
registrovaný modelový výsledek zůstává nezměřený.

V 17:22:29.526 UTC byl spuštěn [jeden původní cookbook program][cookbook]
na nezměněném `69b52278` přes v5 launcher s privátním zachováním raw POST
requestů a odpovědí. Stav při spuštění je **RUNNING / NO_VERDICT**; tento
addendum neuděluje PASS ani nepřenáší výsledek na `1afaf2a8`. Soak pokračuje
samostatně. Další postup je vyhodnotit raw diagnostiku, prokázat opravu příčiny
a zopakovat potřebné původní programy; ostatní release podmínky se nemění.


## Diagnostika příčiny a navazující přímý pokus

Samostatný cookbook program skončil **1 FAIL**, source zůstal čistý `69b52278`
a vlastní scope je neaktivní. [Přesné raw request/response páry][d1raw]
prokazují u všech pěti generování specifikace `done_reason=length` a součet
prompt/output tokenů přesně 4096: 3061+1035, 3048+1048 a třikrát 2868+1228.
Všechny mají HTTP 200 a správný modelový digest. První analizační volání
skončilo zvlášť `stop` (1074+2118); specifikace se nepodařila načíst.
Příčinou těchto pěti selhání je vyčerpání sdíleného kontextu, nikoli dosažení
samostatného výstupního limitu 4000. Žádný provider profil se tím nemění.
Přímý soukromý pokus s kompaktním zápisem stejných vstupních hodnot také
skončil `length` (2263+1833); tento nepřijatý návrh není produktovou opravou.
Další oprava musí zachovat všechny povinné části, dovolit pouze omezené
modelové kroky a nikdy neuložit neúplnou specifikaci jako hotovou.

## Evidence

Odkazy míří na původní reporty nebo review, které připínají všechny raw hashe.
Nové doplnění připíná contained report SHA-256
`bc24dbb0b129e35a64ec0a84c81c5977434bfd4f18e5107b174bc305d43f7987`;
A/B evidence review SHA-256
`5f24424abeaf2f51a28e2723e1172e71c0a0ff2b0ae4edd03e7daa04e1411dd4`.
Provider checkpoint SHA-256 je
`5c1857df9ed0a669acc642f18bd9757a681a1dd14fbc1a93153d6fc80ad7fa0a`;
[nezávisle ověřená coverage 44 modelových ID][coverage] dokládá výběr všech
původních ID napříč běhy, nikoli společný PASS. Staré `193e2351` safe25
**11 PASS / 14 FAIL**, `828dd4b3` fresh4 **3 PASS / 1 FAIL** i neúspěšný
první build-copy wrapper zůstávají historické; jeho následná hashově přesná
path recovery opravila uchování sedmi build souborů, nikoli výsledek testů.

[d69]: ../../../../.intentsmith-artifacts/core-completion-20260909/deterministic-current/core-deterministic-69b52278-20260909-02/report.json
[d69r]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/deterministic-69b52278-independent-review.json
[f3b]: ../../../../.intentsmith-artifacts/m6/candidate-3b026f40521e445c8e7c2da91a262e12704bfdb7/fresh-clone/report.json
[f3br]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/fresh-four-3b-independent-review.json
[fix5]: /home/belphareon/is-m6-work09-a7ba5490/repo/.intentsmith-artifacts/m6-fixes5/core-fixes5-828dd4b3-20260909-01/report.json
[diag]: /home/belphareon/is-m6-work09-a7ba5490/repo/.intentsmith-artifacts/m6-diagnostics3/core-diagnostics3-69b52278-20260909-01/report.json
[cqt]: /home/belphareon/is-m6-work09-a7ba5490/repo/.intentsmith-artifacts/m6-diagnostics3/core-diagnostics3-69b52278-20260909-01/logs/tests_chat-quality.test.js.dde7f77e.log
[persist]: ../../../../.intentsmith-artifacts/core-completion-20260909/persistence-gap/core-chat-persistence-6fccb1c2-20260909-02/report.json
[persistr]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/chat-persistence-6fccb1c2-independent-review.json
[guardtriage]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/expertise-eight-69b52278-triage.json
[guardreview]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/expertise-guard6-oracle-69b52278/independent/review-04c431e7.json
[listing]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/lifecycle-listing-proposal-69b52278/independent/review-listing-07f2d5b9.json
[m5]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/m5-na-integrated-01/independent-integration-review.json
[seal]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/gate0-seal-proposal-a7ba5490/independent-review.json
[panel]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/truncation-fa573c-independent-evidence-review.json
[runtime]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/provider-runtime-checkpoint-20260909-followup-01.json
[coverage]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/m6-model44-coverage-20260909-02.json
[ab]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/truncation-headroom-six-independent-evidence-review.json
[abproject]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/truncation-headroom-six-independent-review.json
[contained]: /home/belphareon/is-m6-work09-a7ba5490/repo/.intentsmith-artifacts/contained-core-contained13-69b52278-20260909-02/gates/core-contained13-69b52278-20260909-02/report.json
[interruption]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/contained13-69b52278-interruption-01.json
[guardartifact]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/expertise-guard6-oracle-69b52278/root-artifact.log
[guardregistry]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/expertise-guard6-oracle-69b52278/root-registry.log
[cookbook]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/raw-cookbook-v5-69b52278-01/root-invocation.json

[d1raw]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/d1-raw-context-ceiling-69b52278.json
