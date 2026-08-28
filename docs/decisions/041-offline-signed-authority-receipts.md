# Decision 041 — Offline signed authority receipts

**Datum:** 2026-08-28
**Stav:** `CHANGES_REQUIRED / REMEDIATION_IMPLEMENTED / RE_REVIEW_REQUIRED`
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
Nemění však aktuální stav milníků:

```text
M5 = PRIVACY_CHANGES_REQUIRED
M6 = ACCEPTANCE_BLOCKED
```

Samotná implementace podpisového kontraktu není rotace, history disposition,
review, demo, acceptance ani promotion.

Implementace je rozdělena do produktových commitů `c0840f65`, `860d5268` a
`d5037467`; přesné module-boundary ratchety jsou `97848c15` a `f3e0575f`.
Trust store zůstává prázdný a fail-closed až do samostatného offline key
ceremoniálu.

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
