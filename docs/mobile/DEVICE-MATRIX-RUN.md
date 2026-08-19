# Matice fyzického telefonu — protokol a záznamový list

**Stav: `NOT RUN`.** Tenhle dokument je **připravený běh**, ne důkaz. Vyplněná
matice vzniká až tím, že ji někdo odklikne na skutečném telefonu — emulátor
biometrii, Doze, výrobcem zabité procesy ani odpojení kabelu za běhu
nereprodukuje, a to je přesně důvod, proč `P0-3` existuje.

Kritérium a vlastník jsou v [PROD-READY-HANDBOOK.md](PROD-READY-HANDBOOK.md)
§P0-3. Tady je to, co k němu chybělo: **jak to udělat, aby výsledek byl
pozorování a ne dojem.**

---

## Než začneš

| | |
|---|---|
| Telefon | fyzický, Android 10+, s nastaveným zámkem obrazovky a zapsanou biometrií |
| Kabel | USB, `adb devices` vidí zařízení jako `device` (ne `unauthorized`) |
| Backend | `npm start` běží (`127.0.0.1:3335`) — **nově je potřeba**, viz níž |
| Gateway | `npm run mobile:gateway` (`127.0.0.1:3336`) |
| Můstek | `npm run mobile:android:reverse` |
| APK | `npm run mobile:android:build && npm run mobile:android:run` |

**Změna proti dřívějšku:** approvaly se už nevyrábějí demem. Vyrábí je skutečný
zápis, takže backend musí běžet — gateway sama frontu jen čte. Řádky 3–5 a 10 se
proto řídí skutečným během, ne `npm run mobile:demo`.

Jak vyrobit otázku: v `/chat-ui` napiš „ulož to do poznamka.md" (nebo cokoli, co
skončí zápisem souboru). Běh se zastaví a čeká.

---

## Záznamový list

Vyplň **všechny** sloupce. Prázdné pole není „prošlo", je to „neproběhlo".

```
Datum:        ____________________
Model:        ____________________
Android:      ____________________
Verze APK:    ____________________  (commit: ____________)
Kdo klikal:   ____________________
```

| # | Scénář | Co musí platit | Výsledek | Poznámka |
|---|---|---|---|---|
| 1 | instalace a první spuštění | žádný prompt před spárováním | ☐ PASS ☐ FAIL | |
| 2 | párování QR i vložením kódu | kód je jednorázový; druhé použití 409 | ☐ PASS ☐ FAIL | |
| 3 | approve | efekt nastane **až po** ťuknutí — soubor před ním na disku není | ☐ PASS ☐ FAIL | |
| 4 | reject | efekt nenastane a běh to řekne | ☐ PASS ☐ FAIL | |
| 5 | nechat propadnout (změnit cíl během čekání) | běh skončí bez efektu; telefon ukáže **„Rozhodnutí už neplatí / Cíl se změnil."** | ☐ PASS ☐ FAIL | |
| 6 | Home → návrat | zámek, `BiometricPrompt`, po odemčení funkční relace | ☐ PASS ☐ FAIL | |
| 7 | recents náhled | prázdný / zakrytý (`FLAG_SECURE`) | ☐ PASS ☐ FAIL | |
| 8 | zabití procesu z recents | po startu zámek, credential přežil v Keystore | ☐ PASS ☐ FAIL | |
| 9 | odpojení USB za běhu | „gateway nedostupná" — nemlčí a neukazuje starý obsah jako živý | ☐ PASS ☐ FAIL | |
| 10 | vypnutí gateway během čekání na approval | totéž, plus běh na desktopu se dozví konec | ☐ PASS ☐ FAIL | |
| 11 | letadlový režim | `SS-03` offline, ne `SS-08` | ☐ PASS ☐ FAIL | |
| 12 | reboot telefonu | po startu zámek, pak funkční relace | ☐ PASS ☐ FAIL | |
| 13 | změna zámku obrazovky (přidání/odebrání) | `lockKind` se přepne a nastavení to říká | ☐ PASS ☐ FAIL | |
| 14 | odhlášení | credential zmizí z Keystore, návrat na párování | ☐ PASS ☐ FAIL | |

---

## Jak jednotlivé řádky provést

Číslované kroky jsou schválně doslovné. „Zkusil jsem to a šlo to" není
pozorování; pozorování je „udělal jsem X a viděl jsem Y".

**3 — approve.** Vyrob otázku (viz výše). **Než ťukneš**, ověř na desktopu, že
cíl na disku neexistuje (`ls`). Teprve pak ťukni Schválit. Znovu `ls`.
*Pozorování:* před ťuknutím soubor není, po ťuknutí je.

**4 — reject.** Totéž, ale Zamítnout. *Pozorování:* soubor není ani potom a chat
řekne, že zápis byl zamítnut.

**5 — propadnutí.** Vyrob otázku a **než odpovíš**, změň cíl z desktopu
(`echo x >> cil`). Pak ťukni Schválit. *Pozorování:* nic se nezapsalo a text na
telefonu odpovídá novému slovníku. Starý text („Okno vypršelo, běh pokračoval
bez svolení") by byl nález — přestal platit rozhodnutím `025`.

**9 — odpojení kabelu.** Vytáhni USB za běhu aplikace, ne před spuštěním.
*Pozorování:* obrazovka řekne, že gateway není dostupná. Pokud dál ukazuje
seznam jako živý, je to nález.

**10 — gateway během čekání.** Nech běh čekat na approval a zabij gateway
(`Ctrl-C`). *Pozorování:* telefon oznámí nedostupnost; běh na desktopu skončí
bez efektu a **řekne proč**. Po restartu backendu nesmí ta otázka viset ve
frontě jako čekající — na to už nikdo nečeká.

**12 — reboot.** Po rebootu zkontroluj i frontu: approvaly, na které čekal
proces zabitý restartem, mají být uzavřené (`cancelled` / `waiter_gone`), ne
`pending`. Rozhodnutí, po kterém by se nic nestalo, je horší než žádné.

---

## Co s nálezem

Zapiš ho jako řádek s `FAIL` a **konkrétním pozorováním**, ne jako dojem.
„Chová se divně" se nedá opravit ani reprodukovat. „Po odpojení USB zůstal
seznam konverzací a trust bar zelený po dobu ~40 s" ano.

Matice s jediným `FAIL` je pořád platný důkaz — jen říká něco jiného. Matice
s prázdnými poli není důkaz vůbec.
