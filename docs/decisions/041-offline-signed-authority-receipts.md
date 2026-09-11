# Decision 041 — Offline signed authority receipts

**Datum:** 2026-08-28
**Stav:** `IMPLEMENTATION_REVIEW_PASSED / KEY_CUSTODY_CHANGES_REQUIRED /
PRODUCT_REMEDIATION_IMPLEMENTED / RE_REVIEW_REQUIRED`
**Protokol:** `OFFLINE_ED25519_SIGNED_RECEIPTS`

## Rozhodnutí

Operátor schválil společný kontrakt `SignedAuthorityReceipt@1` a samostatný
verifier pro autoritativní operátorské vstupy v následujícím rozsahu:

- M5 privacy remediation;
- M5 final acceptance;
- M6 independent review;
- M6 operator demo;
- M6 Gate 0.

Toto rozhodnutí nahrazuje procesní autoritu popsanou v Decision 035 a 036.
Samotné rozhodnutí nemění acceptance stav. Aktuální stav po úzkém review
product candidatu `d81be45f` je:

```text
M5 = 8/9 REVIEW_PASSED / PRIVACY CHANGES_REQUIRED / ACCEPTANCE_BLOCKED
M6 = KEY_CUSTODY_CHANGES_REQUIRED / ACCEPTANCE_BLOCKED
```

Samotná implementace podpisového kontraktu není rotace, history disposition,
review, demo, acceptance ani promotion.

Implementace je rozdělena do produktových commitů `c0840f65`, `860d5268` a
`d5037467`; přesné module-boundary ratchety jsou `97848c15` a `f3e0575f`.
Trust store byl po nezávislém `REVIEW_PASSED` a samostatné autorizaci operátora
naplněn čtyřmi oddělenými veřejnými klíči. Privátní klíče zůstávají mimo
repozitář a aplikaci v operátorem potvrzeném lokálním vaultu.

## Role a kryptografické domény

Každá role má vlastní Git-pinned Ed25519 public key. Jeden veřejný klíč nesmí
být připnut pod více rolemi.

| Role | Povolená doména |
|---|---|
| `m5-privacy-operator` | `intentsmith.m5.privacy.rotation.v1`, `intentsmith.m5.privacy.history.v1` |
| `m5-acceptance-operator` | `intentsmith.m5.acceptance.v1` |
| `m6-independent-reviewer` | `intentsmith.m6.independent-review.v1` |
| `m6-release-operator` | `intentsmith.m6.operator-demo.v1`, `intentsmith.m6.gate0.v1` |

`keyId` je `sha256:` digest kanonického SPKI DER veřejného klíče. Trust store
je součástí Git-pinned produktu, je fail-closed a SQLite ani settings jej
nesmějí rozšiřovat. `REVOKED` klíč nikdy neověří nový ani uložený receipt.

Privátní klíče jsou výhradně offline. Nesmějí být v aplikaci, repozitáři,
SQLite, serverovém environmentu, CI artefaktech ani testovacích logách.
Produkční klíče se během buildu nebo testů negenerují. Jednotkové testy smějí
používat pouze zřetelně testovací, efemérní fixture klíče.

