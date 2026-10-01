# GPU Hunt — cesta od vývojové matice k přijatému rozhodnutí

## Poslední strukturální kontrola — 1. 10. 2026, 13:31 UTC

Read-only canonical verifier nad stejným frozen packetem znovu skončil exit 0:
106 batch souborů, **596/1173 / 2324/3689 kritérií**, chybí **577/1365**.
Accepted grader false, NO_DECISION / activation NO_GO. Result SHA-256
`22f46b6bf7dc3d8e285e9f85c3930e47933ba4c45f0b09fd597f957bd34c608e`
zůstává shodný s 11:32 UTC. Grade tree před/po měl stejný SHA-256
`ebfeeef1e834bd83998177227bde7b3b26c815fa01d1da6fbeef941552f83c86`.
Žádné nové grading/model/GPU/DB write tímto nevzniklo. Soukromý SUMMARY
v owned Hunt checkoutu má SHA-256
`ece4d20a913ab94ca0db7d00104d606d36c451f125c68f3cada153d9be2ce4da`.
Jde o datovaný strukturální důkaz, nikoli tvrzení, že cizí evaluátor přestal.
Hunt checkout `00c71cd4` je později dočasně uvolněný pro frozen SQLite936
v témže checkoutu; původní ref i 19 ignored důkazů zůstávají uchované.

**Aktuální stav 1. 10. 2026, 10:11 UTC:** `READ_ONLY_AUDIT_PASS /
HANDOFF_INTEGRITY_REVIEW_PASS / DEVELOPMENT_REVIEW_INCOMPLETE / NO_GO`.
Není nové hodnocení, přejímka hodnotitele, rozhodnutí ani aktivace role.

## Čerstvý durable audit a běhové prostředí

Čerstvý strukturální validátor z `10:06–10:07 UTC` stále ověřuje
**596/1 173 odpovědí / 2 324/3 689 kritérií**; žádné přijaté hodnocení.
Jeho durable receipt v stagingu
`.intentsmith-artifacts/hunt-freshness-20261001-1008/` má manifest SHA-256
`bafefa58386cc0a20f281f536609be3407c5a18ba1415f66d27829b6f1b659ed`.
Nezávislá revize potvrdila všech 12 položek. Jeho canonical collections
reader skončil exit `1 / ERR_MODULE_NOT_FOUND better-sqlite3`; tento FAIL
zůstává zachovaný.

Root doplnil pouze vlastní ignored dependency symlink v čistém Hunt
checkoutu `00c71cd4b4c211715b6ac0cc0ce5678146c23e58` na již existující
integrační `node_modules`. Oba lockfiles shodně pinují `better-sqlite3`
`12.6.2` se stejným integrity. Nebyla instalace, změna source, migrace ani
změna produkčního běhového prostředí. S připnutým Node `24.21.0` skutečný
`scripts/audit-hunt-collections.mjs --db=<installed data/c3.db>` doběhl
exit `0`; report má `generatedAt 2026-10-01T10:11:45.848Z` a SHA-256
`1cb19a26c13fcc1ab6c7cc0e31039ec50db7a6f52705d9fcf9f9c17e415ba312`.
Soukromé report/stderr/provenance/summary jsou v
`.intentsmith-artifacts/hunt-native-readonly-20261001-1010/` Hunt checkoutu,
mode `0700/0600`. Samostatná nezávislá revize má **REVIEW_PASS**:
source read-only call graph, dependency provenance, raw bytes a přesná
projekce rolí/exclusions ověřené bez opakování readeru. Report v stagingu
`.intentsmith-artifacts/hunt-native-readonly-review-00c71cd4-20261001/REVIEW.json`
má SHA-256
`cd229e96a2b9fd0feea77db7f4a18a533a3a3f7454bd61003ffad977ba379b47`;
manifest SHA-256
`57e3567161fefb6018f8aee984e4e5e8652f08c228c08675e2878d33ee479478`.

