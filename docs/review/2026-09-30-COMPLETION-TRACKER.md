# IntentSmith — stav dokončování k 30. 9. 2026, 18:22 UTC

Tento záznam je vývojový checkpoint, nikoli release acceptance. Přesný integrační
zdroj při zápisu: `3c2f1b2efcfecad1d917945e85da83e883644857` na
`work/real-chat-journeys-20260930`, shodný s `origin/work/real-chat-journeys-20260930`.
Instalovaný frontend IDE 2.0 je nadále `fddfe996`, běžící backend `c84b88cd`;
nový integrační zdroj ještě není nasazený. Studio 2 produkční kandidát
`1cb4a79f` je v této větvi integrován; jeho omezené nezávislé review a cílené
kontroly prošly, ale release review a nasazení této delty zůstávají otevřené.

## Chat a projekty

- Skutečná modelová sada `IS-T3-E2E-85-LONG-SESSION-DEGRADATION` na čistém
  `0b0cabdba153b0bebfda8fc06a8a34da11766a30` prošla **4/4**. Runner
  ověřil **57** zachycených provider volání pro přesný digest `qwen3.5:27b`,
  finální prompt a odpověď, soukromý artefakt a uvolnění GPU lease. CODE
  odpověď ukončená na 1200 tokenech byla úspěšně zopakována. Syrová historie
  naplnila více než skutečné `num_ctx=4096`; první souhrn ušetřil 303 tokenů
  na stejném snapshotu a finální odpověď vrátila kód z prvního tahu.
  [Rozsah a lokální report](../wp/WP-CHAT-WINDOW-FILL-20260930.md).
- Tento PASS neprokazuje úplnost všech souhrnů. V zachyceném běhu končily
  některé sumarizační requesty na výstupním limitu 500 tokenů. Oprava čekání
  na asynchronní souhrn a odmítání neúplného souhrnu je v oddělené větvi
  `work/intent-resilience-20260928`, při tomto checkpointu `CHANGES_REQUIRED`:
  úsporný projektový prompt ještě umí souhrn oříznout/odhodit a po souběžném
  přírůstku tahů je nutný další sumarizační krok. Nová živá přejímka po opravě
  je `NOT RUN`.
- Projektový A→B→A průchod má deterministický test a omezené nezávislé review.
  Projektové expertizy prošly na společném SHA cíleným skutečným HTTP průchodem
  **1/1** s izolovaným providerem a kontrolou finálního promptu. Nativní worker
  prošel HTTP/SQLite scénáři **6/6**, související runner **22/22** a Project
  Health **10/10**; test restartuje DB/služby v jednom procesu. Specialistický
  M1 test dvou projektů je v samostatné větvi a při tomto checkpointu čeká
  na zesílení orákula a integraci. Tyto fixture testy neměří odpověď skutečného
  modelu, všechny specialisty ani Studio UI.

## GPU hunt, release a mobil

- Read-only report z instalované DB `data/c3.db` v 18:17 UTC nad providerem
  `0.34.0-intentsmith.1` uvádí **84/84 použitelných dvojic model–role MISSING**,
  **0 COMPLETE** a **0 přijatých rozhodnutí**. Runtime vazby sedmi rolí jsou
  `UNVERIFIED_RUNTIME`. Starší uložené běhy a vývojová hodnoticí matice
  nepředstavují aktuální přijaté skóre. Druhý hodnotitel má jen částečné
  soukromé výstupy (106 JSON souborů / 590 známkovaných položek z matice
  1173 odpovědí); přejímka a aktivace jsou **NO_GO**. Hunt kandidát je na
  jiné, zatím nesloučené větvi. [Pravidla výběru](../MODEL-SCORING-ACTIVATION.md).
- Poslední dokončený offline/database běh před novými HTTP testy měl
  **373 PASS / 1 FAIL / 13 BLOCKED** na starším integračním SHA; jediný FAIL
  je pečeť Gate 0. Novější audit po přidání testů byl řízeně ukončen při
  změně inventáře; opravené cílené pojistky prošly, celý profil na aktuálním
  SHA je **NOT RUN**. Žádný z těchto běhů není release PASS.
- Mobilní aplikace má připravené UI a úzké review, ale fyzický Android,
  VPN/pairing/revocation, přístupnost, podepsaný release a produkční
  napojení nejsou ověřené. Integrace se otevírá po stabilizaci IDE 2.0 a
  backendu; M7 zůstává **NOT_ACCEPTED**.

## Git a navazující brány

Integrační branch je pushnutý na přesný commit uvedený výše. Dvě právě
revidované práce (auto-context a specialistický test) jsou zatím pouze v
izolovaných lokálních worktree. Soukromé provider logy, databáze a obrazové
důkazy nejsou součástí Git zdrojů. Ještě není pravdivé tvrdit, že všechny
rozpracované materiály jsou na remote nebo že lze odstranit všechny staré
větve. Úklid musí následovat až po integraci, ověření remote a inventáři
vlastnictví čistých/cizích pracovních stromů.

Další brány v pořadí: (1) opravit a nezávisle přijmout zbývající auto-context
mezery a specialistické orákulum; (2) zopakovat jejich cílené testy i plný
offline/database profil na jednom SHA; (3) znovu provést živou sadu 85 po
produktové změně; (4) samostatně integrovat a kvalifikovat GPU hunt a
hodnotitele; (5) přejmout a nasadit IDE/backend, poté otevřít mobilní napojení;
(6) přesným inventářem a proof-of-remote zredukovat bezpečně odstranitelné
větve a worktree.
