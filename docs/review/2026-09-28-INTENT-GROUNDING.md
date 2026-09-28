# IntentSmith: obecné ověření interpretace — k revizi

**IMPLEMENTED / REVIEW_PENDING / NOT_DEPLOYED.**

Větev: `work/intent-resilience-20260928`; kandidát `f167cf980c597c90d24d88edb8f8effe4a506bef`. Obecná oprava: `fff2811397ae700b351032f64ddbe849b7fd917d..f167cf98`; celý vlastní kandidát: `2572fe0504f53385628ea043d37f8cb207af4e74..f167cf98`. Běžící produkce zůstává na `72247a4983abcb12d42f6da6cc5b27af8f2212fd`. Tento report nahrazuje závěr o rozsahu GPU guardu v `docs/wp/WP-INTENT-RESILIENCE-20260928.md`; staré měření zůstává historickým důkazem. Autorita změny je výslovný požadavek operátora. Nejde o nezávislé review ani release acceptance.

## Co je opraveno

Původní řešení bylo úzké. Nová kontrola není postavená na GPU slovníku: klasifikátor vrací strukturovanou interpretaci s přesnými citáty vstupu a alternativami významu. Core ověří citace, shodu hodnot a pokrytí rozpoznatelných čísel, cest, adresátů a zákazů. Materiální změna nebo chybějící interpretace vrací ASK_USER před všemi režimovými handlery. Tolerance překlepů je klasifikace zachovaného vstupu; edit distance nesmí změnit sloveso, jednotku nebo název souboru.

Původní uživatelský text zůstává v historii. Obecné „ano“ neřeší nevybranou alternativu. Výslovná volba vytvoří vstup obsahující původní text i doslovné upřesnění; neprovádí tiché nahrazení. Text přílohy se nepočítá jako původní uživatelské oprávnění. CRE používá stejné ověřené rozhodnutí bez druhého volání klasifikátoru.

ToolExecutor před první operací ověří celou dávku i konkrétní parametry před brokerem. Ověřené údaje mají neprůhledný core token a digest zdroje, ne modelově podvrhnutelný JSON. Nesoulad názvu/case souboru, hodnoty nebo operace je terminální `M2_TOOL_INTENT_MISMATCH`; neotevře retry ani modelový fallback. Konstanta `.` pro výpis aktivního projektu má úzkou core vazbu přes již existující deterministický parser a stále podléhá M2 projektové autoritě. Existující přesné schválení efektu se nezměnilo.

Neproveditelná akce nemůže spadnout do běžné konverzační odpovědi s vymyšleným „hotovo“. Shell handler nyní pravdivě uvádí, že příkaz nespustil.

## Reprodukce a důkaz

Před opravou řízený klasifikátor pro `Ulož odpověď do notes.md` navrhl `wrong.md`. Produkční CRE emitovalo LOCAL/file.write s cílem `wrong.md`, přestože uživatel tento cíl nezadal. Sonda neprovedla zápis ani skutečnou inferenci. Po opravě stejné zadání/návrh vede k ASK_USER. Stejný kontrolní mechanismus má negativní případy pro napětí/příkon, port 8080/80, mW/MW, notes.md/Notes.md, změnu emailového adresáta, zákaz akce a zapni/vypni.

Testy zahrnují skutečný ChatController, původní classifier/JSON bridge s řízenou odpovědí, skutečnou owned loopback HTTP routu a validátor M1, trvalé uživatelské tahy, pending clarification i ToolExecutor s broker spy. Chybná pozdější operace v dávce zastaví i první operaci. Platný parametr přejde do původního brokeru. Tyto testy dokazují vynucení kontroly při daném výstupu klasifikátoru, nikoli schopnost konkrétního modelu vždy najít chybu.

## Hranice pro revizi

- **Real model quality / latency: NOT_RUN.** Sdílenou GPU používá jiné hodnocení. Řízená zkouška kvality konkrétního modelu nebyla provedena. Neplánované volání živého poskytovatele během prvního auditu je popsáno samostatně níže. GPU setting, live DB write, restart, merge nebo deploy nebyly provedeny.
- Úplnost citovaných slotů a rozpoznání věcné nejasnosti stále závisí na klasifikátoru. Syntaktický validator nerozumí celé fyzice nebo všem jazykům a nemůže odhalit každou chybně navrženou, ale doslovně citovanou interpretaci.
- Při zákazu nebo nejasné části je zastaven celý tah; nezávislé části se samostatně neplánují.
- Parametry se vážou přes konkrétní material fields; generovaný obsah/kód a obohacené vyhledávací dotazy mají nadále původní M2 autoritu. Core token je dodatečné ověření přirozeného chatového vstupu, nikoli náhrada capability/approval kontraktu ani trvalá M2 evidence. Přímí typovaní volající bez tokenu používají existující M2 autoritu.
- Neplatný classifier JSON vrací otázku. Prázdný výsledek nebo výpadek poskytovatele zůstává LLM_PROVIDER_UNAVAILABLE, neúplný modelový výsledek MODEL_RESPONSE_TRUNCATED. Zrušení během klasifikace brání vstupu do handleru. To může přidat otázky a klasifikaci i do dříve deterministických konverzačních toků. Počet a latence na skutečných modelech nejsou změřené. Budget klasifikace je 768 output tokens; samostatný FAST kontext 4096, sdílený CHAT zachovává vlastní kontext.
- Testové fixtury pro M1 terminal failures, M2 project-context consumer, privacy a WS bridge nyní poskytují validní řízenou interpretaci, aby nadále ověřovaly skutečnou cílovou hranici. Assertions nebyly vypnuty.

