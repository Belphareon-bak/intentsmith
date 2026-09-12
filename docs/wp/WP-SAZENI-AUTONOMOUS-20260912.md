# WP-SAZENI-AUTONOMOUS-20260912

Autorita: operátor 2026-09-12 odmítl ručně dodané pravděpodobnosti, požaduje
samostatné vyhledávání dat a kvalitně postavený engine podložený rozsáhlým
výzkumem; autorizuje i dlouhou implementaci. Navazuje na předchozí prototyp.

1. Výsledek: autonomní cesta preference → načtené zdroje → vypočtené a
   změřené pravděpodobnosti → časově omezené tikety → uživatelský výstup.
   Zároveň konkrétní ověřený způsob vyzkoušení a doložený výzkumný podklad.
2. Vlastnictví: existující specialists/sazeni, jeho CLI/model/data host,
   související tests, registrace, dokumentace a úzké runtime/outbound integrační
   spoje. Žádné změny cizích worktree, živých DB, GPU/model bindings, účtů
   sázkových kanceláří nebo objednávek datových služeb. Účetní není tento WP.
3. Kontrakt: autonomní Betting v3 odstraní veřejné ruční p; zdroje a modely
   jsou host-owned, deklarované, auditované, verzované a bez neomezené síťové
   authority specialisty. Změna konektoru není sama nezávislé přijetí.
4. Vstup: 2d19fd068109b1a480a62afce0a61170a9e6b220, vlastní čistý existující
   worktree is-specialists-engines-20260911. Další worktree nevzniká.
   Sdílená mobilní větev postupuje nezávisle a její HEAD není integrační vstup.
5. Demo: jediný příkaz s časem/kurzem/pravděpodobnostním limitem bez ručně
   dodaných p nebo zápasů; reálný veřejný feed bude označen podle skutečné
   aktuálnosti, ne jako ověřená okamžitá nabídka české kanceláře.
6. Důkaz: chronologicky oddělené train/validation/test; reference tržních
   pravděpodobností, log loss, Brier, kalibrace a nejistota; časová dostupnost
   vstupů, neznámé týmy, nulové pokrytí, chybná data, stale quote, scoped fetch,
   cancellation, persistence a skutečná prezentace. Syntetické testy nenahrazují
   měření na historických datech a to zase nenahrazuje živý provoz.
7. Omezení: neznámé credentials/pokrytí blokují jen příslušný živý feed.
   Žádná nepodložená garance výhry ani prohlášení nejlepšího modelu bez srovnání.
   Nový informační zdroj se nesmí vydávat za dostupný, než jej sonda potvrdí.
8. Ověření: relevantní focused testy, registry a deterministický profil,
   empirický benchmark s přesnými zdrojovými hashi a holdout hranicemi.
   Stav a důkazy patří do canonical docs/reportu; toto je zadání, ne board.
