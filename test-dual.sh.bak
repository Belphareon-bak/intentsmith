#!/bin/bash
# Test Dual Coding + Review workflow

API="http://127.0.0.1:3335"
WORKDIR="/tmp/dual-test"

echo "========================================"
echo "  Dual Coding + Review Test"
echo "========================================"

# Cleanup
rm -rf $WORKDIR
mkdir -p $WORKDIR

# Vyber projekt
PROJECT="$1"
if [ -z "$PROJECT" ]; then
  echo ""
  echo "Vyber projekt:"
  echo ""
  echo "  EASY (jednoduché):"
  echo "    1) todo - TODO CLI aplikace (Node.js)"
  echo "    2) calc - Kalkulačka (Python)"
  echo "    3) api  - REST API (Express)"
  echo ""
  echo "  MEDIUM (střední):"
  echo "    4) notes - Poznámková aplikace s SQLite (Node.js)"
  echo "    5) monitor - System monitor CLI (Python)"
  echo ""
  echo "  HARD (těžké):"
  echo "    6) chat - Real-time chat server + client (Node.js + WebSocket)"
  echo "    7) cms - Mini CMS s auth a CRUD (Node.js + Express + SQLite)"
  echo ""
  read -p "Volba [1-7]: " choice
  case $choice in
    1) PROJECT="todo" ;;
    2) PROJECT="calc" ;;
    3) PROJECT="api" ;;
    4) PROJECT="notes" ;;
    5) PROJECT="monitor" ;;
    6) PROJECT="chat" ;;
    7) PROJECT="cms" ;;
    *) PROJECT="todo" ;;
  esac
fi

echo ""
echo "Projekt: $PROJECT"
echo "Workdir: $WORKDIR"
echo ""

echo "========================================"
echo "FÁZE 1: CODING"
echo "========================================"
echo ""

# Použij heredoc pro JSON - bezpečnější
case $PROJECT in
  "todo")
    echo "Generuji TODO CLI app..."
    CODING_RESULT=$(curl -s -X POST "$API/chat" \
      -H "Content-Type: application/json" \
      --data-raw '{"message": "Vytvor TODO CLI aplikaci v Node.js do /tmp/dual-test/todo.js. Funkce: add (pridat ukol), list (vypsat), done (oznacit hotove). Ulozeni do todo.json. Vytvor soubor.", "workdir": "/tmp/dual-test"}')
    MAIN_FILE="$WORKDIR/todo.js"
    ;;
  "calc")
    echo "Generuji kalkulačku..."
    CODING_RESULT=$(curl -s -X POST "$API/chat" \
      -H "Content-Type: application/json" \
      --data-raw '{"message": "Vytvor kalkulacku v Pythonu do /tmp/dual-test/calc.py. Funkce: zakladni operace, historie poslednich 10 vypoctu, interaktivni rezim. Vytvor soubor.", "workdir": "/tmp/dual-test"}')
    MAIN_FILE="$WORKDIR/calc.py"
    ;;
  "api")
    echo "Generuji REST API..."
    CODING_RESULT=$(curl -s -X POST "$API/chat" \
      -H "Content-Type: application/json" \
      --data-raw '{"message": "Vytvor REST API v Express.js do /tmp/dual-test/server.js. Endpointy: GET /notes, POST /notes, DELETE /notes/:id. Ulozeni do notes.json. Vytvor soubor.", "workdir": "/tmp/dual-test"}')
    MAIN_FILE="$WORKDIR/server.js"
    ;;
    
  # MEDIUM TESTS
  "notes")
    echo "[MEDIUM] Generuji poznámkovou aplikaci s SQLite..."
    CODING_RESULT=$(curl -s -X POST "$API/chat" \
      -H "Content-Type: application/json" \
      --data-raw '{"message": "Vytvor CLI aplikaci pro poznamky v Node.js s SQLite databazi. Soubory: /tmp/dual-test/notes.js (hlavni), /tmp/dual-test/db.js (databaze). Funkce: add (pridat poznamku s tagem), list (vypsat vse), search (hledat podle textu nebo tagu), delete (smazat podle ID), export (exportovat do JSON). Pouzij better-sqlite3. Vytvor vsechny soubory.", "workdir": "/tmp/dual-test"}')
    MAIN_FILE="$WORKDIR/notes.js"
    ;;
  "monitor")
    echo "[MEDIUM] Generuji system monitor..."
    CODING_RESULT=$(curl -s -X POST "$API/chat" \
      -H "Content-Type: application/json" \
      --data-raw '{"message": "Vytvor system monitor v Pythonu do /tmp/dual-test/monitor.py. Funkce: zobrazeni CPU usage, RAM usage, disk usage, top 5 procesu podle CPU, network stats. Pouzij psutil. Pridej --watch rezim ktery refreshuje kazdych 2 sekundy. Pridej --json pro vystup v JSON formatu. Vytvor soubor.", "workdir": "/tmp/dual-test"}')
    MAIN_FILE="$WORKDIR/monitor.py"
    ;;
    
  # HARD TESTS  
  "chat")
    echo "[HARD] Generuji real-time chat server..."
    CODING_RESULT=$(curl -s -X POST "$API/chat" \
      -H "Content-Type: application/json" \
      --data-raw '{"message": "Vytvor real-time chat aplikaci v Node.js s WebSocket. Struktura: /tmp/dual-test/server.js (WebSocket server na portu 3000), /tmp/dual-test/public/index.html (chat UI), /tmp/dual-test/public/client.js (WebSocket klient). Funkce: pripojeni uzivatele s nickem, odesilani zprav vsem, seznam online uzivatelu, notifikace o pripojeni/odpojeni, historie poslednich 50 zprav. Pouzij ws knihovnu. Server musi servovat staticke soubory z public/. Vytvor vsechny soubory.", "workdir": "/tmp/dual-test"}')
    MAIN_FILE="$WORKDIR/server.js"
    ;;
  "cms")
    echo "[HARD] Generuji mini CMS..."
    CODING_RESULT=$(curl -s -X POST "$API/chat" \
      -H "Content-Type: application/json" \
      --data-raw '{"message": "Vytvor mini CMS system v Node.js s Express a SQLite. Struktura: /tmp/dual-test/server.js (hlavni server), /tmp/dual-test/routes/auth.js (autentizace), /tmp/dual-test/routes/posts.js (CRUD pro clanky), /tmp/dual-test/db.js (SQLite setup), /tmp/dual-test/middleware/auth.js (JWT middleware). Funkce: registrace a login uzivatelu (bcrypt hash), JWT tokeny, CRUD pro clanky (title, content, author, created_at), pouze autor muze editovat/mazat sve clanky, verejny endpoint pro cteni clanku. Pouzij express, better-sqlite3, bcrypt, jsonwebtoken. Vytvor vsechny soubory vcetne package.json.", "workdir": "/tmp/dual-test"}')
    MAIN_FILE="$WORKDIR/server.js"
    ;;
