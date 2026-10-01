# IDE 2.0 — skutečné schválení funkční aplikace v AppImage

**Autorita a rozsah:** pokračování [WP-STUDIO2-BUILD-PACKAGE](../wp/WP-STUDIO2-BUILD-PACKAGE-20261001.md), explicitní dokončování IDE/backendu po milnících. Další CHAT je předán jinému workerovi.

## Aktuální přejímka modelového CODE composeru — 12:30 UTC

**Výsledek:** `PHYSICAL_IDE_CODE_M2_PASS / REVIEW_PASS / NOT_DEPLOYED`.
Skutečný parent běh `12:06:09.242–12:07:10.029 UTC`, AppImage část
`12:06:09.339–12:06:52.979 UTC`, oba skutečný exit `0`. Balík zůstává ze
source `45caf5b54b78def257221ac2ab33a64031800813`, čistý staging je
`483fb2d957ed20d48dbf508c82837b7d1824176f`; 1 178 GUI/backend blobů
odpovídá `cf67e83f2e7cf654bc8900f7b4dde434411cc0b2`.

Použitý probe packet má manifest SHA-256
`49a8173cbcd3045a8bb70f4582b27210087abd8ee6d52817c58bf7de67bc4fab`
(nejde o Git SHA). Host source SHA-256
`63039d91a7dfba8d85e86cd8fdab1ceee2e8acc0c3e86c4a22e9f74c6fc88d29`,
probe `671ded498b53a327b380ebff951711c27d79c4c8c4977e8225fa3fd7f182f346`,
config `8396d27ce916c26ab21a104f79985204f83480d27a550c3937893045a8f6b2b2`.
Model `qwen3.8:latest`, přesný digest
`22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`,
provider `0.34.0-intentsmith.1`.

1. Před modelem bylo zmrazené funkční orákulum a explicitně vložený
   důvěryhodný typovaný ledger blueprint v session projectWorkProposal,
   včetně Git/test metadat. Nejde o ověření vytvoření plánu přirozeným CHATem.
2. Skutečné otevření a odeslání DOM composeru vytvořilo právě jeden
   `/api/m2/lifecycle/draft` a šest úplných CODE generací v pořadí
   totals, validate, storage, service, cli, app. Osmnáct raw provider záznamů
   dokládá přesný model/digest/verzi a dokončení odpovědí.
3. Každý afterContent přesně odpovídá M2 preview, DOM náhledu, terminal
   diff, Git blobu a souboru na disku. Jedno DOM schválení odpovídá origin
   i planDigest; frozen funkční test má exit `0` a marker
   `PROJECT_APP_ORACLE_PASS`. Aplikační commit je
   `7a38869cb25c1d0e3826cbf66a81dd69f8be83a8`.
4. Restart a nový read-only SQLite proces ověřily operation, approval,
   výsledek, terminál a CODE binding. DB obsahuje šest typovaných zápisů,
   16 execution událostí a **0 CHAT zpráv**; čtyři DB backupy zachovávají
   přechod do terminálu. Pět frozen souborů má stejné baseline/Git/disk bajty.
5. AppImage a oba vlastní backendy skončily exit `0`; recorded PID,
   UDS, cookie a portfile už neexistovaly. Parent potvrdil drain `pending: 0`,
   odstranění vlastních process groups a uvolnění lease. Parent výslovně
   ponechává `modelMayRemainResident: true`, model nevybíjí. Root následně
   v `12:12 UTC` pozoroval prázdné `ollama ps` po přirozeném vypršení.

### Nezávislá revize skutečného běhu

Reviewer `/root/gate0_proposal_review` přijal uvedený fyzický packet;
všech **527 pravidelných souborů / 24 913 418 B** zůstalo před/po review
SHA-256 shodných. Znovu četl všech 16 313 package členů a 1 178 source
blobů v každé kopii, raw provider/preview/terminal, Git, immutable SQLite
a screenshot schválené aplikace. Historické neúspěšné probe packety i
řízený UI důkaz níže zůstaly nezměněné.

