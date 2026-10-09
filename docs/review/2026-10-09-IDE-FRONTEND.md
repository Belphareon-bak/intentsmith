# IDE — frontend podle schváleného Claude návrhu

Frontend je implementovaný a nezávisle přezkoumaný. Větev `work/ide-frontend-20261009`, produktový frontend `119d258cdf89788435e706a875256cbb811ab074`; další commit mění pouze tuto dokumentaci. Backend coworkera `0766a0ba73b4f25be3d6ccc507d26ba5e26ba2c6` byl použit ve skutečném izolovaném HTTP ověření, do frontendové větve není mergovaný a produkční instalace se tím nemění.

## Výsledek

Původní rám, písma a 11 palet jsou zachované. Levá navigace má plnošířkový aktivní řádek, barevné obrysové ikony bez podkladu a nemá duplicitní počty. Nastavení používají jednoduché kategorie a sekce; seznam i dlaždice mají funkční ovládání velikosti. Dlaždice Nastavení obsahují jen název a popis.

Modely, evaluace, telemetrie a Hunt používají hlavní plochu; pravý panel má stručné role. Evaluace je plochá matice s pěti barevnými pásy a tříděním podle role. Katalog spojuje rodiny, skutečné kvantizace, role, dostupné srovnatelné veřejné podklady a explicitně chybějící data; výchozí filtr VRAM/ke stažení. Hunt má čtyři části. Připravení testů modelu samo nespouští efekt; plány a role používají serverové revize a následné čtení.

Účet, kanály, cesty/DB, retence, backup metadata a SSH profily jsou napojené na API, s inline formuláři. Git má uživatelský název větve, nativní výběr složky, čitelné webové remote a commit/compare/files/diff ve střední ploše. Původní schvalování efektů zůstává.

## Ověření a přesné hranice

| Důkaz | Výsledek a rozsah |
| --- | --- |
| Cílené regresní testy | 141 PASS; původní LiveModel + nové UI/SCM/model/management kontroly |
| Celý offline/database profil | 414/414 PASS na `817c2898`; všechny logy, registry/options a clean-tree/cleanup ověřené nezávisle |
| Finální CSS delta | Pouze čtyři settings-only pravidla a dokumentační fingerprint nad817; 3/3 relevantní programy na119, aktuální browser více palet/šířek |
| Nezávislá opravná delta | 7/7 browser + 12 modelových testů, 8 skutečných HTTP kontrol; následně zvlášť M2-order review |
| Autorské HTTP | 12 modelových kontrol, 10 management checkpointů /91 požadavků /restart, readback a zavřené DB kopie; nezávisle auditováno |
| Actual React + HTTP V5 | Čtyři formuláře/readback přijaty. Celý harness zůstává FAIL při očekávání ready u chybějící desktopové služby Huntu. Chybí uložený per-click geometry ledger; skutečné hit-test guards a počet30 zachovány |
| Finální AppImage | 195157758 B, SHA-256 `6bfe56c16bf8178b09b44a9e5e3fab1e4ae0686a22dae21331be3699b85fe12b`; packaged parity, skutečný cold boot, nastavení,13tile rules, exit0/cleanup |
| Nativní API/GPU | Backend v cold bootu nepřipojen. Skutečný picker dialog, nový connected-native celý průchod, inference, doručování a release se tím nepřijímají |

Závěrečné nezávislé review: `0617093270dd4cb82e2d950995ecb28969a5d1c6e98784da7e1f04f6472a4414` (`full817-style119/REVIEW.json`), bez dalších nálezů. Původní neúspěšné běhy a scaffold chyby zůstávají zachované, žádný FAIL se nepřeznačuje. Sériový profil opravil execution prerequisites a kolizi source observeru; žádný guard ani původní M2 oracle se neoslabil.

## Lokální předání

Balík stanice:
`/home/belphareon/Projects/intentsmith-ide-frontend-20261009/.intentsmith-artifacts/ide-redesign-candidate-119d258c-20261009/`

- `README.md`: konkrétní použití, hranice a vysvětlení testů.
- `spustit-IDE.sh`: samostatný nový profil, default výslovně bez backendu; s jedním argumentem jen uživatelem vybraný soubor portu. Skript je kontrolovaný syntakticky; nový connected-native běh se netvrdí.
- `IntentSmith-IDE-119d258c.AppImage`, `SOURCE.json`, `SHA256SUMS`.
- `evidence/native-settings.png`: skutečné finální nativní IDE. Snímky `illustrative` jsou skutečný React nad výslovnými fixturami, nejsou měření kvality modelů.
- `evidence/independent-review.json`, `build-manifest.json`, `root-verification.json`, `native-coldboot.json`, `react-http-partial.json`: kopie auditovaných souhrnů. Soukromé backendové logy, capabilities a DB se nebalí.

Autoritativní místní plné reporty:
`.intentsmith-artifacts/test-runs/ide-frontend-817c2898-serial-20261009/report.json` SHA-256 `27dbb186c16587db2d4758453c2ac78a08dcc3c2ac92297269b90f8236e198a1`;
`.intentsmith-artifacts/test-runs/ide-frontend-settings-tiles-qualified-20261009/report.json` SHA-256 `8e731b52ccaf45844f421163f86253e28272e8dd195b6858f61a2f153548ab77`.

## Další společná integrace

Spojit tento frontend s coworkerovým BE a ověřit skutečný instalovaný runtime, nikoli pouze dočasný API server. Úplný archiv Huntu, přesun modelového úložiště, HTTPS tokenový editor a časový plán záloh zatím nemají potřebný BE kontrakt. `/api/settings` je legacy full-document bez serverového CAS; frontend používá preflight a readback. Náhled ani data neoznačují nakonfigurovaný kanál za přihlášený/ověřený.

Publikace této větve dovoluje sestavení a review; není merge, deploy ani přijetí společného releasu. Workflow CI tuto novou větev v push filtru nemá; nový CI běh se zde netvrdí. Produktový backend, původní IDE, chráněný24h běh a cizí checkouty nebyly touto dávkou upravené.
