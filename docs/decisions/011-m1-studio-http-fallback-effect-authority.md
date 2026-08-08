# 011 — Studio HTTP fallback a effect authority

- **typ:** BLOCK
- **WP:** WP-M1-STUDIO (jen legacy HTTP fallback pro odeslání chatu)
- **rail:** R1, R2, R4
- **vzniklo při:** B4 fail-closed HTTP response checkpoint

## Evidence na stole

Autoritativní Studio runtime má tři fallback cesty do legacy `POST /chat`:
editovaný resend, běžnou zprávu včetně attachments a expertise gap choice
(`c3-chat-panel/lib/browser/chat-panel-module.js:6119,6183,6208`). Nový panel
má výchozí `editMode:'ask'` (`:5337`) a všechny tři payloady tento stav posílají.

Legacy route ale z těla přebírá jen chatové vstupy a do
`ChatController.handle()` nepředává `editMode` ani approval callback
(`src/routes/chat.js:386-419`). `FILE_WRITE` je terminální LOCAL větev a jde
přímo do `handleFileWriteDecision()` (`src/chat/handlers/conversation.js:614-621`,
`src/chat/handlers/project.js:391-407`), který provede `mkdir` a `writeFile`
(`src/chat/handlers/file.js:640-645`). Generický tool call se bez callbacku také
provede (`src/chat/handlers/decisions.js:427-443`).

Experimentální response parser správně odmítal non-2xx, malformed JSON a
prázdný success payload; jeho 14/14 offline testů ale neověřovalo effect
authority. Zachování HTTP fallbacku s tímto parserem by proto opravilo
false-success zobrazení, ale ponechalo bezpečnostní bypass. Produktový experiment
byl cíleně odstraněn před commitem; zelený experimentální běh není acceptance
evidence.

Navíc dnešní WS `ask` hook není hotová globální authority: přímý `FILE_WRITE`
jej obchází a generický `onToolCall` je volán bez `await`, takže B4 nemůže HTTP
paritu opřít ani o existující WS implementaci.

## Varianty

| Varianta | Chování | Dopad | Cena zavedení |
|---|---|---|---|
| A — HTTP send fallback vypnout | Při nedostupném WS zobrazit terminální reconnect/error; žádný chat request přes HTTP | Nejmenší fail-closed změna, ztráta degradovaného odeslání | 3 call sites + 1 stavový helper + Studio client/journey negativní testy |
| B — server-enforced read-only fallback | Samostatný endpoint garantuje nulové filesystem/shell/tool efekty | Zachová část degradovaného chatu; nový connector a server authority | route + typed contract + controller policy + adversarial effect tests; mimo B4 allowlist |
| C — jednotná EffectRequest/ApprovalGrant authority | HTTP i WS používají stejnou payload-bound, single-use effect authority | Plná cílová oprava; zasahuje M2 bezpečnostní architekturu | M2-EFFECT connector, ledger, všechny effect handlery a cross-transport testy |
| D — legacy fallback ponechat | Zachová dnešní UX | `ask` dál není bezpečnostní hranice; nepřijatelné jako uzavření nálezu | Bez diffu, ale potvrzený HIGH risk zůstává |

Klientský seznam „bezpečných promptů“ není varianta: intent ani efekt nelze
bezpečně určit v panelu před serverovým rozhodnutím.

## Vzatý default a proč

Žádný. A mění viditelné transportní chování, B zavádí nový connector a C je M2
effect-authority scope. D by vědomě akceptovalo potvrzený bezpečnostní bypass.
Jde tedy o bezpečnostní a produktovou volbu, kterou dávkový protokol klasifikuje
jako `BLOCK`. Zastavena je pouze oprava/aktivace HTTP send fallbacku; B4 smí
pokračovat reconnectem, rehydrate a terminální korelací.

## Šev a cena přepnutí

Šev tvoří tři pojmenované fallback větve v
`c3-chat-panel/lib/browser/chat-panel-module.js`. Po schválení A se sjednotí do
jedné lokální fail-closed funkce bez serverového requestu. Přechod A → B změní
tuto jedinou funkci a přidá server connector; klientské terminal-state testy
zůstanou. Přechod B → C zachová transportní adaptér, ale nahradí read-only
policy jednotnou M2 authority a jejími durable granty.

Žádná varianta nesmí oslabit legacy listener guard ani prohlásit `editMode` za
security control bez negativního důkazu nulového effectu.