Soukromý staging packet:
`.intentsmith-artifacts/ide2-code-dom-physical-20261001-1205/`.
Review `.intentsmith-artifacts/gate0-review-ide-physical-1205/REVIEW.json`
má SHA-256
`62a55072c97427194481836eb49116cfe55edf6f97f00d814e4f395b872ff137`;
review manifest
`9b064232cbdebb99e76baa9952c5cdd519ffed85d8ba299648dc049ac4b5fa50`.

| Raw receipt | SHA-256 |
| --- | --- |
| HOST-RESULT.json | `7c501a9f21557e08938e83de3e0e2ac6fff66ed7448385b59ace7af77a435022` |
| RESULT.json | `a9e69545694e3c49f0e12673f81823402795edb125490ead978768692a74a8d4` |
| PROVIDER-REQUESTS.json | `c94b621878e41a57c14af5853b83c9acc409254f8aa15d36123bd27edf8553f1` |
| DURABLE-NEW-PROCESS.json | `28e418c1d96d7dbd012bd7ca015c0777716f75e5ff0c9224cee3a32d8671adf0` |
| FOCUSED-TEST-OUTPUT.json | `da59c8b79928d79618142d4e5619ca6441058fa478439fd07bdbc3e45ffaab66` |
| 03-approved-functional-app.png | `acc29abc18d8b20f245be3e042c64d3282c990409c1f9a16183432d09dd4b09a` |

### Rozsah, publikace a omezení

Přijetí platí pro tento balík, model, provider a jednu ledger aplikaci
s předvyplněným typovaným blueprintem. HTTP 200 po restartu a nezměněný
disk před schválením jsou úspěšné povinné harness assertions; samostatný
raw HTTP status a předběžný disk snapshot nejsou uložené. GPU readiness,
lease release a úplný group scan jsou actor receipts s ověřenou cestou
v kódu; reviewer nezávisle pozoroval pouze konkrétní recorded PIDs a
socket/cookie/portfile absence. Nejde o přijetí CHATu, plánovací kvality,
větších aplikací, widgetů GPU, modelového pořadí, mobilu ani celého releasu.

[Přesná archivní kopie zdrojů fyzického probe](../../materials/ide2-code-dom-physical-response-guard-20261001/README.md)
obsahuje 15 souborů, včetně původního manifestu a historických stavů;
není přenosný produktový runner. [Šest přesných generovaných modulů](../../examples/generated-apps/expense-ledger-ide/README.md)
má samostatný manifest. Jejich historické `REVIEW_PENDING` při exportu
řeší tato následná nezávislá přejímka; původní metadata se nepřepisují.

## Historický řízený UI průchod bez modelu — 10:01 UTC

**Výsledek:** `BOUNDED_CONTROLLED_UI_M2_PASS / REVIEW_PASS`.
**Skutečný běh:** 1. 10. 2026, `10:01:57.565–10:02:12.380 UTC`.
**Autor:** `/root/full405_diagnosis`; nezávislý reviewer `/root/hunt_completion_path`.
**Release / nasazení:** `NOT_ACCEPTED / NOT_DEPLOYED`.

## Přesný kandidát

AppImage zůstává z původního čistého source
`45caf5b54b78def257221ac2ab33a64031800813`; staging dokumentační HEAD je
`483fb2d957ed20d48dbf508c82837b7d1824176f`. Není přeznačený na novější
integrační SHA. Přímé porovnání 1 178 trackovaných GUI/backend blobů ve
stagingu i balíčku s `cf67e83f2e7cf654bc8900f7b4dde434411cc0b2` nemá rozdíl.

AppImage SHA-256:
`40b016d0316d12aabcb55270d561de89a8058dbd7f21d597718907eee58aed57`.
Manifest 16 313 položek balíčku SHA-256:
`8c94ac560d15642769b4ece6de69d48e2b9136ae7d1e531e88174fc5cc830d77`.

## Co se skutečně provedlo

