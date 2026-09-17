# Opravy re-review: logování, pracovní paměť a boční panely

Autorita: operátor předal nezávislé `CHANGES_REQUIRED` R1–R3 dne 17. 9. 2026;
navazuje na zadání opravit, publikovat a nasadit produkt. Vstup `ba7c72d6`,
vlastněná větev `work/privacy-panels-rereview-20260917`.

Rozsah: odstranění obsahu zprávy z logu před privacy preflight; uplatnění
`memory.saveContext` na automatické obnovení a zápis pracovní paměti projektu
včetně uložené a již otevřené relace; převzetí panelové opravy `4fca7e67`.
Historie konverzace je samostatné nastavení. Vypnutí kontextu nemaže dříve
uložené projektové položky. Nový výslovný cíl v otevřené relaci může sloužit
jejímu řízení, ale při vypnutém kontextu se neukládá do pracovní paměti.

Ověření: negativní důkaz původních vad, skutečné HTTP při info logování,
projektový handler nad izolovanou SQLite, teplá/studená relace a opětovné
zapnutí, regresní test panelů, Studio build a geometrie skutečného Electronu,
registry/boundary a celý deterministický profil na připnutém commitu.
Poté společná čistá instalace, kontrola zachování dat, GitHub a review packet.
Release pečeť podle CONTRACT §8 ani nezávislé přijetí se tím nenahrazují.

## Navazující nález — informační API relací

Operátorovo nezávislé review na `3bbf8bc1` potvrdilo odmítnuté HTTP vstupy
a restart/persistence, ale našlo obejití policy v `getSessionInfo()` před
dalším tahem chatu. Aktivní follow-up: vynutit policy při serializaci
pracovní paměti do informačního API i storage, bez `getState()`, vytváření
relací nebo posunutí lifecycle časů. Regrese pokryje oba GET endpointy hned
po přepnutí, přímou serializaci, neexistující relaci, re-enable a zachování DB.
Práce probíhá ve vlastní větvi `work/production-closeout-20260917` nad
integračním `d1fa2991`, který zachovává instalované změny `d4dea0bb` i M5
inventář. Běžící soak a cizí checkouty zůstávají nedotčené.

Výsledek follow-up: instalovaný `365a4f1d`, společná serializace opravená,
obě HTTP čtecí plochy ověřené před dalším tahem. Úplný profil 358 PASS /
1 FAIL (release pečeť), sledované DB tabulky zachované. Nezávislé přijetí
zůstává otevřené. [Packet a přesné review piny](../review/2026-09-17-SESSION-INFO-PRIVACY.md).
