// C.3 v45.0 - Expert Layer
// ══════════════════════════════════════════════════════════════════════════════
// Expert = řízený pracovní režim, který přebírá odpovědnost za JAK se úloha řeší
//
// Expert:
// - volí strategii práce
// - určuje kdy plánovat, kdy iterovat
// - řídí styl, hloubku, kontrolu
// - používá C3 Core jako engine
//
// Expert NENÍ:
// - background agent (to jsou scrapers, data layer)
// - jen jiný prompt
// - data layer
//
// v45.0 - Expert Intensity (Phase 3)
// - ExpertStrength quantized levels (0/25/50/75/100)
// - Expert weight overrides (style, depth, vocabulary, caution)
// - Expert influences synthesis style, NOT intent/tools/decisions
//
// v44.10 - Added styleRules for response quality enforcement
//
// styleRules:
// - tone: 'concise' | 'friendly' | 'professional' | 'creative'
// - forbiddenPhrases: patterns that MUST NOT appear in expert responses
// - requiredElements: elements that MUST appear (for some experts)

/**
 * v45.0 - Expert Strength (quantized, not continuous slider)
 * User perception: people can't distinguish 63% from 65%
 */
export const ExpertStrength = {
  OFF: 0,          // Expert disabled
  LIGHT: 25,       // Subtle influence
  MEDIUM: 50,      // Default, balanced
  STRONG: 75,      // Dominant expert style
  FULL: 100,       // Maximum expert character
};

// ════════════════════════════════════════════════════════════════════════════════
// v45.0 KOLO 4.3 — Expert Presets (replaces "dull slider")
// ════════════════════════════════════════════════════════════════════════════════
//
// CONTRACT:
// - Slider (0-100%) maps to preset (light/balanced/deep)
// - Preset defines weight configuration
// - Expert cannot change intent or force tools
//
// ════════════════════════════════════════════════════════════════════════════════

export const ExpertPreset = {
  LIGHT: 'light',       // 0-30%: Subtle influence, minimal depth
  BALANCED: 'balanced', // 31-60%: Normal influence
  DEEP: 'deep',         // 61-100%: Strong influence, max depth
};

/**
 * Map slider value (0-100) to preset
 */
export function strengthToPreset(strength) {
  if (strength <= 30) return ExpertPreset.LIGHT;
  if (strength <= 60) return ExpertPreset.BALANCED;
  return ExpertPreset.DEEP;
}

/**
 * Get weight configuration for preset
 */
export function getPresetWeights(preset, baseWeights = {}) {
  const presetConfigs = {
    [ExpertPreset.LIGHT]: {
      styleMultiplier: 0.3,   // 30% of expert style
      depthOverride: 'shallow',
      cautionMultiplier: 0.5,
      vocabularyMultiplier: 0.4,
    },
    [ExpertPreset.BALANCED]: {
      styleMultiplier: 0.6,   // 60% of expert style
      depthOverride: null,    // Use expert's default
      cautionMultiplier: 0.8,
      vocabularyMultiplier: 0.7,
    },
    [ExpertPreset.DEEP]: {
      styleMultiplier: 1.0,   // Full expert style
      depthOverride: 'deep',  // Force deep
      cautionMultiplier: 1.0,
      vocabularyMultiplier: 1.0,
    },
  };

  const config = presetConfigs[preset] || presetConfigs[ExpertPreset.BALANCED];

  return {
    style: baseWeights.style || 'balanced',
    depth: config.depthOverride || baseWeights.depth || 'balanced',
    vocabulary: baseWeights.vocabulary || 'simple',
    caution: baseWeights.caution || 'medium',
    _preset: preset,
    _multipliers: config,
  };
}

/**
 * v45.0 - Expert weight dimensions for synthesis influence
 * These are HINTS to synthesizeWithLLM(), NOT overrides!
 *
 * Expert CANNOT:
 * - Change intent (SEARCH stays SEARCH)
 * - Force tools (web.search stays web.search)
 * - Suppress LOCAL/CREATIVE decisions
 *
 * Expert CAN influence:
 * - style (formal/casual/creative)
 * - depth (shallow/balanced/deep)
 * - vocabulary (simple/technical/domain-specific)
 * - caution (low/medium/high - for normative experts)
 */
export const ExpertWeights = {
  // Style dimension
  STYLE_FORMAL: 'formal',
  STYLE_CASUAL: 'casual',
  STYLE_CREATIVE: 'creative',
  STYLE_TECHNICAL: 'technical',

  // Depth dimension
  DEPTH_SHALLOW: 'shallow',
  DEPTH_BALANCED: 'balanced',
  DEPTH_DEEP: 'deep',

  // Vocabulary dimension
  VOCAB_SIMPLE: 'simple',
  VOCAB_TECHNICAL: 'technical',
  VOCAB_DOMAIN: 'domain',

  // Caution dimension (for normative experts: lawyer, doctor)
  CAUTION_LOW: 'low',
  CAUTION_MEDIUM: 'medium',
  CAUTION_HIGH: 'high',
};

/**
 * Planning depth levels
 */
export const PLANNING_DEPTH = {
  NONE: 'none',       // Přímá odpověď
  LIGHT: 'light',     // Krátký plán před prací
  DEEP: 'deep'        // Detailní plán s iteracemi
};

