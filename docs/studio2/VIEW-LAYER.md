# Studio 2.0 — vizuální vrstva a předávka integrace

Stav: pracovní poznámka k [WP-STUDIO-2](../wp/WP-STUDIO-2-20260925.md), 2026-09-25.
Nezakládá nový požadavek; požadavky jsou v [UI-SPEC](UI-SPEC.md), [SCM](SCM.md)
a [CONNECTORS](CONNECTORS.md). Popisuje, jak je vzhled Studia 2 postavený a kde
se na něj napojuje backend.

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
načítá definici; spustit, pozastavit a obnovit lze pouze instanci s vazbou
na rozšíření M3 přes `/api/agent-extensions/instances/:id/*`. Legacy worker
zůstává jen pro čtení, protože jeho mutační endpointy vracejí 410. Správa
zdrojů používá nové `/api/scm/*` s plánem a potvrzením; i diff
smazaného souboru je dostupný bez falešného editoru. Izolovaný průchod ve
skutečném Electronu na `bd77c771` prošel včetně výměny sloupců, šesti relací,
obnovy a jedenácti témat (`tests/studio2-exclusive-ui.e2e.js`).

Historie Multimédií načítá skutečné záznamy; oblíbené, zrušení a smazání
prochází backendem a znovunačtením stavu. Běžící úloha po požadavku na
zrušení zůstává označená jako běžící, dokud backend neohlásí koncový stav.
Nový formulář generování je součástí prototypu a generovaného pohledu.
V IDE ověřuje dostupnost ComfyUI a checkpointu, validuje textové generování
obrázku a videa, odesílá ho přes `/api/media/generate` a kontroluje přijetí
v historii. Průběh a konec přebírá z již existující sběrnice WebSocketu;
konečný stav znovu ověří v historii. Dokončené výstupy se načítají z `/api/media/output` do lokálních
objektových URL; zamítají se nebezpečné názvy a neočekávané typy. Obraz → obraz
zatím formulář nenabízí, protože backend nemá připojené nahrání zdrojového obrázku.
Fyzické GPU generování nebylo v izolovaných testech spuštěno.

Projektový průvodce je v prototypu a generovaném pohledu. V IDE načítá
výchozí složku backendu, ukazuje kontrolu před potvrzením, zakládá nový
projekt nebo registruje existující složku přes stávající `/api/projects`
a `/api/projects/open-folder`. Po odpovědi ověřuje projekt v katalogu;
nejistý výsledek zápisu neopakuje automaticky.

Průvodce specialistou je také v prototypu a generovaném pohledu. Před
vytvořením ukáže ID, doménu, popis a soubory balíčku. IDE zapisuje přes
existující `/api/specialists`, ověřuje manifest novým čtením a katalogem;
nejistý výsledek neopakuje. Generátor stubu v backendu byl při napojení
opraven, aby vložené apostrofy a nové řádky zůstaly daty, nikoli JS kódem.

Průvodce workerem v novém UI instaluje dostupné M3 rozšíření Project Health
pro vybraný projekt, vždy nejprve jako vypnutou instanci. Po zápisu ověřuje
vazbu rozšíření, ID projektu a katalog; ztracenou odpověď neopakuje. Starý
obecný průvodce zdrojů, podmínek, spouštěčů a akcí zůstává otevřenou mezerou:
jeho legacy mutační API vrací 410 a veřejné M3 API zatím nepopisuje schéma
parametrů dalších rozšíření.

Průvodce expertýzou přebírá profil a ladění 5D ze starého UI.
Před zápisem čte náhled pravidel z `/api/merge-preview`; uloženou expertýzu
ověřuje přes `/api/expertises/:id` a nový seznam. Žádný modelový test nespouští
automaticky. Pokročilé moduly, dědění a zakázané fráze se editují v detailu;
testovací prompt vyžaduje samostatné potvrzení a jeho odpověď platí jen pro
stejnou konfiguraci a dotaz. Vlastní expertýzu lze otevřít k úpravě; UI načte
celou aktuální konfiguraci, ponechá původní ID, před zápisem ověří revizi a
backend odmítne mezitím změněnou revizi. Zápis do DB je transakční a po chybě
vrátí původní stav registru. Vestavěné expertýzy jsou jen ke čtení. Řízené
kombinace více expertýz ještě chybí.

