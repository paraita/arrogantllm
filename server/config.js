import path from 'node:path';
import { randomBytes } from 'node:crypto';

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

function readPublicBaseUrl(raw) {
  if (raw === undefined || raw.trim() === '') return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('PUBLIC_BASE_URL must be an HTTP or HTTPS origin, such as https://llm.example.com');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_BASE_URL must be an HTTP or HTTPS origin, such as https://llm.example.com');
  }
  return url.origin;
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const authSetting = env.ADMIN_AUTH_ENABLED || 'true';
  if (!['true', 'false'].includes(authSetting)) throw new Error('ADMIN_AUTH_ENABLED must be true or false');
  const adminAuthEnabled = authSetting === 'true';
  const publicBaseUrl = readPublicBaseUrl(env.PUBLIC_BASE_URL);
  if (!adminAuthEnabled && !publicBaseUrl) throw new Error('PUBLIC_BASE_URL is required when ADMIN_AUTH_ENABLED=false');
  if (!adminAuthEnabled && isProduction && !publicBaseUrl.startsWith('https://')) {
    throw new Error('PUBLIC_BASE_URL must use HTTPS in production when ADMIN_AUTH_ENABLED=false');
  }
  const adminPassword = env.ADMIN_PASSWORD || (isProduction ? '' : 'dev-only-change-me');
  const adminSessionSecret = env.ADMIN_SESSION_SECRET || (!adminAuthEnabled ? randomBytes(32).toString('hex')
    : isProduction ? '' : 'development-session-secret-change-before-deploying');

  if (adminAuthEnabled && !adminPassword) throw new Error('ADMIN_PASSWORD is required in production');
  if (!adminSessionSecret) throw new Error('ADMIN_SESSION_SECRET is required in production');
  if (adminSessionSecret.length < 32) {
    throw new Error('ADMIN_SESSION_SECRET must be at least 32 characters');
  }
  if (isProduction && ((adminAuthEnabled && ['dev-only-change-me', 'change-this-local-password'].includes(adminPassword))
    || ['replace-with-a-long-random-secret', 'development-session-secret-change-before-deploying'].includes(adminSessionSecret))) {
    throw new Error('Replace example/placeholder admin credentials before running in production');
  }
  // HTTP cookies are allowed only for an explicitly configured local dashboard.
  // Never derive this exception from Host or forwarded request headers.
  const publicUrl = publicBaseUrl ? new URL(publicBaseUrl) : null;
  const localHttpDashboard = adminAuthEnabled && publicUrl?.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname);

  const config = {
    nodeEnv,
    isProduction,
    port: readInteger(env, 'PORT', 8080, { min: 1, max: 65535 }),
    dataDir: path.resolve(env.DATA_DIR || './data'),
    publicBaseUrl,
    adminAuthEnabled,
    adminCookieSecure: isProduction && !localHttpDashboard,
    adminUsername: env.ADMIN_USERNAME || 'admin',
    adminPassword,
    adminSessionSecret,
    loginRateLimit: readInteger(env, 'LOGIN_RATE_LIMIT', 10, { min: 1, max: 1000 }),
    maxConcurrentRequests: readInteger(env, 'MAX_CONCURRENT_REQUESTS', 64, { min: 1, max: 4096 }),
    maxAdminConcurrentRequests: readInteger(env, 'MAX_ADMIN_CONCURRENT_REQUESTS', 16, { min: 1, max: 4096 }),
    minDelayMs: readInteger(env, 'API_DELAY_MIN_MS', 180, { min: 0, max: 120000 }),
    maxDelayMs: readInteger(env, 'API_DELAY_MAX_MS', 900, { min: 0, max: 120000 }),
  };

  if (config.minDelayMs > config.maxDelayMs) {
    throw new Error('API delay minimum must be less than or equal to maximum');
  }

  return Object.freeze(config);
}
