# Studio 2.0 — vizuální vrstva a předávka integrace

Stav: pracovní poznámka k [WP-STUDIO-2](../wp/WP-STUDIO-2-20260925.md), 2026-09-25.
Nezakládá nový požadavek; požadavky jsou v [UI-SPEC](UI-SPEC.md), [SCM](SCM.md)
a [CONNECTORS](CONNECTORS.md). Popisuje, jak je vzhled Studia 2 postavený a kde
se na něj napojuje backend.

## Aktualizace 28. 9. — převzatá práce po limitu vizuálního workera

Horní záložky relací jsou odstraněné v prototypu i generovaném Reactu.
`SessionStore` drží otevřené relace, rozložení a pořadí použití; `LiveModel`
napojuje levý seznam, Ctrl+klik, výběr ve sloupci a × na tento jediný stav.
Nová relace vzniká vedle; šestá může ukončit jen bezpečnou relaci skrytou už
před otevřením. Kontrola chrání M1, M2, terminál, editor, rozepsanou zprávu,
přílohy i neurčitý výsledek odeslání. Konverzace se z databáze nemaže.
Starší snapshot s více než pěti relacemi se zmenší jen o bezpečné skryté relace;
pokud všechny chrání neurčitý výsledek nebo schválení, zachová je a zablokuje
otevření dalších do jejich bezpečného vyřešení.

Interní události z `work-activity.js` se v chatu sloučí do fází z prototypu;
skutečné nástroje a chyby zůstávají viditelné. Trvání se počítá z klientských
časů událostí, úplný seznam zůstává v Průběhu. Kopírování celé Markdown
odpovědi používá stav úspěchu/chyby prototypu. Výchozí název relace se po první
zprávě aktualizuje i v hlavičce a levé navigaci.

Předané integrační nálezy jsou opravené: i blokované otevření spustí časovač
hlášení; kontrola příloh patří do přípravy kontextu; hlášení zavření používá
název z živého pohledu. Hotová odpověď bez konce aktivity použije čas zprávy
nebo poslední události, nikoli aktuální čas. Opakované interní události tvoří
nejvýš čtyři fáze. „Nedávné“ čtou skutečný katalog konverzací a uchovávají
identitu ukončené konverzace; zavření i automatické uvolnění obnoví katalog.
Specifikace §5 a implementace shodně chrání relace viditelné před otevřením.

## 1. Co je hotové

- **Vzhled = prototyp.** Rozšíření `intentsmith-studio2` vykresluje přímo šablonu
  a styly klikacího prototypu ([`prototype/`](prototype/)). Nic se nepřekresluje
  ručně, takže vzhled odpovídá předloze z principu, ne podle oka.
- **Body 1–3 zadání z 25. 9.** jsou v prototypu i v IDE:
  1. výběr relace ve sloupci — klik na název v hlavičce sloupce; výběr ukáže všechny
     otevřené relace (číslo, stav, kde jsou), volba relace z jiného sloupce sloupce
     **vymění**, dole „Nová relace v tomto sloupci" (UI-SPEC §6);
  2. **Soubory** v pravém panelu — Upravené v relaci (navrženo / zapsáno / uloženo
     ručně), Otevřené (četl agent, otevřel jsi, příloha), strom projektu se sbalováním;
     klik otevře soubor v panelu: Náhled / Změny (diff) / Upravit, stráž neuložených
     změn (Zpět k úpravám / Zahodit / Uložit), rozšíření panelu (UI-SPEC §7);
  3. **Správa zdrojů** — větev s hledáním a „Nová větev…", synchronizace ↓/↑, fetch,
     zpráva commitu, Potvrdit s nabídkou (commit a push, potvrdit vše), skupiny
     Konflikty / Připravené / Změny / Nesledované s připravením a diffem, historie
     s grafem větví; každá akce s efektem ukáže **plán** a čeká na potvrzení, blokace
     podle politiky (špinavý strom, rozcházející se historie, zakázaný fetch, běžící
     agent); výsledek se zapíše do Auditu relace. Detail projektu má záložku
     Správa zdrojů s politikou gitu (SCM §2, §5).
