# CHAT: zastavení na cizím GPU procesu a omezené navázání

24. 9. 2026 — **IMPLEMENTED / RESUME_PENDING_VERIFICATION / NOT_GRADED**.

Operátor hlásil „Běh zastaven“ a nečinnou GPU při autorizovaném sběru.

## Co skutečně skončilo

`full-03` uzavřelo deník v 10:02:08 CEST s `GPU_FOREIGN_WORK_PRESENT`.
Qwen3.5 je hotový (120/120 úplných dialogů). Qwen3.6 má 42 zpracovaných
(41 úplných); tři zbývající modely ještě nezačaly. Celkem 762/1200,
759 úplných, 2204 volání. Poslední Qwen3.6 pokus je provozně přerušený,
bez obsahové známky. Exit wrapperu 1 neznamená ztrátu odpovědí: export
`review-full-03/` skončil s exit 0.

Ochrana porovnává procesní skupinu každého NVIDIA compute procesu
s vlastním providerem. RustDesk současně testoval hardwarové kodeky:
`h264_nvenc` v 10:02:08.636–08.770, `hevc_nvenc` od 08.839, poté CUDA
dekodéry. Stejná shoda je u `full-01` včera ve 22:05:22–23.
Je to silná časová korelace s konkrétní GPU činností, nikoli zpětný důkaz
přesného PID, protože původní guard tento PID neuložil.

Druhé zastavení včera ve 23:30 má jiný doložený souběh: systémová Ollama
začala načítat další model. Všechny tři incidenty tedy nejsou automaticky
připsané RustDesku. Nejde o pád modelu doložený modelovou odpovědí ani
zachycenou stopku paměti/disku.

## Oprava řízení běhu

Nový `scripts/manual/supervise-chat-panel.mjs` obaluje původní sběrač.
Zmrazený sběrač, prompty, modelové digesty, guard a parametry jsou beze změny.
Původní přerušený pokus se nepřepisuje ani neopakuje. Ochrana GPU se
nevypíná, RustDesk ani jiná aplikace se neukončují a nedostávají výjimku.

- Před každým oknem tři po sobě jdoucí volné GPU sondy po pěti sekundách;
  čekání nejvýše 15 minut. Cizí NVIDIA compute proces nebo rezidentní model
  systémové Ollamy znamená čekání. Nečitelná telemetrie znamená zastavení.
- Po uzavření okna se provede oddělený export. Pouze důvod
  `GPU_FOREIGN_WORK_PRESENT` dovoluje další okno, nejvýše třikrát.
- RAM, disk, identity, zrušení a vyčerpané limity nezakládají automatický retry.
- Nové okno má pouze zbývající volání/tokeny/aktivní čas původního plánu.
  Čas pauzy neslouží k resetu časů již uskutečněných oken. Celková služba
  má navíc konečný časový limit včetně čekání a exportů, bez systemd restartu.
- Diagnostický pozorovatel zapisuje compute PID, executable a PGID do
  `gpu-process-observations.jsonl`. Nemění rozhodnutí původního guardu.
- Přehled rozlišuje živé `WAITING_GPU` od definitivního `STOPPED`. Čekání
  vyžaduje čerstvý heartbeat, odpovídající SHA plánu a aktivní službu.

Vstupní zbytek: **1276 volání, 6 410 330 výstupních tokenů,
74 768 112 ms aktivního času** z původního 24hodinového rozpočtu.
Zbytek volání obsahuje i šest již přeskočených navazujících tahů; ty se
nedoplňují přegenerováním zaznamenaných neúplných pokusů.

## Ovládání a důkazy

Aktuální sběr: `intentsmith-chat-panel-20260924-supervised.service`.
Přehled: **http://127.0.0.1:8765/**, služba
`intentsmith-chat-progress-20260924-supervised.service`.

```bash
systemctl --user status intentsmith-chat-panel-20260924-supervised.service --no-pager
systemctl --user stop intentsmith-chat-panel-20260924-supervised.service
```

Evidence zůstává v `/mnt/vi7000/intentsmith/evidence/hunt-chat-panel-20260923/`:
`gpu-contention-correlation.json`, `supervised-resume-receipt.json`,
`supervisor-state.json`, `supervisor-events.jsonl`,
`supervised-resume-verification.json`. Okna `full-04` a případně další mají
vlastní reporty, logy, exit receipty a exporty `review-full-NN/`.

Ověřeno: **23/23** cílených testů, artifact validation **160/160**,
**5/5** kontrol v prohlížeči. Testy pokrývají skutečný deník po přerušení,
zachování neúplného pokusu, zákaz opakování, kumulativní rozpočet, omezení
počtu navázání, jiné příčiny zastavení a čerstvost stavu čekání.
První start prohlížečového testu blokovala chybějící výchozí verze Chrome;
použit již instalovaný Chrome 145, bez stahování. Čekací stavy byly v tomto
browser testu simulované pouze na jeho HTTP odpovědích, bez další inference.

Sběr nemění známky, role, noční timer ani přijaté rozhodovací profily.
Nejde o přejímku hodnotitele nebo autonomní GO.
