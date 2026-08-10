# WP-M1-POLICY-PORTABLE-SECURITY — default-deny portable settings

**Typ:** zapisující bezpečnostní repair · **Slot:** jeden writer v izolovaném
worktree

**Base revision:** `06e760bb04933a97857ea0ab25a397914b47e60e`

**Závislost:** přijaté rozhodnutí [020/E](../decisions/020-m1-model-failover-opt-in-surface.md)
a dokončený backend/Studio subject `1d351f67..06e760bb`

**Stav:** source subject `4ba38dd9c295558dc0b241cfdf5bda21a9fd2526`
commitnutý; exact ratchet baseline je součástí navazujícího evidence commitu.
Nezávislé Review A a fresh-clone evidence zůstávají otevřené.

## 1. Uživatelský výsledek

Stažený soubor nastavení nesmí obsahovat credentials, soukromé údaje,
notification destinations, provider/runtime adresy ani budoucí neznámá pole.
Import smí změnit pouze přesně verzovaný portable profil a modelovou
automatizační policy; vše ostatní přebírá z aktuální destination instalace.

Stejný kontrakt musí používat všechny tři živé first-party consumer surfaces:
autoritativní Studio chat panel, Studio Center Views a `/architect`. Úplný
state backup zůstává samostatným `WP-M5-DATA` kontraktem.

## 2. Vlastněné a zakázané cesty

**Povolené:**

- `src/db/settings-portability.js`, úzká integrace v `src/db/model-policy.js`;
- explicitní backup/import response v `src/routes/misc.js`;
- autoritativní `c3-chat-panel/lib/**` a `c3-center-views/lib/**` runtime;
- `src/ui/architect/architect.js` a `architect.html`;
- focused `tests/m1-model-policy.test.js` a `tests/m1-studio-client.test.js`;
- exact ratchet baseline edge pro `model-policy -> settings-portability`;
- tento WP, decision 020, inventury 18a/21, unikátní run report a Finding 011.

**Zakázané:**

- stale Studio TypeScript mirror, build output regenerace a nová závislost;
- schema/migrační změna, model failover proof issuance, GPU/Ollama běh;
- změna obecného settings reader/writer authority mimo explicitní
  backup/import response;
- external network, Electron journey, integrace nebo posun canonical
  `origin/integration/gate1-prod-ready-20260809`;
- přepis historie nebo úprava historického Review A reportu.

## 3. Interní connector a stav

`src/db/settings-portability.js` je jediná repository autorita profilu
`UX_PREFERENCES_V1`. V2 obálka má exact top-level tvar, fully materialized
pointer mapu a default-deny omission claim. V2 unknown/missing pole nebo
neplatná hodnota končí před `BEGIN IMMEDIATE`.

V1 a raw legacy dokumenty zůstávají importovatelné, ale pouze projekcí přes
stejný allowlist. Jejich omission metadata nemá authority. Destination
nonportable cesty se zachovají ve snapshotu, který import transakce načte.

Portable profil obsahuje jen jedenáct ohraničených UI předvoleb. Location,
identity, memory/retention, notification, storage, model/provider, device a
unknown cesty jsou záměrně local-only. Profil netvrdí úplnost Studio settings
ani runtime účinnost každé historické UI předvolby.

## 4. Povinné pořadí efektů

1. klient validuje exact v2 nebo vytvoří v1 compatibility envelope;
2. backend znovu validuje a projektuje zdroj bez důvěry v klienta;
3. repository uvnitř vlastního `BEGIN IMMEDIATE` načte destination dokument;
4. overlayne přesně source-derived portable cesty (u v2 všech jedenáct, u
   v1/raw pouze přítomný validní subset) a ve stejné transakci commitne policy
   i jediný audit event;
5. teprve pravdivý exact commit response smí změnit UI snapshot;
6. non-2xx je `REJECTED`; ztracená nebo malformed 2xx odpověď je
   `DELIVERY_UNKNOWN` a blokuje další whole-document save do reloadu.

## 5. Pozitivní a negativní důkaz

Pozitivní evidence musí vykonat export/import přes backend i všechny tři
first-party UI cesty. Profilové konstanty musí být byte-for-byte shodné.

Negativní minimum:

1. nested i flat credentials/destinations a unknown future pole se nestáhnou;
2. extra/missing v2 pointer, envelope field, neplatný enum nebo rozsah selže
   před DB mutací i HTTP efektem klienta;
3. v1/raw attacker hodnoty se nepřenesou a destination canaries přežijí;
4. JSON data keys `constructor`, `prototype` a `__proto__` se bezpečně zachovají
   jako data nebo ignorují, nikdy nezmění prototype;
5. malformed/non-2xx export nevytvoří download;
6. import/reset nepřijme 2xx bez exact schema, actor, propojeného policy/event
   ID, source-derived path/value/policy provenance a pravdivého ignored countu;
7. ambiguous delivery zablokuje stale save;
8. Center Views nesmí replayovat import přes `syncSettings` ani exportovat
   `/api/system/info` config;
9. `/architect` nesmí serializovat `settingsState`, mutovat stav před
   serverovým commitem, měnit prototype ani přijmout stale GET po recovery;
10. falešně pojmenovaný full/factory backup nebo reset nevytvoří efekt.

Legacy v1/raw compatibility nesmí defaultovat chybějící portable cesty ani
tiše skrýt zahozené source cesty. Všechny tři UI plochy zobrazí jejich přesný
počet; názvy ani hodnoty local-only cest se na veřejnou hranici nevydávají.

## 6. Stop condition / eskalace

Tento repair nezastaví kvůli obecnému settings authority dluhu. Zaznamená jej
jako P1 Finding 011 a zachová Gate 1 `BLOCKED`. Dotčená část se zastaví pouze,
pokud by oprava vyžadovala změnit accepted 020 reset semantics, přidat
dependency, oslabit loopback/auth guard nebo převzít cizí writer paths.

## 7. Ověřovací příkazy

```bash
node tests/m1-model-policy.test.js
node tests/m1-studio-client.test.js
node tests/routes-smoke.test.js
node tests/schema-migrations.test.js
node tests/artifact-validation.test.js
node tests/repository-hygiene.test.js
node scripts/validate-test-registry.js --json
node scripts/module-boundary-ratchet.mjs
node tests/module-boundary-ratchet.test.js
git diff --check
```

Skutečná Ollama, GPU, external network a Electron nejsou pro tento source
checkpoint autorizované ani potřebné.

Lokální pre-commit výsledky, dvě jednotlivé mutation kontroly a pravdivě
červený ratchet před přijetím exact hrany jsou v
[run reportu](../execution/runs/wp-m1-policy-portable-security-20260810-report.md).

## 8. Výstup a pravdivé omezení

Výstupem je nový immutable repair subject nad `06e760bb`, nový unikátní report
a explicitní supersession nepravdivého schema-v1 Review A claimu. Source
commit sám není Review A ani fresh-clone evidence.

Generický `GET/POST /api/settings`, importní response obsahující destination
dokument, legacy RMW writery a chybějící revision/CAS dál tvoří Finding 011.
Tento WP proto dokládá bezpečnost přenosného artifactu a jeho import commit
pointu, nikoli jedinou globální `user_settings` writer autoritu.
