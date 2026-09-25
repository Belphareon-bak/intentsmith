# GPU hunt: kontrola posudku po zmrazení

25. 9. 2026 · **dodatek k vývojovému posudku, nikoli tichá úprava známek**

Původní [Codexův posudek](evidence/2026-09-25-hunt-codex-all-dr-development-review.json) je navázán na SHA256 `72231c6d959c80157f88ead2733b2e8de7a2532b827ff5b747c83c97b632e4b7`. Následující kontrola vznikla až po otevření rozpracovaného druhého posudku. **Není nezávislým druhým slepým hodnocením.** Vstupní známky neměním; rozdíly jdou do rozsouzení a případná změna musí mít vlastní záznam.

## Ověřená chyba mého čtení: `d2_metrics_flush`, odpověď `330085f8-b698-45ea-a20c-a6b971bdd579`

Navržený kód deklaruje `const batch = this._buffer.splice(0)` uvnitř `try`, ale v `catch` volá `this._buffer.unshift(...batch)`. V JavaScriptu nemá `catch` přístup k této blokové proměnné. Při selhání databáze se proto místo obnovy dávky vyhodí `ReferenceError` a data nejsou vrácena do bufferu. Reprodukce bez GPU:

```js
try {
  try { const batch = [1, 2, 3]; throw new Error('db failed'); }
  catch (_) { console.log(batch.length); }
} catch (error) {
  console.log(error.name + ': ' + error.message);
}
// ReferenceError: batch is not defined
```

Můj původní rozpad `[1, 0.8, 0.85, 0.75]` tedy přecenil především kritérium bezpečné opravy a kritérium odmítnutí zkratky. Rozpracovaný druhý posudek tento scope problém uvádí a známkuje `[1, 0.25, 0.25, 0.75]`. Tento konkrétní rozpor má oporu ve spustitelné sémantice jazyka; operátor by měl rozhodnout o výsledném rozpadu, ne jen o průměru.

## Další dva spory téže úlohy k ověření

- `a4deb62a-66de-4f2f-b25b-1660a7cf40e1`: odpověď tvrdí, že `recordEvent` může vstoupit mezi začátek a konec synchronní `tx(batch)` přes event loop. V předaném synchronním úseku to bez výslovné reentrance přes callback nelze odvodit. Můj kredit 0,9 za kritérium 3 je pravděpodobně příliš vysoký; druhý posudek dává 0,25. Přesná hranice případné synchronní reentrance má být součástí rozsouzení.
- `d6ea4dbc-6a77-48c1-b7c9-6839c8a9a05e`: odpověď tvrdí, že `unshift(...batch)` rozhází pořadí. Samo vložení dávky na začátek pořadí zachová. Můj kredit 0,55 za kritérium 3 byl příliš velkorysý; druhý posudek dává 0,25.

Tento audit potvrzuje potřebu obou posudků po jednotlivých kritériích. Neprokazuje jejich celkovou shodu ani kvalitu celé D2 sady. `model_cleanup` zůstává ve zmrazeném posudku konzervativně bez známky; [kontextový audit](2026-09-25-HUNT-DR-CONTEXT-REVIEW.md) zároveň výslovně říká, že ne všechny podmínky tohoto scénáře jsou nemožné.
