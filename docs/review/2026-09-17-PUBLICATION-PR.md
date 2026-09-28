# Integrate governed core journeys with repo-scored GPU hunt

**SOURCE_PUBLISHED / PR_NOT_CREATED / REVIEW_PENDING.**
GitHub větev `work/hunt-review-followup-20260912` byla publikována a SHA
`01e2846fcc9c08177b5da84054d3338d94d0dab7` ověřeno přes `git ls-remote`.
Následné doplnění tohoto záznamu je pouze dokumentační.
GitHub connector odmítl vytvoření draft PR: HTTP 403,
`Resource not accessible by integration`. Nejde o zamítnuté review kódu.

[Připravit PR proti pracovní větvi](https://github.com/Belphareon-bak/intentsmith/compare/work%2Fmobile-completion-20260908...work%2Fhunt-review-followup-20260912?expand=1).
Cíl: `work/mobile-completion-20260908` (`68f5080c`), draft.
Výchozí `main` má samostatnou historickou linii; nebyla sloučena.

## Popis pro PR

Publikuje společný core/hunt kandidát a opravuje zastaralé údaje o fyzickém
journey a zbývající provozní práci. Proti cílové pracovní větvi zahrnuje:

- řízené draftování změn více souborů, závislostní plány, Studio composer,
  rušení a explicitní schválení provedení;
- konverzační HTTPS bez projektu s individuálním lokálním schválením,
  SSRF/TLS/redirect hranicemi a samostatným webovým review;
- společnou integraci core, hunt retence a repo scoringu, vyřešenou kolizi
  migrací, produkční guard duplicitního sidebaru a DB regresi retry incumbenta;
- spojený Studio → HTTP → exact model/binding → preview → schválení → dva
  soubory → assertions → restarty → DB restore, fresh install evidence
  a pravdivé hlášení neověřené Ollamy po offline instalaci;
- aktuální README, ROADMAP, SYSTEM-MAP a přenositelný souhrn ověření.

Na čistém `26a038db` prošlo **353/353** offline/database programů, registry
516, accountant tools 81/81. Po doplnění dokumentace artifact validation
158/158 a 241 relativních odkazů bez chyby. Runtime zdroje zůstávají stejné
jako na `20e5a022` s produkčním Studio buildem z 2026-09-12.
Dnes nebyla spuštěna nová modelová inference ani nový Studio build.

Původní běh na `fd216540` **352 PASS / 1 FAIL** zůstává zachovaný.
Účetní test používal dnešní datum proti pevnému `verified_at=2025-09-15`.
Oprava řídí čas v testu, ověřuje čerstvost i zastaralost kolem 365 dní
a obnovuje hodiny v `finally`; produktová data a politika se nemění.
SHA-256 všech 706 logů obou běhů byly ověřeny.

Podklady: [publikační souhrn](../execution/runs/github-publication-20260917.json),
[nová hunt/core delta](2026-09-12-HUNT-REVIEW-FOLLOWUP.md),
[oddělený review receipt journey](2026-09-12-PRODUCTION-JOURNEY-REVIEW-RECEIPT.md).

**REVIEW_PENDING / release acceptance BLOCKED.** Starší no-blocking review
platí jen ve svém původním rozsahu. Lokální instalace, služby, timer, DB ani
bindingy nebyly přepnuty. Hunt checkout používá jiný CODE kontrakt;
jeho CODE skóre není zaměnitelné. Poslední panel má 13/38 nedostatečně
průkazných duelů. Zbývá společná instalace a DB, desktopový launcher/služba,
GUI huntu a další kalibrace. Launcher stále vyžaduje opravu vlastnictví
port file a zachování chybového exit statusu. M5/M6 acceptance zůstává otevřená.
Provozní DB a soukromé raw archivy nejsou součástí veřejného repozitáře.
