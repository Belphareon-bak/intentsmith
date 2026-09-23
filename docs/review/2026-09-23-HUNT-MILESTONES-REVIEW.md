# GPU hunt — větší blok k revizi, 23. 9. 2026

**Stav: IMPLEMENTED_AND_OFFLINE_VERIFIED / REVIEW_PENDING / NOT_DEPLOYED.**
**Celkový autonomní GO: nevydán. Nová inference: 0.**

Autorita: pokračování explicitního zadání operátora „několik milníků“;
primární postup `WP-GPU-HUNT-HANDOFF-20260919.md §5`, direction a nezměněný
evaluační kontrakt. Souhlas s offline prací není GO pro nový CHAT přesběr.

Výchozí commit `750ba050`. Implementace: `f4ed4656` (CODE složka, replay,
konverzační sběr a nová sada), `9f876a4c` (matice), `c7c4f262` (zobrazení
celé konverzace ve Studiu). Žádná změna přiřazení rolí, mazání modelů,
produkčního importu známek, instalace ani plánovače.

## Kde začít review

- [Úplná matice: původní odpovědi, známky a nové CODE složky](/mnt/vi7000/intentsmith/evidence/hunt-milestones-20260923/review-matrix.html)
- [Nový CHAT: CZ/EN zadání vedle sebe, kritéria a rozpočet](/mnt/vi7000/intentsmith/evidence/hunt-milestones-20260923/chat-draft/review.html)
- [Autorské posouzení všech 30 textů CODE](/mnt/vi7000/intentsmith/evidence/hunt-milestones-20260923/code-prose-author-review.md)
- [Strojový doklad a hash přenositelného archivu](evidence/2026-09-23-hunt-milestones.json)

Původní osobní `comparison.html`, poznámky uživatele, surové odpovědi i
historické známky zůstaly zachované. Kontrola nového HTML porovnala obsah
všech **2 922 odpovědí i jejich původních známek**, nejen jejich počty.

## Milník 1 — vykonatelné CODE měření bez falešného významového PASS

`code-executable-component.1` je explicitní projekce na spustitelné chování,
nikoli opravené orákulum celé úlohy. V dočasné historické kopii vyřadí čtyři
přesně inventarizované assertions nad volným `detail`; veřejný checker
ověřuje přesné `confidence`, vítěze a ostatní API vlastnosti bez odhadování
významu prózy. Změněný nebo duplicitní text assertion projekci zastaví.
Původní testy ani uložené odpovědi se nepřepisují.

Výsledek má oddělené `technical` a `semantics`. Horní `score` je vždy
`null`, `passed: false`, `valid: false`, `decisionAuthority: false`.
Ani správné API s opačným vysvětlením proto nedostane celkové PASS.
Původní úplná sada zůstává za neprošlou přejímkou; tento profil ji neotevírá.

Před přehráním prošlo **53/53 kontrol** na všech sedmi aktivních úlohách:
reference, alternativy, rozbitý základ, prázdná odpověď, echo promptu,
rozdělené bloky, regrese původních ownerů a správné i rozporné varianty
prózy. Negované vysvětlení zůstane významově neověřené i při technické
jedničce. Kontroly napsal autor; nejde o nezávislou přejímku hodnotitele.

Potom proběhlo všech **210 uložených odpovědí: 10 modelů × 7 úloh × 3
opakování**, sériově, bez provideru a bez produkční DB. Před každou kontrolou
i odpovědí se kontroluje rezerva: RAM 6 GiB, dočasný FS 2 GiB, repo FS
20 GiB, evidence FS 5 GiB. Nedostatek ukončí běh s uloženým checkpointem.
Identita, hash odpovědi, původní prompt a volby inference musí souhlasit;
neúplná mřížka se odmítne před spuštěním. Výpadek měřidla není obsahová nula.

Technické výsledky: **152 úplně splněných, 58 nesplněných, 0 nevyhodnocených**.
Oproti původní obsahové známce se číslo liší u 19 odpovědí, všech v úloze
`patch_90eff80ecb8a`. Jde o jiný, užší rozsah hodnocení, nikoli o 19
prokázaných oprav původních známek.

| Model | Nová technická složka (7 úloh) |
| --- | ---: |
| qwen3.8:latest | 21/21 = 100,0 % |
| gemma4:26b | 18/21 = 85,7 % |
| qwen3.5:27b | 18/21 = 85,7 % |
| qwen3.6:27b | 18/21 = 85,7 % |
| devstral-small-2:latest | 15/21 = 71,4 % |
| qwen3-coder:latest | 15/21 = 71,4 % |
| ornith-1.5:9b | 13/21 = 61,9 % |
| phi4:14b | 13/21 = 61,9 % |
| qwen3:14b | 12/21 = 57,1 % |
| qwen3-30b-a3b:latest | 9/21 = 42,9 % |

Pořadí této dílčí osy není doporučení k výměně. Jsou to známé vývojové
úlohy, sedm úloh má pět deklarovaných skupin; opakování nejsou nové případy.
Žádná provozní kvalifikace tímto nevznikla.

