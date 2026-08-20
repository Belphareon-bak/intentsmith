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
//   > Zápisy uživatelských souborů **v cestě `FILE_WRITE` a nástroje `fs.write`**
//   > jdou přes jednu řízenou cestu.  Dva běhy IntentSmithu si nepřepíšou stejný
//   > kanonický cíl.  Externí změna zápis zastaví, pokud je viditelná při
//   > poslední kontrole.  Mikrointerval mezi kontrolou a atomickou náhradou
//   > souboru není pokrytý.
//
// Rozsah je v té větě schválně, protože „všechny zápisy" zatím **není pravda**:
// patch engine, skill write step a další zapisovatelé jdou dál mimo.  Mediace
// zbytku je samostatný balík; do té doby by širší formulace byla slib, který
// kód neplní.
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
// **Auto-approve je výchozí stav** (rozhodnutí `028`).  Agent zapisuje bez
// ptaní; approval je výjimka pro případy, které pojmenovává
// `src/executor/write-policy.js` — a ten seznam je schválně na jednom čitelném
// místě, protože co je citlivé, rozhoduje operátor.
//
// Do 2026-08-20 se to ptalo na **každý** zápis.  Nebyla to vada kódu, ale
// zadání: vrstva, která se ozve pokaždé, je z pohledu uživatele k nerozeznání
// od rozbité.
//
// **Zapisuje jen režim `approval`.**  Ostatní dva odmítají a nic nezapíšou:
//
//   `guard: 'approval'`  db + producent → plný `guardedWrite`: zámek, otázka,
//                        čekání, poslední kontrola, teprve zápis.  Jediný
//                        režim, ve kterém soubor vznikne.
//   `guard: 'lock'`      jen db, bez producenta → **odmítne**.  Zámek bez
//                        otázky drží agenty mezi sebou, ale slib zní „zeptá
//                        se", ne „nepřepíšou se".
//   `guard: 'none'`      nic zapojeného → **odmítne**.
//
// Dřív oba slabší režimy zapisovaly a spoléhalo se na to, že režim je vidět
// v návratové hodnotě.  To byla chyba a review ji našlo: viditelnost v
// návratové hodnotě nikoho nezachrání, když se na ni nikdo nedívá, a
// nezapojený server tak zapisoval bez ptaní úplně stejně jako předtím.
// Fail-closed znamená, že se ta záměna nedá udělat — ne že je vidět.
//
// ==============================================================================

import { guardedWrite } from './guarded-write.js';
import { canonicalTarget, describeWorkspace } from './file-lock.js';
import { classifyWrite, readAppliedMigrations } from './write-policy.js';

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

  // Fail-closed.  Bez rozhodovací roviny se **nezapisuje** — ani se zámkem.
  //
  // Zámek chrání dva běhy IntentSmithu před sebou navzájem; nechrání uživatele
  // před zápisem, na který nekývl.  Slib zní „zeptá se a počká", a běh, který
  // se nemá koho zeptat, ten slib splnit neumí.  Jediná poctivá odpověď je
  // odmítnout a říct proč.
  if (mode !== 'approval') {
    return {
      state: 'refused_unconfigured',
      written: false,
      guard: mode,
      target: filePath,
      message: mode === 'lock'
        ? 'Rozhodovací rovina není zapojená (chybí producent), takže se nemá kdo zeptat. Nic se nezapsalo.'
        : 'Rozhodovací rovina není zapojená, takže se nemá kdo zeptat. Nic se nezapsalo.',
    };
  }

  // Politika se ptá nad **kanonickým** cílem, ne nad tím, co přišlo.
  // Symlink `poznamky.txt` mířící na `.env` je zápis do `.env` a musí spadnout
  // do téže kategorie — jinak by se pravidlo dalo obejít pojmenováním.
  const space = workspace || describeWorkspace();
  const target = canonicalTarget(space, filePath);
  const verdict = classifyWrite({
    relativePath: target.path,
    appliedMigrations: readAppliedMigrations(_db),
  });

  if (verdict.action === 'refuse') {
    // Otázka, na kterou je správná odpověď vždycky „ne", je jen zdržení.
    return {
      state: 'refused_forbidden',
      written: false,
      guard: 'approval',
      target: target.real,
      rule: verdict.rule,
      message: verdict.reason,
    };
  }

  const result = await guardedWrite({
    rawDb: _db, producer: _producer, runId, filePath, content,
    workspace: space, fs, ownerLabel, timeoutMs, origin, deviceId, onAsked, signal,
    approval: verdict.action === 'ask' ? 'required' : 'auto',
  });
  return {
    ...result,
    guard: 'approval',
    // Ať je ve výsledku vidět, **jestli se někdo ptal a proč** — bez toho by se
    // automatický zápis nedal odlišit od schváleného.
    asked: verdict.action === 'ask',
    ...(verdict.rule ? { rule: verdict.rule, ruleReason: verdict.reason } : {}),
  };
}

export default {
  configureEffects, effectGuardMode, writeUserFile, DEFAULT_DECISION_TIMEOUT_MS,
};
