# Dávkové zadání M1 — autonomní běh s odloženým review

**Určeno pro:** operátor (schválení) → agentní běhy (provedení)
**Vstup:** `ROADMAP.md` v4, `CONTRACT.md` §7, uzavřené `WP-M0-E` opravy
**Cíl dávky:** ~5 zapisujících WP + 1 read-only stopa proběhnou bez operátorského
vstupu; operátor vstoupí až na dvou review gates.
**Cílový umístění v repu:** `docs/execution/m1-batch.md` (založit až až bude
volný zapisující vlastník)

**Operátorský stav 2026-08-08:** tento M1 batch a volby 001–014 jsou přijaté
jako omezená prováděcí autorita. Plné přijetí `ROADMAP.md` v4 tím není
nahrazené. Follow-upy níže se provádějí po malých sériových checkpointech a
žádný vybraný BLOCK se nestává PASS bez implementace a důkazu.

**M1 closeout amendment 2026-08-11:** operátor přijal celý
`M1-CLOSEOUT-X1` včetně 026/029, B3–B6 a execution hranic a doplnil
`AUTONOMY-STOP-EXTRA-1` a `AUTONOMY-REVIEW-1`. Tento blok je normativní pro
closeout a při rozporu nahrazuje starší brief níže; nemění neprovedený krok na
PASS. Přesné pořadí je
`026 → 029 → B3 → B4 → Gate 1 → B5 → B6 → Gate 2`.
029 dual CAS vědomě nahrazuje dřívější single-revision 029/A a standalone
`chats/ = unsupported / not shipped` je vědomě přijatá změna support claimu.

---

## 0. Jak se to používá

Každý brief v §4 je samostatný, vložitelný prompt pro jeden agentní běh. Běhy
jdou **sériově** — jedno zapisující vlastnictví v jednom worktree. Agent se
během běhu neptá. Jediný kanál zpět k operátorovi je **rozhodovací fronta**
(`docs/decisions/`), kterou operátor přečte na review gate.

Dávka končí na M1 exit. M2 briefy se teď nepíšou: jejich WP konzumují
`EffectRequest/Result` a `ProjectContextQuery/Snapshot`, které ještě neexistují —
předepisovat je před freeze M1 connectoru by byly přesně ty „stovky
předvyplněných záznamů", které `ROADMAP.md` §2 zakazuje. Místo toho běží
paralelní read-only stopa **P1**, která pro M2 připraví důkazy.

---

## 1. Protokol autonomie

Roadmapa má u každého WP `Stop condition`. Doslova vzato zastaví běh u první
nejasnosti a dávka se rozpadne po dvaceti minutách. Tento protokol každou
zastávku zařadí do jedné ze čtyř tříd. **Zařazení je součástí zadání, ne
úvahy agenta za běhu** — každý brief má v §4 svůj seznam.

### BLOCK — zastavit dotčenou část, nehádat

Agent zapíše `docs/decisions/NNN-<slug>.md`, zastaví **jen** dotčenou část WP a
pokračuje nezávislými částmi. Když je zablokované jádro WP, ukončí běh se
stavem `BLOCKED` a přejde na další brief v pořadí.

Blokuje vždy a bez výjimky:

- změna L0 invariantu (`CONTRACT.md` §2);
- oslabení bezpečnostního guardu, testu nebo boundary, ať už jako „dočasné";
- nová runtime nebo test dependency;
- nejednoznačnost v tom, čí data se čtou/zapisují nebo kam mohou odtéct;
- akce nad zálohovanými/uživatelskými soubory, které nejdou vrátit;
- GPU stav, který nelze bezpečně obnovit;
- zjištění, které zpochybňuje směr WP jako celku (např. že měřený problém
  neexistuje).

### DECIDE-AND-CONTINUE — vzít vratný default, zapsat, pokračovat

Použitelné **jen** když je splněná podmínka švu: *alternativa je dosažitelná
změnou uvnitř jednoho pojmenovaného souboru/funkce plus jejích testů.* Švy jsou
předepsané v briefu; agent nové švy nevymýšlí.

Pravidlo výběru defaultu: **default je ta varianta, která se nejlevněji ruší, ne
ta, která vypadá líp.** Když jsou obě stejně vratné, vybere se ta, která
o systému tvrdí méně.

### PARK — vyhodit položku ze scope, pokračovat zbytkem

Když je jedna položka WP zablokovaná, ale zbytek na ní nestojí. Zapíše se
`docs/decisions/` záznam s `typ: PARK` a explicitním „co tím zůstává
neověřené". Nesmí se použít na položku, kterou brief označí jako `povinná`.

### FINDING — vada mimo povolené cesty

Nastane skoro jistě (CHAT najde vadu ve WS, MODEL v routes). Agent **neopraví
a nerozšíří scope**. Zapíše `docs/findings/NNN-<slug>.md` s minimální reprodukcí
a vlastníkem podle roadmapy. Když kvůli tomu nový test padá, test se
**nesmaže ani neoslabí** — označí se v hlavičce `PENDING-OWNER: WP-M1-XXX` a
zaregistruje jako známý červený s odkazem na finding.

### Formát rozhodovacího záznamu

