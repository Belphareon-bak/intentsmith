# 025 — Jak dlouho approval čeká a jak se o něm dozvíš

- **typ:** produktové rozhodnutí; **mění přijatý kontrakt `R-3` / `DR-011`**
- **stav rozhodnutí:** **PŘIJATO operátorem 2026-08-19** — varianta **D + 2**,
  včetně obou pojistek (revokace ruší čekající approvaly, citlivé efekty si
  nesou vlastní strop). Otázka spotřeby baterie se **neuzavírá odhadem, ale
  měřením** — viz §Probuzení níže
- **vyvolal:** operátor 2026-08-18: *„approval by neměl mít nějaký limit, měl by
  prostě počkat… mobilní appka dá push notifikaci a počká na vyjádření"*
- **souvisí:** `DR-011` (okno approvalu), `N-1` (notifikace při spící appce),
  `MR-21`, [PROD-READY-HANDBOOK.md](../mobile/PROD-READY-HANDBOOK.md) §P1-4

## O co jde

Dnes approval **propadne po 5 minutách** (lokálně) nebo 15 (vzdáleně). Není to
technický detail, je to přijaté pravidlo `DR-011` a kód ho drží schválně tak, že
ho nejde obejít: okno není parametr, nejde prodloužit a čekající běh nesmí okno
přežít.

Operátor chce jiné chování: **běh počká, dokud člověk neodpoví**, a telefon o tom
dá vědět push notifikací.

To dává smysl, ale mění bezpečnostní vlastnost, takže to musí být vědomé:

> Approval, který čeká tři dny, je připravené „ano" pro toho, kdo mezitím
> telefon ukradne nebo ho najde odemčený.

A druhá věc, která se často přehlédne: **bez notifikace nemá „čekej navždy"
smysl.** Běh by visel, dokud si člověk náhodou neotevře aplikaci. Proto je to
jedno rozhodnutí, ne dvě.

## Varianty — jak dlouho approval platí

| | Chování | Co získáš | Co ztratíš |
|---|---|---|---|
| **A. Nechat `DR-011`** | 5 / 15 minut | Ukradený telefon má úzké okno. Žádná změna kontraktu | Musíš být u telefonu do pěti minut, jinak běh skončí bez efektu |
| **B. Bez limitu** | Čeká, dokud neodpovíš | Přesně to, co chceš od companiona | Visící „ano" bez konce. Běh drží zdroje. Po týdnu schválíš něco, co si nepamatuješ |
| **C. Dlouhé okno** | Hodiny (např. 8 h) | Praktické a pořád omezené | Arbitrární číslo — proč zrovna osm |
| **D. Vázané na obsah, ne na čas** ⭐ | Čeká libovolně dlouho, ale **propadne, když se změní to, co schvaluješ** | Čeká, dokud dává smysl čekat. Nezastarává tiše | Musí být jasné, co „změna" znamená pro každý druh efektu |

**Rozhodnuto: D, s bezpečnostním stropem.** Otisk obsahu už v kódu je — approval
je na něj navázaný a rozhodnutí se ověřuje proti němu. Stačí sundat časový strop
a nechat platnost na obsahu. Ke stropu bych přidal dvě pojistky:

1. **Odhlášení nebo revokace zařízení zruší čekající approvaly.** Ztracený
   telefon tím přestane být čekajícím „ano".
2. **Volitelný horní strop pro citlivé efekty** (mazání, nasazení, peníze) —
   ne globální číslo, ale vlastnost toho efektu.

## Varianty — jak se o approvalu dozvíš

