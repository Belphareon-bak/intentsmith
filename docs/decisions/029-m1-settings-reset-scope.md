# 029 — reset musí pravdivě pojmenovat rozsah a obě route

- **typ:** destruktivní settings connector a recovery autorita
- **stav:** `ACCEPTED 2026-08-11: A / IMPLEMENTATION_PENDING`; implementaci
  aktivuje až vlastní ohraničený WP v přijatém pořadí
- **finding:** [011 — user_settings authority](../findings/011-user-settings-authority-and-secret-exposure.md)
- **historický nález:** F-B

## Ověřený problém

`POST /api/settings/reset` i legacy `POST /api/reset` volají tentýž handler bez
scope nebo revision. Ten v transakci dělá table-wide `DELETE FROM user_settings`
a reset model policy. Maže tedy i případné řádky mimo autoritativní singleton
`id=1`. Po commitu resetuje pouze FeatureManager; notification cache a SMTP
runtime mohou zůstat staré, přesto response tvrdí `runtimeApplied:true`.

Studio současně říká „všechna uživatelská nastavení“, ale zachová lokální
theme/layout/session data. Skutečný factory delete konverzací, paměti, agentů,
projektů a souborů neexistuje.

Tvrzení, že `/api/reset` nemá first-party konzumenta, platí pouze pro aktuální
kanonický strom. Pending ref `wp/mobile-refresh-20260809` obsahuje zděděný
snapshot `src/ui/architect/architect.js`, jehož `resetAll()` nejdřív volá
`localStorage.clear()` a potom `POST /api/reset`. Nejde o mobilní klientský
call ani o změnu v `src/mobile/**`, ale merge jej nesmí znovu oživit.

## Varianty

### A — settings-only exact scope, legacy alias 410 (přijato)

- jediný aktivní endpoint je `/api/settings/reset` s exact body
  `{scope:"SERVER_SETTINGS_V1",expectedRevision:N}`; stale revision vrátí
  `409` bez DB, runtime nebo UI mutace a bez automatického replay;
- resetuje pouze `user_settings.id=1` a model automation policy OFF/default v
  jedné transakci; mění jen vlastní policy projection a append-only reset event,
  jiné tabulky, soubory a client-local preference zachová;
- `/api/reset` vrací stable JSON `410 LEGACY_RESET_ALIAS_RETIRED` bez serverové
  mutace i bez client-local cleanup;
- notification cache a FeatureManager se po commitu invalidují/resetují;
  environment SMTP z 026/A je mimo reset scope a zůstává beze změny; degraded
  stav se stabilním code vznikne jen při skutečné post-commit runtime chybě;
- UI říká „serverová nastavení“, nikoli factory reset.

Studio po exact receipt přijme prázdnou server projection, invaliduje a znovu
načte `_featureFlags`, ale zachová všechny local UI keys. Architect smaže jen
server-replica `paiass_settings`; zachová `paiass_accordion_state` i ostatní
local data.

### B — přechodně ponechat oba aliasy

Stejná data semantics jako A, ale `/api/reset` zůstane po dobu deprecation.
Aktuální integration HEAD nemá first-party klienta, pending mobile ref však
obsahuje výše uvedený zděděný Architect caller; alias dál udržuje nejasnou
capability. Nedoporučeno.

### C — resetovat i všechna lokální UI data

Rozšiřuje UX scope, ale server nedokáže vyčistit odpojené klienty. Neřeší
factory data a není vhodné jej nazývat úplným resetem.

### D — skutečný factory delete

Nevratná nová funkce vyžadující úplný data census, backup/restore, approval,
progress a crash recovery. `PARK` jako samostatný budoucí WP; nesmí vzniknout
přejmenováním dnešního aliasu.

## Implementační hranice po přijetí

Obě route jsou v jednom subjectu. Žádná migrace. Review musí pinovat přesný
scope, zachování sentinel řádku mimo id=1, policy/event atomicitu, pravdivou
runtime degradaci a nulový efekt legacy aliasu. Architectovo jiné tlačítko
„Vymazat vše“ se jen eviduje jako samostatný UI finding; F-B je nerozšiřuje.
Merge preflight musí před `410` prokázat, že žádný first-party strom nevolá
`/api/reset` a že mobilní merge neobnovil ani starý caller, ani jeho
`localStorage.clear()` efekt.

Testovací objem: použít existující model-policy a Studio harness, nejvýše čtyři
logické scénáře — exact scope/sentinel, alias+rollback/runtime, Studio a
Architect. Bez nové registry suite, pokud současný harness stačí.

## Přijatý potvrzovací blok

```text
029: A
029-scope: SERVER_SETTINGS_V1
029-request: EXACT-SCOPE-PLUS-EXPECTED-REVISION
029-stale: HTTP-409-NO-EFFECT-NO-REPLAY
029-row: USER-SETTINGS-ID-1-ONLY
029-policy: OFF-DEFAULT-SAME-TRANSACTION
029-legacy-api-reset: HTTP-410-NO-MUTATION
029-local-ui: PRESERVE
029-notification-runtime: ENV-PRESERVED-CACHE-INVALIDATED-DEGRADE-ONLY-ON-ERROR
029-factory-delete: PARK-SEPARATE-WP
029-merge-preflight: MOBILE-BRANCH-RESET-CALLER-MUST-BE-CUT-OVER
029-review: OWN-SUBJECT-REVIEW-A-AND-B
```
