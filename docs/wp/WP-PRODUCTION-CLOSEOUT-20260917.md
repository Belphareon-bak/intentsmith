# WP — production closeout 2026-09-17

**Stav:** IN_PROGRESS. Autorita: výslovné zadání operátora dokončit zbývající
produkční práci autonomně; PRODUCT §5 a ROADMAP §10. Tento dokument nepřidává
release požadavky ani nepřijímá vlastní implementaci.

- Vstup: vlastní čistý `9b031278` + nasazený `023af4dd`; zachovat obě linie.
- Výsledek: sjednocený ověřený kandidát, opravené pozorované regrese,
  proveditelná release validace a nezávisle revidovatelný přesný rozsah.
- Vlastnictví: tato větev, integrační dokumentace; reprodukovatelnost
  specialist-loader, M2 process-supervision a accountant workflow testů,
  jejich runner/toolchain; konkrétní zjištěné produktové vady a review evidence.
  Cizí checkouty, procesy, živé bindings a soukromé klíče se nemění.
- Pozorování: předchozí úplný profil 357 PASS / 1 FAIL / 1 BLOCKED;
  archivovaný heap false-negative 12,38 MiB; Unix socket truncation v dlouhé
  instalační cestě; PDF a účetní OCR používají odlišná Python prostředí.
  Aktuálně NVIDIA kernel 595.84 proti instalovaným knihovnám 595.91.07;
  `nvidia-smi` nelze použít jako důkaz volné GPU.
- Demo/test: skutečné privacy HTTP requesty včetně logů a working memory;
  původní bezpečnostní socket assertions v dlouhé cestě; měření retained heap;
  celý offline/database profil s oběma přiznanými toolchainy, Studio build,
  registry/boundary; release/model běhy jen s prokázanými předpoklady.
- Příkazy: `node scripts/validate-test-registry.js`,
  `node scripts/nightly-audit.js --profile=offline,database` s explicitními
  dostupnými toolchainy a vlastním artifact root; `corepack yarn build`
  v `c3-ide`; `git diff --check`. Přesné invokace a SHA patří do run evidence.
- Stop pouze konkrétního efektu: cizí writer, nedostupná fyzická GPU/key-custody
  podmínka, nový rozsah nebo oslabení hranice. Ostatní práce pokračuje.
  Release PASS nelze vydat bez požadovaného nezávislého review a přijetí.
