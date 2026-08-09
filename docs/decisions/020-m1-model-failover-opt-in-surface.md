# 020 — D+ failover nemá podporovaný typovaný opt-in povrch

- **typ:** BLOCK pouze pro uživatelské zapnutí D+ failoveru
- **stav rozhodnutí:** CHANGES_REQUIRED; A samotné nezajišťuje jedinou policy autoritu
- **WP:** WP-M1-MODEL / B3-FAILOVER
- **rail:** R1, R3, R5, R6
- **vzniklo při:** post-checkpoint call-graph kontrole `updateModelSettings()`

## Evidence na stole

`src/db/user-settings.js:updateModelSettings()` je jediný writer, který:

- mění pouze vlastněnou `models` sekci v jedné `BEGIN IMMEDIATE` transakci;
- zachová všechny ostatní sekce;
- odmítne neznámé modelové klíče a neplatné hodnoty;
- neumožní přepsat malformed dokument.

V produkčním `src/` jej ale nic nevolá. D+ detection scheduler proto lze dnes
zapnout jen přímým zápisem do DB nebo obecným `POST /api/settings`.

Obecná route v `src/routes/misc.js` je autoritou backup/import/reset celého
dokumentu: tělo bez validace uloží přes `INSERT OR REPLACE` a potom je předá
feature manageru. Skutečný in-memory route probe skončil exit `0` a prokázal:

1. POST dokumentu s `models.autoFailoverEnabled=true` vrátil 200, policy byla
   `VALID/enabled` a neznámý `models.foreignKey` zůstal uložený;
2. navazující POST `{}` vrátil 200, odstranil všechny klíče dokumentu a policy
   přešla na validní default `false`.

Navazující review našlo další tři produkční read-modify-write cesty stejného
řádku: storage settings v `src/routes/system.js`, webhook secret v
`src/routes/security.js` a notification config v `src/routes/notifications.js`.
Všechny čtou JSON a později zapisují celý řádek bez společného transaction/CAS
seamu. Typed PUT podle původní varianty A by proto nebyl jedinou autoritou:
legacy POST může policy validně zapnout, vypnout nebo přepsat stale snapshotem
a ostatní writery mohou novější modelovou změnu ztratit. Samostatný
`POST /api/reset` navíc celý řádek maže. Celkem tedy existuje pět živých
mutation cest nad stejným blobem.

`readModelSettings()` navíc ověřuje pouze hodnotový tvar známých klíčů. Neznámé
modelové klíče ignoruje a nedokládá, který writer změnu provedl. Pouhá validace
modelové sekce v původní variantě B neřeší validní `true`, lost update ani
provenance; A+B v tomto znění tedy také nestačí.

Tento reset je živá funkce Studio runtime
(`c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js`): tlačítko
„Obnovit výchozí“ záměrně posílá `{}`. Import a běžné Studio/legacy UI save
posílají celý snapshot. Změnit POST na merge by tedy nebyla interní oprava;
změnilo by to veřejnou backup/import/reset sémantiku.

Detection coordinator sám zůstává fail-closed: bez literal `true` neprovede
inventory ani zápis a policy kontroluje znovu uvnitř každé durable transakce.
Chybí podporovaný způsob, jak uživatel opt-in bezpečně a jednoznačně nastaví.

## Varianty