Nastavení má nyní přesně 12 kategorií a záložky z UI-SPEC. Funkční přepínače
se čtou z `/api/features`; zapnutí, vypnutí a obnovení výchozích hodnot
vyžaduje potvrzení a ověřuje nový stav ze serveru. Lokální modely se čtou
z Ollamy prostřednictvím backendu a velikost uložených příloh z backendu.
Ostatní nepřipojené záložky jsou výslovně označené a neukazují ukázková data.

V panelu Soubory lze vytvořit soubor/složku, přejmenovat a smazat položku.
Operace používají ID projektu z relace, relativní cestu, revizi pro přejmenování
a smazání a následné ověření skutečného stavu. Smazání složky vyžaduje prázdnou
složku. Nejasný výsledek zápisu se neopakuje automaticky; strom se musí obnovit.

**Zbývá před paritou S2-7:** kombinace expertýz a obecný průvodce workerem
a další akce katalogů, úplných 12 kategorií nastavení,
stahování modelů, role/hunt/governor/upgrady, M4/M7, vstupní obraz pro Multimédia
a automatické režimy gitu.
Prototypové fixtury se stále používají u nenapojených částí nastavení;
tyto části nesmějí být vydávány za živá data. Klasické UI proto zůstává dostupné.

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
- Původní ruční render zůstává dočasně pro porovnání:
  `localStorage.setItem('intentsmith-studio2-view', 'legacy')` a reload. Po integraci
  se smaže i s `chrome-view.js`, `session-view.js`, `catalog-view.js`, `settings-view.js`,
  `workspace-view.js`, `m2-view.js`, `command-palette.js`, `styles/studio2.css`
  a duplicitním `styles/tokens.css` (tapety jsou teď v bundlu dvakrát).

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
| Správa zdrojů | `data().GIT`, `pScmRun` | **backend chybí** — `/api/scm/*` (SCM §3–4, CONNECTORS G1, etapa S2-6); do té doby zobrazit prázdný stav „Správa zdrojů zatím není připojená", nic nepředstírat |
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

## 5. Co prototyp nemá a integrace to potřebuje

Tyto obrazovky nejsou v předloze; před napojením se navrhnou v prototypu
(bloky detailu `rows`, `list`, `chips`, `bars`, `table`, `text`, `empty` pokryjí
většinu) a přegenerují:

- průvodci projektu, specialisty, expertýzy a workeru v rozšířeném detailu (UI-SPEC §9);
- úplné kategorie nastavení a jejich záložky (UI-SPEC §10 chce původních 12 kategorií;
  prototyp má 10 s ukázkovým obsahem a funkční jen Vzhled);
- obsah Multimédií (generování, historie, oblíbené), modely/hunt/upgrady, M4/M7;
- stav „odpojeno" a chybové stavy konektorů (UI-SPEC §1: odpojení musí být vidět).

## 6. Známé dopady na testy

- `tests/studio2-exclusive-ui.e2e.js` (`tests/helpers/studio2-ui-mode.js`) hledá
  selektory původního renderu (`.intentsmith-s2-*`, `nav[aria-label="Kategorie nastavení"]`,
  `[aria-label="Změny M2"]`). S novou vrstvou neprojde, dokud se sonda nepřepíše na
  prvky prototypu (`.intentsmith-studio2-widget .ide`, `.scol`, `.rp`, `aria-label`
  z šablony). Sonda byla přepsána a izolovaný Electron průchod na `1b4699a9` prošel.
- `tests/studio2-view.test.js` hlídá, že vygenerované soubory odpovídají prototypu.