```markdown
# NNN — <věta, co se rozhoduje>

- **typ:** BLOCK | DECIDE | PARK
- **WP:** WP-M1-XXX
- **rail:** R1..R7, kterých se týká
- **vzniklo při:** <konkrétní krok / test / soubor:řádek>

## Evidence na stole
<co agent skutečně naměřil nebo přečetl; ne dojem>

## Varianty
| Varianta | Chování | Dopad na rails | Cena zavedení |
|---|---|---|---|

## Vzatý default a proč
<která varianta a proč je nejvratnější>

## Šev
<soubor:funkce, kterou stačí změnit>

## Cena přepnutí, když operátor rozhodne jinak
<seznam souborů + testů + odhad; musí být konkrétní, ne „malá">
```

**Zakázané způsoby, jak rozhodnutí „vyřešit":** oslabit test, rozšířit povolené
cesty, označit schopnost jako PASS, přepsat roadmapu tak, aby otázka zmizela.

### M1-CLOSEOUT-X1 — autonomie, review a poslední manifest

Uvnitř schváleného WP agent autonomně volí fail-closed, preserve-data,
no-replay, no-network a nejvratnější kompatibilní variantu. Neeskaluje znovu
error codes, helper API, interní pořadí, fixtures, retry/no-op nebo jiné
implementační detaily. Vadu uvnitř allowlistu opraví a nechá nezávisle
zreviewovat; vady mimo scope sesbírá do jednoho balíku místo jednotlivých
zastavení.

Closeout se zastaví pouze při:

- nové veřejné capability nebo connectoru;
- změně L0;
- nevratném smazání dat;
- external network effectu;
- model pull/delete/rebind;
- změně support claimu;
- neřešitelném source conflictu;
- přidání, zeslabení nebo obejití auth guardu, access boundary či trusted-local
  kontraktu.

Poslední bod neblokuje opravu uvnitř schváleného allowlistu a již přijaté
hranice; změna bezpečnostní/autentizační hranice samotné se nesmí odvodit jako
implementační detail.

Nezávislé review vždy znamená `writer != reviewer`. Jakákoli nová změna
allowlistu přistane vlastním governance/docs commitem **před** source writerem,
nikoli uvnitř reviewovaného subjectu. Výslovně vyjmenovaná rozšíření v
`026-ALLOWLIST-EXTENSIONS` už tímto commitem přijata jsou a další rozhodnutí
nepotřebují.

Pro tento amendment je topologie připnutá: governance commit `G` vznikne jako
sibling P0 commitu z exact společného rodiče
`ea21bf3e2f8a54e1cbf93430cdb52037957a63c8`, projde vlastním nezávislým review
a promotion a teprve potom se běžným merge commitem bez rebase, cherry-picku
nebo jiného history rewrite připojí do existující P0 branch s commitem
`3bb35bbb32063dd058ab35872668d645fe9ff106`. Merge zachová exact P0 commit jako
ancestor i identitu. Finální 026 Review A použije promoted `G` jako
`baseRevision` a `S` jako `subjectHead`; review range je `G..S`, takže samotný
governance commit není uvnitř source subjectu a P0 v něm naopak zůstává přes
merge ancestry. P0 se tím samostatně nepromuje.

Před efektovou částí closeoutu zbývají jen dvě datově závislé operátorské volby
a předloží se společně jako jediný redigovaný `M1-EXECUTION-MANIFEST`:

1. exact source/path/digest akce pro skutečně nalezené legacy hodnoty;
2. exact aktuální desired binding a dostupný distinct fallback target včetně
   potřebných proof pinů.

Manifest nenese raw secret a není blanket purge ani model selection authority.
Bez exact digestů se příslušná akce neprovede. Všechna ostatní rozhodnutí tohoto
closeoutu jsou přijatá níže nebo v decision 026/029 a znovu se neotvírají.

Closeout smí vytvářet bounded WP branches, commity, push, Review A/B a merge
queue evidence podle `CONTRACT.md`. External network zůstává vypnutá;
GPU/Ollama/Electron joby jsou sériové. Ukončovat se smějí jen test-owned process
groups. Zakázaný je force-push, tag, release, history rewrite a model
pull/delete/stop/unload/rebind. Uživatelská data se nemutují a failure artefakty
se zachovají.

### M1-CHAT-EVIDENCE-RECOVERY-X1 — jednorázový predecessor resetu

Operátor 2026-08-12 přijal
[`M1-CHAT-EVIDENCE-RECOVERY-X1 + X1-a + X1-b`](../decisions/030-m1-chats-evidence-envelope-recovery.md).
Canonical integration omylem fast-forwardla na
`I=39776f1e90e425bd91a7be707edc556a299869bd`: direct child správného
`C_CHAT=578876dd77c68df4bdcf6239383fa782b649f843`, který mění pouze chats report,
ale připojuje 25 řádků narativu před dvěma povinnými metadata řádky. Tím porušuje
byte-exact `assert_report_append`; behavior candidate ani corrected Review B
PASS nejsou zpochybněné.

Před resetem se proto sériově provede
[`WP-M1-CHATS-EVIDENCE-RECOVERY`](../wp/WP-M1-CHATS-EVIDENCE-RECOVERY.md):

1. `G_REC` jako direct child `I` uchová 25 řádků verbatim v governance
   decision, projde vlastním nezávislým docs-only review a nezmění target
   report ani žádnou z dvanácti reset-relevantních transfer paths;
2. `X` jako direct child `C_CHAT` vytvoří correct `E_B_CHAT` s exact report
   blobem `04b839db53abcbce510a9d57d7b750f20e2c6f9d` a root tree
   `118a7b5007cfcb75baad0ce894b2e3bbd5517e72`; corrected behavior Review B se
   znovu nespouští;
