# Workery a specialisté — funkční audit a oprava ztráty stavu

Zadání: operátor 2026-10-10 požádal o test workerů a specialistů a opravu
nefunkčního chování během souběžného ladění IDE. Autorita: toto explicitní
zadání, CONTRACT §2/§4/§6 a existující M3 Project Health journey.

- Vstup: ověřený GitHub main `138e958be927df9835c091d3ad41d44b347e85b5`,
  fast-forward na aktuální integrační zdroj
  `46337ee66f8788f9ca2f041c165d4e35b3f242cf`. Běžící release je samostatný
  `3c804a8a859a9f44efd200585795f5373e85fc3c`.
- Výsledek: přejmenování či změna popisu instance workeru se stejnými parametry
  zachová baseline, cooldown a čas plánování. Změna vstupních parametrů dál
  vytvoří novou baseline. Pozorovaná HTTP regrese: rename smaže celý state,
  následná změna projektu vrací INIT_BASELINE a nevytvoří notifikaci.
- Vlastněné cesty: `src/extensions/agent-extension-service.js`,
  `tests/m3-agent-product-http-journey.test.js`,
  `tests/m3-agent-real-scheduled-soak.test.js`, tento WP a výsledný audit
  v `docs/review/2026-10-10-WORKER-SPECIALIST-AUDIT.md`. Pozorovaná druhá regrese
  rozšiřuje vlastní scope o `src/expertises/specialist-runtime.js` a
  `tests/chat-accountant-deterministic-http.test.js`: nedostupný či odmítnutý
  účetní host musí vrátit FAILED bez nabídky jiné expertízy/modelového fallbacku.
  `SYSTEM-MAP.md` se mění jen pro povinné přeměření LOC census po těchto změnách.
- Connector: stávající PUT konfigurace M3 instance; formát API ani efektová
  oprávnění se nemění. IDE checkouty, provozní DB, modelové bindingy,
  publikovaná testová kritéria a GPU/driver konfigurace jsou mimo zapisovaný scope.
- Demonstrace: skutečný privátní produkt HTTP/SQLite, rename → změna souboru
  → právě jedna notifikace; restart; parametrická změna → nová baseline.
  Skutečný 5m interval se při rename nesmí posunout ani spustit předčasně.
- Pozitivní/negativní kontroly: existující runtime, autentizace, disabled,
  stale digest, chybějící projekt, crash recovery a specialistové; zachovat
  všechny původní assertions. Řízený provider není důkaz modelové kvality.
- Stop: změna L0/produktového rozsahu či chybějící hardware se neobchází.
  Žádný restart provozu ani merge do cizí IDE větve v rámci tohoto WP.
- Ověření: Node 24 `scripts/nightly-audit.js --profile=offline,database
  --concurrency=1` s explicitními existujícími toolchainy; cílené self-starting
  HTTP/soak registry sady sériově; `scripts/validate-test-registry.js`;
  `git diff --check`. Přesné příkazy a SHA náleží do výsledného reportu.

Výjimka workspace budget: předběžný report neměl žádný bezpečně odstranitelný
checkout (88 chráněných/živých). Nový vlastní checkout izoluje tuto práci od
aktivních IDE/release procesů a UNKNOWN/cizích změn. Zůstanou pouze potřebné
důkazy a nejnovější sandbox této práce; cizí chráněná evidence se neodstraňuje.
