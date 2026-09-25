# Studio 2.0 — co se převezme z původního IDE

Stav: podklad k [WP-STUDIO-2](../wp/WP-STUDIO-2-20260925.md), změřeno na
`e9dcf52b` (`work/studio-activity-20260923`, obsahuje nasazené `72247a49`).
Řádky jsou `wc -l` souborů v `intentsmith-ide/`.

## Princip nejmenší práce

Nová je jen **vizuální vrstva**. Transport, protokol, bezpečnostní hranice,
Electron shell, balení a všechna backendová API zůstávají. Z monolitu
`chat-panel-module.js` se převezme logika (načítání dat, perzistence relací,
M2 klient, přílohy, terminál), nepřevezmou se React stromy s inline styly.

| Vrstva | Rozsah | Co se s ní stane |
|---|---:|---|
| Electron shell a capability transport | 9 souborů | beze změny |
| Protokol M1 (`intentsmith-protocol`) | 855 ř. | beze změny |
| Klientské moduly chatu (WS, agent, terminál, aktivita) | ≈2 800 ř. | beze změny nebo drobná úprava rozhraní |
| Logika v `chat-panel-module.js` | část z 8 486 ř. | vyjmout do modulů, chování zachovat |
| Vykreslení (chat panel, center views, sidebar, detail, status) | ≈11 000 ř. včetně logiky z řádku výš | nahradit novými komponentami |
| 18 dalších rozšíření (§6) | ≈9 900 ř. | nejdřív ověřit, zda jsou za běhu vidět; dispozice schvaluje operátor |

## 1. Beze změny

| Soubor / balík | Proč |
|---|---|
| `applications/electron/intentsmith-preload*.js` | `window.electronIntentSmith`: URL backendu, per-process capability, výběr příloh bez odhalení cesty. |
| `applications/electron/intentsmith-local-access.js`, `intentsmith-local-http-bootstrap.js`, `intentsmith-local-origin-normalizer.js` | Jediný producent hlavičky `X-IntentSmith-Local-Capability`, jen pro přesný origin z privátního port-file. Připnuto `studio-electron-boundary.e2e.js` a `DIRECTION.md` 2026-08-07. |
| `applications/electron/intentsmith-attachment-bridge.js`, `resolve-user-data.js`, `scripts/launch.js`, `webpack.config.js`, `electron-builder.yml` | Balení a spouštění; `desktop-runtime.mjs` a instalace releasů s nimi počítají. |
| `extensions/intentsmith-protocol` | `validateM1Contract`, `validateCoreEventStream`, `classifyTerminal`; build ho generuje v `prebuild`, `verify-m1-consumer-build.js` hlídá. |
| `extensions/intentsmith-backend-bridge`, `-ws-security`, `-process-isolation`, `-shell-security`, `-security-audit` | Nejsou UI. Bezpečnostní vrstvy se nesmí oslabit (L0-10). |
| `extensions/intentsmith-release` | Release metadata. |
| `chat-panel/lib/browser/event-bus.js` (70 ř.) | `IntentSmithBus` — veškerá komunikace přes události, žádné vykreslování. |
| `chat-panel/lib/browser/ws-client.js` (1 482 ř.) | Handshake `intentsmith-v1`, capability subprotocol, reconnect, M1 wire, `trackEditRequest`/`approveEdit`/`rejectEdit`. Očekává globály `_sessions`, `_sessionActive` — nové UI je dodá adaptérem (níže). |
| `chat-panel/lib/browser/agent-client.js` (349 ř.), `terminal-client.js` (215 ř.) | Formátování událostí agenta, routování terminálu podle `reqId` → index relace. |

## 2. Převzít s úpravou rozhraní

| Soubor | Co zůstane | Co se změní |
|---|---|---|
| `work-activity.js` (189 ř.) | `createActivity`, `applyEvent`, `finishActivity`, `lineCounts`, `changeSummary`, `applyM2View`, `renderMarkdown` (DOMPurify + markdown-it) | `createComponents` se přepíše na nové komponenty časové osy a souhrnu změn. |
| `agent-log-renderer.js` (369 ř.) | seskupení tahů a párování událostí | React vykreslení nahradí záložka Log agenta ve sloupci relace. |
| `development-panel.js` (107 ř.) | volání `/api/development/*`, stavy plánu | vzhled podle nového detailu nastavení. |
| `center-views/lib/browser/wizard/*` (≈530 ř.) | datové modely a validace průvodců | vykreslení. |

## 3. Vyjmout z `chat-panel-module.js` do samostatných modulů

Chování se nemění, jen místo. Každý přesun má vlastní test, který dnes čte
zdroj monolitu (viz §5).

