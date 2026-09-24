# GPU hunt M0 — rozhodovací metoda, plánovač a σ z reálných dat

24. 9. 2026 · větev `work/hunt-decision-m0` · **PLANNING_EVIDENCE / NO_BINDING_CHANGE**.

## Co je hotové

| Část | Soubor | Co dělá |
|---|---|---|
| Metoda | `src/eval/decision-methods.js` | Přesná Studentova kvantilová funkce (shoda se scipy na 1e-6) a párový t-interval nad nezávislými skupinami. Pod 10 skupin vrací nerozhodný rozsah [−1, 1]. |
| Zapojení | `src/eval/code-pilot-decision.js` | `plan.decision.method` volí `hoeffding-kl-bounded-groups` nebo `paired-t-groups`. Metoda je součástí zapečetěného hashe plánu; staré KL plány se nemění. Platí pro CODE i `role-operational-decision.js`. |
| Plánovač | `src/eval/decision-feasibility.js` | Přes skutečný rozhodovací interval simuluje sílu, chybné přijetí na obou hranicích, potřebný počet skupin, nejmenší zjistitelný rozdíl (MDE) a podíl **škodlivých výměn** (kandidát není lepší). Rozdíly převzorkuje z reálných párů modelů. **Kalibruje α** na datech role a ověří ji na nezávislých simulacích. Verdikt: `FEASIBLE` / `EXPLORATORY_ONLY` / `METHOD_UNSAFE`. |
| Měření σ | `scripts/hunt-decision-feasibility.mjs` | Z evaluační DB (jen čtení) vezme poslední ohodnocený běh každého modelu na nejširší sadě role, spočítá rozdíly po skupinách pro všechny páry i páry se současným bindingem a pustí plánovač. |

Testy: `tests/decision-methods.test.mjs` 8/8. Stávající `pairwise-trial` 49/49,
`evaluation-grading-acceptance` 17/17 a `artifact-validation` 160/160.

```bash
node scripts/hunt-decision-feasibility.mjs --also-groups=20,60,100 --out=feasibility.json
```

Evidence: `/mnt/vi7000/intentsmith/evidence/hunt-decision-m0-20260924/feasibility.json`
(2 000 simulací na buňku, seed 20260924, deterministické).

## Výsledek na reálných datech (páry se současným bindingem)

MDE je nejmenší skutečné zlepšení, které plán zachytí s 80% silou.
„Škodlivá výměna“ = jak často by plán vyměnil model, který ve skutečnosti není lepší.

| Role | Sada | Skupin | σ | Škodlivá výměna | Dnes | 60 skupin | 100 skupin |
|---|---|---|---|---|---|---|---|
| CHAT | chat_v3 | 40 | 0,17 | 0,1 % | α 0,02 · MDE 0,13 · průzkum | α 0,015 · MDE 0,11 · průzkum | α 0,02 · MDE 0,10 · **rozhodne** |
| D1 | reasoning_v2 | 12 | 0,25 | 1,5 % | bezpečná α neexistuje | MDE 0,15 · průzkum | MDE 0,13 · průzkum |
| D2 | reasoning_v2 | 12 | 0,32 | 4,0 % | bezpečná α neexistuje | MDE 0,19 · průzkum | MDE 0,15 · průzkum |
| R1 | reasoning_v2 | 12 | 0,33 | 5,1 % | bezpečná α neexistuje | MDE 0,20 · průzkum | MDE 0,17 · průzkum |
| R2 | review_v2 | 10 | 0,36 | 0,8 % | MDE 0,41 · průzkum | MDE 0,17 · průzkum | MDE 0,14 · průzkum |
| CODE | code_patch | 7 | 0,50 | – | pod minimem 10 skupin | MDE 0,28 · průzkum | nestabilní |
| VISION | vision_v2 | 5 | 0,05 | – | pod minimem 10 skupin | MDE 0,18 · průzkum | MDE 0,15 · průzkum |

**Stávající KL mez má ve všech rolích a velikostech sílu 0.** S ní hunt nikdy nic
nevymění. Ukázka proti živým bindingům (`demo` v JSON):
- KL nerozhodne ani u zjevně nevhodných modelů.
- Kalibrovaný t na CHAT (40 skupin) správně vrátí PONECHAT pro llava (−0,13 a −0,14).
- qwen3.8 i qwen3.6 jsou proti qwen3.5 v intervalu přibližně ±0,03, tedy na `chat_v3` rovnocenné. Tato sada rozdíly mezi nejlepšími modely nerozliší.

## Co z toho plyne

1. **Metoda a plánovač fungují.** Kalibrace je nutná, protože nominální t na reálných, převážně nulových rozdílech s občasnými propady pouští ~5 % chybných přijetí místo 2,5 %. Po kalibraci je u CHAT škodlivá výměna 0,1 %.
2. **CHAT jde pilotovat hned.** Se 40 skupinami rozhodne velké rozdíly (≥ 0,13) a odmítne nevhodné kandidáty. Na rozdíly kolem 0,10 je potřeba ~90–100 skupin.
3. **Ostatní role brzdí velikost sad, ne metoda.** Pro D1/D2/R1 (12 skupin) neexistuje bezpečná α, CODE a VISION jsou pod minimem. Plánovač to hlásí dřív, než se cokoli sbírá.
4. σ pochází ze starších sad (`chat_v3` je hodnocená regexovým checklistem). Nová konverzační CHAT sada (20 skupin) může mít jiné σ. Po ohodnocení se změří stejným skriptem.

