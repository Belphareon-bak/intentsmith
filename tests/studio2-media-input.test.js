import './helpers/isolated-test-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LiveModel } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/view/live-model.js');
const { SessionStore } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/session-store.js');
const { AppearanceStore } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/appearance-store.js');
const { default: database } = await import('../src/db/database.js');
const { createMediaRoutes } = await import('../src/routes/media.js');
const { decodeInputImage } = await import('../src/media/input-image.js');
const { ComfyUIConnector } = await import('../src/media/comfyui-connector.js');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WZqhP8AAAAASUVORK5CYII=', 'base64');
const dataUrl = 'data:image/png;base64,' + png.toString('base64');

test('ComfyUI connector sends a local multipart image and verifies the returned filename', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:8188/upload/image');
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('type'), 'input');
      assert.equal(options.body.get('overwrite'), 'false');
      const file = options.body.get('image');
      assert.equal(file.type, 'image/png');
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
      return { ok: true, json: async () => ({ name: file.name, subfolder: '', type: 'input' }) };
    };
    const connector = new ComfyUIConnector();
    assert.match(await connector.uploadInputImage(png, 'image/png', 'png'), /^intentsmith-input-.*\.png$/);
    globalThis.fetch = async () => ({ ok: true,
      json: async () => ({ name: '../outside.png', subfolder: '', type: 'input' }) });
    await assert.rejects(connector.uploadInputImage(png, 'image/png', 'png'), /invalid input-image receipt/);
  } finally { globalThis.fetch = original; }
});

test('image input route rejects arbitrary paths, accepts bounded bytes and consumes one upload receipt', async () => {
  assert.equal(decodeInputImage(dataUrl).mime, 'image/png');
  assert.throws(() => decodeInputImage('data:image/png;base64,' + Buffer.from('shell script').toString('base64')));
  const uploads = [];
  const routes = createMediaRoutes({ db: database, parseBody: async req => req.body,
    sendJSON: (res, status, body) => { res.status = status; res.body = body; },
    safeError: error => ({ error: error.message }), logger: { info() {}, warn() {}, error() {} },
    comfyuiConnector: { isAvailable: async () => ({ available: true }),
      uploadInputImage: async (bytes, mime, extension) => {
        uploads.push([bytes.length, mime, extension]);
        return 'intentsmith-input-test.png';
      } },
    vramManager: { acquire: () => Promise.resolve() /* GPU callback deliberately not run. */ }, mediaStorage: {} });
  const call = async (key, body) => {
    const res = {};
    await routes[key]({ body }, res);
    return res;
  };
  let result = await call('POST /api/media/input-image', { dataUrl: 'data:image/png;base64,AA==' });
  assert.equal(result.status, 400);
  assert.equal(uploads.length, 0);
  result = await call('POST /api/media/input-image', { dataUrl });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(uploads, [[png.length, 'image/png', 'png']]);
  const inputId = result.body.inputId;
  const params = { width: 512, height: 512, steps: 20, cfg_scale: 7, seed: -1, model: 'real.safetensors' };
  result = await call('POST /api/media/generate', { type: 'img2img', prompt: 'Uprav tento obraz', params });
  assert.equal(result.status, 409, 'an img2img generation needs an upload receipt');
  result = await call('POST /api/media/generate', { type: 'img2img', prompt: 'Uprav tento obraz',
    inputId, params: { ...params, input_image: '../../outside.png' } });
  assert.equal(result.status, 400, 'a caller cannot supply a ComfyUI filename');
  result = await call('POST /api/media/generate', { type: 'img2img', prompt: 'Uprav tento obraz', inputId, params });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const row = database.db.prepare('SELECT params FROM media_generations WHERE id = ?').get(result.body.generationId);
  assert.equal(JSON.parse(row.params).input_image, 'intentsmith-input-test.png');
  result = await call('POST /api/media/generate', { type: 'img2img', prompt: 'Znovu', inputId, params });
  assert.equal(result.status, 409, 'the receipt cannot be replayed');
});

test('Studio image-to-image form uploads file bytes then submits only the backend receipt', async () => {
  const saved = [];
  const id = 'gen-1790400000001-4bcbd01a';
  let started = false;
  const catalog = { backendUrl: () => 'http://127.0.0.1:3335',
    subscribe: () => () => {},
    view: section => ({ status: 'ready', items: section === 'Multimédia' && started
      ? [{ id, raw: { id, status: 'pending', type: 'img2img', prompt: 'Uprav' } }] : [] }),
    load: async () => {}, mutate: async (_path, _method, body) => {
      saved.push(body); started = true; return { ok: true, generationId: id };
    } };
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) };
  const store = new SessionStore(storage);
  const model = new LiveModel({ store, appearance: new AppearanceStore(storage), catalog,
    workspace: { entry: () => ({ tree: [], editor: null }) }, m2: { entry: () => ({ view: null }) } });
  model._mediaEnvironment = { status: 'ready', available: true, models: ['real.safetensors'], error: '' };
  model.setState({ mode: 'section', section: 'media', detail: { media: '__new__' },
    mediaType: 'img2img', mediaPrompt: 'Uprav', mediaDenoise: 0.7 });
  assert.equal(model.mediaFormVM(model.st()).disabled, true);
  const file = { name: 'source.png', type: 'image/png', size: png.length,
    arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) };
  model.pickMediaInput({ target: { files: [file], value: '/untrusted/path/source.png' } });
  assert.equal(model.mediaFormVM(model.st()).disabled, false);
  model.fetchImpl = async (url, options) => {
    assert.equal(new URL(url).pathname, '/api/media/input-image');
    assert.equal(JSON.parse(options.body).dataUrl, dataUrl);
    assert.doesNotMatch(options.body, /untrusted\/path/);
    return { ok: true, json: async () => ({ inputId: 'input-' + 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12) }) };
  };
  assert.equal(await model.submitMedia(model.st()), true);
  assert.deepEqual(saved[0], { type: 'img2img', prompt: 'Uprav', negative_prompt: '',
    params: { width: 1024, height: 1024, steps: 20, cfg_scale: 7, seed: -1,
      model: 'real.safetensors', denoise: 0.7 },
    inputId: 'input-' + 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12) });
  assert.equal(model._mediaInputFile, null);
  assert.equal(model.st().detail.media, id);
});
