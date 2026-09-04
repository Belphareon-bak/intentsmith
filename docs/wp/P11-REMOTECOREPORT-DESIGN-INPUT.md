# P11 — vstup pro návrh `RemoteCorePort`

**Typ:** read-only sonda · **Slot:** nesoutěží o zapisujícího vlastníka
**Vstupní revision:** `3b7649f4` (větev `wp/mobile-refresh-20260809`)
**Adresát:** operátor · vlastník `WP-M2-REMOTE-CONTRACT`
**Důvod:** ROADMAP §6 ukládá `WP-M2-REMOTE-CONTRACT` vytvořit verzi 1
`RemoteCorePort` pro sedm domén. Roadmapa zároveň §5 povoluje, aby návrh
mobilu postupoval paralelně. Existuje ale **změřený předobraz** — třináctiroutový
`/m1` povrch, který běží, má 320 zelených testů a odkryl konkrétní vady.
Sonda ho převádí do jazyka domén `RemoteCorePort`, aby M2 nezačínal od
prázdného listu ani nezmrazil cizí vadu.

> **Co tenhle dokument není.** Není to zmražený kontrakt v1, není to autorita
> rozšířit `/m1` allow-list a není to schválení kterékoli varianty. Je to
> **vstup**: co už je empiricky ověřené, co je prokázaná vada a co musí M2
> rozhodnout. Zmražení verze je výhradně akt `WP-M2-REMOTE-CONTRACT` a smí
> proběhnout až nad připnutými `ConversationCommand/Result`,
> `EffectRequest/Result`, `ApprovalGrant` a `CoreEvent`, které dnes neexistují.

---

## 1. Otázka, na kterou sonda odpovídá

**Co z běžícího `/m1` povrchu smí `RemoteCorePort` v1 zdědit, co musí zahodit
a co zůstává nerozhodnuté?**

Rozdíl proti `docs/mobile/GATEWAY.md`: ten popisuje *dnešní implementaci jednoho
gateway procesu*. Tahle sonda se ptá, co z toho je **přenositelné rozhraní
core**, nezávislé na tom, že za ním dnes sedí PWA klient přes HTTP.

---

## 2. Co je už změřeno — nepřeměřovat

| Fakt | Hodnota | Zdroj |
|---|---|---|
| Implementovaný HTTP allow-list | přesně 13 rout, vše ostatní 404, žádný wildcard | `docs/mobile/GATEWAY.md` §4 |
| Chybové kódy | 11 kódů, tvar `{ok:false,error:{code}}` | tamtéž §5 |
| Testovací evidence | 11 sad, 320 PASS / 0 FAIL na `3b7649f4` | tato větev |
| Vazba jádra na mobil | **žádná** — závislost je jednosměrná mobil → jádro | ratchet 1043/1043, `3b7649f4` |
| Transport | dnešní `/m1` nemá WebSocket ani SSE | `docs/mobile/GATEWAY.md` §4 |
| Autentizace | `validateApiToken()` existuje, listener ji nevolá | `src/routes/security.js` |
| Bezpečnostní strop | `G0-R032`, `LATER_GATE`, loopback-only | `docs/convergence/RISK-REGISTER.md` |

---

## 3. Sedm domén — co pro každou existuje

ROADMAP §2 tabulka connectorů žádá po `RemoteCorePort` projekty, konverzace,
settings, stored information, approvals, notifications a events.

| Doména | Dnešní `/m1` předobraz | Stav pro v1 |
|---|---|---|
| **Konverzace** | `GET /m1/conversations`, `GET /m1/conversations/:id`, `POST /m1/chat` | **Nejsilnější vstup.** Tvar požadavku i odpovědi je odzkoušený; odpověď přichází celá, token streaming neexistuje |
| **Approvals** | `GET /m1/approvals`, `POST /m1/approvals/:id/decide` | Tvar existuje, **autorita ne** — `F-100`: chybí produkční producent, TTL autorita, otisk a vazba na run/operaci |
| **Notifications** | `GET /m1/notifications`, `POST /m1/notifications/ack` | **Vadné, nezmrazovat** — `F-112` HIGH: ACK aktualizuje jen podle ID bez `device_id` predikátu; `F-015`: závod `MAX(seq)+1` bez `UNIQUE` |
| **Events** | neexistuje | Dnešní `/m1` nemá WS ani SSE. `MR-07` je `BLOCKED_BY_CONTRACT`; agent log jako typed event stream musí M2 navrhnout od nuly |
| **Projekty** | neexistuje | `MR-14` je `BLOCKED_BY_CONTRACT_AND_GATE1` (`F-055`) |
| **Settings** | neexistuje | `DR-008` autorizovalo jen kontraktní kolo, ne implementaci |
| **Stored information** | neexistuje | Bez předobrazu |