esac

echo ""
echo "Response:"
echo "$CODING_RESULT" | jq -r '.response' 2>/dev/null || echo "$CODING_RESULT"

# Počkej na zápis
sleep 2

echo ""
echo "========================================"
echo "FÁZE 2: KONTROLA VÝSLEDKU"
echo "========================================"
echo ""

echo "Vytvořené soubory:"
find $WORKDIR -type f 2>/dev/null | head -20
echo ""

# Pro HARD testy zobraz strukturu
if [ "$PROJECT" = "chat" ] || [ "$PROJECT" = "cms" ]; then
  echo "Struktura projektu:"
  tree $WORKDIR 2>/dev/null || find $WORKDIR -type f
  echo ""
fi

if [ -f "$MAIN_FILE" ]; then
  echo "✅ Hlavní soubor vytvořen: $MAIN_FILE"
  echo ""
  echo "Obsah (prvních 50 řádků):"
  echo "----------------------------------------"
  head -50 "$MAIN_FILE"
  echo ""
  echo "----------------------------------------"
  
  echo ""
  echo "========================================"
  echo "FÁZE 3: REVIEW"
  echo "========================================"
  echo ""
  
  echo "Spouštím review kódu..."
  REVIEW_RESULT=$(curl -s -X POST "$API/chat" \
    -H "Content-Type: application/json" \
    --data-raw '{"message": "Zkontroluj kod v /tmp/dual-test a navrhni vylepseni. Zamer se na chyby, bezpecnost, citelnost.", "workdir": "/tmp/dual-test"}')
  
  echo ""
  echo "Review:"
  echo "$REVIEW_RESULT" | jq -r '.response' 2>/dev/null || echo "$REVIEW_RESULT"
  
else
  echo "❌ Hlavní soubor nebyl vytvořen: $MAIN_FILE"
  echo ""
  echo "Debug - API response:"
  echo "$CODING_RESULT" | head -c 1000
fi

echo ""
echo "========================================"
echo "HOTOVO"
echo "========================================"

# Instrukce pro spuštění
echo ""
echo "Pro spuštění:"
case $PROJECT in
  "todo")
    echo "  node $WORKDIR/todo.js add \"Test\""
    echo "  node $WORKDIR/todo.js list"
    ;;
  "calc")
    echo "  python $WORKDIR/calc.py"
    ;;
  "api")
    echo "  cd $WORKDIR && npm init -y && npm install express"
    echo "  node $WORKDIR/server.js"
    ;;
  "notes")
    echo "  cd $WORKDIR && npm init -y && npm install better-sqlite3"
    echo "  node $WORKDIR/notes.js add \"Test poznamka\" --tag work"
    echo "  node $WORKDIR/notes.js list"
    ;;
  "monitor")
    echo "  pip install psutil"
    echo "  python $WORKDIR/monitor.py"
    echo "  python $WORKDIR/monitor.py --watch"
    ;;
  "chat")
    echo "  cd $WORKDIR && npm init -y && npm install ws express"
    echo "  node $WORKDIR/server.js"
    echo "  Otevři http://localhost:3000 v prohlížeči"
    ;;
  "cms")
    echo "  cd $WORKDIR && npm install"
    echo "  node $WORKDIR/server.js"
    echo "  # Registrace: curl -X POST http://localhost:3000/auth/register -H 'Content-Type: application/json' -d '{\"username\":\"admin\",\"password\":\"heslo123\"}'"
    ;;
esac
