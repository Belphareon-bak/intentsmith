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

Závěrečné běhy z čisté `4cd363d065e81c7de3c81f7e4b8ef19dd5f00cd6`:

| Běh / UTC | Výsledek | Uložené ID |
|---|---|---|
| 72 h / 09:12:04 | 44 událostí, 3 dvoupoložkové tikety, 40 zdrojů | `ffde438d-f9d7-4031-8f42-b51f6d1ac0ad` |
| 24 h / 09:13:03 | 25 událostí, 3 jednopoložkové tikety, 38 zdrojů | `076453e1-b912-4609-b01e-42d1c3158ee0` |

72h kurzy: **2.047 / 2.0088 / 2.0648**, bodové odhady
**45.37 / 45.16 / 44.20 %**, rozestupy **5.5 / 0 / 1.75 h**.
Změna první ceny proti původnímu pokusu pochází z nové odpovědi Fortuny.
24h kurzy: **1.51 / 1.6 / 1.67**, odhady **63.49 / 60.23 / 57.59 %**.
Výstupy pod `/home/belphareon/Projects/coworker/intentsmith-specialists-20260911/`:
`try-fortuna-public-20260912/` a `try-fortuna-24h-20260912/`.
Oba běhy mají exit 0 a `SAVED`. Soubor `demo-verification.json` v adresáři sondy
zaznamenává opětovné ověření všech 78 zdrojových hashů, hostové vazby a všech
devíti exportovaných cen proti původním JSON trhům. Také tyto cenové snímky
již vypršely; pro aktuální nabídku je nutné zopakovat výpočet.

## Kontroly a zbývající hranice

Implementace `cd3e01bd65069c3b98b1c892307a311ba597af11`. Z čisté revize byl
samostatně zaznamenán přesně jeden core spoj
`src/betting/data-host.js -> src/betting/fortuna-public.js` pomocí
`scripts/module-boundary-ratchet.mjs --write-baseline --accept-edge`.
Důvod: orchestrace veřejných dotazů zůstává v hostu; balíček neprovádí efekty.
Graf **1315 → 1316**, nic odebráno, stále 3 cykly / 28 souborů. Změna seznamu
neznamená nezávislé přijetí konektoru. Log `boundary-record.log`.
Stávající `m5-outbound-policy` má 12/12 PASS (`outbound.log`). Registry se
nezměnilo: 514 programů, normalizovaný registry fingerprint (SHA-256)
`2322ef86b7eabbf1b3a2b0bd513d2fba08d19320fd8290a47798e79823117993`.

`sazeni-engine`: **15/15 PASS**; `sazeni-integration`: **15/15 PASS**.
Logy `engine.log` a `integration.log` ve výše uvedeném vlastním adresáři.
Ověřena vazba identity výsledků na původní JSON, expirace, nezfalšovaná
provenance, změna termínu, HTML místo dat, cizí ID, 429 bez retry, zrušení,
uzavřený outbound scope, persistence a skutečný serializovaný chat handler.
Původní referenční a placený provider testy zachovávají původní assertions;
nově výslovně vybírají zdroj, protože výchozí se na pokyn operátora změnil.

Celý `npm run test:deterministic` na čisté `4cd363d0`:
**343 PASS / 3 FAIL / 8 BLOCKED / 0 TIMEOUT / 0 SKIPPED**, exit **1**.
Run `2026-09-12T09-11-34-677Z`, 09:11:34–09:16:29 UTC;
raw `.intentsmith-artifacts/test-runs/2026-09-12T09-11-34-677Z/report.json`.
Sázkař má i v tomto profilu 15 + 15 PASS, module-boundary 13/13 PASS.
Stavy všech 354 programů jsou stejné jako v předchozím plném profilu.

Přesné non-PASS, bez překlasifikování:

- `artifact-validation`: interně **157 PASS / 1 FAIL**; pouze dosavadní
  chybějící rezervace migrace `2026_09_11_112_model_hunt_append_only.js`.
  Nové soupisy počtů souborů/řádků a hran prošly.
- `nightly-orchestrator-self-test`: registry fingerprint neodpovídá dříve
  nezávisle přijaté Gate 0 policy. Tento WP registry ani policy neměnil.
- `mobile-browser-a11y`: runner FAIL; uvnitř BLOCKED kvůli nepřítomnému Chrome
  v projektové `node_modules/.cache/puppeteer/...`. Sonda použila existující
  globální Chrome; testový profil nebyl přepnut nebo překlasifikován.
- BLOCKED `chat-export-budget`, `export-pdf-docx`: `python-pdf-runtime`.
- BLOCKED `m2-execution-git-preservation`, `workspace-budget`: `git`.
- BLOCKED `m2-execution-process-supervision`: `bwrap`.
- BLOCKED `m2-execution-project-change`, `m2-lifecycle-application-service`:
  `bwrap` a `git`.
- BLOCKED `m5-process-hardening`: `bubblewrap` a `prlimit`.

BLOCKED jsou nepřijaté předpoklady daného testového profilu, nikoli tvrzení,
že na hostiteli neexistuje Git. Celý projekt tedy není green. Následný commit
mění jen tento report, SYSTEM-MAP a výsledek WP; produktový kód je přesně ten
z testované revize. Nezávislé review je **REVIEW_PENDING**.
Žádný push, merge, aktivace sdíleného checkoutu, účet, nákup nebo podání sázky.
