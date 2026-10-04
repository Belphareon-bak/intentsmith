# WP — skutečná HTTP kvalifikace M2 v soukromém loopbacku

**Autorita:** explicitní souhlas operátora 4. 10. s navazujícím WP podle
[původního návrhu](WP-M2-PRIVATE-HTTP-QUALIFICATION-PROPOSAL-20261001.md).
**Vlastník:** ROOT, jediný tracked writer. Vstup `5cf1c36d`, existující checkout;
čerstvý GitHub main `838b8cee` je ancestor. Žádný nový worktree.
**Stav:** `BOUNDED_DESIGN_SCOPE_REVIEW_PASS / NAMESPACE_FEASIBILITY_CPU_PASS /
PRODUCT_IMPLEMENTATION_NOT_RUN / GENERATED_HTTP_NOT_RUN`.
Nezávislé omezené design/scope review na `92767d77`: receipt
`ebcf2fad2bcd29363643ed3363c062979d7b9f54a55b3b57d0282f45e645e2fc`.
V2 schema/native source a skutečné product controls mají následné review/gates.

## Výsledek a hranice

Jeden skutečný focused test generované HTTP/SQLite aplikace: nový soukromý
user/net namespace, server a chráněný oracle, přesný IPv4/TCP `127.0.0.1:P`,
RO projekt, DB v private `/tmp`. Dva serverové procesy v téže invokaci ověří
stejnou DB. Samostatný restart BE ověří M2 approval/effects/terminal/commit,
nikoli přenos tmpfs mezi invokacemi. Úplné zdroje určují preview/digest/zápis.
Žádný host listener, veth, host FD, egress, DNS, UDP, IPv6, AF_UNIX, fallback,
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
