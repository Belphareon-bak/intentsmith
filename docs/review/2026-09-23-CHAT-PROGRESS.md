# Živý průběh CHAT panelu a pokračování sběru

23. 9. 2026 — **PROGRESS_RUNTIME_VERIFIED / COLLECTION_RESUMED / NOT_GRADED**.

Operátor požádal o progress bar s logem, modelem, aktuální úlohou a počtem z celku. Navazuje na [spuštěný panel](2026-09-23-CHAT-PANEL.md).

## Otevření a význam údajů

**http://127.0.0.1:8765/** — místní přehled pouze pro čtení, každých pět sekund načte nová data bez obnovení celé stránky. Původní soubor `hunt-chat-panel-20260923/progress.html` přesměruje sem; jeho starý obsah je zachovaný jako `progress-static-before-dashboard.html`.

- Celkový progress: zpracované rozhovory / 1 200. Zahrnuje i neúplné pokusy, které jsou samostatně spočítané; dokončení sběru není správnost odpovědí.
- Volání: uložené odpovědi / nejvýše 3 480. U neúplného rozhovoru se další tahy nespouštějí a jsou uvedené jako neprovedené. Proto může být celý panel zpracovaný při nižším počtu volání.
- Aktuální model a jeho pořadí / 10, čitelný název úlohy a pořadí / 40, jazyk, opakování / 3 a tah rozhovoru / 3 (striktní JSON má jediný tah).
- Druhý progress bar pro model, uplynulý čas a orientační odhad jeho zbývající práce z posledních nejvýše 30 volání. Celková ETA se nevymýšlí z neznámé rychlosti zbytku panelu.
- Posledních 100 skutečných událostí deníku: zahájení tahu, uložení odpovědi, délka, tokeny, dokončení dialogu a důvod zastavení. Filtr problémů zahrnuje i starší výjimky; automatický posun lze vypnout.

Přehled ověřuje aktivní službu a otevřené okno deníku, nestačí starý nápis RUNNING v souboru provideru. Při výpadku spojení nebo starých datech zobrazí varování. Server poslouchá pouze na loopbacku, nepřijímá mutační požadavky, nepodává libovolné soubory a neposílá do přehledu obsah modelových odpovědí. Nevytváří modelová volání ani známky.

## Zjištěné zastavení a návaznost

Při vstupu do práce bylo první okno ukončené v **22:05:23 CEST** důvodem `GPU_FOREIGN_WORK_PRESENT`: 1 361 provedených volání, 471 zpracovaných dialogů, z toho 469 úplných a dvě vyčerpání výstupního rozpočtu. Bezprostřední ochrana zachytila cizí GPU práci; z uloženého důvodu nelze zpětně určit její aplikaci/PID. Žádný cizí proces nebyl ukončen.

Následná kontrola nenašla aktivní cizí výpočet ani rezidentní model systémové Ollamy. Sběr proto pokračuje v **`full-02`**, pod stejným zmrazeným plánem:
`3948c67362e610633830a0034b6c9f1134635348505d85eae8f41ab570451385`.

Nové okno má pouze zbývajících **2 119 volání, 6 691 086 výstupních tokenů a 80 597 sekund**. Předchozí čas 5 802,433 s plus nové maximum nepřekračují původních 24 hodin. Žádné další opakování ani navýšení celkového rozpočtu. První byte prefix deníku se zachovává; dokončené tahy se znovu negenerují. Původní report, exit 2 a částečný export `review/` zůstávají vedle nových výstupů.

Aktuální sběr řídí `intentsmith-chat-panel-20260923-full02.service`; náhled samostatně `intentsmith-chat-progress-20260923.service`. Ukončení náhledu neukončí sběr. Náhled sám žádné pozastavené měření nerestartuje.

```bash
systemctl --user status intentsmith-chat-panel-20260923-full02.service --no-pager
# Zastavit pouze modelový sběr:
systemctl --user stop intentsmith-chat-panel-20260923-full02.service
# Zastavit pouze místní přehled:
systemctl --user stop intentsmith-chat-progress-20260923.service
```

Po druhém okně vznikne samostatný report `full-02-summary.json`, `run-full-02-exit.json` a export `review-full-02/` s vlastním `export-full-02-exit.json`. Důkazy leží v `/mnt/vi7000/intentsmith/evidence/hunt-chat-panel-20260923/`.

## Ověření

- 18/18 testů sběrového deníku a přehledu: živý krok, nepravdivě starý RUNNING, zastavená ochrana, neúplný pokus a neprovedené tahy, oddělení obsahu odpovědi od logu.
- Artifact validation: 160/160, registr testů validní.
- Prohlížeč: 13 kontrol nad skutečným zastaveným během a šest kontrol po pokračování. Ověřené počty, oba bary, aktuální model/úloha/opakování, filtr logu, automatické aktualizace, výpadek a obnovení spojení i odmítnutí zápisových HTTP požadavků a libovolných cest. Simulace výpadku proběhla pouze uvnitř testovacího prohlížeče, ne zastavením sběru.

Změna přehledu nezasahuje do zmrazených promptů, parametrů generování ani implementace sběrače. Pokračování modelového sběru není přejímka hodnotitele ani autonomní GO.
