# CHAT — ověření Opusova posudku finálního panelu

24. 9. 2026 · **AUDIT_NOT_GRADING_ACCEPTANCE / NO_AUTONOMOUS_GO**.

Autorita: operátor dodal druhý posudek navazující na hodnocení panelu.
Původní [první reference](2026-09-24-CHAT-PANEL-ASSESSMENT.md) a známky
zůstávají zachované. Tento záznam doplňuje nálezy; nejde o přijetí hodnotitele.

Úplný rozbor s ID, citacemi a reprodukcí:
[/mnt/vi7000/intentsmith/evidence/hunt-chat-panel-20260923/opus-reconciliation-20260924/REVIEW.md](/mnt/vi7000/intentsmith/evidence/hunt-chat-panel-20260923/opus-reconciliation-20260924/REVIEW.md).
Ve stejné složce je původní příloha, `observations.json` a pouze čtecí
`verify-observations.mjs`. SHA256 původní přílohy:
`2ca3212eea27248980aba4530244c3d8ae47b63f30a29b1360dd20e87e914064`.

## Výsledek

Ověřen celý řetězec 8 154 událostí a 3 472 jedinečných volání, vstupní
hashe a vazba všech 1 200 exportovaných dialogů na deník; 1 196 úplných,
čtyři neúplné. Všech 13 zdrojových hashů zmrazeného sběrače odpovídá.
Původní export, známky, zmrazení a hodnoticí HTML se nezměnily.

Opusův součet /72 je dodatečný binární výběr **12 z 20 scénářů**, zahrnuje
i striktní formát a vynechává oba scénáře se zacyklením. Dodaná příloha
neobsahuje známky po ID/kritériích ani skripty kontrol. Přesnou shodu
hodnotitelů nelze vypočítat. Pokrytí našich úplných návrhových známek
zůstává 119, jeden dialog čeká na rozsouzení, 1 076 úplných na hodnocení.

Faktické opravy/upřesnění:

- Sběrač odesílal **`think: false`**, nikoli neurčený režim. Zaznamenané
  vstupy neobsahují systémovou zprávu aplikace. Nejde o kvalifikaci
  produkčního CHATu se všemi jeho instrukcemi.
- Qwen3-30b také v šesti přečtených CS/EN dialozích oddělil citovaný pokyn
  od dat. Je to shoda s Opusovým sloupcem bezpečnosti, oprava jeho prózy.
- Gemma4 obsahuje zadané neveřejné údaje ve **dvou ze šesti dialogů**, vždy
  v předchozím tahu; kontrola samotné poslední zprávy by je nenašla.
- Dvě zacyklení jsou doložené obsahové vady. Původní technický stav
  `OUTPUT_BUDGET_EXHAUSTED` zůstává; doplněná anotace není smyšlená známka
  chybějících dalších tahů. Další dvě výjimky zneplatnila infrastruktura.
- 25 z 396 úplných trojic má tři bajtově shodné transkripty. To neříká,
  zda jsou ostatní obsahově rovnocenné. Zbytkový rozdíl či shodu modelů
  nelze bez párových známek a nejistoty prohlásit za statistický výsledek.

## Dopad na další práci

Qwen3.8 je předběžně preferovaný kandidát k provoznímu ověření; není
vyhlášen vítězem. Gemma4 je rychlá alternativa s doloženými výhradami,
Qwen3.6 má závažnou českou chybu u citované instrukce. Součet bodů ji
nesmí zakrýt. `src/config.js` sám nedokládá skutečný živý CHAT binding.

Nejdřív dokončit srovnatelné reference a rozsouzení; následně přejmout
místního hodnotitele na oddělených scénářích a ověřit kandidáty v reálném
CHAT profilu. Teplota 0,7 není automatická oprava: základní měření musí
odpovídat produkci, odlišná nastavení patří do zvláštního testu robustnosti.

Toto nové čtení znalo posudek i modely; není slepou přejímkou. Žádná
inference, změna přiřazení role, přepsání známek ani oslabení GPU ochrany.
Změna je dokumentační a doprovázená reprodukovaným auditem uložené evidence;
nový modelový běh ani nové L1 testování se tím netvrdí.
