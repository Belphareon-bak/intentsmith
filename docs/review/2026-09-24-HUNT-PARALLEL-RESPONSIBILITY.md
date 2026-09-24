# GPU hunt — paralelní příspěvek M5 a review M0

24. 9. 2026 · základ `c367d675` · **PARTIAL_M5 / INTEGRATION_REVIEW_PENDING / NOT_DEPLOYED**.

## Výsledek pro operátora

Výběr sestavy nyní zachová i role mimo právě měřený rozsah a porovnává přesné
artefakty. Dva různé názvy stejného digestu neumožní vlastní revizi. Oprava
existující kolize nesmí povýšit model, který nevyhrál jednotlivé porovnání.
Maximem jsou dvě role; každá sdílená dvojice potřebuje výslovné povolení a
autor/reviewer ani R1/R2 nemohou tuto výjimku dostat.

Jde o dílčí implementaci [GPU hunt roadmapy M5](../GPU-HUNT-ROADMAP.md),
nikoli přijetí celé M5, statistické metody, hodnotitelů nebo autonomní aktivace.
[Pracovní balíček a vlastnictví cest](../wp/WP-HUNT-RESPONSIBILITY-20260924.md).

## Co bylo reprodukováno a opraveno

| Spouštěč | Původní chování | Nové chování |
|---|---|---|
| Jeden model v D1, D2 a CHAT | Audit vyhovoval, limit byl 3 | Překročení limitu 2; bez schválené dvojice nevyhoví ani sdílení dvou rolí |
| CODE a R1 pod jinými názvy stejného digestu | Audit vyhovoval podle názvů | Jediná identita, kolize autor/reviewer |
| Samostatný výběr CODE při existujícím R1 | Pevný R1 zmizel ze sestavy, jeho model mohl převzít CODE | R1 i ostatní pevné role zůstávají ve výběru |
| Stará sestava již porušovala segregaci | `eligibleForChange: false` se při opravě obcházelo | Bez `=== true` se alternativa nevloží; konflikt zůstane viditelný |
| Nový obsah stejného modelového tagu | Výběr nevázal skóre na digest | Run digest musí souhlasit s čerstvým inventářem; drift výchozí vazby vyžaduje vyřešení |
| Chybějící skóre | Převod `Number(null)` vytvořil nulu | Neplatné známky se odmítnou; nezměřený současný model se nenahradí |
| Alias aktuálně přiřazeného modelu při retention | Samostatná kontrola podle názvu | Přiřazený digest se ponechá i pod jiným názvem |

Výchozí sdílecí seznam je prázdný. Neurčuje za operátora, které dvě role jsou
opravdu nesouvisející. Dodané omezení nelze zeslabit zvýšením limitu nad 2 ani
vymazáním povinných konfliktních dvojic. Dodané `lineageSha256` spojuje různé
artefakty se společným původem; inventář bez této informace ji nenahrazuje
odhadem podle rodiny modelu.

`identityScope` a `lineageUnverifiedRoles` výslovně oddělují kontrolu digestů
od prokázané nezávislosti původu. Neznámý původ zůstává neznámý. Samotný
kladný audit artefaktů není přejímkou nezávislosti dvou hodnotitelů.

## Zapojení a hranice

Skutečný `scripts/model-upgrade-hunt.js` bere digest kandidáta a současného
modelu z `ModelEvaluationHistory.getRun(runId).artifact`, ne ze jména nebo
odhadnuté rodiny. Před výběrem znovu načte striktní inventář a kontroluje
durable digest původních vazeb. Uložené rozhodnutí smí mít
`activationEligible` pouze pro vítěze skutečně vybraného vyhovující sestavou.
Retenční politika přechází na `all-role-loss-context-aware-v3`, aby se změna
podmínek promítla také do identity evidence.

Nedokončené hranice celé M5/M6:

- kontrola při ručním přiřazení, obnově stavu a fallbacku;
- kontrola původce konkrétního revidovaného výstupu, nejen aktuální vazby role;
- ověřený původ modelů a omezení při náhradě hodnotitele;
- operátorem přijatá konfigurace povoleného sdílení;
- řízená aktivace a rollback nad přijatou rozhodovací evidencí.

Solver sám nepřejímá hodnotitele. `eligibleForChange` přebírá z volajícího;
prověřený hunt jej odvozuje z jednotlivého rozhodnutí. Další volající nesmí
tuto hodnotu vytvořit z pořadí hrubých skóre.

## Živý stav, pouze čtení

Autentizované GET na běžící backend a GET inventáře Ollamy potvrdily:
`qwen3.8:latest` má současně D2, CODE a R1 se stejným digestem `22130167c4c2…`.
Jde o tři role a o vlastní revizi CODE/R1 i D2/R1. D1 a CHAT používají
`qwen3.5:27b`; při výchozím prázdném seznamu sdílení ani tato dvojice není
automaticky označena jako povolená. Žádná vazba ani běžící release se neměnily.

Úplné časované pozorování je v `live-audit.json`; tento audit nedokládá,
který náhradní model má být aktivován.

## Ověření

Evidence: `/mnt/vi7000/intentsmith/evidence/hunt-responsibility-m5-20260924/`.

