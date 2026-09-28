# Studio: viditelnost levého a pravého panelu

Autorita: hlášení operátora se screenshotem 2026-09-17; oprava existujícího
vykreslení navigace a chatu. Vstup: nainstalovaný `9d13bb53`.
Vlastní větev `fix/studio-panels-20260917`; druhý worker a živá instalace
zůstávají beze změn.

Runtime reprodukce v odděleném profilu vytvořila navigaci i chat, ale jejich
nadřazené `theia-*-content-panel` měly `max-width:0!important` a ztracené
Lumino positioning styly. Startup skript považoval celý úzký content panel
za rodiče určeného ke skrytí activity baru.

Výsledek: skrývá se pouze activity bar. Nadřazenému Lumino content panelu
se nemaže ani nenuluje styl; jeho velikost dál řídí Theia. Nejde o změnu
vzhledu produktu, API, projektových dat nebo bezpečnostních hranic.

Vlastněné cesty: jediný startup blok v autoritativním chat-panel runtime,
regresní test lifecycle v `tests/m1-studio-client.test.js`, tento WP.
Ověření: skutečný produkční Electron build, čerstvý privátní
profil/DB bez modelových efektů, geometrie a hit-testing obou panelů po
startu, navigaci a obnovení stránky. Diagnostické logy a sondy jsou mimo
repo v `../`; nenasazují se.

Stop: oprava by vyžadovala reset uživatelského profilu, zásah do cizího
checkoutu nebo změnu nesouvisejícího kontraktu. Přijetí/integrace s novější
workerovou větví je oddělené od tohoto izolovaného ověření.

## Naměřený výsledek 2026-09-17

- `node tests/m1-studio-client.test.js`: **127 PASS / 0 FAIL / 0 SKIP**,
  včetně běhu po produkčním buildu.
- Nový lifecycle test proti nezměněnému `9d13bb53`: očekávaný FAIL při
  počáteční šířce 0 px; příčinou je přepsání stylu rodiče. Opravený test
  ověřuje oba rodiče při šířkách 0, 32, 240 a 420 px.
- `cd c3-ide && yarn build`: **PASS**, včetně
  `STUDIO_M1_BUILD_CONSUMER_PASS`.
- `node scripts/validate-test-registry.js`: **PASS**; není přidán nový testovací
  program ani měněn registry.
- Skutečný Electron ve vlastním profilu: oba rodiče mají po startu šířky
  **240/416 px**, oba widgety jsou ve viewportu a hit-testing zasahuje jejich
  obsah. Vstup chatu je dostupný. Totéž prošlo po kliknutí do Nastavení a po
  `Page.reload`. Původní build měl oba rodiče široké **0 px**.

Runtime důkaz je omezený na viditelnost, navigaci a obnovení panelů. Sonda
neodesílala zprávu modelu a netestovala zakázané volitelné subsystémy.
Izolované prostředí proto vrací také 500/501/404 z vypnutých expertise,
agent a media endpointů; nejsou započtené jako úspěch těchto funkcí.
První lokální build skončil na chybějící vývojové závislosti
`terser-webpack-plugin` v kopii runtime dependencies; úplný offline install
z existujícího lockfile ji obnovil. Kód ani lockfile se kvůli tomu neměnily.

Stav této opravy: **RUNTIME_VERIFIED ve vlastní kopii / INTEGRATION_PENDING**.
Nejde o přijetí releasu ani tvrzení, že byl aktualizován běžící desktop.
