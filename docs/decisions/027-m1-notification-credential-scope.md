# 027 — určit podporované notification credentials pro core 1.0

- **typ:** produktový scope externích notification kanálů
- **stav:** `ACCEPTED 2026-08-11: A / IMPLEMENTATION_PENDING`; implementaci
  aktivuje až vlastní ohraničený WP v přijatém pořadí
- **finding:** [011 — user_settings authority](../findings/011-user-settings-authority-and-secret-exposure.md)
- **produkt:** externí notifications jsou `RETAIN / CONDITIONAL`

## Ověřený problém

UI nabízí víc, než runtime skutečně podporuje. SMTP má DB writer, ale restart
kanálu čte environment. Webhook DB writer a runtime používají různé autority.
Telegram runtime čte environment; Slack, Discord a SMS nemají odpovídající
živý channel. Architect přesto ukládá jejich tokeny či URL do generic DB a
localStorage. Zelený formulář proto není důkaz funkčního kanálu.

`src/ws-bridge/session-adapter.js` navíc přes raw `sync_settings` přijímá SMTP
credentials a může přímo změnit živý `EmailChannel`. Současný Center Views
formulář používá jiné názvy klíčů, takže běžný dnešní journey tuto větev
netrefuje; protokolový guard ale neexistuje a crafted payload ji vyvolat může.

## Varianty

### A — core 1.0 podporuje pouze in-app (přijato)

Desktop channel dnes vrací pouze interní `_wsPayload`; žádný produkční
consumer jej neodešle, takže ani Electron desktop zatím není support claim.
Desktop, email, Telegram, ntfy, push a webhook zůstanou v kódu jako retained
kandidáti bez Gate 1 claimu. Externí channel se nesmí ani registrovat ani
provést effect bez explicitního default-off env opt-inu; každý se povýší až
vlastním journey. Slack, Discord a SMS jsou `UNSUPPORTED`; aktivní credential
inputy se skryjí.

Nalezené credentials/destinations se nejprve ověřeně přenesou do mode-0600
exportu, nebo je operátor výslovně zvolí k purge; teprve potom se exact cesty
scrubují z DB/localStorage. `Preserve forever` není cílový stav.

Protože setup wizard je mimo core 1.0, jeho CLI i
`/api/setup/notifications` přestanou přijímat external notification
credentials/destinations a `/api/setup/complete` je nesmí zapisovat.
Ollama, language a ostatní setup schopnosti se tím neruší. Existující hodnoty
projdou 026 export/purge/transfer hranicí, nikoli tichým smazáním.

### B — podporovat v core 1.0 také SMTP a webhook HMAC

Zachová nejcennější externí funkce, ale vyžaduje startup/runtime paritu,
credential autoritu a dva skutečné explicitní outbound journeys. Telegram,
Slack, Discord a SMS zůstanou unsupported.

### C — dokončit všechny dnes zobrazené externí kanály

Zachová šíři UI, ale přidá čtyři runtime integrace, outbound policy, secret
kontrakty a E2E prostředí. Výrazně prodlouží cestu ke core 1.0.

## Implementační hranice po přijetí

Rozhodnutí určuje pouze support surface. Samotné credentials se přesouvají až
pod 026 a webhook semantics pod 028. UI cleanup má vlastní subject a Review
A/B. Tentýž subject odstraní credential/private-destination větve z WS
`sync_settings`, omezí jej na explicitní feature-flags allowlist a pokryje
autoritativní Center runtime i stale `c3-settings` source. Pouhé dnešní
nespojení názvů není protocol guard. Neprovádí síťový test automaticky:
skutečný outbound journey je explicitní operátorský běh až na přijatém
kandidátu.

Testovací objem: jedna table-driven UI/runtime capability matice a jeden
negativní test, že unsupported kanál nepřijme secret ani nevyvolá effect.

## Přijatý potvrzovací blok

```text
027: A
027-core-supported: INAPP-ONLY
027-retained-unclaimed: DESKTOP-SMTP-TELEGRAM-NTFY-PUSH-WEBHOOK
027-external-default: OFF-REQUIRE-EXPLICIT-ENV-OPT-IN
027-ws-sync-settings: FEATURE-FLAGS-ONLY-NO-CREDENTIALS
027-setup-notifications: INPUT-AND-WRITER-RETIRED
027-unsupported: SLACK-DISCORD-SMS
027-unsupported-data: VERIFIED-0600-EXPORT-OR-OPERATOR-PURGE-THEN-EXACT-SCRUB
027-outbound: EXPLICIT-OPERATOR-JOURNEY-ONLY
027-review: OWN-SUBJECT-REVIEW-A-AND-B
```
