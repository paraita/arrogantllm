import path from 'node:path';

function readInteger(env, name, fallback, { min, max }) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const adminPassword = env.ADMIN_PASSWORD || (isProduction ? '' : 'dev-only-change-me');
  const adminSessionSecret = env.ADMIN_SESSION_SECRET || (isProduction ? '' : 'development-session-secret-change-before-deploying');

  if (!adminPassword) throw new Error('ADMIN_PASSWORD is required in production');
  if (!adminSessionSecret) throw new Error('ADMIN_SESSION_SECRET is required in production');
  if (adminSessionSecret.length < 32) {
    throw new Error('ADMIN_SESSION_SECRET must be at least 32 characters');
  }

  const config = {
    nodeEnv,
    isProduction,
    port: readInteger(env, 'PORT', 8080, { min: 1, max: 65535 }),
    dataDir: path.resolve(env.DATA_DIR || './data'),
    adminUsername: env.ADMIN_USERNAME || 'admin',
    adminPassword,
    adminSessionSecret,
    minDelayMs: readInteger(env, 'API_DELAY_MIN_MS', 180, { min: 0, max: 120000 }),
    maxDelayMs: readInteger(env, 'API_DELAY_MAX_MS', 900, { min: 0, max: 120000 }),
  };

  if (config.minDelayMs > config.maxDelayMs) {
    throw new Error('API delay minimum must be less than or equal to maximum');
  }

  return Object.freeze(config);
}
