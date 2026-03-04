# C3 OAuth + Device Pairing — Implementation Plan v2

> Single-user desktop app. Mobile = local data + C3 as compute backend.
> No multi-tenant user_id scoping. No passport.js.

---

## Architektonické poznámky

### R1: OAuth tokeny ≠ device tokeny — šifrování vs hash

- **Device tokeny** (ověřuješ) → **SHA-256 hash** (stejný pattern jako `api_tokens`)
- **OAuth access_token / refresh_token** (používáš k volání Google/GitHub API) → **AES-256-GCM encrypted**

Klíč = `sha256(C3_TOKEN_SECRET)` — sha256 zajistí správnou délku klíče (256 bit) i když env var má jinou délku.
Fallback: derivace z hardware fingerprintu přes `getHardwareFingerprint()`.

### R2: Google OAuth redirect URI — "Desktop app" typ

- **Desktop application** client type v Google Cloud Console → loopback `http://127.0.0.1:PORT` povolený i v produkci
- GitHub nemá toto omezení (loopback vždy povolený)

### R3: OAuth token refresh — automatický wrapper

Google access_token vyprší za 1h. Místo manuálního refresh endpointu:

```javascript
async function getValidAccessToken(db, provider) {
  const account = db.oauthAccounts.findByProvider.get(provider);
  if (!account) return null;
  const accessToken = decrypt(account.access_token_enc, secret);
  if (new Date(account.token_expires_at) > new Date(Date.now() + 60_000)) {
    return accessToken;  // platný, >= 1min do expirace
  }
  // refresh
  const refreshToken = decrypt(account.refresh_token_enc, secret);
  const newTokens = await refreshOAuthToken(provider, refreshToken);
  db.oauthAccounts.updateTokens.run(
    encrypt(newTokens.access_token, secret),
    encrypt(newTokens.refresh_token || refreshToken, secret),
    newTokens.expires_at,
    account.id
  );
  return newTokens.access_token;
}
```

Jedna funkce, žádná část systému neřeší expiraci manuálně.

Google: `access_type=offline` + `prompt=consent` při prvním autorizačním requestu (vrátí refresh_token).

### R4: OAuth state persistence — DB, ne RAM

OAuth state token nesmí být v RAM Map (ztratí se při server restartu).

```sql
CREATE TABLE oauth_state (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);
```

Flow: `/start` → INSERT state → `/callback` → validate + DELETE.
Periodic cleanup: DELETE WHERE expires_at < now (v autoClean cyklu).

### R5: WebSocket auth — session binding

Po validaci device tokenu v handshake uložit do session objektu:

```javascript
session.deviceId = device.id;
session.deviceType = device.type;
session.isDevice = true;
```

Všechny následující eventy vědí, kdo je klient. Desktop (localhost) zůstane bez tokenu.

### R6: agentContext wrapper (ne raw metadata)

Nepřenášet interní struktury přímo. Versioned wrapper:

```json
{
  "agentContext": {
    "version": 1,
    "data": {
      "lastIntent": "CODE",
      "followUpContext": "...",
      "turnIndex": 3
    }
  }
}
```

Mobil uloží celý `agentContext` objekt a pošle zpět. Backend kontroluje `version` a migruje pokud je potřeba.

### R7: GitHub OAuth scope

Pro git push musí být scope `repo` (ne jen `read:user`):

```
scope=user:email read:user repo
```

Bez `repo` scope push nebude fungovat. Scope se ukládá do `oauth_accounts.scope`.

### R8: Device token formát — version prefix

```
c3d_v1_ + 32 random hex
```

Prefix `c3d_v1_` umožňuje změnit formát v budoucnu bez breaking change.

### R9: CORS

Native mobilní app (Android/iOS) CORS nepotřebuje.
Web mobilní klient ano — v tom případě device token v `Authorization` headeru + dynamický CORS pro ověřené device klienty.

### R10: /api/system/info pro mobil

