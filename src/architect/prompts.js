// C.3 Architect Mode - LLM Prompts
// ══════════════════════════════════════════════════════════════════════════════

/**
 * System prompt pro Architect Mode
 * Důraz na krátké odpovědi, otázky, AI navrhuje - uživatel řídí
 */
export const ARCHITECT_SYSTEM = `Jsi C.3 Architect - AI asistent pro iterativní vývoj komplexních projektů.

## Tvůj styl komunikace

- KRÁTKÉ odpovědi (typicky 2-5 vět, max 400 znaků pokud to není nutné)
- Na konci 1-3 RELEVANTNÍ otázky podle kontextu
- TY navrhuješ, uživatel řídí a schvaluje
- Žádné zbytečné fráze, přímo k věci
- Když nevíš, PTEJ SE místo domýšlení

## Tvoje role

1. ARCHITECT - pomáháš definovat strukturu a design
2. PARTNER - vedeš dialog, ne monolog
3. PAMĚŤ - držíš kontext projektu a rozhodnutí

## Co NEDĚLÁŠ

- Nepíšeš kód dokud není definice kompletní
- Neskáčeš mezi bloky bez schválení
- Nepředpokládáš co uživatel chce - ptáš se
- Neděláš dlouhé výklady

## Formát odpovědi

Vždy odpovídej přirozeně, konverzačně. Na konci přidej relevantní otázky.`;

/**
 * Prompt pro vyhodnocení confidence definice
 */
export const EVALUATE_CONFIDENCE = `Vyhodnoť kompletnost definice bloku.

DEFINICE:
{definition}

Odpověz POUZE JSON:
{
  "confidence": 0.0-1.0,
  "missing": ["co chybí"],
  "ready": true/false,
  "summary": "jednořádkové shrnutí stavu"
}

Kritéria pro confidence:
- 0.0-0.3: Jen název, žádné detaily
- 0.3-0.5: Hrubý popis, chybí specifika
- 0.5-0.7: Dobrý popis, některé detaily chybí
- 0.7-0.85: Téměř kompletní, drobnosti
- 0.85-1.0: Kompletní, ready pro kód

ready=true pouze když confidence >= 0.7`;

/**
 * Prompt pro konverzaci v architect módu
 */
export const CONVERSATION = `{system}

## Aktuální kontext

{context}

## Uživatel říká:

{message}

---

Odpověz krátce a relevantně. Pokud je to vhodné, přidej 1-3 otázky na konci.`;

/**
 * Prompt pro návrh definice bloku
 */
export const PROPOSE_DEFINITION = `Na základě konverzace navrhni definici pro blok.

KONTEXT PROJEKTU:
{projectContext}

BLOK: {blockPath}

DOSAVADNÍ KONVERZACE:
{conversation}

Navrhni strukturovanou definici v markdown formátu:

# {blockName}

## Cíl
[Jednořádkový cíl]

## Popis
[Detailní popis - co to dělá, jak vypadá]

## Funkcionalita
- [Konkrétní funkce/chování]

## Závislosti
- [Na čem závisí]

## Poznámky
[Další důležité info]`;

/**
 * Prompt pro extrakci rozhodnutí z konverzace (pro history/decisions.md)
 */
export const EXTRACT_DECISIONS = `Z konverzace extrahuj klíčová rozhodnutí.

KONVERZACE:
{conversation}

Odpověz POUZE JSON:
{
  "decided": [
    {"what": "co bylo rozhodnuto", "why": "proč"}
  ],
  "rejected": [
    {"what": "co bylo zavrženo", "why": "proč"}
  ],
  "open": ["otevřené otázky"]
}`;

/**
 * Prompt pro replay/session summary
 */
export const SESSION_SUMMARY = `Shrň session pro budoucí referenci.

BLOK: {blockPath}
KONVERZACE:
{conversation}

ZMĚNY:
{changes}

Vytvoř strukturované shrnutí:
{
  "goal": "čeho jsme chtěli dosáhnout",
  "steps": [
    {"title": "krok", "action": "co se udělalo", "result": "výsledek"}
  ],
  "result": "finální výsledek",
  "files": [
    {"path": "cesta", "action": "created|modified"}
  ]
}`;

export const PROMPTS = {
  ARCHITECT_SYSTEM,
  EVALUATE_CONFIDENCE,
  CONVERSATION,
  PROPOSE_DEFINITION,
  EXTRACT_DECISIONS,
  SESSION_SUMMARY,
};

export default PROMPTS;
