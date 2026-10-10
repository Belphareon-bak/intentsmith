# Doplnění V4 do stávajícího IDE 2.0 — 10. 10. 2026

Stav: **IMPLEMENTATION_UNDER_VERIFICATION / INDEPENDENT_REVIEW_PENDING / NOT_ACCEPTED**.
Autorita: operátorovy připomínky ke skutečnému IDE a V4 z 10. 10.;
[rozsah a podmínky](../wp/WP-IDE-INTEGRATION-20261009.md).
Další samostatné IDE operátor odmítl. Tento report není jeho přejímkou.

## Co se mění

- Jediný stávající Studio 2 renderer zachovává rám, motiv a profil.
  Nastavení používá plochou boční navigaci s ikonou a názvem vedle sebe.
  Mouse focus nepoužívá modrý Theia outline; klávesnice zachovává viditelný
  focus v barvě motivu.
- Účet a propojení: dvě karty lokální identity/prostředí, skutečný profil
  uložený v DB s autentizací, CAS a readbackem. Neplatný e-mail nezničí draft.
  Funkční lokální výchozí složka projektů zůstává. Neúčinné staré preference
  identity/oznámení už nepřekrývají připojené správy účtů a kanálů.
- Přehled rolí odděluje nastavené okno/odpověď a skutečně ověřený HW strop.
  Vazby rolí lze zobrazit i při výpadku poskytovatele; provider health ani
  místní skóre se tím neoznačí jako ověřené. Detail místního modelu ukazuje
  metadata Ollamy, digest, vazby rolí a konfiguraci kontextu.
- Hunt má čtyři rovnocenné workflow záložky a samostatné skupiny profilů
  Huntu a Challenge. Nový profil má odpovídající typ, výběr modelu/rolí,
  ruční/jednorázový/intervalový/denní/týdenní plán se závislými poli.
  Profily, fronta a historie dál používají skutečné verze a neměnné snímky.
- Katalog zobrazuje porovnání všech rolí, doporučení místního testu,
  skutečné související tagy s dostupnými metadaty kvantizace/VRAM a odkaz
  na primární zdroj. Výchozí filtry lze přepnout i při neověřené VRAM.
- Veřejné reference nejsou pouze prázdná ruční API možnost: přibyl omezený
  offline snapshot dvou ověřených primárních modelových karet. Srovnání
  vyžaduje stejný zdroj, metriku, stupnici, verzi/otisk a datum měření.
  Zdrojové datum měření je neznámé, datum našeho ověření je oddělené.
  Názvy se nepřenášejí na neznámé tagy/kvantizace. Mapování metrik na role
  je výslovně pomocný prior, nikoli důkaz kvality dialogu nebo revizora.
- Instalátor zachovává PDF/účetní runtime a existující profil; při upgradu
  nekopíruje znovu Legacy. Předává skutečnou konfiguraci OLLAMA_MODELS
  ze služby lokálního poskytovatele. Nepřidává další desktop položku.

## Doložení veřejných referencí

[Google Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4?hl=zh-cn)
a [Qwen3.6-27B model card](https://huggingface.co/Qwen/Qwen3.6-27B/raw/main/README.md)
byly přečteny přímo. Pinned výběr a otisky zdrojů jsou v
[src/system/ide-public-references.json](../../src/system/ide-public-references.json).
MMLU Pro je znalostní proxy, GPQA Diamond proxy vědeckého uvažování,
LiveCodeBench v6 programování a MMMU Pro multimodality. Mapování na
IntentSmith role je naše inference. Skóre nenahrazuje test přesného
místního digestu a kvantizace ani nepovoluje přepnutí vazeb.

## Ověření

Průběžné testy: katalog/backend/view 44/44; opravené desktop/live-model/UI
156/156. Původní selhání dvou UI regresí (názvy kategorií a zmizelá složka
projektů) jsou zachována v pracovních logách; druhé bylo skutečnou regresí
opravenou zachováním funkčního ovladače. HTTP journey ověřuje profil,
401/422/409 a přetrvání po restartu. Registr a module boundary prošly.
Úplný audit, čerstvý AppImage, průchody 1366/1920 a aktualizace běžného
spouštěče jsou zatím **PENDING**, žádný starší snímek je nenahrazuje.

## Provozní a release meze

Živé `nvidia-smi` selhalo: načtený modul 595.91.07, NVML 595.99.
To blokuje skutečný GPU Hunt a modelové měření. Aktualizace UI nemůže
opravit načtený kernel modul; restart stanice nelze provést bez operátora.
Automation hold z 19. 9. zůstává a aktualizace jej nesmí uvolnit.

Není doloženo skutečné doručení Discord/Telegram ani GPU evaluace.
Nezávislý Opus musí hodnotit tento nový zdroj, ne starší 230f657f.
Hunt profil nenabízí neúčinné libovolné budgety ani změnu chráněných
benchmark kontextů: runner má přijatý pevný měřicí protokol 4096 tokenů
s provozními limity. Neověřené kapacity a offload jsou označené jako
neověřené. Google/Microsoft OAuth, více izolovaných uživatelských účtů a
nepřipojené historické preference nemají předstírat hotovou funkci.

CHAT styl, vlastní prompt a 64k/96k/128k Gemma zůstávají dle operátora
předmětem pozdějšího měření; tato oprava nemění modelové vazby.
Formální release dále potřebuje přesné Gate 0/chain evidence, úschovu
klíčů, podepsané autorizační záznamy, příslušný soak a operátorovu přejímku.
