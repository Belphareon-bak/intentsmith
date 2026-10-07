# C12 — test nesmí skrýt chybu ani skončit před dokončením kontroly

Stav: SOURCE_AND_PROBE_REVIEW_PASS; FULL_NOT_RUN.
Autorita: operátorův požadavek na kvalitu testování a pravdivé výsledky.
BASE `a54eaa6082d00b47c2f92085dc9d169abacc454a` → testový commit
`6699e962db10181d9954305162c5cd64dc33ce6f`. Produktový zdroj zůstává `24f329c6`.

| Program | Původních kontrol | Prokázaná chyba starého harnessu |
| --- | ---: | --- |
| knowledge-base | 35 | Assertion FAIL, ale exit 0 |
| ledger-core | 54 | Assertion FAIL, ale exit 0 |
| ledger-annual | 44 | Assertion FAIL, ale exit 0 |
| expertise-system | 40 | Exit 0 před zpožděnou assertion |
| chat-search-quality | 43 | Exit 0 před zpožděnou assertion |
| chat-synthesis-hardening | 23 | Exit 0 před zpožděnou assertion |

Omezený statický audit pokryl 410 vybraných programů a sdílený `tests/harness.js`.
Ten chybový exit nastavuje správně. `mini-harness.js` je jen textová fixture,
nikoli další soubor. `tests/output-gate.js` zůstává výslovně import smoke.
Nejde o certifikaci libovolného budoucího testu ani dalších profilů.

ROOT nahradil šest lokálních harnessů standardním `node:test`. U tří sekvenčních
DB sad jsou volání explicitně await, aby se zachovalo pořadí a cleanup.
U tří suite sad sleduje dokončení async potomků standardní test runner.
Všech 239 názvů i těl původních kontrol, importy produktu a DB setup/cleanup
jsou zachované; pouze se mění spouštění a vykázání výsledků. Žádný required
program ani oracle se nevyřazuje, žádná změna produktu, bindingu či budgetu.

Dva workeři nezávisle přijali příslušné zdrojové kandidáty a vytvořili oddělené
CPU sondy. Celkem 24 běhů pod bwrap s odpojenou sítí a vlastním HOME/runtime.
Dvanáct M1 sond má celý host root read-only; dvanáct async sond má read-only
repozitář, ale host mimo něj nebyl globálně read-only. Omezení async sond se
nevydává za plnou izolaci host filesystemu. Šest původních variant reprodukovalo falešný
exit 0. Šest čistých kandidátů dalo 239 PASS. Devět negativních variant skončilo
exit 1 na konkrétní assertion, bez cancellation; tři zpožděné pozitivní varianty
prokazatelně dokončily timer a skončily exit 0. Původní callbacky byly porovnány
bajtově. Peer review konstrukce a raw důkazů provedl třetí worker;
receipt 5039c9ef…618ab přijímá přesné mutanty, všech 24 běhů a binding na
6699e962. Autoři si vlastní sondy nepřijali.

C11 celý běh na a54eaa60 je přijatý pro konkrétních 410 programů a jejich logy;
u této šestice vykázal všech 239 původních kontrol. Nové sondy netvrdí, že tyto
původní assertions v něm selhaly. Nový celý profil s C12 dosud NOT_RUN.
Census na 6699e962: src 688 souborů / 237 254 LF řádků; tests 604 / 270 801.
Registry 596 a module graph 1 514 / 3 cykly / 28 členů se nemění.

[Paket s přesným diffem, příkazy, očekávanými/skutečnými exity a SHA-256](evidence/test-harness-integrity-20261008/result.json).
Sondy nevyžadují GPU; jeho okno nebylo otevřeno. Nečíst `restricted/`, H1/H2
corpus, odpovědi ani raw logy. Chatová kvalita a release zůstávají nepřijaté.