## Nejmenší další krok

- **CHAT:** rozhodovat nad `chat_v3` (40) + konverzační sadou (20) = 60 skupin, s kalibrovanou α.
  - Chybí jen hodnocení konverzační sady. Stačí jednorázově dodat skóre po úlohách do stejné DB.
  - Pak jeden pilotní paired run qwen3.8 proti qwen3.5.
- **Ostatní role:** plánovač určí, kolik rozlišujících úloh je potřeba. Dokud je nemají, zůstanou v průzkumu.

## Pilot CHAT (24. 9. večer): skóre konverzační sady v DB a rozhodnutí na 60 skupinách

**Hodnocení.**
- Opakování 1 konverzačního panelu: 400 rozhovorů, 10 modelů × 40 úloh, 1 600 známek po kritériích.
- Hodnotil přechodný externí hodnotitel (Opus) naslepo podle rubriky `chat-conversation.2-draft`, váhy 0,4/0,3/0,2/0,1.
- Dva rozhovory přerušené infrastrukturou nahradilo opakování 2.
- Striktní JSON je ohodnocený mechanicky.
- Známky: `/mnt/vi7000/intentsmith/evidence/hunt-chat-panel-20260923/opus-grading-20260924/grades.jsonl`.
- **Shoda s nezávislými ručními známkami GPT** na 59 společných dialozích: 88 % kritérií ±0,25, korelace 0,72.
- Systematický rozdíl: doslovná citace podvrženého pokynu (přísnější Opus) a diagnostika (přísnější GPT). Jsou to kandidáti na rozsouzení.

**Zápis.**
- `scripts/manual/import-chat-conversation-grades.mjs` přes `ModelEvaluationHistory.recordComplete` zapsal sadu `chat_conversation_pilot`, kontrakt `bf780068…`.
- Postup: záloha DB → zkušební zápis do kopie → ověření čtecím modelem živé release (`72247a49`) → zápis do živé DB → znovu ověřeno.
- Metadata `externalGrading.status = EXTERNAL_INTERIM_NOT_ACCEPTED`, `decisionAuthority:false`. Název sady se neshoduje s plánem role, takže běžící hunt z řádků autoritu nebere.
- Záloha: `/mnt/vi7000/intentsmith/evidence/hunt-decision-m0-20260924/db-backups/`.

| Model | Konverzační skóre | Rozdíl proti qwen3.5 (20 skupin) |
|---|---|---|
| qwen3.8 | 0,953 | +0,069 |
| gemma4:26b | 0,921 | +0,036 |
| qwen3.6:27b | 0,909 | +0,024 |
| qwen3.5:27b (současný) | 0,884 | 0 |
| ornith-1.5:9b | 0,863 | −0,021 |
| qwen3-30b-a3b | 0,802 | −0,082 |
| qwen3:14b | 0,764 | −0,121 |
| qwen3-coder | 0,745 | −0,139 |
| devstral-small-2 | 0,666 | −0,218 |
| phi4:14b | 0,649 | −0,235 |

**Rozhodnutí (kalibrovaný párový t, α = 0,02, `chat_v3` + konverzace = 60 skupin, jen shodné digesty).**
- σ proti současnému modelu je 0,166. Na 60 skupinách: MDE 0,114, škodlivá výměna 0 %.
- Pro rozhodnutí o zlepšení +0,10 je potřeba ~94 skupin.
- qwen3.8 proti qwen3.5: +0,024, interval [−0,009; +0,058].
  - Přínos 0,04 **neprokázán**.
  - **Nezhoršení prokázáno** i při toleranci 0,02.
  - Zrychlení na shodných voláních panelu **1,62×** (p50 4,1 s proti 7,3 s).
  - Podle druhé cesty kontraktu (`SPEED_WITH_NONINFERIOR_QUALITY`) tedy **ZMĚNIT**, jako pilotní doklad bez autority.
- qwen3.8 zároveň splňuje navržené CHAT brány: citovaný pokyn 6/6 odmítnut, žádný únik. qwen3.5 česky pokyn převzal (3/3).
- gemma4 a qwen3.6 mají na stejném digestu jen 20 skupin, takže rozhodnutí je nerozhodné. qwen3.6 navíc česky převzal podvržený pokyn.

**Konflikt sestavy.**
- Živé bindingy už dávají qwen3.8 role D2, CODE a R1.
- CODE+R1 je podle dnešní `independentRolePairs` zakázaná dvojice, takže dnešní stav pravidlo porušuje.
- Přidání CHAT by znamenalo čtyři role.
- Výměnu CHAT je proto nutné řešit spolu se sestavou (M5).

**Omezení.**
- Hodnotitel není přijatý (jeden externí hodnotitel, ne dvojice).
- Panel běžel bez produkčního systémového promptu a s `think:false`.
- Rychlost je měřená v podmínkách panelu.
