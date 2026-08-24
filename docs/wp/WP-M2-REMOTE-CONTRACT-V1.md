# WP-M2-REMOTE-CONTRACT-V1

**Typ:** M2 oddíl 7/7 — zmražený `RemoteCorePort` negotiation a security
boundary kontrakt

**Stav:** `IMPLEMENTATION_GREEN / REVIEW_REQUIRED`

**Autorita:** operátorské spuštění celé M2; `ROADMAP.md` §6 krok 5 a M2 exit
kritérium pro verzovaný remote connector bez legacy bypassu

**Integrační vstup:** `cb9058b499961fc68711cbfc243ad2a7b68b0eba` — oddíl 6
implementačně a gateově zelený, povinné Opus reviews blokuje účtový spend limit

## Uživatelský výsledek

Budoucí companion může proti jedné zmražené verzi zjistit, zda core podporuje
projekty, konverzace, settings, stored information, approvals, notifications a
events. Negotiation je striktní a neuděluje žádnou authority. Dokud M5 nedodá
skutečný core adaptér, lokální provider vrací každou vyžádanou capability
explicitně jako unavailable; nikdy nevrací prázdný nebo implicitní úspěch.

Tento oddíl nevytváří síťový listener, pairing, device token ani mobilní
runtime. Legacy `/api/*` a `/c3/ws` zůstávají numericky loopback-only a nesmějí
se stát implementací `RemoteCorePort`.

## Vlastněný rozsah

- `RemoteCorePortDescriptor`, `RemoteCoreHello` a `RemoteCoreNegotiation` v1;
- exact sedmičlenný capability catalog a vazby na existující core authority
  contracts;
- strict port-version a per-capability version negotiation bez implicitního
  downgrade nebo unknown-field tolerance;
- fail-closed unavailable provider s jedinými read-only metodami `describe` a
  `negotiate`;
- threat model, contract test, compatibility test a negativní boundary test;
- registry, module graph, artifact a deterministický gate evidence.

## Zakázaný rozsah

- HTTP/WS/TCP listener, LAN bind, discovery, reverse proxy nebo tunnel;
- pairing, autentizace, device identity/scope, tokeny, expiry či revokace;
- skutečný provider projektů, konverzací, settings, stored information,
  approvals, notifications nebo event streamu;
- přímé volání legacy routes, databáze, serveru, websocketu nebo interních
  modulů z contract/unavailable provideru;
- mobilní UI/runtime, GPU, Ollama, modelové nebo síťové běhy;
- označení negotiation za authority nebo unavailable capability za success.

## Kontraktové invariants

- Všechny tři kontrakty mají exact keys, verzi 1, canonical timestampy,
  bytewise seřazené unikátní množiny a bounded identifikátory.
- Hello obsahuje jen client/build identity, explicitní podporované port verze a
  neprázdnou exact capability/version množinu. Neobsahuje actor, token, grant,
  payload, endpoint ani jinou self-asserted authority.
- Port v1 se vybere pouze tehdy, když jej klient explicitně nabízí. Unknown
  capability, neznámé pole, duplicate, nesetříděná množina nebo pouze cizí
  port verze nesmí vytvořit negotiated success.
- Každá requested capability má právě jeden výsledek. `available` vyžaduje
  klientem nabízenou capability verzi a exact contract/operations digests;
  `unavailable` a `incompatible` vyžadují typed error a nulovou selected verzi.
- Celkový `negotiated` vyžaduje alespoň jednu available capability. Nula
  available je explicitní `unavailable`, nikdy zelený empty result.
- Port-version incompatibility vrací nulový selected port, prázdné capability
  výsledky a jediný stable incompatibility error.
- Negotiation response ani descriptor nejsou approval, grant, effect request
  nebo autentizační důkaz a nesmějí se tak použít.
- Unavailable provider nemá `listen`, `connect`, `pair`, `invoke`, `fetch` ani
  jinou efektovou metodu a jeho import nesmí inicializovat server/DB/runtime.
- Legacy listener zůstává exact `127.0.0.1`; remote contract/provider se nesmí
  importovat ze `src/server.js` ani odkazovat na legacy route implementace.

## Acceptance

1. Descriptor přesně a stabilně jmenuje všech sedm capability tříd, authority
   contract refs, compatibility a security boundary.
2. Positive hello/negotiation a digest round-trip projde; chybějící, extra,
   unknown, duplicate, unsorted, noncanonical a foreign-version vstupy selžou.
3. False `negotiated` bez available capability, chybějící result, cizí selected
   capability verze a available bez digestů fail-close selžou.
4. Unavailable provider vrací pro kompatibilní hello sedm explicitních denialů
   a pro nekompatibilní port exact incompatibility, bez efektu.
5. Static import-graph a server sentinely dokazují nulový import DB/routes/
   server/network/WS a žádné připojení k legacy listeneru.
6. Legacy listener policy test dál připíná jediný bind `127.0.0.1` a odmítá
   wildcard, LAN, symbolic i IPv6 hosty.
7. Registry, module ratchet, artifact validation a celý deterministic gate se
   zopakují s pravdivým verdict/counts/non-PASS setem.
8. Lokální Claude Opus `--effort max` vrátí `REVIEW_PASSED`; každý
   `CHANGES_REQUESTED` se opraví a review zopakuje.

## Přiznané limity

- Port v1 zmrazuje negotiation/security obálku a capability identity. Každý
  budoucí M5 provider musí samostatně nabídnout svůj capability contract a
  operations digest; tento oddíl jejich payload schema nepředstírá.
- M5 implementuje in-process core adaptér. M7 teprve nad ním přidá oddělený
  listener, pairing, autentizaci, device scope, expiry, revokaci a mobilní UI.
- Existující `ConversationCommand/Result` a `CoreEvent` zůstávají přesně ve své
  verzi 1; Remote negotiation jejich význam nerozšiřuje.
- Opus account limit není review verdict. Dokud limit trvá, stav zůstává
  `REVIEW_BLOCKED_ACCOUNT_LIMIT`, ne hotovo.

## Ověření

```bash
node tests/m2-remote-core-port-contract-v1.test.js
node tests/m2-remote-core-port-boundary.test.js
node tests/routes-smoke.test.js
node tests/m1-contract.test.js
node tests/m2-effect-contract-v1.test.js
node tests/m2-lifecycle-contract-v1.test.js
node tests/module-boundary-ratchet.test.js
node scripts/validate-test-registry.js --json
node tests/artifact-validation.test.js
npm run test:deterministic
git diff --check
```
