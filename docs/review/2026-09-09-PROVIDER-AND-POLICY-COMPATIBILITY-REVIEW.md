# Nezávislé review provider přípravy a policy opravy — 2026-09-09

Stav: **SCOPED_REVIEW_PASSED / DETERMINISTIC_BASELINE_FAIL /
ACTIVATION_HEALTH_REVIEW_PASSED / CONTROLLED_GATEWAY_REVIEW_PASSED /
FULL_M6_REQUIRED / NOT_RELEASE_READY**.
Kandidát `a71e5b98a319416c5b74e0be65b0a5f6f74586eb`,
tree `8fdad186ff062decfcd752e773f8f4368ff6a97a`.
[WP](../wp/WP-CORE-COMPLETION-20260909.md),
[přesné běhy, hashe a hranice](../execution/runs/m6/provider-activation-20260909.md).
Zápis shrnuje samostatnou práci agentů; root je integrátor. Není to Opus
release review ani operátorský podpis.

| Rozsah | Implementace / nezávislý reviewer | Výsledek |
|---|---|---|
| Původní v1 activation/rollback příprava | root / `/root/verify_mobile` | Dvě původní rollback vady opraveny; exact `ea691c9b…fbd1` REVIEW_PASSED po nové fault injection a helper kontrolách. |
| Původní v1 interaktivní launcher | root / `/root/verify_mobile` | Exact `87d7dec6…7076` REVIEW_PASSED; skutečné heslo patří jen systémovému sudo v TTY. |
| Private durable gateway qualification harness | `/root/verify_release` + root / `/root/verify_mobile` | Při přípravě chování REVIEW_PASSED / runtime NOT_RUN; dokončená v2 runtime kvalifikace je samostatně uvedena níže. |
| Zastaralý role-config oracle `4f17f70a` | root / `/root/verify_convergence` | REVIEW_PASSED, úzká změna dvou callbacků; pozitivní config varianty i deliberate cross-wiring negative ověřeny. Při focused opravě celý program NOT_RUN; následný registrovaný 17/17 běh je uveden níže. |
| Policy 061/066 kompatibilita | draft `/root/verify_release`, integrace root / `/root/verify_convergence` | Exact patch `907266a5…5f25` SCOPED_REVIEW_PASSED; žádná scope-blocking source vada. |
| Fixture, registry a census integrace | root / `/root/verify_convergence` | REVIEW_PASSED; všech 512 runnable entries beze změny, jedna nová přesná historická support fixture. |
| Fresh-clone 352 gate evidence | root běh / `/root/verify_convergence` | EVIDENCE_REVIEW_PASSED; samotný gate zůstává 351 PASS / 1 FAIL. |

Policy reviewer samostatně porovnal tři soubory s reviewed patchem a
historickou migrací z `905a3422`, prošel skutečnou typed write call graph,
obě pořadí událost/projekce, invalid state, rollback a evidence ze soukromé
kopie DB. Stejná rozšířená suite na baseline 16 PASS / 7 FAIL a po opravě
23/23 PASS prokazuje skutečné regrese; settings 14/14 a coordinator 16/16
jsou související kompatibilita. Neznámá schema nadále fail-close.
Live DB zůstala pouze read-only. Draft `validation.json` si zachovává svůj
historický `REVIEW_PENDING`; tento zápis přidává následný nezávislý výsledek.

Reviewer full běhu nezávisle ověřil čistý standalone clone na přesném
source/tree, všech 352 očekávaných programů a jejich log hashů,
checkpoint/report shodu, každý sourceTree a úspěšný checked cleanup.
Nebyly retries, timeouty ani log errors. Integrated policy 23/23 a artifact
158/158 prošly. Report SHA-256
`887b5af4ebbf64e15e510d551bb40984f252a06d0664c0d2ca1ed28ffeb17ebb`.
Jediný FAIL má doslovný důvod `registry hash differs from the reviewed Gate
0 policy`; nebyl potlačen ani přepsán. Registry fingerprint
`3ce12a0edffe7e6da0f875ce3f0b25758524641557023d00aae39d0784fdbbfc`.

První systémový auth pokus skončil exit 127 před root bootstrapem.
V této fázi původní Ollama 0.32.14 zůstala aktivní, candidate nebyl instalován
a modelové ověření neběželo. Review instalačního kódu tedy není runtime provider
acceptance. Operátorovo povolení restartu/modelového okna už bylo uděleno;
bezprostřední zbývající předpoklad pro aktivaci je autentizace správce.

Finální synchronizace SYSTEM-MAP fingerprintu a aktuálních run/WP/roadmap
stavů je dokumentační closeout po měřeném kandidátu. Původní `70eef905`
privacy/mobile/Android evidence a původní review FAIL se nepřepisují.

## Navazující skutečný pokus a review v2

