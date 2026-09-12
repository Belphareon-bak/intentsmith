# WP-SAZENI-WATCH-20260912

Autorita: explicitní požadavek operátora na pohodlné CLI/aliasy, výzkum
atraktivních a nově vypsaných kurzů a automatická upozornění, nejprve e-mailem.
Vstup: čistý `a054b7534d2735ba15df1c9ec8a1d2ad28512d7b`, stávající vlastní
worktree `is-specialists-engines-20260911`; žádný další checkout.

- Výsledek: příkaz `sazkar`, předvolby, historie a menu; průběžný veřejný sběr
  Fortuny s doloženými důvody signálů; ovladatelný background timer a omezená
  e-mailová doručovací cesta bez duplicit a falešných claimů o výhodnosti.
- Rozsah: `bin/sazkar.js`, související instalační script, `src/betting/**`,
  čistý specialistický analytický modul, navazující testy, kontrakt a výzkum.
  Lokálně vlastní příkazy v `~/.local/bin`, aliasy v `~/.bash_aliases`, vlastní
  konfigurace/stav `~/.config/sazkar`, `~/.local/state/sazkar` a vlastní user
  systemd služba/timer. Zachovat veškeré cizí soubory a procesy; bez GPU.
- Pozorování: veřejná Fortuna již skutečně funguje; dosavadní matematický
  model nezískal důkaz predikční výhody. Nově viděný kurz není automaticky
  skutečný opening; vyšší cena není automaticky kladné EV.
- Doručování: pouze operátorem určený příjemce a lokálně nastavený SMTP účet.
  Adresa a poskytovatel jsou vyžádané; tajemství nepatří do repozitáře/chatu.
  Sběr a lokální historie se mohou připravit a spustit samostatně.
- Ověření: reálný CLI scénář, spuštění/zastavení vlastního timeru, kontrola
  zachycených cen; pozitivní/negativní test signálů, freshness, deduplikace,
  restartu a hranice mailu. `node tests/sazeni-engine.test.js`,
  `node tests/sazeni-integration.test.js`, relevantní deterministický profil.
- Hranice výsledku: nevymýšlet zdrojové datum vypsání, +EV ani úspěšné
  doručení. Chybějící SMTP konfiguraci ponechat viditelnou; registry/review
  baseline nebo datové nedostatky nepřeklasifikovat na PASS.
