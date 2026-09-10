# M5 operátorský remediation preflight — 2026-09-10

**Source:** `cf1779f038d914903db6e7091147346b77184b57`  
**Disposition:** `retain_and_rotate` vybraná, receipt nevydán  
**Stav:** `0/8 CATEGORY RECEIPTS / HISTORY RECEIPT MISSING / CUSTODY PENDING`

Tento preflight připravuje vstupy pro skutečné operátorské akce. Neobsahuje
hodnotu, hash, prefix ani suffix žádného credentialu. Neotevírá osobní Git
objekty a nevydává žádný podpis.

## Ověřený současný stav

`node scripts/scan-m5-privacy.js` na čistém source skončil:

```text
current tree: PASS, 2313 scanned files, 1101 content-read files, 0 findings
history: 13/13 known incident objects reachable
verdict: PASS_CURRENT_TREE_HISTORY_REMEDIATION_REQUIRED
personalContentInspected: false
secretValuesRecorded: false
```

Privacy-safe read-only projekce živé DB zjistila 0 řádků `api_tokens` a jediný
credential-like název v `user_settings`, `c3.notif.smtpPort`, který není
tajemství. V uživatelském shellu nebyla přítomná žádná relevantní credential
proměnná. Jediný pozorovaný `C3_ADMIN_TOKEN` patří síťově izolovanému M6 soak
fixture serveru. Produkční IntentSmith služba v censusu neběžela.

Současná absence není důkaz historické neaplikovatelnosti. Každá kategorie dál
potřebuje buď dokončenou rotaci/revokaci, nebo podepsané historické posouzení N/A
s navázaným důkazem.

## Osm kategorií a chybějící akce

| Kategorie | Dnešní privacy-safe zjištění | Co musí uzavřít kategorii |
|---|---|---|
| `administrative-api` | Živá DB má 0 issued API tokens; žádná produkční služba neběží | Rotace budoucího `C3_ADMIN_TOKEN` a zneplatnění dříve vydaných tokenů, nebo historický důkaz, že žádný použitelný token neexistoval |
| `ephemeral-authority` | V živé pre-upgrade DB nejsou M7 session tabulky; vydané API tokeny jsou 0 | Kontrolovaný restart/revokace po zmrazení kandidátu a evidence nulové staré autority |
| `fixture-password-reuse` | Kód rozlišuje fixture od produkce; reuse nelze odvodit ze stromu | Operátor doloží rotaci při reuse, nebo podepíše `FIXTURE_NOT_REUSED` po historickém posouzení |
| `license-agent` | Relevantní proměnná není v současném shellu | Inventář vydavatele/licencí; rotace aktivních hodnot, nebo důkaz, že v exposure scope nikdy nebyla použitelná autorita |
| `license-signing-validation` | Relevantní proměnná není v současném shellu | Reissue/revokace dotčených licencí a nový signing secret, nebo historický N/A důkaz |
| `model-provider` | Produkt používá lokální Ollamu; současný shell nemá provider credential | Audit účtů poskytovatelů a revoke/reissue všeho z exposure scope, nebo historický N/A důkaz |
| `notification-credentials` | Živá DB neobsahuje credential hodnoty a shell nemá notification credentials | Audit SMTP/webhook/Telegram/ntfy autorit, jejich rotace a ověření cíle, nebo historický N/A důkaz |
| `project-external` | Obsah projektů ani historických DB/attachmentů nebyl otevřen | Soukromá inventura Git/cloud/deploy/database/service autorit a rotace; přesnější rozsah vyžaduje samostatně povolené otevření osobních historických dat |

## Podpisový a custody preflight

Čtyři existující keypair identity odpovídají Git-pinned trust storu. Osm
privátních/public key souborů a dva veřejné manifesty mají dohromady pouze
**3562 bajtů** dat. Produkční custody médium bude obsahovat jen klíče, veřejné
manifesty, 13 receipt envelopes a přesné navázané evidence soubory, nikoli
automaticky celý 6,3GB pracovní artifact strom. Celý 16GB LUKS2 disk proto
poskytuje velkou kapacitní rezervu.

Jeden disk nesplní oddělenou fyzickou custody reviewer role. Doporučené rozdělení:

- LUKS2 médium A: `m5-privacy-operator`, `m5-acceptance-operator`,
  `m6-release-operator`, veřejné manifesty a finální receipt bundle;
- samostatně držené médium B: `m6-independent-reviewer` private key;
- veřejné SPKI a výsledné podepsané receipts mohou být na obou médiích i v Git.

Před přesunem se pro každý privátní klíč znovu odvodí pouze veřejná SPKI
identita a porovná se s trust storem. Privátní bajty ani jejich digest se
nezapisují do logu. Po dvou ověřených offline kopiích se online zdroj odstraní;
na Btrfs/SSD nelze tvrdit fyzicky prokázané přepsání původních bloků.

## Ověření kontraktu

Na tomto source prošlo:

```text
signed-authority-receipt: 5/5 PASS
signed-authority-bundle: 15/15 PASS
m5-privacy-remediation: 24/24 PASS
artifact-validation: 158/158 PASS
```

Bundle test zahrnuje úplný 13-receipt řetězec, smíšené rotation/N/A kategorie,
evidence-only Git hranici, per-receipt lineage a odmítnutí mutate→revert,
replace refs, graftů a skrytých index flags. Jde o implementační kontrolu,
nikoli produkční receipts.

## Pořadí dokončení

1. připojit a přesně identifikovat samostatné custody médium/média;
2. vytvořit LUKS2, zkopírovat stejné keypairy a ověřit veřejné identity;
3. pro každou z osmi kategorií provést provider/local action nebo doložit N/A;
4. vytvořit evidence-only commit s redigovanými action artefakty;
5. offline podepsat osm category receipts a `retain_and_rotate` history receipt;
6. dokončit M5 review a podepsat M5 acceptance;
7. teprve potom pokračovat M6 reviewer, demo a Gate 0 receipts.

Žádný z těchto sedmi kroků není tímto preflightem označen jako hotový.
