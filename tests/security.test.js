import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../server/index.js';
import { createStore } from '../server/store.js';
import { loadConfig } from '../server/config.js';
import { hashApiToken } from '../server/auth.js';
import { createMetrics } from '../server/metrics.js';

async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arrogant-security-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await createStore({ dataDir: dir });
  await store.createModel({ id: 'test', active: true });
  await store.createApiToken({ id: 'test', name: 'test', prefix: 'sk-test', hash: hashApiToken('sk-test'), createdAt: new Date().toISOString() });
  const config = { ...loadConfig({ API_DELAY_MIN_MS: '0', API_DELAY_MAX_MS: '0' }), ...overrides };
  const metrics = createMetrics();
  return { app: createApp({ config, store, metrics }), store, metrics };
}

test('disabled login bootstraps CSRF without weakening API token authentication', async (t) => {
  const { app } = await fixture(t, { adminAuthEnabled: false, publicBaseUrl: 'https://llm.test' });
  const client = request.agent(app);
  const session = await client.get('/api/admin/session').expect(200);
  assert.equal(session.body.authenticated, true);
  assert.equal(session.body.authMode, 'external');
  assert.ok(session.body.csrfToken);
  await client.get('/api/admin/models').expect(200);
  await client.post('/api/admin/models').send({ id: 'no-csrf' }).expect(403);
  await request(app).post('/api/admin/models').set('X-CSRF-Token', session.body.csrfToken).send({ id: 'no-cookie' }).expect(403);
  await client.post('/api/admin/models').set('X-CSRF-Token', session.body.csrfToken).set('Origin', 'https://evil.test').send({ id: 'evil' }).expect(403);
  await client.post('/api/admin/models').set('X-CSRF-Token', session.body.csrfToken).set('Origin', 'https://llm.test').send({ id: 'good' }).expect(201);
  await client.post('/api/admin/login').send({}).expect(404);
  await client.post('/api/admin/logout').set('X-CSRF-Token', session.body.csrfToken).expect(404);
  await client.get('/v1/models').expect(401);
  await client.get('/v1/models').set('Authorization', 'Bearer sk-test').expect(200);
});

test('default authentication ignores spoofed identity headers and blocks cross-site login', async (t) => {
  const { app } = await fixture(t, { publicBaseUrl: 'https://llm.test' });
  await request(app).get('/api/admin/models').set('Remote-User', 'admin').set('X-Forwarded-User', 'admin').expect(401);
  await request(app).post('/api/admin/login').set('Origin', 'https://evil.test').send({ username: 'admin', password: 'dev-only-change-me' }).expect(403);
});

test('security headers and no-store cover sensitive responses and errors', async (t) => {
  const { app } = await fixture(t);
  const result = await request(app).get('/api/admin/session');
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
  assert.equal(result.headers['x-frame-options'], 'DENY');
  assert.match(result.headers['content-security-policy'], /frame-ancestors 'none'/);
  const error = await request(app).post('/api/admin/login').set('Content-Type', 'application/json').send('{');
  assert.equal(error.headers['cache-control'], 'no-store');
});

test('login attempts are limited even if forwarded addresses change', async (t) => {
  const { app } = await fixture(t, { loginRateLimit: 2 });
  for (let i = 0; i < 2; i++) await request(app).post('/api/admin/login').set('X-Forwarded-For', `192.0.2.${i}`).send({}).expect(401);
  const result = await request(app).post('/api/admin/login').set('X-Forwarded-For', '192.0.2.200').send({}).expect(429);
  assert.ok(Number(result.headers['retry-after']) > 0);
});

test('unknown inference paths cannot grow metrics with arbitrary attacker strings', async (t) => {
  const { app, metrics } = await fixture(t);
  await request(app).get('/v1/attacker-controlled').set('Authorization', 'Bearer sk-test').expect(404);
  assert.deepEqual(metrics.summary().requestsByEndpoint, {});
});

