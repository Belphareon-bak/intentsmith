// Model Family Extensions — rozpoznání rodin, které základní parser nezná
// ══════════════════════════════════════════════════════════════════════════════
//
// Proč samostatný modul a ne úprava `model-profiles.js`:
//
// `model-profiles.js` je připnutý bajtovým hashem v
// `model-failover-proof-policy.js` (`EXPECTED_SOURCE_PINS.modelProfiles`) jako
// revidovaná autorita pro kontrakt rolí a validačních sad.  Pin je fail-closed
// právě proto, aby se ten kontrakt nemohl změnit bez review — a platí na celý
// soubor, takže i čistě aditivní zásah do tabulky rodin by ho shodil.
//
// Rozpoznání rodiny modelu ale žádnou autoritou nad rolemi není.  Patří sem,
// mimo pin, a `model-profiles.js` zůstává bajtově nedotčený.
//
// Kdyby se někdy tabulka rodin měla vrátit zpět do profilů, je to operátorské
// rozhodnutí spojené s přepočtem pinu, ne úklid v rámci běžné práce.
//
// ══════════════════════════════════════════════════════════════════════════════

import { parseModelName } from './model-profiles.js';

/**
 * Rodiny, které základní `MODEL_FAMILIES` buď nezná, nebo je zařadí špatně.
 *
 * `qwen3-coder` je tu proto, že základní tabulka zkouší prefixy shora dolů a
 * `qwen3` se trefí dřív — coder model tak spadne do kategorie `general` a
 * přijde o bonus za shodu s rolí CODE.  Zdejší tabulka se vyhodnocuje jako
 * první a základní výsledek přebíjí.
 */
export const EXTRA_MODEL_FAMILIES = Object.freeze([
  { prefix: 'qwen3-coder', family: 'qwen-coder', category: 'code' },
  { prefix: 'qwq',         family: 'qwq',        category: 'reasoning' },
  { prefix: 'devstral',    family: 'devstral',   category: 'code' },
  { prefix: 'glm',         family: 'glm',        category: 'general' },
  { prefix: 'granite',     family: 'granite',    category: 'general' },
]);

/** Rodiny, které verzi oddělují spojovníkem (`glm-4.7-flash`). */
const HYPHENATED_VERSION = /(?:glm|granite)-?(\d+(?:\.\d+)?)/;

/**
 * Jako `parseModelName()`, ale rozpozná i rodiny z `EXTRA_MODEL_FAMILIES`.
 *
 * Vrací nový objekt; vstup ani výsledek základního parseru nemění.
 *
 * @param {string} modelName
 * @returns {{ name: string, family: string, category: string, version: string|null, params: number|null, quantization: string|null }}
 */
export function parseModelNameExtended(modelName) {
  const result = { ...parseModelName(modelName) };
  if (!modelName || typeof modelName !== 'string') return result;

  const lower = modelName.toLowerCase().trim();

  for (const entry of EXTRA_MODEL_FAMILIES) {
    if (lower.startsWith(entry.prefix)) {
      result.family = entry.family;
      result.category = entry.category;
      break;
    }
  }

  if (!result.version) {
    const match = lower.match(HYPHENATED_VERSION);
    if (match) result.version = match[1];
  }

  return result;
}

export default { EXTRA_MODEL_FAMILIES, parseModelNameExtended };
