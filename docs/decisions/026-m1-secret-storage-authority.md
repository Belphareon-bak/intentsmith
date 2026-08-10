# 026 — credentials nesmějí žít v obecném settings dokumentu

- **typ:** secret storage a read/write autorita
- **stav:** `DECISION_REQUIRED`; tento dokument neaktivuje implementaci
- **finding:** [011 — user_settings authority](../findings/011-user-settings-authority-and-secret-exposure.md)
- **závislosti:** přijatá rozhodnutí 025, 027 a 028; pro doporučené A musí
  source retirement falešného webhook setteru z 028 předcházet transfer/scrub

## Ověřený problém

SMTP heslo, webhook HMAC a několik pouze UI-deklarovaných credentials dnes
končí jako plaintext v `user_settings`; generic GET, import response a některé
lokální cache je mohou vrátit. Vyčlenění do jiné tabulky odstraní generic
expozici a writer závody, ale samo o sobě není šifrování disku.

## Varianty

### A — environment-only pro core 1.0 (doporučeno pro nejrychlejší bezpečný Gate 1)

Externí credentials nevstupují do aplikační DB, WAL, backupu, HTTP/WS response,
renderer state, localStorage ani logů. Kanonický file source je
`<install-root>/.env`, explicitně odvozený v `runtime-environment.js`, nikoli z
náhodného `cwd` ani setup `data/.env`; existující process environment má vyšší
prioritu. Soubor musí být regular, owner-owned, mode-0600 a bez symlink
traversal. Změna vyžaduje restart. Public read vrací pouze `configured` a
`source: "PROCESS_ENV" | "ROOT_ENV_FILE"`; aplikační setter neexistuje.

Legacy hodnoty se nesmažou potichu. Jednorázový lokální migrační příkaz je
přenese do skutečně načítaného source, ověří readback i permissions a teprve
potom odstraní exact známé cesty z DB. Je to nejmenší plocha; cena je správa
mimo Studio.

Do canonical env se přenášejí pouze retained kanály s již definovanými runtime
env keys. Pro `UNSUPPORTED` Slack/Discord/SMS žádný nový env kontrakt nevzniká;
jejich hodnoty se řídí 027: verified mode-0600 export nebo operátorský purge,
potom exact scrub.

### B — oddělený SQLite secret store, bez tvrzení o šifrování

Známé podporované secrets se atomicky přesunou z JSON do samostatné tabulky.
Přístup má jen typed repository; set/rotate/clear mohou být ve Studiu a runtime
čte stejnou autoritu při startu i po commitu. Zavírá generic leak, ale
nechrání před procesem, který čte celý SQLite soubor.

### C — OS keyring nebo šifrovaný store

Silnější at-rest ochrana, ale přidává novou platformní/deployment autoritu,
recovery klíče a závislost. Bez samostatného threat modelu není bezpečné ji
improvizovat uvnitř M1.

## Implementační hranice po přijetí

U A nevzniká schema migrace; vznikne bounded lokální transfer/scrub command a
environment permission gate. U B dostane migrace číslo až po přijetí a novém
census, nejdříve po 064. Exact credential scope zahrnuje SMTP password,
Telegram/ntfy token, webhook HMAC, Slack/Discord webhook URL a SMS API
key/secret. Webhook destination URL, Telegram chat ID, ntfy topic, email
recipient a telefon jsou `PRIVATE_DESTINATION`: nemusejí být secret, ale
nesmějí do generic public projekce ani import response. Unknown hodnoty se
nemažou potichu. Generic/portable/factory backup není secret recovery; plný
disaster-recovery kontrakt patří M5-DATA.

Testovací objem: rozšířit sdílenou settings-authority sadu nejvýše o čtyři
table-driven případy — verified transfer/readback potom exact scrub, odmítnutí
aplikačního setteru, startup/restart parita canonical env source a nulový
public/backup/log leak. Žádná nová suite jen pro každý secret.

## Doporučený potvrzovací blok

```text
026: A
026-store: INSTALL-ROOT-DOTENV-MODE-0600
026-precedence: PROCESS-ENV-THEN-ROOT-ENV-FILE
026-public-read: CONFIGURED-AND-EXACT-SOURCE-ONLY
026-generic-backup-log: NEVER-CONTAINS-SECRET-VALUE
026-app-setter: NONE-READ-ONLY-SOURCE
026-legacy: VERIFIED-TRANSFER-THEN-EXACT-SCRUB
026-private-destinations: REDACT-FROM-GENERIC-AND-IMPORT-RESPONSE
026-disaster-recovery: M5-DATA-SEPARATE-CONTRACT
026-review: OWN-SUBJECT-REVIEW-A-AND-B
```
