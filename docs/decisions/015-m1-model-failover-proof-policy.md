# 015 — D+ potřebuje schválenou role-suite proof policy

- **typ:** BLOCK pouze pro vydání PASS proofu a terminal activation
- **stav rozhodnutí:** A + PROVIZORNÍ 7D IMPLEMENTOVÁNO V POLICY; migrace 062
  a immutable companion ledger jsou implementované; proof issuer zůstává
  `CHANGES_REQUIRED` na provenance hranici
- **WP:** WP-M1-MODEL / B3-FAILOVER
- **rail:** R1, R3, R5, R6
- **vzniklo při:** call-graph auditu authority pro rozhodnutí 006/D+

## Co je v repozitáři autoritativní

`MODEL_PROFILES` v `src/upgrade/model-profiles.js` je autorita mapy role→suite:
D1, D2 a R1 používají `reasoning`, CODE `code`, R2 `review`, CHAT `chat` a
VISION `vision`. `SUITES` v `src/upgrade/validation-suites.js` je autorita
seřazených testů: reasoning/code/chat mají po 8 testech, review/vision po 6.
Runner má verzi `v123.1`, provádí testy sekvenčně a vrací score a počet
úspěšných testů.

To samo ještě není acceptance policy. Nový policy modul už produkuje
role-bound `measurementContractSha256`, ale vědomě jej nevydává za
`role_contract_sha256` způsobilého PASS proofu. Repozitář nemá schválený
suite-level PASS práh ani immutable run artifact svázaný s digestem modelu.
Hodnoty `0.8` a `5/6` v schema testu jsou pouze fixture.
`BLACKLIST_THRESHOLD=0.2` rozhoduje o blacklistu, ne o kvalifikaci pro
automatický failover. Legacy `validation_suite_scores` navíc neukládá roli,
digest, policy, run ID, contract hash ani inventory snapshot a persistence
chybu pouze loguje.

## Neměnná bezpečnostní hranice

Bez ohledu na zvolený práh musí nový proof runner:

1. odvodit roli, suite, prahy, verze a contract hash z jednoho policy modulu;
2. odmítnout callerem dodaný práh, čas, TTL, suite, policy, hash nebo proof ID;
3. použít strict lokální inventory a přesný digest před i po běhu;
4. spustit právě jednu kompletní seřazenou suite v izolovaném runneru bez
   legacy persistence;
5. odmítnout partial, cancelled, malformed nebo podprahový výsledek;
6. nezměnit binding, config, `model_overrides`, `upgrade_history`, broadcaster
   ani externí síť;
7. uložit immutable run artifact se skutečnými prompty, options, výsledky a
   digestem a zapsat jej s PASS proofem atomicky, nebo nezapsat nic;
8. před terminálním zápisem znovu ověřit aktuální policy, validation version a
   role contract hash; samotný SQL trigger tuto živou autoritu nezná.

Contract hash používá versioned, sorted-key canonical JSON bez nové závislosti.
Pokrývá celé schválené authority pole: schema a canonicalization verzi,
`policyVersion`, validation verzi, všechny raw-byte source piny, runner,
acceptance včetně TTL a role-specific prahů a úplnou mapu rolí a suit. Raw-byte
piny patří `model-failover.js`, `model-profiles.js` a `validation-suites.js`.
Změna kteréhokoli authority pole nebo source pinu vytvoří nový contract hash a
staré proofy přestanou být způsobilé. Samotná změna contract version nevyžaduje
novou tabulku, ale vazba na immutable run artifact bude před issuance vyžadovat
aditivní storage checkpoint; dnešní volný `validation_run_id` není dostačující
důkaz.

## Varianty acceptance policy

| Varianta | Chování | Přínos | Riziko / cena přepnutí |
|---|---|---|---|
| A — absolutní bootstrap | `requiredScore=1` a všechny testy musí projít | Jediný práh odvoditelný bez false activation | Může být příliš křehký pro modelové gradery; mění se policy modul a jeho negativní testy |
| B — role-specific kalibrace | Každá role dostane schválený score/count práh z opakovaných běhů reference a kandidátů | Praktická kvalifikační hranice založená na datech | Nejdřív je nutný kalibrační artifact; bez něj by čísla byla odhad |
| C — measurement-only | Policy obsahuje mapu, source pins a runner parametry, ale `issuanceEnabled=false` a prahy `null` | Lze implementovat a testovat celý inertní řetězec bez falešného PASS | Terminal activation zůstane BLOCKED do volby A nebo B |

