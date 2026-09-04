# 028 — Approval je výjimka, ne mýtné

**Stav:** přijaté (operátor, 2026-08-20)
**Nahrazuje výklad:** `024` §6, `025` — ne jejich text, ale to, jak se prováděly
**Souvisí:** `027` (jeden zapisovatel na soubor), `docs/mobile/SCREENS.md`

---

## 1. Co se rozhodlo

**Auto-approve je výchozí stav.** Agent zapisuje soubory bez ptaní. Approval je
**výjimka pro několik pojmenovaných situací**, ne mýtná brána před každým
zápisem.

Předchozí implementace (`9f0cb4f6` … `25c61a96`) postavila opak: jakmile je
rozhodovací rovina zapnutá, ptá se **vždycky**. Není to vada kódu — kód dělá,
co bylo zadané — je to **vada zadání**, kterou tohle rozhodnutí opravuje.

> Operátor, 2026-08-20: *„rozhodně není cílem abych povoloval každý zápis do
> souboru"*

---

## 2. Kdy se tedy ptát

Tři situace, které operátor pojmenoval. **Seznam je otevřený** — vznikl jako
první nástřel, může se rozšířit i zúžit:

| | Situace | Povaha |
|---|---|---|
| **a** | Změna směru proti tomu, co je v roadmapě projektu — je potřeba probrat, kudy dál | rozhodovací bod běhu |
| **b** | Něco nového, co se dosud neřešilo — řeší se milestone z roadmapy a je potřeba nové pravidlo | rozhodovací bod běhu |
| **c** | Zápis do **důležitého** souboru — secrety a podobné, co vážně ovlivňuje funkci projektu | zápis |

**Do klasických souborů je auto-approve víceméně default.**

### 2.1 Důsledek, který mění architekturu

**Dvě ze tří situací nemají se zápisem souboru nic společného.** `a` i `b` jsou
**rozhodovací body v běhu** — vzniknou v planneru, když agent narazí na rozpor
s roadmapou nebo na chybějící pravidlo. Ne když sáhne na disk.

To je dobrá zpráva: `src/approvals/authority.js` **není na soubory vázaná** —
bere volný `subjectType`, `subjectId` a `operationRef`. Pro `a` a `b` proto
nechybí mechanika, chybí **volající v planneru**.

A obráceně: **patch engine, skill write ani code cleaner approval nepotřebují.**
Potřebují zámek a atomický zápis, tedy infrastrukturu bez člověka v cestě.
Ptát se má až tehdy, když konkrétní zápis spadne do kategorie `c`.

### 2.2 Co ještě není rozhodnuté

**Co přesně je „důležitý soubor".** Secrety a `.env` jsou zřejmé. Migrace, CI,
manifesty balíčků, konfigurace projektu — to rozhodnuté není a hádat se nemá.
Seznam musí být čitelný a odsouhlasitelný, ne rozsypaný v podmínkách.

---

## 3. K čemu je mobilní aplikace

Tohle se v předchozích dokumentech ztrácelo, protože se řešily approvaly.
Approvaly jsou **jedna z funkcí**, ne účel.

> Operátor: *„zadávání úkolů do projektu (nebo dokonce vytváření nových
> projektů), funkce normálního chatu, využívání/spravování specialistů atd.,
> vlastně celého BE ale místo PC IDE z mobilu, trochu zjednodušeně"*

Mobil je **druhá plocha nad týmž backendem**, ne přívěsek pro odsouhlasování.

### 3.1 Zrcadlení PC ↔ mobil

Co se stane na jedné ploše, musí být vidět na druhé — a to **nejen u
approvalů**, ale stejně tak u **úkolů do projektu** a u **zpráv v chatu**.
U approvalů to už platí: jedna fronta, první odpověď vítězí, `decided_by` nese
identitu zařízení (viz `docs/mobile/MULTI-DEVICE.md`).

### 3.2 Skutečný stav povrchu — ať se to už neplete

Mobilní kontrakt má dnes **13 zmrazených rout**: health, párování, operace (3),
capabilities, konverzace (2), poslat zprávu, notifikace (2), approvaly (2).

Projekty, úkoly, roadmapa a specialisté **nejsou „nedodělané ani chybějící" —
jsou rozhodnuté a záměrně zaparkované**:

- `Projekty` **jsou** v `NAV_ITEMS` klienta jako položka `locked: true`, scope
  `read:projects` je v `SUPPORTED_SCOPES`;
- `MR-14` má stav `BLOCKED_BY_CONTRACT_AND_GATE1` (`F-055`) a `SCREENS.md`
  výslovně říká: *„Požadavek zůstává evidovaný — není odložený ani odstraněný"*;
- obrazovka `MS-12` je vyspecifikovaná a **nestaví se**;
- `Specialisté` a `Autonomní agenti` jsou v klientovi vypsaní jako připravované.

Rozšíření povrchu je předmětem `CONTRACT-V2-PROPOSAL.md` (šest domén, stav
`NÁVRH`, poslední review `CHANGES_REQUIRED`). **Není to nový nápad, je to
zablokovaná fronta.**

---

## 4. Co z toho plyne pro rozpracovanou práci

1. ~~**Otočit výchozí stav**~~ — **hotovo** (`src/executor/write-policy.js`,
   `tests/write-policy.test.js` 11 PASS). Ptaní řídí politika; bez pravidla se
   zapisuje. Deset běžných zápisů za sebou vyrobí **nula** approvalů a je to
   zapsané jako test.
2. **Fail-closed zůstává** v jiném smyslu: bez zapojené roviny se nezapisuje
   ne proto, že chybí souhlas, ale proto, že chybí zámek a záznam.
3. **Mediace zbylých zapisovatelů se zmenšuje** — dostanou sdílenou cestu
   (zámek, atomický zápis, záznam), ne approval.
4. **`a` a `b` potřebují planner**, ne zapisovatele.
5. **Zadání `docs/execution/approval-mediation.md`** se tímhle přepisuje.

---

## 5. Proč to nebylo poznat dřív

Slib zněl „všechny zápisy jdou přes jednu řízenou cestu" a to se dvakrát
kontrolovalo jako **rozsah** (kolik zapisovatelů je pokrytých), nikdy jako
**smysl** (má se u každého ptát?). Review i implementace hlídaly, aby cesta byla
úplná — a nikdo se nezeptal, jestli má být ptající.

Poučení do dalších rozhodnutí: u ochranné vrstvy se ptát nejen „pokrývá
všechno?", ale i **„kolikrát za běh se ozve?"**. Vrstva, která se ozve pokaždé,
je z pohledu uživatele k nerozeznání od rozbité.
