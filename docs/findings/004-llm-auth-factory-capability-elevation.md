# 004 — Interní auth factory stále umí capability override mimo default role

- **vlastník:** budoucí authority/connector WP po migraci legacy call sites
- **nalezeno v:** WP-M1-MODEL, hardening `src/llm/auth-types.js`
- **stav:** PENDING-OWNER

## Evidence

Auth token je nyní process-local, vydaný privátním `WeakSet`, hluboce zmrazený
a nepadělatelný kopírováním polí. Prototype role `toString`/`constructor` a
ručně sestavený nebo spread token se odmítnou před providerem.

Factory však vědomě zachovává interní parametr `capabilities`. Současný
`src/chat/context-compact.js` vydává roli `TOOL_INTERNAL` capability
`SUMMARIZATION`, přestože její default v `RoleCapabilities` je pouze
`EXTRACTION`. Globální vynucení subsetu by tedy změnilo živé legacy chování v
zakázané `src/chat/**` cestě tohoto WP.

## Dopad

Externí `ModelRequest` capability ani autoritu nepředává: adaptér vyžaduje
samostatný vydaný token svázaný s rolí a třemi request identitami a následně
použije explicitní role-purpose matici. Uvnitř procesu ale kterýkoli modul s importem `createAuthToken()`
zůstává součástí trusted computing base a může požádat o jinou známou
capability. WeakSet/freeze je provenance a immutability boundary, nikoli úplný
execution-authority port.

## Minimální reprodukce

```bash
rg -n "createAuthToken|capabilities:" src/llm src/chat src/architect src/skills src/routes
```

## Co se v tomto WP neopravuje

Zákaz capability override bez migrace `context-compact` by byl skrytá změna
funkční parity. Následný WP musí inventarizovat všechny token factory call sites,
přiřadit jim explicitní deklarované role a negativně dokázat, že žádný caller
nemůže capability rozšířit. Do té doby M1 adaptér používá pouze defaultní
capability interně vydané role.