Reader otevřel skutečnou instalovanou DB s `readonly:true` a
`fileMustExist:true`; provider nečetl a inference nevolal. V této DB má
CHAT 2 compatible captures od jednoho artefaktu; D1/D2/R1/R2/CODE/VISION
mají 0. `providerVersionFilter:null` proto správně znamená 0 automatic
reusable captures. Všechny role mají `decisionReady:false` a sémantické
role 0 accepted graders. Toto čtení posuzuje pouze instalovanou DB,
nikoli oddělený vývojový packet 1 173 odpovědí; neodmítá jeho obsah.

Připravená slepá vlna 144 odpovědí / 330 kritérií a zbývající fronta
433/1 035 má samostatné integrity REVIEW_PASS, ale stále
`NOT_EVALUATED / NO_DECISION`. Zjištění vlastníka probíhajícího externího
hodnocení čeká; bez něj se nesmí spustit duplicitní placená práce.

## Historický výchozí audit

**Stav 1. 10. 2026, 03:34 UTC:** `READ_ONLY_AUDIT / DEVELOPMENT_WAVE_PLANNED /
REVIEW_PENDING / NO_GO`. Podklad je čistý integrační source `a199a5d1` a
instalovaná databáze čtená výhradně v režimu read-only. Tento pracovní balík
neobsahuje nové hodnocení modelem, GPU běh, zápis do databáze, změnu vazby role
ani zásah do služby. Počty jsou aktuální snímek, ne trvalý stav.

## 1. Co znamená „hodnocení dobíhá“

Vývojová matice deseti přesných artefaktů obsahuje 1 984 pokusů; u 1 980
úplných odpovědí je první hodnocení nebo mechanická kontrola. Aktuální
strukturální validátor zmrazeného druhého packetu (`packet.json` SHA-256
`08d0ab7e92dc324d2a8e9e210d7b32525167b8eb7db2810b7fed55f31e7d4726`)
ověřil 106 raw dávek proti Git manifestu SHA-256
`1d85c8e1ce0a7735e3b53961ffc1df961fbc01eace2c3feaf26ec182207d2bab`.
Výsledek je **596/1 173** odpovědí a **2 324/3 689** kritérií; 577 odpovědí
chybí. Rozpis: CHAT 400/400, CODE 30/30, D1 166/180, D2 0/189,
R1 0/179, R2 0/195. Posuzovatel je **Claude Sonnet 5.5, nikoli Opus**.
Validátor ověřuje strukturu, identitu a hashe, ne správnost známek. Výstup
zůstává `DEVELOPMENT_REVIEW_INCOMPLETE / NO_DECISION / acceptedGrader:false`.

Čtení instalované `data/c3.db` autoritativním
`scripts/model-evaluation-report.js` ukázalo 14 instalovaných artefaktů a
98 model–role buněk: **84 použitelných MISSING, 14 N/A, 0 současných
COMPLETE**. Sedm trvalých vazeb má při samostatném CLI čtení
`UNVERIFIED_RUNTIME`; `model_evaluation_acceptances` má 0 řádků. Starších
1 012 běhů a 234 rozhodnutí v append-only historii není současné přijetí.
`audit-hunt-readiness.mjs` vrací `NO_GO`: neověřený runtime binding, konflikt
současné sestavy rolí, neúplné současné pokrytí a chybějící přejímka.
Instalovaný interaktivní provider je `0.34.0-intentsmith.1`, připnutý
evaluační sidecar `0.34.2-intentsmith.1`; nový CHAT sběr v matici použil
`0.34.2-intentsmith.2`. Tyto identity se nesmí zaměnit. Dva automaticky
znovupoužitelné CHAT capture z DB jsou od jediného qwen3.8 artefaktu;
`currentContractMatches:false` a žádný z nich není současné skóre.

