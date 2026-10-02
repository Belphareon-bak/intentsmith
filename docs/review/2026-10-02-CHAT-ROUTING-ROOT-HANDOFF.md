# ROOT: informační dotaz nesmí otevřít kalkulační upřesnění

Stav: **OPEN_DEFECT / OWNER_CONTACT_UNKNOWN / NOT_FIXED**.
Autorita: operátorův doplňující posudek z 2. 10. 2026 požaduje zachovat reálnou
vadu `routing-accuracy` a opravu koordinovat podle vlastnictví s ROOT.

Reprodukce je stávající nezměněný `tests/routing-accuracy.test.js`, případ 18:
„Co je DPH v Německu?“ má očekávaný výsledek bez kalkulačního nástroje.
Úplný profil `0fad3823` (stejně jako předchozí `289afec0`) vrací `accountant.vat_calculator → clarify
[calculationIntent]`, precision 5/6 = 83,3 %, požadavek 95 %.
Nejde o doložený provedený výpočet: tento offline důkaz dokládá falešný
výběr nástroje a nadbytečné kalkulační upřesnění. Živou odpověď tohoto
konkrétního dotazu tato reprodukce neposuzuje.

Skutečná cesta:

- `tests/routing-accuracy.test.js:184` → skutečný registrovaný accountant,
  `SpecialistRuntime.tryToolExecution` (`src/expertises/specialist-runtime.js:467`).
- `IntentDetector.detect` (`src/expertises/specialist-runtime.js:173`) vrací
  první shodu patternu, následné parametry nezakládají kontrolu významu operace.
- `specialists/accountant-cz/index.js:357` registruje VAT pattern samotného DPH
  s prioritou 8. Tento pattern odpovídá i informačnímu dotazu o zahraničí.
- `specialists/accountant-cz/vat-request.js:202` má package-owned resolver;
  bez core `interpretInput` vrací `inputError: calculationIntent` místo
  vyhodnocení, že nástroj vůbec neměl být vybraný. M3 pak vyvolá upřesnění.

Chatový WP vlastní sdílený specialist-runtime pouze pro invalidaci staré
session cache. Tato oprava nástrojové způsobilosti je širší sdílená cesta,
proto zde nebyla svévolně upravena registrace, VAT resolver ani integrační test.

Konkrétní požadavek k předání ROOT: určit vlastníka eligibility/registrace a
zabránit výběru kalkulačky pro informační žádost; zachovat výslovné výpočty,
nutné upřesnění skutečně chybějící částky/sazby a jejich fail-closed parametry.
Není správné odstranit selhávající případ, změnit očekávání na kalkulačku,
potlačit FAIL nebo nahradit neznámé parametry defaultem. Doporučené alternativy
jsou package-owned eligibility nebo typovaný „not applicable“ návrat resolveru,
pokud společný kontrakt takové předání na čtecí odpověď přijme.

Ověření po opravě: nezměněná routing sada, pozitivní i negativní VAT případy,
číselné návaznosti a negace, skutečný M1 HTTP informační dotaz a explicitní
výpočet. Přesné SHA, odpovědi a skutečné efekty patří do evidence kandidáta.
Kontakt ROOT/integračního vlastníka zatím není určen; dosud nebyla odeslána
externí zpráva, vytvořena PR ani udělena přejímka.
