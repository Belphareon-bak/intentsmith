# Zapečetěný holdout CHAT — 2. 10. 2026

**Stav:** `SEALED / NOT_RUN`. Autorita: explicitní zadání operátora z 2. 10. 2026
zorganizovat nezávislý holdout a slepé hodnocení pro přejímku kvality chatu
(`docs/wp/WP-CHAT-QUALITY-20261001.md`, milník S10: „předat zmrazeného kandidáta
nezávislému autorovi/hodnotiteli holdoutu“). Tento dokument nepřidává produktovou
ani schvalovací autoritu a nemění kritéria přejímky.

## Pečeť

| Položka | Hodnota |
| --- | --- |
| Šifrovaný soubor | `/mnt/vi7000/intentsmith/evidence/chat-holdout-20261002/holdout.json.gpg` |
| SHA-256 šifrovaného souboru | `44c872c206abd2d618c35e24ee0bc2449e6f3f401fe59e6b6dc809b24dd26961` |
| SHA-256 dešifrovaného `holdout.json` | `2431296e7a1583329fb4185a1dbbe6610749985385cd1afa2c6952428b63e9ff` |
| Šifrování | GPG symetricky, AES256; heslo má pouze operátor |
| Zapečetěno | `2026-10-02T11:58:00Z` |

Dešifrovaný soubor musí mít přesně uvedený SHA-256. Jakákoli odchylka = holdout
neplatný, běh se nespouští.

## Vznik a expozice

- **Autor:** nový agent `claude-opus-5-5` bez kontextu. Dostal jen produktový
  kontrakt (`PRODUCT.md` §1–3, parafráze), popis dostupných schopností izolovaného
  běhu a schéma případu runneru. Podle zadání i vlastního hlášení nečetl repozitář,
  existující korpus, rubriku, evidenci S1/S2 ani výsledky ladění a nepoužil web.
- **Koordinátor** (Claude, relace operátora) znal starý korpus a selhání S1/S2,
  ale do holdoutu nevkládal žádné případy ani nápovědy a jeho obsah nečetl.
  Kontroloval pouze strukturu: počty, schéma runneru, vazby `fromCase`, fixture,
  doslovné bajty uložení.
- Chat worker, ROOT ani koordinátor holdout před odpečetěním neotevírají a adresář
  `/mnt/vi7000/intentsmith/evidence/chat-holdout-20261002/` neprohledávají.

## Obsah (jen struktura)

- 96 kroků: 60 česky, 36 anglicky; `usedForTuning: false`, `variant: "holdout"`.
- 9 rodin `HX-EXPLAIN`, `HX-CONSTRAINT`, `HX-CONTINUITY`, `HX-CLARIFY`, `HX-FILE`,
  `HX-UNAVAILABLE`, `HX-UNTRUSTED`, `HX-CODE`, `HX-ROBUST` (9–15 kroků každá).
- 71 klíčů dialogu, z toho 17 vícekrokových (42 kroků).
- 14 schvalovaných akcí: 6 `fs.read`, 3 uložení předchozí odpovědi, 2 generovaný
  obsah, 3 doslovný text; 7 fixture souborů.
- Doptání: 85 `unnecessary`, 4 `permitted`, 7 `required`.
- Ke každému kroku `required`, `allowed`, `forbidden`, `critical`, `clarification`
  a `verification` pro hodnotitele.

## Kritéria (beze změny proti rubrice)

≥ 95 % užitečných reakcí, ≤ 5 % zbytečných zastavení, 0 kritických chyb, tři
nezměněná úplná opakování. Výsledek se uvádí zvlášť pro každou sérii, jazyk a
rodinu. 36 anglických kroků nestačí k prokázání jazykové parity v mezích 5 p. b.;
rozdíl se reportuje, ale nerozhoduje sám.

## Protokol

1. **Kandidát (chat worker).** Před odpečetěním opravit doložené chyby s
   reprodukcí: kritické vymyšlené odeslání e-mailu (`recipient-bob`, S2) a
   `gpu-composite` (3/3 v S2). Poté zmrazit: čistý commit, push, ověřený
   vzdálený SHA zapsaný do průběžného reportu.
2. **Runner (chat worker, před zmrazením).** Do `scripts/measure-m1-l3.js`
   přidat režim `--holdout FILE --holdout-sha256 HEX` s fázemi `holdout-1..3`:
   před jakoukoli inferencí ověřit SHA-256 souboru proti této pečeti; přijmout
   `version: 1`, libovolný počet kroků, `usedForTuning: false`,
   `variant: "holdout"` a `fixtures`. Ostatní pravidla jako u `final-*`: povinné
   A/B, bez filtru případů, zákaz driftu manifestu mezi opakováními, čistý
   strom. Ověřit pouze na syntetickém dummy holdoutu, nikdy na skutečném souboru.
   Změna runneru je součástí zmrazeného kandidáta.
3. **Odpečetění (operátor).** Až po zapsání zmrazeného SHA operátor dešifruje
   soubor do privátního umístění mimo repozitář (mode 600):
   `gpg --decrypt --output <cesta>/holdout.json holdout.json.gpg` a ověří
   `sha256sum`. Worker spustí tři série za sebou, odpovědi mezi nimi nečte
   ani nehodnotí a nic nemění.
4. **Slepé hodnocení (nezávislý hodnotitel, organizuje koordinátor).** Nová
   relace bez kontextu dostane zaslepený balík: krok s historií dialogu,
   odpovědi B a A pod štítky X/Y náhodně přiřazenými po krocích (klíč uložen
   zvlášť), bez commitu, modelu, run ID a bez vlastního hodnocení workera;
   k tomu `required`/`forbidden`/`critical`/`verification` z holdoutu. Souborové
   efekty a EffectResults se vyhodnotí strojově z evidence runneru.
5. **Odslepení a verdikt.** Po uzavření hodnocení se spáruje klíč a zveřejní
   výsledky po sériích, jazycích a rodinách; kritické nálezy s providerovou trace.
6. **Po běhu je holdout spálený.** Další přejímka po dalších opravách potřebuje
   nový, znovu nezávisle napsaný holdout.

Integrační vlastník (CI, `routing-accuracy`) je samostatné rozhodnutí operátora
a tento protokol jej neurčuje.
