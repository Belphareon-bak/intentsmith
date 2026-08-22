# Handoff 2026-08-22

**Větev:** `claude/gate1-mobile-app-progress-5sywlt`, tip `2e33e342`
**Nepushnuto.** Strom čistý.

## Co se dnes stalo, v pořadí

1. **M0 uzavřeno a M1 má všech sedm povinných scénářů** (`5cceed64`, 12:07).
   `studio-electron-boundary` vrací `STUDIO_ELECTRON_BOUNDARY_PASS`.
2. **Gate 1 fronta, položky 1–5** — 023, 022, rezervace migrací, 020 a 015.

## Nález, který stojí za zapamatování

`electron-exited-before-cdp` **nebyl D-Bus ani network namespace**. Chromium si
v `TMPDIR` zakládá unix domain sockety a `sun_path` má tvrdý limit 108 bajtů;
runtime root pod `.intentsmith-artifacts` má na téhle stanici 95 znaků, takže na
jméno socketu zbylo 13 z potřebných ~30. `TMPDIR=/tmp` běží, 95 znaků padá,
16 znaků (mode 0700) běží. **Délka závisí na tom, kde repozitář leží** — proto to
jinde mohlo projít. D-Bus hláška v logu byla falešná stopa: objeví se jen uvnitř
namespace a bez něj sada padá bez ní.

## Stav Gate 1 fronty

| # | Položka | Stav | Commit |
|---|---|---|---|
| 1 | 023 VRAM delete race | hotovo | `51936ee1` |
| 2 | 022 operation-bound recovery | hotovo | `05b6c44b`, `c0a0340f` |
| 3 | rezervace migrací | hotovo | `2013e522` |
| 4 | 020 policy storage | hotovo | `b9731302` |
| 5 | 015 proof ↔ artefakty | hotovo | `6368bd2f` |
| 6 | 021 byte bridge + built journey | hotovo | `2b6b151b`, `2e33e342` |
| 7 | autorizovaný GPU pilot | jen na akci operátora | — |

## Čísla, ne dojmy

Deterministický gate na `2e33e342`: `{"PASS":229,"FAIL":3,"BLOCKED":2}`, 234 sad.
Tři selhání jsou předchozí a prostředím podmíněná — `nightly-audit-runner-self-test`
(čeká blocker `toolchain:x11-display`), `nightly-orchestrator-self-test`
(`BLOCKED` řádky s `required:true`) a `vram-coordination` (GPU/prostředí).
Shodné s baseline před sérií, beze změny po 021.

## Co je vědomě nedodělané

- **015 je rozdělené.** Vazba proofu na artefakty a striktní expiry hrana jsou
  hotové. Vlastní issuance, prahy a terminal activation zůstávají blokované, tedy
  B3 a B4 jsou dál pravdivě `BLOCKED`.
- **Behaviorální test aktivace přesně v milisekundě expiry nevznikl.** Potřebuje
  úplný episode fixture a několik dřívějších guardů by se ozvalo dřív než
  porovnání expiry, takže by test tvrdil něco jiného, než by se zdálo. Hrana je
  připnutá na SQL úrovni, kde je jednoznačná. Patří k WP proof issueru.
- **L3 čísla M1**: změřená 2026-08-22, detail v
  [`runs/m1-l3-measurement-20260822.md`](runs/m1-l3-measurement-20260822.md) —
  deterministika p50 `2,77 ms` / p95 `31,6 ms`, modelový chat cold `64,1 s`,
  warm p50 `30,1 s` / p95 `35,9 s`, throughput `1,96 turnu/min`.
  **Refinement delta zůstává nezměřená**: spouští se jen pro syntetizované
  odpovědi, takže patří do B5 s fixním corpusem.
- **B5 `WP-M1-QUALITY`** nezačato — běží až po přijetí CHAT, MODEL a STUDIO.
  Tohle pořadí není preference: B5 má závislost na přijatém STUDIU v zadání.

## 021 — byte bridge, uzavřeno

Commity `2b6b151b` (bridge) a `2e33e342` (built journey).

**Tvar řešení.** Renderer nedostal API na čtení souboru podle cesty a nedostane
ho. Preload vystavuje dvojici: `pickAttachmentFiles` otevře nativní dialog a
za každý vybraný soubor vydá neprůhledný token, `readAttachmentBytes` je jediná
cesta zpátky k bajtům. Cesta do modulu vstupuje jen z dialogu a ven nejde vůbec
— renderer žádnou cestu k souboru nevidí. Dosah rendereru je tím přesně
"soubory, u jejichž výběru jsem byl", ne "cesta, kterou umím napsat". Grant je
jednorázový a vyprší po pěti minutách.

Nebyl potřeba nový kanál do electron-main: `ShowOpenDialog` už registruje
Theia a preload ho volá přímo. Rebuild se tedy týká jen preloadu.