## Historický vratný default a implementovaný cíl

Measurement-only checkpoint původně používal **C**: `issuanceEnabled=false`
a prahy i TTL `null`. Po operátorském přijetí 2026-08-09 je v policy aktivní
**A + provizorní TTL 7 dní**. Všech sedm rolí vyžaduje skóre `1`, úplnou
seřazenou sadu 8/8 nebo 6/6 a `reason=null`. Tato změna pouze odemyká
samostatný issuer; measurement sám dál nic nepersistuje a zůstává
`NOT_ISSUED`.

Šev zůstává v `src/upgrade/model-failover-proof-policy.js` a focused testu
`tests/m1-model-failover-proof-policy.test.js`. Přechod nesmí zpětně povýšit
dříve naměřené diagnostické artefakty na PASS proof. Existující 14denní cache
age není součástí přijaté autority.

Toto rozhodnutí nezastavuje claim recovery, policy serializaci, strict
inventory adaptér ani negativní testy runneru. Zastavuje pouze vytvoření
způsobilého PASS proofu a runtime activation. Gate 1 proto zůstává `BLOCKED`.

## Implementační stav measurement policy — 2026-08-08

`src/upgrade/model-failover-proof-policy.js` je jediný fail-closed snapshot
role-suite autority pro izolovaný measurement runner. Pinuje raw bytes i délku
všech tří čtených zdrojů:

- `model-failover.js`: 145 428 B, `88a3c8e0…c0aa`;
- `model-profiles.js`: 9 967 B, `16941d6a…264a`;
- `validation-suites.js`: 39 108 B, `49520a41…b0ef`.

Nad nimi znovu odvozuje přesných 7 rolí, 5 suit a 36 definic testů ve
schváleném pořadí. ID je unikátní uvnitř každé sady; `instruction_follow` je
vědomě v reasoning i chat sadě. Kanonický formát má vlastní verzi
`sorted-key-json-utf8-v1`, řadí pouze object keys, zachovává pořadí polí a
odmítá sparse arrays, `-0`, non-finite čísla, accessors, skryté/symbolické
vlastnosti, neprosté objekty i cykly. Každý role measurement contract tak nese
deterministický hash, ale žádný `proofId`, proof hash ani PASS výsledek.

Authority hash `9bf5ebe2…5f93` se znovu odvozuje z celého policy envelope, ne
pouze z role mapy. Acceptance shape nese globální proof TTL a samostatný
`requiredScore`/`requiredPassedCount` pro každou roli. Implementovaná varianta
A používá `issuanceEnabled=true`, TTL `604800000`, skóre `1`, počet rovný celé
role suite a `reason=null`. Guard ani po chybné změně jediného booleovského
flagu nepovolí issuance bez konečného skóre v `(0,1]`, kladného počtu
nepřesahujícího velikost role suite a kladného integer TTL.

Policy není proof runner. Implementovaný
`scripts/run-model-failover-measurement.js` proto vytváří čerstvý izolovaný
child, kontroluje source piny i inventory před/po a ukládá skutečné prompty,
options a úplnou ordered result sadu. Reasoning `Math.random()` se
nedeterministicky neopakuje: skutečně použitý prompt a `_expected` grading
context jsou zachycené a znovu svázané. I synteticky perfektní výsledek zůstává
`NOT_ISSUED` a nevytvoří PASS proof ani DB zápis.

Samotný child runner považuje `sourceRevisionClaim`, callerem zvolený loopback
provider a očekávaný digest pouze za parent piny. Navazující parent acceptance
níže už tuto autoritu odvozuje z čistého Git kandidáta, configu a strict
inventory. Před proof issuance proto zbývá implementovat schválené prahy a TTL, aditivní
vazba immutable artefaktu na proof a terminální recheck živé policy,
validation verze a role contract hashe.

