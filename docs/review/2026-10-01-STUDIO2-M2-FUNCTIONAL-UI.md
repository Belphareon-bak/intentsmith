# IDE 2.0 — skutečné schválení funkční aplikace v AppImage

**Autorita a rozsah:** pokračování [WP-STUDIO2-BUILD-PACKAGE](../wp/WP-STUDIO2-BUILD-PACKAGE-20261001.md), explicitní dokončování IDE/backendu po milnících. Další CHAT je předán jinému workerovi.

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

Přijatá je jedna řízená cesta renderer → prepare → preview → approve →
funkční test → commit → durable terminál. Návrh a referenční obsah byly
vloženy předem. Přirozený CODE composer s modelem v AppImage tím není
ověřený; samostatný živý CODE/backend ledger PASS je v
[projektovém WP](../wp/WP-PROJECT-APP-FUNCTIONAL-20261001.md).
Žádný CHAT, modelové pořadí, mobilní zařízení, release ani produkční změna
nejsou tímto výsledkem přijaty. Následuje odlišný projekt TaskFlow s
funkčními kontrolami a samostatný živý průchod na zmrazeném kandidátovi.
