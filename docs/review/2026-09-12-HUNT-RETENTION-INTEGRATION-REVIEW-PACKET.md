# Dokončený hunt: retence ve společném core kandidátu

Stav: `IMPLEMENTATION_VERIFIED / REVIEW_PENDING / PHYSICAL_MODEL_JOURNEY_UNPROVEN`.

Hunt je propojený s core včetně dokončené úzké retence. Kvalitativní odstranění
vyžaduje prohru ve všech použitelných rolích a aktuální přesné kontrakty;
staré CODE měření bez identity graderu nemůže v tomto kandidátu odstranit model.
Běžící hunt, jeho checkout, služby, modely, bindingy a živá DB se zde neměnily.

## Přesný rozsah pro recenzenta

- Core včetně prvního připojení huntu: `16fed51f019d684441f9714bd655024150851fdf`.
- Dokončený hunt: `ee4472d568f8caa762890e734ddea29f0d22e73f`.
- Integrační merge: `7d33e6315ad2dcf5f7315c91dab95bab022e9bbd`.
- Explicitní graph pin a testovaný kandidát: `ed595ad3748766dba644a5e4c19df990ea0d70de`.
- Pozdější změny tohoto předání jsou pouze dokumentace. Stav implementace není
  nezávislé přijetí retence ani release.

```bash
git diff 16fed51f..ed595ad3
git diff ee4472d5..ed595ad3
git show --remerge-diff 7d33e631
```

První diff zahrnuje **celou retenční implementaci**, ne pouze integrační opravy.
Prověřte `src/upgrade/model-hunt-retention.js`, `model-hunt-state.js`,
`model-registry.js`, `scripts/model-upgrade-hunt.js` a systemd service template.
Druhý diff ukazuje core kontrakty, se kterými musí hunt fungovat. Historický
[hunt packet](2026-09-12-GPU-HUNT-RETENTION-REVIEW.md) a jeho neúspěšné pokusy
zůstávají důkazem svého vlastního source; nepřejímají se jako nový PASS.

## Autorita a integrační kontroly

1. Retence používá existující registry mutation owner a durable artifact claim.
   Přesný digest, provider, bindingy a podklady se kontrolují znovu před efektem;
   aktivní, desired a rollback modely jsou chráněné. Inference v samotné retenci
   není. Větev ověřeného CPU spill vyžaduje přesné produkční umístění; timeout
   nebo chybějící měření neznamenají prokázanou nevhodnost.
2. Kvalitativní větev kontroluje všechny technicky použitelné role i při CODE-only
   huntu. Remíza, nedostatečné rozlišení, chybějící role nebo přínos v jedné roli
   vedou k ponechání. `--allow-removal` je alias úzké cesty; candidate trial má
   inline odstranění vypnuté. Serverový age-based cleanup zůstává samostatný.
3. CODE helper/lock/Node identity mění contract hash i rejection key. Integrační
   regrese nejprve prokáže interně kompletní staré důkazy a pak kontroluje,
   že pod aktuálním kontraktem nevznikne ani journal schválení, ani delete call.
   Historické řádky zůstávají zachované. Podmínky scheduleru se mohou změnit;
   opakování měření a 24h retry backoff jsou oddělené od pouhého stažení.
4. Potvrzené odstranění, neznámý výsledek provideru a ponechání jsou různé stavy.
   Journal zachovává `APPROVED`, `DELETED` i `DELETE_FAILED`. Review má sledovat
   celý callback až k durable provider intentu a skutečnému registry výsledku.
5. Kanonická provider [Decision 048](../decisions/048-reproducible-evaluation-provider.md)
   obsahuje nové autorizované provedení retence. Její policy body je přesně
   shodné s foreign ee4472d5; 044 je označený alias včetně nové historické kotvy.
   Web Decision 044, migrace 113 a exact-stamp adoption zůstávají beze změny.
6. Sedm přesných importů retence má samostatný baseline commit: 1330 hran,
   3 cykly / 28 členů, nula odstraněných hran. Automatický merge zdvojil import
   role plans v testu; duplicita byla odstraněna před první validací.

`integration-parity.json` porovnává 16 souborů proti přesným vstupům, včetně
nezměněné retence, webu, CODE provenance, migrace, registry/locku a obou dříve
optimalizovaných DB fixture setupů. Žádná assertion, required membership ani
timeout se kvůli novému PASS neměnily.

