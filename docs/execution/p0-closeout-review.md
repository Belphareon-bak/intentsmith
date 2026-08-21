# Zadání — nezávislé review P0 closeoutu

**Určeno pro:** recenzenta, který tenhle kód nepsal
**Větev:** `wp/mobile-prototype-20260817` · **remote:** `origin` (`Belphareon-bak/intentsmith`)
**Rozsah:** `25c61a96` … `f5289d2e` (13 commitů)
**Worktree:** `/home/belphareon/worktrees/is-mobile-prototype`

> **Proč to existuje.** Předchozí review skončilo `CHANGES_REQUIRED` se dvěma
> `P0` blokátory. Commit `25c61a96` je má opravovat. **Nikdo to od té doby
> nepotvrdil**, a na tom verdiktu visí otevření balíku `M2`
> ([`approval-mediation.md`](approval-mediation.md)) — velké práce, kterou by
> nepotvrzený základ mohl poslat k přepracování.

---

## 1. Hlavní otázka

**Zavírá `25c61a96` oba `P0` blokátory z předchozího review?**

| # | Nález | Kde se to má projevit |
|---|---|---|
| 1 | `fs.write` ignoroval zrušení — po abortu zůstal approval čekat, pozdější schválení vyrobilo soubor `SHOULD-NOT-WRITE` | `src/tools/registry.js` (`fs.write.execute`) |
| 2 | `EFFECT_STOP_UNKNOWN` se ztratil v klasifikaci a stal se retryable `TIMEOUT`, takže auto-retry mohl spustit druhý efekt | `src/executor/tool-executor.js` (`classifyError`, `executeWithTimeout`) |

Plus nesoulad: příchozí `turnId` se nahrazoval novým UUID
(`src/chat/controller.js`).

---

## 2. Kde se nedívat na moje slovo

Tenhle balík má **doloženou historii nadhodnocených tvrzení**. Třikrát jsem
ověřil jednu vrstvu a prohlásil vlastnost celé cesty; pokaždé to našel někdo
jiný:

| Tvrzení | Co bylo špatně | Našlo |
|---|---|---|
| „zrušení zastaví zápis" | `guardedWrite` ho respektoval, ale handler ani nástroj signál nepředaly | review 1 |
| „`fs.write` jde řízenou cestou, takže se ptá" | jednoargumentové volání mu nedalo signál ani běh | review 2 |
| „telefon uvidí `run.unknown`" | rámec neprošel validací kontraktu **a** projekce nemá volajícího | review 3 |

**Doporučení: nejostřeji zkoumej tvrzení o chování „od konce ke konci".**
Jednotkové testy v tomhle repu bývají v pořádku; slabina je mezi vrstvami.

Konkrétně stojí za samostatné ověření:

- předává **každé** volací místo `signal` i `runId`? (`chat/handlers/file.js`,
  `executor/tool-executor.js`, `tools/registry.js`)
- projde **každý** vyzařovaný rámec `validateConversationResult`?
- dělá politika zápisu to, co dokument tvrdí, i pro cestu **mimo pracovní
  strom**, kde `canonicalTarget` vrací absolutní cestu?

---

## 3. Co tvrdím, že platí — a čím to má být doložené

| Vlastnost | Důkaz, který nabízím |
|---|---|
| zrušení zastaví efekt v obou cestách | `effects-p0-regressions` `A1`, `C1` |
| timeout efekt **zastaví a počká** na konec | `A2` |
| osiřelý efekt není retryable timeout | `C2` |
| osiřelý rámec projde kontraktem | `C4` |
| příchozí `turnId` se zachová | `C3` (behaviorálně i strukturálně) |
| běžný zápis se **neptá** | `write-policy` — deset zápisů, nula approvalů |
| úklid nesebere živý proces | `approval-lifecycle` `M1-b` ×6 |
| konfliktní větve nesou co/kdy/kdo | `multi-device-approvals` |
| propadlý ≠ zamítnutý člověkem | `mobile-ms14-decision`, `desktop-approval-ui` |

**Citlivost sady `effects-p0-regressions` je ověřená** proti `6e948d6e`: část
tam selže, část **zůstane viset** (proto mají lhůty). Jednotkové `A1`/`A2` tam
prošly i před opravou — je to napsané v hlavičce sady a je to přiznání, ne
detail.

---

## 4. Co už vím, že neplatí — nehledej to jako nález

Aby se review nespotřebovalo na věci, které jsou pojmenované:

1. **`M1` nemá slovo pro „nevím".** Osiřelý běh se hlásí jako `error`
   s `EFFECT_ORPHANED`. Rozšířit zmrazený enum je změna kontraktu (`DR-008`).
   Detail: `WP-APPROVAL-PLANE-RESULT.md` §7.5.
2. **`projectCoreEvent` nemá v `src/` volajícího** — projekce běhů na telefon
   není zapojená vůbec.
3. **Slib pokrývá jen `FILE_WRITE` a `fs.write`.** Patch engine, skill write,
   code-cleaner a dalších ~50 zápisů jdou mimo. To je `M2`.
4. **Mikrointerval** mezi poslední kontrolou a `rename` není pokrytý — přijatá
   praktická síla slibu (`rozhodnutí 024` §5.1).
5. **`P0-3` fyzická device matice je `NOT RUN`** — chybí telefon, ne kód.
6. **Čtyři trvale červené sady** (viz §5) — nejsou v rozsahu.

---

## 5. Jak to spustit, aby výsledek něco znamenal

```bash
cd /home/belphareon/worktrees/is-mobile-prototype
git log --oneline -1                   # f5289d2e
ls node_modules | wc -l                # když 0 → npm ci --offline
rm -rf .intentsmith-artifacts/direct-tests
npm run test:deterministic             # ~9 min
```

**Tři věci, které umí výsledek zfalšovat:**

1. **Neupravuj strom, dokud gate běží** — runner kontroluje čistotu gitu
   u každé suity a špinavý strom hlásí `FAIL` s `exit 0`.
2. **Smaž `.intentsmith-artifacts/direct-tests/`** — je gitignorovaný, takže
   `git status` o něm mlčí, ale `harness-exit-code` vyžaduje prázdno.
3. **Srovnání proti base dělej přes `git worktree add`**, ne `checkout` +
   `stash`.

**Očekávaný výsledek: `252 PASS / 4 FAIL / 3 BLOCKED`.** Čtyři `FAIL` jsou
předchozí, ověřené spuštěním na `5c5413e4`:
`m1-model-failover-schema` · `nightly-orchestrator-self-test` ·
`vram-coordination` · `nightly-audit-runner-self-test`.

Cílené sady:

```bash
node tests/effects-p0-regressions.test.js    # 21
node tests/write-policy.test.js              # 11
node tests/approval-lifecycle.test.js        # 16
node tests/multi-device-approvals.test.js    #  8
node tests/desktop-approval-ui.test.js       # 13
node scripts/module-boundary-ratchet.mjs     # PASS 1081/1081
npm run test:mobile                          # 36/36, 1 withheld
```

---

## 6. Co od verdiktu potřebuju

- **`PASS`** → otevírá se `M2` podle [`approval-mediation.md`](approval-mediation.md).
- **`CHANGES_REQUIRED`** → seznam s reprodukcí. Sondy z předchozích review byly
  cenné právě tím, že ukázaly soubor na disku; čtení kódu odhalilo míň.
- Pokud je nález ve věci z §4, řekni to — možná jsem ji podcenil, ale ať se to
  neplete s novým nálezem.

**Nepotřebuju souhlas se seznamem otevřených věcí.** Ten je v dokumentech;
opakovat ho jako nález nic nepřidá.
