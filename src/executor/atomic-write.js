// Zápis, po kterém nezůstane půlka souboru
// ==============================================================================
//
// `fs.writeFile` na existující soubor ho nejdřív **zkrátí na nulu** a teprve
// pak píše.  Když proces mezi tím spadne — OOM, `SIGKILL`, výpadek proudu —
// zůstane po něm poloviční soubor.  Uživatel kývl na to, že dostane nový
// obsah; nekývl na to, že může přijít o starý a nedostat žádný.
//
// `rename` v rámci jednoho filesystemu je atomický: čtenář vidí buď starou,
// nebo novou verzi, nikdy stav mezi.  Dočasný soubor proto leží ve **stejném
// adresáři** jako cíl — `rename` přes hranici filesystemu neexistuje a `/tmp`
// bývá jiný filesystem.
//
// Tohle je jediná vlastnost, kterou tenhle modul má, a je schválně oddělený:
// používá ho `guarded-write.js` (zápis po schválení) i `effects.js` (zápis bez
// rozhodovací roviny), a kdyby si ji každý implementoval sám, lišily by se
// právě v tom, co se stane při pádu.
//
// ==============================================================================

import { randomUUID } from 'node:crypto';
import path from 'node:path';

/**
 * @param {Object} io  `mkdir`/`writeFile`/`rename`, volitelně `rm`
 * @param {string} effectPath  kanonický cíl
 * @param {string} content
 */
export async function commitFile(io, effectPath, content) {
  await io.mkdir(dirnameOf(effectPath), { recursive: true });

  // Jméno dočasného souboru musí být **bezpečně unikátní**.  `pid + čas` se dá
  // ve dvou procesech ve stejné milisekundě trefit, a dva zápisy sdílející
  // temp soubor jsou tichý přepis o patro níž.
  const temporary = `${effectPath}.intentsmith-${randomUUID()}.tmp`;

  // Práva cíle se **převezmou**, jinak je `rename` zahodí.
  //
  // `writeFile` na nový soubor použije umask, takže přepis souboru `0755`
  // skončil souborem `0664` — a spustitelný skript přestal být spustitelný.
  // Uživatel kýval na změnu **obsahu**, ne na to, že mu program přestane jít
  // pustit.  U neexistujícího cíle se nechává výchozí umask, protože přebírat
  // není od čeho.
  let targetMode = null;
  try {
    targetMode = (await io.stat(effectPath)).mode & 0o7777;
  } catch { /* cíl neexistuje — vytváříme ho, umask platí */ }

  let handle = null;
  try {
    // `open` + `write` + `fsync`, ne `writeFile`: bez `fsync` může `rename`
    // přežít pád, ale obsah ne — a zůstane přejmenovaný prázdný soubor.
    handle = await io.open(temporary, 'wx', targetMode ?? 0o666);
    await handle.writeFile(content, 'utf8');
    if (targetMode !== null) await handle.chmod(targetMode);
    await handle.sync();
    await handle.close();
    handle = null;

    await io.rename(temporary, effectPath);

    // A ještě adresář: `rename` je atomický, ale jeho **záznam** v adresáři
    // nemusí být na disku dřív než po `fsync` toho adresáře.
    await syncDirectory(io, dirnameOf(effectPath));
  } catch (error) {
    // Úklid nesmí přebít původní chybu: co selhalo, je zápis, ne mazání.
    if (handle) { try { await handle.close(); } catch { /* prázdné schválně */ } }
    try { await io.rm?.(temporary, { force: true }); } catch { /* prázdné schválně */ }
    throw error;
  }
}

/** `fsync` na adresář. Neúspěch se spolkne — ne každý filesystem to umí. */
async function syncDirectory(io, dir) {
  if (typeof io.open !== 'function') return;
  let handle = null;
  try {
    handle = await io.open(dir, 'r');
    await handle.sync();
  } catch { /* na některých platformách nejde adresář otevřít ke čtení */ }
  finally {
    if (handle) { try { await handle.close(); } catch { /* prázdné schválně */ } }
  }
}

/**
 * Výchozí `io`.  Obsahuje `rename` (bez něj by `commitFile` nebyl atomický),
 * `stat` (převzetí práv) a `open` (`fsync`).
 */
export async function defaultFs() {
  const fs = await import('node:fs/promises');
  const { readFile, writeFile, mkdir, rename, rm, stat, open } = fs;
  return { readFile, writeFile, mkdir, rename, rm, stat, open };
}

export function dirnameOf(filePath) {
  return path.dirname(filePath);
}

export default { commitFile, defaultFs, dirnameOf };
