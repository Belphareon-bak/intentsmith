# WP — opravy auditu a návrh rozšíření po 1.0

Autorita: explicitní zadání operátora 2026-09-11 po auditu 983121ee:
navrhnout dokumentaci obecného zlepšování modelu, porozumění celému projektu,
úplných agentů a kontrakty odložených ploch; potom opravit nalezené problémy.
Produktové opravy vycházejí z PRODUCT §2–3, Decision 043 a reprodukcí auditu.
Tento brief nezakládá přijetí budoucích technických návrhů ani release.

- Vstup: `983121eece58b8522f736d4c8bc7c7e0ea4f657a`.
- Vlastník: jeden implementátor, větev `work/audit-remediation-20260911` v již
  existující vlastní auditní kopii; žádný nový worktree ani cizí zápisy.
- Výsledek nyní: pravdivý terminální stav analýzy, korektní modelový adaptér,
  vyřešené doložené test/runtime vady, ověřené bezpečnostní aktualizace,
  opakovaný původní modelový cookbook a přesná provozní dokumentace.
- Výsledek návrhu: sedm kontraktů v `docs/post-release/` pro následné review.
- Vlastněné cesty: `src/chat/handlers/code-analysis.js`, související chat/abort
  a WS consumer hranice, `src/llm/cre-bridge.js`, `src/eval/code-patch-runner.js`,
  `src/code-intel/code-search.js`, příslušné existující testy a nově nutné
  regresní testy, registry a generovaný přehled; manifesty/lockfiles backendu
  a Studia s nutnou kompatibilitou; `docs/post-release/**`, tento brief,
  `docs/INSTALL.md`, README, ROADMAP, SYSTEM-MAP a dotčené inventury.
- Connectory: zachovat ProjectContext v1, M1/legacy WS autoritu, modelové
  role/budget policy, scope efektů a přesnou identitu modelu. Nový webový scope
  je výslovně schválen pro 1.0 s každým jednotlivým souhlasem (Decision 044).
  Vlastněné cesty navíc: `contracts/m2/conversation-web-v1.js`, chat consumer,
  `src/network/conversation-web-*.js`, migrace 111 a registrace typed writeru,
  odpovídající testy a popis scope. Změřený opakovaný 120s timeout úplného
  SPEC navíc opravuje pevný 240s budget pouze v `callSpecDocumentLLM`, se
  zachováním ostatních modelových limitů a novým review požadavkem. Tentýž
  reálný běh odkryl předávání neúplného CODE výstupu jako implementace; rozsah
  oprav proto zahrnuje shared typed truncation guard a FAILED terminál ve
  workflow, bez navýšení CODE limitu či změny produkčního context profilu.
- Zakázáno: měnit živou DB či bindingy, rotovat neidentifikované credentials,
  podepisovat nedoložené receipts, měnit klíče/cizí procesy, publikovat release,
  implementovat budoucí trénink nebo odložené plochy pouze na základě návrhu.
- Demonstrace: analýza přes skutečný controller/finalizer nevytvoří success
  po výpadku/truncation/cancel; úspěch vrátí doložený kontext; skutečné HTTP/WS
  testy, původní cookbook na privátní DB bez změn provozních bindingů.
- Ověření: cílené existující testy podle změny, `npm run test:registry`,
  `npm run test:deterministic` v izolovaném prostředí na čistém commitu,
  příslušné registrované server/model programy a `git diff --check`.
- Stop konkrétní větve práce: potřebná neudělená autorita, cizí aktivní GPU,
  nedostupný model/toolchain nebo skutečná nevyřešená regrese. Nezávislé opravy
  pokračují; BLOCKED/REVIEW_REQUIRED se nikdy nepřejmenuje na PASS.

Stav a důkazy patří do ROADMAP, SYSTEM-MAP a jednoho závěrečného run reportu.
