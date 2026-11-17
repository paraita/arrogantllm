import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import test from 'node:test';
import { createHuggingFaceClient } from '../server/marketplaces/huggingface.js';
import { createAdminRouter } from '../server/routes/admin.js';
import { createMetrics } from '../server/metrics.js';
import { createStore } from '../server/store.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function modelInfo(overrides = {}) {
  return {
    id: 'example-org/pretend-model-7b-instruct-v2.1.0',
    pipeline_tag: 'text-generation',
    tags: ['license:apache-2.0', 'quantization:4bit', 'instruct', 'v2.1.0'],
    downloads: 12345,
    safetensors: { parameters: { F32: 2000000, F16: 5000000000 } },
    cardData: { license: 'apache-2.0' },
    ...overrides,
  };
}

test('searches Hugging Face metadata with bounded result count and maps published fields', async () => {
  const urls = [];
  const client = createHuggingFaceClient({
    fetchImpl: async (url) => {
      urls.push(new URL(url));
      return jsonResponse([modelInfo()]);
    },
  });

  const results = await client.searchModels('pretend-model', { limit: 200 });

  assert.equal(urls.length, 1);
  assert.equal(urls[0].pathname, '/api/models');
  assert.equal(urls[0].searchParams.get('limit'), '20');
  assert.equal(urls[0].searchParams.get('search'), 'pretend-model');
  assert.equal(results.length, 1);
  assert.equal(results[0].repoId, 'example-org/pretend-model-7b-instruct-v2.1.0');
  assert.deepEqual(results[0].task, { value: 'text-generation', provenance: 'published' });
  assert.deepEqual(results[0].downloads, { value: 12345, provenance: 'published' });
});

test('maps context, parameter count, quantization, version, flavor and field provenance', async () => {
  const urls = [];
  const client = createHuggingFaceClient({
    now: () => 1763272800000,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      urls.push(parsed);
      if (parsed.pathname.startsWith('/api/models/')) return jsonResponse(modelInfo());
      if (parsed.pathname.endsWith('/resolve/main/config.json')) return jsonResponse({ max_position_embeddings: 32768 });
      throw new Error(`Unexpected request: ${parsed.pathname}`);
    },
  });

  const details = await client.getModelMetadata('example-org/pretend-model-7b-instruct-v2.1.0');

  assert.deepEqual(details.contextLength, { value: 32768, provenance: 'published' });
  assert.deepEqual(details.parameterCount, { value: 5002000000, provenance: 'published' });
  assert.deepEqual(details.quantizer, { value: '4-bit', provenance: 'inferred' });
  assert.deepEqual(details.version, { value: '2.1.0', provenance: 'inferred' });
  assert.deepEqual(details.flavor, { value: 'instruct', provenance: 'inferred' });
  assert.equal(details.license.value, 'apache-2.0');
  assert.equal(details.sourceUrl, 'https://huggingface.co/example-org/pretend-model-7b-instruct-v2.1.0');
  assert.equal(urls.length, 2);
  assert.equal(urls.some((url) => /\.safetensors|\.gguf|pytorch_model|\/tree\//i.test(url.pathname)), false);
  assert.deepEqual(urls.map((url) => url.pathname), [
    '/api/models/example-org/pretend-model-7b-instruct-v2.1.0',
    '/example-org/pretend-model-7b-instruct-v2.1.0/resolve/main/config.json',
  ]);
});

test('marks missing metadata as unknown instead of fabricating values', async () => {
  const client = createHuggingFaceClient({ fetchImpl: async (url) => {
    if (String(url).includes('/api/models/')) return jsonResponse({ id: 'example-org/unknown-model', tags: [] });
    return jsonResponse({}, 404);
  } });

  const details = await client.getModelMetadata('example-org/unknown-model');

  assert.deepEqual(details.contextLength, { value: null, provenance: 'unknown' });
  assert.deepEqual(details.parameterCount, { value: null, provenance: 'unknown' });
  assert.deepEqual(details.quantizer, { value: null, provenance: 'unknown' });
  assert.deepEqual(details.version, { value: null, provenance: 'unknown' });
  assert.deepEqual(details.flavor, { value: null, provenance: 'unknown' });
  assert.deepEqual(details.license, { value: null, provenance: 'unknown' });
});

test('validates repository identifiers and reports marketplace failures', async () => {
  let requestCount = 0;
  const client = createHuggingFaceClient({
    fetchImpl: async () => { requestCount += 1; return jsonResponse({ error: 'offline' }, 503); },
  });

  await assert.rejects(client.getModelMetadata('https://attacker.example/model'), /repository id/i);
  assert.equal(requestCount, 0);
  await assert.rejects(client.searchModels('test', { limit: -1 }), /limit/i);
  await assert.rejects(client.searchModels('test'), /Hugging Face.*503/i);
  assert.equal(requestCount, 1);
});

test('aborts marketplace requests that exceed the configured timeout', async () => {
  const client = createHuggingFaceClient({
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });

  await assert.rejects(client.searchModels('slow model'), /timed out/i);
});

test('admin import is authenticated, CSRF protected, inactive and records provenance', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fake-llm-hf-'));
  try {
    const store = await createStore({ dataDir });
    const config = {
      adminUsername: 'admin',
      adminPassword: 'correct horse battery staple',
      adminSessionSecret: 'test-session-secret-long-enough-for-huggingface',
      isProduction: false,
      minDelayMs: 10,
      maxDelayMs: 50,
    };
    const metadata = {
      repoId: 'example-org/test-model',
      sourceUrl: 'https://huggingface.co/example-org/test-model',
      task: { value: 'text-generation', provenance: 'published' },
      contextLength: { value: 4096, provenance: 'published' },
      quantizer: { value: null, provenance: 'unknown' },
    };
    const huggingface = {
      searchModels: async () => [metadata],
      getModelMetadata: async () => metadata,
    };
    const app = express();
    app.use(express.json());
    app.use('/api/admin', createAdminRouter({ store, config, metrics: createMetrics(), huggingface, now: () => 1763272800000 }));

    await request(app).get('/api/admin/marketplaces/huggingface/search?q=test').expect(401);
    const client = request.agent(app);
    const login = await client.post('/api/admin/login')
      .send({ username: 'admin', password: 'correct horse battery staple' }).expect(200);
    const csrfToken = login.body.csrfToken;

    const results = await client.get('/api/admin/marketplaces/huggingface/search?q=test').expect(200);
    assert.equal(results.body.data[0].repoId, 'example-org/test-model');
    await client.post('/api/admin/marketplaces/huggingface/import')
      .send({ repoId: 'example-org/test-model' }).expect(403);

    const imported = await client.post('/api/admin/marketplaces/huggingface/import')
      .set('X-CSRF-Token', csrfToken)
      .send({ repoId: 'example-org/test-model' }).expect(201);
    assert.equal(imported.body.source, 'huggingface');
    assert.equal(imported.body.active, false);
    assert.equal(imported.body.sourceUrl, metadata.sourceUrl);
    assert.equal(imported.body.importedAt, '2025-11-16T06:00:00.000Z');
    assert.deepEqual(imported.body.metadata.provenance, {
      task: 'published', downloads: 'unknown', license: 'unknown', contextLength: 'published',
      parameterCount: 'unknown', quantizer: 'unknown', version: 'unknown', flavor: 'unknown',
    });
    assert.equal((await store.listModels()).length, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
