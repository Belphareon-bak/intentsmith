import './helpers/isolated-test-db.js';
import { installOllamaLoopbackFetchBoundary } from './helpers/ollama-loopback-fetch-boundary.js';

installOllamaLoopbackFetchBoundary({ reportOnExit: true });

// C3-Agent v57.3 — English Conversation Tests (10 × 15+ steps)
// ══════════════════════════════════════════════════════════════════════════════
//
// 10 multi-turn English conversations through full ChatController.handle() pipeline.
// Each conversation has 15+ steps mixing CONVERSATIONAL, LOCAL, SEARCH, CREATIVE, CODE.
//
// Run: OLLAMA_URL=http://127.0.0.1:11434 node tests/conv-english.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

let totalSteps = 0;
let passedSteps = 0;
let failedSteps = 0;
const failures = [];

function printStep(convNum, step, input, response, meta = {}) {
  totalSteps++;
  const mode = meta.mode || '?';
  const model = meta.model || 'local';
  const dur = meta.duration || 0;
  const short = response.length > 300 ? response.substring(0, 300) + '...' : response;
  console.log(`  [${convNum}.${String(step).padStart(2, '0')}] \x1b[36m(${mode})\x1b[0m \x1b[90m${input.substring(0, 60)}\x1b[0m`);
  console.log(`         \x1b[33m${short}\x1b[0m`);
  if (model !== 'local') console.log(`         \x1b[90m[${model} ${dur}ms]\x1b[0m`);
  passedSteps++;
}

function failStep(convNum, step, input, error) {
  totalSteps++;
  failedSteps++;
  console.log(`  [${convNum}.${String(step).padStart(2, '0')}] \x1b[31mFAIL ${input.substring(0, 60)}\x1b[0m`);
  console.log(`         \x1b[31m${error}\x1b[0m`);
  failures.push({ conv: convNum, step, input, error });
}

async function setupPipeline() {
  const { resetConversationStore, getConversationStore } = await import('../src/chat/conversation-store.js');
  resetConversationStore();
  getConversationStore(null);
  const { ChatController } = await import('../src/chat/controller.js');
  const { getDefaultHandlers } = await import('../src/chat/handlers/index.js');
  ChatController.configure({
    handlers: getDefaultHandlers(),
    config: { autoModeDetection: true, modeConfidenceThreshold: 0.6 },
  });
  return ChatController;
}

async function runConversation(ChatController, convNum, title, messages) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  Conversation ${convNum}: ${title}`);
  console.log(`${'═'.repeat(70)}`);

  const sessionId = `conv-en-${convNum}-${Date.now()}`;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    try {
      const result = await ChatController.handle({ message: msg, sessionId });
      if (!result.response) throw new Error('Empty response');
      // Detect graceful error messages that mask real failures
      const resp = result.response;
      if (/LLM failed|fetch failed|circuit breaker|error processing|could not process|Failed to process|No search results|toJSON is not a function/i.test(resp)) {
        throw new Error(`Pipeline error: ${resp.substring(0, 150)}`);
      }
      printStep(convNum, i + 1, msg, resp, {
        mode: result.mode,
        model: result.metadata?.model,
        duration: result.metadata?.duration,
      });
    } catch (err) {
      failStep(convNum, i + 1, msg, err.message);
    }
  }

  ChatController.removeSession(sessionId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pre-check
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(70)}`);
console.log('  ENGLISH CONVERSATION TESTS (10 × 15+ steps)');
console.log(`${'═'.repeat(70)}`);

let ollamaOk = false;
try { const r = await fetch(`${OLLAMA_URL}/api/tags`); ollamaOk = r.ok; } catch { /* */ }
if (!ollamaOk) { console.error('Ollama not available (HTTP check failed)'); process.exit(1); }

// Real LLM check — generate a single token to verify GPU/model is loaded
let llmOk = false;
try {
  const r = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'qwen3.5:27b', prompt: 'Say OK', stream: false, options: { num_predict: 5 } }),
  });
  llmOk = r.ok && (await r.json()).response?.length > 0;
} catch { /* */ }
if (!llmOk) { console.error('Ollama running but LLM model not responding (GPU not ready?)'); process.exit(1); }
console.log('  Ollama + LLM OK\n');

const _origLog = console.log;
const _origInfo = console.info;
const suppressPatterns = /\[C3:|CRE Decision|HandleToolCall|ToolExecutor|WebSearch|SearchMetrics|HandleLocal|ConversationHandler|HandleAskUser|DB\]/;
console.log = (...args) => { if (!suppressPatterns.test(String(args[0]))) _origLog(...args); };
console.info = (...args) => { if (!suppressPatterns.test(String(args[0]))) _origInfo(...args); };

const ChatController = await setupPipeline();

// ═══════════════════════════════════════════════════════════════════════════════
// 10 conversations
// ═══════════════════════════════════════════════════════════════════════════════

await runConversation(ChatController, 1, 'Smalltalk + math + date', [
  'Hello! How are you?',
  'What do you think about artificial intelligence?',
  'What day is today?',
  '347 * 12',
  '99 + 1',
  'When is the next full moon?',
  'What time is it?',
  'Thanks for the info. What do you think about the future of AI?',
  '1024 / 16',
  'What is today\'s date?',
  'What is a neural network?',
  'How many days until Christmas?',
  '55 * 55',
  'And what about quantum computing?',
  'Thanks, that was interesting!',
]);

