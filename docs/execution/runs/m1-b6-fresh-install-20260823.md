# M1 B6 — fresh-install exit journey, 2026-08-23

- **stav:** `PASS / M1 GATE 2 EVIDENCE`
- **registrovaná sada:** `IS-T5-TESTS-M1-JOURNEY-TEST`
- **source:** `d518d7ec2156b108c5d71b72d16ee855781c6be5`
- **standalone clone:** `/home/belphareon/worktrees/is-m1-b6-accept3-ZrKjsYpV`
- **artifact root:** `.intentsmith-artifacts/m1-b6-d518d7ec/` v uvedeném
  klonu, mode `0700`
- **model:** `qwen3.5:27b`, digest
  `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`

## Fresh install a build

Klon vznikl přes `git clone --no-local` a měl vlastní `.git` i common-dir,
exact HEAD a čistý source tree. `npm ci --offline` nainstalovalo 233 balíčků
s nulou vulnerabilities. `corepack yarn install --frozen-lockfile --offline
--non-interactive` prošlo a následný `corepack yarn build` sestavil produkční
Theia/Electron runtime. Povinný postbuild guard vrátil
`STUDIO_M1_BUILD_CONSUMER_PASS`:

| Artefakt | Bajty | SHA-256 |
|---|---:|---|
| frontend bundle | 11 757 125 | `0a5861836717b1c5143283bc9ccee686b770b57dff90ddea00b17793d8f6e55c` |
| preload | 21 321 | `58a47c8b344cdd3450a34ad15030dc62c02075071184c7ebb03e74f92c37b196` |
| M1 consumer | 49 293 | `8fb4e265b027551a14ad8f1add467ffeb7cd819d50320a590d522441465559e4` |
| generated protocol | 1 161 | `cdad67d9d818f845be3e6b6963b9befbecd4664b5ed1733af40df4883ad18f92` |

## Jedna B6 evidence envelope

Produktová část použila skutečný server, izolovanou SQLite, lokální Ollamu a
shipped Electron build. Deterministický i modelový turn proto prošly doslova
Studio rendererem přes `m1-wire-v1` do skutečného product serveru. Druhá,
výslovně oddělená část použila stejný shipped Electron build nad test-owned
produkčním M1 wire backendem, aby reprodukovatelně vyvolala error, cancel a
reconnect terminály. Controlled backend není vydávaný za skutečnou Ollamu.

| Scénář / metrika | Výsledek |
|---|---|
| HTTP deterministika | 20 vzorků; min/p50/p95/max/mean `1/1/34/114/9 ms`; nearest-rank p95 `< 100 ms` |
| HTTP modelový chat | cold `51 206 ms`; warm `52 645/55 257 ms`, p95 `55 257 ms`; `1,11` turnu/min |
| literal Studio → real server | deterministic `7 ms`, model `52 267 ms`, oba `ok`, spinner cleared |
| provider audit | 12 celkem, 8 `/api/chat`; exact model; `num_ctx` jen `1024` nebo `4096` |
| Decision 024/C | 0 refinement promptů, 0 post-answer volání, tokenů i přidané latence |
| restart/history | `50` zpráv před i po restartu, exact hash `af34c567d8a94b057fdb6f30f750bf84b3b846d5873f09bb9ce47d3e847b3096` |
| provider outage | HTTP `503`, `status=error`, `LLM_PROVIDER_UNAVAILABLE`; persistovaný jen user turn |
| cancel seam | before/during/pre-persistence kontrakt `21/21`; žádný late success |
| confirmation owner | `5/5` |
| controlled built Studio | 2 panely, 5 terminálů, 12 progress eventů, 1 reconnect, 0 legacy messages |
| síť | 0 external, 0 other-loopback a 0 unsupported pokusů |
| shutdown | Electron i backend exit `0`, žádný forced kill, process groups clean |
| attachment byte bridge | exposed; forged token odmítnut; path-taking read API `0` |
| source po běhu | clean |

Samostatná Studio evidence má `verdict=PASS`, `m1-wire-v1`, přesné send/cancel/
error počty, `m1NegotiatedAfterRestart=true`, nulové síťové anomálie a čistý
shutdown. První deterministic request měl `114 ms`; není skrytý, zůstává v raw
vzorcích a `max`. Přijatý cíl je p95, nikoli max. Minimálních 20 vzorků je
nutných, aby nearest-rank p95 nebylo matematicky totožné s maximem.

## Artefakty

| Soubor | SHA-256 |
|---|---|
| `m1-journey.json` | `a816b48e1bbbdccfa274407d376453da26d3eccdbc16728d09de206f3034acbb` |
| `m1-journey-deterministic-http.json` | `a3aa567b2926c39ac9e934723c47a2d6b0b96292a8f33bab93318fa178a26338` |
| `studio/studio-electron-boundary.json` | `6d65c429a46eaf2490e87c18a55dd3eee3a47d00a13e524d864ab9b47165f866` |

Před finálním během byly tři vlastní pokusy přerušené pouze kvůli nově
vzniklým coworker GPU/Ollama běhům; žádný cizí proces nebyl ukončen. Dva další
kompletní funkční průchody odkryly chybu evidence: UI/CDP latency byla smíchaná
s HTTP a nearest-rank p95 nad 6/12 vzorky bylo ve skutečnosti maximum. Produktový
práh se nezvýšil. Finální sada odděluje hranice a používá minimální korektní
HTTP vzorek o 20 prvcích; raw data zapisuje před metrickým gate.

## Verdikt

B6 prošlo bez parkované povinné položky. Spolu s uzavřeným B5/Decision 024/C
jsou splněné podmínky Gate 2 a M1 může být označené `ACCEPTED/PASS`. Otevřený
[finding 011](../../findings/011-response-scorer-short-factual-calibration.md)
zůstává pravdivým neblokujícím scorer residualem; M1 closeout jej nemaže ani
nepřebarvuje.
