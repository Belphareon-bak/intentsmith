# Finding 008 — model binding nemá jeden pravdivý commit point

- **stav:** `OPEN / ASSIGNED`
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
