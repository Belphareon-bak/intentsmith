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
   klienta nad falešnými defaulty a pozdější whole-row save.
2. Úspěšný `POST /api/settings/import` vrací celý commitnutý destination
   dokument, protože dnešní Studio generic save jinak neumí zachovat lokální
   hodnoty, které portable soubor nenese.
3. Generic POST dělá whole-row replacement. Storage, webhook a notification
   writery používají samostatné read-modify-write sekvence bez společného
   revision/CAS seamu. Writer může načíst starý blob před portable importem a
   po jeho commitu novější stav přepsat.
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

Redakce readu bez změny writeru by byla datově nebezpečná. Klient načte
redigovaný dokument a dnešní whole-document POST by při příštím save skryté
credentials odstranil. Stejně tak oprava jednoho RMW writeru nezavírá závod s
ostatními.

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

Ohraničené navazující položky: Architect a Center Views zatím nemají bounded
fetch timeout; raw compatibility objekt s vlastním `kind`/`schemaVersion` je
záměrně rezervovaný marker; recursive JSON validace potřebuje samostatný
depth/node/byte budget. Jde o availability/robustness práci stejného budoucího
settings-authority WP, nikoli důkaz bezpečnosti generic povrchu.
