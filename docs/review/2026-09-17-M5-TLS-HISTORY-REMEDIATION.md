# M5 — doplnění zveřejněné TLS testovací identity do historie

**Stav: IMPLEMENTED / VALIDATED / REREVIEW_REQUIRED.**
Implementace `6546d6486da9c6bb89b6c177576d3115bc92af2e`, review rozsah
`63fe1d4e..6546d648`; navazující commit doplňuje pouze důkazy a dokumentaci.
Autorita: nález v operátorem předaném nezávislém review
`9b031278..c2989a3e`, PRODUCT §5, aktivní
[WP](../wp/WP-PRODUCTION-CLOSEOUT-20260917.md).

## Převzaté review a jeho hranice

Review potvrdilo na `c2989a3e` 358 PASS / 1 FAIL z 359 programů, jediný
non-PASS `nightly-orchestrator-self-test`, 1 358 module hran, nulové nálezy
v aktuálním stromu a zachované neúspěchy `964b61ad` / `779f4f5a`.
Potvrdilo také čtyři opravy a rozdíl `src/` + Studio proti `023af4dd`
omezený na dva řádky M6 execution planu. Release pečeť nebyla změněna.

Současně našlo neúplný historický inventář. Tato připomínka není M5
acceptance ani bezvýhradné `REVIEW_PASSED`. Ostatních 13 review dokumentů,
fyzický 24h soak ani GPU scénáře tímto review pokryté nejsou. Původní
[closeout důkazy](2026-09-17-PRODUCTION-CLOSEOUT.md) se nepřepisují.

## Ověřené objekty

| Historická cesta | Git blob | Bajty | Obsah ověřený bez zveřejnění hodnot |
|---|---|---:|---|
| `tests/fixtures/conversation-web/loopback-test-key.pem` | `bce19952f2b7d4ef8a655f60f7f4cba00e8474be` | 1 704 | Privátní testovací klíč. |
| `tests/fixtures/conversation-web/loopback-test-cert.pem` | `dff0160bda022551778706f820f6a2651b5a2b00` | 1 281 | Veřejný certifikát téhož páru, ne další privátní klíč. |

Zavedení: `d09c9998d6d1bc41c61bdae0de8ae34cd18e64fd`.
Odstranění ze současného stromu: `779f4f5aad7ee5162d77186e6ec4e68e98475faa`.
Oba commity zůstávají dosažitelné. Kontrola přečetla pouze tyto deklarované
testovací bloby kvůli typu, délce a přítomnosti PEM hlavičky; žádný obsah
klíče/certifikátu se nekopíruje do logu ani nového artefaktu. Osobní historická
data se neotevírala. Počet vzdálených větví je časově proměnný; přesný census
je ve strojovém záznamu, nikoli odvozený z dřívějšího počtu pěti.

## Remediace a disposition

- Autoritativní `PRIVACY-INCIDENT.json` nyní obsahuje **15 známých objektů**.
  Původních 13 položek, červencové posouzení a původní quarantine metadata
  zůstávají shodné. Dva zářijové objekty mají samostatný containment s
  identitou skutečného odstranění; nevydávají se za červencovou karanténu.
- Incident schema v2 přidává `additionalTreeContainment`. Gate 0 projekce
  podporuje v1 i v2, kontroluje příslušnost a jedinečnost dodatečných blobů,
  součet velikostí a počet položek. Výsledná projekce váže hash **celého**
  manifestu: 15 objektů, 7 620 348 bajtů. Nejde o změnu release pečeti.
- Pro **oba konkrétní bloby** platí dříve operátorem zvolená incident
  disposition `retain_and_rotate` podle
  [Decision 035, 2026-09-10](../decisions/035-m5-privacy-remediation-authority.md).
  Historie se ponechává; tento záznam nerozhoduje o jejím přepisu.
  Podpis history disposition je stále **PENDING**.
- Pár je **RETIRED_PUBLISHED_NEVER_REUSE**. Klíč se považuje za kompromitovaný
  zveřejněním, nesmí se obnovit ani používat v testech nebo provozu; certifikát
  se nesmí znovu zavést do trust store. Testy v opraveném aktuálním stromu
  generují nové dočasné páry; níže uvedené starší instalace je negenerují.
  Repo dokládá fixture použití, nikoli univerzální tvrzení o všech externích
  instalacích. Nevzniká vymyšlená revokace u poskytovatele ani N/A podpis.
- Historické scany 13/13 zůstávají důkazem tehdy kontrolovaného podmnožinového
  rozsahu. **Nestačí pro nový podpis**: ten musí vázat čerstvý scan nad
  kandidátem s doplněným manifestem a odpovídající census refů. Známých 15 je
  stále minimum, nikoli tvrzení o kompletním forenzním prohledání historie.

## Následné re-review: zbytkové kopie v instalacích

Operátorem předané re-review potvrdilo inventář v2, dosažitelnost obou
blobů, odstranění z aktuálního stromu a publikaci `6546d648` + `376fe172`.
Zároveň správně rozšířilo lokální zjištění: **osm starších instalací stále
obsahuje původní pár a jejich testy na něj odkazují**. Záznam o generování
nových párů se na tyto historické suity nevztahuje.

Nezávisle znovu ověřeno 17. 9. po 21:24 CEST, v 13 přímých adresářích
`~/.local/share/intentsmith/releases/`: `023af4dd`, `fdfbc54e`, `3f005fc0`,
`02f5f128`, `58d7cced`, `3bbf8bc1`, `1da840c0`, `9d13bb53`.
Všech osm obsahuje stejné dva bloby z tabulky výše, včetně stejných délek;
žádný není symlink. Aktivní instalace `d4dea0bb` starý pár neobsahuje.
Jde o 8 kopií jednoho páru, nikoli dalších 16 objektů incident manifestu:
počet unikátních známých objektů zůstává **15**.

