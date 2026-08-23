# WP-M2-CODE-PROJECT-BOUND-SYMBOL-INDEX-V1

**Typ:** okamžitý follow-up po `WP-M2-CODE-PROJECT-CONTEXT-V1`

**Stav:** `PLANNED / BLOCKED_BY_CONTAINMENT_AND_INTEGRATION_BASE`;
žádná implementace

**Operátorské rozhodnutí:** 2026-08-23 — Containment V1 je bezpečnostní
mezikrok, nikoli cílový stav; jako první se obnoví project-bound symbol lookup

**Contract-review base:** `c4ffb2de`

**Containment implementation base:** `44a9ba87`

**Inspekční revision závady:** `b00df959`

**Produkční vstup:** čistý integrační SHA s přijatým M1 a integrovaným
`WP-M2-CODE-PROJECT-CONTEXT-V1`

## 1. Uživatelský výsledek a pořadí obnovy

Dotaz typu „kde je `X` definované“ dostane rychlý, deterministický symbolový
hit pouze z požadovaného projektu a přesné `workspaceRevision`. Stejné jméno v
jiném projektu, starší revision nebo nedokončený build se nikdy nesmí objevit v
publikovaném `ProjectContextSnapshot@1`.

Containment úmyslně odstraní tři schopnosti, ale jejich priorita není stejná:

1. **P0:** project-bound symbol index — tento WP;
2. **P1:** project-bound grafová expanze — samostatný následný WP až po
   akceptaci tohoto balíku;
3. **retired:** dnešní Git-recency ranking s globální TTL cache, `Date.now()` a
   vahou `0.15` se v této podobě neobnoví.

Tento WP je úzká obnova symbol lookupu. Nesmí se změnit v umbrella refactor
grafu, rankeru ani celého legacy retrieval stacku.

Rails:

- **R2 LOCAL_FIRST:** žádná síť, Git ani subprocess;
- **R3 OBSERVABLE_BEHAVIOR:** důkaz vede přes reálný `CODE_ANALYSIS` consumer;
- **R4 MEASURED_QUALITY:** měří se cold build i warm lookup a symbolový oracle;
- **R5 MODULAR_BOUNDARIES:** index je interní provider za existujícím
  project-context connectorem;
- **R7 PRIVACY_AND_LEARNING_SCOPE:** každý index a hit je svázaný s project
  identitou, revision, content digestem a provenance.

## 2. Závislosti a vstupní podmínky

Implementace nezačne, dokud současně neplatí:

- existuje nový čistý integrační SHA s operátorsky přijatým M1;
- `WP-M2-CODE-PROJECT-CONTEXT-V1` je integrovaný a jeho boundary, stale,
  determinism a consumer suites procházejí;
- produkční `ProjectContextQuery/Snapshot@1`, registry-backed identity,
  `ContextSourceSet@1` a `workspaceRevision` jsou přesně připnuté;
- balík má vlastní worktree/branch z tohoto integračního SHA;
- vlastník test registry rezervoval nové append-only suite ID.

Tento dokument neodblokovává symbol-index product code na `c4ffb2de`,
`b00df959` ani na samotném `44a9ba87`. Symbol WP dostane vlastní branch až z
pozdějšího SHA, které integruje containment a jeho přijatou evidenci.

## 3. Contract boundary

Veřejný `ProjectContextQuery/Snapshot@1` se nemění. Symbol index je interní,
vyměnitelný provider, který vrací kandidáty do existujícího deterministického
scoringu a budgetingu. Jakákoli potřeba nového veřejného pole je stop condition
a vyžaduje samostatné contract review.

Index key je úplná n-tice:

```text
(projectId, canonicalRoot, workspaceRevision,
 sourcePolicyVersion, symbolIndexAlgorithmVersion)
```

Žádný člen se nesmí vynechat, odvodit z wall-clock stavu ani nahradit „posledním
postaveným projektem“. `projectId` je registry-backed identita, ne hash cesty.
`canonicalRoot` se ověřuje stejnou path-authority logikou jako connector.

Index smí vzniknout pouze z providerem validovaného `ContextSourceSet@1` a
přesných bajtů/provenance svázaných s danou `workspaceRevision`. Nesmí sám
obcházet registry, znovu interpretovat caller-supplied cesty ani provádět
nezávislý globální filesystem walk.

## 4. Build, publication a cache semantics

- Cold key se smí deterministicky postavit on demand; cold není `empty`.
- Po úspěšném buildu je lookup podle přesného, jazykově case-sensitive symbol
  jména indexovaný; query term normalizace zůstává verzovanou odpovědností
  project-context provideru.
- Publikace je atomická a immutable. Cancel, timeout, read failure nebo stale
  revision nezveřejní částečný index ani pozdní success.
- Single-flight je povolený pouze pro přesně shodný celý key. Build projektu A
  nikdy nesmí obsloužit B; dvě revision stejného projektu se nesmí slít.
- Eviction a cache hit/miss jsou pouze performance detail. Nesmějí změnit
  outcome, pořadí items, score ani `snapshotDigest`.
- Warm a cold cesta pro stejný vstup musí vydat byte-for-byte stejné kandidáty
  a výsledný snapshot.
- Cache stáří, mtime, inode, Git historie, locale a `Date.now()` nejsou vstupem
  buildu, lookupu, pořadí ani digestu.

Více definic stejného symbolu se řadí kanonicky podle explicitního
symbolového score a poté bytewise podle project-relative path, line span,
symbol kind a content digestu. Float s platformně závislou serializací ani
locale collator nejsou přípustné.

## 5. Povolený scope

- `src/code-intel/project-symbol-index-*.js`;
- minimální adaptéry v `src/code-intel/project-context-*.js` bez změny
  veřejného V1 connectoru;