| Oblast | Funkce v monolitu (příklady) | Nový modul |
|---|---|---|
| Relace a jejich perzistence | `_persistSessionState`, `_restoreSessionState`, `_switchSession`, `_ensureSessions` | `session-store.js` — N relací místo `_sessionCount ≤ 3`, migrace `intentsmith-session-state` |
| Data sekcí | `_fetchSpecialists`, `_fetchExpertises`, `_load*` (17 funkcí) | `data/*.js` po sekcích |
| M2 lifecycle klient | `_m2Render*` a volání `/api/m2/lifecycle/*` | `m2-client.js` (připnuto `m2-lifecycle-studio-surface.test.js`) |
| Přílohy | `_attach*`, `_fb*`, `pickAttachmentFiles` | `attachments.js` |
| Terminál | `_termExec`, `_termTabComplete`, `_terminalContent` | `terminal-view.js` |
| Strom souborů | `_wt*`, `_loadWorkspaceTree` | `workspace-tree.js` |
| Nastavení a vzhled | `_settingsVals`, `_applyAllSettings`, `_applyTextIntensity` | `settings-store.js` + [THEMES](THEMES.md) |
| Průvodci | `_aw*` (worker), `_ew*` (expertýza), `_sw*` (specialista), `_wizard*` (projekt) | `wizards/*.js` |
| Obchod, média, upgrady, hunt, M4 | `_mp*`, `_media*`, `_upgrade*`, `_hunt*`, `_m4Learning*` | po modulech |

Pozor: `DIRECTION.md` 2026-08-07 — commitnutý `lib/` je autoritativní runtime,
TypeScript v `src/` je archiv. `tsc -b` se nespouští. Nové moduly jsou psané
přímo jako JS v `lib/` (CommonJS, React přes `@theia/core/shared/react`), stejně
jako dnešní runtime.

## 4. Nahradit novými komponentami

- `chat-panel-module.js` — vykreslení (React stromy s konstantami `C.*` v inline
  stylech, emoji ikony, 6 motivů zapsaných v JS);
- `center-views/lib/browser/center-views-module.js` (1 663 ř.) + styly;
- `sidebar`, `detail-panel`, `status-widget` (≈800 ř.);
- CSS `intentsmith-theme.css`, `intentsmith-center.css`, `intentsmith-pro-theme.css`,
  `intentsmith-multimedia.css`, `intentsmith-sidebar.css`.

Náhradou je rozšíření `intentsmith-studio2` podle [UI-SPEC](UI-SPEC.md), barvy
a rozměry výhradně přes tokeny z [THEMES](THEMES.md).

## 5. Testy, které dnes čtou zdroj monolitu

Jedenáct testovacích souborů odkazuje na `chat-panel-module.js`:
`desktop-hunt` (10×), `repository-hygiene` (4×), `m1-studio-client` (4×),
`chat-memory-privacy` (2×), `upgrade-ux-v125`, `model-evaluation-read-model`,
`m4-learning-studio-surface`, `m2-lifecycle-studio-surface`,
`m1-model-automation-policy`, `ide-workspace`, `attachments-projects`.

Pravidlo: tvrzení se **nepřepisují ani neoslabují** (CONTRACT §7). Když se
funkce přesune do modulu, test se přesměruje na modul se stejným tvrzením.
Dokud je staré UI zapnuté (D2), zůstávají testy obou cest.

## 6. Ostatní rozšíření — ověřit, pak navrhnout dispozici

Všechna jsou v závislostech `applications/electron`, takže se načítají. Zda
jsou za běhu viditelná, inventura #21 nezměřila (W-4 zůstává otevřené pro
hlubokou inventuru). Před jakoukoli změnou S2-0 zjistí jejich příspěvky
v běžícím Studiu. Dispozici schvaluje operátor (CONTRACT §7).

| Rozšíření | ř. | Předběžný návrh |
|---|---:|---|
| `diff-viewer` | 985 | použít pro „Otevřít diff" v pravém panelu (Monaco) |
| `git-integration` | 292 | nahradit backendovým konektorem [SCM](SCM.md) |
| `chat-search` | 639 | převést do palety příkazů |
| `command-palette`, `keybindings`, `context-menu` | 596 | nahradit paletou, zkratkami a kontextovými menu Studia 2 |
| `agent-panel`, `token-dashboard`, `audit-trail` | 1 567 | pokrývá Log agenta, Průběh a Audit ve sloupci relace |
| `onboarding`, `notifications`, `error-recovery` | 1 989 | ověřit vazby; error-recovery může nést reconnect logiku |
| `multi-project`, `project-store`, `project-export` | 1 543 | ověřit; export zachovat, přepínač projektů nahrazuje navigace |
| `review-panel`, `design-viewer` | 1 515 | ověřit použití |
| `settings` (Theia preferences) | 744 | ověřit; nastavení Studia má vlastní úložiště |
