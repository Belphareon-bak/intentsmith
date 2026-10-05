# WP — skutečná HTTP kvalifikace M2 v soukromém loopbacku

**Autorita:** explicitní souhlas operátora 4. 10. s navazujícím WP podle
[původního návrhu](WP-M2-PRIVATE-HTTP-QUALIFICATION-PROPOSAL-20261001.md).
**Vlastník:** ROOT, jediný tracked writer. Vstup `5cf1c36d`, existující checkout;
čerstvý GitHub main `838b8cee` je ancestor. Žádný nový worktree.
**Stav:** `PRODUCT_V2_ADOPTED / BOUNDED_SOURCE_REVIEW_PASS /
CONTROLLED_NATIVE_PROVIDER_PASS / GENERATED_HTTP_NOT_RUN`.
Nezávislé omezené design/scope review na `92767d77`: receipt
`ebcf2fad2bcd29363643ed3363c062979d7b9f54a55b3b57d0282f45e645e2fc`.
V2 schema/native source a skutečné product controls mají následné review/gates.

## Výsledek a hranice

Jeden skutečný focused test generované HTTP/SQLite aplikace: nový soukromý
user/net namespace, server a chráněný oracle, přesný IPv4/TCP `127.0.0.1:P`,
RO projekt, DB v private `/tmp`. Dva serverové procesy v téže invokaci ověří
stejnou DB. Samostatný restart BE ověří M2 approval/effects/terminal/commit,
nikoli přenos tmpfs mezi invokacemi. Úplné zdroje určují preview/digest/zápis.
Focused proces nedostane host listener/socket FD; žádný veth, egress, DNS, UDP, IPv6, AF_UNIX, fallback,
produkční DB/služba, mobilní transport, CHAT nebo modelová aktivace.

## Vlastněné cesty a connector

Nový explicitní `ProjectChangeRequest@2`, `ProjectChangeResult@2` a
`M2PrivateHttpNetworkPolicy@1` v `contracts/m2/execution-v2.js` jsou návrh
pro nezávislé kontraktové review. `execution-v1.js/PINNED_V1` a jeho default
`linux-bwrap-ro-v2` si zachovají dosavadní wire/digest/offline chování.
Nejmenší navazující volba je nový `LifecyclePlanSnapshot@2` v
`contracts/m2/lifecycle-v2.js`; jeho focusedTest obsahuje celou schválenou
network policy a trusted artifact refs. ApprovalIntent@1, TerminalSnapshot@1
a GovernanceDecision/Receipt@1 zachovají obálky a existující approval port.
Nové dispatch/crosscheck moduly explicitně delegují V1 do nezměněného V1;
V2 musí přesně svázat request/plan/process/result. Unknown/mixed1↔2 odmítnout.
Nutné wrappery pro governance crosschecks nesmějí změnit `governance-v1.js`.
Nezbytný version dispatch: `src/lifecycle/m2-proposal-compiler.js`,
`src/lifecycle/m2-lifecycle-application-service.js`,
`src/lifecycle/m2-governance-evaluator.js`,
`src/lifecycle/m2-lifecycle-authority-repository.js`,
`src/execution/execution-authority-repository.js`,
`src/execution/project-change-planner.js`, `project-change-runtime.js`,
`process-sandbox-provider.js`, `process-supervisor-child.js`.
Nová named migration/schema gate přidá nové SQL validators/trigger dispatch;
registrace musí fungovat i při reopen po legacy registrar. Migrace078/079
a historické requesty/digesty zůstanou byte exact, bez zpětného přepisu.
Jediný trusted native initializer `src/execution/private-http-launcher.c`
a build hook `scripts/build-private-http-launcher.mjs`; jeho přesný inode,
bytes, argv a policy nejsou modelovou/projectovou cestou.
Privilegovaný setup má pevné trusted prostředí: projektové focusedEnvironment
včetně LD_PRELOAD/LD_LIBRARY_PATH smí dostat až omezený aplikační child po
cap-drop, nikdy initializer před omezením. Použít static/trusted launcher.
Preview: `intentsmith-ide/extensions/intentsmith-studio2/lib/browser/m2-controller.js`
a `intentsmith-ide/extensions/intentsmith-studio2/lib/browser/view/live-model.js`.
Composer `lib/browser/m2-composer.js` pouze pokud profile dostane explicitní
opt-in v composeru; aktuální raw proposal/stejný origin/planDigest port stačí.
Nynější raw opt-in vyžaduje i zachování úplné policy při form/reload/edit;
ROOT proto vlastní nezbytný composer/controller connector. První omezený V2
přijímá pouze focusedEnvironment `{}`; jiné ENV vrátí konkrétní chybu před
efektem, nic se potichu nezahazuje. Předávání ENV až server child je budoucí
samostatná schopnost; současný launcher má pevné startup prostředí.
Default `src/server.js` neposkytuje provideru trusted refs; skutečný Studio
průchod potřebuje explicitní operator config connector. Nezbytné vlastněné
cesty jsou proto také `src/server.js`, omezený config reader v
`src/execution/private-http-config.js` a qualification serverEnvironment
v `scripts/run-project-build-journey.js`. Config může pouze dodat reference
pro dodatečnou kontrolu důvěry; schválená úplná policy/payload stále určují
veškerou procesní autoritu. Default bez opt-in zůstává V1, žádné nasazení.
Existing execution/lifecycle/process-sandbox/Studio sady
a nezbytná nová network contract suite; registry regenerovat až z finálního
stromu. CPU sondy zůstávají izolované privátně, nejsou produktový launcher.