- Navíc proti prototypu 25. 9. (vizuální části parity UI-SPEC §6, §13): vstupní řádek
  terminálu relace s doplněním Tab, fronta příloh ve skladateli a přílohy u zprávy,
  klávesové zkratky z nabídek (Ctrl+K, Ctrl+B, Ctrl+J, Ctrl+Alt+B, Ctrl+T, Ctrl+,,
  Alt+1…9, Alt+Shift+1…3, Esc).
- Opravy: text na zlatých tlačítkách měl kontrast pod 4,5:1 (`.ide button{color:inherit}`
  přebíjelo `.btn-acc`); pod widgetem zůstával 35px pruh po skryté liště záložek Theie
  (`mainPanel.fit()` po skrytí).

**Stav integrace v tomto worktree (25. 9.):** `LiveModel` už nahrazuje ukázkové
relace, zprávy a katalogy skutečnými daty. Odeslání zprávy, terminál, přílohy,
M2 schválení, projektový strom, editor s ověřeným uložením, detail projektu,
aktivace specialisty, audit konverzace a stavová lišta používají stávající
služby. Detail Obchodu potvrzeně instaluje, aktualizuje a odinstaluje přes
`/api/marketplace/*`, stav ověřuje novým načtením katalogu. Detail workeru
načítá definici; spustit, pozastavit, obnovit a odinstalovat lze pouze instanci
s ověřenou vazbou na rozšíření M3 přes `/api/agent-extensions/*`. Výsledek
běhu se kontroluje v historii; HTTP úspěch s chybovým stavem běhu není úspěch.
Legacy worker
zůstává jen pro čtení, protože jeho mutační endpointy vracejí 410.

Specialisté v katalogu zahrnují i vypnuté balíčky. Detail čte ověřený manifest,
zobrazuje nástroje a konfiguraci. Zapnutí, vypnutí a aktualizaci potvrdí
novým čtením detailu i katalogu; odinstalaci potvrdí zmizením z katalogu.
Vypnutý balíček nelze otevřít jako relaci.
Soubory pracovního prostoru specialisty používají stejný místní IndexedDB
`intentsmith-specialist-files` jako klasické Studio. Pravý panel nabízí přidání,
náhled textu do 512 KiB, výslovné připojení do zprávy, kopii mezi specialisty
a odebrání uložené kopie. Náhled soubor nepřipojí ani neposílá modelu.
Detail specialisty navíc načítá uložené konverzace z backendového filtru
`specialistId`; při otevření vybrané historie znovu ověří aktivaci stejného
specialisty a až pak obnoví relaci a zprávy.

Správa zdrojů používá nové `/api/scm/*` s plánem a potvrzením; i diff
smazaného souboru je dostupný bez falešného editoru. Izolovaný průchod ve
skutečném Electronu na `bd77c771` prošel včetně výměny sloupců, šesti relací,
obnovy a jedenácti témat (`tests/studio2-exclusive-ui.e2e.js`).

Po výslovném nastavení projektu na `automatic` backend každých pět minut
zkontroluje povolený fetch nebo pull. Pull používá stejný plán, audit,
ověření hostitele a `--ff-only` jako ruční akce. Výchozí politika inicializace
je podle Decision 049 `ask`; import složky do repozitáře nezapisuje. Pokud
uživatel poté nastaví `init=automatic`, backend bez gitu provede auditovaný
plán a vrátí zvlášť výsledek efektu. Automatický commit po M2 používá
již existující commit v atomickém M2 plánu: celý plán včetně commitu čeká na
schválení. Projektová politika se čte při tvorbě návrhu; `disabled` vytvoří
návrh bez commitu. M2 služba politiku kontroluje znovu při přípravě i schválení,
takže přímé API ani změna politiky mezi těmito kroky zákaz commitu neobejde.

