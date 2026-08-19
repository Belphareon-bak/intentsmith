// Zápis, který se ptá — P0-2, tam kde se 025 a 027 potkávají
// ==============================================================================
//
// Tohle je místo, kvůli kterému celý companion existuje: agent chce zapsat
// soubor, zeptá se člověka a **počká**.  Do téhle chvíle to uměl jen demo
// skript; tady je to cesta, kterou může volat jádro.
//
// Skládá se ze tří věcí, které dávají smysl jen dohromady:
//
//   1. **Zámek** (`027`) — druhý běh na týž soubor je odmítnut hned, takže se
//      dva agenti nepřepíšou.  Drží se **přes celé čekání**, jinak by se mezi
//      schválením a zápisem stihl vklínit někdo jiný a předpoklad by propadal
//      u každého druhého approvalu.
//   2. **Approval s předpokladem** (`025`) — čeká, dokud člověk neodpoví, a
//      propadne, když se cíl změní.  Zámek drží agenty; předpoklad drží
//      všechny ostatní: člověka v editoru, `git checkout`, jiný nástroj.
//   3. **Zápis až po obojím** — a nikdy dřív.  Pořadí není detail: kdyby se
//      zapsalo a pak revertovalo při zamítnutí, byl by approval dekorace nad
//      změnou, která už nastala.
//
// ── Co dělá, když se něco nepovede ─────────────────────────────────────────
//
// Nic nezapíše a **řekne proč**.  Každý výsledek je jméno, ne `false`:
// `locked`, `rejected`, `precondition_changed`, `expired`, `timeout`,
// `unknown`.  Volající se podle nich chová různě a `false` by je slil dohromady
// — což je přesně ten druh ztráty informace, kvůli které se pak píše „něco se
// nepovedlo".
//
// ── Proč to není v nástroji `fs.write` ─────────────────────────────────────
//
// Aby šlo `fs.write` nechat být, dokud tuhle cestu někdo vědomě nezapne.
// Rozhodnutí `024` říká, že producent se nespouští sám; tenhle modul je proto
// funkce, kterou musí někdo zavolat, ne chování, které se objeví samo.
//
// ==============================================================================

import { fingerprint } from '../mobile/protocol.js';
import {
  acquireFileLock, refreshFileLock, releaseFileLock, describeWorkspace, describeHolder,
} from './file-lock.js';

/** Jak často se obnovuje zámek, když se čeká dlouho. */
const LOCK_HEARTBEAT_MS = 60_000;

/**
 * @param {Object} options
 * @param {Object} options.rawDb
 * @param {Object} options.producer     `createCompanionProducer(...)`
 * @param {string} options.runId
 * @param {string} options.filePath
 * @param {string} options.content
 * @param {Object} [options.workspace]  výsledek `describeWorkspace()`
 * @param {Object} [options.fs]         injektovatelné `readFile`/`writeFile`
 * @param {string} [options.ownerLabel] jméno agenta pro hlášku o zámku
 * @param {number} [options.timeoutMs]  jak dlouho tenhle běh vydrží čekat
 * @param {'local'|'remote'} [options.origin]
 * @param {Function} [options.onAsked]  zavolá se hned po ražbě approvalu, ještě
 *   než se začne čekat.  Existuje pro plochy, které mají vlastní způsob, jak
 *   otázku ukázat — typicky IDE, které pošle `edit_request` do editoru.  Sekvence
 *   zůstává jedna; jen se k ní přidá další místo, kde je ta otázka vidět.
 */
