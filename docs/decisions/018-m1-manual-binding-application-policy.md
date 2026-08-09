# 018 — Manual binding potřebuje pravdivou failure, legacy a notification policy

- **typ:** DECIDE-AND-CONTINUE
- **stav rozhodnutí:** VRATNÉ DEFAULTY A; ČEKÁ NA OPERÁTORA
- **WP:** WP-M1-BINDING-APPLICATION
- **rail:** R1, R3, R5, R6
- **vzniklo při:** uzavření Findingu 008 pro běžný HTTP/chat provoz

## Co je zamčené a není předmětem volby

Přijatý manual repository commitne požadovaný binding jako
`PENDING_MANUAL / NOT_VERIFIED / NOT_APPLIED`. Runtime aplikace musí používat
tentýž append-only operation a revision, nesmí zpětně přepsat jeho význam a
nesmí zapsat `verified=1` bez skutečné verifikace přes exact model digest.

HTTP i chat musí používat jedinou application service. Durable commit je
autoritativní před broadcastem; rollback je nový append-only reversal, nikdy
`DELETE`. Automatický D+ failover, PASS proof issuance, prahy a TTL z 015 jsou
mimo tento WP a zůstávají vypnuté.

## Q1 — Co po neúspěšné verifikaci explicitně vybraného modelu

| Varianta | Chování | Dopad / cena přepnutí |
|---|---|---|
| A — model zůstane aktivní jako `FAILED` | Uživatelská volba se sama nevrátí; UI/chat pravdivě hlásí selhání a nabízí explicitní rollback | Zachová dnešní no-auto-rollback chování. Přepnutí je jedna policy funkce + 2 integrační testy. |
| B — automatický rollback | Po neúspěšné probe se obnoví předchozí model | Automaticky mění uživatelskou konfiguraci a potřebuje vlastní crash/retry/outbox kontrakt. |
| C — model se neaktivuje před verifikací | Verifikace proběhne před runtime cutoverem | Přidává dlouhé synchronní čekání a pro cold/pull cestu mění HTTP/chat UX. |

**Vratný default: A.** Je nejlevněji vratný a neuděluje systému novou
autoritu automaticky měnit explicitní uživatelskou volbu. Šev:
`handleManualVerificationFailure()` v application service.

## Q2 — Jak naložit s existujícími legacy override řádky bez digestu

| Varianta | Chování | Dopad / cena přepnutí |
|---|---|---|
| A — `LEGACY_UNVERIFIED` compatibility | Startup zachová dnešní binding, ale nikdy jej nevydá za digest-bound nebo verified truth | Funkční parita bez falešné evidence. Přepnutí je startup classifier + 2 restart testy. |
| B — fail-closed je neaplikovat | Startup legacy binding odmítne a použije default config | Může uživateli po upgrade změnit model bez jeho volby. |
| C — automaticky je prohlásit za nové manual bindingy | Starý řádek se převede do nové lineage | Vymýšlí chybějící actor, digest a request provenance; nepřijatelné. |

**Vratný default: A.** Legacy data se nezahodí ani nepovýší. Šev:
`classifyLegacyOverrideForStartup()`; C zůstává zakázané bez nové evidence.

## Q3 — Co když po durable commitu selže `model_changed` broadcast

| Varianta | Chování | Dopad / cena přepnutí |
|---|---|---|
| A — commit zůstává, notification je degraded | Binding se nepřehraje ani nerollbackne; klient se srovná při refresh/reconnect a audit nese notification failure | Nevytváří druhý provider/runtime efekt. Přepnutí je emitter policy + 2 testy. |
| B — rollback durable bindingu | Notification failure vrátí konfiguraci | Transportní chyba získá autoritu měnit model a vyžaduje další kompenzační transakci. |
| C — neomezeně retry | Service čeká nebo opakuje broadcast do úspěchu | Hrozí duplicity a blokace bez outbox kontraktu. |

**Vratný default: A.** Broadcast není commit autorita. Šev:
`publishBindingCommitted()`; případný durable outbox je pozdější samostatný WP,
ne skrytý retry loop.

## Q4 — Jak obnovit non-retryable manual apply

| Varianta | Chování | Dopad / cena přepnutí |
|---|---|---|
| A — nejdřív explicitní rollback | Neúspěšná operace zůstane autoritativní, nový apply skončí typovaným 409 bez provider/runtime effectu; operátor nejdřív vytvoří append-only rollback a potom nový apply | Backend je pravdivý a crash-safe. HTTP rollback existuje; chat/Studio rollback surface je `PENDING-OWNER`, takže celý UI recovery journey ještě není uzavřený. |
| B — compound supersede command | Jediný durable příkaz přijme replacement, odvodí reversal a restartově dokončí oba runtime kroky | Nová migrace, nový interní connector, crash recovery a nejméně 4 pozitivní/negativní journey testy. |
| C — automatický dvoukrok rollback + apply | Service nejdřív provede rollback a potom založí nový apply | Zakázaný default: crash mezi kroky mění runtime bez receipt pro požadovaný replacement a emituje dva konfliktní přechody. |

**Vratný default: A.** Je jediný současný stav bez odmítnutého requestu s
efektem. Šev pro případné B je nový `recordUserBindingSupersede()`; nesmí se
napodobit dvěma voláními existujících repository metod. Do vytvoření UI
rollbacku se manual backend checkpoint nesmí vydávat za kompletní chat/Studio
recovery journey.

## Q5 — Co s novým provider intentem po nedokončeném terminálním úspěchu

| Varianta | Chování | Dopad / cena přepnutí |
|---|---|---|
| A — nejdřív uzavřít starší terminál | Pro stejnou roli a binding revision DB odmítne další provider intent i jiný desired transition, dokud předchozí terminální success nemá přesný binding nebo no-op receipt | Fail-closed stav neuhodne, který cíl uživatel považuje za autoritativní. Exact request smí dokončit provider→binding; current-binding no-op uzavře celý terminální prefix. |
| B — explicitní pořadí a supersede | Novější intent může append-only supersedovat starší command přes explicitní vztah nad existující DB sequence | Nový supersede kontrakt a crash/race důkazy pro success→success, success→failed/pending a přímý SQL bypass. |
| C — při restartu vzít nejnovější timestamp | Poslední časově označený command vyhraje | Zakázaný default: shodné nebo obrácené wall-clock hodnoty nejsou kauzální autorita. |

**Vratný default: A.** Je konzervativní a zavírá dvojí pre-binding crash bez
nové autority automaticky přepisovat starší přijatý command. Šev pro případné B
je samostatný append-only provider-supersede recorder nad existujícím
DB-assigned `command_seq`. No-op receipt je DB-odvozená množina: při živém commandu failne a po
terminálu atomicky naváže všechny dosud neuzavřené terminální commandy stejné
role/revision. Caller seznam ani supersession ID nedodává.

## Přesná otázka pro operátora

```text
018-Q1: A
018-Q2: A
018-Q3: A
018-Q4: A
018-Q5: A
```

Defaulty dovolují pokračovat uvnitř přesně pojmenovaných švů. Jakýkoli požadavek
na automatický failover, změnu veřejného HTTP/WS/M1 connectoru, PASS proof nebo
L0-9 zůstává tvrdý BLOCK a tímto záznamem se neobchází.
