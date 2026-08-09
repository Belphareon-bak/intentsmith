# Finding 008 — model binding neměl jeden pravdivý commit point

- **stav:** `PARTIAL_REMEDIATION` — primary application path je
  `FRESH-CLONE VERIFIED` na `e7d89b5ef038e1a32ad2fdff3990d6f9f20d9bec`;
  post-DB runtime-finalize reconciliation je implementovaný candidate a čeká
  na vlastní fresh-clone evidenci
- **závažnost:** vysoká pro M1 acceptance; runtime failover je dál vypnutý
- **vlastník:** zapisující vlastník `WP-M1-MODEL / B3-FAILOVER runtime integration`
- **termín:** před tvrzením, že B3-FAILOVER je runtime-integrated, a nejpozději
  před M1 acceptance / Gate 1 exit
- **dotčené cesty:** `src/upgrade/upgrade-manager.js`, chatový upgrade handler,
  HTTP system routes a budoucí binding application service

## Pozorovaný stav

Legacy `applyUpgrade()` a `rollbackUpgrade()` nejsou jedním durable commit
pointem. Runtime `config.models` se mění před nezávislými SQLite zápisy do
override a historie. Rollback navíc override maže, takže přeruší auditní
lineage. Při chybě mezi kroky může runtime, persistence a audit tvrdit každý
jiný stav.

Současně se `verified=1` zapisuje před skutečnou verifikací. Chatová cesta pak
uživateli hlásí „načten a ověřen“, přestože na rozdíl od HTTP cesty ani
nenaplánuje background verify. Chat navíc nepředává `onPullProgress`: cíl,
který ještě není instalovaný, na této cestě selže, zatímco HTTP cesta jej může
stáhnout. Událost `model_changed` emituje jen HTTP caller; chatová změna proto
nechá WS klienty se starým stavem.

To znamená, že nový failover repository nesmí být vydán za opravu běžného
uživatelského provozu. Dokud se oba vstupy nesjednotí, existovaly by dva
binding commit pointy s různou zárukou a legacy cesta by zůstala aktivní.

## Povinné podmínky navazujících checkpointů

Již inertní `USER_APPLY / USER_ROLLBACK` storage a repository seam musí:

1. začínat stavem neověřeno; `verified=1` nesmí vzniknout bez dokončené,
   digest-bound verifikace;
2. zapsat rollback jako nový append-only stav odkazující na konkrétní apply,
   nikdy jako `DELETE` auditované lineage;
3. atomicky commitnout event, operation journal a desired revision, nebo
   nezapsat nic;
4. výslovně uvést, že nemění runtime a neopravuje legacy
   `upgrade-manager.js`.

Runtime integrační checkpoint pak musí dodat jedinou aplikační službu pro HTTP
i chat. Durable intent se commitne před změnou runtime; runtime efekt má
recovery/kompenzační kontrakt. Stav ověření je explicitní, uživatelská zpráva
odpovídá skutečnosti a `model_changed` emituje commit vrstva, nikoli jednotlivý
caller. Focused důkaz musí zahrnout selhání mezi každou dvojicí kroků, restart,
rollback lineage, shodné chování HTTP/chat a parity instalovaného i dosud
neinstalovaného cíle včetně pravdivého pull progressu.

Dokud tyto podmínky neprojdou, nález blokuje M1 acceptance. Neomezuje inertní
measurement-only práci, která nevydává proof ani nemění DB, binding, runtime či
broadcast.

## Stav nápravy — manual storage checkpoint

Migrace 048 už plní storage část bodů 1–4: manual operation je vždy
`NOT_VERIFIED/NOT_APPLIED`, rollback přidává nový řádek s přesným odkazem na
apply, journal i audit jsou append-only a projekce bez lineage se odmítne.
Stará operation se nad novější revision nedá přehrát, manual projection nemůže
uniknout do legacy source, být smazána ani nahrazena přes `INSERT OR REPLACE` a
libovolný existující failover incident operaci fail-close odmítne do
implementace atomického supersede. Focused mutace devíti klíčových guardů
zčervenaly.

