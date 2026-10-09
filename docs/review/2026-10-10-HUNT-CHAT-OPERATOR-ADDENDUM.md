# Doplnění operátora: CHAT a sestava rolí

10. 10. 2026. Příloha k
[kontraktu k revizi](2026-10-09-HUNT-ROLES-AND-CHAT-PROMPT-CONTRACT.md).
Autorita: přímá doplňující zpráva operátora při integraci IDE/backendu.

## Rozhodnuté pořadí

Nejprve dokončit testy integračního kandidátu, aktualizovat dokumentaci,
commitnout a pushnout. Pak **počkat na nezávislý verdikt Opuse pro finální
úpravy**. Předání starších BE/FE větví není přejímkou integračních oprav.

Pro CHAT připravit výchozí styl a další možnosti v nastavení: stručně,
vyváženě a podrobně. Přidat možnost vysokoúrovňového uživatelského promptu.
Při skládání odpovědi mají výslovné aktuální pokyny uživatele a jeho vlastní
preference přednost; systémový výchozí styl doplňuje to, co uživatel neurčil.
Tím se nemění autorita k provedení akcí ani pravidlo dokládat stav testů a
nasazení. **Implementace a přejímací testování této personalizace patří po
releasu**, jak operátor výslovně určil. V tomto integračním kandidátu není
nový styl ani vlastní CHAT prompt vydáván za hotovou funkci.

Přejímka následné etapy musí doložit:

1. Nastavení stylu a vlastního promptu: uložení, readback, restart, použití při
   další zprávě, vyprázdnění vlastní hodnoty a návrat k výchozímu stylu.
2. Výslovný požadavek v aktuální zprávě mění délku/hloubku i při jiném defaultu;
   preferovaný styl neomezuje interní JSON rozpočty.
3. Srovnání aktuálního promptu, historické varianty Huntu a nových variant podle
   W2, s přesným otiskem promptu a modelu; dva slepí nezávislí hodnotitelé.
4. W1 brána pro nedoložené výsledky/provedení v češtině i angličtině, včetně
   skutečných doložených výsledků a označených ilustrativních příkladů.
5. Doporučený default až podle měření; nevydávat default z tohoto doplnění za
   kvalitativně přijatou volbu.

## Nerozhodnuté parametry

- Sdílené dvojice CHAT–CODE, D1–D2 a R1–VISION a jejich ústupky zůstávají
  předmětem revize. Formulace operátora „kdyžtak se upraví“ není důkazem jejich
  provozní aktivace.
- Pro Gemmu v CHAT porovnat **64k, 96k a 128k**. 96k je nově navržený bod;
  tento integrační WP jej neměřil. Potřebná je paměť z `nvidia-smi`, rezerva pro
  desktop, latence přepnutí sdílených rolí, stabilita a kvalita na daném promptu.
- Výsledky historického Huntu s jiným systémovým promptem nelze označit jako
  výsledky aktuálního běžného CHAT. Aktuální prompt je baseline, starý pouze
  srovnávací varianta.

Tato příloha nepřepíná bindingy, neuvolňuje automation hold a neaktivuje modely.
Tyto kroky vyžadují přejímku konkrétní sestavy s identitou podle digestu.
