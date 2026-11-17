import express from 'express';
import { pathToFileURL } from 'node:url';
import { createAdminRouter } from './routes/admin.js';
import { createOpenAIRouter, openAIErrorHandler } from './routes/openai.js';
import { loadConfig } from './config.js';
import { createMetrics } from './metrics.js';
import { createStore } from './store.js';

export function createApp({ config, store, metrics = createMetrics(), streamDelay }) {
  if (!config || !store) throw new TypeError('config and store are required');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: config.maxBodySize || '1mb', strict: true }));

  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/admin', createAdminRouter({ store, config, metrics }));
  app.use('/v1', createOpenAIRouter({ store, config, metrics, streamDelay }));
  app.use((req, res) => res.status(404).json({ error: { message: 'Not found', type: 'invalid_request_error' } }));
  app.use(openAIErrorHandler);
  return app;
}

export async function startServer() {
  const config = loadConfig();
  const store = await createStore({ dataDir: config.dataDir });
  const metrics = createMetrics();
  const app = createApp({ config, store, metrics });
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Mock OpenAI-compatible API listening on port ${config.port}`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error) => {
    console.error(`Failed to start mock API: ${error.message}`);
    process.exitCode = 1;
  });
}