1. Nový privátní HOME, profil, projekt a SQLite DB; AppImage a backend z
   přijatého balíčku. Vlastní síťový namespace má pouze loopback a provider
   na nedostupném lokálním portu 9. Žádné modelové volání.
2. Skutečný renderer odeslal `/m2-plan` s řízeným typovaným návrhem šesti
   modulů ledger aplikace. Tento lokální příkaz nepoužívá CHAT transport.
   Raw HTTP dokládá právě jeden prepare `200`; origin, lifecycle a digest
   odpovídají návrhu.
3. DOM náhled obsahoval přesných šest souborů včetně koncových newline.
   Před schválením žádný z nich v projektu nebyl; původních 15 souborů
   zůstalo nezměněných.
4. Jedno skutečné DOM schválení `/m2-approve` dalo HTTP `200`. M2 spustilo
   předem zmrazené funkční orákulum, exit `0`, marker
   `PROJECT_APP_ORACLE_PASS`, bez useknutého výstupu; commit
   `ca8db9a7b4a61ed7e32341018a40c200619cb1fa` obsahuje přesně šest nových
   souborů se shodnými bajty náhledu a filesystemu.
5. Nový read-only proces ověřil SQLite operation, approval a terminál;
   quick_check `ok`, nula chatových zpráv. AppImage/backend i vlastněné
   child procesy skončily exit `0`; žádná zbývající vlastněná process group.
   Dočasné XAUTHORITY, krátká TMP cesta a portfile byly odstraněné.

Nezávislá revize znovu ověřila raw requesty, SQLite, Git/filesystem,
všech 27 manifestových položek, identity balíčku a tři screenshoty.
Root prohlédl screenshot schválené aplikace. Původní SUMMARY zachovává
historické `REVIEW_PENDING`; aktuální review receipt je oddělený, původní
packet se nepřepisuje.

## Důkazy a zachovaná selhání

Soukromý staging root `.intentsmith-artifacts/ide2-m2-success-cf67-20261001-1006/`:
SUMMARY, MANIFEST, raw HTTP/DOM snapshots, Git/filesystem, read-only SQLite
report, procesní cleanup a screenshot `03-approved-functional-app.png`.
Manifest SHA-256:
`d5520eeef6ef15bdbdc9a291989d7e6636cca182b12f446d0e3149a8e8dbb4f8`.

Oddělený nezávislý report v
`.intentsmith-artifacts/ide2-m2-independent-review-cf67-20261001/REVIEW.json`
má SHA-256
`6478af34ad3ca138166be6b6da7e40f7d5019027a2ace04eabf0d655e1e03b98`;
jeho manifest SHA-256
`a9f4756e6f8ddca76aeb8fee5cd690ecc0831391d8bef8d81c13a9880593a40d`.

Starší pokusy `0951`, `0958` a `1002` zůstávají **FAIL / exit 1**:
fixture umístila projekt mimo privátní HOME, AppImage child skončil `127`,
respektive probe chybně zahrnul DOM hunk/deleted řádky. Příčina exit `127`
není prokázaná; vlastněný zbývající proces má samostatný cleanup receipt.
Nový PASS nepřepisuje jejich výsledky.

## Hranice přijetí a další práce

V tomto historickém běhu byla přijatá jedna řízená cesta renderer → prepare → preview → approve →
funkční test → commit → durable terminál. Návrh a referenční obsah byly
vloženy předem. Přirozený CODE composer s modelem v AppImage tím není
ověřený; samostatný živý CODE/backend ledger PASS je v
[projektovém WP](../wp/WP-PROJECT-APP-FUNCTIONAL-20261001.md).
Žádný CHAT, modelové pořadí, mobilní zařízení, release ani produkční změna
nejsou tímto výsledkem přijaty. Tehdy čekající TaskFlow byl následně
přijat v [samostatném WP](../wp/WP-PROJECT-TASKFLOW-FUNCTIONAL-20261001.md);
aktuální modelová přejímka AppImage je uvedená nahoře.
