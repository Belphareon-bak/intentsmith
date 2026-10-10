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
zablokovaný a nabízí čtecí porovnání aktuálního stavu; 422 dovoluje opravu
stejného požadavku se stejným ID. Přepnutí backendu nepropustí starý editor
ani cache do jiné databáze.

Vizuální zdroj je `design/*.css` + `ide.css`; generátor omezí selektory na
`.intentsmith-studio2-widget .sv4`. Generované CSS je součástí build-view:

```sh
node intentsmith-ide/extensions/intentsmith-studio2/scripts/build-view.js
node intentsmith-ide/extensions/intentsmith-studio2/scripts/build-view.js --check
node --test tests/studio2-settings-v4.test.js
```

Úvodní seznam kategorií kreslí IDE samo (katalog jako u Specialistů, paleta
`tone-set-*`); ostrov se připojí až pro otevřenou kategorii a dostane od
StudioRoot ikonu a tón kategorie (`categoryMark`), aby hlavička odpovídala
sekcím IDE. Stav v seznamu dodává `homeSummary()`. Viz UI-SPEC, požadavek 10. 10.

Typografie a texty: výchozí písmo IDE je Noto Sans s Liberation Mono (stejně se
vykresluje návrh), obsah má šířku nejvýš 1360 px. Rozhraní nepropisuje anglické
ani technické texty backendu do českých vět: chyby se překládají na jejich význam
(např. chybějící oprávnění správce), důvody pozastavení a omezení běhů se ukazují
jako oddělená citace a oprávnění tokenů mají české názvy.

Výsledek oprav, nativní kvalifikace a běžného hlavního spouštěče je v
[aktuálním předání](../../review/settings-v4-completion-20261010.md).
Přítomnost rendereru nebo zelený unit test neznamená
přejímku vzhledu, skutečného doručení, GPU ani releasu.
