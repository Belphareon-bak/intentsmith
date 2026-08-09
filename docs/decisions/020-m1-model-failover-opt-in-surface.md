# 020 — D+ failover nemá podporovaný typovaný opt-in povrch

- **typ:** BLOCK pouze pro uživatelské zapnutí D+ failoveru
- **stav rozhodnutí:** ČEKÁ NA OPERÁTORA; detection-only scheduler zůstává bezpečně default off
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
| **A — samostatná typed model-policy route** | Přidat exact `PUT /api/system/models/settings`; body smí nést pouze modelové policy klíče a volá `updateModelSettings()`. Obecný backup/import/reset se nemění. | Nejužší autorita a zachování parity C3. Studio toggle může přistát později jako konzument stejné route. | `src/routes/system.js`; route/focused test; pozdější Studio consumer. |
| **B — validovat modelovou sekci v obecném POST** | `POST /api/settings` zůstane full replacement, ale před zápisem validuje `models` a odmítne neznámé klíče. | Backup/import/reset může dál zapnout i vypnout failover a zůstává race mezi full-document writery. | `src/routes/misc.js`, všechny backup/import/reset testy a klientské journey. |
| **C — změnit obecný POST na merge** | Chybějící sekce se zachovají; explicitní reset dostane nový endpoint nebo flag. | Řeší část lost-update problému, ale mění živý veřejný kontrakt a všechny settings klienty. | `misc.js`, Studio `lib`, legacy UI, backup/import/reset a route testy. |
| **D — pouze DB/CLI opt-in** | Produkční UI/API nevznikne. | Interní mechanismus zůstane pro běžného uživatele nedosažitelný; není to prod-ready výsledek. | Bez kódu, ale M1 zůstává BLOCKED. |

## Doporučení

**A.** Je to nejmenší vratný šev a jediná varianta, která nemění existující
backup/import/reset kontrakt. Exact body může použít stejné tři klíče jako
`DEFAULT_MODEL_SETTINGS`; unknown key, non-boolean, out-of-range days,
malformed storage a DB failure musí skončit typovaně před změnou dokumentu.

Samotná route ještě neaktivuje fallback. Pouze zpřístupní uživatelský opt-in
pro již implementovaný detection-only scheduler; PASS proof, threshold/TTL a
terminal activation zůstávají samostatně blokované rozhodnutím 015.

## Přesná otázka pro operátora

```text
020: A
```

Do odpovědi lze dál pracovat na 015/017 decision evidence. Implementace route
je zastavená, protože jde o nový veřejný HTTP povrch, nikoli interní detail.