## Ověření

| Ověření | Source | Výsledek |
|---|---|---|
| Celý povinný deterministic profil | ed595ad3 | **353 PASS**, 0 FAIL/TIMEOUT/BLOCKED/SKIPPED |
| Hunt / registry authority / schema / CDP reducer | 7d33e631; znovu v plném profilu ed595ad3 | **99/99 · 20/20 · 61/61 · 63/63** |
| Lifecycle application service | ed595ad3 | **53/53**, 20 570 ms při stejném 60s limitu |
| Studio composer DOM / M0 / M1 | ed595ad3 | **3/3 PASS v jedné sekvenci** |
| HTTP lifecycle / web | ed595ad3 | **75/75 · 7/7**, dva skutečné procesové restarty |
| Registry | ed595ad3 | **516**, stejný fingerprint 162b890b… |

Full report SHA256: `a94f430742756311297ea857fcf87feec912d8b4c227c7e2c5b47067ad2d33d1`.
Registry fingerprint:
`162b890b97142127fdd4859bc48a02056a837b3fd2773e26d8a130e0e55f4deb`.

HTTP success prošel mezi PID 1899429 → 1899581; scénář chybného testu a rollbacku
mezi PID 1899599 → 1899731. Všechny čtyři procesy skončily exit 0 bez vynucení.
Trvalý stav, schválení, obsah a výsledky se kontrolují po novém otevření DB.
HTTP používá skutečné routes/service/SQLite/Git/bwrap s řízeným modelem a auth.

Studio běží v soukromém loopback namespace a Xvfb, GPU zařízení jsou skrytá.
Frontend bundle SHA256:
`8fee233175ff7bc2b2f4bb5b98778c740c3c6720649119e1c20c4fdbd632ad69`.
Composer/M0 používají production backend a modelový sentinel, M1 řízený backend.
Nejde o nově doložené sestavení v fresh-clone release envelope.

## Původní M1 chyba a hranice důkazu

Na 71968508 měl předchozí běh pět neúspěšných list požadavků bez úplného wire
záznamu; izolované opakování tehdy prošlo. Nová společná sekvence nyní prošla
celá. Původní příčina je stále **neprokázaná**, výsledek se nepřeznačuje na opravu.
Záměrný listener restart během úvodního načítání je hypotéza, nikoli závěr.

Reducer nyní zachovává pouze uzavřené třídy síťových chyb a příznak cancellation,
takže další selhání může odlišit přerušení od odmítnutého spojení. Nikdy nezapisuje
raw Chromium error text. Regrese ověřuje redakci i to, že failed/canceled request
stále selže na stejné wire policy. Celý původní neúspěšný běh zůstává v
[předchozím předání](2026-09-12-CORE-HUNT-INTEGRATION-REVIEW-PACKET.md).

## Další produkční krok a předání

- Nezávisle zrevidovat tento úplný rozsah retence a integrace.
- Pro aktuální CODE contract je potřeba nové měření přesných artefaktů;
  `evaluation-contracts.json` obsahuje identity všech sedmi sad. Aktuální CODE
  contract je `6ee5ab47cbc4a42649835cac02d6cca82ad43d97ba12a9fbaa84276fe6fc7035`;
  starý `09d65ca7…` není current evidence. Tento záznam není aktivace modelu.
- Doložit spojený fyzický Studio → production server → binding → model →
  preview → approval → execution → process restart journey. Samostatné důkazy
  v tabulce se do něj nesčítají. Zůstávají také externí M5 custody/recovery a
  M5/M6 acceptance podmínky; tento WP nemanipuloval s operátorskými klíči.

[Strojový run record](../execution/runs/hunt-retention-integration-20260912.json)
a [WP](../wp/WP-CORE-HUNT-INTEGRATION-20260912.md) uvádějí ownership a scope.
Lokální předání je `.intentsmith-artifacts/hunt-retention-review-20260912/`:
`source.bundle`, `manifest.json`, `evidence.tar.gz`, `handoff.json`.
Manifest připíná každý artefakt SHA256 a celý archiv se po sestavení znovu ověří.
Soukromé DB, profily, HOME a Xauthority v archivu nejsou. Bundle zahrnuje oba
rodiče integrace od společného 983121ee; starší evidence se nepřepisuje.
