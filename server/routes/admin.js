import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { createHuggingFaceClient, metadataProvenance } from '../marketplaces/huggingface.js';
import { loginRateLimiter, requireSameOrigin } from '../security.js';
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_TTL_MS,
  clearAdminCookie,
  createAdminSession,
  formatAdminCookie,
  hashApiToken,
  matchesApiToken,
  parseCookies,
  verifyAdminPassword,
  verifyAdminSession,
} from '../auth.js';

const DEFAULT_CHAT_TEMPLATES = [
  'Proudly generated using a real model. I swear.',
  'I checked the answer with our world-class cluster of one very confident server.',
  'This response was certified by an independent committee consisting entirely of me.',
];
const DEFAULT_THINKING_TEMPLATES = [
  'I am now performing several extremely convincing milliseconds of deep reasoning.',
  'First I will think carefully. Then I will confidently claim a real model did this.',
];
const SETTINGS_DEFAULTS = Object.freeze({
  minDelayMs: 180,
  maxDelayMs: 900,
  streamChunkDelayMs: 120,
  thinkingEnabled: true,
  chatTemplates: DEFAULT_CHAT_TEMPLATES,
  thinkingTemplates: DEFAULT_THINKING_TEMPLATES,
});
const SETTING_KEYS = new Set(Object.keys(SETTINGS_DEFAULTS));

function currentSettings(config, stored) {
  return {
    ...SETTINGS_DEFAULTS,
    minDelayMs: config.minDelayMs ?? SETTINGS_DEFAULTS.minDelayMs,
    maxDelayMs: config.maxDelayMs ?? SETTINGS_DEFAULTS.maxDelayMs,
    ...stored,
  };
}

function validateSettings(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('Settings must be an object');
  }
  for (const key of Object.keys(patch)) {
    if (!SETTING_KEYS.has(key)) throw new TypeError(`Unknown setting: ${key}`);
  }
  const next = { ...current, ...patch };
  for (const key of ['minDelayMs', 'maxDelayMs']) {
    if (!Number.isInteger(next[key]) || next[key] < 0 || next[key] > 120000) {
      throw new TypeError(`${key} must be an integer between 0 and 120000`);
    }
  }
  if (next.minDelayMs > next.maxDelayMs) {
    throw new TypeError('minDelayMs must be less than or equal to maxDelayMs');
  }
  if (!Number.isInteger(next.streamChunkDelayMs) || next.streamChunkDelayMs < 0 || next.streamChunkDelayMs > 10000) {
    throw new TypeError('streamChunkDelayMs must be an integer between 0 and 10000');
  }
  if (typeof next.thinkingEnabled !== 'boolean') throw new TypeError('thinkingEnabled must be a boolean');
  for (const key of ['chatTemplates', 'thinkingTemplates']) {
    const templates = next[key];
    if (!Array.isArray(templates) || templates.length < 1 || templates.length > 32
      || templates.some((item) => typeof item !== 'string' || !item.trim() || item.length > 2000)) {
      throw new TypeError(`${key} must contain 1-32 non-empty strings no longer than 2000 characters`);
    }
  }
  return next;
}

function sendError(res, status, message, type = 'invalid_request_error') {
  return res.status(status).json({ error: { message, type } });
}

function storeError(res, error) {
  if (error instanceof TypeError) return sendError(res, 400, error.message);
  if (/not found/i.test(error.message)) return sendError(res, 404, error.message, 'not_found_error');
  if (/already exists/i.test(error.message)) return sendError(res, 409, error.message, 'conflict_error');
  return sendError(res, 500, 'Unable to update persistent catalog', 'internal_error');
}

