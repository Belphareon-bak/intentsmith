// Sprint D v2 — fixed test

const PROJECT_SELF_PATTERNS = [
  /(?:jaký|jaká|jaké) je stav projektu/i, /stav projektu/i,
  /(?:co|jaký|jaká) je cíl (?:tohoto |)projektu/i, /cíl projektu/i,
  /na čem (?:pracujeme|děláme|pracuji)/i,
  /(?:co|jak) (?:děláme|dělám) (?:v |na |)(?:tomto |)projekt/i,
  /(?:shrň|shrnout|popiš) projekt/i, /(?:info|informace) o projektu/i,
  /co je (?:v |)(?:tomto |)projektu/i, /aktivní soubor/i,
  /na jakém souboru/i, /(?:jaké|které) soubory/i,
  /(?:what is |what's )(?:the )?(?:project |)status/i,
  /(?:what is |what's )(?:the )?(?:project |)goal/i,
  /what are we (?:working on|doing)/i,
  /(?:project |)(?:summary|overview|info)/i,
  /(?:describe|summarize) (?:the |this |)project/i,
  /active file/i, /which files? (?:are|is)/i,
];

function isProjectSelfQuery(input) {
  return PROJECT_SELF_PATTERNS.some(p => p.test(input));
}

const tests = [
  ['Jaký je stav projektu?', true, 'STOP/GO: project status CZ'],
  ['Na čem pracujeme?', true, 'working on CZ'],
  ['What is the project status?', true, 'project status EN'],
  ['What are we working on?', true, 'working on EN'],
  ['Project summary', true, 'summary EN'],
  ['Shrň projekt', true, 'summarize CZ'],
  ['Informace o projektu', true, 'project info'],
  ['Aktivní soubor', true, 'active file CZ'],
  ['Active file', true, 'active file EN'],
  ['Najdi článek o AI', false, 'STOP/GO: web search NOT intercepted'],
  ['Kdo je Elon Musk?', false, 'factual → not intercepted'],
  ['Oprav tenhle bug', false, 'code request → not intercepted'],
  ['Hello', false, 'greeting → not intercepted'],
  ['Co je to AI?', false, 'general knowledge → not intercepted'],
];

let p1 = 0, f1 = 0;
for (const [input, expected, desc] of tests) {
  const r = isProjectSelfQuery(input);
  if (r === expected) p1++; else { f1++; console.log(`  ❌ ${desc}: "${input}" → ${r}`); }
}

// Response builder
function buildResponse(project, wm) {
  const parts = [];
  parts.push(`📂 **${project.name}**`);
  if (project.path) parts.push(`Cesta: \`${project.path}\``);
  if (wm?.goal) parts.push(`\n🎯 **Cíl:** ${wm.goal}`);
  else parts.push(`\n🎯 **Cíl:** Zatím nenastavený.`);
  if (wm?.activeFile) parts.push(`📄 **Aktivní soubor:** \`${wm.activeFile}\``);
  if (wm?.driftCount > 0) parts.push(`⚠️ **Drift:** ${wm.driftCount}`);
  return parts.join('\n');
}

const rTests = [
  { desc: 'Full WM', p: { name: 'C3', path: '/c3' }, wm: { goal: 'Build', activeFile: 'x.js', driftCount: 2 },
    check: r => r.includes('C3') && r.includes('Build') && r.includes('x.js') && r.includes('Drift') },
  { desc: 'Empty WM', p: { name: 'New' }, wm: {},
    check: r => r.includes('New') && r.includes('nenastavený') },
  { desc: 'Goal only', p: { name: 'T' }, wm: { goal: 'Fix' },
    check: r => r.includes('Fix') && !r.includes('soubor') },
];

let p2 = 0, f2 = 0;
for (const { desc, p, wm, check } of rTests) {
  const r = buildResponse(p, wm);
  if (check(r)) p2++; else { f2++; console.log(`  ❌ [resp] ${desc}`); }
}

const total = p1+p2, totalF = f1+f2;
console.log(`\n══════════════════════════════`);
console.log(`  Sprint D: ${total}/${total+totalF} PASS, ${totalF} FAIL`);
console.log(`  intercept: ${p1}/${p1+f1}`);
console.log(`  response:  ${p2}/${p2+f2}`);
console.log(`══════════════════════════════`);
if (totalF === 0) console.log('✅ ALL SPRINT D TESTS PASS');
