# Install IntentSmith Studio and expose governed GPU hunt controls

Cíl PR: `work/hunt-review-followup-20260912`; head:
`work/desktop-hunt-20260917`. Výchozí main zůstává samostatná historická linie.

## Popis pro PR

Aplikace a noční hunt nyní používají stejnou připnutou instalaci a původní DB.
Desktopová ikona spustí nebo připojí Studio k produkční backendové službě;
zavření okna ji nevypíná. Studio zobrazuje provoz, poslední známou frontu,
výsledky huntu a potvrzované lokální start/stop/pause/resume. Timer dohání
zmeškaný termín, přitom zachovává kontrolu obsazené GPU a autoritu retence.

Instalátor ověří systemd konfiguraci, zálohuje DB a prověří migraci kopie.
Readiness ověřuje přístup s capability i odmítnutí bez ní. Efekty jsou pevné
systemctl argv a vyžadují brandovaný lokální transport. Přibyla ikona a
lokální branding z operátorova návrhu. Diagnostika panelu odděluje variabilitu
od malých pozorovaných rozdílů; kontrakty skóre ani bindingy nemění.

Ověření: desktop focused 8/8, process supervision 13/13, registry 517,
module boundary 1332 hran. Produkční build a spojený fyzický GTK → Studio →
HTTP → systemd journey na `9d13bb53`: autentizace 401/200, opakované spuštění,
shutdown ownership, skutečný restart, idempotentní instalace, GUI ovládání
a cancel během native checksum verifikace. Finální celý profil na `2587ae56`
má **353 PASS / 1 FAIL**, výhradně nezměněnou release pečeť podle CONTRACT §8.
Původní selhání a přerušený běh zůstávají v důkazech; 1542 auditních logů má
ověřené hashe. Doc/artifact kontrola po aktualizaci má 158/158.

Nová delta je REVIEW_PENDING, nikoli release acceptance. Nová fyzická
kalibrace je blokovaná NVIDIA/NVML mismatch; diagnostika historického panelu
není nové měření. Všech 503 evaluací, 21 hunt attempts a 7 desired bindings
zůstalo obsahově shodných. Provozní DB, credential ani soukromé raw důkazy
se nepublikují.

Podklady: [review packet](2026-09-17-DESKTOP-HUNT-REVIEW.md),
[přenositelný souhrn](../execution/runs/desktop-hunt-20260917.json),
[návod](../DESKTOP.md).
