const HUB_ORIGIN = 'https://huggingface.co';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_SEARCH_RESULTS = 20;
const REPOSITORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const CONTEXT_LENGTH_KEYS = [
  'max_position_embeddings',
  'max_sequence_length',
  'max_seq_len',
  'n_positions',
  'seq_length',
  'model_max_length',
];
const FIELD_NAMES = [
  'task',
  'downloads',
  'license',
  'contextLength',
  'parameterCount',
  'quantizer',
  'version',
  'flavor',
];

function field(value) {
  if (value === null || value === undefined || value === '') {
    return { value: null, provenance: 'unknown' };
  }
  return { value, provenance: 'published' };
}

function inferredField(value) {
  if (value === null || value === undefined || value === '') {
    return { value: null, provenance: 'unknown' };
  }
  return { value, provenance: 'inferred' };
}

function validNumber(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function extractContextLength(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  for (const key of CONTEXT_LENGTH_KEYS) {
    const value = validNumber(config[key]);
    if (value !== null) return value;
  }
  return null;
}

function extractParameterCount(safetensors) {
  if (!safetensors || typeof safetensors !== 'object') return null;
  if (validNumber(safetensors.total)) return safetensors.total;
  const parameters = safetensors.parameters;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return null;
  const counts = Object.values(parameters).filter(validNumber);
  if (counts.length === 0) return null;
  const total = counts.reduce((sum, count) => sum + count, 0);
  return Number.isSafeInteger(total) ? total : null;
}

function inferQuantizer(info) {
  const config = info.quantization_config || info.gguf || {};
  const explicit = config.quant_method || config.quantization_method || config.quantization_version;
  if (typeof explicit === 'string' && explicit.trim()) {
    const bits = config.bits;
    return field(bits ? `${explicit.toUpperCase()} ${bits}-bit` : explicit.toUpperCase());
  }
  const tags = Array.isArray(info.tags) ? info.tags : [];
  const tag = tags.find((entry) => typeof entry === 'string'
    && /^(?:quantization:)?(?:\d+bit|q\d+[_-][a-z0-9_-]+|gptq|awq|gguf|exl2|bnb)$/i.test(entry));
  if (!tag) return inferredField(null);
  const normalized = tag.replace(/^quantization:/i, '');
  const bits = normalized.match(/^(\d+)bit$/i);
  return inferredField(bits ? `${bits[1]}-bit` : normalized.toUpperCase());
}

function inferVersion(info, repoId) {
  const tags = Array.isArray(info.tags) ? info.tags : [];
  for (const candidate of tags) {
    if (typeof candidate !== 'string') continue;
    const match = /^v?(\d+\.\d+(?:\.\d+)?)$/i.exec(candidate);
    if (match) return inferredField(match[1]);
  }
  const match = /(?:^|[-_])v(\d+\.\d+(?:\.\d+)?)(?:$|[-_])/i.exec(repoId.split('/').at(-1));
  if (match) return inferredField(match[1]);
  return inferredField(null);
}

function inferFlavor(info, repoId) {
  const text = `${repoId} ${(Array.isArray(info.tags) ? info.tags : []).join(' ')}`.toLowerCase();
  const flavors = ['instruct', 'chat', 'coder', 'vision', 'reasoning', 'math', 'base'];
  const match = flavors.find((flavor) => new RegExp(`(?:^|[\\s._/-])${flavor}(?:$|[\\s._/-])`, 'i').test(text));
  return inferredField(match || null);
}

function normalizeModelInfo(info, { repoId = info?.id || info?.modelId, config = null } = {}) {
  if (!info || typeof info !== 'object' || Array.isArray(info)) {
    throw new TypeError('Hugging Face returned an invalid model record');
  }
  if (typeof repoId !== 'string' || !REPOSITORY_PATTERN.test(repoId)) {
    throw new TypeError('Model repository id must use the owner/name format');
  }
  const tags = Array.isArray(info.tags) ? info.tags.filter((tag) => typeof tag === 'string').slice(0, 100) : [];
  const cardData = info.cardData && typeof info.cardData === 'object' ? info.cardData : {};
  const licenseFromTag = tags.find((tag) => tag.startsWith('license:'))?.slice('license:'.length);
  const name = typeof info.name === 'string' && info.name.trim() ? info.name.trim() : repoId;
  const metadata = {
    repoId,
    name,
    sourceUrl: `${HUB_ORIGIN}/${repoId}`,
    task: field(typeof info.pipeline_tag === 'string' ? info.pipeline_tag : null),
    downloads: field(validNumber(info.downloads)),
    license: field(typeof cardData.license === 'string' ? cardData.license : licenseFromTag || null),
    contextLength: field(extractContextLength(config || info.config)),
    parameterCount: field(extractParameterCount(info.safetensors)),
    quantizer: inferQuantizer(info),
    version: inferVersion(info, repoId),
    flavor: inferFlavor(info, repoId),
    tags,
  };
  return metadata;
}

function validateQuery(query) {
  if (typeof query !== 'string' || !query.trim() || query.trim().length > 100) {
    throw new TypeError('Search query must be a non-empty string of at most 100 characters');
  }
  return query.trim();
}

function normalizeLimit(limit = 10) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('Search limit must be a positive integer');
  }
  return Math.min(limit, MAX_SEARCH_RESULTS);
}

