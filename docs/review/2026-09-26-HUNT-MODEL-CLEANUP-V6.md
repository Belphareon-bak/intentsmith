# D/R `model_cleanup`: oprava historického zadání

**Stav: opravený vývojový kontrakt; nové odpovědi a přejímka zatím chybí.** Tato změna se týká pouze čtyř úloh `d1/d2/r1/r2_model_cleanup`. Starých 312 odpovědí ani původních známek se nedotýká. Jejich 105 sporných kritérií nelze po změně promptu tiše přeznámkovat.

Historická migrace `2026_03_08_030_v103_model_overrides.js` na revizi `a3a00baa` má `role TEXT PRIMARY KEY` a `previous_model TEXT NOT NULL`. Přímý SQLite pokus potvrdil: `NULL` se odmítne, prázdný řetězec projde, druhý řádek pro stejnou roli se odmítne a dvě různé role mohou sdílet stejnou předchozí identitu. Původní reference a kritéria žádaly reprodukci `NULL` a některá znění tvrdila, že cesta k mazání není v dodaných výřezech, ačkoli `pre-handler.js:400–419` přímo posílá navržený název na `/api/delete`.

Nová verze přidává přesný úryvek migrace do každého veřejného promptu i původu zdroje. Reference, kritéria a negativní sondy nyní pracují s prázdným/whitespace názvem a deduplikací stejné kanonické identity **napříč různými rolemi**. Revize R1 výslovně rozlišuje správnost lokálního filtrování návrhů od nedostatečné ochrany skutečného mazacího kroku. Verze D/R sady je `role-semantic.6-model-cleanup-schema`; CHAT s nezměněnými úlohami zůstává na `role-semantic.5`.

Strojová [kontrola věrnosti historickému zdroji](/mnt/vi7000/intentsmith/evidence/hunt-model-cleanup-v6-20260926/source-audit.json) prošla pro všech 32 D/R úloh a všechny 76 oddílů; tato kontrola sama neposuzuje dostatek kontextu. Cílený test potvrzuje DDL a nepřítomnost nemožného `NULL` v nové rubrice. Všechny ostatní úlohy zůstaly jako JSON objekty beze změny.

Další hranice je GPU sběr přesně těchto čtyř nových zadání na dvou artefaktech se stejným profilem. I když se podaří, půjde o otevřené vývojové úlohy: tři opakování nejsou tři nezávislé historické případy a jejich souhrn nebude přijatým rozhodnutím o roli. Následné hodnocení musí být oddělené od syrového sběru a doložit správnou alternativu i věcný opak.