export async function guardedWrite({
  rawDb, producer, runId, filePath, content,
  workspace = null, fs = null, ownerLabel = null,
  timeoutMs = null, origin = 'local', deviceId = null, onAsked = null, signal = null,
} = {}) {
  if (!rawDb) throw new Error('guardedWrite: rawDb required');
  if (!producer) throw new Error('guardedWrite: producer required');
  if (!runId) throw new Error('guardedWrite: runId required');

  const io = fs || await defaultFs();
  const space = workspace || describeWorkspace();

  // ── 1. Zámek, nebo hned pryč ──────────────────────────────────────────
  const lock = acquireFileLock(rawDb, {
    workspace: space, filePath, runId, ownerLabel,
  });
  if (!lock.ok) {
    return {
      state: 'locked',
      written: false,
      holder: lock.holder,
      message: describeHolder(lock.holder),
    };
  }

  let heartbeat = null;
  try {
    // ── 2. Jak cíl vypadá teď — to je předpoklad ────────────────────────
    //
    // Čte se **před** ražbou approvalu, aby se člověk rozhodoval o stavu,
    // který skutečně nastal, ne o tom, jaký byl při plánování běhu.
    const before = await readOrNull(io, filePath);

    const approval = await producer.requestApproval({
      origin,
      runId,
      operationRef: `fs.write:${filePath}`,
      subjectType: 'effect.write',
      subjectId: filePath,
      title: before === null ? 'Vytvořit soubor' : 'Přepsat soubor',
      detail: filePath,
      payload: { path: filePath, content },
      deviceId,
      precondition: { kind: 'file-digest', ref: filePath, content: before },
    });

    if (typeof onAsked === 'function') {
      // Chyba v cizí ploše nesmí shodit zápis: otázka existuje v databázi bez
      // ohledu na to, jestli ji IDE stihlo vykreslit.  Kdyby to shodilo běh,
      // byla by přídavná plocha křehčí než ta hlavní.
      try {
        await onAsked({ ...approval, filePath, before });
      } catch { /* plocha si neporadila; approval stojí */ }
    }

    // Zámek se během čekání obnovuje: běh žije, i když člověk spí.
    heartbeat = setInterval(() => {
      try { refreshFileLock(rawDb, { lockId: lock.lock.id, runId }); } catch { /* uvolněn jinde */ }
    }, LOCK_HEARTBEAT_MS);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    // ── 3. Čekání na člověka ────────────────────────────────────────────
    const answer = await producer.awaitDecision(approval.id, {
      timeoutMs,
      signal,
      readTarget: async target => readOrNull(io, target),
    });

    if (answer.state !== 'approve') {
      return { state: answer.state, written: false, approvalId: approval.id, detail: answer };
    }

    // ── 4. Zápis ────────────────────────────────────────────────────────
    //
    // `awaitDecision` předpoklad ověřil čerstvým čtením těsně předtím, takže
    // tady se už jen zapisuje.  Kdyby se mezi tím a tímhle řádkem stihlo něco
    // změnit, chrání nás zámek — a to je přesně dělba, kvůli které jsou dva.
    await io.mkdir(dirnameOf(filePath), { recursive: true });
    await io.writeFile(filePath, content, 'utf8');

    return {
      state: 'written',
      written: true,
      approvalId: approval.id,
      decidedBy: answer.decidedBy || null,
      bytes: content.length,
    };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    // Zámek se pouští vždycky — i když se zápis nepovedl.  Zámek, který
    // přežije svůj běh, je tichý blokátor pro všechny ostatní.
    releaseFileLock(rawDb, { lockId: lock.lock.id, runId });
  }
}

async function defaultFs() {
  const { readFile, writeFile, mkdir } = await import('node:fs/promises');
  return { readFile, writeFile, mkdir };
}

async function readOrNull(io, filePath) {
  try {
    return await io.readFile(filePath, 'utf8');
  } catch {
    // Neexistující i nečitelný soubor jsou pro předpoklad totéž: „nemám, s čím
    // porovnávat".  `checkPrecondition` to pak vyhodnotí proti `'absent'`.
    return null;
  }
}

function dirnameOf(filePath) {
  const index = filePath.lastIndexOf('/');
  return index <= 0 ? '/' : filePath.slice(0, index);
}

/** Otisk návrhu — pro volajícího, který chce vědět, na co se člověka ptáme. */
export function proposalFingerprint(filePath, content) {
  return fingerprint({ path: filePath, content });
}

export default { guardedWrite, proposalFingerprint };
