// tests/e2e/_test-fixtures.js — Code snippets + ground truth for quality E2E suites
// ══════════════════════════════════════════════════════════════════════════════
// Used by:
//   97-project-build-quality.e2e.js (Suite A — project specs)
//   98-analysis-quality.e2e.js      (Suite B — analysis code + ground truth)
//
// SECURITY SENTINEL: all insecure examples in this module are synthetic,
// deliberately vulnerable test data. They contain no real credential or secret.
// ══════════════════════════════════════════════════════════════════════════════

export const TEST_FIXTURES_ARE_SYNTHETIC = true;

// ═══════════════════════════════════════════════════════════════════════════════
//  Suite A — Project Specs
// ═══════════════════════════════════════════════════════════════════════════════

export const PROJECTS = [
  {
    id: 'A1', name: 'TaskFlow', lang: 'javascript',
    spec: `Vytvoř kompletní REST API pro task management v Node.js.
Technologie: Express, better-sqlite3 (SQLite), JWT autentizace.
Soubory:
1. server.js — hlavní server, registrace middlewarů a routerů
2. db.js — SQLite inicializace, CREATE TABLE pro users a tasks
3. routes/auth.js — POST /auth/register, POST /auth/login (vrací JWT)
4. routes/tasks.js — CRUD: GET /tasks, POST /tasks, PUT /tasks/:id, DELETE /tasks/:id (chráněno JWT)
5. middleware/auth.js — JWT middleware (verifikace tokenu z Authorization header)
6. middleware/errors.js — centrální error handler

Požadavky: hesla hashovaná (bcrypt/crypto), JWT secret z env, try/catch v routách, validace vstupů.
Každý soubor musí být kompletní, spustitelný, bez TODO/placeholder.`,
    requirements: {
      minFiles: 4,
      mustHaveKeywords: ['express', 'router', 'jwt', 'sqlite', 'middleware'],
      authRequired: true,
      minRoutes: 4,
      errorHandling: true,
    },
  },
  {
    id: 'A2', name: 'RecipeBook', lang: 'python',
    spec: `Vytvoř kompletní Flask web aplikaci pro správu receptů.
Technologie: Flask, SQLite (sqlite3 modul), Jinja2 šablony.
Soubory:
1. app.py — hlavní Flask aplikace, routes, DB inicializace
2. models.py — SQLite operace: CRUD pro recepty (create, list, search, get, update, delete)
3. templates/base.html — základní layout
4. templates/index.html — seznam receptů s vyhledáváním
5. templates/recipe.html — detail receptu

Požadavky: full-text search přes název a ingredience, input validace (prázdný název = chyba),
flash messages pro zpětnou vazbu, error handling pro neexistující recept (404).
Každý soubor musí být kompletní, bez TODO/placeholder.`,
    requirements: {
      minFiles: 3,
      mustHaveKeywords: ['flask', 'sqlite', 'render_template', 'request'],
      authRequired: false,
      minRoutes: 3,
      errorHandling: true,
    },
  },
  {
    id: 'A3', name: 'LinkShortener', lang: 'go',
    spec: `Vytvoř URL shortener v Go.
Technologie: net/http (standardní knihovna), SQLite (go-sqlite3 nebo modernc.org/sqlite).
Soubory:
1. main.go — HTTP server, routing, main()
2. handlers.go — handlery: POST /shorten, GET /:code (redirect), GET /stats/:code
3. store.go — SQLite operace: uložení URL, lookup, počítadlo kliknutí

Požadavky: generování krátkého kódu (6 znaků), redirect s 301, počítadlo kliknutí,
validace URL (musí začínat http/https), error handling pro neexistující kódy.
Každý soubor musí být kompletní, bez TODO/placeholder.`,
    requirements: {
      minFiles: 2,
      mustHaveKeywords: ['http', 'HandleFunc', 'sql', 'redirect'],
      authRequired: false,
      minRoutes: 3,
      errorHandling: true,
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
//  Suite B — Analysis Fixtures
// ═══════════════════════════════════════════════════════════════════════════════

// ── B1.1: JS Performance Problems ───────────────────────────────────────────

export const B1_1_PERF_JS = {
  id: 'B1.1',
  title: 'JS Performance Analysis',
  lang: 'javascript',
  prompt: 'Analyzuj tento Node.js kód a najdi všechny výkonnostní problémy. Vysvětli každý problém a navrhni opravu.',
  code: `
const express = require('express');
const db = require('./db');

const app = express();
app.use(express.json());

// Get all orders with customer info
app.get('/orders', async (req, res) => {
  const orders = await db.query('SELECT * FROM orders');
  const result = [];
  for (const order of orders) {
    const customer = await db.query('SELECT * FROM customers WHERE id = ?', [order.customer_id]);
    const items = await db.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    result.push({ ...order, customer: customer[0], items });
  }
  res.json(result);
});

// Search products
app.get('/products/search', async (req, res) => {
  const products = await db.query('SELECT * FROM products');
  const filtered = products.filter(p => p.name.toLowerCase().includes(req.query.q.toLowerCase()));
  const sorted = [...filtered].sort((a, b) => a.price - b.price);
  const page = sorted.slice(0, 20);
  res.json(page);
});

// Export report
app.get('/report', async (req, res) => {
  const data = await db.query('SELECT * FROM sales');
  const fs = require('fs');
  const csv = data.map(row => Object.values(row).join(',')).join('\\n');
  fs.writeFileSync('/tmp/report.csv', csv);
  const content = fs.readFileSync('/tmp/report.csv', 'utf8');
  res.send(content);
});

app.listen(3000);
`.trim(),
  groundTruth: [
    { id: 'n+1', keywords: ['n+1', 'n plus 1', 'loop', 'query in loop', 'dotaz ve smyčce', 'join'], weight: 25 },
    { id: 'no-db-filter', keywords: ['filter', 'database', 'where', 'like', 'index', 'filtr', 'databáz'], weight: 25 },
    { id: 'sync-io', keywords: ['sync', 'writefilesync', 'readfilesync', 'blocking', 'blokující', 'asynchron'], weight: 25 },
    { id: 'unnecessary-copy', keywords: ['spread', 'copy', 'kopie', 'slice', 'zbytečn', 'unnecessary', 'stream'], weight: 25 },
  ],
};

// ── B1.2: Python Security Review ────────────────────────────────────────────

export const B1_2_SECURITY_PY = {
  id: 'B1.2',
  title: 'Python Security Review',
  lang: 'python',
  prompt: 'Proved security review tohoto Flask kódu. Najdi všechny bezpečnostní zranitelnosti, vysvětli rizika a navrhni opravy.',
  code: `
from flask import Flask, request, render_template_string
import sqlite3
import os

app = Flask(__name__)
# INTENTSMITH_SYNTHETIC_INSECURE_FIXTURE: intentionally hardcoded non-secret.
app.secret_key = "synthetic-only"

def get_db():
    return sqlite3.connect('app.db')

@app.route('/login', methods=['POST'])
def login():
    username = request.form['username']
    password = request.form['password']
    db = get_db()
    user = db.execute(f"SELECT * FROM users WHERE username='{username}' AND password='{password}'").fetchone()
    if user:
        return f"Welcome {username}!"
    return "Invalid credentials", 401

@app.route('/profile/<username>')
def profile(username):
    db = get_db()
    user = db.execute(f"SELECT * FROM users WHERE username='{username}'").fetchone()
    template = f"<h1>Profile: {user[1]}</h1><p>Bio: {user[3]}</p>"
    return render_template_string(template)

@app.route('/search')
def search():
    q = request.args.get('q', '')
    db = get_db()
    results = db.execute(f"SELECT * FROM posts WHERE title LIKE '%{q}%'").fetchall()
    return render_template_string(f"<h1>Results for: {q}</h1><ul>{''.join(f'<li>{r[1]}</li>' for r in results)}</ul>")

@app.route('/upload', methods=['POST'])
def upload():
    file = request.files['file']
    file.save(os.path.join('/uploads', file.filename))
    return "Uploaded!"

if __name__ == '__main__':
    app.run(debug=True)
`.trim(),
  groundTruth: [
    { id: 'sql-injection', keywords: ['sql injection', 'sql inject', 'f-string', 'parametr', 'parameteriz', 'prepared', 'sql injekce'], weight: 30 },
    { id: 'xss-ssti', keywords: ['xss', 'cross-site', 'template', 'render_template_string', 'escap', 'sanitiz', 'ssti', 'injection'], weight: 30 },
    { id: 'hardcoded-secret', keywords: ['hardcod', 'secret', 'secret_key', 'environment', 'env', 'prostředí', 'tajný'], weight: 20 },
    { id: 'path-traversal', keywords: ['path traversal', 'filename', 'secure_filename', 'traversal', 'directory', 'soubor', 'upload'], weight: 20 },
  ],
};

// ── B1.3: Go Architecture Review ────────────────────────────────────────────

export const B1_3_ARCH_GO = {
  id: 'B1.3',
  title: 'Go Architecture Review',
  lang: 'go',
  prompt: 'Analyzuj architektonické problémy v tomto Go kódu. Zaměř se na SOLID principy, separation of concerns a testovatelnost.',
  code: `
package main

import (
    "database/sql"
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "net/smtp"
    "os"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func handleCreateUser(w http.ResponseWriter, r *http.Request) {
    var user struct {
        Name  string \`json:"name"\`
        Email string \`json:"email"\`
    }
    json.NewDecoder(r.Body).Decode(&user)

    // Validate
    if user.Name == "" || user.Email == "" {
        http.Error(w, "missing fields", 400)
        return
    }

    // Insert to DB
    result, err := db.Exec("INSERT INTO users(name, email) VALUES(?, ?)", user.Name, user.Email)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    id, _ := result.LastInsertId()

    // Send welcome email
    auth := smtp.PlainAuth("", os.Getenv("SMTP_USER"), os.Getenv("SMTP_PASS"), "smtp.gmail.com")
    msg := []byte(fmt.Sprintf("Subject: Welcome!\\n\\nHello %s, welcome!", user.Name))
    smtp.SendMail("smtp.gmail.com:587", auth, "noreply@app.com", []string{user.Email}, msg)

    // Log to file
    f, _ := os.OpenFile("users.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
    fmt.Fprintf(f, "Created user %d: %s\\n", id, user.Name)
    f.Close()

    // Generate report
    rows, _ := db.Query("SELECT COUNT(*) FROM users")
    var count int
    rows.Next()
    rows.Scan(&count)
    rows.Close()

    json.NewEncoder(w).Encode(map[string]interface{}{
        "id": id, "name": user.Name, "total_users": count,
    })
}

func main() {
    var err error
    db, err = sql.Open("sqlite3", "./app.db")
    if err != nil { log.Fatal(err) }
    db.Exec("CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, email TEXT)")
    http.HandleFunc("/users", handleCreateUser)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
`.trim(),
  groundTruth: [
    { id: 'god-function', keywords: ['god function', 'single responsibility', 'too much', 'příliš', 'jednot', 'srp', 'separation', 'oddělení'], weight: 30 },
    { id: 'no-interface', keywords: ['interface', 'abstrakc', 'dependency injection', 'coupling', 'závislost', 'testovatel', 'mock'], weight: 35 },
    { id: 'global-state', keywords: ['global', 'var db', 'globální', 'sdílen', 'shared state', 'singleton'], weight: 20 },
    { id: 'error-ignore', keywords: ['error', 'chyb', 'ignor', 'unchecked', 'nekontrol', '_', 'discard'], weight: 15 },
  ],
};

// ── B2.1: JS Race Condition ─────────────────────────────────────────────────

export const B2_1_RACE_JS = {
  id: 'B2.1',
  title: 'JS Race Condition Debug',
  lang: 'javascript',
  symptom: 'Občas vrací špatný počet items. Při 100 souběžných requestech se ztratí některé záznamy.',
  prompt: 'Debuguj tento kód. Symptom: "Občas vrací špatný počet items. Při 100 souběžných requestech se ztratí některé záznamy." Najdi root cause a navrhni opravu.',
  code: `
const express = require('express');
const app = express();
app.use(express.json());

let counter = 0;
const items = [];

app.post('/items', async (req, res) => {
  const id = ++counter;
  // Simulate async DB write
  await new Promise(r => setTimeout(r, Math.random() * 10));
  items.push({ id, name: req.body.name, createdAt: Date.now() });
  res.json({ id, total: items.length });
});

app.get('/items/count', (req, res) => {
  res.json({ counter, actual: items.length });
});

// Batch processor
async function processBatch(batch) {
  const results = [];
  for (const item of batch) {
    const processed = await processItem(item);
    results.push(processed);
  }
  return results;
}

async function processItem(item) {
  const data = await fetchData(item.id);
  item.processed = true;
  item.data = data;
  return item;
}

async function fetchData(id) {
  await new Promise(r => setTimeout(r, 5));
  return { fetched: true };
}

app.listen(3000);
`.trim(),
  groundTruth: [
    { id: 'shared-counter', keywords: ['counter', 'race', 'atomic', 'mutex', 'lock', 'čítač', 'závodní', 'concurrent', 'souběž'], weight: 40 },
    { id: 'missing-await', keywords: ['await', 'async', 'promise', 'concurrent', 'parallel', 'push', 'items', 'mutation', 'mutac'], weight: 40 },
  ],
};

// ── B2.2: Python Memory Leak ────────────────────────────────────────────────

export const B2_2_MEMLEAK_PY = {
  id: 'B2.2',
  title: 'Python Memory Leak Debug',
  lang: 'python',
  symptom: 'Po 1000 requestech zabere 2GB RAM. Paměť neustále roste a nikdy neklesá.',
  prompt: 'Debuguj tento kód. Symptom: "Po 1000 requestech zabere 2GB RAM. Paměť neustále roste a nikdy neklesá." Najdi root cause a navrhni opravu.',
  code: `
from flask import Flask, request, jsonify
import time
import logging

app = Flask(__name__)

# Event system
class EventBus:
    def __init__(self):
        self.listeners = {}

    def on(self, event, callback):
        if event not in self.listeners:
            self.listeners[event] = []
        self.listeners[event].append(callback)

    def emit(self, event, data):
        for cb in self.listeners.get(event, []):
            cb(data)

bus = EventBus()

# Cache
request_cache = {}

@app.route('/process', methods=['POST'])
def process():
    data = request.json
    request_id = f"req_{time.time()}"

    # Cache the request
    request_cache[request_id] = {
        'data': data,
        'timestamp': time.time(),
        'response': None
    }

    # Register listener for this request
    def on_complete(result):
        request_cache[request_id]['response'] = result

    bus.on('request_complete', on_complete)

    # Process
    result = heavy_computation(data)
    bus.emit('request_complete', result)

    request_cache[request_id]['response'] = result
    return jsonify({'id': request_id, 'result': result})

@app.route('/history')
def history():
    return jsonify({
        'total_requests': len(request_cache),
        'cache_keys': list(request_cache.keys())[-10:]
    })

def heavy_computation(data):
    return {'processed': True, 'size': len(str(data))}

if __name__ == '__main__':
    app.run()
`.trim(),
  groundTruth: [
    { id: 'listener-leak', keywords: ['listener', 'event', 'callback', 'on_complete', 'unsubscribe', 'remove', 'odpojit', 'registr'], weight: 40 },
    { id: 'cache-unbounded', keywords: ['cache', 'request_cache', 'unbounded', 'neomezen', 'growing', 'roste', 'dict', 'evict', 'ttl', 'lru', 'limit'], weight: 40 },
  ],
};

// ── B3.1: Express API Completion ────────────────────────────────────────────

export const B3_1_EXPRESS_COMPLETION = {
  id: 'B3.1',
  title: 'Express API Completion',
  lang: 'javascript',
  prompt: `Doplň tento Express API kód. Existující kód NEMĚŇ, pouze přidej chybějící části:
1. try/catch error handling ve všech route handlerech
2. 404 handler pro neexistující routes
3. Input validation middleware (name musí být string, 1-100 znaků; email musí obsahovat @)
4. Centrální error handler middleware

Vypiš kompletní soubor se všemi doplněními.`,
  existingCode: `
const express = require('express');
const app = express();
app.use(express.json());

const users = [];
let nextId = 1;

app.get('/users', (req, res) => {
  res.json(users);
});

app.get('/users/:id', (req, res) => {
  const user = users.find(u => u.id === parseInt(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

app.post('/users', (req, res) => {
  const user = { id: nextId++, name: req.body.name, email: req.body.email };
  users.push(user);
  res.status(201).json(user);
});

app.put('/users/:id', (req, res) => {
  const user = users.find(u => u.id === parseInt(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.name = req.body.name || user.name;
  user.email = req.body.email || user.email;
  res.json(user);
});

app.delete('/users/:id', (req, res) => {
  const idx = users.findIndex(u => u.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users.splice(idx, 1);
  res.status(204).send();
});

app.listen(3000, () => console.log('Server running on port 3000'));
`.trim(),
  requiredFeatures: [
    { id: 'try-catch', keywords: ['try', 'catch'], description: 'try/catch in route handlers' },
    { id: '404-handler', keywords: ['404', 'not found', 'nenalezen'], description: '404 handler for unknown routes' },
    { id: 'validation', keywords: ['valid', 'name', 'email', '@'], description: 'input validation middleware' },
    { id: 'error-middleware', keywords: ['err', 'error', 'next', 'middleware', 'status(500)'], description: 'central error handler' },
  ],
};

// ── B3.2: Python CLI Completion ─────────────────────────────────────────────

export const B3_2_PYTHON_COMPLETION = {
  id: 'B3.2',
  title: 'Python CLI Completion',
  lang: 'python',
  prompt: `Doplň tento Python CLI nástroj. Existující kód NEMĚŇ, pouze přidej chybějící části:
1. Ošetření prázdného vstupu (prázdný soubor, žádný argument)
2. FileNotFoundError handling (soubor neexistuje → srozumitelná chybová hláška)
3. Help text (--help flag s popisem použití)
4. Ošetření neplatného formátu dat v souboru (invalid JSON → chybová hláška)

Vypiš kompletní soubor se všemi doplněními.`,
  existingCode: `
import json
import sys

def load_data(filepath):
    with open(filepath) as f:
        return json.load(f)

def analyze(data):
    stats = {
        'total': len(data),
        'categories': {},
        'avg_value': 0,
    }
    total_value = 0
    for item in data:
        cat = item.get('category', 'unknown')
        stats['categories'][cat] = stats['categories'].get(cat, 0) + 1
        total_value += item.get('value', 0)
    if data:
        stats['avg_value'] = total_value / len(data)
    return stats

def format_report(stats):
    lines = [
        f"Total items: {stats['total']}",
        f"Average value: {stats['avg_value']:.2f}",
        "Categories:",
    ]
    for cat, count in sorted(stats['categories'].items()):
        lines.append(f"  {cat}: {count}")
    return '\\n'.join(lines)

def main():
    filepath = sys.argv[1]
    data = load_data(filepath)
    stats = analyze(data)
    print(format_report(stats))

if __name__ == '__main__':
    main()
`.trim(),
  requiredFeatures: [
    { id: 'empty-input', keywords: ['empty', 'prázdný', 'no argument', 'žádný', 'len(sys.argv)', 'argc'], description: 'empty input handling' },
    { id: 'file-not-found', keywords: ['filenotfound', 'not found', 'neexist', 'exist', 'os.path'], description: 'file not found handling' },
    { id: 'help-text', keywords: ['--help', 'help', 'usage', 'nápověd', 'použití', 'argparse'], description: 'help flag' },
    { id: 'invalid-json', keywords: ['json', 'invalid', 'parse', 'decode', 'jsondecodeerror', 'neplatn', 'formát'], description: 'invalid JSON handling' },
  ],
};

// ── B4.1: JS Test Generation ────────────────────────────────────────────────

export const B4_1_TEST_GEN = {
  id: 'B4.1',
  title: 'JS Test Generation',
  lang: 'javascript',
  prompt: `Napiš kompletní testy pro tento utility modul. Každá funkce musí mít:
- Alespoň 1 happy-path test
- Alespoň 1 edge-case test (prázdný vstup, null, neplatná data)
Použij libovolný testovací framework (jest, mocha, vitest, nebo čisté assert).`,
  code: `
// utils.js — Utility functions

export function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return re.test(email);
}

export function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\\w\\s-]/g, '')
    .replace(/[\\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const clone = {};
  for (const key of Object.keys(obj)) {
    clone[key] = deepClone(obj[key]);
  }
  return clone;
}

export function chunk(array, size) {
  if (!Array.isArray(array) || size < 1) return [];
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + units[i];
}
`.trim(),
  functions: ['validateEmail', 'slugify', 'deepClone', 'chunk', 'formatBytes'],
};
