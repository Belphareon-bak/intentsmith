# Sběr všech lokálních modelů po druhé revizi sad

Autorita: explicitní pokyn operátora 20. 9. 2026; HANDOFF §5,
DIRECTION a nezměněný evaluační kontrakt. Stav: PREPARED / NOT_GRADED.

## Oprava před sběrem

- `cz_ambiguity_clarification`: X zůstává 5, Y je 7. Prohození projektů
  nyní selže na skutečně rozdílných hodnotách. Staré odpovědi se nepřepisují.
- `cz_grammar_correction`: čtyři věty, nikoli nepravdivý počet čtyř změn tvaru.
- Formátová kritéria CHAT jsou oddělená od obsahových již v rubrice,
  u VISION v exportu podkladů. Nemění obsahový průměr v ručním formuláři.
  Fence je zaznamenaná odchylka od zadání, nikoli automaticky provozní chyba:
  `extractJSON` v produkčním client.js podporuje JSON v Markdown bloku.
- Strojový podíl přesně správných polí není lidská známka podle §1.3.
  Poctivý pokus s kritickou chybou se posuzuje jako 0,25; nic/echo/hesla jako 0.
  Toto rozlišení neprovádí heuristika ani nepřijatý modelový hodnotitel.

## Předem stanovený panel

Dvanáct nainstalovaných různých digestů; žádné nové stahování ani mazání.
Textové role: deset modelů, společný kontext 16 384; VISION: osm modelů,
společný kontext 4 096. Dvě LLaVA mají deklarovaný kontext jen 4 096/8 192,
proto dostanou celý VISION profil; textový profil jim nebude zkrácen.
Záznam způsobilosti obsahuje každou vynechanou roli a důvod.

Každá úloha třikrát: CODE 210, CHAT 1 200, D1/D2/R1/R2 po 240,
VISION 552, celkem 2 922 plánovaných pokusů. Obrazová schopnost je ověřena
v `/api/show`, nikoli odhadnuta podle jména. Způsobilost v konkrétním profilu
se teprve ověřuje za běhu; podpora v manifestu ji sama nezaručuje.
Předchozí exclusion qwen3-coder z CODE je pro tento širší sběr překrytý
novým pokynem „všechny modely“ a změnou orákul; stará čísla se tím nevyvracejí.

Sériové modelové běhy, žádný lokální hodnotitel, stejné zadání a generační
limity pro všechny v dané roli. 240 minut maximálně na jedno modelové/profilové
měření, 12 hodin celá fronta; konec rozpočtu zůstává viditelný.
Modelová chyba se nesmí změnit na nulu prostředí. Cizí GPU práce se nezabíjí.
Provider zůstává připnutý 0.34.2-intentsmith.1; známé omezení účtování MTP
paměti je auditní výhrada, ne důkaz 22GB způsobilosti.

Evidence root:
`/home/belphareon/Projects/coworker/intentsmith-hunt-all-installed-20260920`.
`panel.json` zachovává inventory a celé `/api/show`; následný sběr má
vlastní identity, čas, odpovědi a provider logy. Starší sběr zůstává beze změn.

První výstup budou anonymní odpovědi pro stejný styl nezávislého posouzení.
Nejsou automaticky importované do produkční DB. Timer, aktivace vazeb,
mazání a rozhodovací autorita zůstávají vypnuté. Tento dokument není přijetí
hodnotitele ani závěr o vítězi.
