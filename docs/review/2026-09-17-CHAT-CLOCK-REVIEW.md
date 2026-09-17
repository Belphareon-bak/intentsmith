# Obecný časový kontext chatu

**IMPLEMENTED / REVIEW_REQUIRED**, vstup `e0b75ee4`.

Systémový čas byl správný (`Europe/Prague`, synchronizace NTP zapnutá).
`kolik je hodin?` šlo přes LOCAL; `a datum?` nemělo deterministickou cestu
a odpovídal model bez aktuálního data v systémovém promptu. To není závada
hodin počítače. Další reprodukce: `jaké datum bylo včera?` sice dostalo LOCAL,
ale dosavadní formatter vždy zobrazil dnešek.

Společný `generateChatResponse` nyní přidává k **jakémukoli** dotazu aktuální
UTC okamžik, lokální čas a zónu, ISO data i dny v týdnu pro včera/dnes/zítra.
Platí pro chat, expertizy, specialisty, design i syntézu a pro opakování
požadavků. Připravené pole messages nemůže kontext přeskočit a nemění se
in-place. Stejný referenční blok dostává obrazová odpověď. Čas se nevkládá
pouze při startu serveru. Historické/hypotetické reference se mají zachovat;
čas sám není zdrojem znalostí o aktuálních událostech.

Modelové evaluace a exact M1 artefaktové požadavky se nepřepisují. Jde o
interaktivní odpovědi, nikoli změnu skórovacího kontraktu huntu. Datumové
zkratky mají úzký celé-věty matcher. Historické datum, datum vydání a posuny
jako „za 14 dní“ se už nemají tvářit jako dotaz na dnešní lokální hodiny.
Lokální včera/zítra se odvozují od timestampu potvrzeného M2 výsledku, po
kalendářních dnech, nikoli přičtením 24 hodin. Nové importní hrany směřují z
`src/llm/cre-bridge.js` a `src/chat/handlers/utils/file-explain.js` do
`src/llm/clock-context.js` (čistý modul bez I/O). Vysvětlení souboru zahrnuje
časový blok do preflight rozpočtu, stejně jej dostává analýza projektu.

Ověření provider payloadu používá skutečnou bridge/gateway cestu a řízený
provider; neprokazuje tím samo o sobě poslušnost každého fyzického modelu.
HTTP test skutečného serveru naopak ověřuje výslednou odpověď v navazující
konverzaci bez dostupného modelu.

První focused běhy: CRE **26/26**, model contract **34/34**, skutečný
HTTP/persistence **36/36**, chat fixes **58/58**. Přímý doplňkový modelový
`chat-pipeline` běh skončil **50 PASS / 2 FAIL**: „udělej souhrn o AI“ a
sticky SEARCH „a co dál?“. Šlo o běh se skutečným klasifikačním providerem,
nikoli offline důkaz. Tyto dva výsledky nejsou přebarvené; jejich baseline
porovnání v tomto clock patchi neproběhlo. První ruční boundary příkaz měl
chybnou příponu `.js`; správný `.mjs` ohlásil výše uvedenou jedinou novou hranu.
Raw logy: `.intentsmith-artifacts/chat-date-20260917/`.

První dokumentační kontrola měla chybný oddělovač v LOC tabulce (157/158);
formát tabulky byl opravený, samotná validační podmínka se neměnila.
