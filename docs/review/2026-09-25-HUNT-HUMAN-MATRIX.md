# GPU hunt — pracovní matice model × role

**Stav: KONTROLA LIDMI / BEZ AUTORITY K PŘIŘAZENÍ.** Procenta jsou orientační výsledky
ze tří různých vývojových zdrojů. Značka za číslem určuje zdroj; čísla s různou
značkou se nesmějí vzájemně řadit. Pomlčka je chybějící platná známka, nikoli 0 %.
Žádné číslo níže neprošlo společným posouzením GPT + Opus + operátor.

| Model | D1 | D2 | CODE | R1 | R2 | CHAT | VISION |
|---|---:|---:|---:|---:|---:|---:|---:|
| devstral-small-2:latest | 50.3 % H | 51.6 % H | — | 28.1 % H | 42.7 % H | 66.6 % O | 63.5 % H |
| gemma4:26b | 59.6 % H | 56.0 % H | — | 35.9 % H | 59.4 % H | 92.1 % O | 75.7 % V |
| llava-llama3:8b | — | — | — | — | — | — | — |
| llava:13b | — | — | — | — | — | — | — |
| ornith-1.5:9b | — | — | — | — | — | 86.3 % O | 77.6 % V |
| phi4:14b | 40.1 % H | 54.2 % H | — | 28.1 % H | 38.5 % H | 64.9 % O | — |
| qwen3-30b-a3b:latest | 41.7 % H | 49.7 % H | — | 20.8 % H | 34.4 % H | 80.2 % O | — |
| qwen3-coder:latest | 51.0 % H | 58.6 % H | — | 37.0 % H | 43.8 % H | 74.5 % O | — |
| qwen3.5:27b | 63.5 % H | 67.7 % H | — | — | 72.9 % H | 88.4 % O | 88.6 % H |
| qwen3.6:27b | 59.1 % H | 72.9 % H | — | 48.4 % H | 70.8 % H | 90.9 % O | 83.0 % H |
| qwen3.8:latest | 62.0 % H | 58.3 % H | — | 54.2 % H | 71.9 % H | 95.3 % O | 77.2 % V |
| qwen3:14b | 40.1 % H | 52.9 % H | — | 32.3 % H | — | 76.4 % O | — |

**H** = staré vývojové známky z 20. 9. na dřívější sadě; jedno čtení, známé
vady rubrik a neúplná pokrytí některých buněk. **O** = 400 CHAT rozhovorů
ohodnocených Opusem; jeden hodnotitel s předchozí expozicí identitám a bez
produkčního systémového promptu. **V** = aktuální izolovaná technická VISION
sada, 23 úloh × 3 opakování; autorské sondy orákula, bez provozní kvalifikace.
H a V u VISION ani H a O u CHAT se přímo neporovnávají.

CODE je v hlavní matici záměrně prázdný: plné orákulum selhalo na pozitivní
i negativní kontrole ještě před novou inferencí. Oddělená spustitelná dílčí
komponenta na známých případech: qwen3.8 21/21 = 100,0 %, Devstral 15/21 =
71,4 %. To **není** celé skóre CODE ani úspěšnost oprav v provozu.

## Co z matice doporučuji prověřit jako první

| Role | Přednostní srovnání | Důvod a omezení |
|---|---|---|
| D1 | qwen3.5 × qwen3.8 × qwen3.6 | Současné odpovědi všech tří jsou uložené, ale 72 odpovědí nemá přijaté známky. Historické rozdíly jsou malé. |
| D2 | qwen3.8 × qwen3.6 × gemma4 | Současná trojice má totožné zadání; staré procento favorizuje qwen3.6, ale vyžaduje nové čtení odpovědí. |
| CODE | qwen3.8 × Devstral | Nejprve přijmout opravené orákulum; dílčí technická výhoda qwen3.8 není doporučení k přiřazení. |
| R1 | qwen3.8 × qwen3.6 × gemma4 × Devstral | Odpovědi čtyř artefaktů jsou uložené; rozhodne věcná revize, nikoli stará prahová čísla. |
| R2 | Devstral × qwen3.6 × qwen3.8 | Současná trojice je připravena k ručnímu srovnání; historický výsledek Devstralu je varovný signál, ne prokázaná prohra. |
| CHAT | qwen3.5 × qwen3.8 × gemma4 | Opusův pilot zvýhodňuje qwen3.8; ověřit sporné dialogy a skutečný systémový prompt. |
| VISION | ornith × qwen3.8 × gemma4 | Aktuální rozdíl je malý; prověřit hlavně úlohy, kde se kandidáti rozcházejí. |

