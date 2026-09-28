# Stahování a skutečný CODE postup — 2026-09-18

Stav: LIVE_GUI_MODEL_JOURNEY_PASS / REVIEW_PENDING. Nasazený zdroj `39cad5f1`;
nezávislé přijetí není součástí tohoto záznamu. Autoritou je explicitní zadání
operátora: opravit nepozorovatelné stahování Gemmy a skutečně projít výběr,
nové měření a rozhodnutí o vhodném CODE modelu přes Studio.

## Výsledek pro uživatele

Gemma4:31b je stažená. Trvalá operace
`mao1:ef3320c8-67ea-4096-abe6-b98c57206ab4` skončila
`RECONCILED_SUCCEEDED` dne 18. 9. v **15:13:26 CEST**, 65 min 45 s po zahájení.
Staré okno o dokončení kvůli ztracenému spojení nevědělo. Nebyla znovu stahována
jen pro účely tohoto ověření. Stažení samo neprokazuje vhodnost na GPU ani kvalitu.

V produkční DB jsou tři nové COMPLETE CODE sady, spuštěné tlačítky skutečného
instalovaného Studia. Každá obsahuje 7 oprav JavaScriptu × 3 opakování, celkem
**63 vyhodnocení**. Provider `0.34.0-intentsmith.1`, response-bound digest,
kontrakt `82d70e89eb56d8393a8509b3e124aa87a8a1d8d86afe36b0746e3f6a56581812`.

| Model | Skóre | Samotné měření úloh | Dokončeno CEST |
| --- | ---: | ---: | --- |
| qwen3.8:latest | **71,4 %** | 2 min 49 s | 15:34:38 |
| devstral-small-2:latest | 32,4 % | 3 min 39 s | 15:30:35 |
| ornith-1.5:9b | 25,7 % | 2 min 7 s | 15:26:05 |

**CODE zůstává qwen3.8:latest**, protože vyšel nejlépe z těchto tří čerstvě
měřených modelů. Neproběhla změna bindingu ani tvrzení, že bylo ověřeno přepnutí
na vítězného nového kandidáta. Ostatních šest bindingů zůstalo beze změny.
Devstral uspěl v opravách souběhu inference/změny modelu a ochrany modelu při měření VRAM, ale selhal v opravách
časovačů. Ornith měl některé neúčinné opravy i regrese. Qwen také není bezchybný:
uložení odpovědi/chyby/zrušení má 0 %, jistota rozhodnutí 33,3 % a jedna oprava
časovače 66,7 %. Detail jednotlivých úloh a běhů je dostupný v Evaluaci i Historii.

Časy v tabulce neobsahují frontu, načtení modelu ani základní GPU kontroly.
První běh čekal na startup ověřování bindingů. Předchozí operátorův běh
ornith/CODE skončil v 15:14:13 `SCHEDULED_SKIPPED` kvůli staré rezervě 40 GiB;
je zachovaný v historii. Nové běhy už používají rezervu pro instalované modely.

## Příčina a oprava

