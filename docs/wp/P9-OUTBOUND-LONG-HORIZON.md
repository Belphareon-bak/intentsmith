# P9 — dlouhohorizontový outbound scan

**Typ:** read-only sonda · **Slot:** nesoutěží o zapisujícího vlastníka
**Vstupní revision:** `0a6bde54e1d2fdf7c284207e9555a0577ce6f6ff`
**Adresát:** operátor · vlastník `WP-M5-OBSERVE`
**Důvod:** L0-12 je `PARTIAL` mimo jiné proto, že dosavadní empirický scan má
**pravdivě přiznanou mezeru v horizontu**, ne v metodě.

---

## 1. Otázka, na kterou sonda odpovídá

Předchozí scan zjistil, že default konfigurace pod blokující instrumentací
neprovedla **žádné** spojení mimo loopback — ale okno **75 s** pokrylo jen
startup, idle, shutdown a 30s agent scheduler. **Nepokrylo 5min poll ani 24h
cyklus**; pro delší horizont je výsledek `NOT RUN`.

Otázka je tedy jediná: **provede default konfigurace odchozí spojení
v horizontu, který dosavadní měření nepokrylo?**

Sonda nezakládá novou inventuru call sites. Ta je hotová:
[`2026-08-07-OUTBOUND-CENSUS`](../review/2026-08-07-OUTBOUND-CENSUS.md) —
82 `fetch` call sites, z toho 46 skutečně odchozích.

## 2. Co je už změřeno — nepřeměřovat

| Fakt | Zdroj |
|---|---|
| 82 call sites, 46 odchozích | census §, tabulka call sites |
| jediný nepodmíněný background start je uvnitř gated větve | nález `OB-1` |
| update checker: 24 h, gated `C3_UPDATE_REPO`, cíl `api.github.com` | census |
| upgrade full cycle: 24 h ±90 min, gated `onlineDiscovery` | census |
| LLM-inicovaný egress nemá gate | census; vlastní [`WP-M5-OUTBOUND-GATE`](WP-M5-OUTBOUND-GATE.md) |

Sonda tedy měří **jen běh**, ne kód.

## 3. Postup

1. Izolovaný runtime root: prázdné `HOME`/`XDG`/`TMP`, vlastní DB, projekty
   a output adresář, unikátní port, bez zděděných tajemství, **default
   konfigurace** — tj. `onlineDiscovery` off, `C3_UPDATE_REPO` nenastavené,
   autonomy off, ComfyUI podle defaultu.
2. OS-level blokující instrumentace odchozí routy, stejná metoda jako
   u autoritativního scanu `offline-egress-serial-24457ba2`. Loopback zůstává
   průchozí.
3. Horizont **minimálně 26 hodin** v jednom nepřerušeném běhu — musí pokrýt
   5min poll i celý 24h cyklus včetně jeho ±90min rozptylu.
4. Zaznamenat každý pokus o spojení s časem, cílem, call site a stavem gate.
5. Druhý běh **s explicitně zapnutými** gated plochami
   (`C3_ENABLE_ONLINE_DISCOVERY=true`, `C3_UPDATE_REPO=…`) jako pozitivní
   kontrola: pokud ani ten nic nevyvolá, instrumentace neměří a první běh je
   bezcenný.

Bod 5 je podstata. Bez pozitivní kontroly by „nula spojení" mohlo znamenat
funkční gate i rozbité měřidlo a nešlo by je rozlišit.

## 4. Souběh

Sonda smí běžet vedle M1 i vedle obou L0-8 WP. Nesahá na `src/**`, nepotřebuje
GPU a **nesmí** spustit modelový běh — obsadí port a Ollamu nechá být, aby
nekolidovala se sériovým GPU slotem.

Běží ve vlastním checkoutu nebo izolovaném artifact rootu: vytváří DB a logy,
takže filesystem-read-only není.

## 5. Výstup

Jediný soubor: **`docs/review/<datum>-OUTBOUND-LONG-HORIZON.md`**

- tabulka: čas → cíl → call site → stav gate, nebo výslovné „žádné spojení";
- přesné okno běhu v hodinách a co konkrétně pokrylo;
- výsledek pozitivní kontroly;
- věta, kterou lze převzít do `SYSTEM-MAP.md` u L0-12 — **napsaná tak, aby
  nepředstírala víc, než bylo změřeno**.

## 6. Hranice

- žádný zápis mimo výstupní soubor;
- žádná změna `src/**`, `tests/**`, `ROADMAP.md`, `SYSTEM-MAP.md`;
- sonda **nerozhoduje** disposition gated ploch; retain/defer/retire pro
  upgrade automatiku 18b je otevřený řádek `ROADMAP.md §14` a patří operátorovi.

## 7. Stop condition

- **FINDING** — objeví se odchozí spojení, které census nezná. Zapiš
  `docs/findings/` s časem, cílem a reprodukcí. Neopravuj.
- **BLOCK** — instrumentaci nelze udržet po celý horizont. Vykaž pravdivě
  kratší okno a explicitní `NOT RUN` pro zbytek; **nedopočítávej**.
- **PARK** — 24h běh není proveditelný v dostupném čase. Vykaž pokrytý horizont
  přesně; částečný pravdivý výsledek je cennější než odhad.

## 8. Ověření, že sonda doběhla pravdivě

```bash
git status --short     # čistý strom mimo výstupní soubor
```

V dokumentu musí být:

- přesná délka okna v hodinách a minutách;
- výsledek pozitivní kontroly z §3 bodu 5;
- explicitní seznam toho, co okno **nepokrylo**.

Dokument bez těchto tří položek se nepřijímá jako evidence pro L0-12.
