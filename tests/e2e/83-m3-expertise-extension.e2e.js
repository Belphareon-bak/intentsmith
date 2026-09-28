import {
  suite,
  testAsync,
  assert,
  assertEqual,
  summary,
  api,
  waitForServer,
} from './_helpers.js';

await waitForServer();

const ID = 'm3-http-project-guide';
const MARKER = 'M3_HTTP_PROJECT_GUIDE_MARKER';
const query = 'modularhttpcanary extensionhttpprobe';
const manifest = {
  contract: 'ExtensionManifest',
  version: 1,
  kind: 'expertise',
  id: ID,
  moduleVersion: '1.0.0',
  coreContract: '>=136.0.0 <137.0.0',
  requiredCapabilities: [],
  optionalCapabilities: [],
  payload: {
    definition: {
      name: 'M3 HTTP Project Guide',
      description: 'HTTP-visible deterministic expertise extension fixture',
      domain: 'project_guidance',
      systemPrompt: `${MARKER}: use verified repository evidence.`,
      temperature: 0.2,
      modules: {
        domain_rules: ['Use repository evidence before recommendations'],
        emphasis: ['Verified project state'],
        constraints: ['Do not invent file contents'],
        vocabulary: ['modularhttpcanary', 'extensionhttpprobe'],
        antipatterns: ['Unsupported project claims'],
        disclaimer: null,
      },
    },
    enabledByDefault: false,
  },
};

try {
  await api('DELETE', `/api/extensions/expertises/${ID}`);

  suite('M3 expertise extension — install and disabled baseline');

  await testAsync('install persists without participating in routing', async () => {
    const installed = await api('POST', '/api/extensions/expertises/install', { manifest });
    assertEqual(installed.status, 201);
    assertEqual(installed.data.ok, true);
    assertEqual(installed.data.extension.status, 'disabled');

    const route = await api('POST', '/api/expertises/route', { message: query });
    assertEqual(route.status, 200);
    assertEqual(route.data.expertId, null);

    const chat = await api('POST', '/api/chat', {
      conversation_id: `m3-disabled-${Date.now()}`,
      message: query,
      expertise_id: ID,
    });
    assertEqual(chat.status, 404);
    assert(String(chat.data.error).includes(ID), 'disabled expertise is unavailable to chat');
  });

  suite('M3 expertise extension — enabled influence');

  await testAsync('enable changes deterministic routing and exposed expertise definition', async () => {
    const enabled = await api('POST', `/api/extensions/expertises/${ID}/enable`);
    assertEqual(enabled.status, 200);
    assertEqual(enabled.data.extension.status, 'enabled');

    const route = await api('POST', '/api/expertises/route', { message: query });
    assertEqual(route.status, 200);
    assertEqual(route.data.expertId, ID);
    assertEqual(route.data.expertName, manifest.payload.definition.name);

    const detail = await api('GET', `/api/expertises/${ID}`);
    assertEqual(detail.status, 200);
    assert(detail.data.systemPrompt.includes(MARKER), 'enabled definition carries prompt influence');
  });

  suite('M3 expertise extension — disable and remove');

  await testAsync('disable and remove both eliminate routing participation', async () => {
    const disabled = await api('POST', `/api/extensions/expertises/${ID}/disable`);
    assertEqual(disabled.status, 200);
    assertEqual(disabled.data.extension.status, 'disabled');
    const afterDisable = await api('POST', '/api/expertises/route', { message: query });
    assertEqual(afterDisable.data.expertId, null);

    const reenabled = await api('POST', `/api/extensions/expertises/${ID}/enable`);
    assertEqual(reenabled.status, 200);
    const removed = await api('DELETE', `/api/extensions/expertises/${ID}`);
    assertEqual(removed.status, 200);
    assertEqual(removed.data.removed, true);

    const list = await api('GET', '/api/extensions/expertises');
    assertEqual(list.status, 200);
    assert(!list.data.extensions.some((extension) => extension.id === ID), 'removed extension is absent');
    const afterRemove = await api('POST', '/api/expertises/route', { message: query });
    assertEqual(afterRemove.data.expertId, null);
  });
} finally {
  await api('DELETE', `/api/extensions/expertises/${ID}`);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