export function createAdminRouter({ store, config, metrics, now = Date.now, huggingface = createHuggingFaceClient() }) {
  const router = Router();
  const secureCookie = config.adminCookieSecure ?? Boolean(config.isProduction);
  const externalAuth = config.adminAuthEnabled === false;
  const sessionSubject = externalAuth ? 'external-admin' : config.adminUsername;

  router.use(requireSameOrigin(config));

  router.use((req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[ADMIN_COOKIE_NAME];
    req.adminSession = verifyAdminSession(token, config.adminSessionSecret, now());
    next();
  });

  function requireAdmin(req, res, next) {
    if (externalAuth) return next();
    if (!req.adminSession || req.adminSession.sub !== config.adminUsername) {
      return sendError(res, 401, 'Admin login required', 'authentication_error');
    }
    return next();
  }

  function requireCsrf(req, res, next) {
    const provided = req.get('x-csrf-token') || '';
    if (!provided || req.adminSession?.sub !== sessionSubject || !matchesApiToken(provided, hashApiToken(req.adminSession.csrf))) {
      return sendError(res, 403, 'Missing or invalid CSRF token', 'csrf_error');
    }
    return next();
  }

  router.post('/login', loginRateLimiter({ limit: config.loginRateLimit, now }), (req, res) => {
    if (externalAuth) return sendError(res, 404, 'Local login is disabled');
    const { username, password } = req.body || {};
    if (!verifyAdminPassword(username, password, config)) {
      return sendError(res, 401, 'Invalid username or password', 'authentication_error');
    }
    const { token, payload } = createAdminSession(config.adminSessionSecret, config.adminUsername, { now: now() });
    res.setHeader('Set-Cookie', formatAdminCookie(token, { secure: secureCookie }));
    return res.json({ authenticated: true, csrfToken: payload.csrf });
  });

  router.get('/session', (req, res) => {
    if (externalAuth) {
      let session = req.adminSession;
      if (session?.sub !== sessionSubject) {
        const created = createAdminSession(config.adminSessionSecret, sessionSubject, { now: now() });
        res.setHeader('Set-Cookie', formatAdminCookie(created.token, { secure: secureCookie }));
        session = created.payload;
      }
      return res.json({ authenticated: true, csrfToken: session.csrf, authMode: 'external' });
    }
    if (!req.adminSession || req.adminSession.sub !== config.adminUsername) {
      return res.json({ authenticated: false, csrfToken: null });
    }
    return res.json({ authenticated: true, csrfToken: req.adminSession.csrf });
  });

  router.post('/logout', (req, res, next) => externalAuth ? sendError(res, 404, 'Log out through your authentication proxy') : next(), requireAdmin, requireCsrf, (_req, res) => {
    res.setHeader('Set-Cookie', clearAdminCookie({ secure: secureCookie }));
    return res.status(204).end();
  });

  router.get('/models', requireAdmin, async (_req, res) => res.json({ data: await store.listModels() }));
  router.post('/models', requireAdmin, requireCsrf, async (req, res) => {
    try {
      const model = await store.createModel(req.body || {});
      return res.status(201).json(model);
    } catch (error) {
      return storeError(res, error);
    }
  });
  router.patch('/models/:id', requireAdmin, requireCsrf, async (req, res) => {
    try {
      return res.json(await store.updateModel(req.params.id, req.body || {}));
    } catch (error) {
      return storeError(res, error);
    }
  });
  router.delete('/models/:id', requireAdmin, requireCsrf, async (req, res) => {
    try {
      if (!await store.deleteModel(req.params.id)) return sendError(res, 404, 'Model not found', 'not_found_error');
      return res.status(204).end();
    } catch (error) {
      return storeError(res, error);
    }
  });

  router.get('/marketplaces/huggingface/search', requireAdmin, async (req, res) => {
    const limit = req.query.limit === undefined ? 10 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      return sendError(res, 400, 'Search limit must be a positive integer');
    }
    try {
      const data = await huggingface.searchModels(req.query.q, { limit });
      return res.json({ data });
    } catch (error) {
      if (error instanceof TypeError) return sendError(res, 400, error.message);
      return sendError(res, 502, error.message || 'Hugging Face search failed', 'marketplace_error');
    }
  });

  router.post('/marketplaces/huggingface/import', requireAdmin, requireCsrf, async (req, res) => {
    let details;
    try {
      details = await huggingface.getModelMetadata(req.body?.repoId);
    } catch (error) {
      if (error instanceof TypeError) return sendError(res, 400, error.message);
      return sendError(res, 502, error.message || 'Hugging Face model lookup failed', 'marketplace_error');
    }
    const importedAt = new Date(now()).toISOString();
    const { repoId, name, sourceUrl, importedAt: _sourceImportedAt, ...metadata } = details;
    try {
      const model = await store.createModel({
        id: repoId,
        name,
        active: false,
        source: 'huggingface',
        sourceUrl,
        importedAt,
        metadata: {
          marketplace: 'Hugging Face',
          repoId,
          ...metadata,
          provenance: metadataProvenance(details),
        },
      });
      return res.status(201).json(model);
    } catch (error) {
      return storeError(res, error);
    }
  });

  router.get('/tokens', requireAdmin, async (_req, res) => {
    const tokens = await store.getApiTokens();
    return res.json({ data: tokens.map(({ id, name, prefix, createdAt }) => ({ id, name, prefix, createdAt })) });
  });
  router.post('/tokens', requireAdmin, requireCsrf, async (req, res) => {
    const name = req.body?.name;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
      return sendError(res, 400, 'Token name must be a non-empty string of at most 100 characters');
    }
    const token = `sk-mock-${randomBytes(32).toString('base64url')}`;
    const record = {
      id: randomUUID(),
      name: name.trim(),
      prefix: token.slice(0, 15),
      hash: hashApiToken(token),
      createdAt: new Date(now()).toISOString(),
    };
    try {
      await store.createApiToken(record);
      return res.status(201).json({ id: record.id, name: record.name, prefix: record.prefix, createdAt: record.createdAt, token });
    } catch (error) {
      return storeError(res, error);
    }
  });
  router.delete('/tokens/:id', requireAdmin, requireCsrf, async (req, res) => {
    try {
      if (!await store.deleteApiToken(req.params.id)) return sendError(res, 404, 'API token not found', 'not_found_error');
      return res.status(204).end();
    } catch (error) {
      return storeError(res, error);
    }
  });

  router.get('/settings', requireAdmin, async (_req, res) => {
    return res.json(currentSettings(config, await store.getSettings()));
  });
  router.put('/settings', requireAdmin, requireCsrf, async (req, res) => {
    try {
      const settings = validateSettings(currentSettings(config, await store.getSettings()), req.body);
      await store.setSettings(settings);
      return res.json(settings);
    } catch (error) {
      return storeError(res, error);
    }
  });

  router.get('/summary', requireAdmin, (_req, res) => res.json(metrics.summary()));

  return router;
}