**Strop u čtení.** `fstat` na otevřeném deskriptoru rozhodne PŘED alokací
bufferu. Panel posílá strop podle druhu souboru, takže `.txt` jde proti 1 MiB
a `.png` proti 5 MiB; jeden paušální strop by 4 MiB `.txt` načetl celý a zahodil
až v policy, což je přesně to, čemu se krok 2 měl vyhnout. Velikost se čte znovu
z deskriptoru, takže soubor, který mezi výběrem a čtením povyrostl, strop
neobejde. Nad tím je ještě `HARD_READ_CAP_BYTES` 32 MiB jako paměťová pojistka,
schválně nad policy, aby se nikdy nestala tím skutečným limitem.

**Panel.** Z bajtů staví skutečný `File`, takže drag&drop, `<input type=file>`
i dialog konvergují na jeden tvar a `_readAttachments` se nemění. Picker je
vytažený jako `_chatPickAttachments` do řezu, který testovací harness načítá —
předtím byl zadrátovaný v `onClick` uvnitř `_chatPaneUI`, kam test nedosáhne.

**Rozhodnutí, které stojí za pozornost.** Bridge hlásí u `svg/bmp/ico/tiff/avif`
pravdivý `image/*` typ, ne `text/plain`. Vydávat je za text by je propašovalo
jako `data:text/plain;base64,...`, měřené a doručené jako text — zatímco tentýž
soubor přetažený myší policy odmítne jako nepodporovaný typ. Bridge říká, co
soubor je, a rozhodnutí nechává policy.

**Co se nově hlídá.** `verify-m1-consumer-build.js` kontroluje i preload bundle.
Ten se balí vlastním webpack configem, jehož entry přepisujeme ručně v
`webpack.config.js`; kdyby přepis přestal platit, aplikace se normálně sestaví
a nastartuje a jediným příznakem by bylo, že přílohy z dialogu zase tiše ztrácejí
bajty. Teď je to chyba buildu.

**Built journey.** `studio-electron-boundary` má sondu `attachmentByteBridge`.
Nativní dialog se z CDP zavřít nedá, takže se nedrivuje samotný výběr; ověřuje
se, že postavený preload bridge opravdu vystavuje a že token vymyšlený
rendererem nekoupí nic (`M1_BRIDGE_TOKEN_UNKNOWN`). Výsledek jde do evidence.

**Testy.** 26 nových v `tests/m1-studio-client.test.js` (122 celkem), 16 v
runner-contractu. Devět nových bylo napsáno bez `await`, takže doběhly až po
`summary()` a nemohly shodit exit kód — konvence v souboru je `await testAsync`.
Opraveno a ověřeno záměrným pádem, že failující async test teď opravdu vrací 1.

## Kandidát na finding, který jsem nezaložil

`scripts/run-model-failover-candidate-measurement.js` drží `CANDIDATE_SOURCE_PATHS`
jako ručně udržovaný jmenovitý seznam blobů pro child export. Když modul v tom
grafu získá nový import, child padne na `Cannot find module` a projeví se to jako
šest nesouvisejících selhání. **Stalo se to dnes podruhé** — 21. 8. u
`src/db/user-settings.js`, dnes u `src/db/model-policy.js`. Odvodit ten seznam
z tranzitivní uzávěry místo ruční údržby by tuhle past zavřelo. Bylo to mimo
rozsah 015 i 020, tak jsem to neopravoval.

## Pasti, na které jsem narazil

- **Gate ukáže to, co focused běhy neukážou.** Dnes šest sad, všechny důsledek
  přesunu autority. Nespoléhej na focused zelenou.
- **Ratchet writer vyžaduje čistý strom.** `--write-baseline` musí jít až po
  commitu zdrojů; pořadí je commit → writer → commit baseline.
- **Tři census se srovnávají ručně a vědomě**: README (počet a `ACTIVE`),
  `module-boundary-ratchet` (`--accept-edge` jmenovitě) a
  `harness-exit-code` (database-reachable inventář).
- Po background úloze se `cwd` vrátí na `Projects` — relativní cesty pak míří
  mimo repo.

**Runner kontroluje čistotu stromu po KAŽDÉ sadě, ne jen na začátku.**
Editoval jsem `tests/studio-electron-boundary.e2e.js` během běhu gate a všech
81 sad od té chvíle spadlo na `sourceEvidenceComplete`, ne na ničem skutečném:
`{"PASS":148,"FAIL":84}` místo baseline. Není to regrese, je to neplatný běh.
Poznámka "neupravovat strom během gate" v paměti tohle myslí doslova — čekat
s editacemi, ne je jen necommitovat.

**`direct-tests/` po neúspěšném běhu zůstává schválně.** `cleanupRequested`
maže runtime jen při `exitCode === 0`, aby šel neúspěch prohlédnout. Moje dva
padlé přímé běhy `m1-studio-client.test.js` tam nechaly dva adresáře a
`harness-exit-code` je v gate ohlásil. Před gate mazat `.intentsmith-artifacts/direct-tests`.
