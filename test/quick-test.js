#!/usr/bin/env node
// C.3 v28 Quick Test
// ══════════════════════════════════════════════════════════════════════════════

const API = process.env.C3_API || 'http://127.0.0.1:3335';
const sessionId = `test-${Date.now()}`;
const workdir = `/tmp/c3-test-${Date.now()}`;

console.log(`
╔══════════════════════════════════════════════════════════════╗
║  C.3 v28 Quick Test                                          ║
╠══════════════════════════════════════════════════════════════╣
║  API:      ${API.padEnd(47)}║
║  Session:  ${sessionId.padEnd(47)}║
║  Workdir:  ${workdir.padEnd(47)}║
╚══════════════════════════════════════════════════════════════╝
`);

const request = `Vytvoř jednoduchou TODO CLI aplikaci v Node.js.

Cesta: ${workdir}/todo.js
Data: ${workdir}/tasks.json

Funkce:
- add <text> - přidá úkol
- list - vypíše úkoly
- done <id> - označí úkol jako hotový

Příklady použití:
  node todo.js add "Nakoupit"
  node todo.js list
  node todo.js done 1`;

async function call(message) {
  const res = await fetch(`${API}/workflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message, workdir }),
  });
  return res.json();
}

async function run() {
  console.log('[1] Odesílám požadavek...\n');
  let result = await call(request);
  console.log(`State: ${result.state}`);
  
  // Handle Q&A
  if (result.state === 'AUTO_ANSWER') {
    console.log(`\nAuto Answers (${result.auto_answers?.length || 0}):`);
    result.auto_answers?.forEach(a => {
      console.log(`  ✓ ${a.text}`);
      console.log(`    → ${a.answer}`);
    });
    
    console.log('\n[2] Potvrzuji předpoklady...\n');
    result = await call('OK');
    console.log(`State: ${result.state}`);
  }
  
  // Handle ASK_USER
  if (result.state === 'ASK_USER') {
    console.log('\nQuestions for user:');
    result.questions_for_user?.forEach((q, i) => {
      console.log(`  ${i+1}. ${q.text}`);
    });
    
    console.log('\n[2] Používám suggested answers...\n');
    const answers = result.questions_for_user?.map(q => q.suggested_answer || 'default').join('\n');
    result = await call(answers || 'OK');
    console.log(`State: ${result.state}`);
  }
  
  // Handle PLAN_REVIEW
  if (result.state === 'PLAN_REVIEW') {
    console.log('\n--- Plan Preview ---');
    console.log(result.plan?.substring(0, 1000) || 'No plan preview');
    console.log('--- End Preview ---\n');
    
    console.log('[3] Potvrzuji plán...\n');
    result = await call('OK');
    console.log(`State: ${result.state}`);
  }
  
  // Wait for completion or handle more states
  let iterations = 0;
  while (result.state !== 'DONE' && result.state !== 'ERROR' && iterations < 10) {
    iterations++;
    console.log(`State: ${result.state} (waiting...)`);
    
    if (result.state === 'PLAN_REVIEW') {
      result = await call('OK');
    } else if (result.state === 'AUTO_ANSWER') {
      result = await call('OK');
    } else {
      await new Promise(r => setTimeout(r, 2000));
      const status = await fetch(`${API}/workflow/${sessionId}`);
      result = await status.json();
    }
  }
  
  // Final result
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  RESULT: ${result.state.padEnd(51)}║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  
  if (result.state === 'DONE') {
    console.log('║  Files created:                                              ║');
    (result.files || []).forEach(f => {
      console.log(`║    • ${f.padEnd(54)}║`);
    });
    console.log('║                                                              ║');
    console.log(`║  Total time: ${(result.summary?.totalTime || '-').padEnd(47)}║`);
  } else if (result.error) {
    console.log(`║  Error: ${result.error.substring(0, 52).padEnd(52)}║`);
  }
  
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  // Test the created app
  if (result.state === 'DONE' && result.files?.some(f => f.includes('todo.js'))) {
    console.log('Testing created app...\n');
    
    const { execSync } = await import('child_process');
    
    try {
      console.log('$ node todo.js add "Test task"');
      execSync(`cd ${workdir} && node todo.js add "Test task"`, { stdio: 'inherit' });
      
      console.log('\n$ node todo.js list');
      execSync(`cd ${workdir} && node todo.js list`, { stdio: 'inherit' });
      
      console.log('\n$ node todo.js done 1');
      execSync(`cd ${workdir} && node todo.js done 1`, { stdio: 'inherit' });
      
      console.log('\n$ node todo.js list');
      execSync(`cd ${workdir} && node todo.js list`, { stdio: 'inherit' });
      
      console.log('\n✅ App works correctly!');
    } catch (err) {
      console.log('\n❌ App test failed:', err.message);
    }
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
