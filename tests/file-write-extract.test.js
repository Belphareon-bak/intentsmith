// tests/file-write-extract.test.js — v131: FILE_WRITE content extraction from user input
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import { _extractUserContent } from '../src/chat/handlers/file.js';

// ═══════════════════════════════════════════════════════════════════════════════
suite('_extractUserContent — Czech save commands');
// ═══════════════════════════════════════════════════════════════════════════════

test('strips "zapis to do planu" and returns content', () => {
  const input = 'mam novy update pro aplikaci, chcia by byla schopna ovladat desktop, zapis to do planu';
  const result = _extractUserContent(input);
  assertEqual(result, 'mam novy update pro aplikaci, chcia by byla schopna ovladat desktop');
});

test('strips "ulož to do souboru" and returns content', () => {
  const input = 'tohle je důležitá poznámka o architektuře projektu, ulož to do souboru';
  const result = _extractUserContent(input);
  assertEqual(result, 'tohle je důležitá poznámka o architektuře projektu');
});

test('strips "napiš to do notes.md" and returns content', () => {
  const input = 'seznam úkolů: 1. refaktor DB, 2. testy, 3. deploy, napiš to do notes.md';
  const result = _extractUserContent(input);
  assertEqual(result, 'seznam úkolů: 1. refaktor DB, 2. testy, 3. deploy');
});

test('strips "ulož ho do planu" (masculine pronoun)', () => {
  const input = 'nový požadavek na API endpoint pro uživatele, ulož ho do planu';
  const result = _extractUserContent(input);
  assertEqual(result, 'nový požadavek na API endpoint pro uživatele');
});

test('strips "dej to do souboru" variant', () => {
  const input = 'přidáme podporu pro tmavý režim v aplikaci, dej to do souboru';
  const result = _extractUserContent(input);
  assertEqual(result, 'přidáme podporu pro tmavý režim v aplikaci');
});

test('strips "a zapis to do planu" (with conjunction)', () => {
  const input = 'chci přidat ovládání desktopu a zapis to do planu';
  const result = _extractUserContent(input);
  assertEqual(result, 'chci přidat ovládání desktopu');
});

test('strips "a ulož to" (conjunction, no target)', () => {
  const input = 'tohle je plán na sprint 5, a ulož to';
  const result = _extractUserContent(input);
  assertEqual(result, 'tohle je plán na sprint 5');
});

test('handles "zapsat" (infinitive) variant', () => {
  const input = 'potřebuju REST API s autentizací, zapsat to do souboru';
  const result = _extractUserContent(input);
  assert(result !== null, 'should extract content');
  assert(!result.includes('zapsat'), 'should not include save command');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('_extractUserContent — English save commands');
// ═══════════════════════════════════════════════════════════════════════════════

test('strips "save it to plan.md" and returns content', () => {
  const input = 'new feature: desktop control via WebSocket API, save it to plan.md';
  const result = _extractUserContent(input);
  assertEqual(result, 'new feature: desktop control via WebSocket API');
});

test('strips "write this to notes" and returns content', () => {
  const input = 'implementation notes for the auth module with JWT tokens, write this to notes';
  const result = _extractUserContent(input);
  assertEqual(result, 'implementation notes for the auth module with JWT tokens');
});

test('strips "save that" with no target', () => {
  const input = 'the meeting summary with all action items listed above, save that';
  const result = _extractUserContent(input);
  assertEqual(result, 'the meeting summary with all action items listed above');
});

test('strips "and save it to output.md"', () => {
  const input = 'API design: GET /users, POST /users, DELETE /users/:id, and save it to output.md';
  const result = _extractUserContent(input);
  assertEqual(result, 'API design: GET /users, POST /users, DELETE /users/:id');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('_extractUserContent — edge cases');
// ═══════════════════════════════════════════════════════════════════════════════

test('returns null for empty input', () => {
  assertEqual(_extractUserContent(''), null);
  assertEqual(_extractUserContent(null), null);
  assertEqual(_extractUserContent(undefined), null);
});

test('returns null for save-only command (no content)', () => {
  const result = _extractUserContent('ulož to');
  assertEqual(result, null, 'bare "ulož to" has no meaningful content after stripping');
});

test('returns null for short content after stripping', () => {
  const result = _extractUserContent('ok, ulož to do planu');
  assertEqual(result, null, '"ok" is too short (<10 chars)');
});

test('returns null when no save pattern matches', () => {
  const result = _extractUserContent('toto je jen normální zpráva bez příkazu k uložení');
  assertEqual(result, null, 'no save command to strip');
});

test('does not strip save command from the middle of input', () => {
  // "ulož to" should only be stripped from the END, not the middle
  const input = 'řekl mi, že chce ulož to do databáze, ale my to neděláme takhle';
  const result = _extractUserContent(input);
  // No pattern should match at the end → returns null
  assertEqual(result, null);
});

test('preserves content that mentions saving conceptually', () => {
  // The word "save" is conceptual, not a command
  const input = 'we need to implement auto-save for the editor component before launch';
  const result = _extractUserContent(input);
  assertEqual(result, null, 'no command suffix to strip');
});

test('handles input with semicolon separator', () => {
  const input = 'nová funkcionalita: export do PDF; ulož to do planu';
  const result = _extractUserContent(input);
  assertEqual(result, 'nová funkcionalita: export do PDF');
});

test('handles input with period separator', () => {
  const input = 'Potřebujeme migraci databáze na PostgreSQL. Zapiš to do planu';
  const result = _extractUserContent(input);
  assertEqual(result, 'Potřebujeme migraci databáze na PostgreSQL');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('_extractUserContent — real-world bug reproducer');
// ═══════════════════════════════════════════════════════════════════════════════

test('exact bug reproducer: "mam novy update pro aplikaci, chcia by byla schopna ovladat desktop, zapis to do planu"', () => {
  const input = 'mam novy update pro aplikaci, chcia by byla schopna ovladat desktop, zapis to do planu';
  const result = _extractUserContent(input);
  assert(result !== null, 'should extract content');
  assert(result.includes('ovladat desktop'), 'should contain the key feature');
  assert(!result.includes('zapis'), 'should not contain save command');
  assert(result.length > 20, 'should have meaningful content length');
});

// ═══════════════════════════════════════════════════════════════════════════════

const { passed, failed } = summary();
process.exit(failed > 0 ? 1 : 0);
