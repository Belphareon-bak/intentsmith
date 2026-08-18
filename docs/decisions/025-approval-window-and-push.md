# 025 — Jak dlouho approval čeká a jak se o něm dozvíš

- **typ:** produktové rozhodnutí; **mění přijatý kontrakt `R-3` / `DR-011`**
- **stav rozhodnutí:** SMĚR PŘIJAT operátorem 2026-08-18 (varianta **D + 2**);
  otevřené jsou už jen implementační podrobnosti níže
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

Pokud se ukáže, že trvalé spojení příliš žere baterii, fallback je **4 (FCM)
s obsahem `S1`** — tedy „něco čeká", nikdy co. I tak jde o rozhodnutí poslat
informaci ven a patří do stejné diskuse.

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

## Co je potřeba udělat (když se přijme D + 2)

1. Sundat časový strop z `approval-authority` a nahradit ho vazbou na obsah;
   `awaitDecision()` přestane hlídat okno a začne hlídat platnost otisku.
2. **Přidat předpoklad efektu** (bod 2 výše) — approval si nese stav cíle a ten
   se ověřuje při provedení; nesouhlas = propadnutí, ne tiché přepsání.
3. **Desktopová rozhodovací plocha** nad `mobile_approvals`, aby telefon nebyl
   jediná cesta.
4. Revokace a odhlášení ruší čekající approvaly.
5. Nativní služba, která drží spojení a zobrazí systémovou notifikaci
   (text `S1`, žádný obsah — jako dnes ve schránce).
6. Přepsat `DR-011` v `PLAN.md`, `DATA-MODEL.md` a `SCREENS.md`; obrazovka
   `MS-14` dnes ukazuje odpočet, který přestane existovat.
7. Testy: čekání přes restart gateway, propadnutí při změně obsahu, zrušení
   při revokaci, a že se z čekání nikdy nestane souhlas.

Body 1 a 4 jsou zásah do přijatého kontraktu — proto to je rozhodnutí, ne úkol.
