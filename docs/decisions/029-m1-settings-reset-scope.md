# 029 — reset musí pravdivě pojmenovat rozsah a obě route

- **typ:** destruktivní settings connector a recovery autorita
- **stav:** `ACCEPTED 2026-08-11: A + M1-CLOSEOUT-X1 /
  CHATS_DECOMMISSION_AND_EVIDENCE_RECOVERY_PROMOTED / WP_ACTIVE /
  MOBILE-PIN-REFRESH-1+2`
- **sourceEvidenceRevision:**
  `69d29ed3c929593e092d047b6e182d9715e3d08e`
- **integrationRef:** `integration/m1-consolidated-20260810`
- **aktivní WPs:** nejdřív
  [`WP-M1-STANDALONE-CHATS-DECOMMISSION`](../wp/WP-M1-STANDALONE-CHATS-DECOMMISSION.md),
  potom
  [`WP-M1-SETTINGS-RESET-AUTHORITY`](../wp/WP-M1-SETTINGS-RESET-AUTHORITY.md)
- **závislost:** 026 je `PROMOTED / REVIEW A+B PASS` na
  `69d29ed3c929593e092d047b6e182d9715e3d08e`; promotion report je
  [zde](../execution/runs/wp-m1-secret-storage-authority-20260811-report.md)
- **finding:** [011 — user_settings authority](../findings/011-user-settings-authority-and-secret-exposure.md)
- **historický nález:** F-B

## Ověřený problém

Canonical route `POST /api/settings/reset` i legacy alias `POST /api/reset`
volají tentýž handler. Request body se ignoruje, route nepřijímá scope ani
settings/policy revision a žádný současný first-party caller neposílá dual CAS.
Handler uvnitř transakce nahradí dokument `user_settings.id=1` celým `{}`,
čímž ničí unknown/unowned hodnoty tohoto autoritativního řádku; řádky mimo
`id=1` nemaže. Ve stejné transakci resetuje model policy.

Po commitu se aplikuje pouze FeatureManager. Po promovaném 026 už ale neexistuje
živá notification credential cache a současná runtime chyba se hlásí pravdivě
`runtimeApplied:false` s `SETTINGS_RUNTIME_APPLY_FAILED`. Otevřený problém 029
je přesný scope, dual CAS, owner-only preservation, client receipt semantics a
retirement legacy aliasu, nikoli falešný claim o dnešní notification cache nebo
runtime failure response.

Studio současně říká „všechna uživatelská nastavení“, ale zachová lokální
theme/layout/session data. Skutečný factory delete konverzací, paměti, agentů,
projektů a souborů neexistuje.

Tvrzení, že `/api/reset` nemá first-party konzumenta, platí pouze pro aktuální
kanonický strom. Pending ref `wp/mobile-refresh-20260809` obsahuje zděděný
snapshot `src/ui/architect/architect.js`, jehož `resetAll()` nejdřív volá
`localStorage.clear()` a potom `POST /api/reset`. Nejde o mobilní klientský
call ani o změnu v `src/mobile/**`, ale merge jej nesmí znovu oživit.

### MOBILE-PIN-REFRESH-1 (přijato 2026-08-12)

Pending mobile ref se po aktivaci 029 posunul lineárně z
`b9b56d517d95475636b75427181bed9cbdd159c4` na
`3ea062f52425b429872ba18ace8c14f5b2248e53`; původní tip je jeho ancestor a
mezi nimi jsou přesně dva commity. Merge-base s canonical recovery tipem
`17aba1b5749e8229d8079f3cbc6cdb865bdc25e8` i se source evidence
`69d29ed3c929593e092d047b6e182d9715e3d08e` zůstává
`8366eb085415149f49e04bd9e788104c4c3ec1f8`.

Exact dvanácticestný reset manifest se mezi starým a novým mobile tipem ani
mezi merge-base a novým tipem nezměnil. Drift nemění 029 call graph, data
scope, trusted-local ani autentizační hranici a nevyžaduje nové produktové
rozhodnutí. Aktualizuje se pouze evidence pin a přesný merge census; při dalším
driftu platí znovu `STOP` a nový governance/review vstup. Mobile větev se tímto
rozhodnutím nepřijímá ani nepromuje.

