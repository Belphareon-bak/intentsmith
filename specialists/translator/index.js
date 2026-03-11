// Translator Specialist — Package Entry Point
// ══════════════════════════════════════════════════════════════════════════════
//
// Translates text between languages. Uses LLM for translation quality.
// Created as a test specialist to verify create-specialist pipeline.
//
// ══════════════════════════════════════════════════════════════════════════════

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Language Detection Heuristics ──────────────────────────────────────────

const LANG_PATTERNS = [
  { lang: 'cs', patterns: [/[řžšťďňůúýáéí]/i, /\b(?:je|jsou|byl|byla|není|nebo|také|jako|ale|které?)\b/] },
  { lang: 'sk', patterns: [/[ľĺŕôäň]/i, /\b(?:alebo|tiež|ktoré?|veľ[km]|ešte)\b/] },
  { lang: 'en', patterns: [/\b(?:the|is|are|was|were|have|has|been|with|that|this)\b/i] },
  { lang: 'de', patterns: [/[äöüß]/i, /\b(?:und|oder|aber|nicht|auch|für|mit|auf)\b/i] },
  { lang: 'fr', patterns: [/[àâçéèêëîïôùûü]/i, /\b(?:est|sont|avec|pour|dans|les|des|une)\b/] },
  { lang: 'es', patterns: [/[ñáéíóú¿¡]/i, /\b(?:está|son|para|con|pero|también|como)\b/i] },
];

function detectLang(text) {
  const scores = {};
  for (const { lang, patterns } of LANG_PATTERNS) {
    scores[lang] = 0;
    for (const p of patterns) {
      const matches = text.match(new RegExp(p.source, p.flags + 'g'));
      if (matches) scores[lang] += matches.length;
    }
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted[0][1] === 0) return { language: 'unknown', confidence: 0 };
  const total = sorted.reduce((s, [, v]) => s + v, 0);
  return { language: sorted[0][0], confidence: Math.round((sorted[0][1] / total) * 100) / 100 };
}

// ─── Tool Implementations ───────────────────────────────────────────────────

async function translateText(params) {
  const { text, from, to } = params;
  if (!text) return { status: 'error', message: 'Chybí text k překladu' };
  if (!to) return { status: 'error', message: 'Chybí cílový jazyk (parametr "to")' };

  const detected = from || detectLang(text).language;

  // Translation is done by the LLM via the expertise prompt —
  // this tool provides structure and language detection.
  return {
    status: 'ok',
    data: {
      sourceText: text,
      sourceLanguage: detected,
      targetLanguage: to,
      message: `Přelož tento text z ${detected} do ${to}. Zachovej styl a tón originálu.`,
    },
  };
}

async function detectLanguageHandler(params) {
  const { text } = params;
  if (!text) return { status: 'error', message: 'Chybí text k analýze' };

  const result = detectLang(text);
  return {
    status: 'ok',
    data: result,
  };
}

// ─── Expertise Definition ───────────────────────────────────────────────────

const TRANSLATOR_EXPERTISE = {
  id: 'translator',
  name: 'Překladatel',
  icon: '🌐',
  domain: 'language',
  description: 'Překlad textů, lokalizace, stylistická adaptace',
  isCustom: true,
  primaryProblemTypes: ['translation', 'specification'],
  allowedRepresentations: ['prose', 'tabular'],
  planningDepth: 'light',
  reviewPolicy: 'self',
  dataUsagePolicy: 'open',
  outputBias: 'neutral',
  temperature: 0.4,
  tools: ['translator.translate', 'translator.detect_language'],
  capabilities: { reasoning: 60, creativity: 70, determinism: 50, riskTolerance: 30, verbosity: 60 },
  tone: 'professional',
  modules: {
    domain_rules: [
      'Zachovej tón a styl originálu',
      'Idiomy překládej volně, ne doslova',
      'Technické termíny nechej v originále pokud nemají ustálený překlad',
      'U víceznačných slov zvol kontext-appropriate překlad',
    ],
    emphasis: [
      'Přirozený jazyk — ne strojový překlad',
      'Kulturní adaptace, ne jen lexikální záměna',
    ],
    constraints: [
      'Nepřidávej obsah, který v originálu není',
      'Nezkracuj ani nerozšiřuj text bez důvodu',
    ],
    vocabulary: ['zdrojový jazyk', 'cílový jazyk', 'lokalizace', 'adaptace', 'idiom'],
    antipatterns: ['Doslovný překlad idiomů', 'Překlad vlastních jmen', 'Ignorování kontextu'],
  },
  systemPrompt: `Jsi profesionální překladatel. Překládáš texty přirozeně a kultivovaně.

## PRAVIDLA
- Zachovej tón, styl a záměr originálu
- Idiomy a fráze překládej volně, aby zněly přirozeně v cílovém jazyce
- Technické termíny nechej v originále pokud nemají ustálený překlad
- Nezkracuj ani nerozšiřuj text
- U víceznačných slov použij překlad vhodný pro daný kontext

## VÝSTUP
- Překlad formátuj stejně jako originál (markdown, odstavce, odrážky)
- Pokud je vstup krátký (1-2 věty), odpověz jen překladem
- U delších textů přidej krátkou poznámku o jazykovém páru`,
};

