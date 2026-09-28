# Mobile completion — nezávislé review řezu a stav milníků

Product candidate: `88d1d45ba90f287a1a5ed166e2be0de1b75dc29c`.
Base: `de0e81275afa381dd6a73afbb699bde47971b658`.
Tree: `34b02110ffade4b0a80728449384cd5edf4127b1`.
Podrobná [execution evidence](../execution/runs/mobile/mobile-completion-20260908.md).

## Verdikt přesného implementačního řezu

Nezávislý read-only reviewer `/root/completion_independent_review` prošel diff,
autoritu WP, skutečný consumer call graph a emitovanou release evidenci.
Testy nespouštěl souběžně s root runnerem; reprodukované výsledky jsou oddělené
od jeho source review.

| Předmět | Verdikt |
|---|---|
| MOBILE_ACCESSIBILITY_SOURCE | REVIEW_PASSED |
| MOBILE_RELEASE_SOURCE_PROVENANCE | REVIEW_PASSED |
| MOBILE_COMPLETION_HANDOFF na source88d1 | CHANGES_REQUIRED — jeden dokumentační P2 |
| MOBILE_COMPLETION_HANDOFF po opravě na evidence56665cd4 | REVIEW_PASSED |
| Celá mobilní aplikace / M7 release | NOT_READY |

P2: TRYING-IT přepnul shell do `mobile-app/android`, ale další root npm script
tam není. Doc-only follow-up používá `(cd mobile-app/android && ./gradlew ...)`.
Opravu nezávislý reviewer potvrdil na exact evidence HEAD
`56665cd40c969f417589f20c7e14a1558754a638`, bez dalšího P1/P2 nálezu. Původní nález
zůstává zaznamenaný, není zpětně označený jako PASS na starém SHA.

Browser oracle už skutečně měří rozhodovací tlačítka MS-14, sRGB/alpha pozadí,
všechny navigační popisky a 320/390 dp při 100/200% písmu. Red evidence20/4
před CSS opravou a green24/0 po ní jsou zachované. SourceDirty musí být explicitní
boolean; dirty build nemůže získat transport readiness ani ověřený source SHA.

## Review existujících mobilních milníků

MM názvy jsou převzaté z donorové mobilní roadmapy na `5cd14776`. Nezakládáme
třetí alternativní roadmapu a nepřenášíme její COMPLETE mezi nekompatibilními SHA.

| Milník | Aktuální závěr pro integraci | Co musí následovat |
|---|---|---|
| MM0–MM1 základ/inventura | Donor uvádí COMPLETE; integrační lineage je nyní doložená, nikoli plně sloučená | Jeden výsledný candidate po převzetí kompatibilních UI částí |
| MM2 BE kontrakt/connector | NOT_COMPLETE | Dokončit B native/session consumer, accepted digest pin a availability+scope gates |
| MM3 konverzační jádro UI | NOT_COMPLETE | Port na skutečné B DTO, list/history, search/run event/cancel journey |
| MM4 ostatní obrazovky | NOT_COMPLETE | Settings/projects/stored-information mapping; BE-owned worker/specialist/device operace |
| MM5 bezpečnost a použitelnost | PARTIAL | Přístupnost tohoto DOM řezu prošla; zbývá native/lifecycle/peer identity a fyzický TalkBack |
| MM6 build, release, distribuce | PARTIAL / RELEASE_BLOCKED | APK/AAB ze S88 jsou sestavené a bound, pouze debug podpis; chybí produkční transport, signer a zařízení |

V současném core existují adaptéry sedmi capability oblastí a VPN runtime wiring.
To není důkaz, že bundled mobilní UI používá jejich signed-session transport.
Aktivní vlastník nativního connectoru má v jiné větvi rozpracovaný Java/client
adapter; jeho cizí uncommitted práce není součástí tohoto review ani APK/AAB.

## Gate a další postup

Mobilní42/42, browser24/24, release boundary16/16; Android APK/AAB build PASS,
lint0errors/13warnings, runtime audit0. Jeden template JVM test neprokazuje
bezpečnost na zařízení. Výchozí fresh full gate336PASS/3FAIL/8BLOCKED;
všechny tři FAIL suite byly reprodukované i na base de0e8127. Výchozí report
zůstává FAIL, nepřebírá staré333/333 tvrzení. Provisioned full run skončil
**344PASS/3FAIL/0BLOCKED**, exit1, se stejnými třemi FAIL programy. Privacy-named
assertion selhává pouze kvůli registry součtu, ne kvůli privátním klíčům.

1. Převzít native connector od jeho vlastníka, včetně runtime origin/SPKI,
   exact asset manifestu a vypnutého globálního HTTP patche. Neobnovovat `/m1` BE.
2. Převádět donorové obrazovky jednotlivě na B DTO a inzerované capabilities;
   nevymýšlet chybějící BE pole ani považovat scope za dostupnou operaci.
3. Integrační vlastník obnoví aktuální registry/LOC/edge/privacy evidence a
   přijatý policy ratchet; mobilní změna nesmí sama ratifikovat M5/M6/Gate0.
4. Na výsledném merge SHA zopakovat boundary/mobile/fresh-clone build a journey.
   Pak fyzický telefon/VPN, TalkBack, session/replay/revocation/recovery a
   produkční podpis/distribuce podle explicitní operátorské autority.

Hromadný merge celé donorové větve není ekvivalent bodu2: obnovil by její
odlišnou `/m1` implementaci a DTO. Zachovává se jediný aktuální integrační základ.
Nic nebylo pushnuto, podepsáno produkčními klíči, aktivováno ani publikováno.

## Konečný handoff

Zůstává jediná naše čistá review větev `work/mobile-completion-20260908`, bez
upstreamu. Dočasný fresh clone (602 MiB) a tři disposable runtime/home adresáře
jsou v koši a lze je obnovit; žádné důkazy nebyly smazané. Integrační checkout má
stále aktivního cizího writeru, jehož novější změny překrývají i release tooling.
Bez jeho commitnutého kandidáta není bezpečné integraci uzavřít nebo prohlásit
větve za sjednocené. Tento řez je dokončený a review-passed; celá aplikace není.
