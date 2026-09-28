# IntentSmith — třetí kolo oprav intentu

**IMPLEMENTED / REVIEW_PENDING / NOT_DEPLOYED.** Operátor odmítl druhé předání kvůli falešnému záporu bez cesty k upřesnění. Současně doporučil pozitivní výběr obsahu k uložení. Oba nálezy jsou implementované v tomto kandidátu; jejich nezávislé přijetí je otevřené.

Čistý zdrojový kandidát: **`2c44ca87daa55407f9cdcdea22d714a76004a6fe`**. Review diff: `57417434dbf2c2071886b77d41506fa087c9b649..2c44ca87`. Větev `work/intent-resilience-20260928`, vlastněný worktree `/home/belphareon/Projects/intentsmith-intent-resilience-20260928`. Autorita: poslední operátorský review, nálezy 1–2; [vymezení práce](../wp/WP-INTENT-REVIEW-ROUND3-20260928.md).

## 1. Falešný zápor a rozhodnutí uživatele

1. Scanner vynechává úseky názvů souborů, URL a e-mailů. Kvůli názvům s číselnou příponou používá pro tuto ochranu širší lexikální výběr než routing souborů; routing samostatné verze nadále vynechává.
2. Krátký seznam nezáporných slov zahrnuje neboť/nebot, běžné tvary nechat, nekdo/neco a new/next/need/network/net. Jde o konkrétní slova a vybrané tvary, nikoli obecnou výjimku pro všechny kmeny nech- či net-. **Nechci a netiskni zůstávají kandidáty zákazu.** Stejně se filtrují chybné modelové negation sloty uvnitř těchto doslovných cílů nebo přesně známých slov.
3. Nejasný ne-prefix i neověřený modelový zákaz nyní vyvolá **„je to zákaz / není to zákaz“**, včetně případu, kdy model sám sporné slovo cituje jako negation. U opakovaného výrazu otázka označí konkrétní výskyt. Citovaný jednoznačný zákaz má nadále no_effect; potvrzení zákazu uživatelem zastaví akci.
4. Explicitní volba se uloží odděleně od modelového JSON jako přesný původní start/end/source a prohibited boolean. Volba nemění původní text a nevkládá do něj slovo „není“. Core ji předá přes pending decision do další kontroly a do opaque tool evidence. ToolExecutor používá tentýž výklad. **Obecné ano, modelový štítek ani stejné jméno slotů ji nevytvoří.** Druhý výskyt nebo jiný zákaz není rozhodnutím o prvním výskytu uvolněný. Normální výběr materiální alternativy dál sám nevyjímá zákaz.

Pozorované pozitivní případy: new-notes.md, next.config.js, network.md, never.md, neon.2, notes-nepřepisuj.md; neboť/nebot, necham/nechám, nekdo/neco, new/next/need/network/net; URL a email se záporně vypadajícím textem. Procházejí i s chybným modelovým negation štítkem příslušného cíle/slova. Efektový nástroj přijme pouze původní path/content; jiný soubor se stejným tokenem odmítne.

Neznámé „neon“ bez a s modelovým negation slotem: otázka → ano stále otázka → není to zákaz pokračuje k handleru a povoleným doslovným parametrům brokeru. Varianta je to zákaz nedosáhne handleru. Dva výskyty neon a kombinace neon + nepřepisuj prokazují, že jedna volba vyjme pouze jeden úsek. Podstrčené rozhodnutí v modelovém JSON a odpověď v jiné konverzaci neuvolní původní požadavek.

## 2. Pozitivní původ ukládaného obsahu

- Úspěšné modelové obsahové cesty vydávají **intentContentEligible=true**. Sdílená syntéza tuto značku vydá pouze při modelovém výsledku; basic/error fallback ji nemá. Přenáší se do odpovědí syntézy nástrojů a vysvětlení souboru. Přímé answer/design/expertise/merged-expertise cesty ji vydávají po generování; specialist clarification není obsah. Expert wrapper přebírá způsobilost obsahu vstupu, takže samotné zabalení provozní hlášky modelem její způsobilost nevytvoří.
- Finalizer ukládá doslovný boolean. ConversationStore jej přenese do DB historie. Selector vyžaduje **pozitivní true**, příslušnost k assistant odpovědi a nesyntetický tah; žádný seznam textových provozních hlášek. Staré intentContentExcluded ani pouhý model/speaker údaj způsobilost nevytvoří. **Historická odpověď bez pozitivní značky skončí no_content**, pokud požadavek nemá vlastní doslovně zadaný obsah k uložení.
- Přes skutečný **ChatController.handle**, DB persist/projection, conversation/file-write handler a ToolExecutor proběhlo devět journeys: přímé uložení; po upřesnění souboru; po potvrzení zákazu jiné akce; chybějící odpověď; druhý zápis do backup.md po žádosti o schválení; zápis po hlášce o chybějícím projektu; historický neoznačený obsah; tři ne-prefix názvy souborů; explicitní uvolnění sporného slova po ano. U povolených zápisů broker dostal **původní bajty modelové odpovědi**, nikoli žádost o schválení nebo bezpečnostní hlášku. Empty/legacy nedosáhnou brokeru. Žádný soubor nevznikl.