## Doporučená revize

1. Ověřit source binding od `ChatController.process()` přes `inspectRequest()` a CRE reuse do `ToolExecutor`; projít i metadata a finální M1 serializaci.
2. Spustit dva intent-clarity testy, M1 chat contract, M2 tool production consumer a privacy regression v izolaci.
3. Na uvolněné GPU změřit reálný korpus chybných i správných zadání, falešné otázky, věcnou nejasnost a cenu nového JSON. Doplnit další podporované efektové rodiny podle výsledků.
4. Posoudit zachování negace, práci s více akcemi a použití kontextově odvozených cílů. Rozhodnutí o přijetí či nasazení zůstává operátorovi; tento balík ho nepředjímá.

## Incident při ověřování

První úplný audit `2026-09-28T06-17-57-396Z` na `bb516398fa29c1442af38a622b9c9dd4e18c8175` skončil **371 PASS / 14 FAIL / 13 BLOCKED / 0 TIMEOUT**, exit 1. Dvě nové chyby byly skutečné regrese: serverový provider outage se změnil na ASK_USER; WS suite neměla klasifikátor izolovaný a přibyla race při zrušení během nového async kroku. Tyto chyby byly opraveny, nikoli překlasifikovány na PASS. Server 15/15 a WS 91/91 následně prošly s izolovaným providerem.

Předchozí příkaz nastavil `OLLAMA_URL=invalid://...` na audit parent, ale audit jej pro offline child nepředal. WS fixture po novém preflightu proto neplánovaně volala skutečný endpoint na 11434. V servisním journalu v intervalu **06:23:10–06:24:34 UTC / 08:23:10–08:24:34 Europe/Prague** je načtení runneru/modelu, čtyři POST /api/chat s 200 a jeden s 500. Bez korelačních request IDs nelze každou položku připsat konkrétnímu volajícímu, ale testový log potvrzuje pokusy o klasifikaci a timeouty. Nelze tvrdit nulovou inferenci nebo nulové ovlivnění souběžné GPU úlohy. Dopad na její posudky je **UNVERIFIED**; jejich vlastník musí ověřit časový překryv, přesnou identitu modelu a měřicí receipts.

Výpis journalu je uložen v `.intentsmith-artifacts/intent-baseline/unplanned-provider-access.log`, SHA-256 `00f210dcbabd1eac0e8dcb8775021f6b5b978392fec9ad9e977f42eddd86b27e`. Test skončil; cizí procesy, receipts, GPU limity ani živá DB nebyly upraveny. Opravená WS fixture poskytuje řízenou interpretaci a nastavuje invalidní provider přímo v konfiguraci testu, takže ji chrání i při odfiltrování parent env. Tento incident není důkazem kvality modelu ani schválení zásahu do společného prostředí.

## Konečné ověření

Node 24.21.0 / npm 10.9.4, čistý commit `f167cf980c597c90d24d88edb8f8effe4a506bef`. Audit `2026-09-28T06-29-01-063Z`: **373 PASS / 12 FAIL / 13 BLOCKED / 0 TIMEOUT**, exit 1, celkový gate **FAIL**. Přesné ne-PASS paths/stavy/blockery jsou shodné s původním auditem `b39c79fb`, nikoli novými regresními chybami. Report `.intentsmith-artifacts/test-runs/2026-09-28T06-29-01-063Z/report.json` má SHA-256 `9a75017c5e2e77d395ec90c7c222ee49a4ab3d409a1e584f26efc4b09c84e9db`. Report nebyl přepsán ani připnut k pozdějšímu dokumentačnímu commitu.

Samostatný skutečný HTTP journey na stejném `f167cf98`: PASS, `.intentsmith-artifacts/intent-baseline/general-final-http-f167cf98.log`. V audit profilu jsou M1 chat 33/33, M2 tool production consumer 22/22, M2 project context consumer 15/15, privacy 11/11, WS 91/91, CRE build 35/35, artifact validation 160/160 a module boundary 13/13 PASS. Obecný intent test ověřuje i skutečný JSON bridge s jedním řízeným modelovým voláním, změněné parametry před brokerem, negaci a terminal errors. Registry validace PASS: 565 programů, SHA-256 `508b5333c57dd59a96af282efc3ea46aec7f3635201ca943a7f22bbd08aff0a1`. Module graph: 1457 hran, stále 3 cykly / 28 členů; tři přesné nové vazby mají oddělené baseline commity. `git diff --check`: PASS.