Deset digestů z vývojové matice stále přesně odpovídá deseti nainstalovaným
artefaktům. Další čtyři instalované artefakty (Granite4, Selene Mini,
Llava Llama3 a Llava 13B) ve vývojové matici nejsou. O jejich kvalitě nelze
z této matice odvozovat pořadí.

## 2. Předem uzamčená vývojová revizní vlna

První omezená vlna má zodpovědět, zda druhý posudek může změnit pořadí
nebo proveditelnou sestavu. Soukromý `identity-key.json` slouží pouze
k výběru anonymních indexů; hodnotitel dostane původní slepý packet,
nikoli klíč, první známku nebo výsledkovou tabulku. Pro každou níže uvedenou
dvojici role/model se vezmou **všechny** dosud neohodnocené odpovědi packetu,
bez výběru podle příznivého skóre. Zmrazí se seznam indexů a hash před
otevřením nových známek. Již existující staré druhé posudky pro stejné
odpovědi se nejprve spárují podle digestu odpovědi a rubriky; jiný profil
nebo odpověď nelze převzít.

| Role | Kandidáti a počty chybějících odpovědí | Celkem | Kritéria |
|---|---|---:|---:|
| D1 | Gemma4 3; qwen3.8, qwen3.6 a qwen3.5 mají v tomto packetu svůj zbývající rozsah ohodnocený | 3 | 12 |
| D2 | Gemma4 9; qwen3.5 21; qwen3.6 9; qwen3.8 6 | 45 | 180 |
| R1 | qwen3.5 24; qwen3.6 9; qwen3.8 9 | 42 | 84 |
| R2 | současný Devstral 12; qwen3.5 21; qwen3.6 12; qwen3.8 9 | 54 | 54 |
| **Součet** | | **144** | **330** |

Těchto 144 případů tvoří přibližně čtvrtinu 577 chybějících odpovědí.
Jejich samotné JSON položky mají 3 344 060 bytes; společný kontext,
rubriková politika, výstup hodnotitele a režie přenosu jsou navíc. To není
odhad účtovaných tokenů ani peněz. Před externím během se změří skutečná
tokenizace a pevný rozpočet. Vlna je **vývojová triáž**, nikoli dostatečný
vzorek pro tvrzení o nejlepším modelu. Jestliže nelze ostatní kandidáty
vyloučit podle mezí v §3, může být nutné druhým hodnotitelem dokončit
všech **577** chybějících odpovědí známé matice, tedy po první vlně dalších
**433 odpovědí / 1 035 kritérií**. Již hotových 596 posudků se zbytečně
neopakuje. Ani úplná vývojová matice nenahrazuje současné měření a nový
holdout.

CHAT 400/400 a CODE 30/30 nepotřebují pro tento packet další **chybějící**
druhý posudek. Potřebují věcnou revizi. Posuzovatel CHAT původně nečetl
`shared-system-context.json`; po jeho nalezení opravil 34 záznamů, z toho
13 známek. Zmrazená kontrola musí ověřit všech 100 dialogů pěti předem
určených párů úloh `ambiguous_handoff`, `corrected_project`,
`time_explanation`, `meeting_window`, `unknown_release` ve všech deseti
anonymních modelech a dalších 10 jedinečných dialogů z revizního logu mimo
tyto úlohy. Revizní log má 34 změn kritérií, ale jen 31 různých dialogů;
překryvy se nepočítají dvakrát. Doplní se přesně **jedna dosud nekontrolovaná
CZ/EN dvojice na anonymní label A–J**, tedy 20 dialogů. Pro každý label se
vyřadí pět uvedených úloh a každý základ úlohy, jehož CS nebo EN dialog je
v revizním logu. Z ostatních dvojic se vezme lexikograficky nejmenší SHA-256
UTF-8 řetězce `08d0ab7e92dc324d2a8e9e210d7b32525167b8eb7db2810b7fed55f31e7d4726:CHAT-CONTEXT-AUDIT-v1:<label>:<base-task>`;
při shodě hashů rozhodne název základní úlohy podle UTF-8 bytů. Tento seed,
algoritmus a velikost se uzamykají před věcným auditem; celkem jde o **130
unikátních dialogů z 400**. U každého se posuzuje celý skutečný systémový
kontext včetně hodin, jazyka a historie. Jedna materiální společná chyba
rozšíří kontrolu na všech 20 CS/EN dialogů dané úlohy napříč modely; chyba
jdoucí napříč úlohami rozšíří kontrolu na všech 400 dialogů. Výběr,
překryvy a rozsah se před kontrolou uloží do verzovaného neveřejného
manifestu; jeho hash se zveřejní.
CODE posudek sám uvádí, že `api` složku přepočetl z hodnot v packetu a
nejde o nezávislé technické orákulum; `meaning` má odlišnou sémantickou
autoritu. Před pořadím CODE se musí ověřit API replay, meaning politika a
skutečně dosažený konečný stav opravy v produkčním profilu.