Historie Multimédií načítá skutečné záznamy; oblíbené, zrušení a smazání
prochází backendem a znovunačtením stavu. Běžící úloha po požadavku na
zrušení zůstává označená jako běžící, dokud backend neohlásí koncový stav.
Nový formulář generování je součástí prototypu a generovaného pohledu.
V IDE ověřuje dostupnost ComfyUI a checkpointu, validuje textové generování
obrázku a videa, odesílá ho přes `/api/media/generate` a kontroluje přijetí
v historii. Průběh a konec přebírá z již existující sběrnice WebSocketu;
konečný stav znovu ověří v historii. Dokončené výstupy se načítají z `/api/media/output` do lokálních
objektových URL; zamítají se nebezpečné názvy a neočekávané typy. Obraz → obraz
čte vybraný soubor jako bajty bez cesty, limituje PNG/JPEG/WebP na 3 MiB,
přes backend nahraje zdroj do ComfyUI a generování přijme pouze jednorázovou
serverovou stvrzenkou. Vstupní soubor se neposílá jako cesta ani volný název
pro `LoadImage`. Izolované testy ověřily upload a přijetí úlohy se syntetickou
GPU frontou. Fyzické GPU generování zatím nebylo spuštěno.

Projektový průvodce je v prototypu a generovaném pohledu. V IDE načítá
výchozí složku backendu, ukazuje kontrolu před potvrzením, zakládá nový
projekt nebo registruje existující složku přes stávající `/api/projects`
a `/api/projects/open-folder`. Po odpovědi ověřuje projekt v katalogu;
nejistý výsledek zápisu neopakuje automaticky.

Kontextová nabídka konverzace přejmenuje, archivuje nebo přesune záznam do
koše přes backend a výsledek ověří novým čtením i katalogem. Historické akce
připínání a hromadného zavírání záložek byly z pohledu odstraněné rozhodnutím
28. 9. (§9). Ukončení konkrétní relace používá společné bezpečnostní stráže.

Průvodce specialistou je také v prototypu a generovaném pohledu. Před
vytvořením ukáže ID, doménu, popis a soubory balíčku. IDE zapisuje přes
existující `/api/specialists`, ověřuje manifest novým čtením a katalogem;
nejistý výsledek neopakuje. Generátor stubu v backendu byl při napojení
opraven, aby vložené apostrofy a nové řádky zůstaly daty, nikoli JS kódem.

Průvodce workerem v novém UI instaluje dostupné M3 rozšíření Project Health
pro vybraný projekt, vždy nejprve jako vypnutou instanci. Po zápisu ověřuje
vazbu rozšíření, ID projektu a katalog; ztracenou odpověď neopakuje. Obecný průvodce nyní používá deklarované parametry ověřených rozšíření M3;
zdroje, podmínky, spouštěče a akce ukazuje ze schématu bez vlastní shellové
autority. Legacy mutační API nadále vrací 410.

Průvodce expertýzou přebírá profil a ladění 5D ze starého UI.
Před zápisem čte náhled pravidel z `/api/merge-preview`; uloženou expertýzu
ověřuje přes `/api/expertises/:id` a nový seznam. Žádný modelový test nespouští
automaticky. Pokročilé moduly, dědění a zakázané fráze se editují v detailu;
testovací prompt vyžaduje samostatné potvrzení a jeho odpověď platí jen pro
stejnou konfiguraci a dotaz. Vlastní expertýzu lze otevřít k úpravě; UI načte
celou aktuální konfiguraci, ponechá původní ID, před zápisem ověří revizi a
backend odmítne mezitím změněnou revizi. Zápis do DB je transakční a po chybě
vrátí původní stav registru. Vestavěné expertýzy jsou jen ke čtení. Řízené
Výběr jedné až tří expertýz pro volnou konverzaci používá samostatnou trvalou
vazbu s revizí. Backend před zápisem ověří registr a kompatibilitu; klient
potvrdí náhled, po zápisu znovu načte přesný výběr a neopakuje nejistý zápis.
M1 schéma se nemění: controller pro každý další tah načte schválené ID ze
své databáze a znovu je ověří v aktivním registru. Projektové relace zůstávají
v projektovém režimu a nabídka výběru je tam výslovně zablokovaná, aby
nepředstírala aplikování jiné persony.

