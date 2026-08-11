# 028 — webhook HMAC musí mít jednu pravdivou autoritu

- **typ:** credential lifecycle a runtime connector
- **stav:** `ACCEPTED 2026-08-11: A / PROMOTED / REVIEW A+B PASS`;
  statický ohraničený
  [`WP-M1-WEBHOOK-SECRET-SEMANTICS`](../wp/WP-M1-WEBHOOK-SECRET-SEMANTICS.md)
  vychází ze source evidence
  `f19135871f148f69fcc9451307e87c34c1abfcbb`; promotion evidence je v
  [`wp-m1-webhook-secret-semantics-20260811-report.md`](../execution/runs/wp-m1-webhook-secret-semantics-20260811-report.md)
- **finding:** [011 — user_settings authority](../findings/011-user-settings-authority-and-secret-exposure.md)
- **závislost:** 027/A i 028/A jsou `PROMOTED / REVIEW A+B PASS`; 026/A + X1 je
  nyní aktivní pro navazující env write/transfer/scrub krok; support claim by
  nadále vyžadoval 027/B

## Ověřený problém

`GET /api/security/webhook-secret` a skutečný `WebhookChannel` čtou
`C3_WEBHOOK_SECRET` z environmentu. `POST` ale vygeneruje jinou hodnotu a uloží
ji do `user_settings`, aniž by runtime změnil. UI tak může hlásit úspěšnou
rotaci, která nemá vliv na podpisy; generic GET přitom DB hodnotu odkryje.

## Varianty

### A — environment-only, bez aplikačního setteru (přijato s 026/A)

`WebhookChannel` i status čtou jedině operator-owned environment. Dnešní
nefunkční generator skončí stabilním `410 CREDENTIAL_SOURCE_READ_ONLY`; read
vrací jen `configured` a exact `source: "PROCESS_ENV" | "ROOT_ENV_FILE"` podle
026, bez prefixu/sufixu hodnoty. Změna je mimo aplikaci a vyžaduje restart.

### B — server-generated, jednorázově zobrazený managed secret

Explicitní rotate vytvoří nový secret, commitne jej přes 026/B, atomicky
přepne runtime autoritu a vrátí plaintext právě jednou. Běžný read vrací jen
configured/source. Clear je samostatná potvrzená akce; restart načte tutéž DB
autoritu.

### C — operator-supplied write-only managed secret

Lépe se integruje s externím secret managementem, ale vyžaduje bezpečný vstup,
validaci a recovery. Server ji po zápisu nikdy nevrátí.

## Implementační hranice po přijetí

Route-specific auth guard zůstává; generic settings cestou nelze secret
nastavit, číst ani smazat. Autoritativní Studio Security panel odstraní nebo
deaktivuje tlačítko „Regenerovat“ a pravdivě zobrazí read-only environment
source. Legacy **DB** secret se přenese/scrubne pouze postupem 026, ne tichým
přepisem. U varianty A neexistuje post-commit runtime activation, one-time
return ani aplikační rollback/degraded větev.

Testovací objem: nejvýše čtyři případy ve sdílené settings-authority/Studio
sadě — stabilní `410` bez DB/runtime efektu, configured/source-only read,
startup/restart env parity a ignorování potom exact scrub legacy DB hodnoty.
Skutečný externí webhook patří až do operátorského journey pro případný 027/B.

## Přijatý potvrzovací blok

```text
028: A
028-authority: ENVIRONMENT-ONLY
028-app-setter: HTTP-410-CREDENTIAL-SOURCE-READ-ONLY
028-read: CONFIGURED-AND-EXACT-SOURCE-ONLY
028-runtime: RESTART-REQUIRED-AFTER-OPERATOR-CHANGE
028-secret-value: NEVER-IN-DB-HTTP-WS-LOG-OR-BACKUP
028-review: OWN-SUBJECT-REVIEW-A-AND-B
```

## Aktivační implementační piny

