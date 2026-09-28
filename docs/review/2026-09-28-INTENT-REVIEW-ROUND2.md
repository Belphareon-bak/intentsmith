# IntentSmith — druhé kolo oprav intentu

**IMPLEMENTED / REVIEW_PENDING / NOT_DEPLOYED.** Předchozí předání bylo operátorem odmítnuto; tento kandidát čeká na novou revizi. Žádné přijetí ani připravenost k nasazení se tímto reportem netvrdí.

Čistý kandidát: `a97d74fa065e5da102a41d6ac1f84a2ba480f9b9`. Input: `b4045668d571b6f6be8afb475de3f2e49e764366`. Autorita: poslední operátorský review, nálezy 1–4; [vymezení práce](../wp/WP-INTENT-REVIEW-ROUND2-20260928.md). Větev `work/intent-resilience-20260928`, worktree `/home/belphareon/Projects/intentsmith-intent-resilience-20260928`.

## 1. Co se změnilo

| Nález | Oprava a pozorovaný výsledek |
| --- | --- |
| Zápor blokuje informace | `assessIntentClarity` vyžaduje zachování zákazu pouze pro `kind=action`. `verifyToolIntent` kontroluje zákaz pouze při `effectful=true`; efektové nástroje nadále odmítnou `kind=information`. Všech osm uvedených informačních příkladů prošlo ve třech variantách slotů: bez slotů, citovaný scope a citovaný negation. Čtení i hledání prošlo přes ToolExecutor ke spy brokeru; zápis se stejným informačním výkladem byl zastaven před brokerem. Ostatní citace, parametry a M2 autorita se kontrolují dál. |
| Zákaz uprostřed akce | Česká slova začínající ne- se hledají kdekoli, na hranicích slov; výjimky nebo, nej-, než/nez. Žádný seznam kmenů sloves ani požadavek na pořadí předmětu. Oba dodané příklady a varianta bez diakritiky vyvolaly otázku při chybějícím zákazu; citovaný zákaz vyvolal no_effect. Efektový nástroj je znovu zachytil i při ručně vydaném neúplném tokenu. |
| Uložení předchozí odpovědi | Core čte `context.dbHistory ?? context.history`. Finalizer ukládá pouze boolean marker `intentContentExcluded` pro ASK_USER, REFUSE a odpovědi kontroly intentu. ConversationStore tento marker zachová v handler historii. Společný selector core/file handler přeskočí tyto odpovědi i syntetický souhrn. Přes skutečný `ChatController.handle` a skutečný conversation/file-write handler prošly přímo, po otázce + ano + explicitní volbě a po odmítnutí vždy původní bajty odpovědi k existující žádosti o schválení. Bez předchozí odpovědi skončí no_content; otázka není náhradní obsah. |
| Verze jako soubor | Samostatné `3.12`, `qwen3.5`, `v3.12.0` už lexer nevydává za soubory. Běžné přípony, dotfiles a názvy v explicitní cestě zůstávají: src/app.js, .env, report.2026.md, folder/3.12, folder/qwen3.5. |

Z původně přijatých oprav zůstává GPU guard před modelem, bypass pouze celého poděkování, kontrola skutečných polí M2, výjimka pouze pro přesný span a shodný vstup při reuse. Původní GPU incident zůstává uzavřený podle předchozího review; nové testy provider nevolají.

## 2. Rozsah důkazů a hranice

Produkční ingress test neposílá umělou history do inspectRequest. Odpověď vznikne přes handler s řízeným modelovým callbackem, uloží se finalizerem do izolované SQLite a následující příkaz si ji načte přes DB projekci. Broker je spy vracející approval_required; tento journey prokazuje přesný požadavek na schválení, nikoli provedení zápisu. Soubor nevznikl. Existující M2 consumer sady ověřují samostatné schválení a efektovou autoritu.

Původních šest negativních akčních případů zůstává chráněných. Staré tvrzení testu, že i informace se záporem musí skončit otázkou, bylo upraveno podle aktuálního operátorského požadavku. Není přeznačeno neúspěšné provedení: nově jsou proti sobě skutečné pozitivní read/search a negativní write boundary probes.

**NOT_RUN:** kvalita, přesnost a latence živého klasifikátoru. Jeho chybné `action` místo `information` může nadále vyvolat konzervativní otázku. Český ne- scanner je záměrně konzervativní a při skutečné akci může zachytit i ne-negativní vlastní jméno. Lexer neřeší obecnou sémantiku názvů: holý název s číselnou příponou považuje za verzi; explicitní cesta zůstává cílem a doslovný target slot modelu lze nadále ověřit. Starší uložené odpovědi bez nového markeru nelze zpětně spolehlivě odlišit jako otázku/odmítnutí, protože jejich typ finalizer historicky neukládal. Nové produkční cykly jsou otestované.

## 3. Ověření

