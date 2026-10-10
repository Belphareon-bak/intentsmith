# Nastavení V4 ve stávajícím Studiu 2

Kompozice a pět souborů v `design/` pocházejí z operátorem doladěného
`Projects/docs/reviewer-tools/ide-redesign-20261009/preview-v4-claude/src`.
Nejde o další aplikaci. StudioRoot připojuje controller do stejné hlavní plochy
existujícího IDE; používá jeho autentizovaný HTTP klient a již existující
správce modelů, nastavení a zabezpečení. Barvy, fonty a profil jsou z motivu IDE.

`controller.js` vlastní pouze vnitřní DOM. Stránky vracejí escapované šablony
V4 se skutečnými API daty. `pages-models.js` používá ModelWorkspaceRedesign
pro všech sedm záložek a čtyři části Huntu. Ukázkové modely a čísla se nekopírují.
Konfigurace účtu není ověřené připojení. Po neověřeném zápisu zůstává editor
zablokovaný; 422 dovoluje opravu stejného požadavku se stejným ID.

Vizuální zdroj je `design/*.css` + `ide.css`; generátor omezí selektory na
`.intentsmith-studio2-widget .sv4`. Generované CSS je součástí build-view:

```sh
node intentsmith-ide/extensions/intentsmith-studio2/scripts/build-view.js
node intentsmith-ide/extensions/intentsmith-studio2/scripts/build-view.js --check
node --test tests/studio2-settings-v4.test.js
```

Výsledek dosavadních oprav a nativní kvalifikace je uveden v aktuálním
integračním předání. Přítomnost rendereru nebo zelený unit test neznamená
přejímku vzhledu, skutečného doručení, GPU ani releasu.
