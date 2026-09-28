# 002 — vision cesta obchází jednotnou modelovou hranici

- **vlastník:** budoucí WP pro image/model connector po rozhodnutí o schématu
- **nalezeno v:** WP-M1-MODEL, read-only call graph
- **stav:** PENDING-OWNER

## Evidence

`src/llm/cre-bridge.js:analyzeImages()` volá Ollama endpoint `/api/generate`
přímo přes `fetch`. Neprochází `llmGateway.call()`, nepoužívá semafor gateway a
má vlastní retry, timeout i parser odpovědi. Connector `ModelRequest` v1 z B1
nenese image payload ani image authority, takže tuto cestu nelze převést bez
změny přijatého connectoru.

## Dopad

Tvrzení „jedna pravdivá Ollama hranice“ je pro textovou M1 cestu dosažitelné,
ale pro vision zatím ne. Vision může mít odlišnou klasifikaci empty/malformed,
jiné retry chování a souběžný GPU effect mimo gateway semafor.

## Minimální reprodukce

```bash
rg -n "export async function analyzeImages|/api/generate|fetch\\(" src/llm/cre-bridge.js
```

## Co se v tomto WP neopravuje

Guard ani connector se neoslabuje a image schema se autonomně nepřidává. M1
textový adaptér bude tuto výjimku explicitně reportovat; vision zůstává mimo
claim connectoru v1, dokud operátor nepřijme rozšíření schématu nebo samostatný
image connector.