```json
{
  "version": "0.94",
  "models": { "chat": "qwen2.5:32b", "code": "qwen2.5-coder:32b" },
  "capabilities": ["infer", "agent", "search", "scrape"]
}
```

Mobil přizpůsobí UI podle backendu. Endpoint už existuje — rozšířit o `capabilities` a `models`.

---

## Fáze implementace

### F0: Crypto helpers (prerekvizita)
**Soubor:** `src/core/crypto.js`

```
deriveKey(secret) → sha256(secret)                       // 256-bit klíč z libovolně dlouhého secretu
encrypt(plaintext, secret) → { iv, ciphertext, tag }     // AES-256-GCM
decrypt({ iv, ciphertext, tag }, secret) → plaintext
hashToken(token) → sha256hex                              // pro device tokeny
generateToken() → 'c3d_v1_' + 32 random bytes hex        // pro device tokeny
getValidAccessToken(db, provider) → string|null           // auto-refresh wrapper
```

Env: `C3_TOKEN_SECRET` (fallback: `getHardwareFingerprint()` z license.js)

**Rozsah:** ~80 řádků, 0 závislostí (jen `node:crypto`)

---

### F1: Identity model + DB migrace
**Soubor:** `src/db/migrations/2026_03_04_029_v94_identity.js`

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,              -- UUID
  email TEXT,
  name TEXT,
  avatar_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- Constraint: MAX 1 řádek (enforced v kódu, ne v DB)