Nález zůstává otevřený. Repository zatím manual operace neprovádí, neumí
atomicky supersedovat aktivní failover incident a běžný HTTP/chat provoz dál
teče přes legacy `upgrade-manager.js`. Vlastník i termín v hlavičce se nemění.

## Stav nápravy — manual supersede schema checkpoint

Migrační identity guard z rozhodnutí 016 je implementovaný a attestovaný před
přijetím migrace 049. Samotná 049 nyní dovolí přesně auditovaný
`SUPERSEDED_BY_USER` pouze jako součást úplného operation + desired + incident
commit pointu a chrání terminální projekce proti změně nebo resurrection.
`RESTORED` se v tomto checkpointu záměrně neretireuje.

Jde o DB autoritu, nikoli o runtime integraci. Veřejný repository writer v
tomto checkpointu ještě nepřistává; legacy HTTP/chat cesty, nepravdivé
`verified=1`, chatová formulace i caller-owned broadcast proto zůstávají beze
změny a nález dál blokuje M1 acceptance.

## Stav nápravy — manual repository checkpoint

Inertní repository seam nyní plní storage podmínky 1–4 pro oba veřejné vstupy:
apply i rollback mají exact input allowlist, společnou top-level transakci,
append-only operation/reversal a atomický incident supersede. Manual stav je
stále `NOT_VERIFIED/NOT_APPLIED`; `PENDING_MANUAL` nemůže založit detection a
repository nevytváří override, runtime config ani broadcast. Failure injection
po každém durable statement i po retirementu terminální projekce vrací celý
authority snapshot.

Tím se ale neopravují V1–V4 v legacy provozu: `upgrade-manager.js` dál nemá
společný commit point, zapisuje `verified=1` před ověřením, chat stále může
tvrdit neprovedené ověření a `model_changed` emituje pouze HTTP caller. Nový
repository navíc zatím nemá runtime consumera. Finding tedy zůstává
`OPEN / ASSIGNED` se stejným vlastníkem a termínem.

## Stav nápravy — application-state schema checkpoint

Migrace 050 přidává append-only journal skutečných runtime apply, startup
rehydrate, exact-digest verification a notification výsledků. Úspěšný runtime
výsledek atomicky založí neověřený override; `verified=1` je možné zapsat až po
úspěšné probe s vlastněnou metodou a přesnou canonical name + digest identitou
aktuální runtime generace. Legacy override hodnoty migrace zachová, ale
pravdivě je demotuje na `LEGACY_UNVERIFIED`. Fixed operation journal z migrace
048 zůstává beze změny `NOT_VERIFIED/NOT_APPLIED`; aplikační stav je odvozený
z nového journalu, ne zpětně vepsaný do historického intentu.

Repository nyní atomicky zapisuje terminal outcomes a odvozuje
`PENDING`, `APPLIED_PENDING_VERIFICATION`, `VERIFIED` a `FAILED`. Opakované
runtime apply, verifikace nebo notification mimo povolený přechod končí
typovaně; startup rehydrate otevírá novou verifikační generaci a neúspěch
demotuje matching override. Legacy `applyUpgrade()` a `rollbackUpgrade()` jsou
po přítomnosti nové tabulky zablokované před provider, runtime i persistence
efektem, takže nemohou obejít novou autoritu ani vydat falešné `verified=1`.

Finding zůstává `OPEN / ASSIGNED`. Tento checkpoint záměrně ještě nepřipojuje
společnou application service, provider inventory/pull, runtime CAS a
kompenzaci, HTTP/chat handlery, startup composition ani commit-layer
`model_changed`. Tyto části vlastní navazující
[`WP-M1-BINDING-APPLICATION`](../wp/WP-M1-BINDING-APPLICATION.md).

## Stav nápravy — společný manual runtime application checkpoint