3. `R_REC` má exact parent order `[G_REC, X]`, report byte-identický s `X` a
   každý non-report path byte-identický s `G_REC`;
4. integration se posune pouze fast-forwardem `I -> G_REC -> R_REC`.

Invalidní 27řádkový report z `I` zůstane dohledatelný v historii, ale nesmí být
v resulting canonical tree. Jen metadata-ověřený a fast-forward promováný
`R_REC` je přípustný `baseRevision` resetu. Rebase, cherry-pick, amend,
force-push, history rewrite, source/test změna a nový behavior run jsou
zakázané. Rozpracovaný dvanácticestný reset diff se zachová bez druhého reset
worktree: privátní disk patch + SHA, reverse-apply owned diffu, čistý `--ff-only`
posun stávající branche `I -> R_REC`, jedno reapply a exact path/digest gate.
`stash`, `reset --hard`, force update ani ruční přepis patch artifactu nejsou
povolené. Recovery nemění pořadí zbytku closeoutu:
`R_REC → 029 reset → B3 → execution manifest → B4 → Gate 1 → B5 → B6 → Gate 2`.

---

## 2. Sdílené invarianty — platí pro každý běh v dávce

1. **Jeden zapisující vlastník.** Běhy jdou sériově. Před startem: `git status`
   musí být čistý mimo osm rozpracovaných inventur.
2. **Osm inventur `docs/inventory/*.md` (modifikované, necommitnuté) se nikdy
   nečte jako vstup, needituje a necommituje.** Platí i pro `git add -A`.
3. **Historický režim bez push je pro M1 closeout nahrazený:** bounded WP branch
   se po vlastním gate pushne pro immutable Review A/B a merge queue. Force-push,
   tag, release a history rewrite zůstávají zakázané.
4. **Malé commity.** Jeden commit = jedna ověřitelná změna chování + její test.
   Zpráva česky nebo anglicky, bez `Co-Authored-By`.
5. **Povinná baterie před každým commitem** — všechna musí projít, jinak se
   necommituje:
   ```
   node tests/artifact-validation.test.js
   node scripts/validate-test-registry.js --json
   node tests/repository-hygiene.test.js
   git diff --check
   ```
   plus focused testy daného WP z bodu 8 briefu.
6. **Nový test = update registry ve stejném commitu.** WP přidá kanonický
   záznam do `tests/registry.json` a přes
   `node scripts/validate-test-registry.js --write-doc` regeneruje odvozený
   `docs/convergence/TEST-REGISTRY.md`. Přidání testu bez obou synchronních
   kroků shodí bod 5. (Viz úzká odchylka O-1 v §6.)
7. **Artefakty** do `.intentsmith-artifacts/<wp>-<sha>/`, adresář `0700`,
   soubory `0600`. Capability hodnoty, tokeny ani obsah `~/.c3/port` se
   neevidují.
8. **GPU sériově.** Žádné dva běhy nesahají na Ollamu současně. Sdílená Ollama
   se nikdy nezastavuje — negativní cesty používají izolovaný fake nebo
   uzavřený port.
9. **Zákaz `yarn clean` v `c3-ide/extensions/c3-chat-panel`** a jakéhokoli
   `tsc -b` v tom balíčku, dokud nedoběhne WP-M1-STUDIO bod „zneškodnit build
   kontrakt". `outDir` je `lib` — build i clean smažou autoritativní runtime.
10. **Nic se nehlásí zeleně, co neproběhlo.** Neproběhlý krok se hlásí jako
    neproběhlý, `INCONCLUSIVE` zůstává `INCONCLUSIVE`.
11. **Závěr každého běhu** zapíše `docs/execution/runs/<wp>-report.md`:
    výsledek per bod 6 briefu, seznam commitů, seznam rozhodnutí a findingů,
    cesty k artefaktům, a co zůstalo neověřené.

---

## 3. Pořadí běhů

```
        ┌─────────────────────────────────────────────┐
        │ předpoklad: WP-M0-E opravy uzavřené kolegou │
        └───────────────────────┬─────────────────────┘
                                ▼
                    B1  WP-M1-CONTRACT          (zapisující)
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
        B2 WP-M1-CHAT     B3 WP-M1-MODEL   B4 WP-M1-STUDIO
        (sériově v tomto pořadí — logicky paralelní, fyzicky ne)
              └─────────────────┼─────────────────┘
                                ▼
                    ══ REVIEW GATE 1 ══
                                ▼
                    B5  WP-M1-QUALITY           (integrace)
                                ▼
                    B6  M1-JOURNEY              (exit demonstrace)
                                ▼
                    ══ REVIEW GATE 2 (M1 exit) ══

  paralelně po celou dobu, read-only, nikdy necommituje do src/:
        P1  M2-EFFECT-TRACE
```

Pořadí B2 → B3 → B4 je záměrné: CHAT nemá GPU závislost a odhalí nejvíc
kontraktních vad nejlevněji; MODEL potřebuje sériové GPU okno; STUDIO má
nejdelší build/journey cyklus, takže jde poslední, kdy je kontrakt nejstabilnější.

Pro aktuální closeout je B2 již hotový prerequisite a výše uvedený historický
diagram se provádí přes tuto exact frontu:

