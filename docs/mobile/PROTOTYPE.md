# Mobilní prototyp — legacy odkaz

Tento název zůstává kvůli existujícím odkazům a historickým handoffům.
Aktuální kanonický stav, cesta k APK, pravdivé limity obou prototypových větví
a prioritizovaný plán k production-ready jsou v
**[FINAL-PROTOTYPE.md](FINAL-PROTOTYPE.md)**.

Praktický postup spuštění je v [TRYING-IT.md](TRYING-IT.md), cesta do produkce
v [PROD-READY-HANDBOOK.md](PROD-READY-HANDBOOK.md). Obrazová evidence
z emulator journey zůstává v [`prototype-evidence/`](prototype-evidence/).

Původní dlouhý popis patřil implementačnímu snapshotu `485c3497` a je celý
zachovaný v [`archive/PROTOTYPE-485c3497.md`](archive/PROTOTYPE-485c3497.md) —
ne jen v Git historii, aby pravidlo „evidence se nemaže" platilo i na disku.
Nesmí se ale používat jako druhý aktuální stavový dokument: nerozlišoval
dostatečně demo-only producenta od produkčního a popisoval shell před
lifecycle hardeningem.