Broker těchto journeys je spy vracející approval_required; jde o důkaz přesného požadavku k existující M2 autoritě, nikoli provedení efektu. Samostatné M2 consumer testy zachovávají skutečné approval/effect kontrakty. Jejich fixture obsahové odpovědi mají nově pozitivní marker; forged/legacy vstupy jej automaticky nedostaly.

## 3. Ověření

Úplný audit **2026-09-28T19-06-06-285Z** na čistém **2c44ca87daa55407f9cdcdea22d714a76004a6fe**, Node 24.21.0: **373 PASS / 12 FAIL / 13 BLOCKED / 0 TIMEOUT**, exit 1, celkový gate **FAIL**. SHA-256 reportu: `926f09a1b91e52b831b14d1e65fa927e655f40286055de647f78781b9ec9d30e`. Přesné srovnání ID/path/status/blockers s předchozím `2026-09-28T08-41-03-292Z`: **sameNonPass=true**, `.intentsmith-artifacts/intent-baseline/round3-nonpass-comparison.json`. Audit nezaznamenal novou ne-PASS položku. Jedenáct FAIL jsou chybějící IDE závislosti, jeden historická Gate 0 registry pečeť; třináct BLOCKED jsou nezavázané toolchain prerequisites. [Přesný zachovaný seznam](2026-09-28-INTENT-GROUNDING.md#zachované-ne-pass).

V témže čistém auditu PASS: grounding s novými produkčními journeys a pure/broker probes, M1 chat 33/33, M2 production consumer 22/22, M2 file consumer 39/39, project context 15/15, privacy 11/11, WS 91/91, CRE build 35/35, file reference 9/9, CRE capability 26/26, Quality Sprint 125/125, module boundary 13/13. Každá tato sada má v manifestu sourceTree.clean=true a přesný kandidátní HEAD.

Samostatný **M1 HTTP journey** na čistém `2c44ca87`: `.intentsmith-artifacts/intent-baseline/round3-clean-http-2c44ca87.log`, exit 0. Obsahuje původní material/GPU průchod, volbu zákazu, generické ano, obě explicitní odpovědi i opakované sporné slovo. Validuje skutečný serializovaný ConversationResult. Reálné modelové vyhodnocování ani GPU se nevolalo.

Síťová izolace všech podprocesů auditu, Node 24.21.0:

```sh
bwrap --bind / / --dev-bind /dev /dev --unshare-net --die-with-parent --new-session node scripts/nightly-audit.js --profile=offline,database
```

Registry: 565 programů, fingerprint `508b5333c57dd59a96af282efc3ea46aec7f3635201ca943a7f22bbd08aff0a1`. Census: 675 src JS / 231 902 řádků; 561 tests JS / 255 216 řádků. Module baseline 1458 hran / 3 cykly / 28 členů; žádná nová importní hrana. Diff check PASS.

Červené pomocné běhy jsou zachované: původní test volal answer handler nad novou ASK_USER odpovědí; authority fixture znovu posílala projekt, který chtěla odstranit; první rozšířený HTTP odhalil undefined místo boolean v nové metadatové položce; WS měl starý přesný persist fixture bez nového markeru. HTTP chyba byla opravena v produkčním controlleru, ostatní fixture byly upraveny podle aktuálního operátorského chování. Závěrečné počty výše nejsou přeznačením těchto červených běhů. Žádný registry program ani historický ne-PASS nebyl přeřazen.

## 4. Hranice a předání

**NOT_RUN:** porozumění, přesnost a latence živého klasifikátoru, modelový korpus překlepů a nesmyslných zadání. Scanner může dál zachytit neznámé nezáporné slovo, ale dotčený úsek má explicitní cestu k rozhodnutí uživatele. Ostatní neověřené parametry nebo skutečné významové ambiguity se tím nerozhodnou. Známé souborové/URL/email úseky jsou lexikální; nejde o univerzální jazykový parser.

Pozitivní selekce záměrně nezpětně označuje staré odpovědi ani obecné deterministické prezentace. Obsah mimo dostupný výřez historie se nepovažuje za ověřenou předchozí modelovou odpověď. Při no_content lze nechat vytvořit novou modelovou odpověď nebo zadat vlastní doslovný obsah; to není schválení souborového efektu. Core evidence dál nepovoluje provedení bez existující M2 approval/capability autority.

Nastavení chatového učení v tomto kole nebylo měněno. Jeho vypnutí a zachování ostatních klíčů operátor nezávisle potvrdil; [původní receipt a rollback](2026-09-28-INTENT-REVIEW-ROUND2.md#4-paměť) zůstávají historickou evidencí. Cizí checkouty, nové runtime procesy a cizí provider běh nebyly měněny. Tento zdrojový kandidát nebyl merge/push/deploy akcí tohoto běhu aktivován.

K revizi: diff `57417434..2c44ca87`, zejména pending decision → exact user span choice → opaque tool evidence a model return → finalizer → DB history → file.write. Stav zůstává REVIEW_PENDING; úplný audit ani zelené cílené testy nepředstavují nezávislé přijetí.
