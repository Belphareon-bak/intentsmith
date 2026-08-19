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

import { createHash } from 'node:crypto';

import { fingerprint } from '../mobile/protocol.js';
import { closeApprovalWithoutAnswer, APPROVAL_TERMINAL } from '../mobile/approval-authority.js';
import {
  acquireFileLock, refreshFileLock, releaseFileLock, describeWorkspace, describeHolder,
  canonicalTarget, assertStillHeld,
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

  // Jeden kanonický cíl pro zámek, předpoklad i zápis (nález 7).  Bez toho by
  // symlink a přímá cesta byly dva zámky nad jedním souborem.
  const target = canonicalTarget(space, filePath);
  const effectPath = target.real;

  // ── 1. Zámek, nebo hned pryč ──────────────────────────────────────────
  const lock = acquireFileLock(rawDb, {
    workspace: space, filePath: effectPath, runId, ownerLabel,
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
  /** Jakmile jednou přijdeme o zámek, zápis se už nesmí stát. */
  let lostLock = null;

  /**
   * Uzavři otázku, na kterou už nemá smysl odpovídat.
   *
   * `invalidated` = svět se změnil (předpoklad, ztracený zámek); `cancelled` =
   * ten, kdo se ptal, přestal čekat.  Skutečnou odpověď to nikdy nepřepíše —
   * `closeApprovalWithoutAnswer` píše jen do řádku, který je pořád nerozhodnutý.
   */
  function closeQuestion(approvalId, state, reason) {
  const cancelled = state === 'timeout' || state === 'abandoned';
  try {
    closeApprovalWithoutAnswer(rawDb, approvalId, {
      outcome: cancelled ? APPROVAL_TERMINAL.CANCELLED : APPROVAL_TERMINAL.INVALIDATED,
      reason: reason || state,
      by: 'system',
    });
  } catch { /* databáze pryč — běh stejně končí */ }
  }

  try {
    // ── 2. Jak cíl vypadá teď — to je předpoklad ────────────────────────
    //
    // Čte se **před** ražbou approvalu, aby se člověk rozhodoval o stavu,
    // který skutečně nastal, ne o tom, jaký byl při plánování běhu.
    const beforeRead = await readTargetState(io, effectPath);
    if (!beforeRead.ok) {
      // Nepřečtený cíl znamená, že o něm nic nevíme.  Ptát se člověka na
      // otázku, jejíž předpoklad neumíme ověřit, by byl souhlas naslepo.
      return {
        state: 'precondition_unverifiable',
        written: false,
        target: effectPath,
        code: beforeRead.code,
        message: `Cíl nelze přečíst (${beforeRead.code}), takže nejde ověřit, co se přepisuje.`,
      };
    }
    const before = beforeRead.content;

    const approval = await producer.requestApproval({
      origin,
      runId,
      operationRef: `fs.write:${effectPath}`,
      subjectType: 'effect.write',
      subjectId: effectPath,
      title: before === null ? 'Vytvořit soubor' : 'Přepsat soubor',
      detail: effectPath,
      payload: { path: effectPath, content },
      deviceId,
      precondition: { kind: 'file-digest', ref: effectPath, content: before },
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
    //
    // Selhání obnovy se **nezahazuje** (nález 2).  Když se zámek nepodaří
    // obnovit, přišli jsme o rezervaci, i kdyby čekání pokračovalo — a zápis
    // po ztrátě rezervace je přesně to, co `027` zakazuje.
    heartbeat = setInterval(() => {
      try {
        refreshFileLock(rawDb, { lockId: lock.lock.id, runId });
      } catch (error) {
        lostLock = lostLock || { reason: 'refresh_failed', detail: error.message };
      }
    }, LOCK_HEARTBEAT_MS);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    // ── 3. Čekání na člověka ────────────────────────────────────────────
    const answer = await producer.awaitDecision(approval.id, {
      timeoutMs,
      signal,
      // Čtečka je fail-closed: nepřečtený cíl **není** „neexistuje".  Producent
      // to pozná podle vyhozené výjimky a vyhodnotí jako neověřitelné.
      readTarget: async path => {
        const read = await readTargetState(io, path);
        if (!read.ok) {
          const error = new Error(`unreadable:${read.code}`);
          error.code = read.code;
          throw error;
        }
        return read.content;
      },
    });

    if (answer.state !== 'approve') {
      // Otázka končí **trvale** (nález 4 z review).  Bez toho by řádek zůstal
      // `decided_at IS NULL`, fronta by ho dál nabízela k rozhodnutí a někdo by
      // odpověděl na zápis, který už nemá kdo provést — „ghost approval".
      closeQuestion(approval.id, answer.state, answer.reason);
      return { state: answer.state, written: false, approvalId: approval.id, detail: answer };
    }

    // ── 4. Poslední kontrola, teprve pak zápis ──────────────────────────
    //
    // Mezi souhlasem a zápisem je okno.  Zúžit ho jde, zrušit ne — POSIX zápis
    // souboru není compare-and-swap, takže mezi „přečti a porovnej" a „zapiš"
    // vždycky zbývá mikroskopická štěrbina.  Co se s tím dá dělat poctivě:
    //
    //   * **fencing** — pořád držím zámek, který jsem si vzal?  Bez toho by
    //     stačilo, aby lease vypršel během čekání, a zapisovali bychom přes
    //     práci někoho, kdo si soubor mezitím řádně zamkl (nález 2);
    //   * **poslední ověření předpokladu** těsně před zápisem, ne jen po
    //     souhlasu (nález 1) — pokrývá editor, `git checkout` i jiný nástroj,
    //     kterým je zámek lhostejný;
    //   * **říct nahlas, co zbývá.**  Zbývající okno je řádově mikrosekundy a
    //     zavřít ho by znamenalo, že všichni zapisovatelé jdou přes jednu
    //     mediační vrstvu (CAS/verzovaný storage).  To je rozhodnutí o síle
    //     slibu, ne oprava — viz PROD-READY-HANDBOOK §P0-2.
    if (lostLock) {
      closeQuestion(approval.id, 'lock_lost', lostLock.reason);
      return { state: 'lock_lost', written: false, approvalId: approval.id, detail: lostLock };
    }
    const fence = assertStillHeld(rawDb, { lockId: lock.lock.id, runId });
    if (!fence.ok) {
      closeQuestion(approval.id, 'lock_lost', fence.reason);
      return { state: 'lock_lost', written: false, approvalId: approval.id, detail: fence };
    }

    const finalRead = await readTargetState(io, effectPath);
    if (!finalRead.ok) {
      closeQuestion(approval.id, 'precondition_unverifiable', finalRead.code);
      return {
        state: 'precondition_unverifiable', written: false,
        approvalId: approval.id, target: effectPath, code: finalRead.code,
      };
    }
    if (digestOf(finalRead.content) !== digestOf(before)) {
      closeQuestion(approval.id, 'precondition_changed', 'changed_before_write');
      return {
        state: 'precondition_changed', written: false,
        approvalId: approval.id, target: effectPath, reason: 'changed_before_write',
      };
    }

    await io.mkdir(dirnameOf(effectPath), { recursive: true });
    await io.writeFile(effectPath, content, 'utf8');

    return {
      state: 'written',
      written: true,
      approvalId: approval.id,
      target: effectPath,
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

/**
 * Přečti cíl, nebo **řekni, že to nešlo** — nález 3 z review.
 *
 * Dřív se sem chytaly všechny chyby a překládaly na `null`, tedy „soubor
 * neexistuje".  Na souboru bez práva čtení (ale s právem zápisu do adresáře)
 * to znamenalo: approval se vyrobil jako „Vytvořit soubor" s předpokladem
 * `absent`, kontrola pak porovnávala `absent` s `absent` — a existující soubor
 * se přepsal.  `EACCES` není `ENOENT`; splynutí obou je tichý přepis.
 *
 * @returns {{ok: true, content: string|null} | {ok: false, code: string}}
 */
async function readTargetState(io, filePath) {
  try {
    return { ok: true, content: await io.readFile(filePath, 'utf8') };
  } catch (error) {
    // Jediná chyba, která smí znamenat „cíl neexistuje".
    if (error?.code === 'ENOENT') return { ok: true, content: null };
    return { ok: false, code: error?.code || 'EUNKNOWN', message: error?.message };
  }
}

/** Týž otisk, jaký používá autorita — jinak by se dvě kontroly mohly rozejít. */
function digestOf(content) {
  return content === null || content === undefined
    ? 'absent'
    : createHash('sha256').update(String(content)).digest('hex').slice(0, 32);
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
