# GPU hunt: oprava měřidel po nezávislém posouzení

Adresát: operátor a nezávislý reviewer. Autorita: pokyn operátora 20. 9. 2026,
WP-GPU-HUNT-HANDOFF-20260919 §5, DIRECTION a nezměněný evaluační kontrakt.

## Rozsah opravy před novým sběrem

- CODE: zadání pěti úloh popisují pouze upravovaný úsek, nikoli práci hotovou
  v okolním historickém fixture. Nové fingerprinty; původní identity jsou
  zaznamenané v `supersedesTaskFingerprint`. Historické výsledky se nemění.
  Dodatečné spustitelné kontroly ověřují zachování všech původních ownerů,
  jejich sdílenou/exkluzivní klasifikaci, cleanup identity a veřejné API.
  Oprava interpunkčního assertu se provádí pouze v odhozeném worktree orákula.
- D1/D2/R1/R2: skutečný připnutý kontext authority, identity, response třídy,
  spotřebitelů výsledku, producenta testových chyb a historických callerů.
  D2 připouští doloženou alternativní opravu a jiný doložený nebezpečný shortcut.
  Typed exception není skrytá podmínka tam, kde veřejný kontrakt dovoluje error result.
  Tápání opravené v odpovědi se netrestá; chybný aspekt se nenuluje opakovaně.
- CHAT: opraveny tři sporné veřejné kontrakty. Dvacet z 40 úloh nahrazeno
  vícepodmínkovými úlohami s deterministickým JSON orákulem; ostatních dvacet
  zůstává otevřených jazykových úloh pro nezávislé čtení. Zachováno 24 EN / 16 CS.
- VISION: 22 různých obrazových úloh a kontrola bez obrázku, od základního vjemu
  po spojování tabulek, verze, časová okna, kritickou cestu, měny a skryté údaje.
  Obrázky jsou syntetické a veřejné vývojové případy. Nejde o test fotografií
  ani o oddělený provozní holdout. Převaha správných odpovědí není sama vadou;
  rozlišitelnost nových úloh ještě musí ukázat sběr.
- Obsah a formát: strojový rozpad vykazuje obsahové skóre a formát zvlášť.
  Správný JSON uvnitř Markdown fence nedostane PASS pro striktní formát.
  VISION PASS vyžaduje všechna pole správně i správný formát, ne překročení 0,7.
- Produkční T5: `measurementReady=false` a `EVALUATOR_T5_FORBIDDEN` pro staré
  substringové sady. Přímé volání produkčního runneru je odmítá před inferencí.
  Historické známky zůstávají uložené. Nové otevřené úlohy jsou cestou sběru
  bez automatické známky; přijatý T4 hodnotitel stále neexistuje.
- Ruční runner zakazuje známkování cíle stejným digestem. Telemetrie
  `size == size_vram` se výslovně nepovažuje za nezávislý důkaz umístění;
  zachovávají se NVIDIA vzorky a provider log pro následný audit.

## Uzamčený plán nového sběru

Qwen3.8: všech sedm rolí; Devstral-small-2: šest textových rolí;
Ornith-1.5:9b: VISION; Gemma4:26b: CODE. Jde o již instalované artefakty.
Qwen a Devstral pokračují jako dvojice pro opravený kontext, Ornith jako
samostatná menší vision alternativa; Gemma rozšiřuje CODE, kde předchozí
Devstral nebyl přesvědčivý. To není závěr o kvalitě nových výsledků.

Tři opakování každé úlohy, stejné zadání a limity v rámci role, celkem
633 pokusů (D1/D2/R1/R2: po 48, CHAT: 240, VISION: 138, CODE: 63).
Bez umělého prodlužování testů; délka je pozorování, nikoli podmínka kvality.
Nový oddělený evidence root:
`/home/belphareon/Projects/coworker/intentsmith-hunt-repair-20260920`.
Raw odpovědi a anonymizovaný čtecí přehled jsou oddělené od jakýchkoli známek.
Kritéria s vadným zadáním zůstávají NULL, nevytvářejí chybu modelu; nové
zadání se nemíchá s odpověďmi získanými na starém zadání.

## Přejímací meze

Oprava kódu ani autorské sondy nejsou nezávislá přejímka. Dokud neproběhne
nové čtení odpovědí a oddělená provozní kvalifikace podle kontraktu, zůstávají
rozhodnutí, aplikace vazeb, mazání a timer neaktivní. Rozdíly průměrů ani
počet úloh samy neprokazují předpovědní platnost či nezávislost případů.
Sběr je vývojové měření, nikoli soutěž na novém holdoutu.