Operátorova terminálová autentizace 12:20 prošla. Původní reviewed v1
chybně očekávala runtime verzi `0.32.14.1`
místo skutečné `0.32.14-intentsmith.1`. Aktivace provedla rollback; původní
service i všech 9 modelů zůstaly zachované. Původní review tuto vadu
nezachytilo a není důkazem runtime správnosti. V1 navíc ztratila actual
candidate observation, protože ji ukládala až po neúspěšné aserci.

`/root/verify_mobile` nezávisle ověřil stejné SHA obou candidate binárek,
source identity a isolated probe obsah/prerekvizity/čistý exit. Vyvrátil
svou předběžnou hypotézu `0.0.0`: absence `-ldflags` v `go version -m`
nedokazuje absenci buildové hodnoty. Rozhoduje skutečná pozorovaná verze.
Verdikt `VERSION_EVIDENCE_REVIEW_PASSED` se nevztahuje na modelovou inferenci.

`/root/verify_convergence` nezávisle přijal aktivační v2 SHA-256
`983a08090af1fa2608e96c9945745c2c96f6d2d10362a23d0232d73677abfda0`.
Cílené pure kontroly **19 PASS / 0 FAIL** ověřily reuse bez změny inode/bytes,
novou instalaci, uložení chybné verze před rollbackem, daemon-reload timeout,
odstranění pouze vlastního drop-inu a odmítnutí metadata/hash/symlink/hardlink
či opening/reading replacement race. První v2 `7bb7e80d…` měla mezeru mezi
dvěma čteními identity; reviewer ji reprodukoval, finální verze drží jedinou
původní referenci a odmítne výměnu před service operací. Historická chybná
verze i test harness zůstávají v artifact kořeni uvedeném v run záznamu.

`/root/verify_mobile` také přijal wrapper v2 `2e82b598…d0c7a` a jedinou
změnu očekávané verze v qualification harnessu. Root před případnou inferencí
musí znovu připnout čistý dokumentační source a jeho hash. Ani tyto review,
ani ukončený čekající grafický auth pokus v 12:36 nejsou provider acceptance.

## Nezávislé review skutečné aktivace a gateway

`/root/verify_convergence`: **ACTIVATION_HEALTH_REVIEW_PASSED** pro skutečný
v2 pokus 12:38 UTC/exit 0. Znovu ověřeno všech 54 identit, stejný target
inode/hash/metadata, actual PID 1421510, UID 997, exact verze, jediný loopback
listener a všech 9 původních modelů. Přímý `/proc/PID/exe` patří do root
receipt; běžný reviewer ověřil executable samostatně přes journal.

`/root/verify_mobile`: **ABI_ENVIRONMENT_CORRECTION_REVIEW_PASSED** pro
přechod launcheru ze systémového Node 18 na podporovaný připnutý Node 22,
bez rebuildů. Původní FAIL nastal před DB open/chat a zůstává zachovaný.
Dále **CONTROLLED_GATEWAY_EVIDENCE_REVIEW_PASSED** pro skutečný clean
`ceb8de93` běh 12:42 UTC: dva raw capture hashe a response digesty, actual
usage 410/CRE_DECISION/12:42:49 a dva NORMAL released claims v private DB,
integrity_check ok, FK check 0 a shoda všech čtyř binding tabulek.
Report SHA-256 `c63da441d004570e327cdccec9febfd969ac9c3671079b96f70c2f0b1ae1e8d1`.
Podrobné piny a raw lokace uvádí run evidence. Nejde o server startup,
koordinaci přes živou DB, celý modelový panel ani M6 acceptance.

## Nezávislé review navazujících registrovaných běhů

`/root/verify_release` přijal přesný GPU pilot na clean `ceb8de93`, exit 0:
4 očekávané requests, semantic cold/warm/classification, aktivní cancel bez
false success, 100% residency a přirozenou obnovu bez modelu/compute procesu.
Source, inner/outer report, registry a log hash souhlasí. Omezení production
VRAM UNKNOWN, jednotlivé latence a rozdíl periodic/trigger utilization jsou
zachovaná v run záznamu. Report SHA-256
`1da5db4124420329c1285a78acbc8e4a29cce201397e932c087e636c1cbc602c`.

`/root/verify_mobile` přijal pipeline evidence: 17 kontrol/exit 0, čistý
source, shodný report/checkpoint/log hash a úspěšný cleanup. Journal potvrzuje
2 skutečné provider HTTP 200; obsah odpovědí/klasifikační fallback se zde
nedokazují. Actual private DB má integrity/FK PASS a nula usage/claims;
nejde o durable ani celé multi-role workflow ověření. Report SHA-256
`890d83a1f6f4de6e1c63af6d70c6d95cc0dc4801baab580c76f792fa8c4c6bd6`.