```text
026 secret-storage authority
  → 029 high-level krok se dvěma sériovými subjecty/reporty:
      standalone chats decommission → dual-CAS settings reset
  → B3 terminal failover/proof + autorizovaný T3 GPU běh
  → B4 immutable built Electron journey
  → Gate 1
  → B5 quality rozhodnutí podle předem přijatého prahu
  → B6 dvoufázová M1 journey nad jedním build manifestem
  → Gate 2
```

---

## 4. Briefy

### B1 — WP-M1-CONTRACT

> Jsi zapisující vlastník `WP-M1-CONTRACT`. Platí `ROADMAP.md` §5, `CONTRACT.md`
> §7 a §1–2 tohoto dokumentu. Neptej se; rozhodnutí zapisuj do fronty.

1. **Výsledek:** verze 1 connectorů připne korelaci, scope konverzačního stavu
   a jedinou terminální sémantiku shodnou pro HTTP, WS i Studio.
2. **Povolené:** nové `contracts/m1/**`, `src/ws-bridge/protocol.js`,
   `c3-ide/extensions/c3-protocol/src/**`, nový `tests/m1-contract.test.js`,
   `docs/convergence/TEST-REGISTRY.md`, `docs/decisions/**`.
   **Zakázané:** controller, routes, gateway, session-adapter, Studio UI, quality.
3. **Connector:** `ConversationCommand/Result`, `ModelRequest/Result`, `CoreEvent`
   v1 — vlastní je tento WP jako jediný.
4. **Vstup:** čistý base SHA po uzavření M0-E oprav; zapiš jej do reportu.
5. **Schéma k implementaci** je to, které `ROADMAP.md` §5 bod 5 už popisuje.
   Implementuj ho jako `PROVISIONAL_V1`: `conversationId` je state a durability
   key, `sessionId` jen transport; command i každý event nesou `requestId`,
   `conversationId`, `turnId`; cancel je scoped; Result je právě jeden z
   `ok | cancelled | timeout | error`; `ModelRequest` rozlišuje `callerRole`,
   `modelRole` a purpose `classify | answer | synthesize | refine`; prázdný
   output není úspěch.
   **Forward-compat požadavek:** `CoreEvent` musí mít monotónní `sequence` a
   terminal musí být odlišitelný od progress i bez čtení payloadu, aby bylo
   streaming později přidatelné bez změny v1.
6. **Test:** pozitivní round-trip všech tří connectorů v JS i TS; negativně
   chybějící/cizí ID, verze/status, response na error, error na ok, prázdný
   modelový obsah, duplicitní terminal, out-of-order sequence, unscoped cancel.
7. **Autonomie:**
   - `BLOCK`: kontrakt by musel obsahovat M2 effect/approval authority; TS/JS
     sdílení by vyžadovalo novou závislost.
   - `DECIDE` **D-1 `degraded` vs terminální `error`:** default = `degraded`
     **není** v unionu; částečný tool výsledek následovaný selháním providera je
     `error`, ale Result nese `partial.toolResults`, který se persistuje a
     **nerenderuje jako assistant**. Šev: `contracts/m1/terminal.js:classifyTerminal()`
     plus jedna větev renderu ve Studiu. Do záznamu vyčísli cenu přepnutí.
   - `DECIDE` **D-2 pozdní assistant po cancelu:** default = odmítnout a
     nepersistovat. Šev: tentýž `classifyTerminal()`.
   - `PARK`: streaming — mimo v1, jen ověř forward-compat požadavek výše.
8. **Ověření:** `node tests/m1-contract.test.js` (nový);
   `node tests/ws-bridge.test.js`; v disposable klonu z `c3-ide/`
   `corepack yarn workspace @c3/protocol build`.

---

### B2 — WP-M1-CHAT

> Zapisující vlastník `WP-M1-CHAT`. Vstup: přijatá v1 z B1. Nesaháš na schéma.

1. **Výsledek:** dva chaty nesdílejí stav; success/error/cancel/timeout mají
   jediný pravdivý request-level výsledek; úspěšný assistant je durable dřív,
   než odejde odpověď.
2. **Povolené:** `src/chat/controller.js`, `src/chat/conversation-store.js`,
   dočasně `src/chat/response-finalizer.js`, chat/abort error typy,
   `src/routes/chat.js`, nové `tests/m1-chat-*.test.js`, registry, decisions.
   **Zakázané:** `src/llm/**`, `src/ws-bridge/**`, `c3-ide/**`,
   quality/synthesis internals.
3. **Connector:** pouze adaptér přijaté v1; sémantiku nemění.
4. **Závislost:** B1. `response-finalizer.js` po přijetí předáš B5.
5. **Demo:** dva oddělené chaty, deterministický request, modelový request,
   skutečný stop/start backendu nad stejnou SQLite, přesně obnovené turny.
6. **Test — povinné položky:**
   - pozitivně: HTTP deterministic pod 100 ms bez LLM; durable restart přes
     **skutečný stop/start procesu**, ne jeden in-memory store;
   - negativně: provider exception, timeout, persist exception, cancel před /
     během / těsně před persistencí — nikde assistant turn ani false-success;
   - izolace: backendový stav konverzace A se nesmí objevit v B.
   - **Explicitně opravit** `tests/chat-persistence.test.js` — dnes používá
     `new ConversationStore(null)` a komentář na ř. 231 přiznává, že persistenci
     jen simuluje. Nahradit skutečným restartem, ne přidat druhý test vedle.
   - Izolaci Studio panelů nevlastníš — to je B4.