## Milník 2 — rozsouzení konkrétních textů, nejen další procento

Runner nyní zachytí skutečný návrat funkce pro obě kvalitativní větve a
počty 1, 2, 3, 7, plus čtyři případy prahu a rychlosti. Pro všech 30
odpovědí problémové úlohy jsou tak dostupné **360 pozorovaných výstupů**.
Přehrání s tímto doplněním nezměnilo technické číslo žádné z 210 odpovědí.

Po přečtení osmi odlišných skupin těchto výstupů je moje oddělené posouzení:

- **27/30** odpovědí má správné ověřené API.
- **14/30** v rozhodných kvalitativních větvích také správně vysvětluje jistotu.
- **16/30** požadovanou jistotu z vysvětlení vynechá; to není pouhá jiná formulace.
- **3/30** mají správný text, ale chybí povinné API pole `confidence`.
- U **11/30** jsou v pozorovaných cestách obě složky správně.

Tři skutečná falešná odmítnutí formulace „jistota rozhodnutí“:
`0bb777148c9c`, `75d6bd34f679` (qwen3-coder), `223256373d26` (qwen3.5).
Dalších šestnáct zvýšení technické známky **neopravuje** chybějící vysvětlení.
Bez oddělených složek by se tato reálná chyba modelů ztratila.

Každý posudek má ID odpovědi, hash, konkrétní důvod a pozorované návraty
funkce. Je to **neslepé autorské posouzení k rozsouzení**, nikoli nezávislá
kalibrace. Nevznikla z něj automatická známka celé úlohy ani import do DB.

Další otevřená nejasnost zadání: samotná reference pod kladným prahem vrací
`basis: kvalita`, ale nevrací jistotu. Obecná věta o všech rozhodnutích
„kvalitou“ může zahrnovat i tuto větev. Před přijetím úplného náhradního
orákula je potřeba rozsah vyjasnit; nepenalizuji za něj selektivně modely.

## Milník 3 — skutečná konverzace a nová dvojjazyčná sada

Sběrač umí 1–4 navazující uživatelské tahy. Každý další tah dostane
**skutečnou předchozí odpověď téhož kandidáta**. Další pokus začíná znovu;
do vstupu nejdou reference ani rubrika. Každý provider návrat kontroluje
digest a verzi. Chyba, změna identity či vyčerpaný výstup zastaví pokračování
a zachová dosavadní transcript. Průběh nese číslo tahu a počet tahů.

Úplný transcript a receipts se uloží do existující historie, projdou přes
read model a slepý export. Provider identita v exportu zůstává jen v klíči.
Stávající známkování výslovně odmítne konverzaci bez hodnotitele celého
transcriptu: `EVALUATION_CONVERSATION_GRADER_NOT_AVAILABLE`. Poslední odpověď
se nesmí vydávat za zhodnocení celé konverzace.

Studio umí ve známém detailu uložené odpovědi zobrazit všechny tahy v pořadí
Uživatel → Model, počet dokončených tahů a neúplnost. Text odpovědi se
nevykonává jako HTML a poslední odpověď se nezobrazuje dvakrát. Tento zdroj
je ověřený, **není instalovaný do živého Studia**.

Nový návrh CHAT má **20 obsahově spárovaných CZ/EN scénářů / 40 úloh**:
19 otevřených tříkolových konverzací a jeden jednokolový striktní JSON
scénář ve dvou jazycích. Obsahuje opravy údajů, doptání, technické vysvětlení,
praktickou pomoc, tone rewrite, jednotky, změněná omezení, nejistotu,
citovanou injekci i hranice oprávnění. Jednodušší kvalifikační případy se
nevybíraly podle toho, které modely na nich předem prohrály.

Kritéria oddělují fakta, užitečnost, návaznost a srozumitelnost; každé má
hranici proti dvojímu započtení stejné chyby. Škála je 0 / 0,25 / 0,5 /
0,75 / 1 s popsanými kotvami. Váhy 0,4 / 0,3 / 0,2 / 0,1 jsou **návrh
k osobní revizi**, nikoli přijaté nové měřítko. Překlady a opakování sdílejí
skupinu. Dvacet autorských skupin není důkaz dvaceti nezávislých provozních
případů. Referenční příklady ilustrují poslední tah, nejsou celé gold dialogy.

Sada má `PREPARED_NOT_VALIDATED`, není připojená do běžného plánu CHAT
a nevytváří měřicí ani rozhodovací autoritu. Stará data z ní nejde dopočítat.
Technická a formátová osa původních úloh zůstávají samostatně dostupné;
jejich známky nebyly archivací odstraněny ani smíchány s konverzační kvalitou.

## Milník 4 — přehledná evidence a ohraničený příští sběr