Nastavení má nyní přesně 12 kategorií a záložky z UI-SPEC. Funkční přepínače
se čtou z `/api/features`; zapnutí, vypnutí a obnovení výchozích hodnot
vyžaduje potvrzení a ověřuje nový stav ze serveru. Lokální modely se čtou
z Ollamy prostřednictvím backendu a velikost uložených příloh z backendu.
Účet/Profil, Paměť, Oznámení, Výstup a tři systémové záložky používají
prototypový formulář a existující `/api/settings`. Před zápisem se stav znovu
čte kvůli souběžným úpravám, po zápisu se ověřují přesné uložené hodnoty.
Přehled Oznámení navíc čte `/api/notifications/channels`; ukazuje, zda je
kanál zaregistrovaný v backendu, nikoli zda byla doručena zkušební zpráva.
Účet/Projekty ukládá místní výchozí složku, převádí dřívější volbu a předává
ji průvodci při vytvoření projektu. Využití úložiště a zálohy se čtou z
backendu; ruční záloha, export, import a návrat výchozích hodnot vyžadují
potvrzení a nové čtení výsledku. Zabezpečení zobrazuje audit, přístupové
tokeny a stav webhooků. Zpětná vazba odesílá skutečný obsah a volitelné
přílohy, modelová obrazovka zobrazuje inventář, hodnocení, hunt, role,
governor a upgrady s ověřenými efekty. Ostatní nepřipojené záložky jsou
výslovně označené a neukazují ukázková data.

V panelu Soubory lze vytvořit soubor/složku, přejmenovat a smazat položku.
Operace používají ID projektu z relace, relativní cestu, revizi pro přejmenování
a smazání a následné ověření skutečného stavu. Potvrzení smazání složky ukazuje
počet položek v podstromu; backend porovná jeho revizi a odmítne chráněné
položky, symbolické odkazy a jiné disky. Nejasný výsledek zápisu se neopakuje
automaticky; strom se musí obnovit.

M4 příkazy z klasického Studia jsou v novém skladateli vázané na přesné ID
projektu. Odpovědi včetně pozorování, digestů a aktuálního výsledku se před
zobrazením validují; při souběžném M1 tahu se příkaz neposílá. Párování M7 je
v Nastavení → Zabezpečení → Přístup. Vydání lokálního pětiminutového kódu
ověřuje přesnou smlouvu odpovědi a drží kód jen v paměti okna.

**Integrace parity dokončené 28. 9.:** projektová relace používá vybrané
expertýzy při zachování priority PROJECT a samostatného schválení změn.
Obecný průvodce workerem čte ověřenou definici M3, provede kontrolu parametrů
bez spuštění a instaluje instanci vypnutou s vazbou na digest definice.
Všech 12 kategorií nastavení používá skutečné adaptéry. Tab ve skladateli
volá stávající autocomplete až na výslovný vstup; odpověď je vázaná na
konverzaci, projekt, rozepsaný text a historii. Menu dokumentace, opakování
zadání a klávesy Ctrl+W/Ctrl+Q jsou zapojené.

Projektový chat uchová `ProjectWorkProposal@1` pro editovatelný souborový
plán. Soubory, závislosti, kontext a doslovné argv se kontrolují před HTTP;
příprava nikdy neschvaluje. Zrušení generování ponechá formulář, oprava
neprovedeného návrhu nemá zděděné schválení. Průběh M2 čte jen přesný
lifecycle/origin/digest, pozorování nemůže nahradit vlastní HTTP výsledek.
Výsledek, cílený test, přesné obsahy a audit zůstávají dostupné i po restartu.

Studio 2 je jediný frontend. Sdílený chat-panel poskytuje původní klienty
bez Theia UI registrace. Klasický JS entrypoint byl po inventuře odstraněn;
uložené klasické přepínače nemohou obnovit staré UI. Testy čtení monolitu jsou
převedené podle [TEST-MIGRATION](TEST-MIGRATION.md). Historický stav zůstává
v Gitu. Finální runtime a balík dokumentuje
[ověřovací report](../review/2026-09-28-STUDIO2-PARITY-DELIVERY.md).

## 2. Jak to funguje

