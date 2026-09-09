# Mobile convergence — implementer review a předání

Historický vstup: IMPLEMENTER_VERIFIED / NOT_PROD_READY.
Nezávislé review následně přijalo MC1/MC2 a vrátilo MC3 CHANGES_REQUIRED.
Oprava a nové APK/AAB na `70eef905` prošly
[navazujícím review](2026-09-09-CORE-COMPLETION-REVIEW.md).
Jde o review vlastního implementačního řezu, nikoli nezávislé schválení releasu.
Předchozí nezávislé verdicts se nepřenášejí na změněné merge bytes.

Product candidate: `f7f78d5a113df0029ff16dea5bbfdf8469b6623f`.
Tree: `91ff3bad5af27dea4f87a385a12fa6594366dcb8`.
Přesní rodiče: mobilní `1ab8d9425c58d2d087cd0c868097545616cc54d2`
a B `f812259d787671358f78d5e789373b39dbfbcd57`.
Evidence: [execution ledger](../execution/runs/mobile/mobile-convergence-20260909.md).
Scope: [WP](../wp/WP-MOBILE-CONVERGENCE-20260909.md).

## Milníky tohoto merge

| Milník | Implementační závěr | Nezávislé review |
|---|---|---|
| MC1 — pinned B + obě release pojistky | VERIFIED: přesný merge, 19/19 release checks, 128 kombinací readiness | REVIEW_PASSED |
| MC2 — locale inventář pro skutečné B | VERIFIED: skript, registrovaný test, JSON i Markdown; čtyři locale, negativní stale check | REVIEW_PASSED |
| MC3 — výsledný candidate, build a předání | Původní implementační claim: mobile 46/46, Android build/unit/lint a binding; full gate 350 PASS / 1 očekávaný Gate0 drift FAIL | CHANGES_REQUIRED na `f7f78d5a`: nesoulad declared index hash; opraveno a REVIEW_PASSED až na `70eef905` |

### MC1 — co se skutečně kontrolovalo

- Tři konfliktní soubory jsou ručně složené, nikoli vyřešené `ours/theirs`.
  Policy vyžaduje současně clean source, explicitně non-debug podpis,
  validní APK/AAB signer identity, ověřený AAB signer, M7 digest/origin/SPKI,
  ověřenou fyzickou runtime evidence a vypnutý globální HTTP patch.
- Dirty source má vždy `THROWAWAY_DIRTY_SOURCE`, null verified source SHA
  a false readiness. Generator zachovává privátní, neopakovatelné output
  adresáře i runtime/artifact binding z B.
- Negativní matice neodebírá ostatní blockers při dirty stavu; ověřuje také
  debug podpis, chybějící signery, špatný M5 pin v M7 režimu a origin/SPKI.
- Skutečný source graph: bundled `app.js` → `m7-ui-api-adapter.js` →
  `m7-native-remote-client.js` → nativní plugin. M7 app test zakazuje browser
  fetch, kontroluje resume a fail-closed zámek. Nativní testy používají fixtures;
  nejsou fyzickým TLS/Android důkazem.
- `src/remote`, `src/server.js`, `src/db`, Android zdroje, harness oracle
  a nightly sealed policy jsou vůči připnutému B beze změny. Jediný produktový
  rozdíl v `src` oproti B je dříve reviewované mobilní CSS. Žádná nová BE oprava.

### MC2 — inventář není nová autorita

242 deklarací desktop routes, 7 M7 HTTP routes, 17 nativních invoke operací
a oddělená public health prerequisite. Sedm oblastí capability se nesmí
zaměnit za implementované obrazovky nebo za dostupnost konkrétní session.
Test ověřuje byte-identický JSON i Markdown pod C/en_US/cs_CZ/de_DE, neměnnost
při otočení vstupního pořadí a odmítnutí stale artefaktů. Použitá je ordinální
komparace z locale opravy donoru, nikoli jeho nekompatibilní `/m1` server,
DTO nebo generované snapshoty. Lexikální census není parser ani live route scan.

### MC3 — build evidence a její hranice

