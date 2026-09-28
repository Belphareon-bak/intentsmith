# Použitelný Studio builder a pravdivá CODE evidence — review

Stav: **IMPLEMENTATION_AND_SCOPED_RUNTIME_VERIFIED / DELTA_REVIEW_REQUIRED /
PHYSICAL_MODEL_JOURNEY_UNPROVEN / ACCEPTANCE_BLOCKED**.

Uživatel nyní zadá řízenou změnu ve Studiu formulářem: cíl, explicitní soubory,
závislosti a funkční test. Dostane celý návrh a ovládání schválení, stavu či
zrušení. Současně jsou opravené tři cesty, které mohly označit výsledek CODE
za aktuální, přestože vznikl pod jiným hodnotitelem nebo runtime.

## Přesný rozsah

**`e87b1ca2219fe330a05c73443a340983ff5410ea..a10e3e0d3c429e2735205fba2019bebb43a56c34`**.
Tento rozsah navazuje na operátorem dodané
[review bez blockeru na e87](2026-09-12-WEB-BUILDER-OPERATOR-REVIEW.md).
Web není znovu skrytý před review: jeho celý zaváděcí rozsah je v předchozím
packetu a dodaném výsledku. Zde se v transportu mění jen komentář u ipaddr.js.

```bash
git diff --stat e87b1ca2..a10e3e0d
git diff e87b1ca2..a10e3e0d -- \
  c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js \
  src/chat/handlers/build-handoff.js src/eval src/network/conversation-web-transport.js
git diff e87b1ca2..a10e3e0d -- \
  tests scripts/studio-cdp-evidence.js scripts/nightly-orchestrator.js \
  contracts/m6/candidate-plan-v1.js
```

Následný dokumentační commit doplňuje výsledky a opravuje příklad policy a
použití JSON příkazu v `docs/PROJECT-BUILD.md`. Finální commit a hashe předání
jsou v `.intentsmith-artifacts/build-composer-review-20260912/handoff.json`.

## Co zkontrolovat

1. **Studio a approval.** Formulář posílá existující `/api/m2/lifecycle/draft`;
   nezakládá policy, adresáře ani novou autoritu. Model dál dodává pouze obsah.
   Argv je pole doslovných argumentů, nikoli shellový příkaz. Origin se připne
   při otevření a kontroluje před/po HTTP. Chyba zachová zadání. Pending binding
   po restartu sám nezapne approval; plán se musí znovu načíst a zobrazit.
   Callback starého tlačítka zachytí svůj lifecycle/digest/origin a nemůže
   schválit mezitím zobrazený jiný plán. Active M1 i připravené odesílání
   blokují draft/status/approval na tlačítku i v handleru; cancel zůstává použitelný.
   Povinné okolí: lifecycle routes/service, proposal compiler, project-change
   planner/runtime a příslušné M2 kontrakty. Jejich execution autorita se nemění.
2. **CODE reuse.** `role-evaluation-plan.js` vkládá do CODE kontraktu SHA256
   sedmi konkrétních souborů včetně graderu, helperů, orchestrace a kořenového
   lockfile, plus Node verzi. Produkční factory nepřijímá override těchto hashů;
   chybějící bytes blokují vytvoření aktuálního kontraktu. Ostatních šest rolí
   zachovává svůj hash. Staré COMPLETE řádky zůstávají dohledatelné svým původním
   kontraktem, ale nejsou měřením změněného hodnotitele. Povinné okolí:
   `model-evaluation-history.js`, read model a všichni konzumenti role plans.
3. **Dva navazující bypassy CODE.** Historický panel import měl jen agregované
   means/task names, přesto je označoval dnešním kontraktem a artefaktem.
   `import-code-panel-history.js` nyní skončí s
   `CODE_PANEL_HISTORY_PROVENANCE_REQUIRED` před jakýmkoli importem DB/provideru.
   Diagnostická kalibrace a uložená historie zůstávají. Je to záměrné odmítnutí
   neprokazatelného importu, ne nový importní protokol. Parser i test používají
   `process.execPath`; unshare předává executable/test jako doslovné shellové
   parametry a také privátní DB env. Regrese s cizím `node` na PATH a názvem
   obsahujícím shellové znaky prošla. Fallback na systemd zůstává možný;
   jediný PASS nedokládá zvlášť obě větve izolace.