test('payload depth and embedding expansion are bounded', async (t) => {
  const { app } = await fixture(t);
  await request(app).post('/v1/embeddings').set('Authorization', 'Bearer sk-test').send({ model: 'test', input: Array(2049).fill('') }).expect(400);
  const nested = '{"model":"test","input":' + '['.repeat(40) + '0' + ']'.repeat(40) + '}';
  await request(app).post('/v1/embeddings').set('Authorization', 'Bearer sk-test').set('Content-Type', 'application/json').send(nested).expect(400);
  const properties = Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`query${i}`, { type: 'string' }]));
  await request(app).post('/v1/chat/completions').set('Authorization', 'Bearer sk-test').send({ model: 'test', messages: [{ content: 'search ' + 'x'.repeat(1000) }], tools: [{ type: 'function', function: { name: 'search', parameters: { properties } } }], tool_choice: 'required' }).expect(400);
});

test('concurrency overload rejects before work and frees the slot after completion', async (t) => {
  const { app, store } = await fixture(t, { maxConcurrentRequests: 1 });
  let enter;
  let release;
  const entered = new Promise((resolve) => { enter = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const original = store.getSettings.bind(store);
  store.getSettings = async () => { enter(); await gate; return original(); };
  const first = request(app).post('/v1/completions').set('Authorization', 'Bearer sk-test').send({ model: 'test' }).then((res) => res);
  try {
    await entered;
    await request(app).get('/v1/models').set('Authorization', 'Bearer sk-test').expect(429);
  } finally { release(); }
  assert.equal((await first).status, 200);
  await request(app).get('/v1/models').set('Authorization', 'Bearer sk-test').expect(200);
});

test('external sessions cannot be bootstrapped cross-site and malformed cookies are replaced', async (t) => {
  const { app } = await fixture(t, { adminAuthEnabled: false, publicBaseUrl: 'https://llm.test' });
  const rejected = await request(app).get('/api/admin/session').set('Sec-Fetch-Site', 'cross-site').expect(403);
  assert.equal(rejected.headers['set-cookie'], undefined);
  const session = await request(app).get('/api/admin/session').set('Cookie', 'fake_llm_admin=broken').expect(200);
  assert.ok(session.headers['set-cookie']);
  assert.equal(session.body.authenticated, true);
});

test('compressed bodies are rejected instead of consuming decompression resources', async (t) => {
  const { gzipSync } = await import('node:zlib');
  const { app } = await fixture(t);
  await request(app).post('/v1/completions').set('Content-Type', 'application/json')
    .set('Authorization', 'Bearer sk-test').set('Content-Encoding', 'gzip').send(gzipSync('{"model":"test"}')).expect(415);
});

test('login throttle recovers after its window without trusting client headers', async () => {
  const { loginRateLimiter } = await import('../server/security.js');
  let now = 0;
  let admitted = 0;
  let status;
  const limiter = loginRateLimiter({ limit: 1, now: () => now });
  const res = { set() {}, status(code) { status = code; return this; }, json() {} };
  limiter({}, res, () => admitted++);
  limiter({}, res, () => admitted++);
  assert.equal(admitted, 1);
  assert.equal(status, 429);
  now = 60000;
  limiter({}, res, () => admitted++);
  assert.equal(admitted, 2);
});

test('local auth works behind production TLS termination without PUBLIC_BASE_URL', async (t) => {
  const { app } = await fixture(t, loadConfig({ NODE_ENV: 'production', ADMIN_PASSWORD: 'test-only-password', ADMIN_SESSION_SECRET: 'test-only-secret-with-more-than-32-characters' }));
  const session = await request(app).post('/api/admin/login').set('Host', 'llm.test').set('Origin', 'https://llm.test')
    .set('Sec-Fetch-Site', 'same-origin').send({ username: 'admin', password: 'test-only-password' }).expect(200);
  assert.match(session.headers['set-cookie'][0], /Secure/);
  await request(app).get('/api/admin/models').set('Host', 'llm.test').set('Origin', 'https://llm.test')
    .set('Cookie', session.headers['set-cookie'][0].split(';')[0]).expect(200);
  await request(app).post('/api/admin/login').set('Host', 'llm.test').set('Origin', 'http://llm.test')
    .send({ username: 'admin', password: 'test-only-password' }).expect(403);
});

test('documented Docker HTTP origin supports login, CSRF mutation and logout', async (t) => {
  const config = loadConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://localhost:8080', ADMIN_PASSWORD: 'test-only-password', ADMIN_SESSION_SECRET: 'test-only-secret-with-more-than-32-characters' });
  const { app } = await fixture(t, config);
  const client = request.agent(app);
  const local = { Host: 'localhost:8080', Origin: 'http://localhost:8080', 'Sec-Fetch-Site': 'same-origin' };
  const session = await client.post('/api/admin/login').set(local).send({ username: 'admin', password: 'test-only-password' }).expect(200);
  assert.doesNotMatch(session.headers['set-cookie'][0], /; Secure/);
  assert.match(session.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);
  await client.post('/api/admin/models').set(local).set('X-CSRF-Token', session.body.csrfToken).send({ id: 'local' }).expect(201);
  await client.post('/api/admin/models').set(local).set('Origin', 'http://evil.test').set('X-CSRF-Token', session.body.csrfToken).send({ id: 'evil' }).expect(403);
  await client.post('/api/admin/logout').set(local).set('X-CSRF-Token', session.body.csrfToken).expect(204);
  await client.get('/api/admin/models').set(local).expect(401);
});

async function startHttpApp(t, app) {
  const { once } = await import('node:events');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  return { server, port: server.address().port };
}

// Send headers and one JSON byte, deliberately leaving Content-Length unsatisfied.
async function incompleteUpload(t, port, { token, target = '/v1/completions' } = {}) {
  const { request: httpRequest } = await import('node:http');
  const headers = { 'Content-Type': 'application/json', 'Content-Length': '100', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let resolveResult;
  const response = new Promise((resolve) => { resolveResult = resolve; });
  const upload = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: target, headers }, (res) => {
    res.resume();
    resolveResult(res);
  });
  upload.on('error', () => {}); // Destroyed deliberately during cleanup / rejection.
  t.after(() => upload.destroy());
  await new Promise((resolve) => upload.write('{', resolve));
  return { upload, response };
}

test('incomplete API uploads without valid tokens are rejected before body parsing', { timeout: 5000 }, async (t) => {
  const { app } = await fixture(t, { maxConcurrentRequests: 2 });
  const { port } = await startHttpApp(t, app);
  for (const token of [undefined, 'wrong']) {
    const { response } = await incompleteUpload(t, port, { token });
    const result = await Promise.race([response, new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 500);
      t.after(() => clearTimeout(timer));
    })]);
    assert.ok(result, '401 must arrive without waiting for the rest of the JSON body');
    assert.equal(result.statusCode, 401);
    assert.equal(result.headers.connection, 'close');
  }
  await request(app).get('/healthz').expect(200);
  await request(app).get('/api/admin/session').expect(200);
});

