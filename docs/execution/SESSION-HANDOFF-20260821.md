# Handoff 2026-08-21

**Větev:** `claude/gate1-mobile-app-progress-5sywlt`, base `43687e6b`
**Nepushnuto.** Strom čistý.

## Co se změnilo v autoritě — přečti dřív než cokoli uděláš

1. **`docs/development/agent-protocol.md`** je nový, přijatý `CONTRACT.md §10`.
   Jádro: co vznikne během běhu, není autorita; jakmile je soubor vytvořený
   v tomto běhu citován jako zdroj požadavku, práce se zastaví.
2. **`CONTRACT.md §11` — autonomní režim.** Operátor kontroluje výsledek
   milníku, ne kroky. Šest důvodů zastavit i uprostřed milníku, včetně
   „prostředí práci nedovolí".
3. **`PRODUCT.md` a `ROADMAP.md` jsou od 2026-08-21 přijaté.** Verze 3 / 4.
   Milníkový DAG a exit kritéria od té chvíle řídí práci.

## Operátorská rozhodnutí zapsaná dnes

| Věc | Stav |
|---|---|
| L0-8 | Varianta A, strict injection (019). Přijato 9. 8., zapsáno 21. 8. |
| Online discovery | **default on** — `IN / GOVERNED`, ne `CONDITIONAL`. `WP-M5-OUTBOUND-GATE` je tím **podmínka vydání** |
| Směr sítě | Ven pro informace a open source; dovnitř vůbec. Žádná data dosažitelná z internetu, listener jen loopback |
| `/architect` | Disposition **legacy** |
| Notifikace | in-app **IN**; externí kanály po releasu |
| Marketplace, Media | **OUT pro 1.0 / TBD** |
| Mobil | Vedlejší produkt; jeho `m2` commity jsou **prerekvizity M2**, ne exekuce milníku |

## Stav M0 — zbývá jediná věc

Šest ze sedmi exit kritérií splněno. Poslední je Studio část baseline a
**nedrží ji konfigurace, ale produkční Theia/Electron build** — `yarn install`
+ `yarn build`, hodiny a gigabajty. Toolchain na téhle stanici splněný je
(`DISPLAY=:0`, XAUTHORITY 0600, `unshare`, `ip`); chybí pět ze šesti artefaktů,
které `assertBuildPresent()` vyžaduje.

**Nezkoušej odblokovat `studio-electron-boundary` v registru** — už se to
stalo (`ce0f7570`) a bylo to vráceno (`9d394e2a`). Důvod je v
`docs/execution/BLOCKED-TRIAGE-20260820.md`.

## Co se změřilo, ne odhadlo

- **Runtime baseline z čerstvého klonu**: `npm ci --offline` (206 balíčků),
  server, deterministika 49 ms, model 53,7 s, persistence a restart. Prošlo.
- **`BLOCKED` neznamená rozbité.** 26 `server`-profilových sad puštěno přímo
  proti živému serveru: **21 PASS / 5 FAIL**. `server` je v `nightly-audit`
  hard blocker, který `--no-block` ani `--allow-blocker` neobejdou, proto tam
  ty sady nikdy neběžely.
- Jediné diagnostikované selhání (`03-conversations`) nebylo vadou produktu —
  test nesl předrozhodovací C3 očekávání proti rozhodnutí 012/B. Srovnán.
- **Nediagnostikováno:** `19-rate-limit`, `22-autonomy`, `56-chat-with-project`,
  `60-ws-chat`, `80-ws-semantic-events`. Nevydávej je za vady ani za zastaralá
  očekávání, dokud je nezměříš.

## Otevřené release-blocking vady

Žádné. Sekce v `SYSTEM-MAP.md` je prázdná — dnes se zavřely čtyři.

## Plán operátora, v tomhle pořadí

1. ~~Backend/runtime baseline~~ — hotovo, zbývá Studio build
2. **Dopustit 52 sad s Ollamou/GPU.** Součet odhadů 38 h, ale odhady jsou
   ~3× nadsazené. Vlna 1 (24 sad ≤10 min) běží. Vlna 2 je 25 sad;
   `220-e2e-suite-runner` má pinnutých 12 h a 3 sady chtějí externí síť.
3. Gate 1 fronta z `ROADMAP.md §13` — 7 položek, sedmá jen na akci operátora
4. M2

## Pasti, na které jsem dnes narazil

- `npm run test:deterministic | tail` vrátí exit kód `tail`u. Čti `verdict:`.
- Před gatem smaž `.intentsmith-artifacts/direct-tests/`.
- E2E sady chtějí `C3_URL`; port a capability jsou v `~/.c3/port` (JSON,
  `require()` na něj nefunguje — nemá příponu).
