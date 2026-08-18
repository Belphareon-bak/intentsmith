# 025 — Jak dlouho approval čeká a jak se o něm dozvíš

- **typ:** produktové rozhodnutí; **mění přijatý kontrakt `R-3` / `DR-011`**
- **stav rozhodnutí:** NÁVRH — čeká na operátora
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

**Doporučení: D, s bezpečnostním stropem.** Otisk obsahu už v kódu je — approval
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

**Doporučení: 2.** Teď, když je z toho **nativní aplikace** a ne PWA, je tahle
možnost otevřená — v původním rozvažování `N-1` chyběla, protože se počítalo
s PWA, která trvalé spojení držet nemůže. Nic neopouští zařízení ani domácí síť,
což odpovídá tomu, čím produkt je. Navazuje to na rozhodnutí
[026](026-wireless-gateway-access.md): bez VPN funguje jen na kabelu.

Pokud se ukáže, že trvalé spojení příliš žere baterii, fallback je **4 (FCM)
s obsahem `S1`** — tedy „něco čeká", nikdy co. I tak jde o rozhodnutí poslat
informaci ven a patří do stejné diskuse.

## Co je potřeba udělat (když se přijme D + 2)

1. Sundat časový strop z `approval-authority` a nahradit ho vazbou na obsah;
   `awaitDecision()` přestane hlídat okno a začne hlídat platnost otisku.
2. Revokace a odhlášení ruší čekající approvaly.
3. Nativní služba, která drží spojení a zobrazí systémovou notifikaci
   (text `S1`, žádný obsah — jako dnes ve schránce).
4. Přepsat `DR-011` v `PLAN.md`, `DATA-MODEL.md` a `SCREENS.md`; obrazovka
   `MS-14` dnes ukazuje odpočet, který přestane existovat.
5. Testy: čekání přes restart gateway, propadnutí při změně obsahu, zrušení
   při revokaci, a že se z čekání nikdy nestane souhlas.

Body 1 a 4 jsou zásah do přijatého kontraktu — proto to je rozhodnutí, ne úkol.
