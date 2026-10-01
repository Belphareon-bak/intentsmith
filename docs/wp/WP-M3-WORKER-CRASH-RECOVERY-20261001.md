# WP — M3 worker: přerušení po zápisu notifikace

**Aktuální integrační ověření 1. 10. 2026, 09:18 UTC:** na čistém
`de4b779c7939b968c9c76ebd5a2b5d283bd9e04f` prošly registrované crash/recovery
journey a lokální code review specialist **2/2 PASS**, report
`.intentsmith-artifacts/test-runs/2026-10-01T09-18-24-929Z/report.json`.
Skutečný soukromý HTTP/SQLite crash běh ověřil přerušený terminál, jedinou
notifikaci po restartu a nula modelových volání. Produkční nasazení a
instalované UI zůstávají samostatné přejímky.

**Následný stav 1. 10. 2026:** čistý pushnutý kandidát `7373b44c` získal
nezávislé omezené `REVIEW_PASS` pro DB lifecycle, durable effect key a
skutečnou HTTP/SQLite crash/replay cestu. Registrované sady na této větvi
prošly **8/8** v reportu
`.intentsmith-artifacts/run-suites/2026-09-30T23-56-43-739Z/report.json`.
Integrace do společného zdroje a opakování tam jsou samostatné brány.

**Historický stav původního kandidáta:** implementační kandidát, `REVIEW_PENDING`, nenasazený. Přímé i první
registrované lokální testy jsou zelené; nezávislé DB lifecycle review a
produkční přejímka zůstávají otevřené.

**Autorita:** explicitní zadání operátora z 2026-10-01 doplnit a otestovat
skutečné worker journey; `PRODUCT.md` vyžaduje agent E2E a in-app notifikaci
pro 1.0, `CONTRACT.md` §4 a §6 požadují pozorované chování a recovery test.
Navazuje na integrovaný plánovaný produktový průchod
`WP-CHAT-WORKER-JOURNEY-20260930` / `IS-T3-TESTS-M3-AGENT-SCHEDULED-PRODUCT-JOURNEY-TEST`.

## Hranice a požadované chování

Vlastní testovací `src/server.js` a soukromá SQLite nainstalují důvěryhodný
Project Health extension s pětiminutovým intervalem. Po baseline vznikne nová
projektová revize. Testovací preload zastaví **jen tento produktový child**
pomocí `SIGSTOP` po návratu originálního
`AgentRepository.createNotification()`, tedy po potvrzeném SQLite INSERT
notifikace a před zápisem stavu akce či terminálu runu. Rodič po ověření
markeru pošle child procesu `SIGKILL`; nový `src/server.js` otevře stejnou
soukromou DB. Pozorovaný produkt musí:

1. zachovat původní notifikaci s přesnou projektovou revizí;
2. zapsat pro zabitý run explicitní `interrupted` / `ERROR_INTERRUPTED` a
   `finished_at`, s přiznaným neznámým výsledkem rozpracované akce;
3. nezaložit druhou notifikaci pro stejný agent, akci, projekt a revizi,
   i když scheduler znovu vyhodnotí trigger;
4. neterminalizovat run, jehož proces je stále živý (včetně `SIGSTOP`), a
   nedohadovat výsledek historických runů bez identity vlastníka;
5. nepovolat model ani externí síť.

## Red evidence a zamýšlené řešení

Na čistém `63dc55fb` přímý produktový běh zčervenal: marker
`pid=2500737`, `runId=2`, `notificationId=1`. Po zabití zůstal run 2
`running` bez `finished_at` a `explain`; po restartu run 3 skončil
`SUCCESS_TRIGGERED` a druhá notifikace měla stejný
`workspaceRevision=wsr1:30e9afe8ebc26172e213c5b1eac2395fa00c68dae40dff5514326296fad7b0c3`.
`modelCalls=0`. Syrový výstup z vlastněného testu je lokálně v ignorovaném
`.intentsmith-artifacts/direct-tests/m3-agent-crash-recovery-product-journey.test-QxHJUR/artifacts/m3-agent-crash-recovery-diagnostic.json`.

Oprava ukládá PID a Linux `/proc` birth time k novému runu. Scheduler při startu
označí za přerušené jen běhy, jejichž zaznamenaný proces prokazatelně zanikl
nebo má jiné birth time. Při nedostupném důkazu ponechá `running` beze změny.
In-app ProjectContext notifikace dostává stabilní klíč z extension, pořadí
akce, triggeru, projektu a workspace revision; SQLite unikátní index rozhodne
atomicky při replay. Schéma se rozšíří idempotentně i nad staršími tabulkami.

**Vlastněné cesty:** `src/agents/{repository,runner,scheduler,agents.html}`,
`tests/m3-agent-crash-recovery-product-journey.test.js`, úzký testovací preload
v `tests/helpers/`, volba preloaderu ve sdíleném testovacím launcheru,
`tests/registry.json`, generovaný `docs/convergence/TEST-REGISTRY.md`, tento WP.
Instalovaná DB, GPU, hunt a cizí worktrees nejsou součástí změny.

**Přetrvávající hranice:** historické `running` runy bez identity procesu
zůstávají `UNKNOWN`; bez Linux `/proc` se recovery neprohlašuje za prokázané.
Klíč se uplatní na lokální in-app ProjectContext revize, ne na externí
notifikační kanály, které nejsou v 1.0. Běh na zdrojovém commitu a review
nejsou release Gate 0, produkční nasazení ani fyzická Studio zkouška.

## Lokální red → green kontrola

Po opravě přímý test na vlastní DB a HTTP **2/2 PASS**. Marker byl
`pid=2506684`, `runId=2`, `notificationId=1`; před restartem `run 2=running`
bez terminálu. Po restartu `run 2=interrupted/ERROR_INTERRUPTED`,
`finished_at` vyplněno; `run 3=SUCCESS_TRIGGERED`; v DB zůstává **jedna**
notifikace s `run_id=2`, `modelCalls=0`. Zachované surové evidence jsou v
`.intentsmith-artifacts/direct-tests/m3-agent-crash-recovery-product-journey.test-BFrhmY/artifacts/m3-agent-crash-recovery-diagnostic.json`.
Nový další test pokrývá idempotentní rozšíření starého schématu, zachování
živého i historického neprokazatelného ownera, PID reuse a novou revizi.

Sousední přímé sady: `agent-runner` **22/22**, `m3-project-health-agent`
**10/10**, `m7-notification-core-adapters` **8/8**, plánovaný produktový
průchod **1/1**, ruční produktový průchod **1/1** a module-boundary ratchet
**13/13**. Všechny běžely na necommitnutém kandidátu, proto samy nejsou
přejímkou ani release důkazem. Registry validátor po registraci nové sady:
**577** programů, SHA-256
`999c3ee7714c9e90d868584bd4c7053e29e5e91963b9e606308c16e5b7c5721a`.

Čistý candidate commit `756af74bbc80aaf57468ece18d8c113e8cf42f08`
prošel registrovaně **5/5** (nový crash produktový scénář, plánovaný a ruční
produktový průchod, agent runner, artifact validation), report
`.intentsmith-artifacts/run-suites/2026-09-30T23-55-12-860Z/report.json`.
Navazující M3 durable/Project Health a M7 notification sady prošly
registrovaně **3/3**, report
`.intentsmith-artifacts/run-suites/2026-09-30T23-55-34-542Z/report.json`.
Oba reporty mají `gateEvidence:false`; nejsou release pečeť.
