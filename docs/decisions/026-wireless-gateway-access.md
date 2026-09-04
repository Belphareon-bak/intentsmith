# 026 — Přístup k gateway bez kabelu

- **typ:** bezpečnostní a provozní rozhodnutí; **posouvá `G0-R032`**
- **stav rozhodnutí:** **PŘIJATO operátorem 2026-08-19** — varianta **B**,
  včetně obou podmínek (vazba na jednu adresu tunelu, adresa gateway jako vstup
  buildu s runtime variantou v P1) a včetně TLS odpovědi níže
- **vyvolal:** operátor 2026-08-18: *„jsem pro wireless strategii, nevím proč
  bych měl být závislý na kabelu, do toho je vpn tunel"*
- **souvisí:** `G0-R032` (vzdálený listener až za M6), `PLAN.md` §8.1

## O co jde

Gateway se dnes **odmítne** pustit jinam než na loopback (`127.0.0.1`), dokud
někdo výslovně nenastaví `C3_MOBILE_ALLOW_REMOTE`. Není to nedodělek — je to
pojistka, protože hranice „vzdálený listener" nemá otestované negativní cesty
a je vedená až za M6.

Telefon se proto dnes k gateway dostane jen přes USB (`adb reverse`), což
znamená, že telefon a počítač jsou fyzicky spojené a **žádná síť neexistuje**.
Odtud plyne, proč je dnešní HTTP bez TLS obhajitelné.

Operátor chce bezdrátově přes VPN. To je legitimní a nemusí se čekat na M6 —
ale mění se tím model útočníka, takže to potřebuje rozhodnutí a tři konkrétní
věci navíc.

## Varianty

| | Co to je | Kdo se může připojit | Práce |
|---|---|---|---|
| **A. Jen kabel (dnes)** | `adb reverse` | nikdo — síť neexistuje | žádná |
| **B. VPN, vazba na rozhraní tunelu** ⭐ | Tailscale/WireGuard; gateway poslouchá **jen** na adrese tunelu | jen zařízení ve tvé VPN | dny |
| **C. Vlastní vzdálený listener** | Gateway na internetu, TLS, autentizované párování | kdokoli, kdo projde autentizací | týdny; je to M6/M7 |

**Rozhodnuto: B.** VPN řeší dvě věci, které by jinak musel řešit produkt:
**šifrování** a **identitu protistrany**. Tailscale i WireGuard dávají obojí a
jsou ověřitelné mimo náš kód. Varianta C je pořád na svém místě v roadmapě.

## Co k tomu musí vzniknout (a proč to nejde hned)

1. **Vazba na konkrétní adresu, ne „kamkoli".** Dnešní přepínač je binární:
   buď loopback, nebo cokoli. Pro VPN chceme povolit **jednu adresu tunelu** a
   dál odmítat `0.0.0.0` a veřejná rozhraní. Plus negativní test, že to opravdu
   odmítne — jinak je pojistka jen komentář.
2. ~~**Aplikace se musí dozvědět, kde gateway je.**~~ **ČÁSTEČNĚ HOTOVO
   2026-08-18.** Adresa už není natvrdo v kódu — je to **vstup buildu**
   (`C3_MOBILE_APP_URL`), který se zapíše do konfigurace Capacitoru i do síťové
   politiky Androidu naráz, aby se nemohly rozejít. Build navíc **odmítne**
   nešifrovanou adresu mimo loopback bez výslovného souhlasu.

   Co zbývá: **přepínání za běhu** (adresa z párovacího QR do trezoru). Naráží
   na to, že Capacitor injektuje most do stránky jen pro origin ze své
   konfigurace — na jiné adrese by aplikace přišla o trezor i zámek. Vyžaduje
   to vlastní `JavascriptInterface` s kontrolou originu. Pro interní APK, které
   si každý staví sám, vstup buildu stačí; pro pilot ne.
3. **Rozhodnout TLS.** Uvnitř VPN je provoz šifrovaný tunelem, takže HTTP je
   obhajitelné — ale je to obhajoba typu „spoléháme na vrstvu pod námi".
   Varianty: (a) nechat HTTP a spolehnout se na VPN, (b) self-signed certifikát
   s pinningem v aplikaci.

   **Rozhodnuto operátorem 2026-08-19: (a) pro pilot, (b) před čímkoli, co
   opustí VPN.** Praktický důsledek: jakmile se objeví požadavek „a co když
   nejsem na VPN", není to konfigurační úprava — je to bod (b) i s pinningem,
   a patří do samostatné práce.

## Co se tím **ne**rozhodne

- Nic o veřejném vystavení. Gateway pořád nebude na internetu.
- Nic o `RemoteCorePort` a M7 — to je varianta C a zůstává, kde je.
- Nic o legacy `/api/*` a `/c3/ws`. Ty přes vzdálenou cestu dostupné být nesmí a
  chce to negativní test, ne tvrzení.

## Nejmenší poctivý krok

Když chcete výsledek rychle a bez velké přestavby: nechat gateway na loopbacku
a postavit VPN tak, aby **telefon mluvil na loopback protistrany** (Tailscale
Serve / SSH port forward). Vypadá to jako kompromis, ale je to totéž co kabel —
jen bez kabelu — a nevyžaduje nic z bodů 1 a 3. Bod 2 (adresa v párovacím kódu)
je potřeba tak jako tak.