Navazující parent acceptance už první část uzavřel bez domýšlení autority:
caller dodá pouze roli a požadované jméno, provider pochází z configu, exact
model a digest ze strict inventory a source revision z čistého Git kandidáta.
Child i policy běží z privátního exportu přesných HEAD blobů. Parent ověří
process outcome, inventory před/po, artifact bytes/mode/path a úplnou pětici
pinů a vydá immutable `NOT_ISSUED` receipt. Tím se measurement stává
reprodukovatelnou kandidátní evidencí, nikoli PASS proofem: prahy, TTL,
atomická proof persistence a terminal activation zůstávají blokované.

Focused sady `IS-T1-TESTS-M1-MODEL-FAILOVER-PROOF-POLICY-TEST` a
`IS-T1-TESTS-M1-MODEL-FAILOVER-MEASUREMENT-TEST` i
`IS-T1-TESTS-M1-MODEL-FAILOVER-PARENT-ACCEPTANCE-TEST` běží offline, bez DB,
produktového serveru, Ollamy a GPU; poslední dvě používají pouze test-owned
loopback fake provider. Registrace measurement contractu nemění historický
Gate 0 fingerprint; ten je release evidence, nikoli vývojová autorita.

## Nezávislý read-only decision audit — 2026-08-09

Audit na `a82015a5` potvrdil, že 015 blokuje právě PASS proof a terminální
aktivaci/restore, nikoli hotový measurement řetězec. V produkčním `src/**`
není writer `model_failover_proofs` a v Gitu není skutečný kalibrační
measurement/acceptance artefakt. Starý GPU FAIL na 8192 ani CRE modelové běhy
nejsou role-suite evidencí pro tento kontrakt.

Současná proof tabulka sama nestačí jako autorita: neváže measurement artifact
SHA-256, parent acceptance SHA-256 ani source revision a SQLite nemůže ověřit
živý contract hash, validation version a schválené prahy. Syntetické proofy v
testech proto nejsou důkazem produkční issuance cesty.

### Přijatý konzervativní bootstrap

- **A + TTL 7 dní** (`604800000` ms);
- pro každou roli `requiredScore=1` a
  `requiredPassedCount=totalCount` (8/8 nebo 6/6);
- platnost je striktně `now < expiresAt`;
- po skutečné kalibraci lze jednotlivé role převést na B, ostatní zůstanou A.

Je to jediná okamžitá hranice bez odhadnutých čísel. Může failover odmítnout
častěji, ale nesmí jej aktivovat pod neprokázaným prahem. Finální B musí navíc
pinovat povinné test IDs: několik dnešních graderů kontroluje jen klíčová slova
nebo minimální délku, takže aggregate-only práh není dostatečný důkaz kvality.

### Navazující rozhodnutí, která issuance nesmí domyslet

1. Expiry během aktivního failoveru nezpůsobí náhlý cutover; doporučený stav je
   `DEGRADED_PROOF_EXPIRED`, jedna sériová revalidace a zákaz nového `REAPPLY`.
   Návrat smí nastat jen po návratu exact desired digestu nebo akci uživatele.
2. Doporučené úložiště je content-addressed artifact store s hashem v DB.
   Proof row se commitne až po durable artefaktu; orphan artefakt je přijatelný,
   proof bez artefaktu nikoli.
3. Budoucí B používá mandatory per-test kontrakt, ne jen aggregate score/count.

### Co sedmidenní TTL skutečně spouští

Aktuální kód nemá proof issuer ani revalidation trigger. Pětiminutový
detection scheduler má frozen port bez proof/model-run autority. Schválení
`A + 7d` tedy samo o sobě nezavádí týdenní GPU job.

Dnešní parent measurement je ručně spouštěné CLI pro právě jednu roli. Vždy
volá lokální Ollamu: dvakrát inventory a šest nebo osm chat requestů podle
suite. Neověřuje GPU residency a nedrží společný model/VRAM lease. Automatická
obnova by proto byla nový výpočetní a concurrency kontrakt, nikoli důsledek
samotného TTL.

Bezpečný provizorní význam je:

- 7 dní je pouze doba způsobilosti jednoho proofu;
- obnovu spouští explicitně operátor a role běží sériově;
- `autoFailoverEnabled` samo neopravňuje background proof běh;
- expiry aktivní fallback nepřepne: stav přejde na
  `DEGRADED_PROOF_EXPIRED`, jednou upozorní a blokuje nový `ACTIVATE/REAPPLY`;