```
docs/studio2/prototype/src/main.template.html ─┐   scripts/build-view.js    lib/browser/view/generated/
docs/studio2/prototype/src/main.js ────────────┼──────────────────────────▶ view.js   (šablona → React)
docs/studio2/design/tokens.css ────────────────┘                            model.js  (logika → view model)
                                                                            proto.css (styly, omezené na widget)
lib/browser/view/studio-root.js   React kořen: model.renderVals() → render(vm) ; změna stavu → překreslení
lib/browser/view/dc-logic.js      náhrada běhového prostředí plátna (state, setState, forceUpdate)
lib/browser/studio2-module.js     Studio2Widget.render() → StudioRoot
```

- Model je třída `Component` z prototypu: drží stav (`st()`), akce vrací změny stavu
  (`p*` metody), `renderVals()` z nich skládá view model a šablona ho jen zobrazí.
- Generované soubory se **needitují**. Změna vzhledu nebo chování UI = změna
  prototypu, pak přegenerovat (§3).
- Původní ruční render i dočasné přepínání byly odstraněny. Jediná vrstva
  vzhledu je generovaná z prototypu; uložená volba `legacy` se ignoruje.

## 3. Postup při změně vzhledu

```sh
cd docs/studio2/prototype
python3 build.py && node test/scenarios.cjs project/Main.dc.html && node test/fuzz.cjs project/Main.dc.html 7 5000
cd ../../../intentsmith-ide/extensions/intentsmith-studio2
node scripts/build-view.js                       # přegeneruje view/generated/*
node scripts/preview-view.js /tmp/s2-preview     # PNG hlavních stavů v headless Chrome
cd ../../.. && node tests/studio2-view.test.js   # --check, scénáře, fuzz, React render
```

Build a Electron potřebují Node 24 (`.nvmrc`); v této pracovní stanici je
v `/tmp/is-studio2-node24/node_modules/node/bin`. Kontrola ve skutečném Electronu:
`node intentsmith-ide/applications/electron/scripts/launch.js --no-sandbox
--remote-debugging-port=0 --user-data-dir=<tmp>`, přepnutí
`IntentSmithStudioMode.selectMode('studio2')`.

## 4. Integrace — kde napojit backend

Pravidlo: **žádné nové React obrazovky.** Integrace vznikne jako podtřída modelu,
např. `lib/browser/view/live-model.js` s `class LiveModel extends Component`,
a `createModel()` v `studio-root.js` ji začne vracet. Podtřída přepisuje zdroje dat
a akce; šablona a styly zůstanou. Pokud integrace potřebuje prvek, který prototyp
nemá, přidá se do prototypu (a jeho testů) a přegeneruje.

Stav modelu, který je čistě UI (počet sloupců, `colSids`, šířky a výšky panelů,
záložky pravého panelu, dlaždice/seznam, rozbalení navigace, volby vzhledu), patří
do `localStorage` (CONNECTORS G4); vzhled přes stávající `appearance-store.js`
a jeho migraci `intentsmith-settings`. Vše ostatní se čte ze stores.

