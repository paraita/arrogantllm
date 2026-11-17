import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const STORE_FILE = 'catalog.json';
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const MAX_METADATA_BYTES = 64 * 1024;

function clone(value) {
  return structuredClone(value);
}

function initialState() {
  return { version: 1, models: [], apiTokens: [], settings: {} };
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function validateModelId(id) {
  if (typeof id !== 'string' || !MODEL_ID_PATTERN.test(id)) {
    throw new TypeError('Model id must be 1-200 characters and contain only letters, numbers, dot, underscore, colon, slash, or hyphen');
  }
  return id;
}

function normalizeModel(input, now = new Date().toISOString()) {
  assertObject(input, 'Model');
  const id = validateModelId(input.id);
  const name = input.name === undefined ? id : input.name;
  if (typeof name !== 'string' || !name.trim() || name.length > 200) {
    throw new TypeError('Model name must be a non-empty string of at most 200 characters');
  }
  const active = input.active === undefined ? false : input.active;
  if (typeof active !== 'boolean') throw new TypeError('Model active must be a boolean');
  const source = input.source === undefined ? 'manual' : input.source;
  if (!['manual', 'huggingface'].includes(source)) {
    throw new TypeError('Model source must be manual or huggingface');
  }
  const metadata = input.metadata === undefined ? {} : input.metadata;
  assertObject(metadata, 'Model metadata');
  let encodedMetadata;
  try {
    encodedMetadata = JSON.stringify(metadata);
  } catch {
    throw new TypeError('Model metadata must contain only JSON-compatible values');
  }
  if (encodedMetadata === undefined || Buffer.byteLength(encodedMetadata) > MAX_METADATA_BYTES) {
    throw new TypeError('Model metadata must be JSON-compatible and no larger than 64 KiB');
  }

  const record = {
    id,
    name: name.trim(),
    active,
    source,
    metadata: JSON.parse(encodedMetadata),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
  for (const field of ['sourceUrl', 'importedAt']) {
    if (input[field] !== undefined) {
      if (typeof input[field] !== 'string' || input[field].length > 2048) {
        throw new TypeError(`Model ${field} must be a string of at most 2048 characters`);
      }
      record[field] = input[field];
    }
  }
  return record;
}

function validateState(state) {
  assertObject(state, 'Catalog');
  if (state.version !== 1) throw new Error(`Unsupported catalog version: ${state.version}`);
  if (!Array.isArray(state.models) || !Array.isArray(state.apiTokens)) {
    throw new Error('Catalog is missing its models or apiTokens list');
  }
  assertObject(state.settings, 'Catalog settings');
  const ids = new Set();
  for (const model of state.models) {
    const normalized = normalizeModel(model);
    if (ids.has(normalized.id)) throw new Error(`Catalog contains duplicate model id: ${normalized.id}`);
    ids.add(normalized.id);
  }
  return state;
}

async function persist(filePath, state) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

class CatalogStore {
  #filePath;
  #state;
  #writeQueue = Promise.resolve();

  constructor(filePath, state) {
    this.#filePath = filePath;
    this.#state = state;
  }

  async #mutate(change) {
    const operation = this.#writeQueue.then(async () => {
      const next = clone(this.#state);
      const result = change(next);
      await persist(this.#filePath, next);
      this.#state = next;
      return clone(result);
    });
    this.#writeQueue = operation.catch(() => {});
    return operation;
  }

  async listModels() {
    return clone(this.#state.models);
  }

  async getModel(id) {
    const model = this.#state.models.find((item) => item.id === id);
    return model ? clone(model) : null;
  }

  async getSettings() {
    return clone(this.#state.settings);
  }

  async getApiTokens() {
    return clone(this.#state.apiTokens);
  }

  async createApiToken(input) {
    assertObject(input, 'API token');
    if (typeof input.id !== 'string' || !input.id || input.id.length > 100) {
      throw new TypeError('API token id must be a non-empty string');
    }
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) {
      throw new TypeError('API token name must be a non-empty string of at most 100 characters');
    }
    if (typeof input.hash !== 'string' || !/^[a-f0-9]{64}$/.test(input.hash)) {
      throw new TypeError('API token hash must be a SHA-256 hex digest');
    }
    if (typeof input.prefix !== 'string' || !input.prefix || input.prefix.length > 32) {
      throw new TypeError('API token prefix must be a non-empty string of at most 32 characters');
    }
    if (typeof input.createdAt !== 'string' || Number.isNaN(Date.parse(input.createdAt))) {
      throw new TypeError('API token createdAt must be a valid timestamp');
    }
    return this.#mutate((state) => {
      if (state.apiTokens.some((item) => item.id === input.id)) {
        throw new Error(`API token already exists: ${input.id}`);
      }
      const record = {
        id: input.id,
        name: input.name.trim(),
        prefix: input.prefix,
        hash: input.hash,
        createdAt: input.createdAt,
      };
      state.apiTokens.push(record);
      return record;
    });
  }

  async deleteApiToken(id) {
    return this.#mutate((state) => {
      const index = state.apiTokens.findIndex((item) => item.id === id);
      if (index === -1) return false;
      state.apiTokens.splice(index, 1);
      return true;
    });
  }

  async setSettings(settings) {
    assertObject(settings, 'Settings');
    return this.#mutate((state) => {
      state.settings = clone(settings);
      return state.settings;
    });
  }

  async createModel(input) {
    return this.#mutate((state) => {
      const model = normalizeModel(input);
      if (state.models.some((item) => item.id === model.id)) {
        throw new Error(`Model already exists: ${model.id}`);
      }
      state.models.push(model);
      return model;
    });
  }

  async updateModel(id, patch) {
    assertObject(patch, 'Model update');
    if (Object.hasOwn(patch, 'id')) throw new TypeError('Model id cannot be changed');
    return this.#mutate((state) => {
      const index = state.models.findIndex((item) => item.id === id);
      if (index === -1) throw new Error(`Model not found: ${id}`);
      const updated = normalizeModel({ ...state.models[index], ...patch, id, updatedAt: new Date().toISOString() });
      state.models[index] = updated;
      return updated;
    });
  }

  async setModelActive(id, active) {
    if (typeof active !== 'boolean') throw new TypeError('Model active must be a boolean');
    return this.updateModel(id, { active });
  }

  async deleteModel(id) {
    return this.#mutate((state) => {
      const index = state.models.findIndex((item) => item.id === id);
      if (index === -1) return false;
      state.models.splice(index, 1);
      return true;
    });
  }
}

export async function createStore({ dataDir }) {
  if (typeof dataDir !== 'string' || !dataDir.trim()) {
    throw new TypeError('dataDir must be a non-empty path');
  }
  const directory = path.resolve(dataDir);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filePath = path.join(directory, STORE_FILE);
  let state;
  try {
    state = validateState(JSON.parse(await readFile(filePath, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (error instanceof SyntaxError) throw new Error(`Catalog file is not valid JSON: ${filePath}`, { cause: error });
      throw error;
    }
    state = initialState();
    await persist(filePath, state);
  }
  return new CatalogStore(filePath, clone(state));
}