7. **Autonomie:**
   - `BLOCK`: potřeba změnit connector; filesystem attachment authority.
   - `DECIDE` **D-3 pořadí persist vs. odpověď:** default = persist-then-respond
     i za cenu latence; když to shodí p95 pod 100 ms u deterministické cesty,
     zapiš naměřená čísla a **neopravuj to zkrácením testu**.
   - `FINDING` očekávaně: `response-finalizer.js:163-165` (catch zaloguje a vrátí
     úspěch) je uvnitř tvých cest → oprav. Cokoli ve `ws-bridge/` nebo `llm/` →
     finding, neopravuj.
8. **Ověření:** `node tests/deterministic-answer-latency.test.js`,
   `node tests/confirmation-ownership.test.js`, `node tests/routes-smoke.test.js`,
   `node tests/chat-persistence.test.js`, `node tests/m1-chat-contract.test.js` (nový).

---

### B3 — WP-M1-MODEL

> Zapisující vlastník `WP-M1-MODEL`. GPU okno je tvoje a jen tvoje.

1. **Výsledek:** role binding, VRAM fit, timeout/cancel/provider failure a
   modelový výstup mají přesný typ; každé volání je přiřaditelné účelu.
2. **Povolené:** `src/llm/{auth-types,cre-bridge,gateway,model-ctx}.js`,
   `src/upgrade/{model-registry,model-profiles}.js`, nové model contract testy,
   registry, decisions. **Zakázané:** chat, Studio/WS, quality, online upgrade
   automatika, s těmito přesnými operátorskými výjimkami:
   - **B3-IDENTITY / 006:** nový `src/upgrade/model-identity.js`, identity
     comparisons v `model-registry.js` a `upgrade-manager.js`, plus přímý
     fallback `src/routes/system.js`; pokryje usage/validation, overview,
     `getUnusedOldModels()` a všechny delete/cleanup guardy. Integrity check
     smí jen `DETECTED/PROPOSED`, s nulovým assign/override/broadcast efektem;
   - **B3-PROFILE / 009:** jediný `src/llm/model-runtime-profile.js`, spotřeba
     v `model-ctx.js`, pouze `src/chat/context-compact.js` z chat scope a
     existující GPU/context-compact testy. Threshold, safety truncate i
     post-log fill používají tentýž efektivní kontext;
   - **B3-FAILOVER / 006:** až po přijatém IDENTITY samostatně opt-in
     desired/active persistence. Přesný scope: nový `src/db/user-settings.js`,
     `src/upgrade/model-failover.js`, jedna
     `src/db/migrations/*model_failover*.js`, `model-registry.js`, identity/
     verify části `upgrade-manager.js` a scheduler seam v `src/server.js`.
     Opt-in čte JSON `user_settings.id=1`; missing/malformed/DB error fail-close.
     Je to výslovná D+ výjimka, ne obecné rozmrazení online upgrade automatiky
     a ne změna L0-9 před důkazem.
3. **Connector:** adaptér `ModelRequest/Result` v1; schéma nemění.
4. **Závislost:** B1. Offline fake běhy nečekají na GPU — udělej je první.
5. **Demo:** skutečná odpověď z lokální Ollamy. Negativní cesta používá
   izolovaný fake nebo uzavřený port; **sdílená Ollama se nikdy nezastavuje**.
6. **Test:** fake Ollama pokryje validní, prázdný/malformed, 404/500/503,
   refused socket, timeout, queued cancel, retry policy, uvolnění semaforu.
   Sériový GPU běh změří cold/warm, klasifikaci, answer, mid-generation cancel,
   model/num_ctx a VRAM před/peak/po.
   **Povinná oprava:** `src/llm/gateway.js:508` bere
   `data.message?.content || data.response || ''` a pak emituje
   `emitRuntimeSignal('runtime', true)` a audit `LLM_CALL_COMPLETE` — prázdný
   obsah dnes projde jako úspěch.
7. **Autonomie:**
   - `BLOCK`: nutnost pull/delete/rebind modelu; nebezpečný VRAM stav; změna
     connectoru; požadavek na streaming.
   - `DECIDE` **D-4 retry policy:** default = **žádný automatický retry ve v1**.
     Retry maskuje selhání providera, což je přesně to, co má M1 zpravdivět.
     Šev: `gateway.js:callWithPolicy()`.
   - `DECIDE` **D-5 VRAM nefit:** default = odmítnout typovaným errorem před
     voláním, ne best-effort a OOM. Šev: `model-ctx.js:fitsVram()`.
   - **M1-CLOSEOUT-X1 nahrazuje dřívější otevřený terminal/GPU rozsah:**
     fallback target je explicitní per-role typed CAS pin obsahující exact
     requested name, canonical name a digest. Nikdy neplatí „nejnovější proof
     vyhrává“. Backup/import target nepřenáší a destination jej zachová;
     explicitní reset target vyčistí. Nula, více nebo nezpůsobilý target je
     `INCONCLUSIVE` bez effectu.
   - Aktivace vyžaduje literal opt-in, explicitní target, exact installed
     artifact a fresh same-role digest-bound proof. Durable intent předchází
     runtime effectu; success vznikne až po exact runtime finalize receiptu.
     Uncertain commit se pouze reconciliuje podle exact generation, nikdy blind
     replayem ani alternativním kandidátem.
   - Restore smí použít pouze exact desired name+digest+revision s fresh desired
     proofem. Restore failure nechá fallback aktivní jako degraded. User binding
     superseduje failover a blokuje pozdní restore; startup rehydrate přijme jen
     exact active lineage. Happy-path používá skutečný connector v disposable
     file-backed DB/runtime proti lokální Ollamě; failure/race matrix smí použít
     test-owned adaptéry. Uživatelská DB ani config se nemění.
   - Terminální změna `model-failover.js` zneplatní dnešní raw-byte-pinned proof.
     Po final B3 source se operator-only sériově vydají nové CHAT proofy jen pro
     přesně potřebné desired/fallback digests, nejvýše dva. Conditional reissue
     je povolen jen při expiraci nebo relevantním source/digest driftu. Issuance
     nemá background obnovu ani runtime mutaci. Active failover po expiry
     zůstává bound jako `DEGRADED_PROOF_EXPIRED`; nový `ACTIVATE/REAPPLY` je
     blokovaný.
   - Je autorizovaný právě jeden registrovaný T3 běh na RTX 3090 pro
     `qwen3.5:27b`, digest
     `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`,
     `num_ctx=4096`, headroom nejméně `1024 MiB`, GPU residency `100 %` a
     fallback zakázaný. Měří cold, warm, classify a mid-generation cancel.
     Preflight vyžaduje prázdný `ollama ps` a žádný compute proces. Zakázaný je
     pull/delete/stop/unload/rebind; cleanup jen přirozenou expiry. Historický
     `8192 FAIL` zůstává zachovaný.
