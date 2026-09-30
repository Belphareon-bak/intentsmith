# IntentSmith — stav dokončování k 30. 9. 2026, 18:38 UTC

Tento záznam je vývojový checkpoint, nikoli release acceptance. Přesný integrační
zdroj před dokumentačním commitem: `222793c6eb0208886d26985f7642fe2a037e7bba`
na `work/real-chat-journeys-20260930`. Remote shoda se ověřuje po pushi.
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
  na asynchronní souhrn, odmítání neúplných výstupů a zachování celého
  souhrnu v projektovém promptu je nyní integrovaná v `88a7f91a` +
  `222793c6` a má omezené nezávislé `REVIEW_PASS`. Cílené context, projektové,
  M1 a persistence testy na společném SHA prošly; nový živý modelový běh je
  při tomto checkpointu `NOT RUN`.
- Projektový A→B→A průchod má deterministický test a omezené nezávislé review.
  Projektové expertizy prošly na společném SHA cíleným skutečným HTTP průchodem
  **1/1** s izolovaným providerem a kontrolou finálního promptu. Nativní worker
  prošel HTTP/SQLite scénáři **6/6**, související runner **22/22** a Project
  Health **10/10**; test restartuje DB/služby v jednom procesu. Specialistický
  M1 test dvou projektů po zesílení orákula prošel nezávislým omezeným review
  a na společném SHA **1/1**. Kontroluje čtyři tahy, odlišné zdrojové bajty,
  nálezy a nulový modelový fallback. Tyto fixture testy neměří odpověď
  skutečného modelu, všechny specialisty ani Studio UI. Integrované worker
  HTTP testy prošly **6/6**, runner **22/22**, Project Health **10/10**;
  registry, M6 plán, artifact-validation a harness také prošly.

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
  napojení nejsou ověřené. Host mobilní gate na společném zdroji prošel
  **47/47**. Integrace se otevírá po stabilizaci IDE 2.0 a
  backendu; M7 zůstává **NOT_ACCEPTED**. Konkrétní funkční mezera pro tuto
  fázi: `newChat()` vytvoří pouze lokální ID a M7 `conversation.execute`
  odmítne neexistující konverzaci jako `ACCESS_DENIED`. Katalog M7 zatím
  nemá `conversation.create`; před mobilní přejímkou je nutné schválit
  kontrakt a ověřit průchod nová konverzace → první zpráva → historie.

## Git a navazující brány

Integrační branch obsahuje všechny zde uvedené přijaté zdrojové a testovací
commity; push přesného finálního dokumentačního SHA se ověří zvlášť. Soukromé
provider logy, databáze a obrazové
důkazy nejsou součástí Git zdrojů. Ještě není pravdivé tvrdit, že všechny
rozpracované materiály jsou na remote nebo že lze odstranit všechny staré
větve. Úklid musí následovat až po integraci, ověření remote a inventáři
vlastnictví čistých/cizích pracovních stromů.

Další brány v pořadí: (1) zopakovat cílené testy po integraci a plný
offline/database profil na jednom SHA; (2) znovu provést živou sadu 85 po
produktové změně; (3) samostatně integrovat a kvalifikovat GPU hunt a
hodnotitele; (4) přejmout a nasadit IDE/backend, poté otevřít mobilní napojení;
(5) přesným inventářem a proof-of-remote zredukovat bezpečně odstranitelné
větve a worktree.
