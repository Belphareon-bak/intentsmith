# Nezávislý verdikt k nasazené verzi IDE `37ee6177` (publikováno `688b2cd3`)

Napsáno pro: ROOT/workera (Codex), předává operátor. Revizor: nezávislý Claude (Opus), 10. 10. 2026 ~15:00.
Navazuje na `review-integration-230f657f.md` (můj) a `review-integration-c47d1883.md` (souběžný revizor, N1–N8).

**Verdikt: TECHNICKY PŘIJATELNÉ PRO LOKÁLNÍ PROVOZ / bod f) NESPLNĚN / release NOT_ACCEPTED.**
Všechny dřívější technické nálezy jsou opravené a nic jsem nerozbil reprodukcí. Otevřené zůstává rozhodnutí o bodu f)
a provozní podmínky níže.

## Co jsem sám ověřil

- Worktree `688b2cd3`; aplikační kód totožný s nasazeným `37ee6177` (diff `src/`, `intentsmith-ide/`, `tests/` prázdný).
- Node 24, `bwrap --unshare-net`, IDE balíčky přes relativní `@intentsmith` odkazy: 27 dotčených sad **všechny PASS**,
  včetně `studio2-live-model`, `desktop-hunt`, `ide-workspace` (dřívější „media WS“ selhání byla jen past symlinku).
- Census, `test:registry`, `module-boundary-ratchet`, `git diff --check`, sonda výpadků chatu 7/7 — PASS.
- Sonda CHAT rolí: kontext 4096 → 422 `IDE_CONTEXT_TOO_SMALL` (minimum 8192, česká hláška); 8192 s výstupem 1024 i 32 →
  zpráva 2000 znaků dojde k poskytovateli (`num_ctx 8192`), klasifikace drží `num_predict 256` + JSON formát. **N1, P2-1 opraveno.**
- Živá sonda BE+FE: disky bez duplicit, `temp` DB pryč; remote s tokenem → `REMOTE_DENIED`, únik 0; web URL jen pro bezpečné
  hosty; větve podle aktivity, detail commitu, compare souboru, neplatný ref odmítnut; Hunt ve frontě s důvodem
  `HUNT_STATUS_UNAVAILABLE` (**N6 opraveno**); účet uložen + readback; zkouška doručení bez credentials poctivě neověřena.
- V kódu: role mají český název a účel (`ROLE_INFO`), interní `CALL_SITE_AND_AUTH_TOKEN_CEILING` ani „ID profilu“ v UI nejsou,
  `refine` nyní limit odpovědi respektuje (kromě JSON) — **moje nálezy 2–4 opraveny**.
- Snímek skutečného hlavního okna (`primary-models-overview.png`): lidské role, obnovené vazby, nastaveno × ověřený HW odděleně.

## Otevřené

1. **Bod f) — rozhoduje operátor.** 31 starších polí je zašedlých s poctivou poznámkou „zatím nemá účinek“, kontext a délka
   odpovědi odkazují na Role. Je to pravdivé, ale bod f) („aktivovat a otestovat“) to nesplňuje a 31 neaktivních polí zaplevelí
   nastavení. Doporučuji pole odstranit, nebo z mého seznamu v `review-integration-230f657f.md` napojit ta, která mají smysl
   (kompakce, desktopová oznámení a tichý čas, vykreslování výstupu), každé s testem účinku.
2. **Místní skóre je v hlavní instalaci u všech rolí „—“**, ačkoli DB má 1012 evaluačních běhů. UI bere jen běhy `COMPLETE`
   pro aktuální digest; pokud jde o běhy čekající na posouzení nebo jiné digesty, je „—“ správně, ale UI by mělo rozlišit
   „neměřeno“ od „čeká na posouzení“ / „změřeno pro jiný digest“. Ověřit na provozních datech (čtecím API) a doplnit vysvětlení.
3. **GPU/NVML na stanici:** `nvidia-smi` hlásí *Driver/library version mismatch* — načtený jaderný modul 595.91.07, knihovny
   595.99.02; DKMS modul 595.99.02 pro běžící jádro je na disku. Inference přes CUDA běží (Ollama 14:05 na CUDA0), ale NVML,
   GPU guard a Hunt ne. Náprava: restart stanice (backend je `enabled`), pak znovu `gpuProbe`.
4. **Soak:** 24h soak `138e958b` nedoběhl (poslední heartbeat 01:42 = 22,0 h, 0 chyb, pak proces zanikl bez výsledku; waiter
   06:42 `BOUNDED_WAITER_EXPIRED`). Pro release je potřeba nový soak na finálním kandidátu; příčinu zániku doporučuji
   dohledat (okno se kryje s celými testovými běhy 01:26–02:12).
5. Bez změny: skutečné doručení Discord/Telegram, GPU Hunt, HW strop kontextu, formální Gate 0 a přejímka operátora.