function validateRepositoryId(repoId) {
  if (typeof repoId !== 'string' || !REPOSITORY_PATTERN.test(repoId)) {
    throw new TypeError('Model repository id must use the owner/name format');
  }
  return repoId;
}

export function createHuggingFaceClient({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new TypeError('Timeout must be an integer between 1 and 120000 milliseconds');
  }

  async function fetchJson(url, { allowNotFound = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Hugging Face request timed out')), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (allowNotFound && response.status === 404) return null;
      if (!response.ok) throw new Error(`Hugging Face request failed with status ${response.status}`);
      const contentType = response.headers?.get?.('content-type') || '';
      if (contentType && !contentType.includes('application/json')) {
        throw new Error('Hugging Face returned a non-JSON response');
      }
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Hugging Face request timed out', { cause: error });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    async searchModels(query, { limit = 10 } = {}) {
      const search = validateQuery(query);
      const boundedLimit = normalizeLimit(limit);
      const url = new URL('/api/models', HUB_ORIGIN);
      url.searchParams.set('search', search);
      url.searchParams.set('limit', String(boundedLimit));
      url.searchParams.set('sort', 'downloads');
      url.searchParams.set('direction', '-1');
      const response = await fetchJson(url);
      if (!Array.isArray(response)) throw new Error('Hugging Face returned an invalid model search result');
      return response.slice(0, boundedLimit).map((item) => normalizeModelInfo(item));
    },

    async getModelMetadata(repoId) {
      validateRepositoryId(repoId);
      const encodedRepoId = repoId.split('/').map(encodeURIComponent).join('/');
      const detailUrl = new URL(`/api/models/${encodedRepoId}`, HUB_ORIGIN);
      detailUrl.searchParams.append('expand[]', 'gguf');
      const info = await fetchJson(detailUrl);
      if (!info || typeof info !== 'object' || Array.isArray(info)) {
        throw new Error('Hugging Face returned an invalid model record');
      }
      const configUrl = new URL(`/${encodedRepoId}/resolve/main/config.json`, HUB_ORIGIN);
      const config = await fetchJson(configUrl, { allowNotFound: true });
      const normalizedRepoId = info.id || info.modelId || repoId;
      validateRepositoryId(normalizedRepoId);
      return {
        ...normalizeModelInfo(info, { repoId: normalizedRepoId, config }),
        importedAt: new Date(now()).toISOString(),
      };
    },
  });
}

export function metadataProvenance(metadata) {
  return Object.fromEntries(FIELD_NAMES.map((name) => [name, metadata[name]?.provenance || 'unknown']));
}
