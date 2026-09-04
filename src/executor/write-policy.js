// Kdy se ptát, než agent zapíše — rozhodnutí 028
// ==============================================================================
//
// **Auto-approve je výchozí stav.** Agent zapisuje bez ptaní; approval je
// výjimka pro několik pojmenovaných případů.
//
// Předchozí implementace dělala opak — ptala se na každý zápis — a operátor to
// odmítl větou, kterou stojí za to mít v kódu:
//
//   > „rozhodně není cílem abych povoloval každý zápis do souboru"
//
// Vrstva, která se ozve pokaždé, je z pohledu uživatele k nerozeznání od
// rozbité: BUILD smyčka s třiceti patchi by znamenala třicet ťuknutí.
//
// ── Podle čeho je ten seznam sestavený ─────────────────────────────────────
//
// Jedno pravidlo, na kterém se operátor shodl 2026-08-20:
//
//   **Ptát se tam, kde je frekvence blízká nule a důsledek sahá mimo to, co jde
//   snadno vrátit.**
//
// Když je porušená první půlka, otázka otravuje. Když druhá, je zbytečná.
// Proto tu **nejsou** manifesty a závislosti (`package.json`): agent je při
// stavbě mění běžně, takže by se to ozývalo pořád — a hlavně je to špatná páka.
// Zajímavá otázka není „smím editovat `package.json`", ale „smím nainstalovat
// tenhle balík", a ta patří k instalaci, ne k zápisu souboru.
//
// Ze stejného důvodu tu není celá kategorie migrací, ale jen jeden případ:
// **přepis migrace, která už proběhla.** Nová migrace je rutina; přepsat
// aplikovanou znamená rozejít databázi s tím, co kód tvrdí.
//
// ── Co se nezakazuje otázkou, ale rovnou ───────────────────────────────────
//
// Zápis do `.git/` není legitimní akce agenta nikdy. Otázka, na kterou je
// správná odpověď vždycky „ne", je jen zdržení — proto `refuse`, ne `ask`.
//
// ── Jak seznam rozšířit ────────────────────────────────────────────────────
//
// Přidat řádek do `SENSITIVE_RULES`. Je to schválně **jedno čitelné místo**, ne
// podmínky rozsypané po kódu: seznam, který se dá přečíst za minutu, se dá taky
// odsouhlasit — a `028` §2.2 říká, že rozhodnutí, co je citlivé, je operátorovo.
//
// ==============================================================================

import path from 'node:path';

/** Zápis, který se nikdy nemá stát — ani po odsouhlasení. */
const FORBIDDEN_RULES = Object.freeze([
  Object.freeze({
    name: 'git-internals',
    reason: 'Zápis do .git/ není legitimní akce agenta.',
    test: rel => rel === '.git' || /(^|\/)\.git\//.test(rel),
  }),
]);

/**
 * Kategorie, které se ptají.  **Pořadí odpovídá tomu, jak se čte** — první
 * shoda vyhrává a její jméno se objeví ve výsledku.
 */
export const SENSITIVE_RULES = Object.freeze([
  Object.freeze({
    name: 'secrets',
    reason: 'Soubor vypadá jako secret nebo klíč.',
    // Agent do nich při normální práci nesahá vůbec, takže se otázka skoro
    // nikdy neozve — a když se ozve, je to sama o sobě informace.
    test: rel => /(^|\/)\.env(\..+)?$/.test(rel)
      || /(^|\/)(id_rsa|id_ed25519|id_ecdsa)(\.pub)?$/.test(rel)
      || /\.(pem|key|p12|pfx|jks|keystore)$/i.test(rel)
      || /(^|\/)(credentials|secrets?)(\.[^/]+)?$/i.test(rel)
      || /(^|\/)keystore\.properties$/.test(rel),
  }),
  Object.freeze({
    name: 'ci-deploy',
    reason: 'Soubor mění, co a kde se spustí.',
    // Jediná kategorie, jejíž důsledek **opouští tvůj stroj**: změněný workflow
    // může pushnout, nasadit, publikovat.
    // Ukotvené na **hranici segmentu**, ne na začátek řetězce: cíl mimo
    // pracovní strom přijde jako absolutní cesta a `startsWith` by ho minul.
    // Našel to test, ne úvaha.
    test: rel => /(^|\/)\.github\/workflows\//.test(rel)
      || /(^|\/)Dockerfile([.-].*)?$/.test(rel)
      || /(^|\/)docker-compose([.-].*)?\.ya?ml$/i.test(rel)
      || /(^|\/)\.gitlab-ci\.ya?ml$/i.test(rel)
      || /(^|\/)(fly|vercel|netlify|railway)\.(toml|json)$/i.test(rel),
  }),
  Object.freeze({
    name: 'applied-migration',
    reason: 'Tahle migrace už na databázi proběhla.',
    // Ne celá kategorie migrací — nová migrace je rutina.  Nebezpečné je
    // přepsat tu, která už běžela: databáze se rozejde s tím, co kód tvrdí.
    test: (rel, context) => {
      if (!/(^|\/)src\/db\/migrations\/.+\.js$/.test(rel)) return false;
      const version = path.basename(rel).replace(/\.js$/, '');
      return context.appliedMigrations?.has(version) === true;
    },
  }),
]);

/**
 * Co s tímhle zápisem.
 *
 * @param {Object} options
 * @param {string} options.relativePath  cesta **vůči kořeni stromu**, už kanonická
 * @param {Set<string>} [options.appliedMigrations]
 * @returns {{action: 'allow'|'ask'|'refuse', rule: string|null, reason: string|null}}
 */
export function classifyWrite({ relativePath, appliedMigrations = null } = {}) {
  // Oddělovače se sjednotí na `/`, aby pravidla nemusela řešit platformu.
  const rel = String(relativePath || '').split(path.sep).join('/').replace(/^\.\//, '');
  const context = { appliedMigrations };

  for (const rule of FORBIDDEN_RULES) {
    if (rule.test(rel, context)) {
      return { action: 'refuse', rule: rule.name, reason: rule.reason };
    }
  }
  for (const rule of SENSITIVE_RULES) {
    if (rule.test(rel, context)) {
      return { action: 'ask', rule: rule.name, reason: rule.reason };
    }
  }
  // Výchozí stav.  Ne „nenašli jsme pravidlo, tak radši ptát" — `028` říká
  // opak a je to celý smysl téhle vrstvy.
  return { action: 'allow', rule: null, reason: null };
}

/** Které migrace už na téhle databázi proběhly. */
export function readAppliedMigrations(rawDb) {
  if (!rawDb) return new Set();
  try {
    return new Set(rawDb.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  } catch {
    // Tabulka nemusí existovat (čerstvá databáze v testu).  Prázdná množina
    // znamená „žádná migrace neproběhla", což je pravda.
    return new Set();
  }
}

export default { classifyWrite, readAppliedMigrations, SENSITIVE_RULES };