Čtyři ze sedmi domén tedy **žádný změřený vstup nemají**. To je samo o sobě
výsledek sondy: `RemoteCorePort` v1 nelze odvodit z `/m1` — `/m1` pokrývá tři
domény a jednu z nich prokazatelně špatně.

---

## 4. Co je přenositelné bez ohledu na transport

Tyhle čtyři mechanismy vznikly v `/m1`, ale nejsou na HTTP vázané a M2 by je
neměl vymýšlet znovu:

1. **Klíč operace (`MD-19`).** Idempotence mutace vázaná na
   `(deviceId, operationId)` s trvalým záznamem, který přežije restart serveru.
   Odpovídá tomu, co bude `EffectRequest` potřebovat pro bezpečný retry.
2. **`UNKNOWN` jako kód, ne prázdno.** Nerozřešený pokus nese *proč*, *od kdy*
   a *k jakému okamžiku*. Přímo to plní požadavek roadmapy „neimplementovaný
   provider se hlásí jako unavailable, nikdy jako prázdný úspěch".
3. **Vlastnictví úklidu.** Sweep po pádu procesu je omezený na vlastníka
   (`gateway_instances`), takže druhá instance cizí operace neuzavře.
4. **Kód na příčinu, ne HTTP status.** Jedenáct kódů proto, že klient na každý
   ukazuje jinou obrazovku. `token_revoked` ≠ `token_expired` je bezpečnostní
   rozdíl, ne kosmetika.

---

## 5. Co se naopak zdědit nesmí

| Vlastnost `/m1` | Proč ne |
|---|---|
| ACK bez predikátu na zařízení | `F-112` HIGH — zařízení potvrdí cizí řádek. Zmrazit to znamená zmrazit vadu |
| Jedno globální `read_at` pro broadcast | tamtéž |
| `MAX(seq)+1` bez `UNIQUE` | `F-015`, závod |
| Approval bez vazby na run/operaci/otisk | `F-100` — `R-3` je přijatý *cíl*, ne implementovaný stav |
| Nový `deviceId` při každém párování | Ztráta historie starých operací; pro companion s device scope a revokací je to nejspíš špatný default |

---

## 6. Co musí rozhodnout M2, ne tahle sonda

1. **Transport pro `CoreEvent`.** Dnešní `/m1` je pull-only. Typed runtime
   events roadmapa vyžaduje; WS, SSE i long-poll jsou otevřené a každý mění
   threat model.
2. **Jestli je v1 nadmnožina `/m1`, nebo samostatné rozhraní.** `/m1` je HTTP
   allow-list jednoho procesu; `RemoteCorePort` má být verzované rozhraní core.
   Sloučit je nemusí být správně.
3. **Capability negotiation.** ROADMAP ji žádá výslovně. `/m1` má
   `GET /m1/capabilities`, ale ta dnes vrací statický popis, ne vyjednávání
   verzí s odmítnutím nekompatibilního klienta (to M5 exit kritérium žádá).
4. **Kde končí companion mirror.** `DR-013` A přijal policy-controlled S1-safe
   mirror; jeho hranice vůči L0-13 (učení nesmí přenést projektová data přes
   hranici bez opt-inu) není vyřešená.

---

## 7. Co sonda nedělá

Neměří runtime, nespouští gateway a nenavrhuje ani jednu novou routu. Neotevírá
`G0-R032`: loopback-only strop platí beze změny a nic v tomhle dokumentu
neopravňuje listener, pairing ani vzdálené zpřístupnění. Čtyři domény bez
předobrazu nechává prázdné místo toho, aby jim vymyslela tvar — přesně proto,
že `CONTRACT.md` §3 zakazuje hloubkovou inventuru schopnosti, která nikdy
neběžela.
