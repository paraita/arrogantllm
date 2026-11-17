import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStore } from '../server/store.js';

async function withStore(run) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fake-llm-store-'));
  try {
    await run(dataDir, await createStore({ dataDir }));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

test('initializes an empty versioned catalog with persisted defaults', async () => {
  await withStore(async (dataDir, store) => {
    assert.deepEqual(await store.listModels(), []);
    assert.deepEqual(await store.getSettings(), {});
    assert.deepEqual(await store.getApiTokens(), []);

    const disk = JSON.parse(await readFile(path.join(dataDir, 'catalog.json'), 'utf8'));
    assert.equal(disk.version, 1);
    assert.deepEqual(disk.models, []);
    assert.deepEqual(disk.apiTokens, []);
    assert.deepEqual(disk.settings, {});
  });
});

test('creates, updates, toggles and deletes models with validated fields', async () => {
  await withStore(async (_dataDir, store) => {
    const created = await store.createModel({
      id: 'fictional-reasoner:7b-q4',
      name: 'Fictional Reasoner 7B Q4',
      active: false,
      source: 'manual',
      metadata: { contextLength: 8192, quantizer: 'Q4_K_M' },
    });
    assert.equal(created.id, 'fictional-reasoner:7b-q4');
    assert.equal(created.active, false);
    assert.ok(created.createdAt);

    const updated = await store.updateModel(created.id, {
      name: 'Fictional Reasoner 7B Q5',
      metadata: { contextLength: 16384, quantizer: 'Q5_K_M' },
    });
    assert.equal(updated.name, 'Fictional Reasoner 7B Q5');
    assert.equal(updated.metadata.contextLength, 16384);
    assert.ok(updated.updatedAt >= created.updatedAt);

    const enabled = await store.setModelActive(created.id, true);
    assert.equal(enabled.active, true);
    assert.equal((await store.getModel(created.id)).active, true);

    assert.equal(await store.deleteModel(created.id), true);
    assert.equal(await store.deleteModel(created.id), false);
    assert.deepEqual(await store.listModels(), []);
  });
});

test('rejects duplicate, malformed and unknown model updates', async () => {
  await withStore(async (_dataDir, store) => {
    await store.createModel({ id: 'valid-model', name: 'Valid Model' });

    await assert.rejects(store.createModel({ id: 'valid-model', name: 'Duplicate' }), /already exists/i);
    await assert.rejects(store.createModel({ id: '   ', name: 'Blank ID' }), /id/i);
    await assert.rejects(store.createModel({ id: 'bad model', name: 'Invalid ID' }), /id/i);
    await assert.rejects(store.createModel({ id: 'bad-active', active: 'yes' }), /active/i);
    await assert.rejects(store.updateModel('missing-model', { name: 'Unknown' }), /not found/i);
  });
});

test('persists changes atomically and reloads them in a new store instance', async () => {
  await withStore(async (dataDir, store) => {
    await store.createModel({
      id: 'catalog-model',
      name: 'Catalog Model',
      active: true,
      source: 'huggingface',
      sourceUrl: 'https://huggingface.co/example/catalog-model',
      importedAt: '2026-11-16T00:00:00.000Z',
      metadata: { contextLength: 32768, provenance: { contextLength: 'published' } },
    });

    const reloaded = await createStore({ dataDir });
    assert.deepEqual(await reloaded.listModels(), await store.listModels());
    assert.equal((await reloaded.getModel('catalog-model')).metadata.provenance.contextLength, 'published');
    assert.deepEqual((await reloaded.getApiTokens()), []);
  });
});

test('serializes concurrent writes without losing model updates', async () => {
  await withStore(async (_dataDir, store) => {
    await Promise.all(Array.from({ length: 12 }, (_, index) =>
      store.createModel({ id: `model-${index}`, name: `Model ${index}` }),
    ));

    assert.equal((await store.listModels()).length, 12);
  });
});