### MOBILE-PIN-REFRESH-2 (přijato 2026-08-12)

Bezprostředně před finálním legacy-alias cutoverem se pending mobile ref
posunul z `3ea062f52425b429872ba18ace8c14f5b2248e53` na jeho přímého potomka
`2aeaa5028d9caf731f6a51f1f6df78a5f548c511`. Jediný nový commit mění pouze
`docs/mobile/CONTRACT-V2-PROPOSAL.md`: opravuje věcný popis
`PROVISIONAL_V1` a povinných conversation/turn identit. Není to runtime
změna, schválení mobile návrhu, refreeze kontraktu ani změna support claimu.

Merge-base zůstává
`8366eb085415149f49e04bd9e788104c4c3ec1f8`. Exact dvanácticestný reset
manifest má nulový delta `merge-base→3ea`, `merge-base→2aea` i
`3ea→2aea`; callery, `localStorage.clear()`, auth/access/trusted-local
hranice i globální census osmi both-changed cest, šesti skutečně konfliktních
cest a jedenácti semantic hunků jsou beze změny. Pro 029 jde proto pouze o
nový exact evidence pin. Další drift znovu znamená `STOP`.

## Varianty

### A — settings-only exact scope, legacy alias 410 (přijato)

- jediný aktivní endpoint je `/api/settings/reset` s exact plain-object body bez
  extra keys:

  ```json
  {"scope":"SERVER_SETTINGS_V1","expectedRevision":1,"expectedPolicyRevision":1}
  ```

  Obě revisions jsou positive safe integers. Invalid input vrátí exact
  `400 SETTINGS_RESET_INPUT_INVALID`. Settings i model-policy CAS se ověří
  uvnitř jediného caller-owned `BEGIN IMMEDIATE` před první mutací a stejná
  transakce vlastní celý reset;
- stale kterékoli revision vrátí `409 SETTINGS_RESET_REVISION_CONFLICT` s oběma
  expected/current revisions, bez DB, runtime nebo UI effectu a bez
  automatického replay;
- z `user_settings.id=1` odstraní pouze exact `GENERIC` owner paths z 025 a
  top-level `storage` config. Unknown a všechny unowned hodnoty zachová;
  veřejná settings projekce po commitu je exact `{}`;
- model automation policy přejde OFF/default v téže transakci. Každý explicitní
  reset, včetně resetu již defaultního stavu, inkrementuje settings revision i
  policy revision právě o jedna a přidá právě jeden `GLOBAL_RESET` event;
  retry se starými revisions skončí `409` bez replay;
- `/api/reset` vrací pre-parse exact
  `410 {"ok":false,"code":"LEGACY_RESET_ALIAS_RETIRED"}` bez DB, runtime nebo
  client-local effectu;
- po 026 neexistuje živá DB notification credential cache k invalidaci.
  Immutable environment channels reset nemění. FeatureManager se po commitu
  vrátí jen na startup env defaults. Skutečná post-commit runtime chyba
  nevrací DB rollback ani falešný 500, ale pravdivý
  `runtimeApplied:false` a
  `runtimeErrorCode:"SETTINGS_RUNTIME_APPLY_FAILED"`;
- route používá existující canonical trusted-local access boundary a UI navíc
  explicitní confirmation. Admin token se nepřenáší do rendereru. Globální auth
  hardening zůstává samostatný residual; potřeba změnit tuto boundary je stop
  condition;
- UI říká „serverová nastavení“, nikoli factory reset.

Studio odešle dual CAS, po exact receipt přijme prázdnou server projection,
invaliduje a znovu načte `_featureFlags`, ale zachová celý localStorage.
Architect také odešle dual CAS a po exact receipt smaže jen server-replica
`paiass_settings`; zachová `paiass_accordion_state` i ostatní local data.
Client cleanup/reload failure je degraded a dovoluje jen lokální retry téže
receipt fáze, nikdy nový server reset.

Legacy `/api/reset` 410 přistane jako poslední produkční commit subjectu. Jeho
parent už musí obsahovat dual-CAS route a cutover všech first-party callerů;
potom smějí následovat jen evidence commity. Resulting mobile merge tree musí
mít nula `/api/reset` callerů a nula reset cest používajících
`localStorage.clear()`.