| Místo v modelu | Dnes (fixtura) | Napojit na (existující kód / API) |
|---|---|---|
| `st().tabs`, `sess(sid)` | `data().S`, `s.sessions` | `session-store.js` (relace, pořadí, zavření bez posunu), `transport-adapter.js`; tvar objektu relace viz níže |
| zprávy `sess().msgs` | pole `{k, time, text, badge, expert, author, steps, paras, code, running, runText, rid, approval, atts}` | WS `chat`/`agent`, `WorkActivity` z chat-panelu (kroky časové osy), `renderMarkdown` pro odstavce |
| `pSend`, `m.stop` | přidá ukázkovou odpověď | `Studio2Widget.send()` (přílohy, M2 příkazy, kontrola identity), WS `control` `cancel` |
| přílohy `s.atts`, `c.attach` | ukázkové soubory | `attachments.js` (`selectFiles`, `prepare`, odmítnutí a limity) |
| `pApprove`, karta schválení, záložka Změny | `b.changes`, `s.approved` | `m2-controller.js` (přesný plán a digest), `edit_approve`/`edit_reject` |
| režim Auto / Kontrola | `s.modes` | `session.chat.editMode` |
| terminál `termKey`, `c.term` | vypíše text | `TransportAdapter.sendTerminal`, `WorkspaceFiles.completePath` (Tab) |
| log, průběh, audit, problémy | `b.log`, `b.runs`, `b.audit`, `b.problems` | WS `agent` události, `GET /api/audit` |
| kontext relace | `b.ctx`, `b.parts`, `b.tokens` | `POST /api/context` |
| Soubory: upravené / otevřené | `b.changes`, `b.edited`, `b.ctxFiles`, `b.attach` | M2 plán a výsledek, WS `workspace`, soubory v `tool_call` (CONNECTORS G2) |
| Soubory: strom, náhled, uložení, vytvoření, přejmenování, smazání | `b.tree`, `data().FILES`, `s.fileText`, `s.fileAction` | `workspace-files.js` a `src/routes/studio2-workspace.js` (projektově omezené operace, revize, ověření stavu, stráž neuložených změn) |
| Správa zdrojů | `data().GIT`, `pScmRun` | `scm-client.js`, `src/routes/scm.js`: serverový plán a digest, potvrzení a terminální audit; běhové ověření celého toku stále patří do S2-6 |
| katalogy `entities(sec)` | `data().H, P, SP, EX, WK, MK` | `catalog-store.js` a API z CONNECTORS §2 |
| akce detailu (`detailSpec` → `primary`, `secondary`) | mění stav prototypu | API sekce z CONNECTORS §2 |
| nastavení (`data().SET`, bloky `apObecne`…) | vzhled funkční lokálně | `appearance-store.js`; ostatní kategorie §10 UI-SPEC |
| stavová lišta | text v šabloně | `GET /api/health`, WS `status`, `/api/system/gpu`; stav spojení z transportu |
| okno (minimalizovat, zavřít) | bez akce | Electron okno přes preload |

Tvar objektu relace (`sess()`), který šablona čte: `title, short, kind
('project'|'specialist'|'chat'), project, specialist, state ('run'|'wait'|'ok'|'idle'),
expert, model, mode ('auto'|'kontrola'), intent, ctx, tokens, turns, parts, msgs,
changes, edited, ctxFiles, attach, memory, tree, term, log, runs, audit, problems`.
Fixtury v `data()` jsou úplný vzor každého pole.

## 5. Doplněné části prototypu

Průvodci, zbývající nastavení, Multimédia a provozní/chybové stavy byly
postupně doplněny do zdroje prototypu a jeho generované vrstvy. Živé modely,
M4/M7, souborový plán M2 a jeho audit dodává LiveModel přes stávající API.

## 6. Známé dopady na testy

- `tests/studio2-exclusive-ui.e2e.js` (`tests/helpers/studio2-ui-mode.js`) hledá
  selektory původního renderu (`.intentsmith-s2-*`, `nav[aria-label="Kategorie nastavení"]`,
  `[aria-label="Změny M2"]`). S novou vrstvou neprojde, dokud se sonda nepřepíše na
  prvky prototypu (`.intentsmith-studio2-widget .ide`, `.scol`, `.rp`, `aria-label`
  z šablony). Sonda byla přepsána a izolovaný Electron průchod na `1b4699a9` prošel.
- `tests/studio2-view.test.js` hlídá, že vygenerované soubory odpovídají prototypu.

## 7. Aktuální integrace modelů

`model-workspace.js` čte inventář, role, evaluace, historii, hunt, kandidáty,
Správce, upgrady a autoritativní politiku z backendových API. Stažení, evaluace,
hodnocení uložených odpovědí, řízení huntu, přiřazení role a rollback mají
potvrzení před efektem. Evaluace používá přesný digest modelu a sady;
hodnocení uložených odpovědí používá `runId`, přijatého hodnotitele a hash
zdroje. Politika automatizace se ukládá přes revizní CAS a potvrzené zpětné
čtení; neplatná politika zůstává vypnutá. Rollback tlačítko se objeví pouze
po WS události s úplnou identitou operace. Testy používají simulovaný backend,
neprovádějí skutečné GPU efekty. Stav parity a skutečných runtime kontrol je v ověřovacím reportu; testy adaptéru nenahrazují živé GPU měření.