Aditivní migrace 051 a `ModelBindingApplication` nyní tvoří jedinou produkční
cestu pro manual apply a rollback. HTTP, chat i `ModelRegistry` předávají pouze
roli a cílový model; actor, request key, exact identitu, digest a auditní stav
odvozuje service. Startup už nevolá `loadPersistedOverrides()`: legacy data
obnoví kompatibilně jako `LEGACY_UNVERIFIED`, manual lineage rehydratuje přes
stejný repository/runtime port před zpřístupněním routes.

Runtime změna používá CAS token. Durable runtime outcome se zapisuje před
synchronním finalizačním krokem bez `await` či callbacku v tomto okně; při DB
selhání se runtime kompenzuje. Rollback je append-only reversal a no-op runtime
nevytváří smyšlenou historii. `verified=1` vznikne jen z následné exact-digest
Ollama probe. Pull intent je durable před provider efektem a migrace 052 drží
exact loopback origin, user actora, request key/revision/target authority,
obnovovaný pětiminutový claim s fencing revision a immutable provider outcome.
Claim je unikátní pro roli a canonical target v rámci jednoho přesného
provider originu. Alias originy ani direct pull tuto autoritu zatím nesdílejí.
Druhý Worker isolate s vlastní WAL connection živý claim nepřevezme; až
striktně po expiry může CAS získat novou fencing revision
a původní worker potom nesmí zapsat terminál. DB trigger váže úspěšný provider
výsledek na downstream binding přes shodný request key, roli, revision, actora,
canonical jméno a digest. DB-assigned command sequence a no-op frontier uzavírá
set předchozích terminálů; pending nebo neuzavřený success blokuje jiný desired
transition. Desired guard pokrývá update, delete i replace a append-only
identity guard chrání receipt i jeho causal junction před SQLite conflict
replacement. Startup sdílí jeden inventory snapshot a teprve po
listen spouští verifikace sériově. Jediným vlastníkem `model_changed` je commit
vrstva; pouze explicitní typed receipt znamená úspěšné přijetí. Produkční void
broadcaster proto pravdivě vytváří degraded stav a replay neopakuje
provider/runtime efekt.

Focused důkaz nad skutečnou SQLite, skutečným repository a skutečným
`UpgradeManager` runtime portem prošel 73/73; repository sada prošla 39/39.
Pokrývá provider journal před pullem, live/expired claim, stale fencing,
dvouconnection WAL závod, direct-SQL tamper, failure po runtime prepare, digest
drift po intentu, replay bez druhého effectu, restart i obnovu předchozího
manual override, legacy rehydrate,
rollback, sériovou verifikaci, notification receipt i shodný reálný HTTP/chat
journey. HTTP nevrací `200 started` za pomocný legacy recovery intent; čeká na
durable user-target intent nebo binding operation. Proposal post-commit failure
opraví replay bez dalšího provider/runtime effectu. Read-only status váže
provider výsledek na aktuální desired revision, takže starý
`RECONCILED_ABSENT` nevypadá jako failure novějšího installed apply.
Test-owned loopback Ollama prokazuje exact `tags → chat → tags`,
timeout, malformed/empty odpověď a digest drift. Zdrojový call-site ratchet
nenašel žádného produkčního konzumenta
`applyUpgrade()`, `rollbackUpgrade()`, `loadPersistedOverrides()` ani
`_backgroundVerify()`.

Primary backend path je fresh-clone ověřená, ale Finding 008 jako celek není
uzavřený. C2b binding hardening nově drží previous+target shared lease přes
autoritativní exact re-resolve, repository zápis, compensation a synchronní
runtime finalize; exact verification drží target přes provider probe i durable
success zápis. Tím se zavírá single-process delete/pull závod, nikoli atomický
DB/runtime commit.

Repository totiž zapisuje `APPLIED` před `runtime.commit()`. Pokud synchronní
finalize poté vyhodí výjimku, target už může být připravený v `config.models`,
zatímco runtime token, `configVersion`, in-memory upgrade history a notification
zůstanou nedokončené. Neexistuje typovaný durable `RUNTIME_UNKNOWN` incident ani
restart recovery protokol a úspěšný durable terminál nelze pravdivě přepsat na
failure. Focused test tento residual reprodukuje; nevydává jej za opravený.
Operationless legacy override se navíc dál rehydratuje pouze podle jména jako
`LEGACY_UNVERIFIED`.