Parser pullu čekal na `status: downloading`, zatímco skutečná Ollama posílá
`pulling <digest>` s `total`/`completed`. Proto zůstával text manifestu i během
přenosu. Stav navíc závisel na WS událostech otevřeného okna.
[Protokol Ollama](https://github.com/ollama/ollama/blob/main/docs/api.md#pull-a-model).

- Parser přijímá skutečné události vrstev, slučuje oznámené bajty a počítá
  rychlost nového přenosu; obnovené bajty nepočítá jako právě stažené.
- Karta nad Kandidáty ukazuje průběh, GiB, MiB/s, odhad zbývajícího přenosu,
  fázi a čekání na zprávu. Zůstává viditelná i při odfiltrování daného modelu.
- ETA je pouze pro oznámené vrstvy; Ollama další vrstvy oznamuje postupně.
  Chybějící telemetrie nemá vymyšlené procento ani čas. 100 % vrstvy není
  dokončený model; závěr vyžaduje provider success a konec streamu.
- GET downloads čte existující trvalé operation receipts a aktuální stream.
  HTTP polling každé 3 s obnovuje stav bez WS i po restartu/reloadu. Chyba má
  viditelný stav a opakování, dokončení nabízí testy modelu.
- Ruční retry WS obnovuje retry budget; zdravá HTTP kontrola obnoví spojení
  po vyčerpání původních pokusů. Mutace se při reconnectu neopakují.
- Ruční test již instalovaného modelu potřebuje 2 GiB pracovního místa.
  Stahovací hunt má nadále rezervu 40 GiB a velikost kandidáta. Proof policy,
  GPU umístění ani pravidla mazání a přiřazení nebyla oslabena.
- Identifikační binding probe používá `keep_alive: 0`; po odpovědi už
  nenechává ověřovaný model dalších pět minut blokovat GPU.

## Rozsah a důkazy

Vstup byl Studio `2ca3cca1`, backend `c52b03ff`, souběžně vyvíjený zdroj
`0534a111`. Ten je zachovaný merge commitem `1ee60d88`, včetně přejmenování
`c3-ide` na `intentsmith-ide`. **Vlastní opravný rozsah je `1ee60d88..39cad5f1`**;
rozdíl proti dřívějšímu `98334160` obsahuje i převzaté cizí změny. Cizí checkout
ani uživatelovo otevřené Studio nebyly přepsány/ukončeny.

- Úplný offline/database profil na `5f364979`: **359 PASS / 1 FAIL / 0 BLOCKED**.
  Jediný FAIL: `tests/nightly-orchestrator-self-test.js`, přesně
  `registry hash differs from the reviewed Gate 0 policy`. Je zděděný;
  úplný profil není označený PASS a pečeť se nepřepisovala.
- Po následném třířádkovém keep-alive doplnění: binding 109/109,
  artifact validation 160/160; žádná změna evaluačního kontraktu.
- Cílené testy pull authority 13, upgrade 102, M1 klient 133, desktop-hunt 31
  prošly; pokrývají přerušené streamy, chybějící success, callback kompatibilitu,
  obnovu, rychlost/ETA, zastaralý stav i diskovou rezervu.
- Production frontend build a consumer verification PASS. Bundle SHA-256
  `68362fffaa7cd3ee123a5488afde9f61f8b9016bbad66c989b22c480f6858764`
  v závěrečné instalaci `39cad5f1`. Předchozí bundle na `5f364979`/`e3d1d36e`:
  `483412040fc27675f86adb6a2a7bb64d4746827937d3885916509b770abc3010`.
  Mezi `5f364979` a `e3d1d36e` je frontend i jeho lockfile beze změny;
  již ověřený bundle byl v čisté detached instalaci znovu ověřený.
  Navazující jednopoložková změna React key v `39cad5f1` resetuje posun při
  změně záložky, nikoli při pollingu; má vlastní nový production build.
- `controlled-4`: skutečný Electron + skutečné routes/authority/parser nad
  řízeným NDJSON providerem. Ověřen přenos bez WS progress událostí, ztráta
  backendu, rotace portu/capability, automatická obnova a dokončení po reloadu.
  Simulované rychlosti nejsou fyzicky změřená rychlost stahování Gemmy.
- `live-code-1`: skutečné GUI, produkční backend/DB/Ollama/GPU, tři nové sady,
  progress/ETA, srovnání a zachování nejlepšího dosavadního CODE bindingu.
- `final-read-2`: 7/7 záložek, detail aktuálního i historického CODE běhu,
  karta Gemmy viditelná po přechodu ze scrolovaného detailu a zachovaný posun
  během sedmi sekund pollingu. `final-read-1` prošel textovými asercemi, ale
  ruční kontrola jeho screenshotu odhalila skrytou kartu; zachován.
- `verification-release`: všech 7 startup probe claims uvolněných,
  `/api/ps` prázdné, bez čekání pět minut na výchozí keep-alive.
- Závěrečné ověření nové instalace a uvolnění startup runnerů je uvedené
  v [machine-readable záznamu](../execution/runs/model-download-journey-20260918.json).

Evidence root: `coworker/intentsmith-model-download-journey-20260918`.
Obsahuje negativní pokusy, screenshoty, receipts, testové logy a content-addressed
archiv. `source-final.bundle` vyžaduje základ `1ee60d88`; není to celý klon historie.
Archiv neobsahuje DB, uživatelské profily, capability port files ani credentials.

Zachované neúspěchy: první test chybně injektoval `repository` namísto
`durableRepository`; první frontend build měl neúplné lokální závislosti,
opraveno offline frozen-lockfile instalací. První úplný profil 357/3 odhalil
callback `success` regresi a novou nepřipnutou import hranu: původní callback
zachován, parser přesunut zpět do vlastního modulu. První tři Electron pokusy
selhaly kvůli selektoru nastavení, aktivnímu VRAM filtru a změně portu
kontrolovaného provideru. Nic z toho není zamaskované jako první úspěšný běh.
Raw live receipt má v poslední položce `limitations` zděděný text kontrolovaného
harnessu; oprava této popisky je explicitně v indexu a machine-readable záznamu.

## Meze a použití

Skóre jsou průměry sedmi konkrétních oprav, nikoli procenta dokončených projektů.
Širší quick/full benchmark ani automatické přepínání vítězů se tím nedodává.
Fyzický Electron má soukromý profil, `NODE_ENV=production` a diagnostické
`--no-sandbox`; nedokazuje provoz každého uživatelského projektu.

Na disku zbývá přibližně 16 GiB. Nové automatické stahování může čekat na
rezervu; ruční měření stažených modelů tuto rezervu pro download nevyžaduje.
Gemma nebyla během tohoto průchodu znovu skórována ani automaticky odstraněna.
Původní otevřené okno drží starý frontend: po uložení práce je třeba jednou
zavřít Studio a otevřít ho ikonou. Modely → Kandidáti ukazují stažení;
Role → CODE → Kvalita a testy vede k novému srovnání a detailům.
