import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';

test('provides safe local defaults for development', () => {
  const config = loadConfig({});

  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.port, 8080);
  assert.equal(config.adminUsername, 'admin');
  assert.equal(config.adminPassword, 'dev-only-change-me');
  assert.equal(config.minDelayMs, 180);
  assert.equal(config.maxDelayMs, 900);
});

test('requires explicit admin credentials and session secret in production', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /ADMIN_PASSWORD/);
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', ADMIN_PASSWORD: 'strong-password' }),
    /ADMIN_SESSION_SECRET/,
  );
  assert.throws(
    () => loadConfig({
      NODE_ENV: 'production',
      ADMIN_PASSWORD: 'strong-password',
      ADMIN_SESSION_SECRET: 'too-short-secret',
    }),
    /at least 32 characters/i,
  );
});

test('reads explicit settings from environment variables', () => {
  const config = loadConfig({
    PORT: '9090',
    DATA_DIR: '/var/lib/fake-llm',
    ADMIN_USERNAME: 'operator',
    ADMIN_PASSWORD: 'secret',
    ADMIN_SESSION_SECRET: 'session-secret-that-is-at-least-thirty-two-characters',
    API_DELAY_MIN_MS: '25',
    API_DELAY_MAX_MS: '400',
  });

  assert.equal(config.port, 9090);
  assert.equal(config.dataDir, '/var/lib/fake-llm');
  assert.equal(config.adminUsername, 'operator');
  assert.equal(config.adminPassword, 'secret');
  assert.equal(config.adminSessionSecret, 'session-secret-that-is-at-least-thirty-two-characters');
  assert.equal(config.minDelayMs, 25);
  assert.equal(config.maxDelayMs, 400);
});

test('rejects invalid ports and delay ranges', () => {
  assert.throws(() => loadConfig({ PORT: '0' }), /PORT/);
  assert.throws(() => loadConfig({ API_DELAY_MIN_MS: '-1' }), /API_DELAY_MIN_MS/);
  assert.throws(() => loadConfig({ API_DELAY_MAX_MS: 'not-a-number' }), /API_DELAY_MAX_MS/);
  assert.throws(() => loadConfig({ API_DELAY_MIN_MS: '100', API_DELAY_MAX_MS: '50' }), /delay/i);
});