## Mechanismus a konkrétní technická nejasnost

Trusted initializer musí mít práva v user namespace, které vlastní nový net
namespace; před jakýmkoli netlink zápisem ověří identitu a pouze lo. Atomický
nft default-drop povolí jen přesný endpoint a jeho odpovědi. Po setup uzavře
setup/namespace/netlink FD, odebere všechny capabilities i bounding set,
nastaví NNP, Landlock bind/connect pouze port P a seccomp IPv4/TCP; namespace
escape, io_uring/keyctl/ptrace, ostatní socket families/types se odmítnou.
P musí být explicitní1024..65535, nikoli0/hostname/wildcard/alias.

nft vynucuje dosažitelný packet endpoint; samotný wildcard bind může uspět.
Oracle musí ověřit skutečný listener `127.0.0.1:P` a odmítnout jiný listener;
negativní test i při wildcard musí prokázat nedostupnost127.0.0.2. Netvrdíme
syscallovou kontrolu sockaddr ze seccomp. [Kernel Landlock](https://docs.kernel.org/7.0/userspace-api/landlock.html),
[nft packet matching](https://wiki.nftables.org/wiki-nftables/index.php/Matching_packet_headers).

První ROOT sonda: bwrap/netNS/lo/CAP_NET_ADMIN uspěly, nft setup selhal EPERM.
Následná read-only kontrola se stejnými caps1100/AppArmor profilem: nested
`--disable-userns` → GETGEN errno1/nft exit1; owning-userNS control → GETGEN0,
nft0 a owner inode=self. Zdrojové vysvětlení: bwrap vytvoří druhý userNS,
který nevlastní předchozí netNS. To není důkaz potřeby host root/AppArmor změny.
Omezená další strategie zachová disable-userns; trusted init vytvoří nový
netNS v aktuálním nested userNS s dočasným namespaced SYS_ADMIN, nastaví lo
a nft, následně všechny caps odebere. V2 prokázal owner inode=self; jeho první
další stop byl ENOENT: host `/usr/sbin/ip` je symlink přes nemountovaný `/bin`.
Jediná kanonická oprava `/usr/bin/ip` zachovala všechny ostatní bytes/controls.
ROOT skutečný probe 19:26 UTC PASS: literal HTTP a wildcard control;127.0.0.2
nedostupné, jiné porty/AF_UNIX/IPv6/UDP/NETLINK odmítnuté, Landlock ABI8,
všechny child capsets/Bnd0, NNP1/seccomp2, SYS_ADMIN regain a další NS odmítnuté.
Source `acc4a918b8a4e306fc212cd10ff9a2363ad0cc087c88d887ddc32334b5d80942`.
Oba předchozí FAIL a diagnostický log jsou zachované. Je to trusted Python
CPU proof, nikoli native launcher, registrovaný profil či funkční HTTP aplikace.

## Approval, pozitivní/negativní test a stop

Policy/profile/address/port/launcher/nft/seccomp/oracle digests musí být
součástí requestu, focused process effect payload, authoritySetDigest,
planDigest a zobrazeného exact approval; žádná dodatečná env/options autorita.
Exact launcher/oracle bytes, inode/FD a policy ověřit při prepare a znovu
před prvním forward file effect, nejen v pozdějším provider.run. Oracle je
vlastní RO/FD pin mimo modelové targets; generovaný server je oddělený child,
nikoli import/exec projektového kódu v trusted oracle procesu.
Stale/foreign/tamper/unknown version selže před prvním file effect. Drift
před exec a jakákoli pozdější chyba znamenají atomický rollback celé sady.
Trusted oracle čte skutečné HTTP status/Content-Type/úplný bounded JSON a
samostatně SQLite řádky/schema/constraints pro zmrazené CRUD/batch operace.
False child marker, špatná DB, neúplná odpověď nesmí projít.
Skutečné socket negatives: jiný port/adresa, mappedIPv4/IPv6, DNS/UDP,
AF_UNIX/raw/PACKET/NETLINK, host/inherited FD, namespace/cap regain.
Cancel/timeout/crash/leaked child: celý owned PGID vyklizený, sockety zavřené,
rollback, Git HEAD/foreign bytes zachované, durable non-success, žádný commit.

Po mechanism proof: nezávislé contract review → bounded produktová implementace
→ V1 + nové controls/CI → nový zmrazený model/oracle/call budget → skutečné
M2 preview/approval/HTTP/SQLite/commit/restart → jedno nezávislé actual review.
Jakákoli nedoložená hranice, unavailable kernel mechanism nebo nevyklizený
child profil zastaví; žádná host síť/plain spawn. Dvě iterace bez měřitelného
posunu vyžadují diagnózu/změnu strategie; další omezený FAIL přesnou eskalaci.
První přesný ověřovací příkaz (již provedený se source hash/review):
`/usr/bin/python3 .intentsmith-artifacts/m2-private-http-probe-v2-canonical-ip-20261004/probe-owned-namespace-v2.py`,
timeout25s +3s cleanup. Produktové test příkazy
připnout podle přijatého V2 kontraktu před adopcí, nikoli vymyslet neexistující
PASS. Milník končí skutečnou aplikací/review nebo doloženým blokérem.

## Integrační checkpoint 5. 10. 2026

ROOT převzal přesné reviewed pure contracts, provider, SQL122, planner/runtime,
compiler/default service/composer/controller a explicitní startup connector.
V1 zdroje078/079/106 a wire/digests jsou zachované; žádný model activation/deploy.
Souhrn šesti nezávislých source reviews a20 public source pins: receipt
`5599f163986e7b091e366bfa5060d39ee275ebaff2dcbf1a37eb1ca39e0d39b9`.
Actual veřejný provider,22:11:19–22:11:20 UTC: preflight/bwrap/Python relay/HTTP
PASS; capsets0/NNP1/seccomp2/Landlock8, socket/port/namespace negatives,
owned PID+PGID prázdné. Result
`d64900ca7297bc36954bc0d3366ea5d48a01753428003968fcda8decbcdc254c`,
manifest19 `23ef8653dc4875f62b24815e094c27d9b060ec2c140540ede4cb39ccb406ab0a`.
Je to controlled mechanism qualification, nikoli generovaná app/M2 commit.
Private CPU: contracts35; provider9+abort2; SQL9+legacy27+fullstartup2;
planner/runtime23; compiler/composer11; startup6+independent read-budget4.
Veřejné targeted13 PASS/1 model-GPU BLOCKED; původní report zachovaný.
Finální service107 a Studio28 PASS v registrovaných2/2 sadách. Nové regrese
jsou v existující service/UI sadě; nové contract/startup suites jsou registrované,
CI zachovává CHAT a přidává explicitně HTTP contract/startup/Studio kontroly.
Browser fixtures potřebovaly4 canonicalV1 version annotations; všechny původní
assertions zachované, originalRED doložený, produktový guard se neoslaboval.
Startup refusals: strictrefs, owned0400/0600, nofollow/nonblocking FIFO, UTF8,
max65537B read a post-read drift; priorunbounded-read finding zachovaný.
Callgraph má7 přesných nutných SQL/config hran navíc, cycles3/files28 beze změny;
provenance baseline se připne ke skutečnému commitnutému source stromu.
Skutečný Studio production/consumer build PASS, bundle7bf62455…bfe24;
receipt111dbc4e…8e510. Root-cwd Corepack refusal zachované, správný IDEcwd build3.77s.
Physical cancel/timeout je doložen níže. Další brány: společný profil/current CI;
potom zmrazený API/oracle/model/callbudget a skutečná CODE/M2/HTTP aplikace.
Žádný nový modelový běh, app commit, app restart nebo release PASS tímto nevznikl.

Source commit `e7ac78a8d3bb3e5566557a0a4ce8217ab341c06e`: přesně34 vlastněných
paths, source/registry/CI/report; lineage i původní assertions zachované.
Graph baseline1507/3/28 je regenerovaný s výslovným přijetím jen7 uvedených
SQL/config hran a Git sourceTree/scannerBlob provenancí tohoto čistého commitu.
Skutečná controlled provider cancellation/timeout2/2 PASS:1.14s/4.62s,
TERM ignorující descendants i durable supervisor PGID prázdné; host unchanged.
Manifest23 `3db842bc8bc1c5b4728d16cf2e27e817e419fd5bf654b3a6a9bbe281315fd66f`,
result `a6aafed92f6d01b8f5d89e4ada87354617488731f911bf9955ac074efdd8e42f`.
Observed native READY/controls nejsou returnedKernelProof (cancel/timeout:null);
namespace teardown poTERM není oddělený důkaz KILL eskalace. Independent review
`b96326b7e6364e84dc4b4497cc8b9b24fbdc590d1a1f3fb2a0a927f10480d34b` PASS.
HosttrustedNode IPC používá AF_UNIX/socketpairs mimo sandbox; není to host TCP
listener/egress ani zděděné socketFD uvnitř profilu. Původní frozenhostSocketCalls0
se nevydává za počet všech trustedhostsyscalls.
Oracle peer našel source větev: po reaping zanechaného PGID mohl V2 vrátit success.
ROOT připravil pouze private-profile late-cleanup non-success guard; V1 zachovat,
controlled RED/GREEN a source review před adopcí. První actual3 native scenarios
tuto větev nepozorovaly, jejich omezené PASS ani history se nemění.

### 5. 10. 2026: V2 post-exit cleanup guard

Přesný provider `6cb87374d10c11d7ff3e491d3fcff63b43291c2469744781f676d80c33255429`
je adoptován po bounded RED/GREEN/source review
`01a9afff18e3b53ac314d7190ea63a886dc54bc74aba97eef3f0d47f71ac1963`.
Původní V2 `a0cc6b44` při skutečném zbylém childu po terminal supervisor close
vracel success po úklidu; oprava vrací
`failed / PROCESS_PRIVATE_HTTP_POST_EXIT_CLEANUP_REQUIRED`.
V1 v téže řízené větvi zachovává původní chování. Nevyřešený orphan má
původní prioritu. Čtyři řízené běhy bez retry/GPU/network/native calls; všechny
vlastní PID/PGID empty. READY je výslovně fake fixture, nejde o kernel přejímku.
Result `f9bd4643f9116905be7fcca8b1ab946448a3cabf79193856abb2e49c0687503b`,
manifest19 `d50779d2e460cc9a74b7ddeec054b1a4feafece1f85b3d991e268977c2a33aeb`.
Předchozí actual native positive/cancel/timeout zachovávají exact source scope;
tuto větev nepozorovaly. Následují permanentní regrese, nový whole profile/CI
a skutečná generated HTTP/SQLite přejímka.

Permanentní2 regrese v původní process-supervision sadě používají skutečný
vlastní child/PGID a explicitní mock READY. Původní testy jsou zachované.
CI instalace/registr přesně deklarují iproute2+nftables, runner ověřuje
`/usr/sbin/nft`; suite je přidaná k CODE (11), CHAT7 beze změny.
Přijetí7 nových graph hran a skutečná provenance e7 zůstávají beze změny.

### Společný profil eb482aca a uzavřené příčiny

Skutečný profil offline/database23:00:16–23:10:18 UTC:399 PASS/11 FAIL,
0 BLOCKED/TIMEOUT/SKIP; SHA reportu
`7e6428feb43ba0d5a46d44c0e674e052caca3dd21295bd0371faf24dd9644e05`.
GitHub CI37242119604 FAIL na Studio fixtures. Původní výsledky zůstávají.
Šest doc-census assertů, chybějící startup isolation bootstrap, dvě canonicalV1
Studio annotations +jejich wrappers, tři migration/release-set sady jsou opravené
bez změny původních asercí a bez automatického odvození golden manifestu.
Private targeted103+72 PASS, veřejný census160/bootstrap coverage PASS.
M6 current migration count109 odpovídá přesné source migraci122; previous56,
předchozí SHA/verze a candidate/backup/restore/soak guardy zachované.
Independent bounded contract review
`50722146df032dec200e2fa73ade53eb5a5d0bc3bcb0b5db0d56a6af46cf2967`.
Historické receipts/archivy se nepřepisují; nový fyzický M6 upgrade NOT_RUN.
Před prvním generated HTTP během používáme4 initial +jedinou selected repair1..4,
max8 CODE. Ostatní moduly reusePrevious=true přebírány byte exact z FAILED
proposal po doloženém rollbacku; plný4souborový preview/approval/oracle zachován.
Původní full4 DRAFT příprava zůstává; změna strategie před livefreeze nepovoluje
no-op model output ani další opravu. Nový jointprofile/CI/live acceptance čekají.

### Skutečný CODE běh a omezené veřejné pokračování

Kandidát `c412865c` má celý profil410 PASS/0 FAIL/0 BLOCKED/0 TIMEOUT,
23:37:03–23:47:10 UTC; report
`5b4046462400b4009a548e570a2222e57217fb51709af29b610b28c54dd00a2b`.
CI37244406326 SUCCESS, remote SHA ověřený. Původní eb482aca FAIL zůstává.
Freeze `b4e7bd74f3d0d63a535998342899ff46c2a3fedc9297f38910a6785d1a5e2d86`
ověřilo nezávislé review `cd60fdcbdc02a15107771c731e31f1ffd842a6b070d5bb4fd47479a655770428`.
Skutečný běh23:51:12–23:53:51 UTC skončil governance409 před náhledem:
ROOT helper nahradil výchozí importy, a tím zakázal `node:test` původního scaffoldu.
Produktová výchozí policy `node:test` již dovoluje; produkt odmítl návrh správně.
Čtyři skutečné CODE výstupy jsou úplné,25 382 B, vstupy6 713/12 137/19 529/24 288 B,
prompt tokeny1 741/3 292/5 373/6 646. Model/context limity a úplné peers zachované.
Žádný durable M2 plán/efekt nevznikl; všechny33 M2 tabulky mají0 řádků, targety absent,
Git baseline beze změny. Vlastní Studio/BE/model/relay/lease cleanup PASS.
Source review `95b9ab8386905584d518937bcfa3e79651bee89b80515f014391705215d73cda`
zjišťuje vady store/router/server; žádný oracle se dosud nespustil.

Nejmenší pokračování využije existující veřejný raw proposal port uvedený výše:
nový baseline ponechá výchozí onboarding policy a přidá pouze `node:sqlite`.
Přesný proposal se rekonstruuje produktovým compilerem ze čtyř zachovaných
úplných modelových výstupů a odešle normálním Studio `/m2-plan` → `/prepare`.
Nevkládá se DB, app source ani provider replay. Nový plán znovu projde manifestem,
governance/preflight/náhledem a přesným schválením. Původní výstupy a FAIL zůstávají.
Kontrakt této strategie ověřilo review
`dc569a5ebe353192411b73d73a19700478fcaf6b3768f3ed6785497aaa9d8a3e`.
Teprve skutečný focused FAILED+rollback dovolí `revisionOf` a jedinou selectedrepair≤4;
rozpočet zůstává historické4 + nové≤4 = celkem≤8 CODE, D1/CLI0. Žádné další initial volání.
Před inference vznikne nový explicitní source/representation/ref freeze a review.
CPU rekonstrukce s úplnými původními zdroji/digests: repair19 527/29 746/27 628 B,
nejmenší rezerva2 254 B. Budoucí změny dependencies jsou neznámé a skutečné guardy platí dál.

### Recovery obal — CPU checkpoint, 5. 10. 2026, 00:24 UTC

ROOT převzal pouze dva manual helpers: runner `4d059b16b4b61cb2ecea367fd9a9455bb08616657dede5c37ed13b67968f9b82`,
controller `8116cf7945f2a17678715d32597c7486b05c5fecda32377d91b42ce063215130`.
Finite CPU31/31 PASS (Node24.21.0, exit0,0.883s): přesných5 historical refs,
raw request/response hashes a fatal UTF8, model/params/full dependency reconstruction,
missing/tampered/incomplete provenance, unchanged3 product pins, defaultpolicy+SQLite,
public proposal compiler/composer a zákaz initial forward/cumulative4+≤4.
Public default NO_RUN, registry596/fingerprint47acf12…e748 a diffcheck PASS.
Nový runtime má fresh authority DB a absent project; starý packet se nemění.
Final independent source/CPU review `67f751be5c2ddeb1739acdde54dbd043e0da4da30d72bfc03529df0c9e825b84` PASS, openFindings0.
Manifest `39423c9559133d854363bd3f57b79372f84d4fb18bcb77ba1cfa93359e556602`; reviewer0 reruns/effects.
Nový exact SHA/CI/inputfreeze ještě před skutečným pokračováním.
Původní GPU observer:81 vzorků/56 loaded, context32768/fullVRAM17,399,734,598 B,
minimumfree2434 MiB/maxgap2.468s,0 errors. Jde o periodické vzorky původního
čtyřgeneracového běhu, ne souvislý důkaz nebo funkční přijetí aplikace.

### Actual recovery uzavřen FAIL; další CPU strategie, 5. 10. 2026

Published `50915ffdf3a55ee338519d98b9bae31208c86996`, CI37247712264 všech18SUCCESS.
Freeze `cdef9c83516950a08a3c83df9e2545ccd8f78427fa3f0ba0f568d0133b30fec6` má independent
review `b80a10141c15ca8d12928be08ae1b8553b2e4f95d6f74aa1a163b5ffb4fe0692`.
Initial public M2-plan ze čtyř přesných historických výstupů: náhled, wrongdigest409,
restart pending plánu a exactapprove200. Oracle fyzicky serverexitbefore readiness/0HTTP.
Celé4fswrite/4rollbackdelete succeeded, žádnýgitcommit, všechnytargetyabsent, baseline8051f708.
Samostatná trusted CPU SQLite diagnostika přesným Node24 prokázala nedostupnýcharindex;
serverstderr je stdioignore, takže to není přímý výpis chyby původního serveru.
Selectedrepair store11 complete113tokens/7171B; router15 done_reasonlength2048, JSON neúplný.
Input29967B/prompt8263 splnil32000/32k. Starý oracle/API/inference parametry zůstaly.
Cumulative historical4+new2=6/8; server0; repairplan/approval/write/commit nevznikly.
Result `4ca9ee65350def918a43cc52125cbd64b1286fac546cddb63c6c92aca3d134e3`, cleanup/modelunload/leasePASS.
Independent actual review `20f76f4001c8e2537b84036a1dd0745d0430bd01936dba3d4173b89ff5563e4b`,
source/evidence `e1e1bfe2afe01a14b01a8fce1a2b6244fbdc57545172ba06c4704f08ceece106`; APPLICATION_FAIL.

ROOT drží navazující omezený CODE output kandidát v m2-code-draft.js + přímém model-contract testu:
4096 repairtokens pouze pro vydaný exactCODE32k capture, legacy/generic2048 a4k1024 zachované.
maxPromptBytes60672→56576, oběnad serialized32000; capture/role/context/source16384/stop/UTF8/approval
invarianty zachované. Samotné4096 neřeší kvalitu (partialrouter má komentáře místo fataldecoder).
CPU připraví retainedactualstore+validation→publicproposal→actualFAILrollback→router/server2.
Samotné dva zbývající calls nejsou nová autorita. Následující explicitní ROOT rozhodnutí
vychází z dosavadního souhlasu operátora s autonomním dokončením a z CONTRACT §11.


### ROOT rozhodnutí: retained HTTP cyklus, 5. 10. 2026

ROOT přebírá pouze dva výše uvedené manual helpers a přímo navázané report/WP řádky.
Podle CONTRACT §11 a již uděleného oprávnění provede jediný nový omezený cyklus:
6 historických volání + nejvýše 2 nová, celkem stále max8; D1/CLI/nové initial volání0.
Nový HttpSqliteJourneyFreeze@3 zmrazí CODE repair4096, přesné instrukce a úplnou provenanci.
Původní tři moduly + skutečně zkompilovaný store11/7171 B jdou veřejným /m2-plan;
nový skutečný focused FAILED + úplný rollback předchází revisionOf/router/server.
Store a validation zůstávají exact reusePrevious; router15 length se nikdy nepoužije.
Oracle/API/security/project isolation/source16384/serializer32000 a exactapproval se nemění.
Old @1/@2, raw výstupy a všechny FAIL zůstávají; compatibility váže celý původní Git blob
a jedinou explicitní změnu CODE budgetu. Nejde o další phase v původním frozen běhu.
Helper CPU16/16, manifest20/20; independent source review
4aac88a2beb4524bcce9f3e5323e846422082ae22c8f51d2db974571594b37aa PASS bez findings.
Review manifest b495011bb7ac3ce6415a5d0244c5ce5062289c1f7ae334f2e3c7b7c81f70268b.
Před live musí být přesný publish/remote/CI, nový freeze a jeho review. Jakékoli nové selhání
ukončí tento cyklus; žádné prodloužení budgetu ani ruční oprava generovaných zdrojů.
