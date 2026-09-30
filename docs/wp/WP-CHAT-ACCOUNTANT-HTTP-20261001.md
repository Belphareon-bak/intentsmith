# WP — účetní DPH přes skutečný M1 HTTP chat

**Stav 1. 10. 2026:** izolovaný implementační kandidát, **REVIEW_PENDING**.
Deterministický řízený provider běh prošel 1/1; fyzický model, UI a release
nejsou tím ověřené.

**Autorita a vstup:** operátor výslovně žádá skutečný chatový test specialisty
`accountant-cz` s částkou 10 000 Kč, sazbou 21 % a rokem 2025. Vstupní čistý
integrační commit je `c815ec435f69b4a52b30ab2f96da65136890d3c6`.
Produktový důkaz na uživatelské hranici plyne z `PRODUCT.md` §2 a
`CONTRACT.md` §4; práce navazuje na specialistickou M1 cestu ve
`WP-CHAT-SPECIALIST-FOLLOWUP-20260930.md`. Vlastní větev:
`work/chat-accountant-http-20261001`.

**Vlastněné cesty:** `tests/chat-accountant-model-contract.test.js`,
`src/chat/handlers/expertise.js`, tento WP, jediný nový záznam v
`tests/registry.json`, jeho generovaný derivát
`docs/convergence/TEST-REGISTRY.md` a mechanické počty v `README.md` a
`SYSTEM-MAP.md`.
Zakázány jsou jiné pracovní stromy, běžící služba a její DB, GPU/Ollama,
modelové vazby, daňové sazby a ostatní účetní balíček.

**Cesta a orákulum:** test spustí vlastněný `src/server.js`, privátní SQLite,
projekt a loopback provider. Přes HTTP zjistí a zvolí `accountant-cz`, pak
odešle `ConversationCommand` do `POST /api/chat`. Manifest mapuje tento
balíček na runtime expertizu `accountant`. Nástroj
`accountant.vat_calculator` musí z aktuální věty vytěžit přesně
`{amount:10000, year:2025, rate:'21', direction:'add'}`. Jeho strukturovaný
výsledek i podklad v závěrečném provider requestu musí uvádět základ 10 000,
DPH 2 100 a celkem 12 100 Kč, sazbu 21 %, směr `add` a rok 2025. Jediná
provider odpověď s přesnými částkami, předpoklady, nezahrnutým rozsahem a
účetním disclaimerem musí beze změny projít do M1 HTTP odpovědi a dvou
trvale uložených zpráv. Session po tahu drží zvolený `accountant-cz`.

**Red-first nález:** na nezměněném vstupním zdroji test skončil 0/1:
`response.metadata.specialistTool` bylo `undefined`. Specialist runtime
správně předal raw tool tag, ale `wrapWithExpertisePersona` při generativním
zabalení nepřenesl `specialistTool` ani `extractedParams` do finální M1
odpovědi. Kandidát přenáší tato dvě existující metadata spolu s již
přenášenými `toolResults`. Negativní mutace odmítají nesprávné DPH, sazbu
v parametrech a chybějící strukturovaný výsledek v provider promptu.

**Příkaz cíleného ověření:**

```sh
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node --test tests/chat-accountant-model-contract.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

**Stop condition a hranice důkazu:** test dokládá jeden vybraný účetní
výpočet v izolované M1 HTTP cestě s řízeným providerem. Nepotvrzuje daňové
poradenství v libovolném zadání, fyzický model, účetní workflow s doklady,
restart session, mobilní klient ani obecnou produkční připravenost.
Nezávislé review a opakování na sloučeném commitu jsou samostatné brány.