Nastavení Úložiště čte `/api/system/storage`; optimalizace vyžaduje potvrzení
a nové čtení. Zálohy čtou backendový seznam, vytvoření zálohy potvrzuje její
jméno v seznamu. Export/preview/import uživatelských nastavení používá
`/api/settings` a verzovaný `/api/settings/import`, pak ověřuje přesný obsah;
obnova celé databáze zůstává offline podle backendového kontraktu.
`feedback-workspace.js` odesílá zprávu a omezené přílohy přes existující API,
volitelně poslední odpověď a serverový log. Nejistý výsledek odeslání se
automaticky neopakuje.
`security-workspace.js` čte audit, seznam API tokenů, uptime a stav webhooku.
Vytvoření a odvolání tokenu vyžaduje potvrzení a zpětné čtení. Nový token
zůstává jen v paměti obrazovky a po kopírování nebo zavření zmizí. Backendový
počet WebSocket spojení je v aktuální route pouze placeholder, proto jej nové
UI neprezentuje jako ověřený počet aktivních relací.

## 8. Konverzace a okno (26. 9.)

Konverzace mají vypadat jako v prototypu, proto `LiveModel.sess()` převádí
zprávy relace takto (test `tests/studio2-conversation-view.test.js`):

- Úvodní hláška klasického chatu („IntentSmith připraven…") se nezobrazuje;
  prázdná relace má prázdný stav z prototypu.
- Časová osa tahu ukazuje jen skutečnou práci (nástroje, soubory, chyby).
  Interní kroky pipeline (`kind: 'step'`, `'model'`) jsou sbalené do řádku
  „Zpracování · N fáze · čas" (od 28. 9. fáze, viz §9). Čas odpovědi nese délku tahu.
- Systémová zpráva M2 `awaiting_approval` s platnou vazbou plánu je karta
  schválení (soubory, +/−, režim). Schválit je utlumené a otevře panel Změny,
  dokud nebyl přesný plán zobrazen (pravidlo `m2-controller`). Chybí-li zpráva
  (obnova relace), karta je na konci konverzace. Ostatní M2 stavy a chyby jsou
  krátká hlášení (`cnote`, tóny `n-info/ok/warn/err`), bez `lifecycle` identifikátorů.
- Čip expertýzy a modelu jsou zpět; model je tag z posledního tahu (ne role
  jako „answer"), jinak model role CHAT z `/api/system/models` (`current_model`).
- Zaplnění kontextu bez měření je „—". `POST /api/context` je v backendu jen
  odhad podle počtu zpráv, UI ho proto nepoužívá.
- Relace s výchozím názvem („Relace N", „Nová relace") dostane název podle prvního zadání.

Okno: v režimu Studio 2 se skryje nativní menu Theie a okno se od dalšího startu
přepne na bezrámové (`setTitleBarStyle('custom')`), protože Studio 2 má vlastní
titulní lištu, nabídky i tlačítka okna (`winMin/winMax/winClose` → Electron).
Horní panel Theie zůstává skrytý. Návrat do klasického režimu rám vrátí
(`intentsmith-studio2-frame` v `localStorage`). Globální pravidla polí z klasického
motivu (`intentsmith-theme.css`) v režimu Studio 2 neplatí; pole průvodců
a nastavení mají styl z prototypu (`:where(.ide) …`, nulová specifičnost).

## 9. Relace bez záložek, fáze zpracování, kopírování (28. 9.)

Rozhodnutí operátora, požadavky v [UI-SPEC](UI-SPEC.md) §5 a §6. Vizuál
a sémantika jsou v prototypu (`main.js`), napojení v `session-store.js`,
`studio2-module.js` a `live-model.js`.

- **Lišta záložek není.** Otevřené relace ukazuje levá navigace, výběr
  „Poslední relace" v hlavičce sloupce (`recent(s)` podle `s.used`), paleta
  a nabídka Relace. Číslo relace = pořadí podle posledního použití (1–5), platí pro Alt+N.
  Otevření i přijaté odeslání posouvá relaci na 1; ID a transportní slot se nemění.
  Připínání a „zavřít ostatní / vpravo" odpadly (`tabsVM`, `pTogglePinned`,
  kontext `'tab'`); `pCloseTab` je v live modelu jen alias `pCloseSession`.
- **Strop 5 relací** (`maxSessions()`, `MAX_SESSIONS`). Nová relace jde do
  volného sloupce, jinak nahradí sloupec, se kterým se nejdéle nepracovalo,
  nikdy aktivní (`slotFor` / `SessionStore.nextSlot`). Při stropu se zavře
  nejdéle nepoužitá skrytá relace, kterou jde bezpečně zavřít
  (`canAutoClose` / `Studio2Widget.closeBlockReason`); jinak se nová neotevře.
  Obojí oznámí hlášení `s.toast = { id, tone, t }`, které po `armToast` samo zmizí.
- **× v hlavičce sloupce ukončí relaci** (`pCloseSession` / `closeSession`).
  Sloupec zmizí, jediný sloupec převezme naposledy použitou relaci; zavřené
  relace jsou v „Nedávné" nahoře (`s.closed`).
- **Fáze zpracování.** `phaseSteps(events, endAt)` v prototypu složí události
  do nejvýš čtyř fází (Porozumění zadání, Příprava kontextu, Generování
  odpovědi, Kontroly výstupu). Trvání fáze = do začátku dalšího kroku.
  Live `timeline()` mapuje štítky `WorkActivity` na fáze (`phaseFor`).
  Dokončená fáze je zelená, sbalení zůstává výchozí.
- **Kopírování** je pod dokončenou odpovědí (`.mcopy`). `copyText(key, text)`
  ukáže „Zkopírováno" (1,6 s) nebo „Kopírování se nepovedlo" (4 s).
- Náhledy: `preview-view.js` scény `konverzace-zkopirovano` a `relace-strop-hlaseni`.

## 10. Kategorie a poslední použití (28. 9.)

Explicitní zadání operátora: stejné MRU číslování v roletce, navigaci,
sloupcích, paletě, nabídce a Alt+N. `SessionStore.touch` uloží čas použití;
`TransportAdapter.send` jej změní pouze po přijatém odeslání. Backendové
události nezmění pořadí relací. Zavřená konverzace zachová čas v profilu.

Katalog spojuje existující globální, projektové a specialistické GET konektory
(`CatalogStore.conversationIndex`, nejvýš čtyři souběžné požadavky).
Projektové konverzace se neztrácejí zavřením relace; identita se deduplikuje.
Neúplné načtení má viditelné upozornění. Specialistická vazba je popis historie;
samotné otevření obecné historie specialistu neaktivuje. Explicitní
obnovení specialisty zůstává na existujícím řízeném konektoru.

`LiveModel.conversationMeta` spojuje skutečné vazby a data; sdílené prototypové
`conversationBadges`, `timestamp`, `dateText`, `ageText` je zobrazují.
SQLite časy bez zóny jsou UTC. Dlaždice i seznam nesou štítky Chat / Projekt /
Specialista, poslední použití (`3m`, `5h`, `6d`); detail vytvoření a poslední
aktivitu. Neznámý čas je „—“. Projekt se specialistou má oba štítky.

Paleta kategorií je samostatná od akcentu tématu a stavů. Navigace zůstává
monochromatická v motivech, které ji tak navrhují; štítky zůstávají barevné.
Nastavení má vlastní, tlumenější, vzájemně odlišné tóny `tone-set-*`.
Zdroj vzhledu je stále prototyp, generované soubory se ručně neupravují.

Navazující oprava: `conversationMeta` a prototyp používají pro ikony
`neutral`, barevná je jen `conversationBadges`. `proj` přebírá skutečné
`created_at` a `last_active`, místo prázdného `last`; `projectActivity`
v existujícím profilu SessionStore uchovává použití i po zavření. Projektový
a konverzační detail sdílí formát `dateText`. Pro větší nastavení jsou
pravidla stále v prototypu, nikoli ruční změna generované React vrstvy.

Po odmítnutí A/B/C operátorem je konec palety azurový / mátový / zelený,
bez olivové podobné žlutému chatu. Nastavení používá plné podklady s
kontrastní kresbou (`--set-ink`) a dvanáct různých symbolů z prototypu.
Není přidán nový přepínač palety ani nové nastavení produktu.
