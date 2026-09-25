# Studio 2.0

Nové UI Studia nad stávajícím backendem a Theia hostitelem. Stav: **návrh
kontraktu**, viz [Decision 049](../decisions/049-studio-2-ui-and-source-control.md)
a [WP-STUDIO-2](../wp/WP-STUDIO-2-20260925.md).

| Dokument | Obsah |
|---|---|
| [UI-SPEC](UI-SPEC.md) | rozvržení, relace ve sloupcích, katalog a detail, pravý panel, nastavení, parita |
| [REUSE-MAP](REUSE-MAP.md) | co se převezme z původního IDE beze změny, s úpravou, nahradí, ověří |
| [CONNECTORS](CONNECTORS.md) | každá obrazovka → stávající API/WS; mezery G1–G6 |
| [SCM](SCM.md) | správa zdrojů: politika, čtení, efekty, UI, testy |
| [THEMES](THEMES.md) | styly, tokeny, převod uložených nastavení, lokální písma |
| [MARKETPLACE-TOOLCHAINS](MARKETPLACE-TOOLCHAINS.md) | návrh mimo rozsah: balíčky nástrojů v obchodě |

## Prototyp

Klikací prototyp potvrzený operátorem 25. 9. 2026 je na plátně
<https://claude.ai/artifact/JoX17Xj5qtmruAfTwsoYp3> (stránka Prototyp; soukromé,
sdílí operátor). Jeho zdroj je v [`prototype/`](prototype/), paleta v
[`design/`](design/). Prototyp vznikl před body 1–3 zadání z 25. 9. (výběr
relace ve sloupci, soubory relace a správa zdrojů v pravém panelu); ty popisuje
jen UI-SPEC.

```sh
cd docs/studio2/prototype
python3 build.py                                   # project/Main.dc.html + ../design/tokens.css
node test/scenarios.cjs project/Main.dc.html        # deterministické scénáře
node test/fuzz.cjs project/Main.dc.html 7 5000      # náhodné proklikávání
```

Logika prototypu (`src/main.js`) je spustitelná specifikace chování UI, ne kód
k převzetí; rozšíření `intentsmith-studio2` se píše podle UI-SPEC.
