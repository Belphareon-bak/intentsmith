# Nezávislý verdikt k integraci IDE `230f657f` (aplikační kód `c47d1883`)

Napsáno pro: ROOT/workera (Codex), předává operátor. Revizor: nezávislý Claude (Opus), 10. 10. 2026 ~01:00.

**Verdikt: NEEDS_CHANGES** — integrace frontend + backend je technicky v pořádku a předchozí nálezy jsou opravené,
ale **bod f) nelze přijmout** (31 z 35 obecných nastavení nemá žádný runtime účinek) a obrazovka rolí ukazuje uživateli
interní kódy. Tři nové importní hrany **schvaluji**.

## Co jsem sám ověřil

- Worktree na `230f657f`; mezi `c47d1883` a `230f657f` se nemění `src/`, `intentsmith-ide/` ani `tests/` (jen dokumenty/důkazy/ruční skripty).
- `bwrap --unshare-net`, Node 24: `ide-backend` + `ide-backend-product-http-journey`, `studio2-view` (parita generátoru),
  `studio2-ide-redesign`, `studio2-model-workspace-redesign`, `studio2-settings-management`, `studio2-security`,
  `model-registry-current-authority`, `schema-migrations`, `context-compact-model-ctx`, `llm-gateway-runtime-signal`,
  `m1-chat-contract`, `m1-model-use-authority`, `workflow`, `storage-architecture`, M3 workeři, specialisté, `upgrade-ux-v125`,
  `scm-studio`, M5 outbound/auth, `chat-context-interpretation`, `project-collaboration` — vše PASS. `studio2-live-model`
  a `desktop-hunt` padají jen na „media WS events…“, identicky s `138e958b` (známá past symlinku node_modules).
- Census, `test:registry`, `module-boundary-ratchet`, `git diff --check` PASS; sonda výpadků chatu 7/7 tříd `status:error`.
- CI 37997242415: `head_sha c47d1883`, 19/19 kroků success (GitHub API).
- `resolveOllamaStorage` spuštěný proti skutečné stanici: `/mnt/vi7000/ollama/models`, `LOCAL_PROVIDER_SERVICE`; vzdálený
  poskytovatel → `UNKNOWN`. Moje dřívější P2 je opravené, stejně jako 400/ENOENT (nyní 422 + česká hláška, neznámé → 500).
- Neopakoval jsem: celý 415 profil, vlastní AppImage průchod (hodnotil jsem nativní snímky `native-final/*.png`),
  ruční sondu `verify-ide-preferences-http.mjs` (nahradila ji statická analýza níže, která je silnější).

## Nálezy

1. **P1 (bod f) — 31 z 35 obecných nastavení nemá spotřebitele.** `POST /api/settings` (`src/routes/misc.js:80`) jen uloží
   dokument a předá ho `featureManager.applySettings` (klíče `intentsmith.features.*`, které mezi 35 poli nejsou).
   Za běhu se čtou pouze `intentsmith.memory.{ltmEnabled,learningEnabled,feedbackDetection,patternTracking}`
   (`src/db/user-settings.js:107-129`). Ostatních 31 klíčů nečte backend, Studio 2 ani klasické UI
   (`center-views-module.js` je má jen jako definice formuláře); `maxFileSize` aj. jdou z `config.limits` (env).
   Předání uvádí „2 NOT_APPLIED, 33 NOT_VERIFIED“ — ve skutečnosti 31 polí prokazatelně nedělá nic.
   Doporučení (rozhoduje operátor):
   - **odstranit jako duplicitu nastavení rolí** a odkázat na editor rolí: `llm.contextWindow`, `llm.temperature`
     (pokud nevznikne teplota per role), `output.maxResponseLength`, `memory.contextBudgetChat/Code/MaxTokens`;
   - **zobrazit jen ke čtení z běžící konfigurace** (s „vyžaduje restart“): `llm.ollamaUrl`, `llm.numGpu`, `llm.timeoutChat/Code`
     (nebo napojit na timeouty gateway), `system.maxFileSize`, `system.rateLimit`, `system.logLevel`;
   - **napojit s ověřeným účinkem** (dávají uživateli smysl): `memory.conversationMaxTurns/compactThreshold/compactKeepTurns`
     (`config.compact`), `notif.desktopEnabled` + tichý čas (desktopová oznámení Studia), `output.codeBlocks/syntaxHighlight/markdownRendering` (renderer Studia);
   - **odstranit**: `account.currency`, `system.logRetentionDays` (duplicita retence v Úložišti), `intentsmith.language`
     a `account.timezone`, pokud nemají spotřebitele;
   - `account.displayName/description` ponechat jako profilová data (účinek se nečeká, jen srozumitelně označit).
   Každé pole, které zůstane, potřebuje test „uložit → další běh se změní“ a pole bez prokázaného účinku se v UI nesmí tvářit jako funkční.
2. **P2 — obrazovka rolí ukazuje interní kódy** (`native-final/role.png`): role D1/D2/CODE/R1/R2/VISION bez lidského názvu
   a popisu, k čemu slouží (V1 c2 výslovně „popis role, co dělá“), stav `DEFAULT`, sloupec „Autorita výstupu“
   `CALL_SITE_AND_AUTH_TOKEN_CEILING`, v editoru CHAT nepopsaný řádek s digestem. Návrh: český název + jednořádkový účel
   pro každou roli, přeložené stavy, digest s popiskem (zkrácený, celý v tooltipu), interní autoritu výstupu skrýt nebo vysvětlit.
3. **P3 / otázka — `refine` obchází CHAT limit odpovědi** (`src/llm/gateway.js:1043`: limit platí jen pro `purpose:'answer'`).
   Pokud `refine` vytváří text, který uživatel vidí jako odpověď, měl by limit platit i pro něj; jinak zdokumentovat proč ne.
4. **P3 — SSH formulář ukazuje vygenerované interní „ID profilu“** jako editovatelné pole (`native-final/ssh.png`); skrýt nebo jen ke čtení.

## Tři importní hrany — schváleno

`src/system/ide-storage.js`, `src/upgrade/model-registry.js`, `src/upgrade/upgrade-manager.js` → `src/system/ollama-storage.js`.
Cílový modul je list (jen `node:path`, `node:child_process`, `node:util`), `execFile('systemctl', pevné argumenty)` s timeoutem
1 s, jen pro lokální poskytovatele, volaný na vyžádání (přehled modelů má 30s cache). Bez cyklu, bez nové autority.

## Limity — přijímám jako zdokumentované, nejsou přejímkou

Bez skutečného doručení Discord/Telegram (produkční M5 manifest je stále odmítá), bez GPU Huntu a HW stropu kontextu
(`verifiedHardwareMaximum: null`), bez HTTPS token editoru, časového plánu záloh, úplného archivu Huntu a přesunu úložiště modelů,
bez OAuth účtů GitHub/Google/Microsoft. Živou kontrolu celé aplikace proti a–k a hodnocení V1–V4 jsem zatím neprovedl
(čeká na souhlas operátora s otevřením okna); po opravách 1–2 ji doporučuji jako poslední krok před přejímkou operátorem.