Ed25519 se používá přes standardní Node `crypto` API podle
[RFC 8032](https://www.rfc-editor.org/info/rfc8032/); vlastní kryptografický
algoritmus se neimplementuje.

## Podepisovaný envelope

Podpis pokrývá přesné kanonické UTF-8 bajty a domain separator. Envelope váže
minimálně:

- contract, version, algorithm, domain, authorityId a keyId;
- product candidate commit i tree;
- evidence HEAD;
- registry fingerprint;
- SHA-256 release evidence indexu a artifact manifestu;
- přesné artifact bindings (`path`, `bytes`, Git mode, SHA-256);
- decision, celočíselný timestamp a globálně unikátní 128bit nonce;
- identitu předchozího receiptu v lineárním `C–E–R–A` řetězu;
- autentizovaného lidského aktéra a typově specifický payload.

Každý receipt typ má vlastní doménu, takže privacy podpis nelze přehrát jako
M5 acceptance, M6 review, demo nebo Gate 0.

## Nedůvěryhodné úložiště a finální verifier

SQLite je pouze nedůvěryhodný nosič raw receipt bytes. Každý read, summary a
promotion znovu ověřuje:

```text
canonical form -> key role -> Ed25519 signature -> semantic bindings -> replay
```

Uložený příznak typu `validated=true`, SQLite trigger ani UDF není autorita.
Same-process caller, druhé SQLite spojení nebo výměna UDF nesmí vyrobit PASS.

M6 promotion navíc provádí samostatné CLI nad raw Git-pinned bundle. Výsledek
běžící aplikace nebo lokální nepodepsaný JSON nestačí.

CLI kontroluje celý rozsah product candidate → finální evidence HEAD, včetně
deletions, registry driftu a čistoty pracovního stromu. Každý receipt smí
odkazovat jen na evidence HEAD, na kterém už existují přesné podepsané bytes
release evidence indexu a artifact manifestu. History `postDispositionHeadSha`
musí být předkem product candidatu a M5 acceptance musí opakovat stejnou
disposition jako navázaný privacy history receipt.

## Privacy payload

Rotation receipt váže incident, kategorii, authority kind, dokončení operace a
digest relevantního provider/action důkazu. Nesmí obsahovat hodnotu tajemství
ani její hash, prefix nebo suffix.

History receipt navíc váže disposition, skutečně dokončenou akci,
post-disposition HEAD, ref census a privacy scan.

## Povinné fail-closed regrese

Následující případy končí `BLOCKED/FAIL`, nikdy `PASS`:

- wrong key nebo role;
- změna jediného podepsaného bajtu;
- cross-role replay;
- jiný nebo starý product candidate;
- jiný evidence HEAD;
- duplicate nonce nebo neplatný předchozí receipt;
- DB/UDF replacement a druhé SQLite spojení;
- neznámý nebo revokovaný klíč;
- unsigned legacy receipt.

## Výslovně nepovolené akce

Toto rozhodnutí nepovoluje automatickou výrobu produkčních privátních klíčů,
skutečné rotace, history rewrite, M5/M6 promotion, tag ani publish. Reálné
klíče vzniknou až samostatným offline operátorským ceremoniálem po re-review
implementace.

## Nezávislý re-review implementace

Review exact candidatu `73fdf8365c97c49292752a0e46697345eada0f44`
skončil `CHANGES_REQUIRED`; focused `369/369` nepokrývalo nalezené adversariální
případy. Remediation je rozdělena na raw/SQLite commit `95a2cd6c`, Git-lineage
commit `4beced1b` a exact module baseline `2b5da617`. Tyto nové bytes vyžadují
samostatný re-review a do jeho `REVIEW_PASSED` zůstává offline key ceremony
blokovaná.

Následující re-review exact candidatu
`75498c69cb7587378b0fe29e44dde7cc03c9cc4c` znovu skončil
`CHANGES_REQUIRED`. SQLite repository načítalo raw envelope přes lossy `TEXT`
dekódování a Git verifier kontroloval jen koncový diff, takže dočasná změna
produktu následovaná revertem zmizela. Vedle toho lokální Git čtení přijímalo
replacement objects a skryté index flags. Remediation `8632c490` ověřuje
uložené receipty z přesných BLOB bytes, prochází každý commit i každý parent,
merge commity odmítá, opakuje stejný důkaz pro každý receipt evidence HEAD a
fail-closed odmítá replace refs, grafts, `assume-unchanged` i `skip-worktree`.
Samostatný temp-Git E2E prokazuje PASS platného 13-receipt bundle a FAIL pro
mutate→receipt→revert historii. Třetí nezávislý re-review exact candidatu
`37edf30d738f780594af98a7a1076e3200038478` skončil `REVIEW_PASSED` a odemkl
samostatně autorizovanou ceremonii.

## Offline key ceremony 2026-08-29

Operátor autorizoval ceremonii příkazem „Zahaj offline key ceremony a přibal
M5-R19“ a následně potvrdil lokální vault
`/home/belphareon/INTENTSMITH_KEYS`. Proces běžel v `bwrap --unshare-net`, měl
read-only root a zapisoval pouze do adresáře `2026-08-29-prod-v1`. Privátní
PKCS#8 soubory mají mód `0600`, vault `0700`; žádný privátní bajt ani jeho hash
nebyl zapsán do Git, SQLite, environmentu serveru ani testovacího logu.

Git-pinned veřejné identity jsou:

| Role | `keyId` |
|---|---|
| `m5-privacy-operator` | `sha256:117ab9bb4b87bf20668b61847f23bf30a92e2e268849377e39ae44e5bba83597` |
| `m5-acceptance-operator` | `sha256:e6396e1498d1e1a9a7fde0a24cae03ea971dd7654520dd3c8c2340980e6c6368` |
| `m6-independent-reviewer` | `sha256:b875503ff1e60db13cf8b20ac77f8298560de7e7390ab3f70b150e3e9d907f49` |
| `m6-release-operator` | `sha256:029f78bbcec1393d96f93759cdffe0c9041f45d48f9888cd1b4e6fb99b330c99` |

Každý privátní klíč byl v izolovaném procesu ověřen proti vlastnímu SPKI a
testovacímu podpisu; všechny čtyři identity jsou rozdílné. Publikace trust
storu mění product candidate, proto tento nový řez vyžaduje úzký re-review.
Ceremonie sama neprovedla rotaci, history disposition, acceptance, promotion,
tag, publish ani push.

## Úzký product re-review 2026-08-29

Review candidatu `d81be45f` skončil `CHANGES_REQUIRED`. Kryptografické identity,
402 focused/structural kontrol, registry i current-tree privacy scan prošly, ale
produkční M6 upgrade kontrakt stále očekával 79 migrací. Skutečný loopback-only
upgrade z verze 136.0.0 aplikoval 80 a skončil `80 !== 79`. Oracle byl na
M5/M6 kandidátu sjednocen na 80. Následná modelová integrace přidala sedm
migrací; společný candidate je proto navázaný na 87 a čeká na nový
exact-candidate re-review.

Současně nebyl přijat custody model privátních klíčů. `bwrap --unshare-net`
izoloval generování, ale všechny čtyři nešifrované PKCS#8 soubory po ceremonii
zůstaly trvale připojené na stejném `/home` Btrfs svazku a pod stejným OS účtem
jako aplikace a workery. To není výhradně offline úložiště a nedává nezávislé
custody roli `m6-independent-reviewer`. Před prvním podpisem musí být klíče
přesunuty na šifrované odpojené médium nebo do ekvivalentního skutečně offline
signing prostředí; reviewer key musí mít oddělenou custody. Přesun stejných
keypairů nemění trust store. Regenerace keypairů mění product candidate a
vyžaduje další review.

## Operátorský směr custody — 2026-09-10

Operátor zvolil pro produkční offline custody celý LUKS2 šifrovaný filesystem
na jiném odpojitelném médiu; aktuální NTFS zařízení není tímto cílem. Kapacita
16 GB je pro čtyři PKCS#8 klíče, veřejné identity, 13 receipt envelopes a jejich
manifesty s velkou rezervou dostačující. Přesný obsah a ověření vzniknou až nad
konkrétním médiem, proto tento zápis není custody receipt.

Reviewer key nesmí skončit ve stejné fyzické custody jako operátorské klíče.
Vyžaduje samostatně držené médium nebo ekvivalentní oddělenou offline autoritu.
Do připojení a ověření těchto prostředků zůstávají původní privátní klíče na
online `/home` a stav `KEY_CUSTODY_CHANGES_REQUIRED` platí beze změny.

## Custody A checkpoint 2026-09-10/11

Autorizované `/dev/sde1` bylo převedené na celý LUKS2 svazek. Obsahuje ověřené
kopie tří operátorských private keys a záměrně neobsahuje reviewer private key.
Po zápisu byl svazek odpojený, zamčený a USB zařízení vypnuté. Read-only census
2026-09-11 zjistil, že bylo médium znovu odemčené a automountnuté; žádný proces
je nepoužíval, proto bylo znovu bezpečně odpojené, zamčené a vypnuté. Tato
obnova stavu není druhá offline kopie ani custody receipt.

Běžný online cloud nebo připojený NAS nesplňuje `offline` ani oddělenou custody
reviewer role. Může nést další klientsky šifrovanou recovery kopii. Jako
ekvivalent média B by mohl být posouzen jen samostatně řízený signing prostor,
který je mimo aplikaci i worker účet a v klidu i při běžném provozu skutečně
nedostupný; taková ekvivalence musí být před prvním podpisem doložená a
nezávisle přijatá. Nejmenší současné riziko má samostatný malý LUKS2 USB disk.

## Custody B checkpoint 2026-09-11

Operátorem autorizovaný flash disk se serialem `00000000664DFFCA` byl po
záloze původních systémových metadat převeden na jeden LUKS2 oddíl přes
dostupnou kapacitu. Svazek obsahuje právě reviewer private key, všechny čtyři
veřejné SPKI identity, public ceremony manifest a Git-pinned trust store.
Odvozená reviewer identita i trust store byly bajtově ověřené. Tři operátorské
private keys jsou z média B vyloučené. Svazek byl odpojený, uzamčený a USB
vypnuté. Přesná nesenzitivní evidence je v
[`m5-offline-custody-b-20260911.md`](../execution/runs/m5-offline-custody-b-20260911.md).

Online zdroj zatím zůstává, protože druhá ověřená offline kopie operátorských
klíčů stále chybí. Custody B je ověřená offline kopie a fyzické oddělení, ale
celkový stav zůstává `KEY_CUSTODY_PARTIAL`; tento checkpoint nevydává receipt
ani M5 acceptance.