CREATE TABLE oauth_accounts (
  id TEXT PRIMARY KEY,              -- UUID
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,           -- 'google' | 'github'
  provider_user_id TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  access_token_enc TEXT,            -- AES-256-GCM encrypted JSON {iv, ciphertext, tag}
  refresh_token_enc TEXT,           -- AES-256-GCM encrypted JSON {iv, ciphertext, tag}
  token_expires_at DATETIME,
  scope TEXT,                       -- granted scopes (comma-separated)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE device_clients (
  id TEXT PRIMARY KEY,              -- UUID
  name TEXT NOT NULL,               -- "Pixel 8", "iPhone 15"
  type TEXT NOT NULL DEFAULT 'mobile',  -- 'mobile' | 'tablet' | 'api'
  token_hash TEXT NOT NULL UNIQUE,  -- SHA-256(device_token)
  user_id TEXT REFERENCES users(id),
  platform TEXT,                    -- 'android' | 'ios' | 'web'
  app_version TEXT,
  last_seen_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_device_token ON device_clients(token_hash);

CREATE TABLE device_pairing (
  code TEXT PRIMARY KEY,            -- 8-char base32 code (XXXX-XXXX)
  device_name TEXT,
  expires_at DATETIME NOT NULL,
  claimed_device_id TEXT,           -- set when pairing completes
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE oauth_state (
  state TEXT PRIMARY KEY,           -- random token
  provider TEXT NOT NULL,
  code_verifier TEXT NOT NULL,      -- PKCE
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL      -- now + 10min
);
```

**Prepared statements** (přidat do `database.js`):

```javascript
users: {
  get: db.prepare('SELECT * FROM users LIMIT 1'),
  upsert: db.prepare(`INSERT INTO users (id, email, name, avatar_url)
    VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
    email=excluded.email, name=excluded.name, avatar_url=excluded.avatar_url,
    updated_at=datetime('now')`),
},
oauthAccounts: {
  findByProvider: db.prepare('SELECT * FROM oauth_accounts WHERE provider = ?'),
  findByProviderUserId: db.prepare(
    'SELECT * FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?'),
  upsert: db.prepare(`INSERT INTO oauth_accounts
    (id, user_id, provider, provider_user_id, email, display_name, avatar_url,
     access_token_enc, refresh_token_enc, token_expires_at, scope)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, provider_user_id) DO UPDATE SET
    email=excluded.email, display_name=excluded.display_name,
    avatar_url=excluded.avatar_url,
    access_token_enc=excluded.access_token_enc,
    refresh_token_enc=excluded.refresh_token_enc,
    token_expires_at=excluded.token_expires_at,
    scope=excluded.scope, updated_at=datetime('now')`),
  updateTokens: db.prepare(`UPDATE oauth_accounts SET
    access_token_enc=?, refresh_token_enc=?, token_expires_at=?,
    updated_at=datetime('now') WHERE id=?`),
  delete: db.prepare('DELETE FROM oauth_accounts WHERE id = ?'),
  listForUser: db.prepare(
    'SELECT id, provider, email, display_name, avatar_url, scope, created_at FROM oauth_accounts WHERE user_id = ?'),
},
deviceClients: {
  findByTokenHash: db.prepare('SELECT * FROM device_clients WHERE token_hash = ?'),
  create: db.prepare(
    'INSERT INTO device_clients (id, name, type, token_hash, user_id, platform, app_version) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  updateLastSeen: db.prepare(
    'UPDATE device_clients SET last_seen_at=datetime(\'now\'), app_version=? WHERE id=?'),
  list: db.prepare(
    'SELECT id, name, type, platform, app_version, last_seen_at, created_at FROM device_clients ORDER BY last_seen_at DESC'),
  delete: db.prepare('DELETE FROM device_clients WHERE id = ?'),
},
devicePairing: {
  create: db.prepare('INSERT INTO device_pairing (code, device_name, expires_at) VALUES (?, ?, ?)'),
  findValid: db.prepare(
    'SELECT * FROM device_pairing WHERE code = ? AND expires_at > datetime(\'now\') AND claimed_device_id IS NULL'),
  claim: db.prepare('UPDATE device_pairing SET claimed_device_id = ? WHERE code = ?'),
  cleanup: db.prepare('DELETE FROM device_pairing WHERE expires_at < datetime(\'now\')'),
},
oauthState: {
  create: db.prepare(
    'INSERT INTO oauth_state (state, provider, code_verifier, expires_at) VALUES (?, ?, ?, ?)'),
  validate: db.prepare(
    'SELECT * FROM oauth_state WHERE state = ? AND expires_at > datetime(\'now\')'),
  delete: db.prepare('DELETE FROM oauth_state WHERE state = ?'),
  cleanup: db.prepare('DELETE FROM oauth_state WHERE expires_at < datetime(\'now\')'),
},
```

**Rozsah:** 1 migrace (~60 řádků) + ~50 řádků prepared statements v database.js

---

### F2: OAuth backend
**Soubor:** `src/routes/auth.js`

Funkce: `createAuthRoutes({ db, config, sendJSON, parseBody, logger })`

**Endpointy:**

#### `GET /api/auth/:provider/start`
1. Validuj provider ∈ {google, github}
2. Feature guard: `config.oauth[provider].clientId` musí být nastavený
3. Generuj `state` token (random 32 bytes hex)
4. Generuj `code_verifier` + `code_challenge` (PKCE — S256)
5. Ulož do `oauth_state` tabulky (expires_at = now + 10min)
6. Sestav authorization URL:
   - Google: `https://accounts.google.com/o/oauth2/v2/auth`
     - `scope=openid email profile`
     - `access_type=offline` + `prompt=consent` (pro refresh_token)
     - `code_challenge_method=S256`
   - GitHub: `https://github.com/login/oauth/authorize`
     - `scope=user:email read:user repo` (repo = git push)
7. Vrať `{ url }` → FE otevře v novém okně

#### `GET /api/auth/:provider/callback`
1. Validuj `state` token z `oauth_state` tabulky (not expired)
2. Smaž state z DB (single-use)
3. Exchange `code` + `code_verifier` za tokeny:
   - Google: POST `https://oauth2.googleapis.com/token`
   - GitHub: POST `https://github.com/login/oauth/access_token`
4. Fetch user info:
   - Google: GET `https://www.googleapis.com/oauth2/v2/userinfo`
   - GitHub: GET `https://api.github.com/user` + `GET /user/emails`
5. Create/update `users` (LIMIT 1 — upsert)
6. Create/update `oauth_accounts` (encrypt tokeny přes crypto.js)
7. Vrať HTML stránku:
```html
<script>
  window.opener.postMessage({ type: 'oauth_success', provider: '...' }, '*');
  window.close();
</script>
```

**Error cases:**
- `invalid_state` → HTML chybová stránka (ne JSON — callback je v popupu)
- `expired_state` → "OAuth session vypršela, zkuste znovu"
- `missing_code` → "Autorizace zamítnuta"
- `provider_error` → "Chyba poskytovatele: {error_description}"

#### `GET /api/auth/me`
1. Vrať aktuálního uživatele (`users` LIMIT 1) + propojené poskytovatele (bez tokenů)
2. Response:
```json
{
  "user": { "id": "...", "email": "...", "name": "...", "avatar_url": "..." },
  "providers": [
    { "provider": "google", "email": "...", "scope": "...", "connected_at": "..." },
    { "provider": "github", "email": "...", "scope": "...", "connected_at": "..." }
  ]
}
```

#### `DELETE /api/auth/:provider`
1. Smaž oauth_account pro daný provider
2. Pokud žádný provider nezbývá → smaž users řádek

**Env proměnné** (přidat do `.env.example`):
```
C3_GOOGLE_CLIENT_ID=
C3_GOOGLE_CLIENT_SECRET=
C3_GITHUB_CLIENT_ID=
C3_GITHUB_CLIENT_SECRET=
C3_TOKEN_SECRET=                  # AES key pro OAuth token encryption
```

**Redirect URI** (registrovat u providera):
- Google: `http://127.0.0.1:3335/api/auth/google/callback` (Desktop app type)
- GitHub: `http://127.0.0.1:3335/api/auth/github/callback`

**Žádná nová závislost** — čistý `node:crypto` + `fetch()` (Node 22).

**Rozsah:** ~280 řádků

---

### F3: Device pairing + mobilní auth
**Soubor:** `src/routes/devices.js`

Funkce: `createDeviceRoutes({ db, config, sendJSON, parseBody, logger })`

#### `POST /api/devices/pair/start`
*Volá desktop* — generuje pairing code.
1. Generuj 8-char base32 kód (formát `XXXX-XXXX`, ~1B kombinací)
2. Ulož do `device_pairing` (expires_at = now + 5min)
3. Vrať `{ code, expiresAt, connectUrl: 'http://<localIP>:3335' }`

#### `POST /api/devices/pair/complete`
*Volá mobil* — dokončí pairing.
1. Body: `{ code, deviceName, platform, appVersion }`
2. Validuj code (findValid — not expired, not claimed)
3. Generuj device token (`c3d_v1_` + 32 random hex)
4. Ulož `device_clients` (hash tokenu)
5. Claim pairing code
6. Vrať `{ deviceId, token, userId, backendVersion }` — token vrácen JEDNOU

#### `GET /api/devices`
*Desktop only (localhost)* — seznam spárovaných zařízení.

#### `DELETE /api/devices/:id`
*Desktop only (localhost)* — odstraní zařízení.

#### `POST /api/devices/heartbeat`
*Mobil* — heartbeat + update last_seen.
1. Header: `Authorization: Bearer c3d_v1_...`
2. Validuj token (hashToken → findByTokenHash)
3. Update `last_seen_at`, `app_version`
4. Vrať `{ status: 'ok', backendVersion }`

**Device auth middleware** — `src/middleware/device-auth.js`:
```javascript
export function requireDeviceAuth(db) {
  return (req) => {
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer c3d_')) return null;
    const hash = hashToken(auth.slice(7));
    const device = db.deviceClients.findByTokenHash.get(hash);
    if (!device) return null;
    db.deviceClients.updateLastSeen.run(device.app_version || '', device.id);
    return device;
  };
}
```

**WS handshake rozšíření** (patch `ws-server.js`):
```javascript
// V hello handleru po protocol version check:
if (msg.deviceToken) {
  const hash = hashToken(msg.deviceToken);
  const device = db.deviceClients.findByTokenHash.get(hash);
  if (!device) { ws.close(4001, 'Invalid device token'); return; }
  session.deviceId = device.id;
  session.deviceType = device.type;
  session.isDevice = true;
} else if (!isLocalhost(req)) {
  ws.close(4003, 'Remote connections require device token');
}
```

**Rozsah:** ~180 řádků routes + ~30 řádků middleware + ~20 řádků WS patch

---

### F4: Mobilní compute API (stateless)
**Soubor:** `src/routes/infer.js`

Funkce: `createInferRoutes({ db, config, sendJSON, parseBody, logger, callLLM })`

**Všechny endpointy vyžadují device token auth.**

#### `POST /api/infer`
Stateless LLM inference — NIC se neukládá do C3 DB.
```json
// Request
{
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "model": "chat",
  "agentContext": {
    "version": 1,
    "data": { ... }
  },
  "settings": {
    "language": "cs",
    "maxTokens": 4096
  }
}

// Response
{
  "message": "...",
  "model": "qwen2.5:32b",
  "tokens": { "prompt": 1200, "completion": 350 },
  "agentContext": {
    "version": 1,
    "data": {
      "lastIntent": "CODE",
      "followUpContext": "...",
      "turnIndex": 4
    }
  }
}
```

#### `POST /api/infer/agent`
Stateless agent execution — agent pipeline bez persistence.
```json
// Request
{
  "messages": [...],
  "agentId": "...",
  "tools": ["search", "scrape"],
  "attachments": [{ "name": "file.py", "content": "base64..." }]
}

// Response
{
  "message": "...",
  "toolResults": [...],
  "agentContext": { "version": 1, "data": { ... } }
}
```

#### `POST /api/infer/file`
Stateless file processing — attachment-only (OCR, analýza, shrnutí).

**Rozsah:** ~150 řádků

---

### F5: Frontend OAuth flow
**Soubory:** `src/ui/architect/architect.js` + `architect.html`

Nahradit fake `connectAccount()`:

```javascript
function connectAccount(provider) {
  fetch(`/api/auth/${provider}/start`)
    .then(r => r.json())
    .then(data => {
      const popup = window.open(data.url, 'oauth', 'width=500,height=700');
      window.addEventListener('message', function handler(e) {
        if (e.data?.type === 'oauth_success' && e.data?.provider === provider) {
          window.removeEventListener('message', handler);
          popup?.close();
          refreshAccountStatus();
        }
      });
    });
}

async function refreshAccountStatus() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) return;
  const { user, providers } = await res.json();
  for (const p of providers) {
    handleOAuthSuccess(p.provider, { email: p.email, name: p.display_name });
  }
  if (user) {
    settingsState.user.name = user.name;
    settingsState.user.email = user.email;
    updateUserStatus();
  }
}
```

Přidat do `architect.html`:
- Device pairing sekce (zobrazí 8-char kód + IP adresu)
- Seznam spárovaných zařízení s "Odpojit" tlačítkem
- Automatický refresh pairing status (polling 2s dokud je code aktivní)

**Rozsah:** ~80 řádků JS + ~30 řádků HTML

---

### F6: server.js wiring + config
**Soubor:** `src/server.js` + `src/config.js`

1. Import nových route modulů
2. Mount routes (po parseBody, bez auth middleware — každý route řeší auth sám)
3. Config rozšíření:
```javascript
oauth: {
  google: {
    clientId: process.env.C3_GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.C3_GOOGLE_CLIENT_SECRET || '',
  },
  github: {
    clientId: process.env.C3_GITHUB_CLIENT_ID || '',
    clientSecret: process.env.C3_GITHUB_CLIENT_SECRET || '',
  },
  tokenSecret: process.env.C3_TOKEN_SECRET || null,  // fallback: HW fingerprint
},
```
4. Feature guard: OAuth endpointy fungují jen pokud jsou CLIENT_ID/SECRET nastavené
5. Rozšířit `GET /api/system/info` o `capabilities` a `models` objekt pro mobilní discovery

**Rozsah:** ~50 řádků

---

### F7: GitHub integrace (git identity)
**Soubor:** `src/core/git-identity.js`

```javascript
export async function getGitIdentity(db) {
  const ghAccount = db.oauthAccounts.findByProvider.get('github');
  if (!ghAccount) return null;
  const token = await getValidAccessToken(db, 'github');
  return {
    name: ghAccount.display_name,
    email: ghAccount.email,
    token,  // pro git push
  };
}
```

Integrace do lifecycle executoru (`src/planner/lifecycle-build.js`):
- `git config user.name` + `git config user.email` z GitHub identity
- `git remote set-url origin https://TOKEN@github.com/...` pro push
- Scope `repo` musí být grantovaný (ověřit v `oauth_accounts.scope`)

**Rozsah:** ~40 řádků + ~10 řádků patch v lifecycle-build.js

---

## Pořadí implementace

```
F0  crypto.js          [prerekvizita]          ~80 ř.
F1  DB migrace         [prerekvizita]          ~110 ř.
F2  OAuth backend      [závisí na F0, F1]      ~280 ř.
F3  Device pairing     [závisí na F0, F1]      ~230 ř.
F4  Mobilní API        [závisí na F3]          ~150 ř.
F5  FE OAuth flow      [závisí na F2]          ~110 ř.
F6  server.js wiring   [závisí na F2, F3, F4]  ~50 ř.
F7  GitHub git identity [závisí na F2]         ~50 ř.
```

F2+F5 a F3+F4 jsou nezávislé a mohou jít paralelně.

**Celkový rozsah:** ~1060 řádků nového kódu + ~70 řádků patchů.

---

## Testy

**Soubor:** `tests/identity-oauth.test.js`

| Suite | Testy |
|---|---|
| crypto helpers | encrypt/decrypt roundtrip, hashToken deterministic, generateToken format (c3d_v1_), deriveKey length |
| users table | upsert, get, LIMIT 1 constraint |
| oauth_accounts | upsert, findByProvider, delete, encrypted token roundtrip, updateTokens |
| oauth_state | create, validate, delete (single-use), cleanup expired |
| device_clients | create, findByTokenHash, list, delete, updateLastSeen |
| device_pairing | create 8-char code, findValid, claim, expiry cleanup |
| OAuth flow | start → URL format + state in DB, callback → user+account created, /me response |
| OAuth errors | invalid state, expired state, missing code, provider error |
| Device flow | pair/start → code, pair/complete → token, heartbeat → last_seen |
| Infer API | stateless response (no DB side effects), agentContext roundtrip, version field |
| WS device auth | device token accepted, invalid token rejected, localhost bypass |
| auto-refresh | expired token → refresh called, valid token → no refresh |

**Odhadovaný počet testů:** 40–50

---

## Soubory k vytvoření / úpravě

| Akce | Soubor |
|---|---|
| CREATE | `src/core/crypto.js` |
| CREATE | `src/db/migrations/2026_03_04_029_v94_identity.js` |
| CREATE | `src/routes/auth.js` |
| CREATE | `src/routes/devices.js` |
| CREATE | `src/routes/infer.js` |
| CREATE | `src/middleware/device-auth.js` |
| CREATE | `src/core/git-identity.js` |
| CREATE | `tests/identity-oauth.test.js` |
| EDIT | `src/db/database.js` — prepared statements (users, oauthAccounts, deviceClients, devicePairing, oauthState) |
| EDIT | `src/config.js` — oauth config keys |
| EDIT | `src/server.js` — mount routes |
| EDIT | `src/ws-bridge/ws-server.js` — device token in handshake + session binding |
| EDIT | `src/ui/architect/architect.js` — real OAuth flow + device pairing UI |
| EDIT | `src/ui/architect/architect.html` — device pairing section |
| EDIT | `src/planner/lifecycle-build.js` — git identity |
| EDIT | `src/routes/system.js` — extend /api/system/info with capabilities + models |
| EDIT | `.env.example` — new env vars |
