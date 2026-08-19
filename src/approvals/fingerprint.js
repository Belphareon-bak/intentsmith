// Kanonický tvar a otisk — sdílený základ, který nepatří žádnému transportu
// ==============================================================================
//
// Otisk je vazba: approval **je** to, na co byl vyražen, a nic jiného.  Dokud
// tahle funkce bydlela v `src/mobile/protocol.js`, musel si pro ni sáhnout do
// mobilního protokolu i ten, kdo o mobilu nic neví — `guardedWrite` na
// desktopu, autorita sama, později IDE.  Závislost směřovala špatně: sdílené
// jádro viselo na jedné z ploch.
//
// Obsah je beze změny.  Přesunuté je jen místo, aby platilo, co má:
// **approval je transportně neutrální a plochy jsou adaptéry nad ním.**
// `src/mobile/protocol.js` tyhle funkce dál re-exportuje, takže mobilní
// volající (`operation-journal.js`, `MD-19` pravidlo 5) se nemění.
//
// ── Proč se kanonizuje ─────────────────────────────────────────────────────
//
// `MD-19` pravidlo 5: otisk se počítá z **kanonického** požadavku, aby se
// přeházením klíčů nedal protlačit jiný payload pod týmž otiskem.  Klíče
// objektů se rekurzivně řadí; pole si pořadí drží, protože v seznamu je pořadí
// význam.
//
// ==============================================================================

import { createHash } from 'node:crypto';

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      if (value[key] !== undefined) acc[key] = canonicalize(value[key]);
      return acc;
    }, {});
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * Jednosměrný otisk kanonického požadavku.  `MD-19` §4.1 pravidlo 2 vyžaduje,
 * aby byl neinvertovatelný: existuje pro **porovnání** pokusů, nikdy pro jejich
 * rekonstrukci.
 */
export function fingerprint(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export default { canonicalize, canonicalJson, fingerprint };