await runConversation(ChatController, 2, 'Programming and code', [
  'Hi, I need help with programming.',
  'What do you think about Python as a first language?',
  'Write me a function to calculate factorial in Python.',
  'And what about a recursive version?',
  '10 * 9 * 8',
  'What is the difference between a list and a tuple in Python?',
  'Come up with a name for a data processing library.',
  'Write me a simple HTTP server in Node.js.',
  '2 * 512',
  'What is a REST API?',
  'How would you compare TypeScript and JavaScript?',
  'Write me a regex for email validation.',
  'What is Big O notation?',
  '1000 - 777',
  'Thanks for everything!',
]);

await runConversation(ChatController, 3, 'Travel and geography', [
  'Hello! I would like to learn about travel.',
  'What is the capital of Italy?',
  'What would you recommend visiting in Rome?',
  'What time is it?',
  'What day is today?',
  '500 * 3',
  'What about Japan? Is it worth visiting?',
  'What is the capital of Japan?',
  'Come up with a 3-day itinerary for Prague.',
  '120 * 24',
  'What do you think about train travel vs flying?',
  'When is the next full moon?',
  'What are the most beautiful castles in Europe?',
  '250 + 750',
  'Thanks for the tips!',
]);

await runConversation(ChatController, 4, 'Science and education', [
  'Hi, I am interested in science.',
  'What is photosynthesis?',
  'And how does gravity work?',
  'What is the speed of light?',
  '299792 * 2',
  'What is DNA?',
  'What is the difference between an atom and a molecule?',
  'How many planets does our solar system have?',
  'Come up with an interesting science experiment for kids.',
  'What day is today?',
  'What is the periodic table of elements?',
  '273 + 15',
  'Who invented the light bulb?',
  'What do you think about space exploration?',
  'Thanks, that was educational!',
]);

await runConversation(ChatController, 5, 'Cooking and recipes', [
  'Hello! I want to learn how to cook.',
  'What do you think about Italian cuisine?',
  'What is your favorite pasta recipe?',
  '250 * 4',
  'Come up with an original dessert recipe.',
  'What time is it?',
  'What do I need to make a good risotto?',
  'And how long does it take to cook?',
  '180 * 3',
  'What is the difference between baking and grilling?',
  'Come up with a weekly meal plan.',
  'What day is today?',
  'What do you think about vegan food?',
  '350 + 275',
  'Thanks for the advice, I\'ll go cook!',
]);

await runConversation(ChatController, 6, 'Business and startups', [
  'Hi, I am thinking about starting a company.',
  'What do you think about tech startups?',
  'Come up with a name for a technology startup.',
  'What are the main steps to founding a company?',
  '15000 * 12',
  'What day is today?',
  'What is an MVP in the context of startups?',
  'Come up with an elevator pitch for a food sharing app.',
  '1000000 / 12',
  'What are the current trends in IT business?',
  'What do you think about remote work?',
  'When is the next full moon?',
  'What time is it?',
  'What skills does a good entrepreneur need?',
  'Thanks, you inspired me!',
]);

await runConversation(ChatController, 7, 'Movies, music and culture', [
  'Hello! Let\'s talk about culture.',
  'What do you think about modern cinema?',
  'What is your favorite movie genre?',
  'Come up with a plot for a short film.',
  'What day is today?',
  '120 * 25',
  'What is streaming?',
  'What classic films would you recommend?',
  'What do you think about social media\'s impact on culture?',
  'Come up with a name for a tech podcast.',
  'What time is it?',
  'What is jazz?',
  '1900 + 126',
  'What is the role of art in society?',
  'Thanks for the inspiring conversation!',
]);

await runConversation(ChatController, 8, 'Health and fitness', [
  'Hi, I want to start exercising.',
  'What do you think about running?',
  'How many calories do you burn in an hour of running?',
  '500 * 7',
  'Come up with a training plan for a beginner.',
  'What day is today?',
  'What is more important, cardio or strength training?',
  'How much water should I drink per day?',
  '2000 + 500',
  'What do you think about intermittent fasting?',
  'What are the best stretching exercises?',
  'What time is it?',
  'When is the next full moon?',
  'How can I avoid injuries while exercising?',
  'Thanks for the motivation!',
]);

await runConversation(ChatController, 9, 'History and society', [
  'Hello, I am interested in history.',
  'When was the United States founded?',
  'What happened in 1969?',
  'What day is today?',
  '2026 - 1776',
  'Who was the first president of the United States?',
  'What do you think about history\'s influence on the present?',
  'Come up with a plot for a historical novel set in London.',
  '1918 + 20',
  'What is the Renaissance?',
  'What are the most important inventions of the 20th century?',
  'What time is it?',
  'What do you think about teaching history in schools?',
  'When is the next full moon?',
  'Thanks, history is fascinating!',
]);

await runConversation(ChatController, 10, 'Technology and the future', [
  'Hello! What is new in technology?',
  'What do you think about electric vehicles?',
  'What day is today?',
  '2050 - 2026',
  'What is blockchain?',
  'Come up with a concept for a smart home of the future.',
  '1024 * 1024',
  'What do you think about robotics?',
  'Write me a simple automation script in Bash.',
  'What time is it?',
  'What technologies will change the world in the next 10 years?',
  'What is IoT?',
  '365 * 24',
  'When is the next full moon?',
  'Thanks for the great conversation about the future!',
]);

// ═══════════════════════════════════════════════════════════════════════════════

console.log = _origLog;
console.info = _origInfo;

console.log(`\n${'═'.repeat(70)}`);
console.log(`  RESULTS: ${passedSteps} OK, ${failedSteps} FAIL, ${totalSteps} total`);
if (failures.length > 0) {
  console.log(`\n  FAILURES:`);
  for (const f of failures) {
    console.log(`    [${f.conv}.${f.step}] ${f.input}: ${f.error}`);
  }
}
console.log(`${'═'.repeat(70)}\n`);
process.exit(failedSteps > 0 ? 1 : 0);
