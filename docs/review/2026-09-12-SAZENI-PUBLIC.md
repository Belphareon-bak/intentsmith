# Sázkař — veřejná Fortuna, evidence 2026-09-12

Autorita: operátor výslovně chce nejprve vyzkoušet veřejné zdroje Tipsport
nebo Fortuna, bez placeného API klíče. Vstup `271fce958ede85c539c3835fbf8bc4f74df73aff`,
vlastní větev `codex/specialists-engines-20260911`, worktree
`/home/belphareon/worktrees/is-specialists-engines-20260911`.
**IMPLEMENTED_SLICE / REVIEW_PENDING**. Toto je evidence implementátora,
nikoli nezávislé review nebo provozní přijetí.

## Skutečně získaná data

Anonymní veřejný web Fortuny načetl termíny, týmy a ceny. Starý odkaz
`/sazeni/fotbal/1-anglie` již nebyl správná cesta nabídky. Funkční je
[Anglie / zápasy](https://www.ifortuna.cz/sazeni/fotbal/anglie-4/1-anglie?tab=matches).
Sonda prohlížečem bez přihlášení odhalila stejný veřejný JSON kanál, který
používá stránka. Následný přímý Node fetch vrátil HTTP 200 pouze s hlavičkou
`Accept: application/json`, bez cookies, klíče či browser session.

- Termíny: `https://api.ifortuna.cz/offer/structure/api/v1_0/tournament/ufo:tour:00-03m/matches?timeFilter=all`.
- Ceny: `https://api.ifortuna.cz/offer/markets/api/v1_0/fixtures/markets/overview`
  s opakovaným `fixtureIds`, ověřena dávka deseti zápasů.
- Stejně ověřeny E0, D1, I1, SP1, F1. Celkem 44 zápasů v následujících 72 h.
- Tipsport vrátil HTTP 403 při přímé i anonymní browser sondě. Není zde
  implementován funkční veřejný provider Tipsportu. Žádné obcházení blokace.

Raw evidence v ignorovaném vlastním adresáři
`.intentsmith-artifacts/betting-public-20260912/`: `direct/manifest.json`
obsahuje URL, čas, stav, počet bytů a SHA-256 šesti přímých odpovědí
z 08:50:38–08:50:42 UTC; `direct/` obsahuje jejich JSON. Browser v4 obsahuje
HTML, zobrazený text, screenshot a zachycené JSON. Starší v1/v2 byly neúplné
diagnostické sondy a nejsou zdrojem produkčního cenového důkazu.
Malý [testovací vzorek](../../tests/fixtures/betting/fortuna-public.json)
uchovává dvě skutečné události a jejich 1X2 s původem; integrační modelová
historie a posunuté časy v testech jsou výslovně syntetické.

## Implementace

Výchozí `dataSource:public_web` / kancelář `iFortuna CZ`. Původní CSV
reference zůstává explicitní `reference`; placený agregátor jen explicitní
`odds_io`. Žádný automatický fallback na jiný zdroj nebo kancelář.
Pět pevných lig, nejvýše 100 událostí, dávky deseti, serializované čtení,
stejný scope/deadline/byte budget a M5 audit jako dosavadní datový host.
Scope `sports.fortuna.public.read` nepřijme obecné URL, cookies nebo POST.
Po cenách host znovu ověří termín, stav a identitu každého vybraného zápasu.

Pouze otevřené předzápasové 1X2 v základní hrací době. Výsledek má
`dataMode:observed`, `verifiedObservation:true`, **`verifiedLive:false`**.
Odpověď nemá čas poslední změny ceny; `sourceUpdatedAt:null` se nepřepisuje
časem stažení. Pozorování platí nejvýše 120 s a vypršení se kontroluje i po
solveru. Změna schématu, pozastavený trh a prošlá data nevytvoří platný návrh.
Predikční politika se nezměnila: automatický tržní odhad bez marže, DC model
pro diagnostiku; žádný claim predikční výhody nebo garantované pravděpodobnosti.

## Skutečný výpočet

První běh z aktuálního pracovního kandidátu skončil `READY`, exit 0:
72 h, 2–3 položky, kurz 2–4, p≥20 %, rozestup nejvýše 12 h.
44 událostí, 72 použitelných výběrů, tři dvoupoložkové tikety. Deset událostí
bylo vyřazeno pro nedostatečnou modelovou historii týmů; pokrytí není úplné.

| Celkový kurz | Bodový tržní odhad | Rozestup |
|---|---|---|
| 2.0292 | 45.53 % | 5.5 h |
| 2.0088 | 45.16 % | 0 h |
| 2.0648 | 44.20 % | 1.75 h |

Výstup `/tmp/sazkar-fortuna-public-20260912-1/`, log `demo-1.log`, uložený běh
`69e8511f-1075-4db2-9eb5-25778dc68369` ve vlastní
`.intentsmith-artifacts/betting/analysis.sqlite`. Ověřena vazba na hostovou
invokaci `sazeni.ticket_builder / operator:true` a všech 40 source observation ID.
Jde o datovanou demonstraci
z přibližně 08:57 UTC; ceny již vypršely, nejde o právě platný tiket.
Reprodukovatelný [návod](../../specialists/sazeni/README.md) a
[72h preference](../../specialists/sazeni/examples/fortuna-72h.json).

## Kontroly a zbývající hranice

`sazeni-engine`: **15/15 PASS**; `sazeni-integration`: **15/15 PASS**.
Logy `engine.log` a `integration.log` ve výše uvedeném vlastním adresáři.
Ověřena vazba identity výsledků na původní JSON, expirace, nezfalšovaná
provenance, změna termínu, HTML místo dat, cizí ID, 429 bez retry, zrušení,
uzavřený outbound scope, persistence a skutečný serializovaný chat handler.
Původní referenční a placený provider testy zachovávají původní assertions;
nově výslovně vybírají zdroj, protože výchozí se na pokyn operátora změnil.

Celý deterministický profil tohoto kandidátu ještě čeká na spuštění.
Předchozí revize měla 343 PASS / 3 FAIL / 8 BLOCKED; tyto stavy nelze přejmenovat
na úspěch. Přesný nový výsledek bude doplněn po běhu. Nezávislé review je pending.
Žádný push, merge, aktivace sdíleného checkoutu, účet, nákup nebo podání sázky.