Následující piny pouze konkretizují přijaté 028/A nad již přijatým cílem 026/A;
nevytvářejí nový operátorský produktový výběr ani oprávnění k transferu či
scrubu:

```text
028-env-read-substrate: READ-ONLY-SUBSET-OF-ACCEPTED-026A
028-root-identity: EXACT-PROJECT-ROOT-DOTENV-INDEPENDENT-OF-CWD
028-root-source: SAFE-REGULAR-OWNER-OWNED-MODE-0600-NO-SYMLINK-TRAVERSAL
028-process-precedence: OWN-PRE-DOTENV-C3_WEBHOOK_SECRET-FIRST-EVEN-EMPTY
028-read-source: ALWAYS-PROCESS_ENV-IF-PRELOAD-OWN-ELSE-ROOT_ENV_FILE
028-configured: SELECTED-VALUE-LENGTH-GREATER-THAN-ZERO
028-authority-snapshot: ONE-IMMUTABLE-STARTUP-SNAPSHOT-SHARED-BY-STATUS-AND-SIGNER
028-notification-channel-list: POLICY-REGISTRATION-STATUS-ONLY-NOT-CREDENTIAL-STATUS
028-env-write-transfer-scrub: NONE-PENDING-026
028-legacy-db: PRESERVE-IGNORE-NO-NEW-WRITES-PENDING-026-EXACT-SCRUB
```

Před explicitním načtením dotenv se zachytí own-presence i hodnota
`process.env.C3_WEBHOOK_SECRET`. Own process key vyhrává i jako prázdný string:
source je `PROCESS_ENV` a `configured=false`. Jinak je source vždy
`ROOT_ENV_FILE`, i když exact `<projectRoot>/.env`, klíč nebo jeho hodnota
chybí; `configured` je pravda pouze pro neprázdnou vybranou hodnotu. Root se
odvozuje z `runtime-environment.js`, nikdy z `cwd` nebo `DOTENV_CONFIG_PATH`.
Existující root file musí projít přijatou regular/owner/mode-0600/no-symlink
hranicí před DB, listenerem, port-file nebo notification effectem.

Auth-guarded GET a skutečný HMAC signer dostanou tentýž immutable startup
snapshot a po startu už secret znovu nečtou z process env, file ani DB. Runtime
změna se projeví až restartem. `GET /api/notifications/channels` zůstává pouze
policy/registration stavem: jeho dnešní pole `configured` není credential
status a nesmí být použito jako důkaz přítomnosti HMAC secretu.

Přijaté `028-secret-value` je prospective invariant nové autority a veřejných
cest. Historická legacy hodnota může do 026 fyzicky zůstat v DB i plném SQLite
disaster-recovery backupu; 028 ji zachová, ignoruje a ukončí nové writery, ale
nepřenáší ji ani nescrubuje.

## Promotion evidence

Aktivační base byl
`ce7bc7f1c1e465cf2b7916655bdb0fa04ebf47ea`, immutable subject
`6733cccb9048695401b582ab2fea2ff50756b501`, report-only Review A evidence
`b88c042d20d669f5f33e79f5f90928d61bb368a3` a prověřený merge candidate
`fc01a5e9c157f125f4e7638e2656c84ea8477228`. Review A i Review B skončily
`PASS`; report-only promotion tip na canonical integration je
`0037d56a2fb63ae0c3a3863ce00b9083d838ba8b`.

Focused evidence zůstává settings authority `4/4`, notification credential
scope `2/2`, Studio VM `128/128` a registry 382 programů / 8 exclusions s
fingerprintem
`571ae1a90a4246c7037d56fe5fb786beb4b5c4aae3e61f163d5b6ffe14341d71`.
`tests/e2e/13-security.e2e.js` byl pouze source-contract update a zůstal
`NOT RUN / BLOCKED`; Electron/build, GPU, Ollama, outbound webhook, externí síť
ani celý produktový test nebyly spuštěné. Promotion nic nepřenášela,
nescrubovala ani nezapisovala do env; přesně tyto zbývající kroky vlastní 026.
