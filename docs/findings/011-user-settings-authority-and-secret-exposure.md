# Finding 011 — obecný `user_settings` povrch nemá jedinou writer/read autoritu

**Severity:** P1 · **stav:** OPEN · **owner:** navazující M1 settings-authority
security WP · **termín:** před Gate 1 exitem

## Co je doložené

Portable schema v2 řeší obsah stahovaného artifactu a atomický importní
commit. Neřeší ale celý živý `user_settings` povrch:

1. `GET /api/settings` vrací celý JSON řádek po odebrání pouze tří
   model-automation klíčů. Stejný `webhookSecret`, který dedikovaná security
   route vrací pouze jako `configured/masked` a chrání vlastním auth guardem,
   je proto přes generic GET dostupný jako plaintext povolenému lokálnímu
   klientovi. Stejná route navíc převádí DB/read/JSON parse chybu na
   autoritativní HTTP `200 {}`; reload po `DELIVERY_UNKNOWN` tak může odemknout
   klienta nad falešnými defaulty a pozdější generic save nad ostatními
   nechráněnými secret cestami.
2. Úspěšný `POST /api/settings/import` vrací celý commitnutý destination
   dokument, protože dnešní Studio generic save jinak neumí zachovat lokální
   hodnoty, které portable soubor nenese.
3. Před F-A dělal generic POST whole-row replacement a notification writer
   samostatný read-modify-write. F-A převádí právě tuto dvojici na společný
   `BEGIN IMMEDIATE` merge seam. Storage, webhook a import ale stále nemají
   společný revision/CAS kontrakt; jejich starší snapshot může novější stav
   nadále přepsat.
4. `/architect` legacy offline fallback stále umí držet celý dokument v
   `localStorage`. Opravný WP zabránil tomu, aby stale snapshot přebil úspěšný
   server read nebo recovery commit, ale local-only secret storage nemá vlastní
   typed kontrakt.
5. Historické `/api/reset` aliasy resetují settings+policy, nikoli agenty,
   konverzace a paměť. Opravný WP proto v `/architect` deaktivoval nepravdivě
   popsanou „úplnou“ delete akci; skutečný factory-delete kontrakt neexistuje.

Loopback/origin boundary snižuje dosah, ale není náhradou route-level secret
authority: `NATIVE_LOOPBACK_CLIENT` bez Origin je podporovaný klientský typ.

## Proč se generic GET neopravuje izolovanou redakcí

Redakce readu bez dokončení writer authority by byla datově nebezpečná. F-A
chrání jen přesných devět notification klíčů; generic POST stále může zapsat či
smazat jiné secret-bearing cesty podle přijatého top-level payloadu. Stejně tak
oprava jednoho RMW writeru nezavírá závod s ostatními.

Bezpečný cutover musí spojit:

- typed/redacted read projection pro UI;
- server-side path-owned merge, který protected hodnoty bez explicitní typed
  route neumí nastavit ani smazat;
- revision/CAS nebo ekvivalentní stale-snapshot ochranu generic write;
- společný `BEGIN IMMEDIATE` mutation seam pro storage, webhook a notification
  writery;
- dedikované secret storage/routes a redigované import/reset responses;
- dvouconnection WAL testy import versus každý živý writer;
- oddělený, pravdivě pojmenovaný factory-delete kontrakt.

## Hranice současného repairu

`WP-M1-POLICY-PORTABLE-SECURITY` uzavírá pouze:

- default-deny v2 artifact;
- bezpečně projektovanou v1/raw kompatibilitu;
- zachování destination nonportable hodnot v importním transakčním snapshotu;
- exact commit-response validaci;
- odstranění alternativních raw export/import bypassů ve třech first-party UI
  consumers.

Netvrdí globální lost-update odolnost ani bezpečný obecný settings read.
Gate 1 proto zůstává `BLOCKED`, dokud tento finding nedostane vlastní bounded
WP, implementaci, negativní race důkazy a nezávislé review.

## První repair F-A — promován, Review A+B PASS

Operátor 2026-08-10 schválil úzkou opravu potvrzené ztráty dat: generic
`POST /api/settings` whole-row replacementem uměl odstranit devět
`c3.notif.*` hodnot zapsaných notification routou. Promovaný
[`WP-M1-SETTINGS-NOTIFICATION-CLOBBER`](../wp/WP-M1-SETTINGS-NOTIFICATION-CLOBBER.md)
na base `fc86b718` má source implementaci, která centralizuje přesnou mapu
devíti klíčů, generic payload filtruje jen podle exact key a obě mutation cesty
vede přes `updateUserSettings()` s `BEGIN IMMEDIATE`. Generic runtime dostane
jen filtrovaný incoming patch, nikdy commitnutý dokument s notification
tajemstvím. Post-commit runtime chyba je pravdivý degraded `200`; malformed
input a pre-commit storage chyba mají stabilní `400`/`503` bez raw hodnot.
Focused route-level sada má 4/4 včetně skutečných dvou WAL writerů. Immutable
subject `ebe7ee20`, merge candidate `1a75188f` a oddělené Review A/B evidence
prošly; promotion evidence tip `8c7ff414` je zapsaný v
[`wp-m1-settings-notification-clobber-20260810-report.md`](../execution/runs/wp-m1-settings-notification-clobber-20260810-report.md).
F-A neřeší generic read, ostatní writery, CAS, secrets ani reset, takže Finding
011 zůstává `OPEN` a Gate 1 `BLOCKED`.

## Rozhodovací fronta S1–S5

Operátor přijal bezpečný směr, nikoli jeden předvyplněný kontrakt. Pět změn
proto zůstává oddělených a každá po přijetí vyžaduje vlastní subject, Review A
i Review B:

| Pořadí | Rozhodnutí | Doporučená varianta | Co odemyká |
|---:|---|---|---|
| 1 | [025 — versioned settings a CAS](../decisions/025-m1-settings-versioned-authority.md) | A | revision, jeden repository commit point, redigovaný connector |
| 2 | [027 — podporované notification credentials](../decisions/027-m1-notification-credential-scope.md) | A | pravdivý core 1.0 support surface |
| 3 | [028 — webhook secret semantics](../decisions/028-m1-webhook-secret-semantics.md) | A | jedna env runtime/status autorita, retirement falešného setteru |
| 4 | [026 — secret storage authority](../decisions/026-m1-secret-storage-authority.md) | A | ověřený env transfer a odstranění credentials z aplikačních dat |
| 5 | [029 — settings reset scope](../decisions/029-m1-settings-reset-scope.md) | A | settings-only reset a ukončení legacy aliasu |

Všech pět je `DECISION_REQUIRED`; tabulka je doporučení, ne přijetí. Implementace
nezačne před operátorským potvrzením celé fronty nebo konkrétního řádku.

Ohraničené navazující položky: Architect a Center Views zatím nemají bounded
fetch timeout; raw compatibility objekt s vlastním `kind`/`schemaVersion` je
záměrně rezervovaný marker; recursive JSON validace potřebuje samostatný
depth/node/byte budget. Jde o availability/robustness práci stejného budoucího
settings-authority WP, nikoli důkaz bezpečnosti generic povrchu.