Clean-clone běh na `cfcb63dd` reprodukoval 87/87 application asercí i širší
binding/gateway baterii. To potvrzuje remediovanou race hranici, nikoli chybějící
durable finalize recovery; stav findingu proto zůstává `PARTIAL_REMEDIATION`.

Další pravdivé meze: dnešní WS broadcaster nevydává delivery receipt, takže
stav zůstane degraded; current Studio tento nový status dosud nekonzumuje ani
nenabízí proveditelný rollback; neúspěšná CAS kompenzace je tvrdý in-process
recovery blocker. Vlastníkem finalize reconciliation zůstává
`WP-M1-MODEL / B3-FAILOVER runtime integration` s termínem před M1 acceptance;
Studio status/rollback surface vlastní `WP-M1-STUDIO`. Do té doby full M1/Gate
1 acceptance zůstává blokovaná.

## Stav nápravy — atomický runtime finalize recovery candidate

Aditivní migrace 054 zavádí append-only receipt pro přesný úspěšný runtime
attempt. `DIRECT_CONFIRMED` smí potvrdit pouze nejnovější runtime generaci;
`RECOVERED_BY` smí ukázat pouze na pozdější direct-confirmed
`STARTUP_REHYDRATE` stejné operace. Caller nedodává sequence, čas, druh ani
recovery seznam. Receipt nelze změnit, smazat, nahradit přes
`INSERT OR REPLACE` ani připojit k cizímu nebo neaktuálnímu desired operation.

Repository bez direct receipt odvozuje interní stav
`RUNTIME_RECONCILIATION_REQUIRED` a `runtimeFinalizeStatus: UNKNOWN`, i když
durable/runtime attempt zůstává pravdivě `APPLIED`. Verification a notification
DB fail-close odmítne, dokud nejnovější runtime generace nemá vlastní direct
receipt. Pre-054 success se mechanicky nepotvrzuje: sealed cutoff vynutí novou
exact `STARTUP_REHYDRATE` generaci. Migrace před první mutací ověří úplný
pre-054 trigger set i jeho SQL digest.

Application po durable runtime attemptu synchronně commitne přesný CAS token a
teprve potom atomicky zapíše direct receipt i veřejnou `upgrade_history`.
Proposal repair, `model_changed` a verifikace následují až za receiptem.
Výjimka před skutečným runtime přechodem se pokusí o kompenzaci; výjimka po
přechodu nebo během receipt zápisu ponechá append-only success pravdivě
`UNKNOWN`. User replay v tomto stavu neopakuje pull, runtime ani broadcast.
Operation-scoped one-shot recovery vytvoří novou startup generaci a jedním
commitem potvrdí ji i `RECOVERED_BY` lineage všech starších unknown generací.

Nový interní stav se nepropaguje jako nový veřejný enum. HTTP/chat/WS nadále
vidí kompatibilní `PENDING` / `NOT_APPLIED`; typovaný reconciliation detail je
interní diagnostika. Neautoritativní in-memory `recordUpgrade()` už nemůže po
skutečném runtime přechodu způsobit falešný commit failure.

Lokální focused důkaz je zelený a cílené mutace shazují effective-binding
predicate, historical cutoff, finalize prerequisite, application receipt,
post-commit history ochranu i veřejný compatibility mapping. Finding přesto
zůstává `PARTIAL_REMEDIATION`, dokud tento candidate neprojde fresh-clone
ověřením na commitnutém SHA. Samostatné produktové rozhodnutí navíc určí, zda
při neúspěšném exact startup recovery blokovat jen roli, ukončit server, nebo
publikovat nový degraded stav; candidate dnešní serverovou dostupnost nemění a
nepotvrzený binding za aplikovaný nevydává.