4. **Důkazní hranice.** HTTP fixture používá skutečné routes/service, Git,
   bwrap a SQLite, ale řízený model/auth/registry. Restart opravdu mění PID
   nad stejnou DB; vadný první peer vyvolá rollback celé dávky. Native DOM má
   samostatný program a evidence type, přesně jeden očekávaný 503 a žádné
   schválení/model. M0/M1 policy dál odmítají tento 503. Nový DOM program patří
   do existing fresh-clone M6 runneru, nikoli do model-without-server; omission
   sentinel to vynucuje. Registry seal je aktualizován bez změny kterékoli
   z 515 původních položek nebo deterministického required setu.
5. **Fixture setup a návod.** Tool broker obaluje pouze osm setup migrací
   transakcí, cizí klíče zapne před ní a všechny testované durable operace
   probíhají až po commitu. Limit zůstává 30 s. Návod rozlišuje formulář,
   pokročilý JSON, existující policy/adresáře/Git/test a neobnovitelné rozepsané
   pole po restartu. Opravený příklad policy prochází produkčním validátorem.

## Důkazy

**353/353 deterministic na a10e3e0d**, **75 + 7 HTTP na stejném source**,
**Studio build a 3/3 nativní Electron na 9462ec0b** s nezměněnými produktovými
a probe bytes. Dva HTTP procesové restarty pokrývají success i rollback.
Přesné raw cesty, hashe, dílčí počty, příkazy a zachované chyby jsou v
[run recordu](../execution/runs/build-composer-completion-20260912.md).

Read-only spolupracující kontroly našly a následně potvrdily opravy active-send,
starého approval callbacku, historického importu a výběru Node runtime.
Samostatný follow-up prověřil setup migrace i registry/M6 zapojení na a10e3e0d.
Tyto kontroly nejsou přejmenované na nezávislé Opus review ani release acceptance.

## Co ještě chybí k dokončení

| Podmínka | Konkrétní další práce |
|---|---|
| Společný candidate s huntem | Integrovat připnutou dokončenou hunt větev. Preflight e87 proti 3b0dcdfb našel 9 textových konfliktů, sémantickou kolizi migrace 111 a dvojí Decision 044. Nová volná migrace musí mít přesnou adopci původní web identity se zachováním `applied_at`; ověřit fresh DB a upgrade obou linií, nikoli jen počet migrací. Podrobná matice je v archivovaném `integration-preflight-20260912/REPORT.md`. |
| Aktuální modelová evidence | Po sjednocení hodnotitele znovu změřit CODE přesný artefakt/provider. Staré výsledky huntu se nesmějí vydávat za měření nového kontraktu. Lock hash dokládá předepsané dependencies, nikoli sám integritu nainstalovaných node_modules. |
| Skutečný uživatelský build | Jeden spojený Studio → production server → durable binding → fyzický model → preview → approval → funkční test → nový proces. Dosavadní samostatné vrstvy ho nenahrazují. |
| Dokončení projektové práce | Běžný free-text SPEC→BUILD stále předává řízení M2. Formulář odstranil ruční JSON, ale automatický návrh celého projektu, přípravu adresářů a širší plánování neimplementoval. Pokračovat přes schválené M2 návrhy a otestovat skutečně použitelnou aplikaci. |
| Release acceptance | Review této delty, sjednocený kandidát a příslušné fresh-install/upgrade/runtime důkazy, M5 podepsané history/category receipts, skutečná druhá záloha operátorských klíčů, podpisový řetězec a operátorská demonstrace. Tvrzení „nepoužity skutečné přístupy“ už je zapsané jako podklad pro N/A rotace; není potřeba znovu požadovat seznam neexistujících klíčů. |

Při posledním read-only pozorování 09:38 UTC byl hunt checkout čistý na
`3f3a22203b51905a6bf834cb39f5e7f76b2306f2` a oba hunt procesy dál běžely.
Preflight nad starším 3b není tvrzení o integraci novějšího tipu. Žádný cizí
proces, checkout ani GPU nebyl změněn. Post-release learning, rozsáhlá Code
Intelligence a úplné agentské funkce zůstávají ve svých dohodnutých kontraktech.