### Zachované ne-PASS

Jeden FAIL je neplatná historická Gate 0 registry pečeť (`nightly-orchestrator-self-test`); jedenáct jsou chybějící IDE dependency instalace v tomto worktree (`@theia/core/shared/markdown-it`, `react`, `@intentsmith/chat-panel/lib/browser/work-activity`). Třináct BLOCKED jsou nepřipnuté testové toolchain prerequisites, nikoli tvrzení, že dané programy na hostu chybí. Žádný required gate nebyl vypnut, přesunut do model profilu nebo vyňat ze seznamu.

| Path | Stav | Blocker |
| --- | --- | --- |
| `tests/accountant-workflow-integration.test.js` | BLOCKED | toolchain:accountant-ocr-runtime; toolchain:python-pdf-runtime |
| `tests/chat-export-budget.test.js` | BLOCKED | toolchain:python-pdf-runtime |
| `tests/desktop-hunt.test.js` | BLOCKED | toolchain:systemd-analyze |
| `tests/development-installation.test.js` | BLOCKED | toolchain:bwrap; toolchain:prlimit; toolchain:python3; toolchain:tar |
| `tests/export-pdf-docx.test.js` | BLOCKED | toolchain:python-pdf-runtime |
| `tests/m1-studio-client.test.js` | FAIL | viz přesný suite log v audit reportu |
| `tests/m2-execution-git-preservation.test.js` | BLOCKED | toolchain:git |
| `tests/m2-execution-process-supervision.test.js` | BLOCKED | toolchain:bwrap |
| `tests/m2-execution-project-change.test.js` | BLOCKED | toolchain:bwrap; toolchain:git |
| `tests/m2-lifecycle-application-service.test.js` | BLOCKED | toolchain:bwrap; toolchain:git |
| `tests/m2-lifecycle-studio-surface.test.js` | FAIL | viz přesný suite log v audit reportu |
| `tests/m5-process-hardening.test.js` | BLOCKED | toolchain:bubblewrap; toolchain:prlimit |
| `tests/nightly-orchestrator-self-test.js` | FAIL | viz přesný suite log v audit reportu |
| `tests/scm-studio.test.js` | BLOCKED | toolchain:git |
| `tests/studio2-conversation-view.test.js` | FAIL | viz přesný suite log v audit reportu |
| `tests/studio2-expertise-selection.test.js` | FAIL | viz přesný suite log v audit reportu |
| `tests/studio2-live-model.test.js` | FAIL | viz přesný suite log v audit reportu |
| `tests/studio2-m2.test.js` | FAIL | viz přesný suite log v audit reportu |
| `tests/studio2-media-input.test.js` | FAIL | viz přesný suite log v audit reportu |
| `tests/studio2-session-store.test.js` | FAIL | viz přesný suite log v audit reportu |
| `tests/studio2-transport.test.js` | FAIL | viz přesný suite log v audit reportu |
| `tests/studio2-view.test.js` | FAIL | viz přesný suite log v audit reportu |
| `tests/studio2-workspace-files.test.js` | FAIL | viz přesný suite log v audit reportu |
| `tests/workspace-budget.test.js` | BLOCKED | toolchain:git |
| `tests/workspace-tree-project-id.test.js` | BLOCKED | toolchain:git |

### Příkazy k revizi

```sh
git diff fff28113..f167cf98 -- src/chat src/executor tests
git diff 2572fe05..f167cf98 --stat
source /home/belphareon/.nvm/nvm.sh
nvm use 24.21.0
OLLAMA_URL=invalid://intent-review-no-provider node tests/chat-intent-clarity.test.js
OLLAMA_URL=invalid://intent-review-no-provider node tests/chat-intent-clarity-http.test.js
OLLAMA_URL=invalid://intent-review-no-provider node tests/m1-chat-contract.test.js
OLLAMA_URL=invalid://intent-review-no-provider node tests/m2-tool-production-consumer.test.js
OLLAMA_URL=invalid://intent-review-no-provider node tests/chat-memory-privacy.test.js
node tests/module-boundary-ratchet.test.js
npm run test:registry
git diff --check
```

Před skutečným měřením modelů je nutná prázdná sdílená inference fronta, ověřená GPU ownership a změřený korpus správných i chybných vstupů. Samotný prompt lze dále zlepšovat; pro účinky v dalších doménách je navíc třeba doplnit vazbu jejich typovaných parametrů a příslušné hodnotové/rozměrové validátory. Tento kandidát neposkytuje univerzální záruku správného úsudku modelu.