8. **Ověření bez GPU:** `node tests/llm-gateway-runtime-signal.test.js`,
   `node tests/model-ctx.test.js`, `node tests/m1-model-contract.test.js` (nový).
   GPU jen registrovanou T3 sadou s `concurrency=1`.

---

### B4 — WP-M1-STUDIO

> Zapisující vlastník `WP-M1-STUDIO`. Nejdřív si přečti report z M0-E oprav.

1. **Výsledek:** built Theia správně koreluje panely, ukáže progress i přesný
   terminal, scoped cancel/reconnect, žádný tichý outbound.
2. **Povolené:** `src/ws-bridge/{ws-server,session-adapter}.js` **bez**
   `protocol.js`; `c3-ide/extensions/c3-chat-panel/{src,lib}/**` a bridge podle
   přijaté source disposition; nové Studio client/journey testy, registry,
   decisions. **Zakázané:** chat controller, routes, LLM, quality, přijatý
   protocol.
   **Gate 1 follow-up výjimky schválené operátorem:** 010/A+ smí odstranit stale
   `c3-protocol/lib/**` z trackingu a změnit jen `.gitignore` a
   `c3-ide/package.json` pro jeho generated prebuild; 012/B smí změnit jen
   existence-aware history větev v `src/routes/chat.js`; 014/A smí změnit jen
   legacy rehydrate control payload/handler,
   autoritativní klient/localStorage clamp a úzký durable-readiness šev v
   `conversation-store.js`. Ostatní routes/store, connector schema a
   `src/ws-bridge/protocol.js` zůstávají zakázané.
3. **Connector:** konzument `ConversationCommand/Result` a `CoreEvent` v1.
4. **Závislost:** B1 + přijatá disposition z M0-E.
   **Cancel začíná v klientovi**, ne v backendu: `wsSendCancel` /
   `_cancelExecution` doplní `conversationId`. Scoped backend větev
   (`session-adapter.js:528-541`) se **zachová**; její `cancel all` fallback se
   pouze negativně otestuje. Nezačínej v `session-adapter.js`.
5. **Demo:** skutečná Theia, dva panely s prokládanými eventy, jeden cancel a
   jeden success, provider stop, restart/reconnect, nulový Fonts request.
6. **Test:** Po operátorském rozhodnutí 011/A platí pro M1 **WS send +
   fail-closed offline stav**, nikoli původní WS/HTTP send parity. Pro všechny
   tři send call sites se samostatně ověří unavailable WS,
   `sendChat() === false` a synchronní throw; s `FILE_WRITE`, `SHELL` a generic
   tool je počet `/chat`, provider, filesystem i tool efektů přesně nula a
   input zůstane `NOT_SENT`/retryable. HTTP send parity se vrátí v M2. Browser local
   capability projde na přesný backend origin a nikdy jinam; základní Studio
   HTTP cesty nevracejí boundary `403`;
   `503` nikdy jako assistant (dnes `chat-panel-module.js:6125` nekontroluje
   `response.ok`); cancel A neovlivní B; pozdní assistant po cancelu odmítnut;
   každá terminal větev vypne spinner; jen explicitní `invalidIds` z úplného
   ACK nad durable storem zruší syntakticky platnou identitu, history `404` ji
   zachová a lokálně malformed identita zůstane se snapshotem quarantined;
   matching reject degraduje ihned, cizí/replayed reject neukončí aktuální běh;
   clean build dá stejné runtime chování; bounded soak a řízený shutdown bez
   renderer/GPU crashu. Clean-clone protocol output smí před prebuildem chybět;
   po něm musí být ignored/untracked, exportovat M1 a tracked strom zůstat čistý.
