# Decision 031 — M3 optional MCP pilot disposition

- **Stav:** `DEFERRED / NON_BLOCKING`
- **Datum:** 2026-08-26
- **Rozsah:** `WP-M3-MCP-PILOT` (`OPTIONAL_EXPERIMENT`)
- **Autorita k případné aktivaci:** operátor projektu

## Kontext

Roadmapa dovoluje jeden read-only MCP pilot, ale výslovně jím neblokuje M3.
Povýšení experimentu do produktu vyžaduje měřený přínos a operátorské přijetí.
Současný produkt nemá M3 MCP extension, MCP effect producenta ani naměřený
výsledek, který by takové rozšíření ospravedlnil.

Implementovat konektor pouze proto, aby vznikla další položka v closeoutu, by
rozšířilo registrační a potenciálně outbound plochu bez uživatelské evidence.
Zároveň by nebylo pravdivé tvrdit, že neexistující MCP cesta prošla E2E.

## Disposition

`WP-M3-MCP-PILOT` se pro M3 odkládá a není součástí product candidate. M3
netvrdí MCP podporu ani MCP runtime readiness. Proto dnes neexistuje MCP efekt,
který by mohl obejít M2 authority.

Případný budoucí pilot musí vzniknout jako samostatný reviewovaný řez a musí:

1. použít `ExtensionManifest/ExtensionContext` a pouze deklarované capability;
2. překládat každý efekt na verzovaný `ToolRequest` a `EffectRequest` přes M2;
3. začít read-only cestou, mít nulový implicitní outbound a přesnou provenance;
4. doložit měřený přínos proti variantě bez MCP;
5. získat explicitní operátorské přijetí před zařazením do produktu.

Toto rozhodnutí nemění exit kritéria pro existující M3 producenty a samo o sobě
neznamená přijetí M3.