Disposition lokálních kopií: **PRESERVED_RESIDUAL_COPY_DISPOSITION_PENDING**.
Adresáře ani PEM soubory nebyly odstraněny či upraveny. Vazby jednotlivých
snapshotů na rollback/upgrade receipts a pečetě nebyly v této inventuře
ověřované; nelze předpokládat bezpečnost jejich mazání nebo úprav. Pár zůstává
vyřazený i v těchto kopiích a staré suity se s ním nesmějí znovu spouštět.
Jejich případné odstranění či vyřazení celého snapshotu je samostatný krok
po kontrole těchto vazeb, nikoli součást tohoto dokumentačního doplnění.

Operátor doložil anonymní HTTP 200 z GitHub API veřejného repozitáře. Retence
historie proto neznamená soukromou karanténu ani odvolání zveřejnění. Podpis
musí zbytkové kopie výslovně zahrnout do rozsahu ponechaného stavu; nesmí
tvrdit globální odstranění páru. Žádný podpis ani M5 acceptance zde nevznikl.

[Strojová inventura kopií a procesů](../execution/runs/m5-tls-residual-copies-20260917.json)
obsahuje přesné cesty, Git identity a čas kontroly bez hodnot klíče.

## Ověření a provoz

Na čistém implementačním `6546d648`:

- Scanner: aktuální strom 0 nálezů, **15 checked / 15 reachable**.
  Bez argumentu `PASS_CURRENT_TREE_HISTORY_REMEDIATION_REQUIRED`; s existující
  disposition `retain_and_rotate` `PASS_CURRENT_TREE_HISTORY_RETAINED_AS_DECLARED`.
  Druhá varianta není podepsaný history receipt ani potvrzení rotací.
- Celý offline/database profil: **358 PASS / 1 FAIL / 0 BLOCKED / 0 TIMEOUT**,
  359 programů, verdict **FAIL**. Jediný non-PASS je stejný
  `nightly-orchestrator-self-test` kvůli zapečetěnému registry hashi.
- Artifact validation **160/160**, privacy remediation **24/24**.
- Registry 523, stejný fingerprint
  `f0358f4af7bc6b702b2c8b08f10c472364c9cf0a699bfe3f76c7189cb1c777f1`.
  Module boundary 1 358 hran, bez přidané či odebrané hrany.
- Hash manifestu `bcf08f11dd675a02ce29adae964c1efc09d6538a6a12d7e35506c9927d621855`.
  Projekce váže celý tento obsah; ověřeny shodné původní položky, metadata
  obou nových Git blobů i jejich nepřítomnost ve stromu odstraňujícího commitu.

Přesné výsledky, hashe úplného reportu a ověřeného seznamu všech 359 logů jsou
ve [strojovém záznamu](../execution/runs/m5-tls-history-20260917.json).
Původní artefakty jsou oddělené v `.intentsmith-artifacts/m5-tls-history-20260917/`.
První focused běh odhalil zastaralý LOC census po rozšíření regresního testu;
selhání je zachované a dokumentační počet opravený, kontrola se nevypínala.
Nová indexová regrese nejprve použila approved schema-8 fixture pro kontrolu
pending schema-7; chybná fixture je opravená a tento neúspěšný log zachovaný.

24h soak na `c2989a3e` pokračoval při kontrole 17. 9. 20:43 CEST
(supervisor 870665, server 883280), není dosud PASS. Živá aplikace mezitím
běží z `09cbd0d6`; její souběžné změny ani běžící procesy tato remediace
nepřepisuje. Nové výsledky M5 se vztahují k této větvi, nikoli automaticky
k samostatné instalaci či k rozběhnutému soaku.
Pozdější inventura zachytila další souběžnou instalaci `08f8d1c5`; přesný čas
je ve strojovém záznamu. Tato remediace nemění `src/` ani Studio a nerestartuje
uživatelskou aplikaci. Soak zůstává v běhu i po dokončení nového profilu.

**Pozdější provozní změna po restartu hostu:** původní soak skončil
17. 9. ve 21:20 CEST po SIGTERM s verdiktem **FAIL**, přibližně po 2 h 50 min.
Boot journal a `uptime` potvrzují restart. Původní report zůstává zachovaný;
nejde o 24h PASS a odpracovaný čas se nepřičítá k novému běhu. Nový skutečný
24h soak začal **17. 9. 21:26:19 CEST** na aktuálním čistém `d4dea0bb`,
supervisor PID 15102. Má privátní DB a Linux namespace pouze s loopbackem;
není to test modelů. Výsledek je RUNNING_NOT_PASS, očekávané dokončení
nejdříve 18. 9. po 21:26 CEST. Po restartu funguje dotaz `nvidia-smi` na
ovladači 595.91.07; tato inventura nové modelové měření nespouští.

Zdroj a důkazy:
[`work/production-closeout-20260917`](https://github.com/Belphareon-bak/intentsmith/tree/work/production-closeout-20260917).

## Další nezávislé review

Nejvyšší prioritu mají původní P1/P2 soukromí:
[privacy/panely R1–R3](2026-09-17-PRIVACY-PANELS-REREVIEW.md), přesný
opravný rozsah `ba7c72d6..3bbf8bc1`. Ověřit odmítnutý HTTP vstup i stdout/stderr,
projektovou pracovní paměť při `saveContext=false`, teplou relaci a skutečný
restart procesu. Toto doporučení není tvrzení, že je ta plocha již přijatá.