7. **Autonomie:**
   - `BLOCK`: build přepisuje nebo maže dnešní UX; potřeba nové browser test
     dependency; změna connectoru; zatažení effect/auto-exec scope.
   - **D-6 je potvrzené rozhodnutí, ne otevřený DECIDE:** relokace se
     neprovádí, commitnutý chat-panel `lib` zůstává autoritativní a již
     implementované ochrany `build`/`clean` se zachovají. Archivovaný TypeScript
     ani neexistující chat-panel `tsconfig` nejsou implementační plocha;
     případná relokace je vlastní pozdější behavior-preserving WP.
   - `DECIDE` **D-7 reconnect backoff:** default = fixní strop a viditelný stav,
     ne tiché nekonečné opakování. Šev: `ws-client.js:_scheduleReconnect()`.
   - **M1-CLOSEOUT-X1 built envelope:** použij fresh disk clone `--no-local`,
     offline/frozen install, forced protocol prebuild a production build.
     Nespouštěj standalone chat-panel build/clean. Trackovaný strom musí zůstat
     čistý a build/bundle digesty se uloží do immutable manifestu.
   - Povolené prostředí je scoped X11 a user/network namespace s loopback-only
     přístupem. Nad jedním buildem proveď negotiated inline attachment, dva
     panely, cancel A/success B, provider failure, reconnect, server
     restart/rehydrate, operation rollback a 65s soak. Počet external a
     unexpected-loopback requestů je nula.
   - Tentýž build musí získat dva po sobě jdoucí nezávislé PASS. Hidden retry a
     disable-GPU workaround jsou zakázané. `SIGTRAP` je `FAIL` a diagnostický
     finding, nikoli environmentální PASS.
8. **Ověření:** `node tests/ws-bridge.test.js`,
   `node tests/m1-studio-client.test.js` (nový); v čistém klonu frozen Yarn
   install, build a registrovaný Studio journey. **Build neběží v dirty
   checkoutu.** Runtime potřebuje skutečný X11/Wayland displej — když není,
   je to `PARK`, ne produktová vada.

---

### B5 — WP-M1-QUALITY

> Integrační vlastník. Běží až po REVIEW GATE 1.

1. **Výsledek:** `ResponseFinalizer` je jediný refinement owner. Synthesis smí
   scoreovat, ale nesmí spustit refinement; na jeden turn je nejvýše jeden
   refine provider call. Přidaná hodnota, cena i latence jsou změřené.
2. **Povolené:** synthesis, `src/chat/quality/**`, quality telemetrie, převzatý
   `response-finalizer.js`, fixní corpus, M1 quality testy, registry, decisions.
   **Zakázané:** connector, gateway, routes, WS, Studio.
3. **Connector:** pouze čte přijaté Model/Conversation výsledky.
4. **Závislost:** přijaté B2, B3, B4.
5. **Demo:** corpus se zmrazí před prvním outputem a má přesně 12 případů,
   `8 CS + 4 EN`. A/B použije stejný exact model/digest a `num_ctx=4096`, jeden
   baseline na případ a žádný reroll. Report obsahuje sample výsledky, p50/p95,
   delta, acceptance, tokeny, latency a reject reason včetně jednoho konkrétního
   přijatého a jednoho odmítnutého refinementu.
6. **Test:** fake model pro skip, právě jeden refine, zlepšení, semantic drift,
   horší/prázdný výsledek, provider error, cancel. GPU A/B reportuje p50/p95,
   score delta, acceptance rate, tokeny a dobu.
   Pokrýt vadu #7 z call grafu: synthesis i finalizer dnes mohou spustit vlastní
   refinement a telemetrie je nerozliší.
7. **Autonomie — předem přijaté automatické rozhodnutí:** `KEEP-LIMITED` platí
   jen pokud současně:
   - je nula semantic/correctness/code-invariant regresí;
   - median accepted score delta je nejméně `5/100`;
   - corpus-wide delta je `>= 0`;
   - acceptance rate je nejméně `25 %`;
   - je nula false-success, cancel nebo duplicate-call vad.

   Jinak se refinement pro M1 vypne. Ambiguous metrika znamená vypnout, nikoli
   další rozhodovací kolo. QGv2 deterministic scoring zůstává beze změny.
   Změna connectoru nebo nebezpečná GPU prerekvizita zůstává stop condition.
8. **Ověření:** `node tests/improvement-loops.test.js`,
   `node tests/chat-output-quality.test.js`,
   `node tests/chat-synthesis-hardening.test.js`,
   `node tests/m1-quality-contract.test.js` (nový); GPU A/B jen sériově.

---

### B6 — M1-JOURNEY (exit demonstrace)

> Není to nový WP, je to integrační ověření. Zapisuje jen do dokumentace,
> testů a artefaktů.

1. **Výsledek:** všech sedm povinných scénářů z `ROADMAP.md` §5 proběhne bez
   `PARK` nad jedním fresh buildem a jedním immutable manifestem.
2. **Povolené:** `tests/m1-journey.test.js` (nový), `ROADMAP.md` a `SYSTEM-MAP.md`
   stavové řádky, `docs/execution/**`, registry, artefakty.
   **Zakázané:** jakýkoli produktový soubor. Když journey najde vadu, je to
   `FINDING`, ne oprava.
3. **Demo:** Phase A spustí Electron v loopback-only namespace s test-owned
   providerem. Phase B použije tentýž build proti exact `127.0.0.1` Ollamě.
   Dohromady: čistá instalace → Theia → konverzace → deterministická i modelová
   odpověď → restart → obnovený stav.
4. **Měření k zápisu, ne k odhadu:** deterministic p95 `<100 ms`, cold/warm
   whole-response latence odděleně, p95 modelového chatu, throughput,
   refinement delta, false-success `0` a unexpected outbound `0`.