| | Jak | Závislost na cizí infrastruktuře | Cena |
|---|---|---|---|
| **1. Nijak (dnes)** | Uvidíš, až appku otevřeš | žádná | Companion, který nedoprovází |
| **2. Trvalé spojení z telefonu** ⭐ | Aplikace drží spojení na gateway (přes VPN nebo kabel) a upozorní hned | **žádná** | Trvalá notifikace v liště („aplikace běží"), baterie. Funguje jen když je VPN/kabel nahoře |
| **3. ntfy self-hosted** | Vlastní server posílá push | vlastní server + instalace mimo Play Store | Provoz serveru; z Play Storu stejně jede přes Google |
| **4. FCM** | Standardní Android push | **Google** | Existence notifikace projde přes Google. V rozporu s „lokální first" |

**Rozhodnuto: 2.** Teď, když je z toho **nativní aplikace** a ne PWA, je tahle
možnost otevřená — v původním rozvažování `N-1` chyběla, protože se počítalo
s PWA, která trvalé spojení držet nemůže. Nic neopouští zařízení ani domácí síť,
což odpovídá tomu, čím produkt je. Navazuje to na rozhodnutí
[026](026-wireless-gateway-access.md): bez VPN funguje jen na kabelu.

## Probuzení: co si operátor přeje a co dovolí systém

> „chce to trvalé spojení v případě, že uživatel používá app, nebo pokud BE
> vyšle nějakou notifikaci, aby se automaticky navázalo spojení" — operátor,
> 2026-08-19

První polovina je snadná a je to správně: **appka v popředí drží spojení**,
takže co se stane, je hned vidět. Druhá polovina naráží na vlastnost systému,
kterou nemá smysl obcházet slibem:

> **Spící aplikaci nemůže probudit náš vlastní server.** Android to dovolí jen
> tomu, kdo už spojení drží, nebo push službě, kterou zná operační systém.
> „Navázat spojení, když BE vyšle notifikaci" tedy znamená, že *něco* muselo
> běžet už předtím.

Jsou přesně tři způsoby, jak to udělat, a liší se tím, co platíš:

| Způsob | Latence | Co to stojí | Cizí infrastruktura |
|---|---|---|---|
| **Trvalé spojení** (foreground service) | okamžitá | baterie + **trvalá ikona v liště**, kterou Android vyžaduje | žádná |
| **Periodické dotažení** (`WorkManager`) | až ~15 minut (systémový strop) | téměř nic | žádná |
| **FCM** | okamžitá | nic navíc | **Google** |

**Rozhodnuto: nejdřív změřit, pak vybrat.** Trvalé spojení se postaví jako
výchozí, změří se spotřeba na skutečném telefonu za 24 hodin běžného dne a
teprve podle čísla se rozhodne, jestli stačí, jestli se doplní periodické
dotažení jako úsporný režim, nebo jestli přijde na řadu FCM.

**Měření musí odpovědět na tohle:** kolik procent baterie spotřebuje aplikace
za 24 h v pozadí s drženým spojením, jak se to změní přes noc (Doze), a jestli
výrobce telefonu spojení sám neukončí — poslední bod je u některých značek
zásadnější než spotřeba, protože žádné číslo nezachrání spojení, které systém
zabije.

Do té doby platí, že **spící aplikace o approvalu neví**, a produkt to musí
říkat nahlas (`P1-4` v handbooku), místo aby to tiše předpokládal.

## Co znamená „změna toho, co schvaluješ" (upřesnění operátora)

Jsou to **dvě nezávislé věci** a approval musí propadnout, když se změní
kterákoli z nich:

| | Co se změnilo | Příklad | Stav v kódu |
|---|---|---|---|
| **1. Návrh** | agent navrhuje něco jiného, než co jsi viděl | text, který se má zapsat, je jiný | ✅ hotovo — otisk obsahu (`payload_fingerprint`) |
| **2. Svět pod návrhem** | návrh je stejný, ale cíl se mezitím změnil | soubor, do kterého se má zapsat, mezitím někdo přepsal | ❌ chybí — v IDE to řeší `baseHash`, v mobilní cestě obdoba není |

Bez bodu 2 je „čekej libovolně dlouho" nebezpečné právě proto, že čas plyne:
schválíš změnu proti verzi souboru, která v době provedení už neexistuje.
**Předpoklad efektu musí být součástí approvalu**, ne jen jeho popisu — a musí
se ověřit ve chvíli provedení, ne ve chvíli schválení.

## Zdroj pravdy a rozhodovací plochy (upřesnění operátora)

> „Mobilní aplikace víceméně zrcadlí stav BE… BE je zdroj pravdy, mobilní
> aplikace z něj dostává aktuální info."

Z toho plynou čtyři pravidla, tři už platí a jedno chybí:

1. **Approval je řádek v BE**, ne stav v telefonu. ✅
2. **Nově spárovaný telefon vidí všechny nerozhodnuté approvaly** — fronta není
   vázaná na zařízení. ✅
3. **Notifikace je pobídka, ne nosič dat.** Ať přijde jakkoli, aplikace si stav
   vždycky natáhne z BE. ✅ (a je to důvod, proč je notifikace `S1` bez obsahu)
4. **Rozhodnout musí jít i z IDE na PC.** ❌ **Chybí.** Na `mobile_approvals`
   dnes nesahá nic mimo mobilní cestu, takže když se agent zeptá takhle, je
   telefon jediná možnost. To je proti zadání a je to samostatná práce:
   desktopová plocha nad **toutéž** tabulkou, se stejnou autoritou a stejným
   ověřením otisku.

Přímý důsledek: **běh se neptá telefonu, ptá se člověka.** Telefon je jedna
cesta, IDE druhá. Bez spárovaného telefonu žádná vzdálená cesta neexistuje a
rozhoduje se u počítače — čímž mizí i obava, že by běh visel na odpověď, kterou
nemá kdo dát.

## Stav implementace (2026-08-19)

| Krok | Stav |
|---|---|
| Předpoklad cíle v approvalu (migrace 062, autorita, producent) | ✅ hotovo — 7 testů |
| Klient: „platí, dokud se cíl nezmění" místo odpočtu | ✅ hotovo — 2 testy |
| Zámek na soubor (027), aby předpoklad nepadal zbytečně | ✅ hotovo — 16 testů |
| Ověření předpokladu **při provedení**, ne při schválení | ✅ hotovo — `awaitDecision({ readTarget })` |
| Desktopová plocha (P0-6) — API | ✅ hotovo — 10 testů; GUI v IDE zbývá |
| Zapojení do reálného efektu (P0-2) | ✅ hotovo — editační cesta jádra, 7 testů |
| Trvalé spojení a měření baterie | ⬜ |
| Přepis `DR-011` v PLAN/DATA-MODEL/SCREENS | ⬜ |

Dvě věci, které z implementace vyplynuly a v rozhodnutí nebyly:

1. **Kontroluje se i během čekání, ne jen na konci.** Když se cíl změní dřív,
   než člověk odpoví, nemá smysl ho nechat odpovídat na neaktuální otázku —
   čekání skončí hned a běh to řekne.
2. **Předpoklad ověřuje jádro, ne gateway.** Gateway by kvůli tomu musela umět
   číst soubory, které dnes číst neumí; dát mobilnímu povrchu schopnost číst
   disk kvůli kontrole je větší díra, než jakou to zavírá. Chybějící čtečka se
   proto počítá jako **neplatný předpoklad**, ne jako „v pořádku" — jinak by
   stačilo ji zapomenout předat a kontrola by tiše zmizela.

## Co je potřeba udělat (když se přijme D + 2)

1. Sundat časový strop z `approval-authority` a nahradit ho vazbou na obsah;
   `awaitDecision()` přestane hlídat okno a začne hlídat platnost otisku.
2. **Přidat předpoklad efektu** (bod 2 výše) — approval si nese stav cíle a ten
   se ověřuje při provedení; nesouhlas = propadnutí, ne tiché přepsání.
3. **Desktopová rozhodovací plocha** nad `mobile_approvals`, aby telefon nebyl
   jediná cesta.
4. Revokace a odhlášení ruší čekající approvaly.
5. Nativní služba, která drží spojení, zobrazí systémovou notifikaci (text
   `S1`, žádný obsah — jako dnes ve schránce) a **v popředí je vždy zapnutá**.
6. Změřit spotřebu za 24 h na skutečném telefonu a podle výsledku doplnit
   úsporný režim (periodické dotažení), nebo ne.
7. Přepsat `DR-011` v `PLAN.md`, `DATA-MODEL.md` a `SCREENS.md`; obrazovka
   `MS-14` dnes ukazuje odpočet, který přestane existovat.
8. Testy: čekání přes restart gateway, propadnutí při změně obsahu, zrušení
   při revokaci, a že se z čekání nikdy nestane souhlas.

Body 1 a 4 jsou zásah do přijatého kontraktu — proto to je rozhodnutí, ne úkol.