## 3. Agregace, spory a nerozhodné pořadí

Vývojová agregace zachová autoritu matice: u D1/D2/R1/R2 nejprve průměr
kritérií odpovědi, potom tří opakování dané úlohy a stejnou váhu osmi úloh.
CHAT má na celý dialog váhy 40/30/20/10 % pro fakta, použitelnost,
konverzaci a komunikaci; CS/EN protějšek tvoří jednu skupinu původu, takže
40 dialogů představuje 20 skupin. CODE drží spustitelné orákulum a význam
odděleně; provizorní 0,5 + 0,5 průměr není přijaté plné orákulum. VISION
vyhodnocuje skutečné různé obrazy; identická deterministická opakování
nejsou další nezávislé případy. Součet všech rolí do jednoho skóre neexistuje.

Před použitím nových známek se pro každé kritérium porovnají dva původní
posudky. **Jakýkoli rozdíl ve známce kritéria nebo rozporný důvod je spor**;
není přijata žádná tolerance. Stejný součet jej neuzavře. Faktická výhrada,
`TASK_ISSUE` nebo signál kritické brány navíc pozastaví doporučení do
ověření. Spor se rozsouzuje nad celým výstupem a veřejnou rubrikou:
nejprve se ověří fakt, případný třetí kvalifikovaný posudek vznikne naslepo
a operátor rozhodne nevyřešené měřítko. Třetí posudek není automatické
hlasování 2:1.
Původní posudky se nepřepisují, rozsouzení má vlastní provenienci.
Bez druhého posudku či rozsouzení se nepočítá přijaté skóre.
Současná funkce `reconcileGraderReviews()` porovnává číselné části, stav
a kontrolní pole, ale ne volný text důvodů. Kontrola rozporných důvodů proto
vyžaduje samostatný věcný audit; případná automatizace je další implementační
úkol a toto WP ji nevydává za hotovou.

Pro **průzkumnou frontu** je nerozhodné pořadí, když rozdíl je pod 5
procentních bodů, přednost nese méně než tři nezávisle rozlišující úlohy,
anebo možnost obratu při nehodnocených odpovědích překryje rozdíl.
Diagnostický interval přes celé skupiny lze ukázat, ale není přijatou
produkční rozhodovací metodou. Vývojový výsledek nedává souhlas ke změně
bindingu. Kvalita proti současnému modelu, latence a kritické brány jsou
samostatné osy.

