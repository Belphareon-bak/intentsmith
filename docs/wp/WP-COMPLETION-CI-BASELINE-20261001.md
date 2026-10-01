# WP — přesné přijetí nových modulových hran v CI

Autorita: operátor požaduje dokončit, otestovat a pushnout práci pro kontrolu;
review výslovně požaduje aktuální CI. Závazný ratchet zachováváme podle
`CONTRACT.md` a přijatého P6. Vstup: čistý integrační source `037b8653`.

Skutečný GitHub run `36828233633` na `1e7c5b4c` skončil FAIL:
registry 591 validní, ratchet 1464→1473 s devíti novými importy. Další CI
kroky byly SKIPPED. Nezávislé review přijalo pouze těchto devět konkrétních
hran po ověření token→gateway a registračního call graphu. Po semantic
integraci další review na `037b8653` přijalo pět nových hran a ověřilo
přesné členství všech SCC: stále 3 cykly / 28 členů, žádné změny členství.
Celkem 14 přijatých párů, žádná odstraněná hrana.

Výstup: baseline vydaný existujícím provenance writerem pouze pro všech
14 přesně posouzených párů. Žádné globs, vynechání kontroly, navýšení
cycle limitu ani změna scanneru. Výsledek původního CI zůstává FAIL.

Vlastněné: `tests/fixtures/module-boundary/baseline.json`, tento WP,
integrační tracker a review receipt. Zakázané: produktový source,
ratchet writer/scanner, contracts, registry/lastGreen, instalace a DB.

Connector: `scripts/module-boundary-ratchet.mjs --write-baseline` s přesným
`--accept-edge` pro každý ADDED pár. Writer ověřuje čistý source,
source tree/scanner blob a odmítá chybějící přijetí či růst cyklů.
Dokumentační commit před writerem nemění posouzený `src` tree.

Ověření: audit přesného baseline diffu a provenance, ratchet, registrovaný
ratchet test, specialist boundary, registry/projekce, následný commit,
push a skutečné GitHub CI. Nový import mimo přijatý seznam musí dále
selhat. Stop: nesoulad source/scanner identity, cycle membership nebo
počtu přesných hran. Stav před writerem: **REVIEWED_EDGES / CI_FAIL**.

Privátní nezávislé důkazy v integračním checkoutu:
`review-module-{ratchet,cycle-identity}-1e7c5b4c.log`,
`review-semantic-merge-{identity,registry-preservation}-037b8653.log`.

Přijetí hran ani zelený development CI není release Gate 0, celý profil,
živá kvalita CHATu nebo přijetí běžící instalace.

Writer vydal baseline z čistého `cbf6a24b60787d6e32fff9c9ca4f6fa83d98a70f`.
Jeho `src` tree je shodný s posouzeným `037b8653`:
`c6f22ebc3a84aa0aa47c73f86cd451b0b91c790a`. Scanner blob zůstává
`a111646c052627fd0803fc881838f58d7d5fd8dc`, protocol 1, limity 3/28.
Baseline diff přidává pouze 14 přijatých párů a aktuální source provenance;
žádnou hranu nemaže. Soukromý writer log:
`ci-baseline-reviewed-14-write.log`. Stav: **CANDIDATE_REVIEW_PENDING**;
původní vzdálené CI je nadále FAIL, nový běh dosud není doložen.

Nezávislé review přesného `cbf6a24b` → `7d66c1f7` je **REVIEW_PASS**:
14 přijatých párů, žádná odstraněná hrana, 1478 úplných párů, správná
source provenance, nezměněný scanner/protocol/limity a totožné členství
SCC. Změněny pouze baseline a tento WP. Reviewer znovu spustil ratchet
PASS, modulové testy 13/13 a specialist boundary 12/12, všechny exit 0.
Soukromé logy `review-baseline-{identity,ratchet,module-tests,specialist-tests}-7d66c1f7.log`.
Root zopakoval oba registrované programy **2/2 PASS**, report
`2026-10-01T07-27-25-847Z/report.json`, a samostatný ratchet exit 0.
Baseline je tím přijatý; nový vzdálený CI výsledek a celý produktový
profil jsou stále **PENDING_RUN**. Povinný push následuje s ověřením SHA.
