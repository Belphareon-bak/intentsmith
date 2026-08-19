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

/**
 * @param {Object} io  `mkdir`/`writeFile`/`rename`, volitelně `rm`
 * @param {string} effectPath  kanonický cíl
 * @param {string} content
 */
export async function commitFile(io, effectPath, content) {
  await io.mkdir(dirnameOf(effectPath), { recursive: true });
  const temporary = `${effectPath}.intentsmith-${process.pid}-${Date.now()}.tmp`;
  try {
    await io.writeFile(temporary, content, 'utf8');
    await io.rename(temporary, effectPath);
  } catch (error) {
    // Úklid nesmí přebít původní chybu: co selhalo, je zápis, ne mazání.
    try { await io.rm?.(temporary, { force: true }); } catch { /* prázdné schválně */ }
    throw error;
  }
}

/** Výchozí `io`.  Obsahuje `rename` — bez něj by `commitFile` nebyl atomický. */
export async function defaultFs() {
  const { readFile, writeFile, mkdir, rename, rm } = await import('node:fs/promises');
  return { readFile, writeFile, mkdir, rename, rm };
}

export function dirnameOf(filePath) {
  const index = filePath.lastIndexOf('/');
  return index <= 0 ? '/' : filePath.slice(0, index);
}

export default { commitFile, defaultFs, dirnameOf };