| Varianta | Chování | Dopad | Cena přepnutí |
|---|---|---|---|
| **A — samostatná typed model-policy route** | Přidat exact `PUT /api/system/models/settings`; body smí nést pouze modelové policy klíče a volá `updateModelSettings()`. | Nutný vstupní povrch, ale při dnešním společném JSON řádku není výhradní autoritou. | Route/focused test; bez další ochrany zůstává overwrite cesta. |
| **B — validovat modelovou sekci v obecném POST** | `POST /api/settings` zůstane full replacement, ale před zápisem validuje `models` a odmítne neznámé klíče. | Odmítne malformed data, ale stále dovolí validní aktivaci a stale last-writer-wins. | `misc.js`, backup/import/reset testy; neřeší ostatní writery. |
| **C — změnit obecný POST na merge** | Chybějící sekce se zachovají; explicitní reset dostane nový endpoint nebo flag. | Řeší část lost-update problému, ale mění živý veřejný kontrakt a všechny settings klienty. | `misc.js`, Studio `lib`, legacy UI, backup/import/reset a route testy. |
| **D — pouze DB/CLI opt-in** | Produkční UI/API nevznikne. | Interní mechanismus zůstane pro běžného uživatele nedosažitelný; není to prod-ready výsledek. | Bez kódu, ale M1 zůstává BLOCKED. |
| **E — oddělená failover-policy storage + typed route** | D+ opt-in má vlastní versioned/CAS řádek a jediný repository writer; obecné settings jej neumí aktivovat ani přepsat. Export/import/reset dostanou explicitní verzovaný adaptér přes stejný repository seam. | Jediná prokazatelná writer provenance bez přepisování živého settings kontraktu. Failover lze default-off migrovat bez důvěry ve starý nevalidovaný klíč. | Aditivní migrace, failover-policy repository/read model, typed route a explicitní backup/import/reset integrace. |

## Doporučení

**E.** Původní A je nutná route, nikoli dostatečná storage autorita. Oddělená
`model_automation_policy` storage je menší než refaktor všech historických
settings writerů a jako jediná brání tomu, aby obecný POST nebo stale merge
policy zapnul či přepsal. D+ tabulka musí začít default-off; žádné staré
`user_settings.models.autoFailoverEnabled=true` se automaticky nepovýší na
důvěryhodný opt-in.

Projection nese revision a `last_event_id`; každá změna má repository-owned
request ID, actor/source a shodný append-only audit event. Reader přijme pouze
projekci odpovídající eventu, jinak vrátí typovaný invalid/default-off stav.
Typed GET/PUT používá exact tři dnešní automation klíče, expected revision a
CAS. Scheduler i cleanup čtou pouze tuto autoritu.

Obecný `/api/settings` rezervovaný top-level `models` odmítne a policy nikdy
nemění. Backup/import/reset parity se zachová pouze explicitním verzovaným
adaptérem, který volá tentýž repository commit point; běžný full-document save
policy neovládá a globální reset vytvoří auditovaný přechod na OFF.

Samotná route ještě neaktivuje fallback. Pouze zpřístupní uživatelský opt-in
pro již implementovaný detection-only scheduler; PASS proof, threshold/TTL a
terminal activation zůstávají samostatně blokované rozhodnutím 015.

## Povinné negativní důkazy varianty E

- generic POST s validním `models.autoFailoverEnabled=true` je odmítnut a
  nevytvoří policy ani provider efekt;
- stale Studio snapshot ani generic `{}` policy nezmění;
- unknown key, string `"true"` a neplatné cleanup days selžou bez mutace;
- missing/stale revision skončí konfliktem a dva WAL writery mají jednoho
  vítěze;
- projekce bez shodného audit eventu je invalid/default-off;
- preexisting legacy `models.autoFailoverEnabled=true` zůstane po migraci OFF;
- storage, notification a webhook writer policy nezmění;
- neúspěšný explicitní import rollbackne general settings i policy;
- explicitní reset zapíše právě jeden auditovaný přechod na OFF;
- restart zachová policy, revision a event lineage.

Vlastněné cesty jsou nová aditivní policy migrace, nový
`src/db/model-policy.js`, model failover/registry readers, typed route v
`src/routes/system.js`, rezervované pole a explicitní import/reset v
`src/routes/misc.js` a pozdější autoritativní Studio consumer. Číslo migrace se
přidělí až z aktuálního čistého migračního census; dokument je nepředjímá.

## Přesná otázka pro operátora

```text
020-storage: E
020-api: typed-route
020-legacy-settings: cannot-enable-or-overwrite
020-backup-import-reset: explicit-versioned-adapter
```

Do odpovědi lze pracovat na přijatém 017. Implementace 020 zůstává zastavená,
protože mění veřejný HTTP povrch i durable writer authority.
