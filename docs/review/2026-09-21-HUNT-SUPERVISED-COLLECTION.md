# GPU hunt: běžný sběr pod dohledem — 21. 9. 2026

Stav: IMPLEMENTED / VALIDATION_IN_PROGRESS / NOT_DEPLOYED.
Autonomní výběr a mazání podle kvality: NO_GO.

Autorita: explicitní zadání operátora dokončit bezpečně jisté části,
WP-GPU-HUNT-HANDOFF-20260919 §5, DIRECTION a původní EVALUATION-CONTRACT.
Tento packet není novou přejímací autoritou.

## Co se mění

Běžný candidate trial obslouží všech sedm rolí. D1, D2, R1, R2 a CHAT
sbírá bez soudce, bez předběžného filtrování podle jazykových sond a bez
nutnosti spustit současný model. Každý pokus průběžně uloží do existující
append-only historie. Částečný sběr nevyřadí kandidáta; dokončený se neopakuje.
CODE/VISION používají spustitelné nebo přesné orákulum a průzkumné skóre.

Studio ukazuje čekání na posouzení, počty, vyčerpání limitu i jednotlivé
odpovědi se zadáním a kritérii. Historie skrývá nadbytečné průběžné snapshoty,
DB je zachovává. Export odděluje odpovědi bez identit od soukromého klíče.
Nezapisuje známky, rozhodnutí ani bindingy.

Umístění a inference používají stejných 16 384 tokenů. Nad 22 GB modelové
VRAM se neprovádí další inference; tento limit není CPU spill a nedokazuje,
že model není vhodný pro jiné kontexty. Důkaz pro větší produkční kontext chybí.

## Rezerva hostu a identita provideru

Wrapper před startem vyžaduje 8 GiB MemAvailable a 12 GiB na souborových
systémech DB, stavu a modelů. Každé dvě sekundy kontroluje 4 GiB RAM a
12 GiB disku; neznámý stav nebo podkročení rezervy ukončí vlastní procesové
skupiny, zachová checkpointy a zveřejní BLOCKED s konkrétním důvodem.
Nesleduje pouhou velikost volné RAM ani obsazenost swapu bez kontextu.
Stahování si zachovává silnější rezervu 40 GiB po stažení kandidáta.
Manuální i plánovaný systemd běh mají MemoryHigh=60%, MemoryMax=75%,
MemorySwapMax=1G, OOMPolicy=stop. Limity omezují tento workload; negarantují,
že jiná aplikace nemůže vyčerpat paměť mezi kontrolami.

CODE fallback spouštěný přes samostatnou systemd jednotku má vlastní limit
2 GiB RAM, 256 MiB swapu a RuntimeMaxSec (timeout + nejvýše 3 s). Jednotka
nepatří pod cgroup rodiče, proto potřebuje vlastní limit. Při odstraněných
session proměnných se klient připojí pouze k ověřenému socketu stejného UID;
bez dostupného manageru nadále vrací chybu prostředí, žádné skóre.
Živá negativní kontrola odhalila, že PrivateNetwork=yes může být ignorováno.
Fallback proto používá /usr/bin/bwrap s vlastním síťovým namespace, read-only
kořenem a zapisovatelným pracovním adresářem. Bootstrap před importem testu
ověří odlišný skutečný network namespace; falešně úspěšný launcher modelový
kód nespustí. Nejde o tvrzení plného hostile-code sandboxu ani skrytí všech
čitelných souborů hostu.

Instalace zachovává pozastavený timer; existující automation hold má přednost.
Evaluační verze 0.34.2-intentsmith.1 je připnutá společně s binární SHA.
GUI čte výsledky této verze, samostatně uvádí verzi systémového provideru.
Rozdíl nebo neznámá systémová verze nesmí vytvořit doporučení k aktivaci.

## Ověření

Doplní skutečné běhy na připnutém commitu. Žádný plán ani zelený unit test
sám o sobě neznamená přejímku modelových rozhodnutí.
Evidence: `/home/belphareon/Projects/coworker/intentsmith-hunt-supervised-20260921`.

## Co zůstává otevřené

- Rozsouzení hodnoticího měřítka D1/D2 a sporu o rozsah R1; následná oddělená
  přejímka automatického hodnotitele. Sběr nikdy neznamená přijatý T4.
- Více nových nezávislých provozních případů se zmrazenými pravidly. Dosavadní
  malý rank-check předpovědní platnost nepotvrdil ani nevyvrátil.
- Přijatá rozhodovací evidence pro konkrétní kontrakt a párovou kvalifikaci.
  Aktuální přejímací schéma provozních zkoušek nadále podporuje pouze CODE.
- Integrace do běžící instalace a ověření celého Studio journey. Instalovaný
  snapshot `9ad8bc3ff609400ec1cd44e50db4fe71ec1ee283` pochází z jiné historie;
  tímto během není přepsán bez ověření integračního rozsahu.
- Timer zůstává vypnutý; není obcházená přejímka, změna rolí ani mazání.

Odpovědi a průzkumná skóre nejsou produkční doporučení. Referenční kontroly
ověřují měřidlo, nikoli přínos modelu v reálné práci. Jednotlivé fáze lze
zprovoznit pod dohledem, aniž se těmto mezerám přisoudí stav PASS.
