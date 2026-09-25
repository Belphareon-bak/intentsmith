# Studio 2.0 — průběžný integrační stav

Datum: 2026-09-25. Větev: `codex/studio2-integration-20260925`.
Autorita požadavku: [Decision 049](../decisions/049-studio-2-ui-and-source-control.md),
[WP-STUDIO-2](../wp/WP-STUDIO-2-20260925.md) a explicitní zadání operátora.
Tento záznam je důkaz a stav, ne nový požadavek.

**Stav: IMPLEMENTACE ČÁSTEČNÁ / REVIEW_PENDING / BALÍK NEPŘIPRAVEN.**
Klasické Studio je stále výchozí a zůstává dostupné; režimy se nikdy nepřipojují
současně. Nové UI se nesmí prohlásit za náhradu do potvrzení parity
[UI-SPEC §13](../studio2/UI-SPEC.md). Nic nebylo nasazeno ani pushnuto.

## Přesně ověřené v izolovaném worktree

- Hostitel Theia 1.76.0, React 19 a Node 24: produkční build a kontrola
  zabaleného M1 protokolu, Electron main/preload, bezpečné hranice a ripgrepu.
- Výhradní připojení jednoho UI při startu, obnově a přepnutí; přesný návrat
  do klasického režimu. Šest relací, tři sloupce, výměna relací a perzistence.
- Lokální písma a všech 11 kombinací stylu/motivu; katalog projektů z API.
- Pravý panel: projektový strom, otevřené a ověřeně změněné soubory, editor,
  diff a stráž neuloženého obsahu. Nejistý zápis se ověřuje přečtením bajtů;
  nesmí se automaticky opakovat.
- Terminál relace používá připnutého klienta a projektový root; sloty zůstávají
  stabilní po zavření záložky. Souběžné příkazy dostanou různé milisekundové
  `reqId`, Tab doplňuje jen cestu uvnitř projektu. Výpadek spojení ukazuje
  neznámý výsledek bez automatického opakování.
- M2 v novém UI: `/m2-draft`, `/m2-build`, `/m2-plan`,
  `/m2-status`, `/m2-approve`, `/m2-cancel`; zobrazení úplného obsahu
  návrhu v panelu Změny. Schválení vyžaduje zobrazený přesný plán se shodnou
  identitou a digestem. Zapsané soubory se zobrazí až po kanonickém terminálu.
  Po restartu se vazba obnoví, plán se musí znovu načíst.
- Nastavení Systém → Prostředí a závislosti přímo používá existující,
  řízený instalační panel; ve fyzickém testu načetlo skutečný backend.

Poslední fyzický Electron běh na čistém `bbac61734a93941909da6d2107d235c5481723c4`:
`.intentsmith-artifacts/studio2-environment-bbac6173/studio-electron-boundary.json`,
`intentsmith.studio2-exclusive-ui` **PASS**. Všechny serializované UI
podmínky včetně terminálu, M2 panelu a backendového prostředí jsou `true`;
izolovaný běh odeslal 0 modelových požadavků v tahu, 0 zakázaných efektů a
procesy skončily čistě. Předchozí fyzický běh
`.intentsmith-artifacts/studio2-environment-233899b7/` byl **FAIL**
kvůli závodu dvou kliknutí v testu; soukromý log jej dokládá, oprava čeká
na vykreslení navigace. Jeho FAIL evidence zůstala zachována.

Ověření po změnách terminálu a editoru: produkční Theia/Electron build PASS,
`m1-studio-client` 141/141 PASS, `ide-workspace` 29/29 PASS,
cílené `studio2-transport`, `studio2-workspace-files`,
`studio2-m2`, `studio2-session-store` PASS. Registr testů 550
spustitelných programů validní. Tato čísla jsou regresní důkaz
implementovaných švů, nikoli potvrzení celé parity.

## Co dál brání předání celého balíku

| Etapa | Otevřený podstatný výsledek |
|---|---|
| S2-0 | Změřit čas, paměť a viditelné příspěvky dalších rozšíření. |
| S2-1 | Přílohy, úplný chat composer, M2 vizuální průvodce a end-to-end souběh tahů v novém UI. |
| S2-2 | Akce a průvodci všech sedmi katalogů, paleta, kontextová menu. |
| S2-3 | Funkční obsah zbylých kategorií nastavení, vlastní CSS a rozvržení. |
| S2-4 | Úplné operace stromu, změny od agenta a kontext relace. |
| S2-5 | Modely, hunt, upgrady, M4/M7, multimédia, obchod a zpětná vazba v novém UI. |
| S2-6 | Bezpečný git konektor, projektová politika a pravý panel Správa zdrojů. |
| S2-7 | Přesměrovat jedenáct sad tvrzení, ověřit úplnou paritu a uživatelskou akceptaci, poté odstranit klasické UI a sestavit předatelný balík. |

Žádná etapa S2-0 až S2-7 není tímto záznamem prohlášena za přijatou. Nové UI
se ještě nesmí vydávat za hotové ani nabídnout jako celý testovací balík.