test('authenticated slow API uploads cannot consume admin or health capacity', { timeout: 5000 }, async (t) => {
  const { app } = await fixture(t, { maxConcurrentRequests: 2 });
  const { server, port } = await startHttpApp(t, app);
  const { once } = await import('node:events');
  const uploads = [];
  const sockets = [];
  for (let i = 0; i < 2; i++) {
    const arrived = once(server, 'request');
    uploads.push(await incompleteUpload(t, port, { token: 'sk-test' }));
    const [incoming] = await arrived;
    sockets.push(incoming.socket);
    await new Promise((resolve) => setImmediate(resolve));
  }
  await request(app).get('/v1/models').set('Authorization', 'Bearer sk-test').expect(429);
  await request(app).get('/healthz').expect(200);
  await request(app).get('/api/admin/session').expect(200);
  // Incomplete uploads can emit a parser error before close; that is expected.
  const closed = Promise.all(sockets.map((socket) => new Promise((resolve) => socket.once('close', resolve))));
  for (const { upload } of uploads) upload.destroy();
  await closed;
  await request(app).get('/v1/models').set('Authorization', 'Bearer sk-test').expect(200);
});

test('slow admin uploads cannot consume health or API capacity', { timeout: 5000 }, async (t) => {
  const { app } = await fixture(t, { maxAdminConcurrentRequests: 1 });
  const { server, port } = await startHttpApp(t, app);
  const { once } = await import('node:events');
  const arrived = once(server, 'request');
  await incompleteUpload(t, port, { target: '/api/admin/login' });
  await arrived;
  await new Promise((resolve) => setImmediate(resolve));
  await request(app).get('/api/admin/session').expect(429);
  await request(app).get('/healthz').expect(200);
  await request(app).get('/v1/models').set('Authorization', 'Bearer sk-test').expect(200);
});