- revalidation běží až na explicitní akci; návrat zůstává omezený na exact
  desired digest nebo uživatelský zásah.

Pokud má později vzniknout automatická obnova, vyžaduje samostatný opt-in,
shared model/VRAM lease a durable one-attempt-per-expiry ledger. Současný DB
kontrakt navíc používá inkluzivní `expires_at_ms >= event time`, zatímco přijatý
význam je striktní `now < expiresAt`; před aktivací se tato hrana musí sjednotit
a runtime musí expiry po aktivaci skutečně pozorovat.

Přesný potvrzovací blok:

```text
015-policy: A-bootstrap
015-ttl: 7d-provisional
015-trigger: OPERATOR_REQUEST_ONLY
015-auto-renewal: OFF
015-revalidation: ONE_ROLE_ONE_DIGEST_SERIAL
015-expiry: ACTIVE_STAYS_BOUND_DEGRADED_PROOF_EXPIRED
015-restore: FRESH_DESIRED_PROOF_OR_EXPLICIT_USER_BINDING
015-storage: content-addressed
015-calibration: mandatory-per-test
015-expiry-edge: NEW-ADDITIVE-MIGRATION-STRICT-LESS-THAN
```

Operátor tento blok přijal 2026-08-09. Nejmenší navazující hodnotný blok je
proof issuer s aditivní storage vazbou na oba artefaktové hashe, source revision
a živý measurement contract.

## Striktní expiry hrana — operátorská korekce 2026-08-09

Migrace 046 skutečně používá inkluzivní `proof.expires_at_ms >= NEW.…` na
čtyřech místech (`244`, `267`, `618`, `635`), zatímco přijatý význam je striktní
`now < expiresAt`. Rozdíl je jedna milisekunda, ale je to milisekunda, ve které
by expirovaný proof ještě aktivoval failover.

046 je aplikovaná a chráněná identity guardem, takže se **needituje**. Hranu
sjednotí nová aditivní migrace, která dotčené triggery bezpečně nahradí.
Rovnost `now === expiresAt` musí být povinný negativní test: proof v tom
okamžiku už není způsobilý.

Číslo migrace je **062**, rezervované společně s **061** pro rozhodnutí 020
z obnoveného union census přes všechny aktivní větve. Původní rezervace
`058`/`059` z `b863190a` byla před implementací zneplatněna mobilními commity
`e04be7f7` a `88b7b435`; mobilní rozsah `055`–`060` je nyní commitnutý do
`7916098e`. Ordinály `046`–`051` navíc už v historii kolidují napříč větvemi,
takže tato nová rezervace je zapsaná před vytvořením M1 migrace a nesmí se
znovu dopočítat pouze z jednoho checkoutu.

## Schema a ledger checkpoint — 2026-08-10

Migrace 062 je implementovaná aditivně. Nový append-only
`model_failover_proof_artifacts` váže každý nový proof na source revision,
parent run, SHA-256 a byte length obou artefaktů a na přesnou kopii všech polí
proofu. Deferred foreign key dovolí pouze companion-first/proof-second zápis v
jedné transakci; proof bez exact companionu, companion bez proofu při commitu,
historické doplnění, replacement, update a delete fail-close skončí.

Čtyři eligibility triggery nyní vyžadují companion join a používají striktní
`expires_at_ms > event/proof_verified time`. Historické proofy zůstávají auditní
data, ale bez vyrobené provenance nejsou způsobilé. Upgrade s již aktivním
legacy failoverem se odmítne před prvním DDL, protože jeho původní evidence
nejde zpětně vyrobit. Automatic activation ani revalidation tím nevznikly.

Samotný issuer zatím není implementovaný. Read-only call-graph audit prokázal,
že standalone acceptance validator poskytuje jen `STRUCTURAL_ONLY`; statický
connector s callerovým `acceptancePath` by proto mohl přijmout vzájemně
konzistentní, ale nepravdivý pár artefaktů. Bezpečný navazující connector musí
sám spustit parent measurement pro `(role, proposedModelName)`, držet jeho
odvozenou autoritu v paměti, znovu vyžadovat connection-local
`PRAGMA foreign_keys=ON` těsně před `BEGIN IMMEDIATE` a až potom vydat proof.
Tato korekce statického WP vyžaduje nový Review A; není důvodem oslabit ledger.
