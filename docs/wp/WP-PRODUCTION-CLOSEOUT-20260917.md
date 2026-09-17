# WP — production closeout 2026-09-17

**Stav:** IMPLEMENTED_INSTALLED / SOAK_RUNNING / REVIEW_REQUIRED.
Release closeout zůstává otevřený. Autorita: výslovné zadání operátora dokončit zbývající
produkční práci autonomně; PRODUCT §5 a ROADMAP §10. Tento dokument nepřidává
release požadavky ani nepřijímá vlastní implementaci.

**Navazující review 2026-09-17:** operátor dodal nezávislou revizi přesného
rozsahu `9b031278..c2989a3e`. Čtyři opravy jsou potvrzené, ale historický
inventář M5 opomněl testovací TLS klíč a certifikát. Aktivní remediace doplní
oba objekty, jejich oddělený zářijový containment a disposition podle dříve
zvoleného `retain_and_rotate`; související validační projekce musí obsáhnout
celý inventář a zachovat červencový záznam beze změny. Podpisy a přijetí
zůstávají otevřené. Ostatní review plochy operátor výslovně neověřoval.

Follow-up `6546d648`: scanner 15/15 a 0 current-tree nálezů; celý profil
358 PASS / 1 FAIL (stejná pečeť), 0 BLOCKED; artifact validation 160/160,
privacy 24/24. [Remediace a scope dalšího review](../review/2026-09-17-M5-TLS-HISTORY-REMEDIATION.md).
Nová delta je REREVIEW_REQUIRED; custody/podpisy a 24h soak zůstávají otevřené.

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

## Výsledek tohoto průchodu

- Kandidát `c2989a3e`, integrační merge `adcccef8`; backend, Studio a hunt
  používají stejný instalovaný pin. Obě původní linie jsou zachované.
- Reprodukce vedly k opravě izolace OCR runtime, retained-heap měření,
  skutečných Unix socket fixtur a generování TLS identity mimo Git strom.
  Plný profil: 358 PASS / 1 FAIL / 0 BLOCKED, pouze release seal.
- HTTP 6 programů / 134 kontrol PASS; Studio build a fyzické panely/reload
  PASS; data zachována; aktuální privacy scan bez nálezů.
- Pětiminutový throughput na přesném kandidátu PASS; 24h soak pokračuje
  od 2026-09-17 18:29 CEST. GPU, provider a M5 custody/podpisové podmínky
  se nesimulují ani nevydávají za hotové.
- [Review packet](../review/2026-09-17-PRODUCTION-CLOSEOUT.md) a
  [strojový záznam](../execution/runs/production-closeout-20260917.json)
  obsahují i negativní běhy. Toto není nezávislé přijetí vlastní změny.