// ─── Boost Patterns ─────────────────────────────────────────────────────────

const TRANSLATOR_BOOST_PATTERNS = [
  /\bpřelo[žz]/i,
  /\btranslat/i,
  /\b(?:z|do)\s+(?:angličtiny|češtiny|němčiny|francouzštiny|španělštiny)/i,
  /\b(?:from|to|into)\s+(?:english|czech|german|french|spanish)/i,
  /\blokalizac/i,
];

// ─── Tool Definitions ───────────────────────────────────────────────────────

function buildToolDefinitions() {
  return [
    {
      id: 'translator.translate',
      name: 'Překlad textu',
      description: 'Translate text between languages',
      patterns: [{
        priority: 10,
        patterns: [
          /(?:přelo[žz]|translat|překlad)\s/i,
          /(?:z|do|from|to|into)\s+(?:angličtiny|češtiny|němčiny|french|english|german|czech|spanish|španělštiny|francouzštiny)/i,
        ],
      }],
      extractParams: (input) => {
        const params = { text: input };
        // Detect target language
        const toMatch = input.match(/(?:do|to|into)\s+(angličtiny|češtiny|němčiny|francouzštiny|španělštiny|english|czech|german|french|spanish)/i);
        if (toMatch) {
          const langMap = {
            'angličtiny': 'en', 'english': 'en',
            'češtiny': 'cs', 'czech': 'cs',
            'němčiny': 'de', 'german': 'de',
            'francouzštiny': 'fr', 'french': 'fr',
            'španělštiny': 'es', 'spanish': 'es',
          };
          params.to = langMap[toMatch[1].toLowerCase()] || toMatch[1];
        }
        // Detect source language
        const fromMatch = input.match(/(?:z|from)\s+(angličtiny|češtiny|němčiny|francouzštiny|španělštiny|english|czech|german|french|spanish)/i);
        if (fromMatch) {
          const langMap = {
            'angličtiny': 'en', 'english': 'en',
            'češtiny': 'cs', 'czech': 'cs',
            'němčiny': 'de', 'german': 'de',
            'francouzštiny': 'fr', 'french': 'fr',
            'španělštiny': 'es', 'spanish': 'es',
          };
          params.from = langMap[fromMatch[1].toLowerCase()] || fromMatch[1];
        }
        return params;
      },
    },
    {
      id: 'translator.detect_language',
      name: 'Detekce jazyka',
      description: 'Detect the language of input text',
      patterns: [{
        priority: 5,
        patterns: [
          /(?:jak[ýá]\w*|v\s+jak[ée]m)\s+(?:jazyk|jazyce|řeči)/i,
          /(?:detect|identify)\s+language/i,
          /(?:rozpozn|zjist)\w*\s+jazyk/i,
        ],
      }],
      extractParams: (input) => ({ text: input }),
    },
  ];
}

// ─── Registration ───────────────────────────────────────────────────────────

export async function register(ctx) {
  const { runtime, manifest, logger: log } = ctx;

  // 1. Tools — register into SpecialistRuntime
  runtime.registerSpecialist({
    id: 'translator',
    domain: 'language',
    globalParamExtractor: null,
    tools: buildToolDefinitions(),
  });

  // 2. Expertise
  if (ctx.registries?.expertise) {
    ctx.registries.expertise.addCustom(TRANSLATOR_EXPERTISE);
  }

  // 3. Boost patterns
  if (ctx.registries?.autoSelect?.registerBoostPatterns) {
    ctx.registries.autoSelect.registerBoostPatterns('translator', TRANSLATOR_BOOST_PATTERNS);
  }

  // 4. ToolType registration
  if (ctx.registries?.cre?.registerToolType) {
    for (const tool of manifest?.tools || []) {
      ctx.registries.cre.registerToolType(tool.id);
    }
  }

  // 5. ToolExecutor handlers
  if (ctx.registries?.toolExecutor?.register) {
    ctx.registries.toolExecutor.register('translator.translate', translateText);
    ctx.registries.toolExecutor.register('translator.detect_language', detectLanguageHandler);
  }

  // 6. Capabilities
  if (ctx.registries?.capability?.register) {
    for (const cap of manifest?.capabilities || []) {
      ctx.registries.capability.register(cap, manifest.id);
    }
  }
}

export function unregister(ctx) {
  const { runtime, manifest } = ctx;

  try { runtime?.unregisterSpecialist?.('translator'); } catch { /* noop */ }
  try { ctx.registries?.expertise?.removeCustom('translator'); } catch { /* noop */ }
  try { ctx.registries?.autoSelect?.unregisterBoostPatterns('translator'); } catch { /* noop */ }

  try {
    for (const tool of manifest?.tools || []) {
      ctx.registries?.cre?.unregisterToolType(tool.id);
      ctx.registries?.toolExecutor?.unregister(tool.id);
    }
  } catch { /* noop */ }

  try { ctx.registries?.capability?.unregisterBySpecialist?.(manifest?.id); } catch { /* noop */ }
}
