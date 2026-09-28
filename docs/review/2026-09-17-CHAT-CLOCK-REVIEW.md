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

## Závěrečný stav

Runtime **`58d7cced4863663e86440c735fbb91fe3b3edcdb`**, review rozsah
`e0b75ee4..58d7cced`. Následný dokumentační commit mění pouze výsledky,
aktuální odkazy a přesnou census frázi v ROADMAP.
[Strojový záznam](../execution/runs/chat-clock-20260917.json).

Celý profil na tomto SHA: **353 PASS / 2 FAIL / 0 BLOCKED / 0 TIMEOUT**.
FAIL jsou `artifact-validation` (text „Graph má“ místo „module graph má“)
a `nightly-orchestrator-self-test` (release seal). Dokumentační oprava následně
prošla **158/158**; žádná assertion se kvůli ní neupravovala. Celý profil po
čistě dokumentační opravě znovu neběžel a jeho původní FAIL se nepřepisuje.
Registry zůstává **519**, fingerprint `04252cb29ea270886c049b01034c2bfec034a77d22ec4675decf593ae052ecb6`.
Module boundary **1 339 hran, 3 cykly / 28 členů**, finální kontrola PASS.

V čistém detached instalačním snapshotu znovu prošly model contract **34/34**
a skutečný HTTP/persistence **36/36**; file consumer prošel **39/39**.
Studio ani závislosti se proti `1da840c0` nezměnily byte-for-byte, byl použit
ověřený build a instalátor opět zkontroloval jeho consumer hash. Instalace
provedla zálohu a migration probe, potom restart backendu a běžné spuštění
Studia ikonou. Backend, Studio a hunt mají společný pin; timer je aktivní,
hunt zůstal nečinný. Historie 503 evaluací, 21 hunt pokusů a settings má stejné
hashe jako před aktualizací, SQLite kontrola je OK.

### Skutečný modelový dotaz přes nainstalovaný backend

Samostatná diagnostická konverzace požádala o tři deníkové nadpisy pro
včerejšek, dnešek a zítřek, každý s ISO datem. Uložená metadata dokládají
**`qwen3.5:27b`, intent `CREATIVE`**. HTTP **200**, odpověď za **49 933 ms**:

> Deníkové záznamy 2026-09-16: Včerejší události a úvahy
> Dnešní pohled na svět 2026-09-17: Co se dnes stalo
> Plány do budoucnosti 2026-09-18: Zítřejší naděje

Všechna tři data odpovídají referenci `Europe/Prague` v okamžiku dotazu.
To je skutečný modelový výsledek obecného úkolu, nikoli odpověď lokálního
nástroje nebo stubu. Není to nový hunt panel, důkaz obecné neomylnosti modelů
ani splnění latency SLO. Nová diagnostická konverzace je záměrně zachovaná;
žádná původní konverzace nebyla přepsána. Nezávislé re-review stále zbývá.

Zdroj i tento packet jsou publikované na
[`work/chat-date-context-20260917`](https://github.com/Belphareon-bak/intentsmith/tree/work/chat-date-context-20260917).
Výchozí GitHub větev `main` se tím nemění; jde o kandidáta k review.