Samostatný bounded decommission subject před promotion 029 označí tracked
standalone `chats/` package jako `unsupported / not shipped`, zastaví jej
fail-closed před DB/listener startem, udělá jeho raw settings/reset routy
inertní a zachová existující chats data byteově. Toto je vědomě přijatá změna
support claimu; není to oprávnění data smazat.

029 není factory delete ani privacy erase. Zachová všechny ostatní tabulky,
soubory, environment, Setup JSON, attachments, historii a existující backupy.
Factory delete zůstává samostatný budoucí WP.

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

Canonical route a legacy alias jsou v jednom reset subjectu. Žádná migrace.
Samostatný standalone-chats decommission subject jej musí před promotion
předcházet.
Statické WPs a jejich allowlisty jsou aktivované vlastním docs-only governance
checkpointem před source writerem; decommission a reset mají oddělené
writery/reviewery.
Review musí pinovat exact plain-object dual-CAS request, oba pre-mutation CAS,
jedinou transakci, exact owner-only reset, zachování unknown/unowned hodnot i
sentinel řádku mimo id=1, obě `+1` revisions, právě jeden event, pravdivou
runtime degradaci, trusted-local + UI confirmation a nulový efekt legacy aliasu.
Architectovo jiné tlačítko „Vymazat vše“ se jen eviduje jako samostatný UI
finding; F-B je nerozšiřuje. Merge preflight musí před posledním `410` commitem
prokázat, že žádný first-party strom nevolá `/api/reset` a že mobile merge
neobnovil ani starý caller, ani jeho `localStorage.clear()` efekt.

Testovací objem: použít existující model-policy a Studio harness, nejvýše čtyři
logické scénáře — exact scope/dual CAS/sentinel/repeat, alias+rollback/runtime,
Studio a Architect. Bez nové registry suite, pokud současný harness stačí.

## Přijatý potvrzovací blok

```text
029: A
029-scope: SERVER_SETTINGS_V1
029-request: EXACT-SCOPE-PLUS-SETTINGS-AND-POLICY-REVISION
029-input: PLAIN-OBJECT-NO-EXTRA-POSITIVE-SAFE-INTEGERS
029-invalid: HTTP-400-SETTINGS-RESET-INPUT-INVALID
029-stale: HTTP-409-BOTH-EXPECTED-CURRENT-NO-EFFECT-NO-REPLAY
029-row: USER-SETTINGS-ID-1-ONLY
029-owner-scope: GENERIC-PATHS-PLUS-TOP-LEVEL-STORAGE-PRESERVE-UNOWNED
029-public-projection: EXACT-EMPTY-OBJECT
029-policy: OFF-DEFAULT-SAME-BEGIN-IMMEDIATE
029-repeat: BOTH-REVISIONS-PLUS-ONE-ONE-GLOBAL-RESET-EVENT
029-auth: EXISTING-TRUSTED-LOCAL-PLUS-UI-CONFIRMATION-NO-RENDERER-TOKEN
029-legacy-api-reset: FINAL-PRODUCTION-COMMIT-PRE-PARSE-410-EXACT-LEGACY_RESET_ALIAS_RETIRED-BODY-NO-MUTATION
029-local-ui: PRESERVE
029-clients: DUAL-CAS-RECEIPT-LOCAL-RETRY-NO-SERVER-REPLAY
029-notification-runtime: ENV-PRESERVED-NO-LIVE-DB-CREDENTIAL-CACHE
029-runtime-error: SETTINGS-RUNTIME-APPLY-FAILED-NO-DB-ROLLBACK
029-chats: SEPARATE-DECOMMISSION-UNSUPPORTED-NOT-SHIPPED-PRESERVE-DATA
029-data: NOT-FACTORY-DELETE-NOT-PRIVACY-ERASE
029-factory-delete: PARK-SEPARATE-WP
029-merge-preflight: MOBILE-BRANCH-RESET-CALLER-MUST-BE-CUT-OVER
029-review: OWN-SUBJECT-REVIEW-A-AND-B-WRITER-NE-REVIEWER
```