Po první vlně je fronta zmrazena v pořadí rolí **D1 → D2 → R1 → R2**;
uvnitř role podle UTF-8 bytů přesného názvu modelu z neveřejného klíče,
uvnitř modelu podle původního pořadí `packet.cases`. Vždy se bere celý
zbývající rozsah odpovědí modelu v roli. Počty k dosažení úplných 577 jsou
D1 **11**, D2 **144**, R1 **137**, R2 **141**. Před použitím nové známky lze
odložit kandidáta pouze tehdy, když jeho optimistická horní mez je menší
než pesimistická dolní mez již posouzeného způsobilého kandidáta v téže
roli a zároveň odložený artefakt nemůže zlepšit žádnou přípustnou sestavu
rolí. Meze používají váhy agregace výše a pro **každé dosud nerozsouzené
kritérium celý interval [0, 1]**; první známka není náhradou chybějící
druhé známky. Rovnost, překryv intervalů, chybějící důkaz o portfoliu nebo
nerozhodná kritická brána znamená rozšířit podle fronty. Široké meze mohou
v praxi vynutit všech 433 zbývajících případů. Pokud rozpočet nebo
kvalifikovaná nezávislá dvojice nestačí, výstup je
`NO_DECISION / REVIEW_INCOMPLETE`, bez předčasného vítěze. Čtyři
nainstalované artefakty mimo známou matici touto mezí nelze vyloučit;
pro výrok „nejlepší ze všech instalovaných“ potřebují samostatnou
applicability a případně současné přesné měření.

## 4. Následující milníky a stop podmínky

1. **Přijmout zdroj revize.** Nezávisle zkontrolovat manifest 106 souborů,
   čtyři evidenční podklady (packet, kontext, CODE politika, klíč identit),
   34 revizí a věcnou kvalitu stratifikovaného vzorku. Ověřit staré párové
   posudky na přesných odpovědích. Vytvořit verzovaný slepý výběr 144 případů
   se soukromými indexy a veřejným agregovaným manifestem. Nepřesný hash,
   nesoulad identity nebo expozice prvních známek běh zastaví.
2. **Dokončit vývojový pár a spory.** Nezávislý kvalifikovaný hodnotitel
   posoudí omezenou vlnu, zapíše důvody a citace. Validator ověří každý
   nový raw soubor před přidáním do manifestu. Spory se rozsouzejí podle
   pravidla výše; chybějící odpověď zůstane chybějící. Pokud kandidát mimo
   vlnu může podle mezí, portfolia nebo nového faktu převzít roli, otevřou
   se další bloky podle pevné fronty v §3 až do vyloučení, úplného pokrytí
   nebo `NO_DECISION / REVIEW_INCOMPLETE`.
3. **Přijmout měřidlo.** Pro každou sémantickou roli postavit oddělený
   zaslepený přejímací soubor s nezávislými skupinami, pozitivními i
   negativními příklady a syntetickými vadami. Ověřit falešná přijetí,
   odmítnutí, pořadí kritérií, schopnost `null` a společné chyby dvojice.
   `semantic-grader-acceptance.js` vyžaduje nejméně 20 nezávislých skupin
   a osm případů každé třídy pro typ úlohy; žádný současný záznam přejímky
   neexistuje. Když kvalifikovaná dvojice nevznikne, výstup je
   `GRADER_ACCEPTANCE_BLOCKED`, nikoli provizorní GO.
4. **Změřit současný přesný artefakt.** Na finálním čistém source a
   připnutém sidecaru sériově ověřit kandidáta i současný model podle
   digestu, suite SHA, runtime, profilu a provider response atestace.
   Před každým GPU oknem ověřit volné VRAM, skutečné NVIDIA compute procesy,
   `ollama ps`, diskovou rezervu a cizí lease. Nic cizího neukončovat.
   Čtyři artefakty mimo matici nejprve projdou levnou applicability a
   profilem schopností; jen potenciálně rozhodující dostanou nákladný sběr.
   Dva staré CHAT capture qwen3.8 lze použít jen po konkrétním ověření
   promptu, options a odpovědí; nejsou skórem pro jiný model.
