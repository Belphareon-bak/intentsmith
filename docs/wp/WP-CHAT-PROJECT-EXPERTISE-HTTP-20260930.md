# WP — projektová expertiza v reálné HTTP konverzaci

**Stav k 30. 9. 2026:** implementační kandidát; omezené nezávislé review
`REVIEW_PASS` a integrovaný deterministický serverový běh 1/1 PASS na
`0939a564` (před dokumentačním commitem). Odpověď skutečného modelu,
release Gate 0 a širší přejímka zůstávají `NOT RUN`.

**Autorita:** explicitní zadání operátora z 2026-09-30 připravit a otestovat
chat s různými projekty a expertizami. `PRODUCT.md` vyžaduje projektové
konverzace bez úniku dat a použití expertiz. `ROADMAP.md` drží
`WP-M3-EXPERTISE` jako měřitelný vliv expertizy bez nového efektu. Tento WP
nepřidává produktové pravidlo ani nemění konektor.

**Vstup a závislost:** přesný HEAD `168e96e95d70c7cd826bcee281d5b2712ae6d979`
větve `work/real-chat-journeys-20260930`, odvozené z `origin/main`
`838b8cee038db027691072d293eb00153854f81e`. Vlastní izolovaný checkout
`/home/belphareon/Projects/intentsmith-chat-expertise-journey-20260930`,
větev `work/chat-expertise-journey-20260930`. Výsledky je nutné po sloučení
znovu ověřit na integračním SHA. Ostatní worktree jsou cizí, aktivní nebo
obsahují chráněné důkazy; tento WP je nemaže.

**Uživatelský výsledek:** uživatel vybere expertizu v konverzaci projektu A a
jinou v projektu B. Následující projektová zpráva použije odpovídající
expertizu a kontext pouze příslušného projektu. Volba přežije restart.
Odebrání volby odstraní expertizu z dalšího promptu. Zastaralá revize,
nesprávný projekt nebo odstraněná expertiza se odmítnou; deaktivovaná vybraná
expertiza nesmí potichu pustit modelový fallback.

**Vlastněné cesty:** `tests/chat-project-expertise-http.test.js`,
`docs/wp/WP-CHAT-PROJECT-EXPERTISE-HTTP-20260930.md`, pouze nová položka
`suites/IS-T3-TESTS-CHAT-PROJECT-EXPERTISE-HTTP-TEST` v `tests/registry.json`.
Generovaný `docs/convergence/TEST-REGISTRY.md` se mění pouze jako derivát
registru a integrátor jej na merge SHA přegeneruje. Žádný produkční zdroj,
model binding, běžící služba ani GPU není vlastněn tímto WP.

**Demonstrace:** test spustí skutečný `src/server.js` s odděleným HOME,
SQLite a dvěma soukromými projekty; autentizuje se port-file capability.
Jediný modelový upstream je testem vlastněný HTTP fixture na loopbacku.
Produkční trasy `POST /api/projects`, `POST /api/conversations`,
`GET/PUT /api/conversations/:id/expertises` a M1 `POST /api/chat` jsou
průchozí. Test zachytí finální `/api/chat` payload upstreamu a kontroluje
`project.id`, rozdílné README kódy bez přenosu do druhého projektu,
konkrétní pravidla vestavěných `developer`/`writer` v `expertiseGuidance`
včetně absence pravidla druhé expertizy a odpovídající ID v odpovědi. Čte přesné revize
před a po restartu serveru. Poté kontroluje prázdný prompt po odebrání,
stále platný projekt B a M3 install/enable/select/disable/delete. Negativní
větve zkouší stale `expectedRevision`, nesprávné `projectId`, vybranou
deaktivovanou expertizu bez provider requestu a opakovaný výběr odstraněné
expertizy.

```sh
export PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:$PATH
KEEP_TEST_RUNTIME=1 INTENTSMITH_TEST_SOURCE_REVISION=$(git rev-parse HEAD) \
  node --test tests/chat-project-expertise-http.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

Na referenčním hostu je systémový Node 22 nekompatibilní s nainstalovaným
`better-sqlite3` pro Node 24; stejný příkaz pod Node 22 skončí před startem
serveru chybou `ERR_DLOPEN_FAILED` a není produktovým selháním.

Pro auditní běh musí runner předat privátní sandbox a
`INTENTSMITH_TEST_SOURCE_REVISION`. Přímý běh s `KEEP_TEST_RUNTIME=1` zachová
privátní JSON artefakt i izolovanou DB pod `.intentsmith-artifacts/direct-tests/`;
bez přepínače se celý přímý sandbox při PASS smaže a revize se bez uvedené
proměnné označí `direct-run-unattested`. `run-suites.js` spouští navíc vlastní
server a pro tento test není zvoleným focused příkazem.

**Hranice důkazu a stop condition:** fixture dokazuje vstup do finálního
provider requestu, projektové oddělení v tomto průchodu, trvanlivost SQLite
a fail-closed negativní větve. Fixture nevyrábí odpověď skutečného modelu a
neměří behaviorální vliv expertizy, kvalitu odpovědi, Studio UI ani GPU.
M3 fixture ověřuje pravidlo v `modules.domain_rules` po merge; samostatná
interpretace pole `systemPrompt` manifestu tím není ověřena.
Registrované modelové sady `IS-T3-E2E-54-CHAT-WITH-EXPERTISE` a
`IS-T3-E2E-75-EXPERTISE-BEHAVIORAL` zůstávají `BLOCKED` s `lastGreen=null`;
jejich skutečný modelový běh vyžaduje samostatně rezervovaný GPU slot a
vhodnou modelovou přejímku.
Z focused PASS se nepřepisuje jejich stav ani `lastGreen` nového testu.
Nezávislé review i integrovaný běh jsou doloženy pouze v uvedeném omezeném
rozsahu; modelový a release důkaz zůstávají zvláštními kroky před přejímkou.