5. **Autonomie:** journey se **nesmí** prohlásit za PASS s parkovanou položkou.
   Chybějící scénář = M1 zůstává `PARTIAL` a to se tak i zapíše. User DB,
   projects a config musí zůstat beze změny a shutdown čistý. Produktová vada
   nalezená v B6 je finding; journey subject nesmí obsahovat produktovou opravu.
   Streaming zůstává mimo M1.

---

### P1 — M2-EFFECT-TRACE (paralelní, read-only)

> Můžeš běžet kdykoli souběžně s B1–B6. **Nikdy nezapisuješ mimo
> `docs/inventory/2x-*.md` nové soubory a `docs/findings/`.** Nesaháš na osm
> rozpracovaných inventur.

1. **Výsledek:** skutečný import/call graph efektových cest (#11 sandbox/patch/
   Git/test/rollback, #16 tools, #13 governance) jako vstup pro `WP-M2-EFFECT`.
2. **Otázky k zodpovězení evidencí, ne názorem:**
   - kudy dnes vzniká zápis na disk, exec a network efekt, a kde je (nebo není)
     kontrolována authority;
   - které cesty obcházejí approval a jakým konkrétním voláním;
   - kde je dnes path traversal ověřen a kde ne;
   - jaké orphan stavy zůstanou po cancel/timeout/kill/restart.
3. **Výstup:** jedna nová inventura + rozhodovací podklad pro
   `EffectRequest/Result` a `ApprovalGrant` — **návrh schématu, ne implementace**.
4. **Autonomie:** vše je `FINDING` nebo podklad. P1 nikdy nic neopravuje.

---

## 5. Review gates

### GATE 1 — po přijatých 026+029+B3+B4

Operátor dostane jeden balík:

- `docs/execution/runs/` reporty z pěti subjectů: 026, samostatný 029 chats
  decommission, samostatný 029 reset, B3 a B4. High-level krok 029 tedy
  přispívá dvěma sériovými reporty, nikoli jedním sloučeným;
- **rozhodovací frontu** — očekávaně D-1 až D-7 plus co přibylo; každé
  s evidencí, defaultem a cenou přepnutí;
- seznam findingů s vlastníky;
- seznam commitů a `git log --stat` proti base SHA;
- výsledek povinné baterie a fingerprint registry.

Operátor rozhoduje: potvrdit nebo přepnout každý `DECIDE`; odblokovat `BLOCK`;
schválit `PARK` nebo poslat zpět. Teprve pak se pouští B5.

**Stav 2026-08-08:** operátor zvolil všechny varianty 001–014. „Odblokovat“ zde
neznamená změnit štítek dokumentu: 006, 009–012 a 014 zůstávají implementačně
`BLOCKED`, dokud neprojdou jejich pojmenované důkazy. B5 se proto ještě
nespouští.

### GATE 2 — M1 exit, po B5+B6

Navíc:

- naměřená L3 čísla proti cílům `ROADMAP.md` §5;
- automatický B5 výsledek `KEEP-LIMITED` pouze při splnění všech přijatých
  prahů, jinak refinement pro M1 vypnutý, vždy s daty;
- journey artefakty;
- návrh stavového řádku M1 v `ROADMAP.md` a `SYSTEM-MAP.md` **k odsouhlasení**,
  ne už zapsaný jako hotový.

---

## 6. Odchylky od `ROADMAP.md` — k potvrzení před spuštěním

| # | Odchylka | Důvod |
|---|---|---|
| **O-1** | Roadmapa §5: „`tests/registry.json` … upravuje jen integrační vlastník". Tato dávka dává běžícímu sériovému WP úzkou výjimku změnit `tests/registry.json` a ve stejném commitu regenerovat `docs/convergence/TEST-REGISTRY.md` přes `--write-doc`. | Pravidlo brání konfliktu mezi souběžnými zapisovateli. Při sériovém běhu je běžící WP jediný zapisovatel, takže konflikt nemůže vzniknout — a bez kanonického záznamu i odvozeného ledgeru shodí `validate-test-registry.js` povinnou baterii. |
| **O-2** | Roadmapa §12: „Agent zastaví dotčenou část při … nejasnosti." Protokol §1 část nejasností převádí na `DECIDE` s vratným defaultem. | Bez toho dávka neběží déle než jeden WP. Omezeno podmínkou švu a povinným vyčíslením ceny přepnutí; `CONTRACT.md` §7 zakázané kategorie (L0, connector, scope, open source) zůstávají tvrdý `BLOCK`. |
| **O-3** | Dávka nepokrývá M2. | M2 WP konzumují connectory, které ještě neexistují. Místo toho běží P1 read-only. |
| **O-4** | B4 bod 6 po Gate 1 nevyžaduje WS/HTTP send parity; vyžaduje WS send + explicitní fail-closed `NOT_SENT` stav. | Call graph prokázal, že legacy `/chat` fallback může provést filesystem/tool efekt bez společné authority. Operátor schválil 011/A nyní a 011/C až v M2; původní parity claim se nesmí vydat za splněný. |

---

## 7. Co tahle dávka **nezaručí**

- Že M1 skončí zeleně. Klidně skončí `PARTIAL` s pojmenovanými dírami — a to je
  správný výsledek, ne selhání dávky.
- Že nebudou potřeba rozhodnutí dřív než na GATE 1. `BLOCK` je reálná možnost;
  když padne brzy, dávka pokračuje dalším briefem a gate přijde dřív.
- Stabilitu Studia, dokud není dostupný displej pro bounded soak.