5. **Provozní kvalifikace a sestava.** Před sběrem čerstvého holdoutu
   přijmout metriku, metodu, minimální přínos/toleranci, sílu a rozpočet.
   Dnešní KL cesta je při malých mezích prakticky obtížná; párový t ani
   percentilový bootstrap nebyly přijaty jako náhrada a vzácné propady
   mohou dát chybné přijetí. Oddělený holdout nesmí obsahovat vývojovou
   matici. Ověřit absolutní brány, latenci a celé portfolio včetně
   současných konfliktů D1+CHAT na qwen3.5 a D2+CODE+R1 na qwen3.8,
   fallbacků a zákazu vlastní revize. Verdikt je
   `ZMĚNIT / PONECHAT / NEROZHODNUTO` s přesnými důkazy.
   Aktivace je samostatný řízený krok až po přijetí výsledku; timer a
   produkční vazby zůstávají beze změny během této přípravy.

## Reprodukce tohoto checkpointu

```bash
node scripts/model-evaluation-report.js --json --db=/home/belphareon/Projects/intentsmith/data/c3.db
node scripts/audit-hunt-readiness.mjs --db=/home/belphareon/Projects/intentsmith/data/c3.db
node scripts/verify-hunt-second-review-batches.mjs \
  --packet=/mnt/vi7000/intentsmith/evidence/hunt-matrix-completion-20260928/matrix/second-review/packet.json \
  --grades-dir=/mnt/vi7000/intentsmith/evidence/hunt-matrix-completion-20260928/matrix/second-review/grades-sonnet-5-5 \
  --expected-packet-sha256=08d0ab7e92dc324d2a8e9e210d7b32525167b8eb7db2810b7fed55f31e7d4726
```

Příkazy jsou read-only; první dva vyžadují místní DB a provider inventory,
třetí soukromý packet. Výběrové indexy, odpovědi a soukromý report se do
Git neukládají. Tento checkpoint doplňuje
[aktuální skórovací stav](../MODEL-SCORING-ACTIVATION.md),
[strukturální validaci](WP-HUNT-SECOND-REVIEW-BATCH-VALIDATOR-20261001.md),
[vývojovou matici](../review/2026-09-28-HUNT-MATRIX-COMPLETION.md) a
[metodický stress test](../review/2026-09-24-HUNT-DECISION-FEASIBILITY.md).

## 6. Frozen non-CHAT handoff — 2026-10-01 08:47 UTC

The previously committed selection is now prepared privately and has
independent **HANDOFF_INTEGRITY_REVIEW_PASS**. The read-only verifier again
confirmed 596/1173 existing second reviews (2324/3689 criteria). Every one
of those 596 is excluded from the new wave and queue. First wave is exactly
144 responses/330 criteria; remaining 433/1035 form 23 complete blocks in
the role/model/original-index order specified above. Their union is exactly
the 577 missing cases. Both source packet and frozen 106-batch manifest
still match their existing hashes. All selected questions, rubrics, response
bytes, IDs and original indices match; reviewer metadata has no real model
identity or first grades. Every one of the 144 was independently paired
with its actual source capture, complete user prompt and exact answer,
without missing non-CHAT context. CHAT/CODE cases are absent.

Private evaluator-facing wave SHA:
`d89dae739fb7bf527dce22c1f55e975ff5515bfb7b962e364f878e572d02aada`.
Private remaining-queue SHA:
`9129a04c439cb37f4c1b3ce7ba157bf8fd6f610523a0b1e532ee177b5ee11d72`.
Aggregate summary SHA:
`bac646c600e1e8c917dd6295a86efbc6d6be55bc5d3e35e137fcf11bccebb171`.
Files live only under the author checkout's ignored 0700/0600
`.intentsmith-artifacts/hunt-second-review-handoff-20261001-wave1`.
They were not uploaded or pushed. The evaluator must receive only the
reviewer directory, never the restricted identity/selection material.

Integrity acceptance does not establish valid grades, accepted evaluator
qualification or role ordering. **NOT_EVALUATED / NO_DECISION / NO_GO**
remain. No external model calls or grading took place. Root requested the
current grading owner to avoid duplicating ongoing work or expense; other
non-CHAT completion milestones continue while that input is pending.