Pracovní volba podle dostupných čísel: D1 qwen3.5 (náskok jen 1,5 p. b.
před qwen3.8); D2 qwen3.6; R1 qwen3.8; R2 qwen3.5 (náskok jen 1,0 p. b.
před qwen3.8); CHAT qwen3.8; VISION ornith (náskok 0,4 p. b. před qwen3.8).
U CODE není platná pracovní volba. Tato pořadí **nemají rozhodovací autoritu**:
D/R čísla jsou ze starší sady, CHAT z jednoho neslepého posudku a VISION
z izolované technické sady. R1 a CODE navíc nesmí držet tentýž model.

Toto jsou **priority revize**, nikoli návrhy na změnu bindingů. Každá role
potřebuje doložené známky na stejné sadě a posouzení konkrétních sporných
odpovědí. U nové izolované kampaně je všech 312 sémantických odpovědí stále
bez známky. Oddělený balíček 120 odpovědí bez překryvu se starým je v
[revizním formuláři](/home/belphareon/Projects/coworker/intentsmith-hunt-human-review-20260925/new-120/review.html).
Je to vývojová sada, ne čerstvý přejímací holdout. Starých 192 odpovědí
nelze po otevření jejich identit vydávat za slepé hodnocení.

## Cesta k ověřenému doporučení v IntentSmithu

1. U všech 312 sémantických odpovědí D1/D2/R1/R2 dokončit známky po
   jednotlivých kritériích. Nových 120 odpovědí je odděleno pro revizi;
   starých 192 po odhalení identity zůstává vývojovou evidencí. U CODE
   nejprve opravit a přijmout orákulum; žádnou jeho plnou známku nenahrazovat
   dílčí technickou komponentou. Sporné odpovědi a konkrétní důvody
   projdeme spolu s Opusem a operátorem. Přepočet matice musí uvést pokrytí
   a shodu posudků, nejen jedno procento.
2. Až po kontrole lidských známek otestovat dva **nezávislé místní**
   hodnotitele na dosud nepoužité zaslepené sadě. Oba musí dostat stejné
   zadání a odpověď bez modelové identity i bez našich známek. V IntentSmithu
   zobrazit vedle každé odpovědi lidskou kotvu, oba posudky, důvody a
   rozpory. Přijetí hodnotitelů vyžaduje předem zamčené meze falešného
   přijetí/odmítnutí a rozhodnutí o neshodách; shoda na známé vývojové sadě
   nestačí. Do přijetí nesmějí hodnotitelé doporučovat výměnu role.
3. Po přijetí hodnotitelů může hunt měřit a doporučit kandidáta pro
   **jednu konkrétní roli** proti jejímu současnému modelu na párových
   nezávislých provozních případech. Musí doložit zlepšení či nezhoršení
   podle zamčeného pravidla, kritické chyby, rychlost a konflikty rolí
   (zejména CODE/R1). NEROZHODNUTO znamená ponechat model a sebrat další
   případy, nikoli vynutit vítěze. Samostatné přepínání zůstává poslední fází.
4. Závěrečná zkouška: hunt objeví několik nových modelů, bezpečně je
   stáhne, zaznamená přesnou identitu a průběh, otestuje a nechá místní
   hodnotitele oznámkovat. Doporučení nejprve zkontroluji já, potom
   operátor a Opus. Teprve taková prověrka může otevřít rozhodovací bránu.

## Přesné zdroje

- H: /mnt/vi7000/intentsmith/evidence/hunt-milestones-20260923/full-matrix.json · SHA256 `356d572e25ff8e5c6ec8b313a4be6b291f9790fed0a54e975ce2decc531c9663`
- O: /mnt/vi7000/intentsmith/evidence/hunt-chat-panel-20260923/opus-grading-20260924/scores-unblinded.json · SHA256 `550335d8c79536b0a622a45a67cbed1a2c6628d5d15379a03f60c2f122e81652`
- V: /home/belphareon/worktrees/is-mobile-completion-20260908/docs/review/evidence/2026-09-25-hunt-isolated-campaign.json · SHA256 `30551815a6ab8633d6113204ba0a5736e6794b4d13f058da23d953e4f6ff4054`
- CODE_component: /home/belphareon/worktrees/is-mobile-completion-20260908/docs/review/evidence/2026-09-25-hunt-code-components.json · SHA256 `1510d3642edb273462e64cfb1baec6fc0d66bc462e31a115809c6252b0366647`

Strojové buňky a jejich pokrytí: [JSON](evidence/2026-09-25-hunt-human-matrix-preview.json).