APK a AAB jsou skutečně sestavené na clean source candidate v `remote-core-v1`,
ale s testovacím `https://100.64.0.10:7443` a syntetickým SPKI pinem `sha256:` +
64 znaků `a`. Tyto hodnoty nejsou zjištěná produkční konfigurace a nebylo k nim
navázáno spojení. Evidence správně vrací `THROWAWAY_DEBUG_SIGNED`,
`sourceDirty=false`, `COMMITTED_SOURCE` a `releaseTransportReady=false`.
APK i AAB vážou přesné source SHA a M7 adapter digest. Runtime npm audit: 0.
Offline JVM: 3 canonical JSON testy + 1 template test; lint: 0 errors / 16 warnings.
To není device, TalkBack, dlouhodobá stabilita ani nezávislé bezpečnostní review.

Fresh-clone deterministic gate na přesném source SHA: **350 PASS / 1 FAIL /
0 BLOCKED**, exit 1. Jediný non-PASS je
`IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST`:
`registry hash differs from the reviewed Gate 0 policy`. Nový registrovaný
locale test posunul fingerprint; sealed release policy se záměrně neratifikuje
při vývoji podle `CONTRACT.md` §8. Raw verdict zůstává FAIL. Artifact validation
158/158, browser 24/24, module ratchet 13/13 i harness census prošly na stejném SHA.
Staré document/census FAIL se v tomto běhu nevrátily; Gate0 FAIL nelze maskovat.

## Původní mobilní milníky po integraci

Názvy MM jsou pouze návaznost na předchozí review/donorovou roadmapu, ne nová
produktová autorita. COMPLETE nelze přenést mezi rozdílnými klienty a kontrakty.

| Milník | Co tento merge změnil | Co zůstává |
|---|---|---|
| MM0–MM1 základ/inventura | Jeden výsledný review candidate a reprodukovatelný locale inventář | Nezávisle přijmout konvergenci; novější B commity jsou explicitně mimo freeze |
| MM2 BE connector | Nativní pinned M7 session/invocation consumer je nyní skutečně v kandidátu | Fyzický VPN/session/replay/revocation důkaz, produkční konfigurace |
| MM3 konverzační jádro | UI adapter mapuje list/history/send a operation recovery | Kompletní end-to-end screen journeys; search/run-event/cancel nelze označit za hotové jen z katalogu operací |
| MM4 ostatní obrazovky | Approval/notification adapter integrován; katalog pokrývá 7 capability oblastí | UI adapter nemá projects/settings/stored-information screen mapping; worker/specialist/device nemají M7 operace. Neimportovat jejich legacy DTO |
| MM5 bezpečnost/použitelnost | Přístupnost zachovaná, native identity/session cesta převzatá, obě release pojistky složené | Fyzický Android lifecycle/TalkBack, nezávislé review a skutečná bezpečnostní evidence |
| MM6 build/release/distribuce | Skutečné M7-mode APK/AAB bound na commit, fyzická evidence je povinný vstup | Produkční APK/AAB signery, VPN/device evidence, schválený release a distribuce |

## Další postup a výslovné neprovedené akce

1. Nezávisle reviewovat přesný `f7f78d5a`, především conjunction policy,
   generator a locale adaptaci. Novější B `036ba6bd..0b0a4669` není součástí
   tohoto výsledku; případná další konvergence vyžaduje nový přesný rozsah.
2. Mobilní obrazovky napojovat jednotlivě na existující B DTO; chybějící BE
   domény mají nejprve získat vlastní kontrakt a BE implementačního vlastníka.
3. Pro release dodat skutečný VPN/device/TalkBack běh a schválené podpisové
   identity. Gate0 policy se obnovuje až v explicitní release práci (§8).

Žádný push, upstream, tag, receipt, publikace, instalace na telefon, pairing,
produkční klíč, listener/systemd/firewall/VPN aktivace ani live LLM/GPU test.
Vše zůstává lokální: merge sám neřeší riziko jediného disku. Cizí worktrees a
jejich práce nebyly změněné; používá se stále jedna naše review větev.
Dočasný čistý klon `.mobile-verification-DbEIF9` (575 MiB podle `du -sh`) byl
po kontrole nulových aktivních cwd a zachování evidence přesunut do koše,
odkud je obnovitelný. Registry/report/checkpoint/logy i retained APK/AAB zůstaly
v původním evidence rootu mimo klon. Žádný cizí worktree ani záznam nebyl odstraněn.