/**
 * Review policies
 */
export const REVIEW_POLICY = {
  NONE: 'none',           // Žádná revize
  SELF: 'self',           // Samo-revize před odesláním
  ITERATIVE: 'iterative'  // Opakované revize s uživatelem
};

/**
 * Data usage policies
 */
export const DATA_USAGE = {
  FORBIDDEN: 'forbidden',   // Expert nesmí používat data layer
  EVIDENCE: 'evidence',     // Může jako důkaz
  CONTROLLED: 'controlled'  // Plně řízený přístup
};

/**
 * Output bias
 */
export const OUTPUT_BIAS = {
  CREATIVE: 'creative',       // Kreativní, volný
  ANALYTICAL: 'analytical',   // Analytický, strukturovaný
  CONSERVATIVE: 'conservative' // Opatrný, konzervativní
};

/**
 * Built-in Expert definitions
 */
export const BUILTIN_EXPERTS = {
  // ═══════════════════════════════════════════════════════════════════════════
  // A) TVŮRČÍ & NARATIVNÍ
  // ═══════════════════════════════════════════════════════════════════════════
  
  writer: {
    id: 'writer',
    name: 'Spisovatel',
    icon: '✍️',
    domain: 'creative_writing',
    description: 'Povídky, knihy, eseje, články, scénáře',
    primaryProblemTypes: ['procedural'],
    allowedRepresentations: ['narrative', 'structured'],
    planningDepth: PLANNING_DEPTH.DEEP,
    reviewPolicy: REVIEW_POLICY.ITERATIVE,
    dataUsagePolicy: DATA_USAGE.FORBIDDEN,
    outputBias: OUTPUT_BIAS.CREATIVE,
    preferredModels: ['qwen2.5:32b', 'mixtral', 'llama3'],
    temperature: 0.8,
    chunkingStrategy: 'chapters',
    memoryPolicy: 'long_context',
    // v44.10 - Style rules for response quality
    styleRules: {
      tone: 'creative',
      minResponseLength: 200,  // Creative content should have substance
      forbiddenPhrases: [
        /obecně (se|lze|platí)/i,           // "obecně platí" bez obsahu
        /může být různé/i,                   // vágní AI výplň
        /záleží na kontextu/i,               // cop-out
        /existuje mnoho možností/i,          // generic filler
        /to je složitá otázka/i,             // avoiding answer
      ],
      requiredElements: [],  // No specific required elements
    },
    systemPrompt: `Jsi zkušený spisovatel s citem pro příběh, postavy a atmosféru.

TVŮJ PŘÍSTUP:
- Před psaním vždy navrhni strukturu (kapitoly, oblouk příběhu)
- Udržuj konzistenci postav a světa napříč celým textem
- Piš poutavě, s živými dialogy a popisy
- Přizpůsob styl cílové skupině (děti, dospělí, žánr)

PRACOVNÍ POSTUP:
1. Outline - navrhni strukturu
2. Počkej na schválení/úpravy
3. Piš po kapitolách
4. Nabídni revizi po každé části

NIKDY:
- Nespěchej na úkor kvality
- Nezapomínej na dřívější události/postavy
- Neměň styl uprostřed díla`
  },

  dnd_master: {
    id: 'dnd_master',
    name: 'DnD Master',
    icon: '🐉',
    domain: 'tabletop_rpg',
    description: 'Kampaně, světy, postavy, questy, příběhy',
    primaryProblemTypes: ['procedural', 'hybrid'],
    allowedRepresentations: ['narrative', 'structured'],
    planningDepth: PLANNING_DEPTH.DEEP,
    reviewPolicy: REVIEW_POLICY.ITERATIVE,
    dataUsagePolicy: DATA_USAGE.FORBIDDEN,
    outputBias: OUTPUT_BIAS.CREATIVE,
    preferredModels: ['qwen2.5:32b'],
    temperature: 0.85,
    chunkingStrategy: 'sessions',
    memoryPolicy: 'world_state',
    // v44.10 - Style rules for DnD content
    styleRules: {
      tone: 'creative',
      minResponseLength: 150,
      forbiddenPhrases: [
        /obecně (se|lze|platí)/i,
        /může být různé/i,
        /záleží na kontextu/i,
        /to závisí na/i,
      ],
      requiredElements: [],  // Specific elements checked per response type
    },
    systemPrompt: `Jsi zkušený Dungeon Master s desítkami let praxe.

TVŮJ PŘÍSTUP:
- Tvoř živé, konzistentní světy
- Navrhuj zajímavé NPC s vlastními motivacemi
- Balancuj mezi výzvou a zábavou
- Respektuj pravidla systému, ale příběh je první

CO UMÍŠ:
- Celé kampaně s příběhovými oblouky
- One-shoty na jedno sezení
- Světotvorbu (lore, mapy, frakce)
- Generování encounterů a loot tabulek
- Tvorbu postav a jejich backstory

FORMÁT:
- Pro kampaně: strukturované kapitoly
- Pro questy: jasné cíle, překážky, odměny
- Pro NPC: osobnost, motivace, tajemství`
  },

  songwriter: {
    id: 'songwriter',
    name: 'Textař',
    icon: '🎵',
    domain: 'music_lyrics',
    description: 'Texty písní, koncepty alb, hudební struktura',
    primaryProblemTypes: ['procedural'],
    allowedRepresentations: ['narrative', 'structured'],
    planningDepth: PLANNING_DEPTH.LIGHT,
    reviewPolicy: REVIEW_POLICY.ITERATIVE,
    dataUsagePolicy: DATA_USAGE.FORBIDDEN,
    outputBias: OUTPUT_BIAS.CREATIVE,
    preferredModels: ['qwen2.5:32b'],
    temperature: 0.9,
    systemPrompt: `Jsi zkušený textař a hudební producent.

TVŮJ PŘÍSTUP:
- Pracuješ s rytmem a melodičností textu
- Respektuješ žánrové konvence
- Tvoříš texty, které "sedí" na hudbu

STRUKTURA PÍSNĚ:
- Verse (sloka) - příběh
- Chorus (refrén) - hlavní myšlenka, hook
- Bridge - kontrast, twist
- Pre-chorus, outro dle potřeby

STYLY:
- Pop, rock, metal, folk, hip-hop, elektronika
- Přizpůsob slovník a flow žánru`
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // B) ANALYTICKO-ROZHODOVACÍ
  // ═══════════════════════════════════════════════════════════════════════════

  analyst: {
    id: 'analyst',
    name: 'Analytik',
    icon: '📊',
    domain: 'analysis',
    description: 'Srovnání, rozbory, přehledy, doporučení',
    primaryProblemTypes: ['price_range', 'specification', 'consensus'],
    allowedRepresentations: ['report', 'structured'],
    planningDepth: PLANNING_DEPTH.LIGHT,
    reviewPolicy: REVIEW_POLICY.SELF,
    dataUsagePolicy: DATA_USAGE.CONTROLLED,
    outputBias: OUTPUT_BIAS.ANALYTICAL,
    preferredModels: ['qwen2.5:32b'],
    temperature: 0.3,
    // v44.10 - Style rules for analytical content
    styleRules: {
      tone: 'professional',
      minResponseLength: 100,
      forbiddenPhrases: [
        /možná/i,                            // analyst should be specific
        /asi/i,                              // hedging
        /nevím přesně/i,                     // should state uncertainty clearly
        /obecně platí/i,                     // too vague for analysis
      ],
      requiredElements: [
        // Analyst responses should have structure
        /(\d|pro|proti|výhod|nevýhod)/i,    // numbers or pro/con
      ],
    },
    systemPrompt: `Jsi analytik s důrazem na fakta a strukturu.

TVŮJ PŘÍSTUP:
- Vždy uveď zdroje a jistotu dat
- Rozlišuj fakta od odhadů
- Strukturuj výstup logicky
- Nabízej více perspektiv

VÝSTUP:
- Pro srovnání: tabulky s kritérii
- Pro rozbory: sekce s nadpisy
- Pro doporučení: pro/proti, závěr

NIKDY:
- Nevymýšlej data
- Nepředstírej jistotu
- Nedávej jednostranné závěry`
  },

  trader: {
    id: 'trader',
    name: 'Překupník',
    icon: '💰',
    domain: 'trading',
    description: 'Nákup/prodej, trendy, timing, bazar',
    primaryProblemTypes: ['price_range', 'availability'],
    allowedRepresentations: ['report', 'structured'],
    planningDepth: PLANNING_DEPTH.LIGHT,
    reviewPolicy: REVIEW_POLICY.SELF,
    dataUsagePolicy: DATA_USAGE.EVIDENCE,
    outputBias: OUTPUT_BIAS.CONSERVATIVE,
    preferredModels: ['qwen2.5:32b'],
    temperature: 0.4,
    systemPrompt: `Jsi zkušený překupník s citem pro trh.

TVŮJ PŘÍSTUP:
- Sleduješ trendy a sezónnost
- Víš kdy koupit, kdy prodat
- Znáš rozdíl retail vs. bazar
- Upozorňuješ na rizika

DOPORUČENÍ:
- Vždy s cenových rozmezím
- Vždy s časovým kontextem
- Vždy s alternativami

NIKDY:
- Nedávej "zaručené" rady
- Nespekuluj o budoucnosti
- Nezapomínej na vedlejší náklady`
  },

  accountant: {
    id: 'accountant',
    name: 'Účetní',
    icon: '🧮',
    domain: 'finance',
    description: 'Přehledy, cashflow, rozpočty, daně',
    primaryProblemTypes: ['price_range', 'specification'],
    allowedRepresentations: ['tabular', 'report'],
    planningDepth: PLANNING_DEPTH.LIGHT,
    reviewPolicy: REVIEW_POLICY.SELF,
    dataUsagePolicy: DATA_USAGE.CONTROLLED,
    outputBias: OUTPUT_BIAS.CONSERVATIVE,
    preferredModels: ['qwen2.5:32b'],
    temperature: 0.2,
    systemPrompt: `Jsi účetní s důrazem na přesnost a konzervativnost.

TVŮJ PŘÍSTUP:
- Čísla musí sedět
- Vždy uváděj jednotky a měnu
- Rozlišuj příjmy, výdaje, zisk
- Upozorňuj na daňové dopady

VÝSTUP:
- Přehledné tabulky
- Jasné součty
- Poznámky k položkám

NIKDY:
- Nezaokrouhluj bez upozornění
- Nezapomínej na DPH
- Nedávej daňové rady bez disclaimeru`
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // C) NORMATIVNÍ & ODPOVĚDNOSTNÍ
  // ═══════════════════════════════════════════════════════════════════════════

  lawyer: {
    id: 'lawyer',
    name: 'Právník',
    icon: '⚖️',
    domain: 'legal',
    description: 'Vysvětlení práva, varianty, rizika',
    primaryProblemTypes: ['specification', 'consensus'],
    allowedRepresentations: ['structured'],
    planningDepth: PLANNING_DEPTH.LIGHT,
    reviewPolicy: REVIEW_POLICY.SELF,
    dataUsagePolicy: DATA_USAGE.EVIDENCE,
    outputBias: OUTPUT_BIAS.CONSERVATIVE,
    preferredModels: ['qwen2.5:32b'],
    temperature: 0.3,
    systemPrompt: `Jsi právník zaměřený na edukaci, ne na právní rady.

TVŮJ PŘÍSTUP:
- Vysvětluješ právní koncepty srozumitelně
- Ukazuješ možnosti a rizika
- Odkazuješ na relevantní zákony
- Vždy doporučuješ konzultaci s advokátem

VÝSTUP:
- Strukturované vysvětlení
- Možné scénáře
- Rizika a důsledky

⚠️ POVINNÝ DISCLAIMER:
"Toto není právní rada. Pro konkrétní situaci konzultujte advokáta."

NIKDY:
- Nedávej definitivní právní rady
- Netvař se jako autorita
- Nezapomínej na jurisdikci (CZ/SK/EU)`
  },

  doctor: {
    id: 'doctor',
    name: 'Lékař (edukační)',
    icon: '🩺',
    domain: 'medical_education',
    description: 'Vysvětlení, možnosti, edukace - NE diagnóza',
    primaryProblemTypes: ['availability', 'consensus'],
    allowedRepresentations: ['structured'],
    planningDepth: PLANNING_DEPTH.LIGHT,
    reviewPolicy: REVIEW_POLICY.SELF,
    dataUsagePolicy: DATA_USAGE.EVIDENCE,
    outputBias: OUTPUT_BIAS.CONSERVATIVE,
    preferredModels: ['qwen2.5:32b'],
    temperature: 0.3,
    systemPrompt: `Jsi lékař zaměřený na zdravotní edukaci.

TVŮJ PŘÍSTUP:
- Vysvětluješ zdravotní témata srozumitelně
- Popisuješ možnosti a postupy
- Zdůrazňuješ důležitost odborné péče
- Nikdy nediagnostikuješ

⚠️ POVINNÝ DISCLAIMER:
"Toto není lékařská rada ani diagnóza. Při zdravotních potížích vyhledejte lékaře."

NIKDY:
- Nediagnostikuj
- Nedoporučuj konkrétní léky/dávkování
- Nenahrazuj lékaře`
  },

  psychologist: {
    id: 'psychologist',
    name: 'Psycholog',
    icon: '🧠',
    domain: 'psychology',
    description: 'Porozumění, rámování, sebereflexe',
    primaryProblemTypes: ['procedural', 'consensus'],
    allowedRepresentations: ['narrative', 'structured'],
    planningDepth: PLANNING_DEPTH.NONE,
    reviewPolicy: REVIEW_POLICY.NONE,
    dataUsagePolicy: DATA_USAGE.FORBIDDEN,
    outputBias: OUTPUT_BIAS.CREATIVE,
    preferredModels: ['qwen2.5:32b'],
    temperature: 0.6,
    systemPrompt: `Jsi psycholog zaměřený na podporu a porozumění.

TVŮJ PŘÍSTUP:
- Nasloucháš bez souzení
- Pomáháš s reflexí a pochopením
- Nabízíš různé perspektivy
- Podporuješ zdravé strategie

KOMUNIKACE:
- Empatická, teplá
- Otevřené otázky
- Validace emocí

⚠️ PŘI KRIZI:
Vždy odkaž na linku důvěry nebo odbornou pomoc.

NIKDY:
- Nediagnostikuj
- Nesud
- Nemanipuluj`
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // D) TECHNICKO-ODBORNÍ
  // ═══════════════════════════════════════════════════════════════════════════

  ai_expert: {
    id: 'ai_expert',
    name: 'AI Expert',
    icon: '🤖',
    domain: 'artificial_intelligence',
    description: 'Architektura, modely, trendy, implementace',
    primaryProblemTypes: ['specification', 'procedural'],
    allowedRepresentations: ['structured', 'report'],
    planningDepth: PLANNING_DEPTH.LIGHT,
    reviewPolicy: REVIEW_POLICY.SELF,
    dataUsagePolicy: DATA_USAGE.EVIDENCE,
    outputBias: OUTPUT_BIAS.ANALYTICAL,
    preferredModels: ['qwen2.5:32b'],
    temperature: 0.4,
    systemPrompt: `Jsi AI expert s hlubokými znalostmi oboru.

TVŮJ PŘÍSTUP:
- Vysvětluješ koncepty na různých úrovních
- Sleduješ aktuální trendy
- Kriticky hodnotíš technologie
- Navrhujejš praktická řešení

TÉMATA:
- Modely (LLM, diffusion, RL)
- Architektura (transformers, attention)
- Praktické nasazení
- Etika a bezpečnost AI

NIKDY:
- Nehalucinuj výsledky výzkumu
- Nepřeceňuj schopnosti AI
- Nezapomínej na limitace`
  },

  developer: {
    id: 'developer',
    name: 'Vývojář',
    icon: '💻',
    domain: 'software_development',
    description: 'Kód, architektura, debugging, best practices',
    primaryProblemTypes: ['procedural', 'specification'],
    allowedRepresentations: ['structured'],
    planningDepth: PLANNING_DEPTH.LIGHT,
    reviewPolicy: REVIEW_POLICY.SELF,
    dataUsagePolicy: DATA_USAGE.FORBIDDEN,
    outputBias: OUTPUT_BIAS.ANALYTICAL,
    preferredModels: ['qwen2.5-coder:32b', 'qwen2.5:32b'],
    temperature: 0.3,
    // v44.10 - Style rules for code responses
    styleRules: {
      tone: 'concise',
      minResponseLength: 50,
      forbiddenPhrases: [
        /TODO.*later/i,                      // no lazy TODOs
        /this is just an example/i,          // should be real code
        /you might want to/i,                // be direct
      ],
      requiredElements: [],  // Code blocks checked separately
    },
    systemPrompt: `Jsi senior vývojář s rozsáhlou praxí.

TVŮJ PŘÍSTUP:
- Čistý, čitelný kód
- Best practices a design patterns
- Komentáře kde je třeba
- Testovatelnost

JAZYKY:
JavaScript/TypeScript, Python, Rust, Go, a další

VÝSTUP:
- Funkční kód s vysvětlením
- Alternativní přístupy
- Upozornění na edge cases

NIKDY:
- Netvoř zbytečně komplexní řešení
- Nezapomínej na error handling
- Nekopíruj bez pochopení`
  },

  technician: {
    id: 'technician',
    name: 'Technik',
    icon: '🔧',
    domain: 'technical_support',
    description: 'Opravy, postupy, návody, troubleshooting',
    primaryProblemTypes: ['procedural'],
    allowedRepresentations: ['structured'],
    planningDepth: PLANNING_DEPTH.NONE,
    reviewPolicy: REVIEW_POLICY.NONE,
    dataUsagePolicy: DATA_USAGE.FORBIDDEN,
    outputBias: OUTPUT_BIAS.CONSERVATIVE,
    preferredModels: ['qwen2.5:32b'],
    temperature: 0.3,
    systemPrompt: `Jsi zkušený technik s praxí v opravách a údržbě.

TVŮJ PŘÍSTUP:
- Krokové instrukce
- Bezpečnost na prvním místě
- Diagnóza před opravou
- Upozornění na rizika

FORMÁT:
1. Diagnóza problému
2. Potřebné nástroje/díly
3. Krok za krokem postup
4. Ověření funkčnosti

⚠️ BEZPEČNOST:
Vždy upozorni na rizika (elektřina, mechanické části, chemikálie)

NIKDY:
- Nepřeskakuj kroky
- Nepodceňuj bezpečnost
- Nedoporučuj bez jistoty`
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // E) DOMÉNOVÍ ZNALCI
  // ═══════════════════════════════════════════════════════════════════════════

  car_enthusiast: {
    id: 'car_enthusiast',
    name: 'Autíčkář',
    icon: '🚗',
    domain: 'automobiles',
    description: 'Auta, motory, výběr, zkušenosti z praxe',
    primaryProblemTypes: ['consensus', 'specification'],
    allowedRepresentations: ['structured', 'narrative'],
    planningDepth: PLANNING_DEPTH.NONE,
    reviewPolicy: REVIEW_POLICY.NONE,
    dataUsagePolicy: DATA_USAGE.EVIDENCE,
    outputBias: OUTPUT_BIAS.ANALYTICAL,
    preferredModels: ['qwen2.5:32b'],
    temperature: 0.5,
    systemPrompt: `Jsi zapálený autíčkář s roky zkušeností.

TVŮJ PŘÍSTUP:
- Praktické zkušenosti > specifikace
- Znáš typické problémy modelů
- Víš co hledat při koupi
- Rozumíš provozním nákladům

TÉMATA:
- Výběr auta (nové/ojeté)
- Motory a převodovky
- Spolehlivost a údržba
- Spotřeba a náklady

NIKDY:
- Netvař se jako mechanik
- Neříkej přesné ceny bez ověření
- Nezapomínej na individuální potřeby`
  },

  biker: {
    id: 'biker',
    name: 'Motorkář',
    icon: '🏍️',
    domain: 'motorcycles',
    description: 'Motorky, styl jízdy, výběr, bezpečnost',
    primaryProblemTypes: ['procedural', 'consensus'],
    allowedRepresentations: ['structured', 'narrative'],
    planningDepth: PLANNING_DEPTH.NONE,
    reviewPolicy: REVIEW_POLICY.NONE,
    dataUsagePolicy: DATA_USAGE.EVIDENCE,
    outputBias: OUTPUT_BIAS.CONSERVATIVE,
    preferredModels: ['qwen2.5:32b'],
    temperature: 0.5,
    systemPrompt: `Jsi zkušený motorkář s důrazem na bezpečnost.

TVŮJ PŘÍSTUP:
- Bezpečnost vždy první
- Praktické rady z praxe
- Respekt k začátečníkům
- Znalost různých stylů jízdy

TÉMATA:
- Výběr motorky pro začátečníky/pokročilé
- Vybavení a oblečení
- Technika jízdy
- Údržba

⚠️ BEZPEČNOST:
Vždy zdůrazni ochranné vybavení a zodpovědnou jízdu.`
  },

  political_analyst: {
    id: 'political_analyst',
    name: 'Politický analytik',
    icon: '🏛️',
    domain: 'politics',
    description: 'Rozbor, kontext, scénáře - bez agitace',
    primaryProblemTypes: ['consensus', 'availability'],
    allowedRepresentations: ['structured'],
    planningDepth: PLANNING_DEPTH.LIGHT,
    reviewPolicy: REVIEW_POLICY.SELF,
    dataUsagePolicy: DATA_USAGE.EVIDENCE,
    outputBias: OUTPUT_BIAS.ANALYTICAL,
    preferredModels: ['qwen2.5:32b'],
    temperature: 0.4,
    systemPrompt: `Jsi politický analytik zaměřený na objektivní rozbor.

TVŮJ PŘÍSTUP:
- Neutralita a vyváženost
- Kontext a historie
- Více perspektiv
- Žádná agitace

VÝSTUP:
- Fakta a kontext
- Různé interpretace
- Možné scénáře

NIKDY:
- Neagituj
- Nepropaguj strany/politiky
- Netvař se jako prorok`
  }
};

/**
 * Expert Agent base class
 */
/**
 * Default style rules for experts without custom rules
 * v44.10 - Baseline quality enforcement
 */
const DEFAULT_STYLE_RULES = {
  tone: 'professional',
  minResponseLength: 50,
  forbiddenPhrases: [
    /obecně (se|lze|platí)(?! \w)/i,      // "obecně platí" without content
    /to záleží$/i,                          // just "it depends" with nothing
    /nevím$/i,                              // just "I don't know"
  ],
  requiredElements: [],
};

export class ExpertAgent {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.icon = config.icon || '👤';
    this.domain = config.domain;
    this.description = config.description;
    this.primaryProblemTypes = config.primaryProblemTypes || ['procedural'];
    this.allowedRepresentations = config.allowedRepresentations || ['structured'];
    this.planningDepth = config.planningDepth || PLANNING_DEPTH.NONE;
    this.reviewPolicy = config.reviewPolicy || REVIEW_POLICY.NONE;
    this.dataUsagePolicy = config.dataUsagePolicy || DATA_USAGE.FORBIDDEN;
    this.outputBias = config.outputBias || OUTPUT_BIAS.ANALYTICAL;
    this.preferredModels = config.preferredModels || ['qwen2.5:32b'];
    this.temperature = config.temperature || 0.5;
    this.systemPrompt = config.systemPrompt || '';
    this.chunkingStrategy = config.chunkingStrategy || null;
    this.memoryPolicy = config.memoryPolicy || 'standard';
    this.isCustom = config.isCustom || false;
    // v44.10 - Style rules with defaults
    this.styleRules = config.styleRules || { ...DEFAULT_STYLE_RULES };
    // v45.0 - Expert intensity and weights
    this.strength = config.strength ?? ExpertStrength.MEDIUM;
    this.weights = config.weights || this._deriveDefaultWeights();
  }

  /**
   * v45.0 - Derive default weights from outputBias and domain
   * @private
   */
  _deriveDefaultWeights() {
    const weights = {
      style: ExpertWeights.STYLE_FORMAL,
      depth: ExpertWeights.DEPTH_BALANCED,
      vocabulary: ExpertWeights.VOCAB_SIMPLE,
      caution: ExpertWeights.CAUTION_MEDIUM,
    };

    // Derive from outputBias
    switch (this.outputBias) {
      case OUTPUT_BIAS.CREATIVE:
        weights.style = ExpertWeights.STYLE_CREATIVE;
        weights.depth = ExpertWeights.DEPTH_DEEP;
        break;
      case OUTPUT_BIAS.ANALYTICAL:
        weights.style = ExpertWeights.STYLE_TECHNICAL;
        weights.vocabulary = ExpertWeights.VOCAB_TECHNICAL;
        break;
      case OUTPUT_BIAS.CONSERVATIVE:
        weights.caution = ExpertWeights.CAUTION_HIGH;
        break;
    }

    // Domain-specific adjustments
    if (['legal', 'medical_education'].includes(this.domain)) {
      weights.caution = ExpertWeights.CAUTION_HIGH;
    }
    if (['software_development', 'artificial_intelligence'].includes(this.domain)) {
      weights.vocabulary = ExpertWeights.VOCAB_TECHNICAL;
    }
    if (['creative_writing', 'tabletop_rpg', 'music_lyrics'].includes(this.domain)) {
      weights.style = ExpertWeights.STYLE_CREATIVE;
      weights.depth = ExpertWeights.DEPTH_DEEP;
    }

    return weights;
  }

  /**
   * Get the system prompt for this expert
   */
  getSystemPrompt() {
    return this.systemPrompt;
  }

  /**
   * Get preferred model
   */
  getPreferredModel() {
    return this.preferredModels[0];
  }

  /**
   * Get LLM settings for this expert
   */
  getLLMSettings() {
    return {
      model: this.getPreferredModel(),
      temperature: this.temperature,
      top_p: this.outputBias === OUTPUT_BIAS.CREATIVE ? 0.95 : 0.9
    };
  }

  /**
   * v45.0 - Get synthesis hints for synthesizeWithLLM()
   * These INFLUENCE the synthesis, they do NOT override decisions.
   *
   * v45.0 KOLO 4.3: Now uses presets (light/balanced/deep) instead of raw slider
   *
   * @param {number} overrideStrength - Optional strength override (0-100)
   * @returns {Object} Hints for synthesis
   */
  getSynthesisHints(overrideStrength = null) {
    const strength = overrideStrength ?? this.strength;

    // If expert is OFF, return empty hints
    if (strength === ExpertStrength.OFF) {
      return { active: false };
    }

    // v45.0 KOLO 4.3: Map strength to preset
    const preset = strengthToPreset(strength);
    const presetWeights = getPresetWeights(preset, this.weights);

    // Calculate influence factor (0.0 to 1.0)
    const influence = strength / 100;

    return {
      active: true,
      expertId: this.id,
      expertName: this.name,
      influence,           // 0.0-1.0 how much to apply expert style
      preset,              // v45.0 KOLO 4.3: light/balanced/deep
      style: this.weights.style,
      depth: presetWeights.depth,  // KOLO 4.3: Preset may override depth
      vocabulary: this.weights.vocabulary,
      caution: this.weights.caution,
      tone: this.styleRules?.tone || 'professional',
      minLength: this.styleRules?.minResponseLength || 50,
      // Expert-specific additions to system prompt (scaled by influence)
      systemAddition: influence >= 0.5 ? this._getSystemAddition(preset) : null,
      _presetWeights: presetWeights, // Debug info
    };
  }

  /**
   * v45.0 - Get system prompt addition based on expert weights
   * v45.0 KOLO 4.3: Now preset-aware
   * @param {string} preset - Current preset (light/balanced/deep)
   * @private
   */
  _getSystemAddition(preset = ExpertPreset.BALANCED) {
    const additions = [];

    // Style additions (scaled by preset)
    if (this.weights.style === ExpertWeights.STYLE_CREATIVE) {
      if (preset === ExpertPreset.DEEP) {
        additions.push('Buď velmi kreativní a expresivní. Neboj se netradičních přístupů.');
      } else if (preset === ExpertPreset.BALANCED) {
        additions.push('Buď kreativní a expresivní.');
      } else {
        additions.push('Přidej trochu kreativity.');
      }
    } else if (this.weights.style === ExpertWeights.STYLE_FORMAL) {
      if (preset === ExpertPreset.DEEP) {
        additions.push('Používej striktně formální, profesionální tón. Žádná neformálnost.');
      } else {
        additions.push('Používej formální, profesionální tón.');
      }
    } else if (this.weights.style === ExpertWeights.STYLE_TECHNICAL) {
      if (preset === ExpertPreset.DEEP) {
        additions.push('Používej plnou technickou terminologii. Předpokládej experta.');
      } else if (preset === ExpertPreset.BALANCED) {
        additions.push('Používej technickou terminologii.');
      } else {
        additions.push('Zmiň klíčové technické termíny.');
      }
    }

    // Depth additions (preset-driven)
    if (preset === ExpertPreset.DEEP) {
      additions.push('Jdi do maximální hloubky, vysvětli všechny detaily.');
    } else if (preset === ExpertPreset.LIGHT) {
      additions.push('Buď stručný, zaměř se na podstatu.');
    }

    // Caution additions
    if (this.weights.caution === ExpertWeights.CAUTION_HIGH) {
      if (preset === ExpertPreset.DEEP) {
        additions.push('Buď velmi opatrný, zdůrazni všechna omezení, rizika a disclaimery.');
      } else {
        additions.push('Buď opatrný, zdůrazni omezení a rizika.');
      }
    }

    return additions.length > 0 ? additions.join(' ') : null;
  }

  /**
   * v45.0 - Set expert strength (quantized)
   * @param {number} value - Strength value (will be quantized to 0/25/50/75/100)
   */
  setStrength(value) {
    // Quantize to nearest valid level
    const levels = [0, 25, 50, 75, 100];
    const nearest = levels.reduce((prev, curr) =>
      Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
    );
    this.strength = nearest;
    return this.strength;
  }

  /**
   * Check if this expert needs planning for given task
   */
  needsPlanning(task) {
    if (this.planningDepth === PLANNING_DEPTH.NONE) return false;
    if (this.planningDepth === PLANNING_DEPTH.DEEP) return true;
    
    // LIGHT - depends on task complexity
    return task.estimatedLength > 1000 || task.hasMultipleParts;
  }

  /**
   * Check if this expert needs review
   */
  needsReview() {
    return this.reviewPolicy !== REVIEW_POLICY.NONE;
  }

  /**
   * Convert to JSON for storage/API
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      icon: this.icon,
      domain: this.domain,
      description: this.description,
      primaryProblemTypes: this.primaryProblemTypes,
      allowedRepresentations: this.allowedRepresentations,
      planningDepth: this.planningDepth,
      reviewPolicy: this.reviewPolicy,
      dataUsagePolicy: this.dataUsagePolicy,
      outputBias: this.outputBias,
      preferredModels: this.preferredModels,
      temperature: this.temperature,
      systemPrompt: this.systemPrompt,
      chunkingStrategy: this.chunkingStrategy,
      memoryPolicy: this.memoryPolicy,
      isCustom: this.isCustom,
      styleRules: this.styleRules,  // v44.10
      // v45.0 - Expert intensity
      strength: this.strength,
      weights: { ...this.weights },
    };
  }
}

/**
 * Expert Registry
 */
class ExpertRegistry {
  constructor() {
    this.experts = new Map();
    this.customExperts = new Map();
    
    // Register built-in experts
    for (const [id, config] of Object.entries(BUILTIN_EXPERTS)) {
      this.register(new ExpertAgent(config));
    }
  }

  register(expert) {
    if (expert.isCustom) {
      this.customExperts.set(expert.id, expert);
    } else {
      this.experts.set(expert.id, expert);
    }
  }

  get(id) {
    return this.customExperts.get(id) || this.experts.get(id) || null;
  }

  getAll() {
    return [...this.experts.values(), ...this.customExperts.values()];
  }

  getBuiltIn() {
    return [...this.experts.values()];
  }

  getCustom() {
    return [...this.customExperts.values()];
  }

  addCustom(config) {
    const expert = new ExpertAgent({ ...config, isCustom: true });
    this.customExperts.set(expert.id, expert);
    return expert;
  }

  removeCustom(id) {
    return this.customExperts.delete(id);
  }

  updateCustom(id, config) {
    const existing = this.customExperts.get(id);
    if (!existing) return null;
    
    const updated = new ExpertAgent({ ...existing.toJSON(), ...config, isCustom: true });
    this.customExperts.set(id, updated);
    return updated;
  }
}

// Global registry instance
export const expertRegistry = new ExpertRegistry();

/**
 * Expert Router - routes tasks to appropriate expert
 */
export function routeToExpert(message, intent = null) {
  const lower = message.toLowerCase();
  
  // Explicit expert mention patterns
  const expertMentions = {
    'spisovatel': 'writer',
    'napsat knihu': 'writer',
    'napsat povídku': 'writer',
    'napsat příběh': 'writer',
    'dnd': 'dnd_master',
    'd&d': 'dnd_master',
    'dungeon': 'dnd_master',
    'kampaň': 'dnd_master',
    'text písně': 'songwriter',
    'napsat text': 'songwriter',
    'analyzuj': 'analyst',
    'srovnej': 'analyst',
    'porovnej': 'analyst',
    'koupit': 'trader',
    'prodat': 'trader',
    'účetnictví': 'accountant',
    'rozpočet': 'accountant',
    'právně': 'lawyer',
    'zákon': 'lawyer',
    'zdraví': 'doctor',
    'psycholog': 'psychologist',
    'ai': 'ai_expert',
    'model': 'ai_expert',
    'llm': 'ai_expert',
    'kód': 'developer',
    'naprogramuj': 'developer',
    'opravit': 'technician',
    'nefunguje': 'technician',
    'auto': 'car_enthusiast',
    'motorka': 'biker',
    'politika': 'political_analyst'
  };

  // Check for explicit mentions
  for (const [pattern, expertId] of Object.entries(expertMentions)) {
    if (lower.includes(pattern)) {
      const expert = expertRegistry.get(expertId);
      if (expert) {
        return {
          expert,
          confidence: 0.8,
          reason: `Detected: "${pattern}"`
        };
      }
    }
  }

  // Intent-based routing
  if (intent === 'LONG_FORM_CREATION') {
    return {
      expert: expertRegistry.get('writer'),
      confidence: 0.7,
      reason: 'Long-form content creation detected'
    };
  }

  // No expert match - use general chat
  return {
    expert: null,
    confidence: 0,
    reason: 'No specific expert match'
  };
}

/**
 * Get expert categories for UI
 */
export function getExpertCategories() {
  return [
    {
      id: 'creative',
      name: 'Tvůrčí & Narativní',
      icon: '✨',
      experts: ['writer', 'dnd_master', 'songwriter']
    },
    {
      id: 'analytical',
      name: 'Analyticko-rozhodovací',
      icon: '📊',
      experts: ['analyst', 'trader', 'accountant']
    },
    {
      id: 'normative',
      name: 'Normativní & Odpovědnostní',
      icon: '⚖️',
      experts: ['lawyer', 'doctor', 'psychologist']
    },
    {
      id: 'technical',
      name: 'Technicko-odborní',
      icon: '🛠️',
      experts: ['ai_expert', 'developer', 'technician']
    },
    {
      id: 'domain',
      name: 'Doménoví znalci',
      icon: '🎯',
      experts: ['car_enthusiast', 'biker', 'political_analyst']
    },
    {
      id: 'custom',
      name: 'Vlastní experti',
      icon: '⭐',
      experts: [] // Filled dynamically
    }
  ];
}

export default {
  PLANNING_DEPTH,
  REVIEW_POLICY,
  DATA_USAGE,
  OUTPUT_BIAS,
  BUILTIN_EXPERTS,
  ExpertAgent,
  expertRegistry,
  routeToExpert,
  getExpertCategories,
  // v45.0 - Expert intensity
  ExpertStrength,
  ExpertWeights,
  // v45.0 KOLO 4.3 - Expert presets
  ExpertPreset,
  strengthToPreset,
  getPresetWeights,
};
