#!/bin/bash
API="http://127.0.0.1:3335"

echo "Generuji profesionální UI pomocí C.3..."

curl -s -X POST "$API/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Vytvoř profesionální chat UI pro AI coding assistant v jednom HTML souboru do /home/belphareon/Projects/c3-agent-wip/ui/chat-pro.html. Inspiruj se Open WebUI. Požadavky: 1) Tmavý moderní design s gradient akcenty a zaoblenými rohy, 2) Levý sidebar se seznamem sessions (New Chat button nahoře) a file tree pro vygenerované soubory, 3) Hlavní chat panel s markdown renderingem a syntax highlighting pro kód - použij highlight.js a marked.js z CDN, 4) Každý code block má tlačítko pro kopírování, 5) Input pole dole s send buttonem, loading spinner během generování, 6) Responzivní - na mobilu skryj sidebar. Použij moderní CSS (flexbox/grid, variables, transitions). JavaScript: volej /chat POST endpoint s {message, sessionId, workdir}, renderuj odpověď jako markdown, parsuj code blocky a aplikuj syntax highlighting.",
    "sessionId": "ui-generator", 
    "workdir": "/home/belphareon/Projects/c3-agent-wip/ui"
  }' | jq -r '.response' | head -100

echo ""
echo "Kontrola výsledku:"
ls -la /home/belphareon/Projects/c3-agent-wip/ui/
