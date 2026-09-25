# Studio 2.0 — správa zdrojů (git)

Stav: návrh konektoru k [Decision 049](../decisions/049-studio-2-ui-and-source-control.md)
D3/D4, etapa S2-6 [WP-STUDIO-2](../wp/WP-STUDIO-2-20260925.md).

## 1. Co už existuje

| Kde | Co dělá | Použití |
|---|---|---|
| `src/planner/project-onboarding.js` `initializeNewProject` | nový projekt: `git init --template= -b main`, první commit; prostředí bez `GIT_*`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `core.hooksPath=/dev/null` | **vzor bezpečného spouštění gitu** pro celý konektor |
| `src/routes/projects.js` `GET /api/workspace/git-status` | `status --porcelain`, aktuální větev | nahradí `GET /api/scm/status`; původní cesta zůstane do vyřazení starého UI |
| `src/architect/git.js` `GitManager` | `spawn('git', args, {shell:false})` | legacy Architect; nepoužívat přímo, jen jako vzor argv |
| `src/tools/registry.js` `git.status`, `git.commit` | nástroje agenta přes `execSync` se shell řetězcem | mimo tento WP; sjednocení na stejný provider je samostatná úprava nástrojů (inventura #16, T-1) |
| `intentsmith-ide/extensions/intentsmith-git-integration` | node služba (branch info, auto-commit) | nahradí se tímto konektorem |

Otevřená existující složka (`POST /api/projects/open-folder`) git mít nemusí;
nový projekt ho má vždy.

## 2. Politika projektu

Uložená v DB s CAS revizí a append-only auditem (vzor migrace 117). Mění se
jen `PUT /api/scm/policy`, nikdy obecným nastavením.

| Klíč | Hodnoty | Výchozí | Význam |
|---|---|---|---|
| `init` | `automatic` / `ask` / `disabled` | `automatic` | Nový projekt git dostane (dnešní chování). Otevřená složka bez gitu: `ask` nabídne init, `automatic` ho provede, `disabled` nic. |
| `commit` | `ask` / `automatic` / `disabled` | `ask` | `automatic` smí po schválené M2 změně vytvořit commit s popisem z plánu. |
| `branch` | `ask` / `disabled` | `ask` | Zakládání a přepínání větví. |
| `fetch` | `automatic` / `ask` / `disabled` | `disabled` | Síť; `automatic` jen s povoleným hostitelem, interval nejméně 5 minut. |
| `pull` | `automatic` / `ask` / `disabled` | `ask` | Vždy `--ff-only`. `automatic` jen s povoleným hostitelem a čistým stromem. |
| `push` | `ask` / `disabled` | `ask` | Nikdy automaticky. |
| `remotes` | seznam `{name, host}` | prázdný | Síťové operace jen na tyto hostitele (L0-12). |

## 3. Čtení (bez efektu, bez sítě)

| Endpoint | Vrací |
|---|---|
| `GET /api/scm/status?projectId=` | `isRepo`, větev, upstream, ahead/behind **z posledního fetch** (s časem), soubory `staged` / `unstaged` / `untracked` / `conflicted` s +/− řádky |
| `GET /api/scm/branches?projectId=` | lokální a vzdálené větve, aktuální, upstream |
| `GET /api/scm/log?projectId=&limit=&ref=` | commity pro graf: hash, rodiče, refs, autor, čas, předmět |
| `GET /api/scm/diff?projectId=&path=&staged=` | hunky pro jeden soubor (limit velikosti jako `/api/workspace/file`) |
| `GET /api/scm/policy?projectId=` | politika a revize |

Čtení nikdy nespustí `fetch`, hook ani credential helper.

## 4. Zápis a síť — efekty

Stejný tvar jako `/api/development/*`:

1. `POST /api/scm/prepare {projectId, op, args}` → uložený plán: `planId`,
   `digest`, operace, přesné soubory / zpráva / cílová větev / remote a
   hostitel, verze politiky. Příprava nic nemění.
2. `POST /api/scm/execute {planId, digest, confirm: true}` — doslovné `true`,
   digest musí sedět. U politiky `automatic` smí provedení vyvolat i služba,
   ale se stejným plánem a auditem.
3. `POST /api/scm/cancel {planId}`; `GET /api/scm/operations?projectId=`.

| `op` | Efekt | Kontroly před provedením |
|---|---|---|
| `init` | vytvoří `.git` | politika `init`; cesta patří registrovanému projektu |
| `stage` / `unstage` | index | soubory uvnitř projektu |
| `commit` | nový commit | neprázdný index nebo výslovné `all`; žádný běžící M2 zápis v tomtéž projektu; zpráva 1–4 000 znaků |
| `branch.create` | nová větev | platný název (`git check-ref-format`) |
| `checkout` | přepnutí větve | čistý strom, jinak blokováno (stash v1.0 není) |
| `fetch` | síť | hostitel v `remotes`, M5 outbound audit |
| `pull` | síť + zápis | `--ff-only`, čistý strom, žádný běžící agent v projektu; při rozcházení historie blokováno s vysvětlením |
| `push` | síť | hostitel v `remotes`; nikdy `--force`; jen aktuální větev na její upstream |

Bezpečné spouštění pro všechny operace: argv bez shellu, prostředí jako
v `initializeNewProject` (bez `GIT_*`, bez systémové a globální konfigurace,
`core.hooksPath=/dev/null`), timeout. Pro síťové operace se připouští jen
uživatelův SSH agent nebo credential helper; IntentSmith credentials neukládá
ani neloguje. Jedna zápisová operace na projekt najednou; zámek sdílený
s M2 prováděním.

## 5. UI v pravém panelu (záložka Správa zdrojů)

Uspořádání podle VS Code, vzhled podle [UI-SPEC](UI-SPEC.md) §7:

- **Hlavička:** výběr větve (seznam, hledání, „Nová větev…"), tlačítko
  synchronizace s počty ↓ behind / ↑ ahead a časem posledního fetch, stav
  automatického pullu.
- **Zpráva commitu** a tlačítko **Potvrdit (commit)** s nabídkou „Commit a push".
  Tlačítko je aktivní jen s neprázdným indexem nebo s volbou „vše".
- **Seznamy** Připravené / Změny / Nesledované / Konflikty, u souboru +/−,
  akce připravit / odebrat / otevřít diff (`intentsmith-diff-viewer`).
- **Historie** — kompaktní graf větví a commitů (`/api/scm/log`).
- **Prázdné stavy:** projekt bez gitu podle politiky `init`; relace bez projektu
  „Tahle relace nemá projekt".
- Každá akce s efektem ukáže plán (co přesně se stane, remote a hostitel) a
  čeká na potvrzení podle politiky. Výsledek je v Audit záložce sloupce relace.

## 6. Testy (pozitivní a negativní)

- čtení stavu nespustí fetch ani hook (hook, který zapisuje soubor, zůstane
  nezavolaný; strace/sandbox bez sítě);
- zděděné `GIT_*` proměnné a globální konfigurace nemají vliv;
- změněný digest nebo expirovaný plán → provedení odmítnuto, beze změny repa;
- `checkout` se špinavým stromem blokován; `pull` při rozcházení blokován,
  historie beze změny;
- `push` na hostitele mimo `remotes` blokován před sítí, auditní záznam existuje;
- `--force` není dosažitelný žádným vstupem;
- `automatic` nejde zapnout přes `POST /api/settings`;
- restart během operace ji označí `interrupted` bez opakování.