Úplný audit **2026-09-28T08-41-03-292Z** na čistém **a97d74fa065e5da102a41d6ac1f84a2ba480f9b9**, Node 24.21.0: **373 PASS / 12 FAIL / 13 BLOCKED / 0 TIMEOUT**, exit 1, celkový gate **FAIL**. SHA-256 reportu: `16a68b05134280f1fe67d7cec2885b0ba563c9212d489c6ee3db0962d192121c`. Přesné srovnání ID/path/status/blockers s předchozím auditem `2026-09-28T07-55-39-152Z`: **sameNonPass=true**; `.intentsmith-artifacts/intent-baseline/round2-nonpass-comparison.json`. Žádná nová regrese. Jedenáct FAIL jsou chybějící IDE závislosti, jeden historická Gate 0 registry pečeť; třináct BLOCKED jsou nezavázané testové toolchain prerequisites. [Přesný zachovaný seznam](2026-09-28-INTENT-GROUNDING.md#zachované-ne-pass).

V témže čistém auditu prošly grounding, M1 chat 33/33, M2 production consumer 22/22, M2 file consumer 39/39, project context 15/15, privacy 11/11, WS 91/91, CRE build 35/35, file reference 9/9, CRE capability 26/26, Quality Sprint 125/125 a module boundary 13/13. Grounding i tyto sady mají v manifestu sourceTree.clean=true a přesný kandidátní HEAD.

Síťové oddělení je na úrovni kernel namespace a dědí je všechny podprocesy auditu; nezávisí na rodičovské OLLAMA_URL. Vlastní ephemeral HTTP loopback je dostupný. Příkaz:

```sh
bwrap --bind / / --dev-bind /dev /dev --unshare-net --die-with-parent --new-session node scripts/nightly-audit.js --profile=offline,database
```

Samostatný skutečný M1 HTTP journey na čistém kandidátu: `.intentsmith-artifacts/intent-baseline/round2-clean-http-a97d74fa.log`, exit 0. Grounding produkční ingress i pure/broker probes: v audit logu a `.intentsmith-artifacts/intent-baseline/round2-focused-final.log`, exit 0. Dva první pomocné běhy při rozšíření testu byly červené kvůli chybnému očekávanému textu fixture a unsupported testovanému lexer tvaru ./3.12; logy zůstávají zachované. Nešlo o důkaz hotových oprav a nebyly přeznačeny na PASS.

Registry validace: 565 programů, fingerprint `508b5333c57dd59a96af282efc3ea46aec7f3635201ca943a7f22bbd08aff0a1`. Census: 675 src JS / 231 836 řádků; 561 tests JS / 255 049 řádků. Žádná nová produkční importní hrana. Module baseline zůstává 1458 hran / 3 cykly / 28 členů. Diff check: PASS. Cizí checkouty, procesy i jejich změny zůstaly zachované; v hlavním checkoutu přibyly cizí neversionované dokumenty a script vedle původních čtyř dirty souborů. Nic z toho není součástí této opravy.

## 4. Paměť

[Read-only audit paměti](2026-09-28-MEMORY-SELF-LEARNING-AUDIT.md) byl operátorem věcně potvrzen. Tento kandidát neopravuje detektor feedbacku, zapojení M4 producenta/evaluátoru ani předání LTM do promptu. Na základě operátorem ponechaného rozhodnutí jsem **28. 9. 2026 v 08:49:02 UTC** nastavil v živé instanci `intentsmith.memory.learningEnabled=false`. **APPLIED / VERIFIED** je pouze toto nastavení; zdrojové opravy intentu zůstávají NOT_DEPLOYED. [Samostatné vymezení a rollback](../wp/WP-CHAT-LEARNING-PAUSE-20260928.md).

- Autoritativní writer `updateUserSettings` pochází z běžícího releasu `72247a49`, SHA-256 modulu `913d207115081154768869a3d16ab892201c9f3ea48cf621d83c9d209fc0cffb`; používá skutečný M5 privacy validátor a DB triggery.
- První pokus skončil USER_SETTINGS_DB_WRITE_FAILED, protože samostatné spojení nemělo zaregistrovanou funkci m5_privacy_user_settings_valid_v1. Transakce se vrátila zpět; absence override byla znovu ověřena. Po registraci kanonické funkce proběhl writer i readback. Žádný trigger nebyl vypnut.
- Před: history/context/ltm/learning/feedback/patterns=true; po: **history/context/ltm=true, learning/feedback/patterns=false**. Tato politika se čte při chatMemory každého dalšího vstupu; služba se nerestartovala.
- Všechny ostatní klíče jsou strukturálně shodné. Jejich SHA-256 `b773a35bf16e7f05c18d6f50803d26bdadc9d6d820d7c08c2a7a96749e6f6a01` odpovídá dokumentu před přidáním jediného override. Scoped chatové záznamy **0 → 0**, nic nebylo smazáno. Nastavení platí pro instanci, nikoli jen jednu konverzaci.
- Receipt: `.intentsmith-artifacts/intent-baseline/round2-learning-setting-receipt.json`, SHA-256 `9d738947257b0ce31bfcf64ba4d24e934d3e446a63b271be501a497b87d93814`; neobsahuje hodnoty ostatních nastavení. M4 se tím neopravuje ani nevypíná. Další možné balíky jsou oprava detektoru feedbacku + předání LTM do promptu a samostatné zapojení producenta/evaluátoru M4; v této opravě se neimplementovaly.

## 5. Revize

Posoudit diff `b4045668..a97d74fa` zejména přes produkční persist/finalizer/history/file-write cestu. Počty zelených testů nenahrazují nezávislé review. Předchozí odmítnuté předání a všechny auditní výsledky zůstávají historicky zachované. Kandidát nebyl sloučen, pushnut ani nasazen.