| Kontrola | Výsledek |
|---|---|
| `node tests/model-upgrade.test.js` | 118 PASS, 0 FAIL |
| `node tests/pairwise-trial.test.js` | 49 PASS, 0 FAIL |
| `node tests/model-registry-current-authority.test.js` | 22 PASS, 0 FAIL |
| Registr testů | validní, 538 programů, bez změny registru |
| Nezávislé sondy pomocníků a jejich volajících | 12/12 PASS, `reviewer/REVIEW.md` |
| Úplné offline/database profily | 361 PASS / 2 FAIL / 10 BLOCKED |
| Doplnění ověřených systémových nástrojů | 7/7 původně blokovaných programů PASS |
| Výsledný stav 373 programů | **368 PASS / 2 FAIL / 3 BLOCKED**, nikoli zelená L1 |

Sondy nevolají modely a nemění produkční DB. Testy používají syntetické
identity a vlastní testovací databáze. Integrace dlouhého hunt skriptu byla
zkontrolována sledováním volání; plný sběr/aktivace nebyly spuštěny.

První úplný audit měl chybnou výstupní cestu mimo povinnou komponentu
`.intentsmith-artifacts`, a proto neověřil zamýšlené testy. Zachován jako
`l1.log` (83 PASS / 280 FAIL / 10 BLOCKED), **není výsledkem přejímky**.
Opravené spuštění používá `.intentsmith-artifacts/l1` a `l1-corrected.log`.
Přepočet LOC v `SYSTEM-MAP.md` je nutný po integraci, tento společný soubor
byl úmyslně ponechán druhému workerovi. Jeho test se neignoruje ani nevydává
za zelený; změna součtů je uvedena v `system-map-census.json`.

Druhý FAIL je `nightly-orchestrator-self-test`: hash registru se neshoduje
s přijatou Gate 0 politikou. Jeho test, orchestrace, registr ani politika se
v tomto patchi neměnily; tento otevřený rozpor je již zaznamenaný v SYSTEM-MAP.
Zbývající BLOCKED jsou `accountant-workflow-integration`, `chat-export-budget`
a `export-pdf-docx` s požadavkem na připravený PDF/OCR runtime.
`verification.json` zachovává původní i doplňkový report odděleně, jejich
hash, jednotlivé neúspěchy a hash měřených zdrojových souborů. Není to
release attestace ani tvrzení o čistém stromu v době vývojového měření.

## Předání druhému workerovi

M0 pracuje ve `work/hunt-decision-m0`, naposledy pozorován `0e72fa4d`.
Do jeho checkoutu, souborů ani procesů tato práce nezasahovala. Jeho původní
neversionovaný `node_modules` zůstal zachován. Tento M5 diff nemá společné
zapisované cesty s M0; po převzetí je nutné společně aktualizovat
`SYSTEM-MAP.md` a aktuální stav inventury správy modelů.

Samostatné read-only review M0 je v
`/mnt/vi7000/intentsmith/evidence/hunt-m0-parallel-review-20260924/REVIEW.md`.
Má dvě reprodukované P1 vady:

1. Pořadí dokončení běhů mění orientaci kandidát minus současný model.
   Při stejných známkách a změně pouze timestampů kalibrace přepne
   `FEASIBLE` na `METHOD_UNSAFE`. Přiložený `incumbent-orientation.patch`
   byl ověřen pouze na externí kopii a není aplikován v checkoutu M0.
2. Ořezání posunuté distribuce do rozsahu [−1, 1] mění její skutečný průměr.
   U doloženého příkladu je požadováno +0,04, ale generátor vytvoří −0,056.
   Čísla pod označením nulové hranice proto nepopisují slíbenou distribuci.

Výsledkový dokument M0 nelze převzít jako přejímku metody před opravou těchto
vad. Oprava generátoru musí přiznat své distribuční předpoklady a ověřit
skutečný průměr před simulací. Nová inference k reprodukci těchto vad není
potřeba. M5 příspěvek lze posoudit a integrovat odděleně od tohoto rozhodnutí.

`ADDENDUM-RESULTS.md` ve stejném adresáři review M0 navíc dokládá:

- ingest vybírá jediný kontrakt a při doplnění nové sady se přepne ze 40 na
  20 skupin; součet 60 neimplementuje;
- u vybraných historických běhů nejsou v úlohách explicitní skupiny ani
  původ; jména úloh jsou předpoklad plánovače, ne doklad nezávislosti;
- doporučený `chat_v3` aktuální runner zakazuje jako T5 a vývojový konverzační
  panel není nepoužitá potvrzovací sada;
- demo používá alfa 0,05, přestože dokument jej označuje za kalibrované
  s alfa 0,02; u stejného uloženého `llava-llama3:8b` se verdikt mění
  z PONECHAT na NEROZHODNUTO.

Praktický další postup: převzít a integrovat ohraničený M5 patch, opravit
reprodukce M0, potom plánovat konkrétní roli nad výslovně vybraným přijatým
kontraktem a doloženými skupinami. Historická diagnostika může zůstat v
reportu; nemůže suplovat přejímku aktuálního měřítka.
