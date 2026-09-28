# WP-MODEL-EVALUATION-CONSOLIDATION — Opus max rereview

- **reviewer:** lokální Claude Opus, `--model opus --effort max`
- **runtime:** Claude Code 2.1.220
- **režim:** read-only `--permission-mode plan --no-session-persistence`
- **rozsah:** `74beafea439fdddbbb54e797d351dfe180b2d5f7..26ab32913c0461936ca2289309311bacca523209`
- **reviewed HEAD:** `26ab32913c0461936ca2289309311bacca523209`
- **verdict:** `REVIEW_PASSED`
- **čas dokončení:** 2026-08-28 před 09:22:56+02:00

Reviewer měl zakázané zápisy, síť, Ollamu, GPU a dotyk jiných worktrees.
Inspektoval skutečný diff, výsledný produkční call/import graph, persisted a
emitted kontrakty, migrace, snapshot a současnou evidenci. Neomezil se na WP,
testy ani zelený gate.

## Nezávisle reprodukované hranice

- Gateway odmítla devět útočných tvarů, včetně A→B→A se dvěma inventory
  snapshoty A a bez response digestu. Druhý mutable inventory read už není
  akceptační důkaz; exact digest musí přijít v téže provider response.
- Manual verification i autoritativní scoring odmítly chybějící, driftující či
  modelově neshodný response digest. Historical summary znovu resolveuje exact
  artefakt a mismatch odmítne.
- V přímé DB sondě s jediným D1 `COMPLETE` zůstaly D2 a R1 `MISSING`; role je
  součástí cache, history, persistence, decision filtru i read-model joinů.
- Sanitizovaná pre-082 migrace zachovala role-consistent decision, cross-role
  decision úplně karanténovala a post-migration cross-role insert odmítla.
  Neplatná pre-097 role skončila úplným rollbackem a `quick_check=ok`.
- Všech 11 veřejných auto-failover/proof lifecycle writerů chybí, nemá
  produkční volající a coordinator zůstává detection-only. Telemetry veto nemá
  runtime reference.
- Registry znovu vyšla na 448 programů a fingerprint
  `b8791c78ca0277ed1b1b4b301887ff5a2d85c6f16e6840e95e540860b0275d4d`.
- Snapshot používá read-only existující source, odmítá existující target,
  zapisuje evidenci non-clobber a zachycuje source summary před projekcí i po
  celém capture intervalu. Post-gate snapshot reprodukoval 28 `COMPLETE`, 11
  `BLOCKED`, 52 `MISSING`, 0 `FAILED` a shodné source SHA před/po.
- Product/test head je `79328185`; pozdější změny do reviewed headu jsou pouze
  dokumentace a post-gate JSON. Reviewer znovu spustil 20 relevantních
  deterministických programů, všechny prošly.

## Neblokující residualy

1. Tvrzení, že upstream `ChatResponse.digest` obsahuje, nebylo v read-only
   offline review ověřitelné. Následná operátorem autorizovaná online kontrola
   je vyvrátila: serverové `ChatResponse` jej nemá ani v `v0.33.1`, ani v
   aktuálním `main`. Tato evidence superseduje dřívější tvrzení, že stačí
   upgrade na vydaný release.
2. Role-less exact run správně fail-close zastaví migraci, ale nemá in-repo
   repair writer; žádná produkční cesta jej nevytváří a host DB migrovala.
3. Starší schema-v1 snapshot leží vedle autoritativního v2 snapshotu a může být
   chybně přečten jako současný.
4. `byte-identical` se vztahuje na hlavní DB soubor, nikoli samostatně na
   `-wal`/`-shm`.
5. Gateway bez `_bindingStartupAuthority` latentně přeskočí kontrolu; produkční
   composition root autoritu nastaví před serverem a jiný živý importer nebyl
   nalezen.
6. Harness timeout byl rozšířen z 20 s na 60 s uvnitř nezměněného 120s stropu;
   standalone reprodukce trvala 1,93 s.

## Pravdivý význam verdiktu

`REVIEW_PASSED` přijímá remediovaný source kandidát jako bezpečný k integraci.
Není důkazem funkčního durable provider runtime ani dokončeného GPU scoringu.
Provider capability proto zůstává samostatný blocker a nesmí být nahrazena
mutable `/api/tags` inventářem.
