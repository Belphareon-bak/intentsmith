# WP-SAZENI-PUBLIC-20260912

Autorita: operátor chce nejdříve vyzkoušet autonomního sázkaře pouze nad
veřejnými zdroji, zejména Tipsport/Fortuna; výběr ponechal implementátorovi.

- Výsledek: preference → veřejná česká nabídka → vypočtené tikety → report
  se skutečným původem a časem dat, bez placeného klíče a ručních p.
- Vstup: čistý `271fce958ede85c539c3835fbf8bc4f74df73aff`, stávající vlastní
  worktree `is-specialists-engines-20260911`. Žádný nový checkout.
- Rozsah: sonda zdrojů; podle skutečně získané nabídky provider a omezený
  core datový host/outbound scope, sazkařův kontrakt, CLI/chat, související
  existující testy a povinná dokumentace. Cizí checkouty, účty, živá hlavní DB,
  GPU a podávání sázek jsou mimo rozsah.
- Kontrakt: získaná veřejná cena není potvrzení přijetí sázky. Čas stažení
  není zfalšovaný čas aktualizace kurzu. Prázdná stránka, blokovaný přístup,
  změna schématu nebo prošlá data nevytvoří úspěšný tiket.
- Demo: jeden příkaz se jménem dostupné kanceláře, oknem 24/72 h a limity;
  porovnání zápasů/kurzů s původním snímkem. Původní referenční režim musí
  zůstat jednoznačně označený, nikoli vydávaný za českou nabídku.
- Ověření: `node tests/sazeni-engine.test.js`,
  `node tests/sazeni-integration.test.js`; relevantní outbound/boundary
  kontroly a deterministický profil při změně integračního kódu.
- Hranice: automatizaci bez dostupných dat nelze prohlásit za funkční.
  Pokud oba zdroje znemožní veřejný sběr, doložit konkrétní odpovědi a
  ponechat již funkční veřejný referenční režim; žádné obcházení přístupových
  kontrol, registrace nebo objednávka služby.

Výsledek 2026-09-12: veřejná Fortuna je výchozí, runtime ověřen pro 24 i 72 h,
bez klíče nebo prohlížeče v produktu. Tipsport veřejnou sondu odmítl 403.
Implementace `cd3e01bd`, přesná importní evidence `4cd363d0`; cílené sady
30/30 PASS, celý profil 343 PASS / 3 FAIL / 8 BLOCKED (exit 1), bez nové změny
stavů. **IMPLEMENTED_SLICE / REVIEW_PENDING**, nikoli provozní přijetí.
[Důkazy, návody a přesné non-PASS](../review/2026-09-12-SAZENI-PUBLIC.md).
