# WP-M7-VPN-LISTENER-ACTIVATION

## Autorita

Implementuje přijaté Decision 042. Nemění jeho VPN-only, systemd credential,
port, retenci, cap ani local-only pairing volby.

## Implementační bloky

1. `M7VpnRuntimeConfiguration@1`: exact interface/address/origin a fail-closed
   systemd credential custody.
2. `M7VpnTlsListener@1`: TLS 1.3 HTTP/1.1 listener, přesné framing limity,
   typované odpovědi a graceful shutdown.
3. lokální Studio pairing issuance: autentizovaný user subject, single-use claim,
   pět minut, no-store response a QR/deep-link payload.
4. Android transport: bundled origin/SPKI pin, native HTTPS a Ed25519 device
   proof pro pairing, session control a invocation.
5. focused, structural a deterministická evidence; reálná VPN/device evidence
   zůstane BLOCKED, dokud host nemá VPN interface a operátor nedodá produkční
   credentials.

## Zákazy

- žádný fallback na LAN, loopback, wildcard, HTTP ani proxy;
- žádný secret v env, SQLite, repozitáři, logu či artefaktu;
- žádné automatické vytvoření produkčního key materialu;
- žádný push, publish, firewall mutation ani systemd activation.

## Verifikace bloku 1

```bash
node tests/m7-vpn-runtime-config.test.js
node tests/m7-transport-admission-policy.test.js
node tests/m7-durable-rate-limiter.test.js
node tests/module-boundary-ratchet.test.js
node scripts/validate-test-registry.js
git diff --check
```
