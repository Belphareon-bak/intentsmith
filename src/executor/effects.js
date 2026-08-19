// Jedna řízená cesta pro zápis uživatelských souborů — P0-2, závazek prototypu
// ==============================================================================
//
// `guardedWrite` byl postavený a **nezapnutý**: uměl se zeptat, počkat a
// nezapsat, a přitom šel produkční zápis pořád kolem něj — `fs.writeFile` v
// handleru a v nástroji `fs.write`.  Přídavná bezpečná cesta, kterou nikdo
// nevolá, je dokumentace, ne záruka.
//
// Tenhle modul je **ta jedna cesta**.  Slib, který nad ním platí, zní přesně
// takto a ne silněji:
//
//   > Všechny zápisy uživatelských souborů prováděné IntentSmithem jdou přes
//   > jednu řízenou cestu.  Dva běhy IntentSmithu si nepřepíšou stejný
//   > kanonický cíl.  Externí změna zápis zastaví, pokud je viditelná při
//   > poslední kontrole.  Mikrointerval mezi kontrolou a atomickou náhradou
//   > souboru není pokrytý.
//
// Silnou variantu (žádný externí zapisovatel nikdy nepřepíše stav) by šlo
// splnit jen mediační vrstvou pro **všechny** zapisovatele — CAS nebo verzované
// úložiště, kterým by musel projít i editor a `git checkout`.  To je rozhodnutí
// o síle slibu, ne oprava; otevře se znovu při reálných kolizích, na síťovém
// filesystemu nebo při víc nezávislých editorech.
//
// ── Tři režimy, a každý se pojmenuje ───────────────────────────────────────
//
// Cesta je jedna, ale co po ní jde, závisí na tom, co je zapojené:
//
//   `guard: 'approval'`  db + producent → plný `guardedWrite`: zámek, otázka,
//                        čekání, poslední kontrola, teprve zápis.  Tohle běží
//                        v serveru (`configureEffects` v `server.js`).
//   `guard: 'lock'`      jen db → zámek a kanonický cíl, ale **nikdo se
//                        neptá**.  Dva běhy se pořád nepřepíšou.
//   `guard: 'none'`      nic zapojeného → holý zápis.  Testy a nástroje mimo
//                        server; režim je ve výsledku vidět, takže se nedá
//                        splést se schváleným zápisem.
//
// Fallback **není** tichý: `guard` je v návratové hodnotě vždycky a volající
// (i telemetrie) podle něj pozná, co se doopravdy stalo.  Kdyby chyběl, byl by
// nezapojený server k nerozeznání od zapojeného — a to je přesně ta záměna,
// kvůli které se slib rozpadá.
//
// ==============================================================================

import { guardedWrite } from './guarded-write.js';
import { commitFile, defaultFs } from './atomic-write.js';
import {
  acquireFileLock, releaseFileLock, describeWorkspace, describeHolder, canonicalTarget,
} from './file-lock.js';

/**
 * Jak dlouho běh čeká na rozhodnutí, když si volající neřekne jinak.
 *
 * Bez tohohle by výchozí čekání bylo `PRECONDITION_CAP_MS` — **třicet dní**.
 * Ten strop je pojistka proti zapomenutému řádku, ne doba, kterou má viset
 * chatový požadavek.  Pět minut odpovídá lokálnímu oknu z `DR-011`: dost na to,
 * aby se člověk podíval na telefon, málo na to, aby běh vypadal zaseknutě.
 *
 * Volající, který má vlastní konec čekání (IDE relace má `AbortController`
 * svázaný s koncem relace), si předá svůj `timeoutMs`.
 */
export const DEFAULT_DECISION_TIMEOUT_MS = 5 * 60_000;

let _db = null;
let _producer = null;

/**
 * Zapoj rozhodovací rovinu.  Volá `server.js` při startu — je to jediné místo,
 * kde se z „umí se zeptat" stává „ptá se".
 */
export function configureEffects({ db = null, producer = null } = {}) {
  _db = db?.db || db || null;
  _producer = producer || null;
}

/** Který ze tří režimů je právě v platnosti. */
export function effectGuardMode() {
  if (_db && _producer) return 'approval';
  if (_db) return 'lock';
  return 'none';
}

/**
 * Zapiš uživatelský soubor.  **Jediná** cesta, kterou to smí jít.
 *
 * @param {Object} options
 * @param {string} options.filePath   cesta, jak ji zadal volající
 * @param {string} options.content
 * @param {string} options.runId      vlastník zámku — běh, ne agent (`027`)
 * @param {string} [options.ownerLabel]
 * @param {'local'|'remote'} [options.origin]
 * @param {number} [options.timeoutMs]
 * @param {Object} [options.workspace]
 * @param {Object} [options.fs]       injektovatelné `readFile`/`writeFile`/`mkdir`
 * @param {Function} [options.onAsked]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{state:string, written:boolean, guard:string, target:string, ...}>}
 */
export async function writeUserFile({
  filePath, content, runId,
  ownerLabel = null, origin = 'local', deviceId = null,
  timeoutMs = DEFAULT_DECISION_TIMEOUT_MS,
  workspace = null, fs = null, onAsked = null, signal = null,
} = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('writeUserFile: filePath required');
  }
  if (typeof content !== 'string') throw new Error('writeUserFile: content required');
  if (typeof runId !== 'string' || runId.trim() === '') {
    // Bez běhu není koho zapsat jako držitele zámku, a zámek bez držitele je
    // jen zpomalení.  Volající musí říct, čí ten zápis je.
    throw new Error('writeUserFile: runId required');
  }

  const mode = effectGuardMode();

  if (mode === 'approval') {
    const result = await guardedWrite({
      rawDb: _db, producer: _producer, runId, filePath, content,
      workspace, fs, ownerLabel, timeoutMs, origin, deviceId, onAsked, signal,
    });
    return { ...result, guard: 'approval' };
  }

  const space = workspace || describeWorkspace();
  const target = canonicalTarget(space, filePath);
  const effectPath = target.real;
  const io = fs || await defaultFs();

  if (mode === 'lock') {
    const lock = acquireFileLock(_db, {
      workspace: space, filePath: effectPath, runId, ownerLabel,
    });
    if (!lock.ok) {
      return {
        state: 'locked', written: false, guard: 'lock',
        target: effectPath, holder: lock.holder, message: describeHolder(lock.holder),
      };
    }
    try {
      await commitFile(io, effectPath, content);
      return { state: 'written', written: true, guard: 'lock', target: effectPath, bytes: content.length };
    } finally {
      releaseFileLock(_db, { lockId: lock.lock.id, runId });
    }
  }

  await commitFile(io, effectPath, content);
  return { state: 'written', written: true, guard: 'none', target: effectPath, bytes: content.length };
}

export default {
  configureEffects, effectGuardMode, writeUserFile, DEFAULT_DECISION_TIMEOUT_MS,
};
