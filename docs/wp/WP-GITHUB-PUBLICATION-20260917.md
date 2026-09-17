# Synchronizace dokumentace a GitHubu

Explicitní zadání operátora 2026-09-17: dokončit aktualizaci dokumentace
a GitHub repozitáře. Vstup `9c02dec3`; existující owned checkout a větev
`work/hunt-review-followup-20260912` se znovu používají.

Výstup: aktuální README, ROADMAP a SYSTEM-MAP, přenositelný souhrn ověření,
publikovaná integrační větev a draft PR proti `work/mobile-completion-20260908`.
GitHub `main` má odlišnou vývojovou linii (66 vlastních commitů proti 1 558
v integrační větvi), proto tento WP neprovádí její neověřené sloučení.

Vlastněné cesty: uvedené současné dokumenty a nový publikační run record.
Kontrolní běh na `fd216540` odhalil kalendářní závislost v existujícím
`tests/accountant-tools.test.js`: datum ověření 2025-09-15 už překročilo 365 dní.
V rámci `CONTRACT.md §11` se doplňuje řízený čas a pozitivní i negativní
hrana tolerance v témže testu. Registrace, očekávané chování, sazby, datum
ověření a produktová kontrola stáří se nemění; původní FAIL se zachová.
Historické packety zůstávají zachované. Žádná změna produktu, bindingů,
služeb, cizích checkoutů ani review/acceptance verdiktů.

Ověření: dokumentové odkazy, `git diff --check`, registry, celý deterministický
profil a shoda vzdáleného SHA po push. Stop podmínka: nečekaný vzdálený drift,
potřeba force-push nebo neveřejný provozní materiál ve zveřejňovaném diffu.