- minimální consumer wiring v `src/chat/handlers/code-analysis.js`, pouze pokud
  ho nelze udržet zcela za providerem;
- `tests/m2-project-symbol-index-contract.test.js`;
- `tests/m2-project-symbol-index-boundary.test.js`;
- `tests/m2-project-symbol-index-consumer.test.js`;
- `tests/m2-project-symbol-index-performance.test.js`;
- `tests/fixtures/m2-project-symbol-index/**`;
- pouze předem rezervované nové `suites/<id>` v `tests/registry.json`;
- unikátní branch report
  `docs/execution/runs/wp-m2-code-project-bound-symbol-index-v1.md`.

Integrátor aktualizuje souhrnné stavové dokumenty až po nezávislém review.

## 6. Zakázaný scope

- změna veřejného `ProjectContextQuery/Snapshot@1`;
- editace nebo runtime použití globálního
  `src/code-intel/symbol-index.js`;
- `knowledge-graph.js`, `graph-retrieval.js`, `file-discovery.js`,
  `code-search.js` a jejich dynamické importy;
- návrat Git-recency signálu v jakékoli wall-clock/TTL podobě;
- nová ručně udržovaná JSON Schema autorita;
- filesystem write, network, model, Git nebo jiný subprocess v index provideru;
- `PRODUCT.md`, `DIRECTION.md`, `CONTRACT.md`, `ROADMAP.md`, `SYSTEM-MAP.md`,
  `.project/**`, cizí checkouty a cizí dirt;
- GPU/model hunting, Studio, mobile, WebSocket a databázové migrace.

## 7. Acceptance a negativní důkazy

1. Fixture dotazy „kde je X definované“ vrátí commitnutou definici v `top 1`;
   kolize více legitimních definic mají explicitní deterministický oracle.
2. Projekty A/B obsahují stejné jméno a rozdílné canary; A nikdy nevrátí B ani
   po warm-upu B.
3. Souběžný build A/B a souběžný build dvou revision stejného projektu mají
   oddělené promises, publikace i keys.
4. Cold build, warm lookup a cesta po eviction vrátí stejné ordered candidates,
   items a `snapshotDigest`.
5. Změna, smazání nebo unreadable soubor během buildu vrátí příslušný
   stale/read terminál bez částečné publikace. Nová revision nepoužije index
   staré revision.
6. Cancel a timeout před publikací zanechají cache bez daného key; pozdní
   dokončení read/parse kroku nesmí přepsat terminál ani publikovat index.
7. Reálný `CODE_ANALYSIS` consumer s fake/injected LLM prokazatelně použije
   project-bound index a neimportuje globální `symbolIndex`.
8. Warm/cold výkon se změří na commitnutém fixture i reprezentativním repu.
   O(1) se vztahuje na lookup v již publikovaném indexu, ne na cold build.
   Číselná release mez se nesmí vymyslet bez baseline; report uvede dataset,
   počet symbolů, cold build, warm lookup a prostředí.
9. Spies dokazují nula write/network/model/Git/subprocess calls uvnitř index
   provideru a nula filesystem walků mimo validovaný source set.
10. Mutační test musí selhat při odstranění kteréhokoli členu key, záměně key
    za globální „current project“, neatomické publikaci nebo přidání
    wall-clock/locale tie-breaku.

Další adversarial případy:

- absolutní cesta, `..`, symlink alias a `projectId`/root mismatch;
- shodné symbol names v různých adresářích, souborech a line spans;
- case odlišné symboly v case-sensitive jazyce;
- source set na scan ceilingu a symbol za output budgetem;
- build failure po částečném parse;
- eviction během paralelního lookupu;
- pokus použít legacy singleton jako fallback při cold startu;
- registry resolver vrátí jiný canonical root než query.

Focused průchod těchto sad dokládá izolaci a symbolovou obnovu, nikoli plnou
retrieval paritu ani grafové porozumění dotazům „co tohle rozbije“.

## 8. Stop conditions

- chybí čistý integrační M1 SHA nebo integrovaný containment;
- connector/source-set/revision contract není přesný nebo by se musel změnit;
- implementace potřebuje globální singleton, legacy retrieval fallback nebo
  vlastní neautorizovaný filesystem walk;
- project/root/revision nejdou vložit do úplného cache key;
- A/B nebo cross-revision negativní test odhalí sdílení dat/promise;
- cold/warm/evicted cesty nemají stejné sémantické výsledky;
- symbolová top-1 quality floor neprojde;
- řešení expanduje scope do grafu, Git recency, efektů nebo stavových dokumentů;
- independent review chybí nebo evidence existuje jen v author suite.

## 9. Následný grafový WP

Po akceptaci tohoto balíku vznikne samostatný
`WP-M2-CODE-PROJECT-BOUND-GRAPH-V1`. Musí převzít stejný úplný
project/root/revision/policy key, atomickou publikaci a cold/warm ekvivalenci.
Nesmí být skrytě přibalen do tohoto symbol-index WP.

## 10. Plánované ověření

```bash
node tests/m2-project-symbol-index-contract.test.js
node tests/m2-project-symbol-index-boundary.test.js
node tests/m2-project-symbol-index-consumer.test.js
node tests/m2-project-symbol-index-performance.test.js
node tests/m2-project-context-contract.test.js
node tests/m2-project-context-boundary.test.js
node tests/m2-project-context-consumer.test.js
node tests/m2-project-context-retrieval.test.js
node scripts/module-boundary-ratchet.mjs
npm run test:deterministic
npm run test:registry
git diff --check
git status --short
```

Tyto nové testy zatím neexistují a příkazy nejsou release evidence. WP je
plánovaný a blokovaný; `READY_FOR_IMPLEMENTATION` může dostat až po splnění
všech vstupních podmínek v §2.
