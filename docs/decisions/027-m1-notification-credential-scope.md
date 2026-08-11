# 027 — určit podporované notification credentials pro core 1.0

- **typ:** produktový scope externích notification kanálů
- **stav:** `ACCEPTED 2026-08-11: A / PROMOTED / REVIEW A+B PASS`;
  statický kontrakt
  [`WP-M1-NOTIFICATION-CREDENTIAL-SCOPE`](../wp/WP-M1-NOTIFICATION-CREDENTIAL-SCOPE.md)
  vyšel ze source evidence `0322d468563875ecfd588ad6938c86bc7a7f80ed`;
  promotion evidence je v
  [`wp-m1-notification-credential-scope-20260811-report.md`](../execution/runs/wp-m1-notification-credential-scope-20260811-report.md)
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

## Aktivovaná implementační hranice

Rozhodnutí určuje pouze support surface. Samotné credentials se přesouvají až
pod 026 a webhook semantics pod 028. Aktivovaný subject zavede jedinou
channel-policy hranici. Pět externích capabilities se smí zapnout pouze
literal hodnotou `"true"` v přesném env klíči:

- `C3_ENABLE_NOTIFICATION_EMAIL`;
- `C3_ENABLE_NOTIFICATION_TELEGRAM`;
- `C3_ENABLE_NOTIFICATION_PUSH`;
- `C3_ENABLE_NOTIFICATION_WEBHOOK`;
- `C3_ENABLE_NOTIFICATION_DESKTOP`.

Registrovaný runtime channel `push` a legacy přímý verifier `ntfy` jsou tatáž
ntfy capability a oba používají jediný `C3_ENABLE_NOTIFICATION_PUSH` opt-in;
nejde o šestý flag ani druhou autoritu.

Unset a exact `"false"` znamenají OFF. Každá jiná definovaná hodnota je
invalidní konfigurace a bootstrap musí fail-fast skončit před registrací
kteréhokoli externího channelu i před notification effectem. Opt-in povoluje
pouze registraci retained/unclaimed kandidáta; nevytváří support ani Gate 1
claim bez samostatného outbound journey.

Tentýž subject odstraní SMTP i každou credential/private-destination větev z
WS `sync_settings`. Protokol přijme pouze exact boolean payload nad sedmi klíči
`c3.features.agents`, `c3.features.lifecycle`,
`c3.features.expertises`, `c3.features.telemetry`,
`c3.features.specialistTelemetry`, `c3.features.autonomy` a
`c3.features.skills`. Mixed payload, unknown klíč, credential klíč nebo
non-boolean hodnota odmítne celý request atomicky: změna je nula, response ani
log neechoje payload a nenastane notification ani jiný runtime effect.

Setup containment je součástí 027, nikoli secret transfer: `POST
/api/setup/notifications` vrátí stabilní `410` ještě před parse body a CLI už
nevytvoří ani nezapíše legacy `data/.env`. Existující notification hodnoty v
`c3-setup.json`, `data/.env`, cwd `.env`, DB a localStorage se zachovají pro
026. Aby se přijaté Ollama/language a ostatní non-notification setup schopnosti
nerozbily, CLI i HTTP setup complete použijí shodný bounded writer nad cwd
`.env`: smí atomicky změnit pouze exact setup-owned non-notification klíče
`OLLAMA_URL`, `C3_LANG`,
`C3_DB_PATH` a `C3_LICENSE_KEY`; každou notification a cizí řádku zachová
byteově, hodnotu neloguje ani nevrací. Symlink, non-regular/foreign/multi-link
soubor, duplicitní owned key nebo newline v nové hodnotě skončí typovaně bez
změny. Absent target smí vzniknout exclusive/no-follow jako owner-only mode
`0600`. Tato úzká kompatibilitní patch cesta neurčuje credential autoritu ani
priority; 026 ji převezme společně s verified transferem. 027 nic
notification-specific nescrubuje, nemaže ani nepřenáší.

UI cleanup odstraní zavádějící externí credential/effect ovladače ze čtyř
přesných ploch: notification settings v autoritativním chat panelu, Center
Views, Architectu a stale `c3-settings` zdrojů. In-app zůstává jediný core 1.0
support claim. Security webhook regenerate UI v chat panelu patří 028 a v 027
se nesmí měnit. Pouhé dnešní nespojení názvů není protocol guard.

`src/notifications/channels/ntfy.js` obsahuje samostatný network-capable
channel/factory, ale na přijatém source nemá produkční import ani registraci.
Je proto `DORMANT-NOT-REGISTERED-NOT-COVERED`; jeho budoucí import nebo
registrace je stop condition, nikoli skrytá šestá aktivní cesta.

Testovací objem je nejvýše čtyři programy: nový
`tests/m1-notification-credential-scope.test.js` s přesně dvěma top-level
logickými případy, existující `tests/ws-bridge.test.js`, existující
`tests/m1-studio-client.test.js` a registry validator. Nová sada tabulkově
pinuje env/registration/setup hranici a WS/UI no-secret/no-effect hranici;
nevzniká suite pro každý channel. Electron, GPU, Ollama, externí síť ani
outbound journey se nespouštějí.

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

## Aktivační implementační piny

Následující piny konkretizují přijatý výsledek A; nejsou vydávány za další
operátorské produktové rozhodnutí a zachovávají funkční non-notification setup:

```text
027-env-opt-ins: C3_ENABLE_NOTIFICATION_EMAIL-TELEGRAM-PUSH-WEBHOOK-DESKTOP
027-env-parse: EXACT-LITERAL-TRUE-ONLY-INVALID-FAIL-FAST-PRE-REGISTRATION
027-push-alias: ACTIVE-PUSH-AND-EXECUTABLE-NTFY-VERIFIER-ONE-CAPABILITY
027-ws-feature-keys: EXACT-SEVEN-BOOLEAN-ATOMIC-REJECT
027-setup-http: NOTIFICATIONS-410-PRE-PARSE
027-setup-cli: NO-DATA-DOTENV-USE-SAME-BOUNDED-CWD-PATCH
027-setup-complete: EXACT-NON-NOTIFICATION-PATCH-PRESERVE-OTHER-BYTES
027-setup-create: ABSENT-ONLY-EXCLUSIVE-NOFOLLOW-MODE-0600
027-legacy-data: PRESERVE-FOR-026-NO-SCRUB-DELETE-TRANSFER
027-dormant-ntfy-channel: NOT-REGISTERED-NOT-COVERED
```

## Promotion evidence

Aktivační base byl
`89de69202b7ed72937400a40ce0fbb91475aa926`, immutable replacement subject
`0ed3c0edf292acf8456e4dbc6bf0bb99ee01a2aa` a prověřený merge candidate
`56a00c09ae66b4ebba0eedde81b53fafb816cefa`. Review A i Review B skončily
`PASS`; report-only promotion tip na canonical integration je
`f19135871f148f69fcc9451307e87c34c1abfcbb`. Electron, GPU, Ollama, externí
síť, outbound journey ani celý produktový test nebyly součástí tohoto důkazu.