Úplná matice ponechává všech 2 922 původních odpovědí a známek. Vedle nich
ukazuje 210 nově spuštěných technických složek a 30 oddělených autorských
posudků. Při kliknutí na úlohu jsou společné zadání, všechny modely,
všechna tři opakování, původní hodnocení i nová evidence. VISION obrázky
se skutečně dekódují. CHAT stále výslovně vykazuje staré pokrytí 38/40
a dvě úlohy mimo obsahové osy; nové zadání tuto starou mezeru neschovává.

Konkrétní návrh sběru, nikoli souhlas s jeho spuštěním:

| Etapa | Rozsah | Provider volání | Strop výstupních tokenů | Navržený wall-clock stop |
| --- | --- | ---: | ---: | ---: |
| Rychlý pilot | qwen3.8 + phi4; 6 CZ/EN dvojic, 1 opakování | 64 | 131 072 | 4 h |
| Celý vývojový panel | 10 dosavadních textových modelů; 20 dvojic, 3 opakování | 3 480 | 7 127 040 | 24 h |

Tyto časy jsou **stropy rozpočtu, ne ETA**. Součet timeoutů 300 s na volání
by byl 5 h 20 min / 290 h; wall-clock stop proto může zanechat částečný sběr.
Nové délky konverzací nebyly měřené. Jména a digesty v návrhu jsou historický
panel a musí se před spuštěním znovu ověřit. Pilot je pro kontrolu úloh
a osobní preference, nikoli pro rozhodnutí o pořadí modelů.

Příkaz `prepare-chat-conversation.mjs` **pouze připraví podklad**. Před
inferencí potřebuje etapa GO, zmrazenou rubriku, aktuální inventář a volající
runner vynucující celkový počet volání, tokenů a čas. Rozpočtový návrh sám
tyto limity nevynucuje. Odsouhlasený limit se nesmí při vyčerpání prodlužovat
bez nového rozhodnutí. Podrobnosti jsou v `chat-draft/plan.json`.

## Ověření a reprodukce

- **190 cílených testů PASS:** runner 68, CODE suite 29, role suites 33,
  read model + Studio render 26, acceptance 17, collection/conversation/
  component boundary 17. Nejde o plný L1 ani release gate.
- **53/53** skutečně spuštěných kontrol technické složky před replay.
- **210/210** odpovědí v každém ze dvou offline replayů; druhý přidal
  návratové hodnoty pro posouzení. Čísla technické složky jsou shodná.
- **18 kontrol** úplné matice a CHAT návrhu v Chromium; **7 kontrol**
  skutečné renderovací funkce Studia nad řízeným transcriptovým fixture.
  Headless, software rendering, diagnostický `--no-sandbox`; nejde o živý
  Electron/backend journey. Cesta kolekce přes skutečnou DB je navíc
  ověřená izolovaným integračním testem.
- První integrační test použil neplatnou verzi provideru `fixture`, správně
  selhal na identitě. Neúspěšný log je zachovaný; opraven je testovací vstup.

```sh
node --test tests/chat-conversation-capture.test.mjs tests/code-technical-projection.test.mjs tests/role-collection.test.mjs
node tests/code-patch-runner.test.js
node tests/code-patch-suite.test.js
node tests/model-evaluation-suites.test.js
node tests/model-evaluation-read-model.test.js
node tests/model-evaluation-acceptance.test.js
node scripts/manual/replay-code-components.mjs --help
node scripts/manual/prepare-chat-conversation.mjs --help
```

Reprodukční vstupy, příkazy, raw výstupy, původní i finální snapshoty
zdrojů a browser harness jsou v archivu. Replay zaznamenal pracovní strom
jako dirty a pinuje přesné hashe zdrojů; jejich shoda s finálním kódem byla
ověřena. To není modelové měření na nainstalovaném finálním releasu.

## Co ještě skutečně blokuje autonomní GO

1. Nezávisle přijmout významová kritéria a celé orákulum, včetně nově
   pojmenované hranice pod prahem. Technická projekce není jejich náhrada.
   Pět textových kontrol aktivní úlohy je v projekci odloženo do review;
   sedm dalších míst v rezervách z předchozího auditu zůstává nepřijatých.
2. Revidovat nové CHAT dvojice a rubriku, schválit a skutečně provést nový
   sběr. Tento balík neobsahuje nové modelové odpovědi ani novou přejímku
   D1/D2/R1/R2/VISION; jejich staré hodnoticí nejistoty nezmizely.
3. Přijmout nezávislého hodnotitele na nepoužitých odpovědích, v obou
   pořadích a s chybovostí po typech. Moje autorské názory touto přejímkou nejsou.
4. Pro každou uvolňovanou roli doložit přínos na nových oddělených
   provozních případech a skutečný průchod IntentSmithem; teprve potom
   otevřít její rozhodovací autoritu z odpovídající evidence.

Prakticky doporučuji revidovat nyní **tři falešná odmítnutí, chybějící
vysvětlení versus chybějící API a návrh 64volání pilotu**. Celý panel je
výrazně dražší samostatná volba. Žádný z těchto závěrů nedává svolení
k přepnutí role, mazání modelů nebo zapnutí nočního plánovače.
