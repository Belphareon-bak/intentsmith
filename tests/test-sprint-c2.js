// Sprint C2 — Synthesis Context + SandboxPath Isolation tests

// ═══════ #11: buildConversationContext ═══════

function buildConversationContext(history) {
  if (!history || !Array.isArray(history) || history.length === 0) return null;
  return history.slice(-3).map(h => ({
    userInput: h.userInput || null,
    assistantSummary: h.response?.content
      ? h.response.content.substring(0, 150) + (h.response.content.length > 150 ? '...' : '')
      : null,
  })).filter(t => t.userInput || t.assistantSummary);
}

const ctxTests = [
  {
    desc: 'Proper user+assistant pairs',
    history: [
      { userInput: 'Řekni mi o Pythagorovi', response: { content: 'Pythagoras byl starořecký matematik...' } },
    ],
    check: (ctx) => ctx?.length === 1 && ctx[0].userInput === 'Řekni mi o Pythagorovi' && ctx[0].assistantSummary.includes('Pythagoras'),
  },
  {
    desc: 'Truncates long responses',
    history: [
      { userInput: 'Test', response: { content: 'A'.repeat(300) } },
    ],
    check: (ctx) => ctx?.[0].assistantSummary.length <= 155 && ctx[0].assistantSummary.endsWith('...'),
  },
  {
    desc: 'Max 3 turns',
    history: [
      { userInput: 'T1', response: { content: 'R1' } },
      { userInput: 'T2', response: { content: 'R2' } },
      { userInput: 'T3', response: { content: 'R3' } },
      { userInput: 'T4', response: { content: 'R4' } },
    ],
    check: (ctx) => ctx?.length === 3 && ctx[0].userInput === 'T2',
  },
  {
    desc: 'Empty history → null',
    history: [],
    check: (ctx) => ctx === null,
  },
  {
    desc: 'Null history → null',
    history: null,
    check: (ctx) => ctx === null,
  },
  {
    desc: 'Old format (no userInput) still works',
    history: [
      { response: { content: 'Some response', tag: { speaker: 'system' } } },
    ],
    check: (ctx) => ctx?.length === 1 && ctx[0].userInput === null && ctx[0].assistantSummary.includes('Some response'),
  },
];

let p1 = 0, f1 = 0;
for (const { desc, history, check } of ctxTests) {
  const ctx = buildConversationContext(history);
  if (check(ctx)) p1++;
  else { f1++; console.log(`  ❌ [context] ${desc}: ${JSON.stringify(ctx)?.substring(0, 100)}`); }
}

// ═══════ #11: buildSynthesisPrompt with conversationContext ═══════

function buildSynthesisPrompt({ query, conversationContext = null }) {
  let prompt = `User query: "${query}"\n\n`;
  if (conversationContext && conversationContext.length > 0) {
    prompt += `Recent conversation context:\n`;
    for (const turn of conversationContext.slice(-3)) {
      if (turn.userInput) prompt += `  User: ${turn.userInput}\n`;
      if (turn.assistantSummary) prompt += `  Assistant: ${turn.assistantSummary}\n`;
    }
    prompt += `\n`;
  }
  prompt += `Intent: SEARCH\n\n`;
  return prompt;
}

const promptTests = [
  {
    desc: 'STOP/GO: "A co jeho teorém?" with Pythagoras context',
    query: 'A co jeho teorém?',
    ctx: [{ userInput: 'Řekni mi o Pythagorovi', assistantSummary: 'Pythagoras byl starořecký matematik...' }],
    check: (p) => p.includes('Pythagorovi') && p.includes('A co jeho teorém?'),
  },
  {
    desc: 'No context → no context block',
    query: 'Co je to AI?',
    ctx: null,
    check: (p) => !p.includes('conversation context') && p.includes('Co je to AI?'),
  },
  {
    desc: 'Empty context array → no context block',
    query: 'Test',
    ctx: [],
    check: (p) => !p.includes('conversation context'),
  },
];

let p2 = 0, f2 = 0;
for (const { desc, query, ctx, check } of promptTests) {
  const prompt = buildSynthesisPrompt({ query, conversationContext: ctx });
  if (check(prompt)) p2++;
  else { f2++; console.log(`  ❌ [prompt] ${desc}: ${prompt.substring(0, 120)}`); }
}

// ═══════ #9: SandboxPath isolation ═══════

// Simulate tool executor state
class MockExecutor {
  constructor() { this.projectRootPath = null; }
  setProjectContext(p) { this.projectRootPath = p?.path || null; }
  clearProjectContext() { this.projectRootPath = null; }

  execute(context) {
    if (context.project && context.project.path) {
      this.setProjectContext(context.project);
    } else if (context.projectPath) {
      this.setProjectContext({ path: context.projectPath });
    } else {
      this.clearProjectContext(); // v56.2 fix
    }
    return this.projectRootPath;
  }
}

const sandboxTests = [
  {
    desc: 'Project context sets path',
    sequence: [{ project: { path: '/tmp/test' } }],
    expectedFinal: '/tmp/test',
  },
  {
    desc: 'Non-project clears path',
    sequence: [
      { project: { path: '/tmp/test' } },
      { /* no project */ },
    ],
    expectedFinal: null,
  },
  {
    desc: 'STOP/GO: Non-project after project → no sandbox leak',
    sequence: [
      { project: { path: '/tmp/proj1' } },
      { sessionId: 'chat-abc' },
      { sessionId: 'chat-xyz' },
    ],
    expectedFinal: null,
  },
  {
    desc: 'Project → non-project → project',
    sequence: [
      { project: { path: '/tmp/p1' } },
      { sessionId: 'chat' },
      { project: { path: '/tmp/p2' } },
    ],
    expectedFinal: '/tmp/p2',
  },
];

let p3 = 0, f3 = 0;
for (const { desc, sequence, expectedFinal } of sandboxTests) {
  const exec = new MockExecutor();
  let result;
  for (const ctx of sequence) {
    result = exec.execute(ctx);
  }
  if (result === expectedFinal) p3++;
  else { f3++; console.log(`  ❌ [sandbox] ${desc}: "${result}" !== "${expectedFinal}"`); }
}

// ═══════ SUMMARY ═══════
const total = p1+p2+p3;
const totalF = f1+f2+f3;
console.log(`\n══════════════════════════════`);
console.log(`  Sprint C2: ${total}/${total+totalF} PASS, ${totalF} FAIL`);
console.log(`  context:  ${p1}/${p1+f1}`);
console.log(`  prompt:   ${p2}/${p2+f2}`);
console.log(`  sandbox:  ${p3}/${p3+f3}`);
console.log(`══════════════════════════════`);
if (totalF === 0) console.log('✅ ALL SPRINT C2 TESTS PASS');
